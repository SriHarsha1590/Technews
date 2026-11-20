import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorOf, imageOf } from './media';

test('image: media:content images win, videos are skipped', () => {
  const item = {
    mediaContent: [
      { $: { url: 'https://cdn.example.com/clip.mp4', medium: 'video' } },
      { $: { url: 'https://cdn.example.com/hero.jpg', medium: 'image' } },
    ],
  };
  assert.equal(imageOf(item), 'https://cdn.example.com/hero.jpg');
});

test('image: falls back to thumbnail, then enclosure, then the first <img>', () => {
  assert.equal(imageOf({ mediaThumbnail: [{ $: { url: 'https://x.com/t.png' } }] }), 'https://x.com/t.png');
  const bbc = 'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/68b2/live/a.jpg';
  assert.equal(imageOf({ mediaThumbnail: [{ $: { url: bbc } }] }), bbc.replace('/240/', '/800/')); // asks for a card-sized copy
  assert.equal(imageOf({ enclosure: { url: 'https://x.com/e.webp', type: 'image/webp' } }), 'https://x.com/e.webp');
  assert.equal(imageOf({ enclosure: { url: 'https://x.com/a.mp3', type: 'audio/mpeg' } }), null);
  const html = '<p><img src="https://x.com/pixel.gif" width="1" height="1"><img class="hero" src="/img/a.jpg?w=800&amp;q=80"></p>';
  assert.equal(imageOf({ 'content:encoded': html }, 'https://x.com/post'), 'https://x.com/img/a.jpg?w=800&q=80');
});

test('image: http and malformed URLs are ignored', () => {
  assert.equal(imageOf({ mediaThumbnail: [{ $: { url: 'http://x.com/t.png' } }] }), null);
  assert.equal(imageOf({ content: '<img src="http://[bad">' }), null);
});

test('author: plain names, RSS email style, and long lists', () => {
  assert.equal(authorOf({ creator: '  Jane   Doe ' }), 'Jane Doe');
  assert.equal(authorOf({ author: 'noreply@blogger.com (Google Security)' }), 'Google Security');
  assert.equal(authorOf({ author: 'editor@example.com' }), null);
  assert.equal(authorOf({ creator: 'By Sam Lee' }), 'Sam Lee');
  assert.equal(authorOf({ creator: 'Tom Wall. Photographs: Joel Redman' }), 'Tom Wall');
  assert.equal(authorOf({ creator: 'Ada Lovelace, Alan Turing, Grace Hopper, Edsger Dijkstra' }), 'Ada Lovelace et al.');
  assert.equal(authorOf({}), null);
});
