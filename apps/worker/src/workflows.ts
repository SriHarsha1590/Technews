// Workflow code must be deterministic: no network, no Date.now(), no randomness here.
// All of that lives in activities.
import { proxyActivities, executeChild, workflowInfo, log } from '@temporalio/workflow';
import type * as activities from './activities';

const LLM_TASK_QUEUE = 'llm'; // keep in sync with config.ts (workflows can't import Node modules)

const { listSources, ingestSource } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 3, initialInterval: '10 seconds' },
});

const {
  loadPendingArticles, assignToStories, buildContexts, saveStories, rebuildFeeds,
  loadStoriesNeedingTryLinks, collectLinkCandidates, verifyAndSaveTryLinks, markSearchedWithoutLinks, recheckTryLinks,
  findStoryImages, sendDigests,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
  retry: { maximumAttempts: 5, initialInterval: '5 seconds' },
});

// AI calls go to their own queue, where the worker enforces a calls-per-second limit.
const { summarizeGroups, classifyTryLinks } = proxyActivities<typeof activities>({
  taskQueue: LLM_TASK_QUEUE,
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 4, initialInterval: '30 seconds', backoffCoefficient: 2 }, // backs off on 429s
});

export interface IngestSummary {
  ok: activities.IngestResult[];
  failed: string[];
  totalInserted: number;
}

export async function ingestAllWorkflow(): Promise<IngestSummary> {
  const sources = await listSources();
  const results = await Promise.allSettled(sources.map((s) => ingestSource(s))); // one broken feed can't stop the rest

  const summary: IngestSummary = { ok: [], failed: [], totalInserted: 0 };
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      summary.ok.push(r.value);
      summary.totalInserted += r.value.inserted;
    } else {
      summary.failed.push(sources[i].id);
    }
  });
  if (summary.failed.length) log.warn('sources failed', { failed: summary.failed });
  return summary;
}

export interface SummarizeRunSummary {
  pending: number;
  attachedToExisting: number;
  newStories: number;
  capped: boolean;
  feeds: Record<string, number>;
}

const BATCH_SIZE = 10; // stories per AI call
const MAX_ARTICLES_PER_RUN = 40;

export async function summarizeWorkflow(): Promise<SummarizeRunSummary> {
  const pending = await loadPendingArticles(MAX_ARTICLES_PER_RUN);
  const { attached, groups } = await assignToStories(pending);

  let newStories = 0;
  let capped = false;
  for (let i = 0; i < groups.length; i += BATCH_SIZE) {
    // Per batch, so the first cards don't wait for every article page to be read.
    const batch = await buildContexts(groups.slice(i, i + BATCH_SIZE));
    const result = await summarizeGroups(batch);
    if (result.capped) {
      capped = true; // daily AI budget used up; remaining articles wait for tomorrow
      break;
    }
    const saved = await saveStories(batch, result); // separate step: a failed save won't repeat the AI call
    newStories += saved.length;
    if (!saved.length) continue;
    await findStoryImages(saved.length, saved); // cards whose feed had no picture
    await rebuildFeeds(); // publish now: readers see this batch while the next one is summarized
  }

  // Rebuild even when nothing is new: scores change as stories age.
  const feeds = await rebuildFeeds();
  return { pending: pending.length, attachedToExisting: attached, newStories, capped, feeds };
}

export interface TryLinksRunSummary {
  searched: number;
  withoutCandidates: number;
  withLinks: number;
  capped: boolean;
  unavailable: boolean;
}

const TRY_BATCH_SIZE = 5; // stories per AI call (each brings up to ~60 links)

/** Finds verified "Try it" links for new stories: read pages -> AI picks -> code verifies -> save. */
export async function tryLinksWorkflow(): Promise<TryLinksRunSummary> {
  return findTryLinks(await loadStoriesNeedingTryLinks(15));
}

async function findTryLinks(list: Awaited<ReturnType<typeof loadStoriesNeedingTryLinks>>): Promise<TryLinksRunSummary> {
  const all = await collectLinkCandidates(list);

  const empty = all.filter((s) => s.candidates.length === 0);
  await markSearchedWithoutLinks(empty.map((s) => s.storyId)); // nothing to ask the AI about

  const todo = all.filter((s) => s.candidates.length > 0);
  let withLinks = 0;
  let capped = false;
  let unavailable = false;
  for (let i = 0; i < todo.length; i += TRY_BATCH_SIZE) {
    const batch = todo.slice(i, i + TRY_BATCH_SIZE);
    const picks = await classifyTryLinks(batch);
    if (picks.capped) {
      capped = true; // daily AI budget used up: these stay unsearched and are retried tomorrow
      break;
    }
    if (picks.unavailable) {
      unavailable = true; // provider outage: leave these unsearched for the next refresh
      break;
    }
    withLinks += await verifyAndSaveTryLinks(batch, picks);
  }
  return { searched: list.length, withoutCandidates: empty.length, withLinks, capped, unavailable };
}

