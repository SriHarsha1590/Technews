// Signed-in routes, with a fake token checker and in-memory stores.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { DEFAULT_DIGEST, type DigestSettings, type HistoryEntry, type StoryCard } from '@technews/shared';
import { createApp } from './app';
import { AuthError } from './auth';
import type { StoryStore } from './stores';
import type { UserStore } from './users';

const id = (n: number) => n.toString(16).padStart(24, '0');
const card = (n: number, tags: string[]): StoryCard => ({
  id: id(n), title: `Story ${n}`, summary: 's', tags, category: 'dev', primaryUrl: 'https://example.com',
  primarySource: { name: 'X', url: 'https://example.com', trustTier: 'official' }, imageUrl: null, author: null, sourceCount: 1,
  publishedAt: new Date(Date.now() - n * 3_600_000).toISOString(), tryLinks: [],
});
const all = [card(1, ['react']), card(2, ['node.js']), card(3, ['react', 'vite'])];

// ---- fakes ----
let stacks: Map<string, string[]>;
let digests: Map<string, DigestSettings>;
let saved: Map<string, string[]>; // uid -> storyIds, newest first
let pushes: Map<string, string>; // endpoint -> uid
let read: Map<string, HistoryEntry[]>; // uid -> entries, newest read first

const users: UserStore = {
  async me(uid) { return { uid, stack: stacks.get(uid) ?? [], digest: digests.get(uid) ?? { ...DEFAULT_DIGEST } }; },
  async setStack(uid, stack) { stacks.set(uid, stack); },
  async setDigest(uid, d) { digests.set(uid, d); },
  async bookmarkIds(uid) { return saved.get(uid) ?? []; },
  async bookmarkPage(uid, offset, count) { return (saved.get(uid) ?? []).slice(offset, offset + count); },
  async addBookmark(uid, storyId) {
    const list = saved.get(uid) ?? [];
    if (!list.includes(storyId)) saved.set(uid, [storyId, ...list]);
  },
  async removeBookmark(uid, storyId) { saved.set(uid, (saved.get(uid) ?? []).filter((s) => s !== storyId)); },
  async recordRead(uid, story, watched) {
    const now = new Date().toISOString();
    const list = read.get(uid) ?? [];
    const old = list.find((e) => e.story.id === story.id);
    read.set(uid, [{ story, readAt: now, watchedAt: watched ? now : old?.watchedAt ?? null }, ...list.filter((e) => e !== old)]);
  },
  async readIds(uid, since, max) { return (read.get(uid) ?? []).filter((e) => new Date(e.readAt) >= since).slice(0, max).map((e) => e.story.id); },
  async historyPage(uid, filter, offset, count) {
    return (read.get(uid) ?? []).filter((e) => filter === 'all' || e.watchedAt).slice(offset, offset + count);
  },
  async removeHistory(uid, storyId) { read.set(uid, (read.get(uid) ?? []).filter((e) => e.story.id !== storyId)); },
  async clearHistory(uid) { read.delete(uid); },
  async stats(uid) {
    const list = read.get(uid) ?? [];
    return { read: list.length, watched: list.filter((e) => e.watchedAt).length, saved: (saved.get(uid) ?? []).length };
  },
  async savePush(uid, sub) { pushes.set(sub.endpoint, uid); },
  async removePush(uid, endpoint) { if (pushes.get(endpoint) === uid) pushes.delete(endpoint); },
};
const stories: StoryStore = {
  async cardsByIds(ids) { return ids.flatMap((i) => all.filter((s) => s.id === i)); },
  async topByScore() { return []; },
  async detail() { return null; },
  async byTags(tags, _since, offset, count) { return all.filter((s) => s.tags.some((t) => tags.includes(t))).slice(offset, offset + count); },
  async popularTags() { return [{ tag: 'react', count: 2 }, { tag: 'vite', count: 1 }]; },
  async ping() { return true; },
};
// Token "good-<uid>" is valid for <uid>; anything else is rejected, like an expired Firebase token.
const verify = async (token: string) => {
  if (!token.startsWith('good-')) throw new AuthError('Your sign-in has expired or is invalid; sign in again', 'unauthorized');
  return { uid: token.slice(5) };
};

