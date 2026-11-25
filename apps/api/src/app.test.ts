import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { FeedName, StoryCard, StoryDetail, FeedResponse } from '@technews/shared';
import { createApp } from './app';
import { toCard, type FeedStore, type StoryStore } from './stores';

// ---- in-memory fakes ----
const id = (n: number) => n.toString(16).padStart(24, '0');
const card = (n: number, category: StoryCard['category'] = 'ai'): StoryDetail => ({
  id: id(n), title: `Story ${n}`, summary: 'summary', tags: ['t'], category, primaryUrl: `https://example.com/${n}`,
  primarySource: { name: 'Ex', url: `https://example.com/${n}`, trustTier: 'official' }, imageUrl: null, author: null, sourceCount: 1,
  publishedAt: '2026-10-19T00:00:00.000Z', sources: [], tryLinks: [],
});
const all = Array.from({ length: 5 }, (_, i) => card(i + 1, i < 3 ? 'ai' : 'dev'));

let snapshots: Map<string, string[]>; // "feed:version" -> ranked ids
let current: Map<FeedName, number>;
let redisDown = false;

const feeds: FeedStore = {
  async currentVersion(feed) {
    if (redisDown) throw new Error('redis down');
    return current.get(feed) ?? null;
  },
  async ids(feed, version, offset, count) {
    const list = snapshots.get(`${feed}:${version}`);
    return list ? list.slice(offset, offset + count) : null;
  },
  async ping() { return !redisDown; },
};
const stories: StoryStore = {
  async cardsByIds(ids) { return ids.flatMap((i) => all.filter((s) => s.id === i)); },
  async topByScore(feed, offset, count) { return all.filter((s) => feed === 'all' || s.category === feed).slice(offset, offset + count); },
  async detail(i) { return all.find((s) => s.id === i) ?? null; },
  async byTags() { return []; },
  async popularTags() { return []; },
  async ping() { return true; },
};

function reset() {
  redisDown = false;
  // Redis ranks story 3 first: proves we keep Redis order, not Mongo order.
  snapshots = new Map([['all:100', [id(3), id(1), id(2), id(4), id(5)]], ['ai:100', [id(3), id(1), id(2)]]]);
  current = new Map([['all', 100], ['ai', 100]]);
}

let server: Server;
let base: string;
before(async () => {
  server = createApp({
    feeds, stories, webOrigins: ['http://localhost:5173'], vapidPublicKey: '',
    users: {} as any, verify: async () => { throw new Error('not used'); }, assist: {} as any, refresher: {} as any,
  }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api/v1`;
});
after(() => server.close());

const get = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, headers: res.headers, body: (await res.json()) as any };
};

test('feed returns cards in Redis rank order with a next cursor', async () => {
  reset();
  const r = await get('/feed?limit=2');
  assert.equal(r.status, 200);
  const body = r.body as FeedResponse;
  assert.deepEqual(body.data.map((c) => c.title), ['Story 3', 'Story 1']);
  assert.equal(body.meta.servedFrom, 'redis');
  assert.ok(body.meta.nextCursor);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=120');
});

test('page 2 stays on the same snapshot even after a new one is published', async () => {
  reset();
  const first = await get('/feed?limit=2');
  snapshots.set('all:200', [id(5), id(4), id(3), id(2), id(1)]);
  current.set('all', 200);
  const second = await get(`/feed?limit=2&cursor=${first.body.meta.nextCursor}`);
  assert.deepEqual(second.body.data.map((c: StoryCard) => c.title), ['Story 2', 'Story 4']);
  assert.equal(second.headers.get('cache-control'), 'public, max-age=600');
});

test('last page has no next cursor', async () => {
  reset();
  const r = await get('/feed?category=ai&limit=3');
  assert.equal(r.body.data.length, 3);
  assert.equal(r.body.meta.nextCursor, null);
});

test('expired snapshot continues from the newest one', async () => {
  reset();
  const first = await get('/feed?limit=2');
  snapshots.delete('all:100');
  snapshots.set('all:200', [id(5), id(4), id(3), id(2), id(1)]);
  current.set('all', 200);
  const second = await get(`/feed?limit=2&cursor=${first.body.meta.nextCursor}`);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.data.map((c: StoryCard) => c.title), ['Story 3', 'Story 2']);
});

test('falls back to MongoDB when Redis is down', async () => {
  reset();
  redisDown = true;
  const r = await get('/feed?category=dev');
  assert.equal(r.status, 200);
  assert.equal(r.body.meta.servedFrom, 'mongo');
  assert.deepEqual(r.body.data.map((c: StoryCard) => c.category), ['dev', 'dev']);
  const health = await get('/health');
  assert.equal(health.body.status, 'degraded');
});

test('stale Redis snapshot does not hide stories still present in MongoDB', async () => {
  reset();
  snapshots.set('all:100', [id(99)]);
  const r = await get('/feed?limit=2');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.map((c: StoryCard) => c.title), ['Story 1', 'Story 2']);
  assert.equal(r.body.meta.servedFrom, 'mongo');
});

test('rejects bad input with a clear error', async () => {
  reset();
  const badCategory = await get('/feed?category=sports');
  assert.equal(badCategory.status, 400);
  assert.equal(badCategory.body.error.code, 'validation_error');
  assert.equal(badCategory.body.error.details[0].field, 'category');

  const badCursor = await get('/feed?cursor=not-a-cursor');
  assert.equal(badCursor.body.error.code, 'bad_cursor');

  const badLimit = await get('/feed?limit=500');
  assert.equal(badLimit.status, 400);
});

test('story detail: found, not found, malformed id', async () => {
  reset();
  assert.equal((await get(`/stories/${id(1)}`)).body.data.title, 'Story 1');
  assert.equal((await get(`/stories/${id(99)}`)).status, 404);
  assert.equal((await get('/stories/abc')).status, 400);
  assert.equal((await get('/nope')).status, 404);
});

test('only the web app origin gets CORS access', async () => {
  reset();
  const ok = await fetch(`${base}/feed`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const other = await fetch(`${base}/feed`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('toCard exposes verified try links with ISO dates and no internal fields', async () => {
  const c = toCard({
    _id: id(1), title: 't', summary: 's', tags: [], category: 'ai', primaryUrl: 'https://x.com',
    primarySource: { name: 'X', url: 'https://x.com', trustTier: 'official' }, sourceCount: 1, publishedAt: new Date('2026-10-20T00:00:00Z'),
    tryLinks: [{ type: 'playground', url: 'https://platform.openai.com/playground', domain: 'platform.openai.com', label: 'Playground', checkedAt: new Date('2026-10-21T00:00:00Z') }],
  });
  assert.deepEqual(c.tryLinks, [{ type: 'playground', url: 'https://platform.openai.com/playground', domain: 'platform.openai.com', checkedAt: '2026-10-21T00:00:00.000Z' }]);
  const old = toCard({ ...c, _id: id(2), publishedAt: new Date(), tryLinks: undefined } as any);
  assert.deepEqual(old.tryLinks, []); // stories saved before this milestone
});
