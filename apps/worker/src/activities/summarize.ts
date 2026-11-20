import { log } from '@temporalio/activity';
import {
  TRUST_TIERS,
  StorySummary,
  InsufficientItem,
  SummaryResponse,
  SUMMARY_MIN_WORDS,
  SUMMARY_MAX_WORDS,
  CATEGORIES,
  type Article,
  type Story,
  type StorySource,
  type Category,
} from '@technews/shared';
import { articles, stories } from '../db';
import { groupByTitle, sameStory } from '../cluster';
import { extractText } from '../extract';
import { generateJson, DailyCapReached } from '../llm';
import { USER_AGENT } from '../config';

const MAX_ATTEMPTS = 3;
const MATCH_WINDOW_HOURS = 48;
const THIN_TEXT_CHARS = 300;

/** Just the fields the pipeline needs; keeps workflow history small. */
export type ArticleLite = Pick<
  Article,
  '_id' | 'url' | 'title' | 'snippet' | 'sourceName' | 'category' | 'trustTier' | 'publishedAt' | 'imageUrl' | 'author'
>;

export interface GroupInput {
  articles: ArticleLite[];
  text: string; // context for the AI, built from snippets and (for thin items) the article page
}

export interface SummarizeResult {
  summaries: { groupIndex: number; summary: StorySummary }[];
  insufficient: number[]; // group indexes the AI said it couldn't summarize honestly
  invalid: number[]; // group indexes whose output broke the rules (e.g. 140 words)
  capped: boolean; // daily AI budget used up; nothing was attempted
}

const tierRank = (t: StorySource['trustTier']) => TRUST_TIERS.indexOf(t);
const time = (d: Date | null) => (d ? new Date(d).getTime() : Number.MAX_SAFE_INTEGER);

/** Best trust tier first, then earliest published. */
function pickPrimary(list: ArticleLite[]): ArticleLite {
  return [...list].sort((a, b) => tierRank(a.trustTier) - tierRank(b.trustTier) || time(a.publishedAt) - time(b.publishedAt))[0];
}

const toSource = (a: ArticleLite): StorySource => ({ name: a.sourceName, url: a.url, trustTier: a.trustTier });

// ---------- Step 1: find work ----------

/** Newest first: with a backlog bigger than one run, a refresh must still reach what was just published. */
export async function loadPendingArticles(limit: number): Promise<ArticleLite[]> {
  return (await articles())
    .find({ status: 'new', summaryAttempts: { $lt: MAX_ATTEMPTS } })
    .sort({ publishedAt: -1, fetchedAt: -1 })
    .limit(limit)
    .project<ArticleLite>({ _id: 1, url: 1, title: 1, snippet: 1, sourceName: 1, category: 1, trustTier: 1, publishedAt: 1, imageUrl: 1, author: 1 })
    .toArray();
}

// ---------- Step 2: attach to existing stories, group the rest ----------

export async function assignToStories(pending: ArticleLite[]): Promise<{ attached: number; groups: ArticleLite[][] }> {
  const storyCol = await stories();
  const articleCol = await articles();
  const since = new Date(Date.now() - MATCH_WINDOW_HOURS * 3_600_000);
  const recent = await storyCol
    .find({ publishedAt: { $gte: since } })
    .project<Pick<Story, '_id' | 'matchTitles' | 'primarySource'>>({ _id: 1, matchTitles: 1, primarySource: 1 })
    .toArray();

  const leftover: ArticleLite[] = [];
  let attached = 0;

  for (const a of pending) {
    const story = recent.find((s) => s.matchTitles.some((t) => sameStory(t, a.title)));
    if (!story) {
      leftover.push(a);
      continue;
    }
    // Already summarized event: add this coverage without another AI call.
    const better = tierRank(a.trustTier) < tierRank(story.primarySource.trustTier);
    await storyCol.updateOne(
      { _id: story._id, articleIds: { $ne: a._id } },
      {
        $push: { sources: toSource(a), matchTitles: { $each: [a.title], $slice: -5 } },
        $addToSet: { articleIds: a._id },
        $inc: { sourceCount: 1 },
        $set: {
          updatedAt: new Date(),
          // A better primary brings its own byline; its image replaces ours only if it has one.
          ...(better ? { primaryUrl: a.url, primarySource: toSource(a), author: a.author ?? null, ...(a.imageUrl ? { imageUrl: a.imageUrl } : {}) } : {}),
        },
      },
    );
    if (better) story.primarySource = toSource(a);
    await articleCol.updateOne({ _id: a._id }, { $set: { status: 'summarized', storyId: story._id } });
    attached++;
  }

  return { attached, groups: groupByTitle(leftover) };
}

// ---------- Step 3: build the text the AI will read ----------

async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('text/html')) return '';
    // Some pages (blog.google) carry ~800 KB of inline scripts before the first paragraph.
    return extractText((await res.text()).slice(0, 2_000_000));
  } catch {
    return ''; // page unreachable: we'll work with the snippet
  }
}

