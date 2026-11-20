import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StorySummary, wordCount, storyScore } from './index';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const base = { index: 0, title: 'Hono 5 ships with a new router', tags: ['hono'], category: 'dev' as const };

test('summary must be 80-150 words', () => {
  assert.equal(wordCount('  a  b\nc '), 3);
  assert.equal(StorySummary.safeParse({ ...base, summary: words(79) }).success, false);
  assert.equal(StorySummary.safeParse({ ...base, summary: words(80) }).success, true);
  assert.equal(StorySummary.safeParse({ ...base, summary: words(150) }).success, true);
  assert.equal(StorySummary.safeParse({ ...base, summary: words(151) }).success, false);
});

test('more sources rank higher, older stories rank lower', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const oneHourAgo = new Date('2026-10-19T11:00:00Z');
  const dayAgo = new Date('2026-10-18T12:00:00Z');
  assert.ok(storyScore(5, oneHourAgo, now) > storyScore(1, oneHourAgo, now));
  assert.ok(storyScore(1, oneHourAgo, now) > storyScore(1, dayAgo, now));
});
