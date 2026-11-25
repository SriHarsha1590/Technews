import type { FeedQuery, StoryCard } from '@technews/shared';
import type { FeedStore, StoryStore } from './stores';
import { decodeCursor, encodeCursor } from './cursor';
import { CACHE } from './config';

export interface FeedPage {
  cards: StoryCard[];
  nextCursor: string | null;
  servedFrom: 'redis' | 'mongo';
  cacheControl: string;
}

/**
 * 1. Read the snapshot named in the cursor (or the newest one).
 * 2. If that snapshot expired, continue from the newest one at the same position.
 * 3. If Redis is empty or down, rank straight from MongoDB.
 * We ask for limit + 1 ids: if the extra one exists, there is a next page.
 */
export async function getFeedPage(q: FeedQuery, feeds: FeedStore, stories: StoryStore): Promise<FeedPage> {
  const cursor = q.cursor ? decodeCursor(q.cursor) : { o: 0 };
  const offset = cursor.o;

  try {
    let version = cursor.v ?? (await feeds.currentVersion(q.category));
    let ids = version ? await feeds.ids(q.category, version, offset, q.limit + 1) : null;
    if (ids === null && cursor.v) {
      version = await feeds.currentVersion(q.category); // pinned snapshot expired
      ids = version ? await feeds.ids(q.category, version, offset, q.limit + 1) : null;
    }
    if (ids !== null && version) {
      const cards = await stories.cardsByIds(ids.slice(0, q.limit));
      // A snapshot can outlive its MongoDB stories after retention or a reset.
      // Do not present that stale snapshot as an empty feed while stories exist.
      if (cards.length || ids.length === 0) {
        return {
          cards,
          nextCursor: ids.length > q.limit ? encodeCursor({ v: version, o: offset + q.limit }) : null,
          servedFrom: 'redis',
          cacheControl: q.cursor ? CACHE.laterPage : CACHE.firstPage,
        };
      }
    }
  } catch (err) {
    console.warn(JSON.stringify({ time: new Date().toISOString(), event: 'feed_redis_fallback', errorName: err instanceof Error ? err.name : 'UnknownError' }));
  }

  const docs = await stories.topByScore(q.category, offset, q.limit + 1);
  return {
    cards: docs.slice(0, q.limit),
    nextCursor: docs.length > q.limit ? encodeCursor({ o: offset + q.limit }) : null,
    servedFrom: 'mongo',
    cacheControl: CACHE.fallback,
  };
}
