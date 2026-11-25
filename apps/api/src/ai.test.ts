import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { AiUnavailable, geminiAi } from './ai';

test('public AI denies a call when the budget store fails', async () => {
  const ai = geminiAi({ apiKey: 'configured', model: 'test', dailyCap: 10, redis: {
    incr: async () => { throw new Error('Redis unavailable'); },
    expire: async () => true,
  } as any });
  await assert.rejects(ai.json('hi', z.object({ answer: z.string() })), AiUnavailable);
});

test('public AI uses a reserved public budget and denies when exhausted', async () => {
  let key = '';
  const ai = geminiAi({ apiKey: 'configured', model: 'test', dailyCap: 0, redis: {
    incr: async (value: string) => { key = value; return 1; },
    expire: async () => true,
  } as any });
  await assert.rejects(ai.json('hi', z.object({ answer: z.string() })), AiUnavailable);
  assert.match(key, /^llm:public:calls:\d{4}-\d{2}-\d{2}$/);
});
