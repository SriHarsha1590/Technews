// Reader data: preferences, bookmarks, reading history and push subscriptions. Behind an interface so routes are tested with a fake.
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoServerError, type MongoClient } from 'mongodb';
import {
  DEFAULT_DIGEST,
  type BookmarkDoc,
  type DigestSettings,
  type HistoryDoc,
  type HistoryEntry,
  type HistoryFilter,
  type Me,
  type MeStats,
  type PushSubscriptionDoc,
  type StoryCard,
  type Story,
  type UserDoc,
} from '@technews/shared';
import { toCard } from './stores';

export interface UserStore {
  me(uid: string): Promise<Me>;
  setStack(uid: string, stack: string[]): Promise<void>;
  setDigest(uid: string, digest: DigestSettings): Promise<void>;
  bookmarkIds(uid: string, max: number): Promise<string[]>;
  /** Saved cards, newest bookmark first. */
  bookmarkPage(uid: string, offset: number, count: number): Promise<StoryCard[]>;
  addBookmark(uid: string, story: StoryCard): Promise<void>;
  removeBookmark(uid: string, storyId: string): Promise<void>;
  /** Adds the story to History, or moves it to the top if it's already there. */
  recordRead(uid: string, story: StoryCard, watched: boolean): Promise<void>;
  /** Ids of stories read since `since`, newest first: the feed hides these. */
  readIds(uid: string, since: Date, max: number): Promise<string[]>;
  /** Newest first: by last read, or by last watched for "watched". */
  historyPage(uid: string, filter: HistoryFilter, offset: number, count: number): Promise<HistoryEntry[]>;
  removeHistory(uid: string, storyId: string): Promise<void>;
  clearHistory(uid: string): Promise<void>;
  stats(uid: string): Promise<MeStats>;
  savePush(uid: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void>;
  removePush(uid: string, endpoint: string): Promise<void>;
}

export const endpointId = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex').slice(0, 32);

export const USER_LIMITS = { bookmarks: 500, history: 2000, subscriptions: 20 } as const;

interface UserLimitLock { _id: string; owner: string; expiresAt: Date }

export function mongoUserStore(client: MongoClient, dbName: string): UserStore {
  const db = client.db(dbName);
  const users = db.collection<UserDoc>('users');
  const bookmarks = db.collection<BookmarkDoc>('bookmarks');
  const pushes = db.collection<PushSubscriptionDoc>('push_subscriptions');
  const history = db.collection<HistoryDoc>('history');
  const limitLocks = db.collection<UserLimitLock>('user_limit_locks');
  const stories = db.collection<Story>('stories');

  async function trimOldest(collection: typeof bookmarks | typeof history | typeof pushes, uid: string, max: number, order: 'createdAt' | 'readAt') {
    for (;;) {
      const excess = await collection.find({ userId: uid }).sort({ [order]: -1, _id: 1 }).skip(max).limit(500).project<{ _id: string }>({ _id: 1 }).toArray();
      if (!excess.length) return;
      await collection.deleteMany({ _id: { $in: excess.map((item) => item._id) }, userId: uid });
    }
  }

  /** Serializes capped writes for one reader across API replicas. An expired lease
   * lets another replica recover if its owner crashed before releasing it. */
  async function withLimitLock<T>(uid: string, work: () => Promise<T>): Promise<T> {
    const owner = randomUUID();
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const now = new Date();
      try {
        const acquired = await limitLocks.findOneAndUpdate(
          { _id: uid, expiresAt: { $lte: now } },
          { $set: { owner, expiresAt: new Date(now.getTime() + 120_000) } },
          { upsert: true, returnDocument: 'after' },
        );
        if (acquired?.owner === owner) {
          try { return await work(); }
          finally { await limitLocks.deleteOne({ _id: uid, owner }); }
        }
      } catch (error) {
        if (!(error instanceof MongoServerError && error.code === 11000)) throw error;
      }
      await delay(25);
    }
    throw new Error('Reader collection limit is busy');
  }

  // Creates the reader's document on first write, with defaults for everything not being set.
  const upsert = (uid: string, set: Partial<UserDoc>) => {
    const now = new Date();
    const defaults: Partial<UserDoc> = { stack: [], digest: { ...DEFAULT_DIGEST }, createdAt: now };
    for (const k of Object.keys(set)) delete defaults[k as keyof UserDoc];
    return users.updateOne({ _id: uid }, { $set: { ...set, updatedAt: now }, $setOnInsert: defaults }, { upsert: true });
  };

