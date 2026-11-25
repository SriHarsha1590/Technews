import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalUrl } from './externalUrl';

test('only absolute HTTPS article links are opened', () => {
  assert.equal(externalUrl('https://example.com/news'), 'https://example.com/news');
  for (const candidate of ['javascript:alert(1)', 'data:text/html,hello', 'http://example.com', '/local', 'https://u:p@example.com']) {
    assert.equal(externalUrl(candidate), null);
  }
});
