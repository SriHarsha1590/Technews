import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameStory, groupByTitle } from './cluster';

test('same event from two outlets is one story', () => {
  assert.ok(sameStory('OpenAI releases GPT-6 Astra model for developers', 'GPT-6 Astra: OpenAI releases new model to developers'));
});

test('different events stay apart even with a shared company name', () => {
  assert.ok(!sameStory('Google launches Gemini 4 Pro', 'Google cuts 200 jobs in cloud unit'));
});

test('similar announcements for different model versions stay apart', () => {
  assert.ok(!sameStory('OpenAI releases GPT-6 Astra model for developers', 'OpenAI releases GPT-5 Astra model for developers'));
  assert.ok(!sameStory('Node.js 26 released with native TypeScript support', 'Node.js 24 released with native TypeScript support'));
  assert.ok(!sameStory('Google launches Gemini 4 Pro for developers', 'Google launches Gemini 4 Flash for developers'));
  assert.ok(!sameStory('Apple unveils MacBook Air M4 with new design', 'Apple unveils MacBook Pro M4 with new design'));
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
