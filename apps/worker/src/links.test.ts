import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks } from './links';

test('keeps real content links, resolves relative ones, drops chrome and junk', () => {
  const html = `<nav><a href="/pricing">Pricing</a></nav>
    <article>
      <p>Try it in the <a href="https://platform.openai.com/playground?model=astra-6#top">Playground</a>.</p>
      <p>Read the <a href="/docs/astra">docs</a> or <a href="/docs/astra">the same docs again</a>.</p>
      <a href="https://twitter.com/intent/tweet?text=x">Share</a>
      <a href="/privacy">Privacy</a>
      <a href="http://insecure.example.com">Old link</a>
      <a href="https://github.com/openai/astra"><svg></svg></a>
    </article>
    <footer><a href="/careers">Careers</a></footer>`;
  const links = extractLinks(html, 'https://openai.com/index/astra-6/');
  assert.deepEqual(links, [
    { url: 'https://platform.openai.com/playground?model=astra-6', text: 'Playground' },
    { url: 'https://openai.com/docs/astra', text: 'docs' },
  ]);
});
