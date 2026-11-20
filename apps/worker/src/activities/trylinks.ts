import { log } from '@temporalio/activity';
import { z } from 'zod';
import { TRY_LINK_TYPES, type Story, type StorySource, type TryLink, type TryLinkType } from '@technews/shared';
import { stories } from '../db';
import { extractLinks } from '../links';
import { checkLink } from '../check';
import { isTrustedLink, pageContext, siteOf, type PageContext } from '../trust';
import { generateJson, DailyCapReached } from '../llm';
import { USER_AGENT } from '../config';

const LOOKBACK_HOURS = 72;
const PAGES_PER_STORY = 2;
const RECHECK_AFTER_DAYS = 7;

export interface Candidate {
  n: number; // number shown to the AI
  url: string;
  text: string;
  page: PageContext;
}

export interface StoryCandidates {
  storyId: string;
  title: string;
  summary: string;
  candidates: Candidate[];
}

export interface PickResult {
  picks: { storyId: string; links: { n: number; type: TryLinkType }[] }[];
  capped: boolean;
}

// ---------- Step 1: which stories still need searching ----------

/** ids: only these stories (Refresh searches each batch right after it is summarized). */
export async function loadStoriesNeedingTryLinks(limit: number, ids?: string[]): Promise<Pick<Story, '_id' | 'title' | 'summary' | 'sources'>[]> {
  return (await stories())
    .find({
      tryCheckedAt: { $exists: false },
      publishedAt: { $gte: new Date(Date.now() - LOOKBACK_HOURS * 3_600_000) },
      ...(ids ? { _id: { $in: ids } } : {}),
    })
    .sort({ publishedAt: -1 })
    .limit(limit)
    .project<Pick<Story, '_id' | 'title' | 'summary' | 'sources'>>({ _id: 1, title: 1, summary: 1, sources: 1 })
    .toArray();
}

// ---------- Step 2: read the source pages and list their links ----------

async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return '';
    return (await res.text()).slice(0, 1_000_000);
  } catch {
    return '';
  }
}

const tierOrder = (s: StorySource) => ['official', 'press', 'community'].indexOf(s.trustTier);

export async function collectLinkCandidates(list: Pick<Story, '_id' | 'title' | 'summary' | 'sources'>[]): Promise<StoryCandidates[]> {
  const out: StoryCandidates[] = [];
  for (const story of list) {
    const pages = [...story.sources].sort((a, b) => tierOrder(a) - tierOrder(b)).slice(0, PAGES_PER_STORY);
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    for (const source of pages) {
      const page = pageContext(source.url, source.trustTier);
      for (const link of extractLinks(await fetchHtml(source.url), source.url)) {
        if (seen.has(link.url)) continue;
        // Drop links that could never pass the rules, so the AI doesn't spend effort on them.
        const url = new URL(link.url);
        if (!TRY_LINK_TYPES.some((t) => isTrustedLink(url, t, page))) continue;
        seen.add(link.url);
        candidates.push({ n: candidates.length, url: link.url, text: link.text, page });
      }
    }
    out.push({ storyId: story._id, title: story.title, summary: story.summary, candidates });
  }
  return out;
}

// ---------- Step 3: the AI picks which links fit (rate-limited 'llm' queue) ----------

const PickResponse = z.array(
  z.object({
    index: z.number().int(),
    picks: z.array(z.object({ link: z.number().int(), type: z.enum(TRY_LINK_TYPES) })),
  }),
);

function buildPrompt(batch: StoryCandidates[]): string {
  const stories = batch
    .map((s, i) => {
      const links = s.candidates.map((c) => `  [${c.n}] ${c.text} (${new URL(c.url).hostname}${new URL(c.url).pathname})`).join('\n');
      return `Story ${i}: ${s.title}\n${s.summary}\nLinks:\n${links}`;
    })
    .join('\n\n');
  return `For each story, choose links from ITS OWN numbered list that let a developer start using the product or technology the story is about.
Link types:
- playground: try it in the browser (demo, playground, console, Hugging Face Space)
- download: installer, app or app-store page
- repo: source code or package page
- docs: getting-started guide or documentation
Rules: at most one link per type; only links clearly about this story's product; never news posts, blog posts, pricing, events or generic home pages. If nothing fits, return an empty picks list.
Return a JSON array: [{"index": <story number>, "picks": [{"link": <link number>, "type": "<type>"}]}].

${stories}`;
}

