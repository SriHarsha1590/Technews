// The contract between the API and the web app. Both import these, so they can't drift apart.
import { z } from 'zod';
import type { Category, StorySource, TryLinkType } from './types';
import type { ExplainerScene } from './ai';
import { FEED_NAMES } from './feed';

export const FeedQuery = z.object({
  category: z.enum(FEED_NAMES).default('all'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type FeedQuery = z.infer<typeof FeedQuery>;

export const StoryIdParam = z.string().regex(/^[a-f0-9]{24}$/, 'must be a 24-character story id');

export interface TryLinkView {
  type: TryLinkType;
  url: string;
  domain: string;
  checkedAt: string; // ISO date
}

/** What a card in the feed needs, and nothing more. */
export interface StoryCard {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  category: Category;
  primaryUrl: string;
  primarySource: StorySource;
  imageUrl: string | null;
  author: string | null; // null: the card shows the publication instead
  sourceCount: number;
  publishedAt: string; // ISO date
  tryLinks: TryLinkView[]; // empty: nothing verified to try yet
}

/** Full story page: the card plus every source that covered it. */
export interface StoryDetail extends StoryCard {
  sources: StorySource[];
}

export interface FeedResponse {
  data: StoryCard[];
  meta: { nextCursor: string | null; servedFrom: 'redis' | 'mongo' };
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: { field: string; message: string }[] };
}

// ---------- Watch, Try it steps, Ask ----------

export interface ExplainerView {
  storyId: string;
  imageUrl: string | null;
  scenes: ExplainerScene[];
  seconds: number; // estimated narration length
}

export interface TryGuideView {
  storyId: string;
  steps: string[];
}

export const AskRequest = z.object({
  question: z.string().trim().min(2).max(500),
  storyIds: z.array(StoryIdParam).max(100), // the cards loaded in the reader's feed
  focusId: StoryIdParam.optional(), // the card Ask was opened from
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2500) }))
    .max(8)
    .default([]),
});
export type AskRequest = z.infer<typeof AskRequest>;

/** A story the answer used: enough to show and open it even if it isn't loaded in the feed. */
export interface CitedStory {
  id: string;
  title: string;
  primaryUrl: string;
  sourceName: string;
}

export interface AskResponse {
  answer: string;
  storyIds: string[];
  stories: CitedStory[];
}

// ---------- Refresh ----------

export interface RefreshStatus {
  state: 'idle' | 'running' | 'completed' | 'failed';
  startedAt: string | null;
  finishedAt: string | null;
  feedVersion: number | null; // changes each time the worker publishes new cards
}

// ---------- Accounts ----------

export const DEFAULT_DIGEST = { enabled: false, hour: 8, timeZone: 'UTC' } as const;

const Tag = z.string().trim().toLowerCase().min(1).max(40);

export const StackUpdate = z.object({
  stack: z.array(Tag).max(20).transform((tags) => [...new Set(tags)]),
});

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const DigestUpdate = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  timeZone: z.string().max(64).refine(isTimeZone, 'must be a valid IANA time zone'),
});

export const PushSubscriptionBody = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'must be https'),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export const PageQuery = z.object({
  cursor: z.string().regex(/^\d{1,5}$/, 'cursor must be a number').optional(),
});

export interface Me {
  uid: string;
  stack: string[];
  digest: { enabled: boolean; hour: number; timeZone: string };
}

/** A simple page of cards: "For you" and "Saved" use this. */
export interface StoryPage {
  data: StoryCard[];
  meta: { nextCursor: string | null };
}

export const HistoryQuery = PageQuery.extend({
  filter: z.enum(['all', 'watched']).default('all'),
});
export type HistoryFilter = z.infer<typeof HistoryQuery>['filter'];

export const HistoryUpdate = z.object({
  watched: z.boolean().default(false), // true: Watch was played, not just the card read
});

/** A story in the reader's History, with when they read and watched it. */
export interface HistoryEntry {
  story: StoryCard;
  readAt: string; // ISO date
  watchedAt: string | null;
}

export interface HistoryPage {
  data: HistoryEntry[];
  meta: { nextCursor: string | null };
}

/** Counts on the Profile page. */
export interface MeStats {
  read: number;
  watched: number;
  saved: number;
}

export interface PopularTag {
  tag: string;
  count: number;
}
