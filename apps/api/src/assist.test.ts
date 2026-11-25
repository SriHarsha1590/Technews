import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AiStory, AssistStore } from './stores';
import { getTryGuide } from './assist';

test('concurrent first views of the same guide share generation', async () => {
  const story: AiStory = {
    id: '000000000000000000000001', title: 'Test tool', summary: 'A new tool is available', tags: [], category: 'tools',
    primaryUrl: 'https://example.com', primarySource: { name: 'Example', url: 'https://example.com', trustTier: 'official' },
    imageUrl: null, author: null, sourceCount: 1, publishedAt: new Date().toISOString(), tryLinks: [],
  };
  let calls = 0;
  const store: AssistStore = {
    story: async () => story, stories: async () => [], search: async () => [],
    saveExplainer: async () => {}, saveTryGuide: async () => {},
  };
  const deps = { store, fetchHtml: async () => '', ai: { json: async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { steps: ['Open the official tool.', 'Try the first example.'] };
  } } };
  const [a, b] = await Promise.all([getTryGuide(story.id, deps), getTryGuide(story.id, deps)]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
});
