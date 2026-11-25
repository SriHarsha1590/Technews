import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLink } from './check';

const onOpenAI = (u: URL) => u.hostname === 'openai.com' || u.hostname === 'platform.openai.com';
const status = (code: number, finalUrl: string) => async () => ({ status: code, finalUrl });

test('a successful exact page passes', async () => {
  assert.deepEqual(await checkLink('https://openai.com/try', onOpenAI, status(200, 'https://openai.com/try')),
    { ok: true, finalUrl: 'https://openai.com/try' });
});

test('a successful redirect within the allowed site passes', async () => {
  assert.deepEqual(await checkLink('https://openai.com/try', onOpenAI, status(200, 'https://platform.openai.com/playground')),
    { ok: true, finalUrl: 'https://platform.openai.com/playground' });
});

test('a redirect outside the trust policy fails', async () => {
  const result = await checkLink('https://openai.com/try', onOpenAI, status(200, 'https://evil.example/download'));
  assert.equal(result.ok, false);
});

test('authentication and rate-limit responses do not count as verified', async () => {
  for (const code of [401, 403, 429, 404, 500]) {
    const result = await checkLink('https://openai.com/try', onOpenAI, status(code, 'https://openai.com/try'));
    assert.deepEqual(result, { ok: false, reason: `HTTP ${code}` });
  }
});

test('unsafe network destinations fail closed', async () => {
  assert.equal((await checkLink('https://openai.com/try', onOpenAI, async () => null)).ok, false);
  assert.equal((await checkLink('https://evil.example/try', onOpenAI, status(200, 'https://evil.example/try'))).ok, false);
});
