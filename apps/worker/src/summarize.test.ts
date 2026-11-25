import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSummaryResponse, summarizeGroups, type GroupInput } from './activities/summarize';

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

test('provider 503 publishes an attributed source preview', async () => {
  const inputs = [{ articles: [{
    _id: 'article-1', url: 'https://example.com/story', title: 'Example launches a new tool',
    snippet: 'The tool helps teams review changes.', sourceName: 'Example News', category: 'dev' as const,
    trustTier: 'press' as const, publishedAt: new Date(), imageUrl: null, author: null,
  }], text: 'The tool helps teams review changes.' }] satisfies GroupInput[];
  const result = await summarizeGroups(inputs, async () => { throw Object.assign(new Error('unavailable'), { status: 503 }); });
  assert.equal(result.summaries.length, 1);
  assert.match(result.summaries[0].summary.summary, /^From Example News: The tool helps teams review changes\./);
  assert.equal(result.summaries[0].summary.category, 'dev');
});

test('other provider errors still retry through Temporal', async () => {
  await assert.rejects(summarizeGroups([], async () => { throw Object.assign(new Error('rate limited'), { status: 429 }); }), /rate limited/);
});