let server: Server;
let base: string;
before(async () => {
  server = createApp({ feeds: {} as any, stories, users, verify, assist: {} as any, refresher: {} as any, webOrigins: [], vapidPublicKey: 'PUBKEY' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${(server.address() as AddressInfo).port}/api/v1`;
});
after(() => server.close());
beforeEach(() => {
  stacks = new Map();
  digests = new Map();
  saved = new Map();
  pushes = new Map();
  read = new Map();
});

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

test('every /me route needs a valid token', async () => {
  assert.equal((await call('GET', '/me')).status, 401);
  const bad = await call('GET', '/me', { token: 'expired' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error.code, 'unauthorized');
  const ok = await call('GET', '/me', { token: 'good-u1' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.data, { uid: 'u1', stack: [], digest: DEFAULT_DIGEST });
  assert.equal(ok.headers.get('cache-control'), 'private, no-store'); // never cached by Cloudflare
});

test('stack is cleaned: trimmed, lowercased, de-duplicated, max 20', async () => {
  const r = await call('PUT', '/me/stack', { token: 'good-u1', body: { stack: [' React ', 'react', 'Node.js'] } });
  assert.deepEqual(r.body.data.stack, ['react', 'node.js']);
  const tooMany = await call('PUT', '/me/stack', { token: 'good-u1', body: { stack: Array.from({ length: 21 }, (_, i) => `t${i}`) } });
  assert.equal(tooMany.status, 400);
});

test('"For you" shows stories matching the stack, and nothing for an empty stack', async () => {
  assert.deepEqual((await call('GET', '/me/feed', { token: 'good-u1' })).body.data, []);
  await call('PUT', '/me/stack', { token: 'good-u1', body: { stack: ['vite'] } });
  const r = await call('GET', '/me/feed', { token: 'good-u1' });
  assert.deepEqual(r.body.data.map((c: StoryCard) => c.title), ['Story 3']);
  assert.equal(r.body.meta.nextCursor, null);
});

test('bookmarks: save (twice is fine), list newest first, remove, and they are private to each reader', async () => {
  assert.equal((await call('PUT', `/me/bookmarks/${id(1)}`, { token: 'good-u1' })).status, 204);
  await call('PUT', `/me/bookmarks/${id(1)}`, { token: 'good-u1' });
  await call('PUT', `/me/bookmarks/${id(3)}`, { token: 'good-u1' });

  assert.deepEqual((await call('GET', '/me/bookmarks/ids', { token: 'good-u1' })).body.data, [id(3), id(1)]);
  const listed = await call('GET', '/me/bookmarks', { token: 'good-u1' });
  assert.deepEqual(listed.body.data.map((c: StoryCard) => c.title), ['Story 3', 'Story 1']);
  assert.deepEqual((await call('GET', '/me/bookmarks/ids', { token: 'good-u2' })).body.data, []);

  assert.equal((await call('DELETE', `/me/bookmarks/${id(3)}`, { token: 'good-u1' })).status, 204);
  assert.deepEqual((await call('GET', '/me/bookmarks/ids', { token: 'good-u1' })).body.data, [id(1)]);
});

test('saving an unknown or malformed story id fails clearly', async () => {
  assert.equal((await call('PUT', `/me/bookmarks/${id(99)}`, { token: 'good-u1' })).status, 404);
  assert.equal((await call('PUT', '/me/bookmarks/nope', { token: 'good-u1' })).status, 400);
});

test('history: reading records the story, rereading moves it up, and it is private to each reader', async () => {
  assert.equal((await call('PUT', `/me/history/${id(1)}`, { token: 'good-u1' })).status, 204);
  await call('PUT', `/me/history/${id(3)}`, { token: 'good-u1', body: { watched: true } });
  await call('PUT', `/me/history/${id(1)}`, { token: 'good-u1' });

  assert.deepEqual((await call('GET', '/me/history/ids', { token: 'good-u1' })).body.data, [id(1), id(3)]);
  const all = await call('GET', '/me/history', { token: 'good-u1' });
  assert.deepEqual(all.body.data.map((e: HistoryEntry) => e.story.title), ['Story 1', 'Story 3']);
  assert.equal(all.body.data[0].watchedAt, null);
  const watched = await call('GET', '/me/history?filter=watched', { token: 'good-u1' });
  assert.deepEqual(watched.body.data.map((e: HistoryEntry) => e.story.title), ['Story 3']);
  assert.deepEqual((await call('GET', '/me/history/ids', { token: 'good-u2' })).body.data, []);

  assert.deepEqual((await call('GET', '/me/stats', { token: 'good-u1' })).body.data, { read: 2, watched: 1, saved: 0 });
});

test('history: remove one, clear all, and bad input fails clearly', async () => {
  await call('PUT', `/me/history/${id(1)}`, { token: 'good-u1' });
  await call('PUT', `/me/history/${id(2)}`, { token: 'good-u1' });
  assert.equal((await call('DELETE', `/me/history/${id(1)}`, { token: 'good-u1' })).status, 204);
  assert.deepEqual((await call('GET', '/me/history/ids', { token: 'good-u1' })).body.data, [id(2)]);
  assert.equal((await call('DELETE', '/me/history', { token: 'good-u1' })).status, 204);
  assert.deepEqual((await call('GET', '/me/history/ids', { token: 'good-u1' })).body.data, []);

  assert.equal((await call('PUT', `/me/history/${id(99)}`, { token: 'good-u1' })).status, 404);
  assert.equal((await call('PUT', `/me/history/${id(1)}`, { token: 'good-u1', body: { watched: 'yes' } })).status, 400);
  assert.equal((await call('GET', '/me/history?filter=liked', { token: 'good-u1' })).status, 400);
  assert.equal((await call('GET', '/me/history')).status, 401);
});

test('digest settings validate the hour and time zone', async () => {
  const ok = await call('PUT', '/me/digest', { token: 'good-u1', body: { enabled: true, hour: 8, timeZone: 'Asia/Kolkata' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('PUT', '/me/digest', { token: 'good-u1', body: { enabled: true, hour: 24, timeZone: 'UTC' } })).status, 400);
  assert.equal((await call('PUT', '/me/digest', { token: 'good-u1', body: { enabled: true, hour: 8, timeZone: 'Mars/Base' } })).status, 400);
});

test('push: https subscriptions are stored, others rejected; public key is served', async () => {
  const sub = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p', auth: 'a' } };
  assert.equal((await call('POST', '/me/push', { token: 'good-u1', body: sub })).status, 204);
  assert.equal(pushes.get(sub.endpoint), 'u1');
  assert.equal((await call('POST', '/me/push', { token: 'good-u1', body: { ...sub, endpoint: 'http://push.example.com/x' } })).status, 400);
  assert.equal((await call('DELETE', '/me/push', { token: 'good-u1', body: { endpoint: sub.endpoint } })).status, 204);
  assert.equal(pushes.size, 0);
  assert.equal((await call('GET', '/push/public-key')).body.data.publicKey, 'PUBKEY');
});

test('popular tags are public', async () => {
  const r = await call('GET', '/tags/popular');
  assert.equal(r.body.data[0].tag, 'react');
});

test('broken JSON gets a clear 400', async () => {
  const res = await fetch(`${base}/me/stack`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer good-u1', 'Content-Type': 'application/json' },
    body: '{"stack": [',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'invalid_json');
});
