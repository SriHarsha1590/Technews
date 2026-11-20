import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, articleId } from './url';

test('strips tracking params, fragment, www and trailing slash', () => {
  assert.equal(canonicalUrl('https://www.Example.com/post/1/?utm_source=x&b=2&a=1#top'), 'https://example.com/post/1?a=1&b=2');
});

test('same story from different links gets the same id', () => {
  assert.equal(articleId('https://example.com/post/1?utm_medium=rss'), articleId('https://www.example.com/post/1/'));
});

test('different stories get different ids', () => {
  assert.notEqual(articleId('https://example.com/a'), articleId('https://example.com/b'));
});
