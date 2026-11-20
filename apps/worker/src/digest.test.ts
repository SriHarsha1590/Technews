import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigestMessage, isDue, localParts } from './digest';

test('local day and hour follow the reader time zone', () => {
  const t = new Date('2026-10-21T02:45:00Z'); // 08:15 in India, 22:45 the day before in New York
  assert.deepEqual(localParts(t, 'Asia/Kolkata'), { day: '2026-10-21', hour: 8 });
  assert.deepEqual(localParts(t, 'America/New_York'), { day: '2026-10-20', hour: 22 });
});

test('due at the chosen local hour, once a day, with a 3-hour catch-up window', () => {
  const d = { enabled: true, hour: 8, timeZone: 'Asia/Kolkata' };
  const at = (utc: string) => new Date(utc);
  assert.equal(isDue(d, undefined, at('2026-10-21T02:45:00Z')).due, true); // 08:15
  assert.equal(isDue(d, '2026-10-21', at('2026-10-21T02:45:00Z')).due, false); // already sent today
  assert.equal(isDue(d, '2026-10-20', at('2026-10-21T04:45:00Z')).due, true); // 10:15, still catching up
  assert.equal(isDue(d, undefined, at('2026-10-21T05:45:00Z')).due, false); // 11:15, too late
  assert.equal(isDue(d, undefined, at('2026-10-21T01:45:00Z')).due, false); // 07:15, too early
  assert.equal(isDue({ ...d, enabled: false }, undefined, at('2026-10-21T02:45:00Z')).due, false);
});

test('message names the matched stack and links to "For you"', () => {
  const m = buildDigestMessage(
    [{ title: 'React 20 ships', tags: ['react'] }, { title: 'Vite 9 is faster', tags: ['vite', 'tooling'] }],
    ['react', 'vite', 'go'],
  );
  assert.equal(m.title, '2 new in react, vite');
  assert.equal(m.body, '• React 20 ships\n• Vite 9 is faster');
  assert.equal(m.url, '/?view=foryou');
});

test('without a stack, it is the top stories overall', () => {
  const m = buildDigestMessage([{ title: 'Big launch', tags: ['ai'] }], []);
  assert.equal(m.title, "Today's top story");
  assert.equal(m.url, '/');
});