export async function classifyTryLinks(batch: StoryCandidates[]): Promise<PickResult> {
  let raw: unknown;
  try {
    raw = await generateJson(buildPrompt(batch), PickResponse);
  } catch (err) {
    if (err instanceof DailyCapReached) return { picks: [], capped: true };
    throw err;
  }
  const parsed = PickResponse.safeParse(raw);
  const items = parsed.success ? parsed.data : [];
  return {
    capped: false,
    picks: batch.map((s, i) => ({
      storyId: s.storyId,
      links: (items.find((x) => x.index === i)?.picks ?? []).map((p) => ({ n: p.link, type: p.type })),
    })),
  };
}

// ---------- Step 4: code verifies every pick, then saves ----------

/** Turns AI picks into verified links. Pure apart from the network check, so it is unit-tested. */
export async function verifyPicks(
  story: StoryCandidates,
  picks: { n: number; type: TryLinkType }[],
  check: typeof checkLink = checkLink,
  now: Date = new Date(),
): Promise<{ links: TryLink[]; rejected: { url: string; reason?: string }[] }> {
  const result: TryLink[] = [];
  const rejected: { url: string; reason?: string }[] = [];
  for (const type of TRY_LINK_TYPES) {
    if (result.some((l) => l.type === type)) continue;
    for (const pick of picks.filter((p) => p.type === type)) {
      const candidate = story.candidates.find((c) => c.n === pick.n); // unknown number: ignored
      if (!candidate) continue;
      const allowed = (u: URL) => isTrustedLink(u, type, candidate.page);
      const res = await check(candidate.url, allowed);
      if (!res.ok) {
        rejected.push({ url: candidate.url, reason: res.reason });
        continue;
      }
      const finalUrl = new URL(res.finalUrl ?? candidate.url);
      result.push({ type, url: finalUrl.toString(), domain: finalUrl.hostname, label: candidate.text, checkedAt: now });
      break;
    }
  }
  return { links: result, rejected };
}

export async function verifyAndSaveTryLinks(batch: StoryCandidates[], result: PickResult): Promise<number> {
  const col = await stories();
  let withLinks = 0;
  for (const story of batch) {
    const picks = result.picks.find((p) => p.storyId === story.storyId)?.links ?? [];
    const { links: tryLinks, rejected } = await verifyPicks(story, picks);
    for (const r of rejected) log.info('try link rejected', { story: story.storyId, ...r });
    if (tryLinks.length) withLinks++;
    await col.updateOne({ _id: story.storyId }, { $set: { tryLinks, tryCheckedAt: new Date() } });
  }
  return withLinks;
}

/** Stories whose pages had no usable links: record that we looked, so we don't fetch them again. */
export async function markSearchedWithoutLinks(storyIds: string[]): Promise<void> {
  if (!storyIds.length) return;
  await (await stories()).updateMany({ _id: { $in: storyIds } }, { $set: { tryLinks: [], tryCheckedAt: new Date() } });
}

// ---------- Weekly: links die and pages move ----------

export async function recheckTryLinks(): Promise<{ checked: number; removed: number }> {
  const col = await stories();
  const before = new Date(Date.now() - RECHECK_AFTER_DAYS * 86_400_000);
  const list = await col
    .find({ 'tryLinks.checkedAt': { $lt: before } })
    .limit(200)
    .project<Pick<Story, '_id' | 'tryLinks'>>({ _id: 1, tryLinks: 1 })
    .toArray();

  let checked = 0;
  let removed = 0;
  for (const story of list) {
    const kept: TryLink[] = [];
    for (const link of story.tryLinks ?? []) {
      if (link.checkedAt >= before) {
        kept.push(link);
        continue;
      }
      checked++;
      const site = siteOf(link.url);
      const res = await checkLink(link.url, (u) => u.protocol === 'https:' && siteOf(u.hostname) === site); // must stay on the same site
      if (res.ok) kept.push({ ...link, checkedAt: new Date() });
      else {
        removed++;
        log.info('try link removed', { story: story._id, url: link.url, reason: res.reason });
      }
    }
    await col.updateOne({ _id: story._id }, { $set: { tryLinks: kept } });
  }
  return { checked, removed };
}
