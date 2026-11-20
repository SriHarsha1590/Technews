import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeAgo, coverageText } from './format';

test('timeAgo picks the right unit', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  assert.equal(timeAgo('2026-10-21T11:59:40Z', now), 'just now');
  assert.equal(timeAgo('2026-10-21T11:48:00Z', now), '12m ago');
  assert.equal(timeAgo('2026-10-21T09:00:00Z', now), '3h ago');
  assert.equal(timeAgo('2026-10-19T11:00:00Z', now), '2d ago');
});

test('coverage text is singular for one source', () => {
  assert.equal(coverageText(1), 'Covered by 1 source');
  assert.equal(coverageText(4), 'Covered by 4 sources');
});
