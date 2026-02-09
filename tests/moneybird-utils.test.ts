import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMoneybirdDate, groupTimeEntriesByDescription } from '../src/utils/moneybird-utils.js';
import { MoneybirdTimeEntry } from '../src/types/moneybird.js';

test('formatMoneybirdDate returns expected structure', () => {
  const formatted = formatMoneybirdDate(new Date('2026-02-09T10:30:00.000Z'));

  assert.match(formatted, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00 [+-]\d{2}:\d{2}$/);
});

test('groupTimeEntriesByDescription groups entries and sums hours', () => {
  const entries: MoneybirdTimeEntry[] = [
    {
      id: '1',
      started_at: '2026-02-01T10:00:00.000Z',
      ended_at: '2026-02-01T11:00:00.000Z',
      description: 'Build',
      billable: true,
      user_id: 'u1',
      contact_id: 'c1',
      project_id: 'p1',
      paused_duration: 0,
      created_at: '2026-02-01T11:00:00.000Z',
      updated_at: '2026-02-01T11:00:00.000Z',
    },
    {
      id: '2',
      started_at: '2026-02-01T11:00:00.000Z',
      ended_at: '2026-02-01T12:30:00.000Z',
      description: 'Build',
      billable: true,
      user_id: 'u1',
      contact_id: 'c1',
      project_id: 'p1',
      paused_duration: 1800,
      created_at: '2026-02-01T12:30:00.000Z',
      updated_at: '2026-02-01T12:30:00.000Z',
    },
    {
      id: '3',
      started_at: '2026-02-01T13:00:00.000Z',
      ended_at: '2026-02-01T14:00:00.000Z',
      description: '',
      billable: true,
      user_id: 'u1',
      contact_id: 'c1',
      project_id: 'p1',
      paused_duration: 0,
      created_at: '2026-02-01T14:00:00.000Z',
      updated_at: '2026-02-01T14:00:00.000Z',
    },
  ];

  const grouped = groupTimeEntriesByDescription(entries);
  assert.equal(grouped.length, 2);

  const buildGroup = grouped.find(group => group.description === 'Build');
  assert.ok(buildGroup);
  assert.equal(buildGroup.entries.length, 2);
  assert.equal(buildGroup.totalHours, 2);

  const defaultGroup = grouped.find(group => group.description === 'Werkzaamheden');
  assert.ok(defaultGroup);
  assert.equal(defaultGroup.entries.length, 1);
  assert.equal(defaultGroup.totalHours, 1);
});
