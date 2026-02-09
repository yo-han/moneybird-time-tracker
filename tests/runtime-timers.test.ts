import assert from 'node:assert/strict';
import test from 'node:test';
import { clearIntervalForKey, clearTimeoutForKey } from '../src/utils/runtime-timers.js';

test('clearTimeoutForKey removes and clears existing timeout', () => {
  const map = new Map<string, NodeJS.Timeout>();
  const timeout = setTimeout(() => {}, 1000);
  map.set('a', timeout);

  clearTimeoutForKey(map, 'a');

  assert.equal(map.has('a'), false);
});

test('clearTimeoutForKey is safe when key is missing', () => {
  const map = new Map<string, NodeJS.Timeout>();
  clearTimeoutForKey(map, 'missing');
  assert.equal(map.size, 0);
});

test('clearIntervalForKey removes and clears existing interval', () => {
  const map = new Map<string, NodeJS.Timeout>();
  const interval = setInterval(() => {}, 1000);
  map.set('i', interval);

  clearIntervalForKey(map, 'i');

  assert.equal(map.has('i'), false);
});

test('clearIntervalForKey is safe when key is missing', () => {
  const map = new Map<string, NodeJS.Timeout>();
  clearIntervalForKey(map, 'missing');
  assert.equal(map.size, 0);
});
