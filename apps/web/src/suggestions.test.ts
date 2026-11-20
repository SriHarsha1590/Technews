import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StoryCard } from '@technews/shared';
import { suggestions } from './suggestions';

const card = (tags: string[]): StoryCard => ({
  id: '0'.repeat(24), title: 't', summary: 's', tags, category: 'ai', primaryUrl: 'https://x.com',
  primarySource: { name: 'X', url: 'https://x.com', trustTier: 'press' }, imageUrl: null, author: null,
  sourceCount: 1, publishedAt: '2026-10-26T00:00:00.000Z', tryLinks: [],
});

test('feed suggestions follow the most common topics on screen', () => {
  const feed = [card(['openai', 'llm']), card(['llm', 'gpu']), card(['llm', 'openai']), card(['rust'])];
  assert.deepEqual(suggestions(feed, null), [
    "What are today's biggest stories?",
    "What's the latest on LLM?",
    'What does GPU mean?', // the next acronym, not "What does Openai mean?"
  ]);
  assert.deepEqual(suggestions([card(['openai', 'google']), card(['openai'])], null), [
    "What are today's biggest stories?",
    "What's the latest on Openai?",
    "What's the latest on Google?",
  ]);
});

test('an empty feed still offers a question', () => {
  assert.deepEqual(suggestions([], null), ["What are today's biggest stories?"]);
});

test('card suggestions ask about that card and its own topic', () => {
  assert.deepEqual(suggestions([], card(['github copilot', 'api'])), ['Explain this simply', 'What does API mean?', 'Who should care about this?']);
  assert.deepEqual(suggestions([], card(['apple'])), ['Explain this simply', 'Explain the tech words in this', 'Who should care about this?']);
});
