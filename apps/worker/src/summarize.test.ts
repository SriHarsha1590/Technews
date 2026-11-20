import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSummaryResponse } from './activities/summarize';

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const good = (index: number) => ({ index, title: 'Hono 5 ships a faster router', summary: words(120), tags: ['hono'], category: 'dev' });

test('sorts AI output into good, insufficient and invalid per story', () => {
  const raw = [
    good(0),
    { index: 1, insufficient: true },
    { ...good(2), summary: words(170) }, // too long
    // story 3 missing entirely
  ];
  const r = parseSummaryResponse(raw, 4);
  assert.deepEqual(r.summaries.map((s) => s.groupIndex), [0]);
  assert.deepEqual(r.insufficient, [1]);
  assert.deepEqual(r.invalid, [2, 3]);
});

test('garbage response marks every story invalid instead of crashing', () => {
  assert.deepEqual(parseSummaryResponse({ oops: true }, 2).invalid, [0, 1]);
});
