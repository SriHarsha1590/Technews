import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText } from './extract';

test('keeps description and real paragraphs, drops scripts and short bits', () => {
  const html = `<html><head><meta property="og:description" content="A new router &amp; faster builds."></head>
    <body><script>var x = "<p>not this</p>";</script><nav><p>Home | About | Contact us today please</p></nav>
    <p>By Jane</p><p>The release adds a <b>new router</b> that is twice as fast on large apps.</p></body></html>`;
  const text = extractText(html);
  assert.match(text, /A new router & faster builds\./);
  assert.match(text, /new router that is twice as fast/);
  assert.doesNotMatch(text, /not this|By Jane|Contact us/);
});
