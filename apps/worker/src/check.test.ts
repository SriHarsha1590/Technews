import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLink } from './check';

// Fake fetch: a map of URL -> [status, location?]
function fakeFetch(routes: Record<string, [number, string?]>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const [status, location] = routes[input.toString()] ?? [404];
    return new Response(null, { status, headers: location ? { location } : {} });
  }) as typeof fetch;
}
const onOpenAI = (u: URL) => u.hostname.endsWith('openai.com');

test('a working page passes', async () => {
  const r = await checkLink('https://platform.openai.com/playground', onOpenAI, fakeFetch({ 'https://platform.openai.com/playground': [200] }));
  assert.equal(r.ok, true);
});

test('redirects are followed while they stay on the allowed site', async () => {
  const r = await checkLink('https://openai.com/try', onOpenAI, fakeFetch({
    'https://openai.com/try': [301, 'https://platform.openai.com/playground'],
    'https://platform.openai.com/playground': [200],
  }));
  assert.deepEqual(r, { ok: true, finalUrl: 'https://platform.openai.com/playground' });
});

test('a redirect to another site is rejected', async () => {
  const r = await checkLink('https://openai.com/get', onOpenAI, fakeFetch({ 'https://openai.com/get': [302, 'https://cheap-downloads.example/astra.exe'] }));
  assert.equal(r.ok, false);
  assert.match(r.reason!, /off the official site/);
});

test('dead pages fail, bot-blocked pages still count as existing', async () => {
  const f = fakeFetch({ 'https://openai.com/gone': [404], 'https://openai.com/blocked': [403] });
  assert.equal((await checkLink('https://openai.com/gone', onOpenAI, f)).ok, false);
  assert.equal((await checkLink('https://openai.com/blocked', onOpenAI, f)).ok, true);
});