export interface RefreshSummary {
  ingest: IngestSummary;
  pending: number;
  attachedToExisting: number;
  batches: { newStories: number; withLinks: number }[];
  catchUp: { images: number; tryLinks: TryLinksRunSummary | null };
  capped: boolean;
  unavailable: boolean;
}

const CATCH_UP_IMAGES = 20;
const CATCH_UP_TRY_LINKS = 15;

/**
 * The whole pipeline. The 'pipeline' schedule runs it every 5 minutes, and the UI's Refresh button runs it on demand.
 * Scrapes every feed (one quick request each), then works through the new stories 10 at a time:
 * summarize -> images -> publish the cards -> find their Try it links -> next 10.
 * So the first cards (with their Try it links) are ready after one batch, not after all of them.
 * Then it catches up on older stories still missing an image or Try it links, and re-ranks every feed.
 */
async function runRefreshWorkflow(): Promise<RefreshSummary> {
  // Child id is unique per run, so it never collides with the scheduled ingest.
  const ingest = await executeChild(ingestAllWorkflow, { workflowId: `${workflowInfo().workflowId}-ingest-${workflowInfo().runId}` });

  const pending = await loadPendingArticles(MAX_ARTICLES_PER_RUN);
  const { attached, groups } = await assignToStories(pending);
  if (attached) await rebuildFeeds(); // extra coverage can lift existing stories

  const batches: RefreshSummary['batches'] = [];
  let capped = false;
  let unavailable = false;
  for (let i = 0; i < groups.length; i += BATCH_SIZE) {
    const inputs = await buildContexts(groups.slice(i, i + BATCH_SIZE));
    const result = await summarizeGroups(inputs);
    if (result.capped) {
      capped = true; // daily AI budget used up; the rest wait for the schedules
      break;
    }
    const saved = await saveStories(inputs, result);
    if (!saved.length) continue;
    await findStoryImages(saved.length, saved);
    await rebuildFeeds(); // this batch's cards appear now

    const links = await findTryLinks(await loadStoriesNeedingTryLinks(saved.length, saved));
    batches.push({ newStories: saved.length, withLinks: links.withLinks });
    if (links.withLinks) await rebuildFeeds(); // new snapshot: the web app reloads and shows the Try it buttons
    if (links.capped) {
      capped = true;
      break;
    }
    if (links.unavailable) {
      unavailable = true;
      break;
    }
  }

  // Leftovers: stories from earlier runs that hit the AI cap, or whose image/link search didn't finish.
  const images = await findStoryImages(CATCH_UP_IMAGES);
  const tryLinks = capped || unavailable ? null : await findTryLinks(await loadStoriesNeedingTryLinks(CATCH_UP_TRY_LINKS));
  if (tryLinks?.capped) capped = true;
  if (tryLinks?.unavailable) unavailable = true;

  await rebuildFeeds(); // always: scores change as stories age
  const summary = { ingest, pending: pending.length, attachedToExisting: attached, batches, catchUp: { images, tryLinks }, capped, unavailable };
  if (capped) log.warn('pipeline AI cap reached', { event: 'pipeline_ai_cap', workflowId: workflowInfo().workflowId });
  if (unavailable) log.warn('pipeline Try it links deferred', { event: 'pipeline_ai_unavailable', workflowId: workflowInfo().workflowId });
  log.info('pipeline completed', { event: 'pipeline_completed', workflowId: workflowInfo().workflowId, pending: pending.length, batches: batches.length });
  return summary;
}

export async function refreshWorkflow(): Promise<RefreshSummary> {
  try {
    return await runRefreshWorkflow();
  } catch (error) {
    log.error('pipeline failed', { event: 'pipeline_failed', workflowId: workflowInfo().workflowId, errorName: error instanceof Error ? error.name : 'UnknownError' });
    throw error;
  }
}

/** Weekly: re-check saved links and drop any that died or moved off the official site. */
export async function recheckTryLinksWorkflow(): Promise<{ checked: number; removed: number }> {
  return recheckTryLinks();
}

/** Hourly: sends the daily digest to readers whose chosen local hour has come. */
export async function digestWorkflow(): Promise<activities.DigestRunSummary> {
  return sendDigests();
}
