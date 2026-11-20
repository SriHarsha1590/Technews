import { log } from '@temporalio/activity';
import {
  CATEGORIES,
  FEED_MAX_ITEMS,
  FEED_SNAPSHOT_TTL_SECONDS,
  FEED_WINDOW_HOURS,
  feedCurrentKey,
  feedKey,
  storyScore,
  type FeedName,
  type Story,
} from '@technews/shared';
import { getRedis, stories } from '../db';

/** Re-scores recent stories and publishes a new immutable snapshot of every feed in Redis. */
export async function rebuildFeeds(): Promise<Record<string, number>> {
  const now = new Date();
  const col = await stories();
  const recent = await col
    .find({ publishedAt: { $gte: new Date(now.getTime() - FEED_WINDOW_HOURS * 3_600_000) } })
    .project<Pick<Story, '_id' | 'category' | 'sourceCount' | 'publishedAt'>>({ _id: 1, category: 1, sourceCount: 1, publishedAt: 1 })
    .toArray();

  const scored = recent.map((s) => ({ ...s, score: storyScore(s.sourceCount, s.publishedAt, now) }));

  // Keep Mongo's score fresh too: the API falls back to it if Redis is empty.
  if (scored.length) {
    await col.bulkWrite(scored.map((s) => ({ updateOne: { filter: { _id: s._id }, update: { $set: { score: s.score } } } })));
  }

  const redis = await getRedis();
  const version = now.getTime();
  const counts: Record<string, number> = {};
  const feeds: FeedName[] = ['all', ...CATEGORIES];

  for (const feed of feeds) {
    const members = scored
      .filter((s) => feed === 'all' || s.category === feed)
      .sort((a, b) => b.score - a.score)
      .slice(0, FEED_MAX_ITEMS)
      .map((s) => ({ score: s.score, value: s._id }));
    counts[feed] = members.length;

    const key = feedKey(feed, version);
    const tx = redis.multi();
    if (members.length) tx.zAdd(key, members);
    tx.expire(key, FEED_SNAPSHOT_TTL_SECONDS);
    tx.set(feedCurrentKey(feed), String(version)); // readers switch to the new snapshot atomically
    await tx.exec();
  }

  log.info('feeds rebuilt', { version, counts });
  return counts;
}
