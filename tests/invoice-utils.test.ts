import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateTotalHours,
  getPeriodLabel,
  getPeriodRange,
  parseHourlyRate,
  resolvePeriodKey,
} from '../src/utils/invoice-utils.js';

test('resolvePeriodKey uses new period settings when present', () => {
  assert.equal(resolvePeriodKey({ periodType: 'quarter', periodRange: 'last' }), 'last_quarter');
});

test('resolvePeriodKey falls back to legacy period values', () => {
  assert.equal(resolvePeriodKey({ period: 'current_year' }), 'current_year');
  assert.equal(resolvePeriodKey({ period: 'custom' }), 'current_month');
});

test('getPeriodLabel returns user-facing labels', () => {
  assert.equal(getPeriodLabel('current_month'), 'This Month');
  assert.equal(getPeriodLabel('last_year'), 'Last Year');
});

test('getPeriodRange returns expected month boundaries', () => {
  const now = new Date('2026-02-15T12:00:00Z');
  const { startDate, endDate } = getPeriodRange(now, 'last_month');

  assert.equal(startDate.getFullYear(), 2026);
  assert.equal(startDate.getMonth(), 0);
  assert.equal(startDate.getDate(), 1);
  assert.equal(startDate.getHours(), 0);
  assert.equal(startDate.getMinutes(), 0);

  assert.equal(endDate.getFullYear(), 2026);
  assert.equal(endDate.getMonth(), 0);
  assert.equal(endDate.getDate(), 31);
  assert.equal(endDate.getHours(), 23);
  assert.equal(endDate.getMinutes(), 59);
});

test('parseHourlyRate parses localized values and falls back on invalid input', () => {
  assert.equal(parseHourlyRate('89,5', 75), 89.5);
  assert.equal(parseHourlyRate('', 75), 75);
  assert.equal(parseHourlyRate(undefined, 80), 80);
});

test('calculateTotalHours subtracts paused duration', () => {
  const total = calculateTotalHours([
    {
      started_at: '2026-02-01T10:00:00.000Z',
      ended_at: '2026-02-01T12:00:00.000Z',
      paused_duration: 1800,
    },
    {
      started_at: '2026-02-01T13:00:00.000Z',
      ended_at: '2026-02-01T14:00:00.000Z',
      paused_duration: 0,
    },
  ]);

  assert.equal(total, 2.5);
});
