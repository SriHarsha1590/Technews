import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedLink, pageContext, siteOf } from './trust';

const u = (s: string) => new URL(s);
const openaiPage = pageContext('https://openai.com/index/introducing-astra-6/', 'official');
const githubPage = pageContext('https://github.blog/news/copilot-update/', 'official');
const pressPage = pageContext('https://techcrunch.com/2026/10/20/astra-6/', 'press');

test('siteOf groups subdomains under their registrable domain', () => {
  assert.equal(siteOf('platform.openai.com'), 'openai.com');
  assert.equal(siteOf('blog.google'), 'blog.google');
  assert.equal(siteOf('news.bbc.co.uk'), 'bbc.co.uk');
});

test('official page: links to the company own sites are allowed, including downloads', () => {
  assert.ok(isTrustedLink(u('https://platform.openai.com/playground'), 'playground', openaiPage));
  assert.ok(isTrustedLink(u('https://chatgpt.com/download'), 'download', openaiPage));
  assert.ok(isTrustedLink(u('https://docs.github.com/en/copilot'), 'docs', githubPage)); // github.blog owns github.com
});

test('official page: code hosts allowed for repos, but never for downloads', () => {
  assert.ok(isTrustedLink(u('https://github.com/openai/astra'), 'repo', openaiPage));
  assert.ok(!isTrustedLink(u('https://github.com/openai/astra/releases/download/v1/astra.exe'), 'download', openaiPage));
});

test('lookalike and unrelated domains are rejected', () => {
  assert.ok(!isTrustedLink(u('https://openai-download.com/astra'), 'download', openaiPage));
  assert.ok(!isTrustedLink(u('https://openai.com.evil.io/x'), 'docs', openaiPage));
  assert.ok(!isTrustedLink(u('http://platform.openai.com/playground'), 'playground', openaiPage)); // not https
});

test('press page: only known vendor sites and code hosts, never downloads', () => {
  assert.ok(isTrustedLink(u('https://platform.openai.com/docs'), 'docs', pressPage));
  assert.ok(isTrustedLink(u('https://huggingface.co/spaces/x/demo'), 'playground', pressPage));
  assert.ok(!isTrustedLink(u('https://chatgpt.com/download'), 'download', pressPage));
  assert.ok(!isTrustedLink(u('https://some-startup.ai/try'), 'playground', pressPage)); // can't verify who owns it
});
