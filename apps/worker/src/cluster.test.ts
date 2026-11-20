import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameStory, groupByTitle } from './cluster';

test('same event from two outlets is one story', () => {
  assert.ok(sameStory('OpenAI releases GPT-6 Astra model for developers', 'GPT-6 Astra: OpenAI releases new model to developers'));
});

test('different events stay apart even with a shared company name', () => {
  assert.ok(!sameStory('Google launches Gemini 4 Pro', 'Google cuts 200 jobs in cloud unit'));
});

test('groups headlines by event', () => {
  const groups = groupByTitle([
    { title: 'Node.js 26 released with native TypeScript support' },
    { title: 'Kubernetes 1.36 adds sidecar improvements' },
    { title: 'Node.js 26 released: native TypeScript support arrives' },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 2);
});
