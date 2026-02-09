import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateRemainingAutoStopHours,
  normalizeAutoStopHours,
} from '../src/utils/auto-stop-utils.js';

test('normalizeAutoStopHours accepts positive numbers and numeric strings', () => {
  assert.equal(normalizeAutoStopHours(2), 2);
  assert.equal(normalizeAutoStopHours('1.5'), 1.5);
});

test('normalizeAutoStopHours rejects invalid values', () => {
  assert.equal(normalizeAutoStopHours(0), null);
  assert.equal(normalizeAutoStopHours(-1), null);
  assert.equal(normalizeAutoStopHours('abc'), null);
  assert.equal(normalizeAutoStopHours(undefined), null);
});

test('calculateRemainingAutoStopHours returns remaining time and clamps to zero', () => {
  const now = new Date('2026-02-09T12:00:00.000Z');

  const remaining = calculateRemainingAutoStopHours('2026-02-09T10:00:00.000Z', 3, now);
  assert.equal(remaining, 1);

  const clamped = calculateRemainingAutoStopHours('2026-02-09T08:00:00.000Z', 3, now);
  assert.equal(clamped, 0);
});
