import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { checksumOf } from '../src/integrity.mjs';

test('校验算法与 Cursor 一致：sha256 base64 去掉尾部 =', () => {
  const buf = Buffer.from('hello world');
  const expected = crypto.createHash('sha256').update(buf).digest('base64').replace(/=+$/, '');
  assert.equal(checksumOf(buf), expected);
  assert.ok(!checksumOf(buf).endsWith('='));
});

test('已知向量', () => {
  // echo -n "abc" | shasum -a 256 | xxd -r -p | base64
  assert.equal(checksumOf(Buffer.from('abc')), 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0');
});
