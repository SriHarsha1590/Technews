// Data access behind small interfaces, so routes can be tested with in-memory fakes.
import { MongoClient, type Collection } from 'mongodb';
import type { RedisClientType } from 'redis';
import { feedCurrentKey, feedKey, RETENTION_DAYS, type FeedName, type PopularTag, type Story, type StoryCard, type StoryDetail } from '@technews/shared';

export interface FeedStore {
  currentVersion(feed: FeedName): Promise<number | null>;
  /** Ids in rank order, or null if that snapshot no longer exists. */
  ids(feed: FeedName, version: number, offset: number, count: number): Promise<string[] | null>;
  ping(): Promise<boolean>;
}

export interface StoryStore {
  /** Cards in the same order as `ids`; ids with no story are skipped. */
  cardsByIds(ids: string[]): Promise<StoryCard[]>;
  /** Used when Redis has nothing: rank by the score the worker saved in Mongo. */
  topByScore(feed: FeedName, offset: number, count: number): Promise<StoryCard[]>;
  detail(id: string): Promise<StoryDetail | null>;
  /** "For you": stories tagged with any of `tags`, newest first. */
  byTags(tags: string[], since: Date, offset: number, count: number): Promise<StoryCard[]>;
  /** Most used tags since `since`, for the "My stack" picker. */
  popularTags(since: Date, limit: number): Promise<PopularTag[]>;
  ping(): Promise<boolean>;
}

const CARD_FIELDS = {
  _id: 1, title: 1, summary: 1, tags: 1, category: 1, primaryUrl: 1, primarySource: 1, imageUrl: 1, author: 1, sourceCount: 1, publishedAt: 1,
  tryLinks: 1,
} as const;

type CardDoc = Pick<Story, keyof typeof CARD_FIELDS>;

export function toCard(s: CardDoc): StoryCard {
  return {
    id: s._id,
    title: s.title,
    summary: s.summary,
    tags: s.tags,
    category: s.category,
    primaryUrl: s.primaryUrl,
    primarySource: s.primarySource,
    imageUrl: s.imageUrl ?? null,
    author: s.author ?? null,
    sourceCount: s.sourceCount,
    publishedAt: new Date(s.publishedAt).toISOString(),
    // Only what the button needs; the link text and internal fields stay on the server.
    tryLinks: (s.tryLinks ?? []).map((l) => ({ type: l.type, url: l.url, domain: l.domain, checkedAt: new Date(l.checkedAt).toISOString() })),
  };
}