  return {
    async me(uid) {
      const u = await users.findOne({ _id: uid });
      return { uid, stack: u?.stack ?? [], digest: u?.digest ?? { ...DEFAULT_DIGEST } };
    },
    async setStack(uid, stack) {
      await upsert(uid, { stack });
    },
    async setDigest(uid, digest) {
      await upsert(uid, { digest });
    },
    async bookmarkIds(uid, max) {
      const docs = await bookmarks.find({ userId: uid }).sort({ createdAt: -1 }).limit(max).project<{ storyId: string }>({ storyId: 1 }).toArray();
      return docs.map((d) => d.storyId);
    },
    async bookmarkPage(uid, offset, count) {
      const docs = await bookmarks
        .find({ userId: uid })
        .sort({ createdAt: -1, _id: 1 })
        .skip(offset)
        .limit(count)
        .toArray();
      const missing = docs.filter((d) => !d.story).map((d) => d.storyId);
      const old = missing.length ? await stories.find({ _id: { $in: missing } }).toArray() : [];
      const byId = new Map(old.map((d) => [d._id, d]));
      return docs.flatMap((d) => {
        if (d.story) return [d.story];
        const s = byId.get(d.storyId);
        return s ? [toCard(s)] : [];
      });
    },
    async addBookmark(uid, story) {
      await withLimitLock(uid, async () => {
        await bookmarks.updateOne(
          { _id: `${uid}:${story.id}` },
          { $setOnInsert: { userId: uid, storyId: story.id, story, createdAt: new Date() } },
          { upsert: true },
        );
        await trimOldest(bookmarks, uid, USER_LIMITS.bookmarks, 'createdAt');
      });
    },
    async removeBookmark(uid, storyId) {
      await bookmarks.deleteOne({ _id: `${uid}:${storyId}` });
    },
    async recordRead(uid, story, watched) {
      await withLimitLock(uid, async () => {
        const now = new Date();
        await history.updateOne(
          { _id: `${uid}:${story.id}` },
          {
            $set: { story, readAt: now, ...(watched ? { watchedAt: now } : {}) },
            $setOnInsert: { userId: uid, storyId: story.id, firstReadAt: now, ...(watched ? {} : { watchedAt: null }) },
          },
          { upsert: true },
        );
        await trimOldest(history, uid, USER_LIMITS.history, 'readAt');
      });
    },
    async readIds(uid, since, max) {
      const docs = await history
        .find({ userId: uid, readAt: { $gte: since } })
        .sort({ readAt: -1 })
        .limit(max)
        .project<{ storyId: string }>({ storyId: 1 })
        .toArray();
      return docs.map((d) => d.storyId);
    },
    async historyPage(uid, filter, offset, count) {
      const docs = await history
        .find(filter === 'watched' ? { userId: uid, watchedAt: { $ne: null } } : { userId: uid })
        .sort(filter === 'watched' ? { watchedAt: -1, _id: 1 } : { readAt: -1, _id: 1 })
        .skip(offset)
        .limit(count)
        .toArray();
      return docs.map((d) => ({ story: d.story, readAt: d.readAt.toISOString(), watchedAt: d.watchedAt?.toISOString() ?? null }));
    },
    async removeHistory(uid, storyId) {
      await history.deleteOne({ _id: `${uid}:${storyId}` });
    },
    async clearHistory(uid) {
      await history.deleteMany({ userId: uid });
    },
    async stats(uid) {
      const [read, watched, saved] = await Promise.all([
        history.countDocuments({ userId: uid }),
        history.countDocuments({ userId: uid, watchedAt: { $ne: null } }),
        bookmarks.countDocuments({ userId: uid }),
      ]);
      return { read, watched, saved };
    },
    async savePush(uid, sub) {
      await withLimitLock(uid, async () => {
        // Same browser re-subscribing (or switching accounts) updates its one record.
        await pushes.updateOne(
          { _id: endpointId(sub.endpoint) },
          { $set: { userId: uid, endpoint: sub.endpoint, keys: sub.keys }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true },
        );
        await trimOldest(pushes, uid, USER_LIMITS.subscriptions, 'createdAt');
      });
    },
    async removePush(uid, endpoint) {
      await pushes.deleteOne({ _id: endpointId(endpoint), userId: uid });
    },
  };
}

export async function ensureUserIndexes(client: MongoClient, dbName: string): Promise<void> {
  const db = client.db(dbName);
  await db.collection('bookmarks').createIndex({ userId: 1, createdAt: -1 });
  await db.collection('push_subscriptions').createIndex({ userId: 1 });
  await db.collection('history').createIndex({ userId: 1, readAt: -1 });
  await db.collection('history').createIndex({ userId: 1, watchedAt: -1 });
  await db.collection('users').createIndex({ 'digest.enabled': 1 });
  await db.collection('user_limit_locks').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('stories').createIndex({ tags: 1, publishedAt: -1 }); // "For you" feed
}
