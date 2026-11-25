import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { CONTENT_RETENTION_INDEXES, type StoryCard } from '@technews/shared';
import { ensureContentRetentionIndexes } from '../src/stores';
import { ensureUserIndexes, mongoUserStore, USER_LIMITS } from '../src/users';

// Run explicitly with `npm run test:integration -w @technews/api` against a real mongod.
const client = new MongoClient(process.env.MONGO_TEST_URL ?? 'mongodb://127.0.0.1:27017', {
  serverSelectionTimeoutMS: 5_000,
});
const dbName = `technews_integration_${randomUUID().replaceAll('-', '')}`;
const db = client.db(dbName);
const store = mongoUserStore(client, dbName);
const older = new Date('2025-01-01T00:00:00.000Z');

const card = (n: number): StoryCard => ({
  id: n.toString(16).padStart(24, '0'),
  title: `Story ${n}`,
  summary: 'Saved summary',
  tags: ['test'],
  category: 'dev',
  primaryUrl: `https://example.com/${n}`,
  primarySource: { name: 'Example', url: 'https://example.com', trustTier: 'official' },
  imageUrl: null,
  author: null,
  sourceCount: 1,
  publishedAt: '2025-01-01T00:00:00.000Z',
  tryLinks: [],
});

before(async () => {
  await client.connect();
  await Promise.all([ensureUserIndexes(client, dbName), ensureContentRetentionIndexes(client, dbName)]);
});
after(async () => {
  await db.dropDatabase().catch(() => {});
  await client.close();
});

test('concurrent writes retain each reader’s newest bookmarks, history and push subscriptions within caps', async () => {
  const readers = ['alice', 'bob'];
  for (const uid of readers) {
    await Promise.all([
      db.collection('bookmarks').insertMany(Array.from({ length: USER_LIMITS.bookmarks - 1 }, (_, n) => ({
        _id: `${uid}:${card(n).id}`, userId: uid, storyId: card(n).id, story: card(n), createdAt: older,
      }))),
      db.collection('history').insertMany(Array.from({ length: USER_LIMITS.history - 1 }, (_, n) => ({
        _id: `${uid}:${card(n).id}`, userId: uid, storyId: card(n).id, story: card(n),
        firstReadAt: older, readAt: older, watchedAt: null,
      }))),
      db.collection('push_subscriptions').insertMany(Array.from({ length: USER_LIMITS.subscriptions - 1 }, (_, n) => ({
        _id: `${uid}-old-${n}`, userId: uid, endpoint: `https://fcm.googleapis.com/fcm/send/old-${uid}-${n}`,
        keys: { p256dh: 'p', auth: 'a' }, createdAt: older,
      }))),
    ]);
  }

  const newCards = Array.from({ length: 24 }, (_, n) => card(10_000 + n));
  const endpoints = Array.from({ length: 12 }, (_, n) => `https://fcm.googleapis.com/fcm/send/new-${n}`);
  await Promise.all(readers.flatMap((uid) => [
    ...newCards.map((story) => store.addBookmark(uid, story)),
    ...newCards.map((story) => store.recordRead(uid, story, false)),
    ...endpoints.map((endpoint) => store.savePush(uid, { endpoint: `${endpoint}-${uid}`, keys: { p256dh: 'p', auth: 'a' } })),
  ]));

  for (const uid of readers) {
    assert.deepEqual(await store.stats(uid), {
      saved: USER_LIMITS.bookmarks,
      read: USER_LIMITS.history,
      watched: 0,
    });
    assert.equal(await db.collection('push_subscriptions').countDocuments({ userId: uid }), USER_LIMITS.subscriptions);
    for (const story of newCards) {
      assert.ok((await store.bookmarkIds(uid, USER_LIMITS.bookmarks)).includes(story.id));
      assert.ok((await store.readIds(uid, older, USER_LIMITS.history)).includes(story.id));
    }
    for (const endpoint of endpoints) {
      assert.ok(await db.collection('push_subscriptions').findOne({ userId: uid, endpoint: `${endpoint}-${uid}` }));
    }
  }
});

test('bookmarked card survives source story deletion', async () => {
  const story = card(30_000);
  await db.collection('stories').insertOne({ _id: story.id, ...story });
  await store.addBookmark('snapshot-reader', story);
  await db.collection('stories').deleteOne({ _id: story.id });
  assert.deepEqual(await store.bookmarkPage('snapshot-reader', 0, 1), [story]);
});

test('only content collections have insertion-time TTL indexes', async () => {
  for (const [collection, expected] of [
    ['articles', CONTENT_RETENTION_INDEXES.articles],
    ['stories', CONTENT_RETENTION_INDEXES.stories],
  ] as const) {
    const indexes = await db.collection(collection).indexes();
    const actual = indexes.find((index) => index.name === expected.name);
    assert.deepEqual(actual?.key, expected.key);
    assert.equal(actual?.expireAfterSeconds, expected.expireAfterSeconds);
  }
  for (const collection of ['users', 'bookmarks', 'history', 'push_subscriptions']) {
    assert.ok((await db.collection(collection).indexes()).every((index) => index.expireAfterSeconds === undefined));
  }
});
