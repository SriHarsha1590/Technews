import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyPicks, type StoryCandidates } from './activities/trylinks';
import { pageContext } from './trust';

const page = pageContext('https://openai.com/index/astra-6/', 'official');
const story: StoryCandidates = {
  storyId: 's1', title: 'Astra 6', summary: '...',
  candidates: [
    { n: 0, url: 'https://platform.openai.com/playground', text: 'Try it in the Playground', page },
    { n: 1, url: 'https://openai.com/dead-docs', text: 'Docs', page },
    { n: 2, url: 'https://platform.openai.com/docs/astra', text: 'Astra docs', page },
  ],
};
const ok = async (url: string) => (url.includes('dead') ? { ok: false, reason: 'HTTP 404' } : { ok: true, finalUrl: url });

test('keeps verified picks in priority order, falls back when a pick is dead, ignores invented numbers', async () => {
  const { links, rejected } = await verifyPicks(story, [
    { n: 1, type: 'docs' }, // dead -> skipped
    { n: 2, type: 'docs' }, // next docs pick is used
    { n: 0, type: 'playground' },
    { n: 99, type: 'download' }, // number the AI made up -> ignored
  ], ok as any, new Date('2026-10-21T00:00:00Z'));
  assert.deepEqual(links.map((l) => [l.type, l.url, l.domain]), [
    ['playground', 'https://platform.openai.com/playground', 'platform.openai.com'],
    ['docs', 'https://platform.openai.com/docs/astra', 'platform.openai.com'],
  ]);
  assert.deepEqual(rejected, [{ url: 'https://openai.com/dead-docs', reason: 'HTTP 404' }]);
});
