import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureContentRetentionIndexes } from './stores';
import { RETENTION_DAYS } from '@technews/shared';

test('content retention indexes expire articles and stories without touching reader collections', async () => {
  const calls: { collection: string; field: string; seconds: number }[] = [];
  const client = { db: () => ({ collection: (name: string) => ({ createIndex: async (fields: Record<string, number>, options: { expireAfterSeconds: number }) => {
    calls.push({ collection: name, field: Object.keys(fields)[0], seconds: options.expireAfterSeconds });
  } }) }) };
  await ensureContentRetentionIndexes(client as any, 'test');
  assert.deepEqual(calls.sort((a, b) => a.collection.localeCompare(b.collection)), [
    { collection: 'articles', field: 'fetchedAt', seconds: RETENTION_DAYS * 86400 },
    { collection: 'stories', field: 'createdAt', seconds: RETENTION_DAYS * 86400 },
  ]);
});
