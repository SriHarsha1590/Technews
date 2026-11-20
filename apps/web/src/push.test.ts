import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyToBytes } from './pushKey';

test('turns a base64url VAPID key into bytes', () => {
  // "hello?>" in base64url: aGVsbG8_Pg (uses _ instead of /, and no padding)
  assert.deepEqual([...keyToBytes('aGVsbG8_Pg')], [...Buffer.from('hello?>')]);
});
