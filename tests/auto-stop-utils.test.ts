import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateRemainingAutoStopHours,
  normalizeAutoStopHours,
  resolveAutoStopEndTime,
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

test('resolveAutoStopEndTime caps the end at the configured limit', () => {
  const start = '2026-02-09T08:00:00.000Z';
  // The timer fired ten hours late, e.g. after the laptop slept.
  const lateNow = new Date('2026-02-09T22:00:00.000Z');
  assert.equal(resolveAutoStopEndTime(start, 4, lateNow).toISOString(), '2026-02-09T12:00:00.000Z');
});

test('resolveAutoStopEndTime uses now when the limit is still ahead', () => {
  const now = new Date('2026-02-09T09:30:00.000Z');
  assert.equal(resolveAutoStopEndTime('2026-02-09T08:00:00.000Z', 4, now).getTime(), now.getTime());
});

test('resolveAutoStopEndTime falls back to now for an unreadable start time', () => {
  const now = new Date('2026-02-09T09:30:00.000Z');
  assert.equal(resolveAutoStopEndTime('not a date', 4, now), now);
});
