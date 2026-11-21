import assert from 'node:assert/strict';
import test from 'node:test';
import { formatElapsedTime } from '../src/utils/elapsed-time.js';

test('formatElapsedTime shows seconds below a minute', () => {
  assert.equal(formatElapsedTime(0), '0s');
  assert.equal(formatElapsedTime(59.9), '59s');
});

test('formatElapsedTime shows minutes below an hour', () => {
  assert.equal(formatElapsedTime(60), '1m');
  assert.equal(formatElapsedTime(3599), '59m');
});

test('formatElapsedTime keeps the minutes once past an hour', () => {
  assert.equal(formatElapsedTime(3600), '1h00');
  assert.equal(formatElapsedTime(3600 + 5 * 60), '1h05');
  assert.equal(formatElapsedTime(2 * 3600 - 1), '1h59');
  assert.equal(formatElapsedTime(10 * 3600 + 59 * 60), '10h59');
});

test('formatElapsedTime clamps negative and invalid input to zero', () => {
  assert.equal(formatElapsedTime(-5), '0s');
  assert.equal(formatElapsedTime(Number.NaN), '0s');
});
