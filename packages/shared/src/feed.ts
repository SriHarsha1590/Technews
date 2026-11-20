import { CATEGORIES, type Category } from './types';

export const FEED_NAMES = ['all', ...CATEGORIES] as const;
export type FeedName = Category | 'all';

/** Redis key of one immutable feed snapshot. */
export const feedKey = (feed: FeedName, version: number) => `feed:${feed}:v${version}`;
/** Redis key holding the version number of the newest snapshot. */
export const feedCurrentKey = (feed: FeedName) => `feed:${feed}:current`;

export const FEED_MAX_ITEMS = 500;
export const FEED_SNAPSHOT_TTL_SECONDS = 30 * 60;
/** How long articles and stories are kept; older data is deleted by Mongo TTL indexes. */
export const RETENTION_DAYS = 7;
export const FEED_WINDOW_HOURS = RETENTION_DAYS * 24;

/**
 * Hacker-News-style gravity: more sources lift a story, age pulls it down.
 * score = (sources + 1) / (hoursOld + 2)^1.5
 */
export function storyScore(sourceCount: number, publishedAt: Date, now: Date = new Date()): number {
  const hours = Math.max(0, (now.getTime() - publishedAt.getTime()) / 3_600_000);
  return (sourceCount + 1) / Math.pow(hours + 2, 1.5);
}
