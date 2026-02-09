import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateEntryDurationHours } from '../src/utils/time-entry-utils.js';

test('calculateEntryDurationHours returns 0 when ended_at is null', () => {
  const hours = calculateEntryDurationHours({
    started_at: '2026-02-01T10:00:00.000Z',
    ended_at: null,
    paused_duration: 0,
  });

  assert.equal(hours, 0);
});

test('calculateEntryDurationHours clamps negative durations to 0', () => {
  const hours = calculateEntryDurationHours({
    started_at: '2026-02-01T10:00:00.000Z',
    ended_at: '2026-02-01T10:10:00.000Z',
    paused_duration: 3600,
  });

  assert.equal(hours, 0);
});

test('calculateEntryDurationHours returns positive duration in hours', () => {
  const hours = calculateEntryDurationHours({
    started_at: '2026-02-01T10:00:00.000Z',
    ended_at: '2026-02-01T12:00:00.000Z',
    paused_duration: 1800,
  });

  assert.equal(hours, 1.5);
});