export async function buildContexts(groups: ArticleLite[][]): Promise<GroupInput[]> {
  // Pages are fetched in parallel: one slow site no longer delays the whole batch.
  return Promise.all(
    groups.map(async (group) => {
      const lines = group.slice(0, 4).map((a) => `- [${a.sourceName}] ${a.title}\n  ${a.snippet}`);
      let text = lines.join('\n');
      if (group.reduce((n, a) => n + a.snippet.length, 0) < THIN_TEXT_CHARS) {
        const page = await fetchPageText(pickPrimary(group).url);
        if (page) text += `\n  Article text: ${page}`;
      }
      return { articles: group, text };
    }),
  );
}

// ---------- Step 4: ask the AI (runs on the rate-limited 'llm' queue) ----------

function buildPrompt(inputs: GroupInput[]): string {
  const items = inputs.map((g, i) => `Story ${i}:\n${g.text}`).join('\n\n');
  return `You write short news cards for software developers.
For each numbered story, using ONLY the text given for it:
- title: a clear, neutral headline, max 90 characters, no clickbait.
- summary: ${SUMMARY_MIN_WORDS} to ${SUMMARY_MAX_WORDS} words. Say what happened, what it is, and who should care. Plain language, no hype, no markdown.
- tags: 1 to 5 short lowercase tags (technologies, products, companies).
- category: one of ${CATEGORIES.join(', ')}. Use "tools" when the story is mainly a launch or release of something readers can use now:
  a new tool, app, product, library, framework, model, API, device or technology, or a major new version or feature of one, in any field.
  Otherwise pick the topic (e.g. a vulnerability is "security", a paper is "research", funding or policy news is "general").
If the given text is too thin to write an accurate summary without guessing, return {"index": N, "insufficient": true} for that story instead.
Never add facts that are not in the text.
Return a JSON array with exactly one object per story, where "index" is the story number.

${items}`;
}

/** Checks each item against the rules separately, so one bad item doesn't throw away the whole batch. */
export function parseSummaryResponse(raw: unknown, groupCount: number): Omit<SummarizeResult, 'capped'> {
  const out: Omit<SummarizeResult, 'capped'> = { summaries: [], insufficient: [], invalid: [] };
  const items = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < groupCount; i++) {
    const item = items.find((x) => typeof x === 'object' && x !== null && (x as { index?: unknown }).index === i);
    if (InsufficientItem.safeParse(item).success) {
      out.insufficient.push(i);
      continue;
    }
    const parsed = StorySummary.safeParse(item);
    if (parsed.success) out.summaries.push({ groupIndex: i, summary: parsed.data });
    else out.invalid.push(i); // e.g. wrong length or missing: stays 'new', retried next run
  }
  return out;
}

export async function summarizeGroups(inputs: GroupInput[]): Promise<SummarizeResult> {
  let raw: unknown;
  try {
    raw = await generateJson(buildPrompt(inputs), SummaryResponse);
  } catch (err) {
    if (err instanceof DailyCapReached) return { summaries: [], insufficient: [], invalid: [], capped: true };
    throw err; // e.g. 429 rate limit: Temporal retries with backoff
  }
  const result = { ...parseSummaryResponse(raw, inputs.length), capped: false };
  log.info('summarized batch', {
    ok: result.summaries.length,
    insufficient: result.insufficient.length,
    invalid: result.invalid.length,
  });
  return result;
}

// ---------- Step 5: save stories and mark articles ----------

/** Returns the ids of the stories it saved, so the caller can find their Try it links next. */
export async function saveStories(inputs: GroupInput[], result: SummarizeResult): Promise<string[]> {
  const storyCol = await stories();
  const articleCol = await articles();
  const now = new Date();
  const saved: string[] = [];

  for (const { groupIndex, summary } of result.summaries) {
    const group = inputs[groupIndex].articles;
    const primary = pickPrimary(group);
    const published = group.map((a) => a.publishedAt).filter((d): d is Date => !!d).map((d) => new Date(d));
    const story: Omit<Story, '_id'> = {
      title: summary.title,
      summary: summary.summary,
      tags: summary.tags.map((t) => t.toLowerCase()),
      category: summary.category as Category,
      primaryUrl: primary.url,
      primarySource: toSource(primary),
      imageUrl: primary.imageUrl ?? group.find((a) => a.imageUrl)?.imageUrl ?? null, // no image: findStoryImages tries the page
      author: primary.author ?? null,
      sources: group.map(toSource),
      articleIds: group.map((a) => a._id),
      sourceCount: group.length,
      matchTitles: group.map((a) => a.title).slice(0, 5),
      score: 0, // set by rebuildFeeds
      publishedAt: published.length ? new Date(Math.min(...published.map((d) => d.getTime()))) : now,
      createdAt: now,
      updatedAt: now,
    };
    // Story id = primary article id, so a retried save can't create a duplicate.
    await storyCol.updateOne({ _id: primary._id }, { $setOnInsert: story }, { upsert: true });
    await articleCol.updateMany({ _id: { $in: story.articleIds } }, { $set: { status: 'summarized', storyId: primary._id } });
    saved.push(primary._id);
  }

  const idsOf = (indexes: number[]) => indexes.flatMap((i) => inputs[i].articles.map((a) => a._id));
  await articleCol.updateMany({ _id: { $in: idsOf(result.insufficient) } }, { $set: { status: 'skipped' } });
  await articleCol.updateMany({ _id: { $in: idsOf(result.invalid) } }, { $inc: { summaryAttempts: 1 } });
  return saved;
}
