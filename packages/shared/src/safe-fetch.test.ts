import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { RequestOptions } from 'node:https';
import { safeFetchFeed, safeFetchHtml, safeFetchStatus } from './safe-fetch';

function fixture(pages: Record<string, { status?: number; location?: string; body?: string; contentType?: string }>) {
  const visited: string[] = [];
  const pinned: string[] = [];
  const request = ((url: URL, options: RequestOptions, callback: (response: any) => void) => {
    visited.push(url.href);
    (options.lookup as Function)(url.hostname, {}, (_error: unknown, address: string) => pinned.push(address));
    (options.lookup as Function)(url.hostname, { all: true }, (_error: unknown, addresses: unknown) => {
      assert.deepEqual(addresses, [{ address: pinned[pinned.length - 1], family: 4 }]);
    });
    const req = new EventEmitter() as EventEmitter & { end(): void; destroy(): void };
    req.end = () => {
      const page = pages[url.href];
      if (!page) throw new Error(`unexpected URL: ${url}`);
      const response = Readable.from([Buffer.from(page.body ?? '')]) as Readable & { statusCode: number; headers: Record<string, string> };
      response.statusCode = page.status ?? 200;
      response.headers = { 'content-type': page.contentType ?? 'text/html', ...(page.location ? { location: page.location } : {}) };
      callback(response);
    };
    req.destroy = () => {};
    return req;
  }) as typeof import('node:https').request;
  return { visited, pinned, request };
}

const resolve = async () => [{ address: '93.184.215.14', family: 4 as const }];

test('rejects non-HTTPS and credentialed URLs before connecting', async () => {
  const f = fixture({});
  assert.equal(await safeFetchHtml('http://example.com', { resolve, request: f.request }), '');
  assert.equal(await safeFetchHtml('https://user:pass@example.com', { resolve, request: f.request }), '');
  assert.deepEqual(f.visited, []);
});

test('rejects mixed public and private DNS answers', async () => {
  const f = fixture({});
  const mixed = async () => [{ address: '93.184.215.14', family: 4 as const }, { address: '127.0.0.1', family: 4 as const }];
  assert.equal(await safeFetchHtml('https://example.com', { resolve: mixed, request: f.request }), '');
  assert.deepEqual(f.visited, []);
});

test('revalidates each redirect before connecting', async () => {
  const f = fixture({ 'https://example.com/': { status: 302, location: 'https://internal.example/' } });
  const dns = async (host: string) => [{ address: host === 'example.com' ? '93.184.215.14' : '169.254.169.254', family: 4 as const }];
  assert.equal(await safeFetchHtml('https://example.com/', { resolve: dns, request: f.request }), '');
  assert.deepEqual(f.visited, ['https://example.com/']);
  assert.deepEqual(f.pinned, ['93.184.215.14']);
});

test('pins each allowed redirect to its own validated DNS answer', async () => {
  const f = fixture({
    'https://example.com/': { status: 302, location: 'https://other.example/story' },
    'https://other.example/story': { body: '<p>Story</p>' },
  });
  const dns = async (host: string) => [{ address: host === 'example.com' ? '93.184.215.14' : '8.8.8.8', family: 4 as const }];
  assert.equal(await safeFetchHtml('https://example.com/', { resolve: dns, request: f.request }), '<p>Story</p>');
  assert.deepEqual(f.pinned, ['93.184.215.14', '8.8.8.8']);
});

test('stops reading at the configured byte cap', async () => {
  const f = fixture({ 'https://example.com/': { body: '123456789' } });
  assert.equal(await safeFetchHtml('https://example.com/', { resolve, request: f.request, maxBytes: 5 }), '');
});

test('status checks revalidate redirects against the caller policy', async () => {
  const f = fixture({ 'https://example.com/': { status: 302, location: 'https://elsewhere.example/' } });
  const result = await safeFetchStatus('https://example.com/', {
    resolve,
    request: f.request,
    isAllowed: (url) => url.hostname === 'example.com',
  });
  assert.equal(result, null);
  assert.deepEqual(f.visited, ['https://example.com/']);
});

test('RSS feeds use the same bounded, pinned network boundary', async () => {
  const xml = '<rss><channel><title>Example</title></channel></rss>';
  const f = fixture({ 'https://example.com/feed.xml': { body: xml, contentType: 'application/rss+xml' } });
  assert.equal(await safeFetchFeed('https://example.com/feed.xml', { resolve, request: f.request }), xml);
  assert.deepEqual(f.pinned, ['93.184.215.14']);
  assert.equal(await safeFetchFeed('https://example.com/feed.xml', { resolve, request: f.request, maxBytes: 10 }), '');
});
