// Refresh needs sign-in, the rate limit sees the visitor behind a proxy, and counts can be shared between instances.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp, type Deps } from './app';
import { AuthError } from './auth';

const verify = async (token: string) => {
  if (!token.startsWith('good-')) throw new AuthError('bad token', 'unauthorized');
  return { uid: token.slice(5) };
};
const refresher = {
  async start() { return { state: 'running' as const, startedAt: null, finishedAt: null }; },
  async status() { return { state: 'idle' as const, startedAt: null, finishedAt: null }; },
};

async function withApp(extra: Partial<Deps>, run: (base: string) => Promise<void>) {
  const server = createApp({
    feeds: { currentVersion: async () => 1 } as any, stories: {} as any, users: {} as any, verify, assist: {} as any,
    refresher: refresher as any, webOrigins: [], vapidPublicKey: '', ...extra,
  }).listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    await run(`http://localhost:${(server.address() as AddressInfo).port}/api/v1`);
  } finally {
    server.close();
  }
}
const post = (base: string, headers: Record<string, string> = {}) => fetch(`${base}/refresh`, { method: 'POST', headers });

test('admin dashboard requires an explicitly allowlisted authenticated user', async () => {
  await withApp({ refreshAdminUids: ['ann'], stories: { ping: async () => true } as Deps['stories'], feeds: { currentVersion: async () => 1, ping: async () => true, ids: async () => [] } }, async (base) => {
    assert.equal((await fetch(`${base}/me/admin`)).status, 401);
    assert.equal((await fetch(`${base}/me/admin`, { headers: { Authorization: 'Bearer good-bob' } })).status, 403);
    const admin = await fetch(`${base}/me/admin`, { headers: { Authorization: 'Bearer good-ann' } });
    assert.equal(admin.status, 200);
    assert.equal((await admin.json()).data.mongo, true);
    const caps = await fetch(`${base}/me/capabilities`, { headers: { Authorization: 'Bearer good-bob' } });
    assert.deepEqual((await caps.json()).data, { admin: false });
  });
});

test('starting a refresh needs a valid sign-in; checking its status stays public', async () => {
  await withApp({}, async (base) => {
    assert.equal((await post(base)).status, 401);
    assert.equal((await post(base, { Authorization: 'Bearer nope' })).status, 401);
    assert.equal((await post(base, { Authorization: 'Bearer good-ann' })).status, 202);
    assert.equal((await fetch(`${base}/refresh`)).status, 200);
  });
});

test('with an admin list, only those readers can start a refresh', async () => {
  await withApp({ refreshAdminUids: ['ann'] }, async (base) => {
    assert.equal((await post(base, { Authorization: 'Bearer good-bob' })).status, 403);
    assert.equal((await post(base, { Authorization: 'Bearer good-ann' })).status, 202);
  });
});

test('behind a proxy each visitor gets their own rate limit', async () => {
  await withApp({ trustProxy: 1, aiRequestsPerMinute: 1 }, async (base) => {
    const ask = (ip: string) => fetch(`${base}/ask`, { method: 'POST', headers: { 'X-Forwarded-For': ip, 'Content-Type': 'application/json' }, body: '{}' });
    assert.notEqual((await ask('1.1.1.1')).status, 429);
    assert.equal((await ask('1.1.1.1')).status, 429);
    assert.notEqual((await ask('2.2.2.2')).status, 429); // a different visitor is not blocked
  });
});

test('the shared counter decides the limit, and a failing one falls back to per-process counting', async () => {
  const counts = new Map<string, number>();
  await withApp({ aiRequestsPerMinute: 2, sharedCounter: async (key) => {
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    return next;
  } }, async (base) => {
    const ask = () => fetch(`${base}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.notEqual((await ask()).status, 429);
    assert.notEqual((await ask()).status, 429);
    assert.equal((await ask()).status, 429);
  });
  await withApp({ aiRequestsPerMinute: 1, sharedCounter: async () => { throw new Error('redis down'); } }, async (base) => {
    const ask = () => fetch(`${base}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.notEqual((await ask()).status, 429);
    assert.equal((await ask()).status, 429);
  });
});

test('all public routes have a request limit, including refresh status', async () => {
  await withApp({ requestsPerMinute: 1 }, async (base) => {
    assert.equal((await fetch(`${base}/refresh`)).status, 200);
    const blocked = await fetch(`${base}/refresh`);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after') !== null, true);
  });
});

test('metrics expose request and rate-limit counters without request data', async () => {
  await withApp({ requestsPerMinute: 1, trustProxy: 1 }, async (base) => {
    const visitor = { 'X-Forwarded-For': '1.1.1.1' };
    await fetch(`${base}/refresh`, { headers: visitor });
    await fetch(`${base}/refresh`, { headers: visitor });
    const res = await fetch(`${base}/metrics`, { headers: { 'X-Forwarded-For': '2.2.2.2' } });
    assert.equal(res.status, 200);
    const output = await res.text();
    assert.match(output, /technews_api_rate_limit_total\{scope="global"\} 1/);
    assert.match(output, /technews_api_requests_total\{method="GET",status="429"\} 1/);
    assert.doesNotMatch(output, /1\.1\.1\.1/);
  });
});
