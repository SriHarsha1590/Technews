import Parser from 'rss-parser';
import { log } from '@temporalio/activity';
import { RETENTION_DAYS, type Article, type Source } from '@technews/shared';
import { SOURCES } from '../sources';
import { articles } from '../db';
import { articleId } from '../url';
import { USER_AGENT } from '../config';
import { authorOf, imageOf, type FeedItemMedia } from '../media';

const MAX_ITEMS_PER_SOURCE = 40;
const SNIPPET_MAX_CHARS = 1500; // enough for the AI to summarize (arXiv abstracts are ~1500), still not the full article
type Item = Parser.Item & FeedItemMedia & { 'content:encodedSnippet'?: string };
const parser = new Parser<Record<string, unknown>, Item>({
  timeout: 20_000,
  headers: { 'User-Agent': USER_AGENT },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
    ],
  },
});

/**
 * The longer of the description and the content:encoded intro. Some feeds (Ars Technica) put a one-line teaser in
 * the description and the opening paragraphs in content:encoded, and their pages block bots, so this is all we get.
 */
function snippetOf(item: Item): string {
  const [best] = [item['content:encodedSnippet'] ?? '', item.contentSnippet ?? '']
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .sort((a, b) => b.length - a.length);
  return best.slice(0, SNIPPET_MAX_CHARS);
}

export interface IngestResult {
  sourceId: string;
  fetched: number;
  inserted: number;
}

export async function listSources(): Promise<Source[]> {
  return SOURCES;
}

/** Fetch one feed and save new items. Fetch + save in one activity keeps article text out of workflow history. */
export async function ingestSource(source: Source): Promise<IngestResult> {
  const feed = await parser.parseURL(source.url);
  const now = new Date();
  const oldest = now.getTime() - RETENTION_DAYS * 86_400_000;
  const docs: Article[] = [];

  for (const item of (feed.items ?? []).slice(0, MAX_ITEMS_PER_SOURCE)) {
    if (!item.link || !item.title) continue;
    let id: string;
    try {
      id = articleId(item.link);
    } catch {
      continue; // malformed link in the feed
    }
    const published = item.isoDate ? new Date(item.isoDate) : null;
    if (published && published.getTime() < oldest) continue; // past retention: would be deleted right away
    docs.push({
      _id: id,
      url: item.link,
      title: item.title.trim(),
      snippet: snippetOf(item),
      imageUrl: imageOf(item, item.link),
      author: source.aggregator ? null : authorOf(item),
      sourceId: source.id,
      sourceName: source.name,
      category: source.category,
      trustTier: source.trustTier,
      publishedAt: published && !isNaN(published.getTime()) ? published : null,
      fetchedAt: now,
      status: 'new',
      summaryAttempts: 0,
    });
  }

  let inserted = 0;
  if (docs.length) {
    // $setOnInsert: a story we already have is left untouched, so re-runs and retries are harmless.
    const res = await (await articles()).bulkWrite(
      docs.map(({ _id, ...rest }) => ({ updateOne: { filter: { _id }, update: { $setOnInsert: rest }, upsert: true } })),
      { ordered: false },
    );
    inserted = res.upsertedCount;
  }
  log.info('ingested source', { source: source.id, fetched: docs.length, inserted });
  return { sourceId: source.id, fetched: docs.length, inserted };
}