export function mongoStoryStore(client: MongoClient, dbName: string): StoryStore {
  const col: Collection<Story> = client.db(dbName).collection<Story>('stories');
  return {
    async cardsByIds(ids) {
      if (!ids.length) return [];
      const docs = await col.find({ _id: { $in: ids } }).project<CardDoc>(CARD_FIELDS).toArray();
      const byId = new Map(docs.map((d) => [d._id, d])); // $in does not keep order
      return ids.flatMap((id) => {
        const d = byId.get(id);
        return d ? [toCard(d)] : [];
      });
    },
    async topByScore(feed, offset, count) {
      const filter = feed === 'all' ? {} : { category: feed };
      const docs = await col.find(filter).sort({ score: -1, _id: 1 }).skip(offset).limit(count).project<CardDoc>(CARD_FIELDS).toArray();
      return docs.map(toCard);
    },
    async byTags(tags, since, offset, count) {
      if (!tags.length) return [];
      const docs = await col
        .find({ tags: { $in: tags }, publishedAt: { $gte: since } })
        .sort({ publishedAt: -1, _id: 1 })
        .skip(offset)
        .limit(count)
        .project<CardDoc>(CARD_FIELDS)
        .toArray();
      return docs.map(toCard);
    },
    async popularTags(since, limit) {
      return col
        .aggregate<PopularTag>([
          { $match: { publishedAt: { $gte: since } } },
          { $unwind: '$tags' },
          { $group: { _id: '$tags', count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: limit },
          { $project: { _id: 0, tag: '$_id', count: 1 } },
        ])
        .toArray();
    },
    async detail(id) {
      const d = await col.findOne({ _id: id }, { projection: { ...CARD_FIELDS, sources: 1 } });
      return d ? { ...toCard(d), sources: d.sources } : null;
    },
    async ping() {
      try {
        await client.db(dbName).command({ ping: 1 });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** A card plus whatever Watch and Try it already generated for it. */
export type AiStory = StoryCard & Pick<Story, 'explainer' | 'tryGuide'>;

/** What Watch, Try it steps and Ask read and save. */
export interface AssistStore {
  story(id: string): Promise<AiStory | null>;
  /** Same order as `ids`; ids with no story are skipped. */
  stories(ids: string[]): Promise<AiStory[]>;
  /** This week's stories that best match `query`, skipping `exclude` (already in the prompt). */
  search(query: string, limit: number, exclude: string[]): Promise<AiStory[]>;
  saveExplainer(id: string, explainer: NonNullable<Story['explainer']>): Promise<void>;
  saveTryGuide(id: string, tryGuide: NonNullable<Story['tryGuide']>): Promise<void>;
}

/** Ask searches the whole week's news, not just the cards on screen. Safe to call on every start. */
export async function ensureStoryTextIndex(client: MongoClient, dbName: string): Promise<void> {
  await client
    .db(dbName)
    .collection('stories')
    .createIndex({ title: 'text', matchTitles: 'text', tags: 'text', summary: 'text' }, {
      name: 'story_text',
      weights: { title: 5, matchTitles: 3, tags: 3, summary: 1 },
    });
}

export function mongoAssistStore(client: MongoClient, dbName: string): AssistStore {
  const col: Collection<Story> = client.db(dbName).collection<Story>('stories');
  const fields = { ...CARD_FIELDS, explainer: 1, tryGuide: 1 } as const;
  type Doc = CardDoc & Pick<Story, 'explainer' | 'tryGuide'>;
  const toAiStory = (d: Doc): AiStory => ({ ...toCard(d), explainer: d.explainer, tryGuide: d.tryGuide });
  return {
    async story(id) {
      const d = await col.findOne({ _id: id }, { projection: fields });
      return d ? toAiStory(d as Doc) : null;
    },
    async stories(ids) {
      if (!ids.length) return [];
      const docs = await col.find({ _id: { $in: ids } }).project<Doc>(fields).toArray();
      const byId = new Map(docs.map((d) => [d._id, d]));
      return ids.flatMap((id) => {
        const d = byId.get(id);
        return d ? [toAiStory(d)] : [];
      });
    },
    async search(query, limit, exclude) {
      if (!query.trim()) return [];
      const since = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
      const docs = await col
        .find({ $text: { $search: query.slice(0, 500) }, publishedAt: { $gte: since }, _id: { $nin: exclude } })
        .project<Doc>({ ...fields, score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .toArray();
      return docs.map(toAiStory);
    },
    async saveExplainer(id, explainer) {
      await col.updateOne({ _id: id }, { $set: { explainer } });
    },
    async saveTryGuide(id, tryGuide) {
      await col.updateOne({ _id: id }, { $set: { tryGuide } });
    },
  };
}

export function redisFeedStore(redis: Pick<RedisClientType, "get" | "exists" | "zRange" | "ping">): FeedStore {
  return {
    async currentVersion(feed) {
      const v = await redis.get(feedCurrentKey(feed));
      return v ? Number(v) : null;
    },
    async ids(feed, version, offset, count) {
      const key = feedKey(feed, version);
      const [exists, ids] = await Promise.all([redis.exists(key), redis.zRange(key, offset, offset + count - 1, { REV: true })]);
      return exists ? ids : null;
    },
    async ping() {
      try {
        return (await redis.ping()) === 'PONG';
      } catch {
        return false;
      }
    },
  };
}
