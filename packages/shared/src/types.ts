import type { StoryCard } from './api';

export const CATEGORIES = ['ai', 'tools', 'dev', 'cloud', 'security', 'research', 'general'] as const;
export type Category = (typeof CATEGORIES)[number];

// Ordered best-first: a company's own announcement beats press, press beats community reposts.
export const TRUST_TIERS = ['official', 'press', 'community'] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

export interface Source {
  id: string;
  name: string;
  url: string; // RSS/Atom feed URL
  category: Category;
  trustTier: TrustTier;
  /** Official sources only: sites this company owns. Links to these count as official. */
  ownDomains?: string[];
  /** Reposts other sites' links (Hacker News, Show HN): its author field is the poster, not the writer. */
  aggregator?: boolean;
}

/** Ordered by how directly they let someone try the product: the first one becomes the main option. */
export const TRY_LINK_TYPES = ['playground', 'download', 'repo', 'docs'] as const;
export type TryLinkType = (typeof TRY_LINK_TYPES)[number];

/** A verified place to try the story's product. Never written by the AI: always copied from a source page. */
export interface TryLink {
  type: TryLinkType;
  url: string;
  domain: string; // shown to readers: "Opens platform.openai.com"
  label: string; // the link text on the source page
  checkedAt: Date; // last time code confirmed it works and is official
}

export type ArticleStatus = 'new' | 'summarized' | 'skipped';

/** One link from one source. Several articles can belong to one story. */
export interface Article {
  _id: string; // hash of the canonical URL
  url: string;
  title: string;
  snippet: string; // max 1500 chars, never the full article
  imageUrl?: string | null; // the feed's own picture for this item
  author?: string | null; // byline from the feed; null for aggregators
  sourceId: string;
  sourceName: string;
  category: Category;
  trustTier: TrustTier;
  publishedAt: Date | null;
  fetchedAt: Date;
  status: ArticleStatus;
  summaryAttempts: number;
  storyId?: string;
}

export interface StorySource {
  name: string;
  url: string;
  trustTier: TrustTier;
}

/** What users see: one card per real-world event, however many sites covered it. */
export interface Story {
  _id: string; // id of the first primary article, so re-saving is idempotent
  title: string;
  summary: string; // 80-150 words
  tags: string[];
  category: Category;
  primaryUrl: string; // where the headline links: best trust tier, then earliest
  primarySource: StorySource;
  imageUrl?: string | null; // card picture: from the feed, else the article page's og:image
  imageCheckedAt?: Date; // set once the article page has been searched for an image
  author?: string | null; // the primary article's byline
  sources: StorySource[];
  articleIds: string[];
  sourceCount: number;
  matchTitles: string[]; // original headlines, used to attach later coverage of the same event
  score: number;
  publishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  tryLinks?: TryLink[];
  tryCheckedAt?: Date; // set once the story's sources have been searched for try links
  explainer?: { imageUrl: string | null; scenes: { caption: string; narration: string }[]; createdAt: Date }; // Watch, made on first view
  tryGuide?: { steps: string[]; createdAt: Date }; // Try it steps, made on first view
}

// ---------- Accounts (server-side documents) ----------

export interface DigestSettings {
  enabled: boolean;
  hour: number; // 0-23, in the reader's own time zone
  timeZone: string; // IANA name, e.g. "Asia/Kolkata"
}

/** One reader. _id is the Firebase uid; we store preferences only, no name or email. */
export interface UserDoc {
  _id: string;
  stack: string[]; // technologies the reader follows, matched against story tags
  digest: DigestSettings;
  lastDigestOn?: string; // "YYYY-MM-DD" in the reader's time zone, so nobody gets two in a day
  createdAt: Date;
  updatedAt: Date;
}

export interface BookmarkDoc {
  _id: string; // `${userId}:${storyId}`: saving twice can't create a duplicate
  userId: string;
  storyId: string;
  story?: StoryCard; // saved snapshot survives story retention; absent for pre-migration records
  createdAt: Date;
}

/** One story a reader opened. Keeps a copy of the card, so History still shows it after the story is deleted. */
export interface HistoryDoc {
  _id: string; // `${userId}:${storyId}`: reading twice updates one entry
  userId: string;
  storyId: string;
  story: StoryCard;
  firstReadAt: Date;
  readAt: Date; // last time it was opened
  watchedAt: Date | null; // last time Watch was played
}

/** A browser's Web Push subscription. Removed when the push service says it no longer exists. */
export interface PushSubscriptionDoc {
  _id: string; // hash of the endpoint
  userId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: Date;
}
