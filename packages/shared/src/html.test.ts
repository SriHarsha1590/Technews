import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractImage, extractText } from './html';

test('extracts semantic meta attributes regardless of order and decodes entities', () => {
  const html = '<meta content="A &copy; update &#x1F680;" data-x="x" name="description"><p>A longer paragraph about the launch &#x1F680; and all the capabilities it brings to developers.</p>';
  assert.equal(extractText(html), 'A © update 🚀\nA longer paragraph about the launch 🚀 and all the capabilities it brings to developers.');
});

test('malformed markup cannot turn script-like content into article text', () => {
  const html = '<script>const fake = "<p>This script has more than forty words and must never be treated as article text by extraction.</p>"</script><p>Actual article text about a product launch and the capabilities it brings to developers';
  assert.equal(extractText(html), 'Actual article text about a product launch and the capabilities it brings to developers');
});

test('finds image with reordered attributes and decodes its URL', () => {
  const html = '<meta content="/hero.jpg?w=800&amp;q=80" data-x="x" property="og:image">';
  assert.equal(extractImage(html, 'https://example.com/story'), 'https://example.com/hero.jpg?w=800&q=80');
});

test('bounds parser input for oversized HTML', () => {
  const html = ' '.repeat(2_000_001) + '<meta property="og:image" content="https://example.com/late.png">';
  assert.equal(extractImage(html, 'https://example.com/story'), null);
});
