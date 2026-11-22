import assert from 'node:assert/strict';
import test from 'node:test';
import { PICK_UP_WINDOW_MS, decideRemoteTimers } from '../src/utils/remote-timers.js';
import type { MoneybirdTimeEntry, TimerSettings } from '../src/types/moneybird.js';

const now = new Date('2026-11-22T13:00:00.000Z');
const idle: TimerSettings = { administrationId: '1', projectId: '2', userId: '3' };

function entry(id: string, extra: Partial<MoneybirdTimeEntry> = {}): MoneybirdTimeEntry {
  return {
    id,
    user_id: '3',
    project_id: '2',
    description: 'Time registration',
    started_at: '2026-11-22T12:00:00.000Z',
    ended_at: null,
    ...extra,
  } as MoneybirdTimeEntry;
}

test('a key that matches two running entries picks up neither', () => {
  const decision = decideRemoteTimers(
    [{ id: 'k1', settings: idle }],
    [entry('a'), entry('b')],
    now,
    new Set()
  );

  assert.deepEqual(decision.pickUp, []);
});

test('the pick-up window is inclusive at 24 hours and excludes anything older', () => {
  const atLimit = new Date(now.getTime() - PICK_UP_WINDOW_MS).toISOString();
  const justOlder = new Date(now.getTime() - PICK_UP_WINDOW_MS - 1).toISOString();

  assert.equal(
    decideRemoteTimers(
      [{ id: 'k1', settings: idle }],
      [entry('a', { started_at: atLimit })],
      now,
      new Set()
    ).pickUp.length,
    1
  );
  assert.equal(
    decideRemoteTimers(
      [{ id: 'k1', settings: idle }],
      [entry('a', { started_at: justOlder })],
      now,
      new Set()
    ).pickUp.length,
    0
  );
});

test('a key without a description matches an entry with the default description', () => {
  const decision = decideRemoteTimers(
    [
      { id: 'k1', settings: { ...idle, description: 'Review' } },
      { id: 'k2', settings: idle },
    ],
    [entry('a')],
    now,
    new Set()
  );

  assert.deepEqual(
    decision.pickUp.map(pick => pick.keyId),
    ['k2']
  );
});

test('a running key is reported as stopped elsewhere only when its own entry has an end', () => {
  const running: TimerSettings = { ...idle, isRunning: true, timeEntryId: 'a' };
  const stillRunning = decideRemoteTimers(
    [{ id: 'k1', settings: running }],
    [entry('a')],
    now,
    new Set(['a'])
  );
  const ended = decideRemoteTimers(
    [{ id: 'k1', settings: running }],
    [entry('a', { ended_at: '2026-11-22T12:30:00.000Z' })],
    now,
    new Set(['a'])
  );

  assert.deepEqual(stillRunning.endedElsewhere, []);
  assert.deepEqual(
    ended.endedElsewhere.map(item => item.keyId),
    ['k1']
  );
});

test('only keys with the entry project count as candidates', () => {
  // Same user and default description on both keys; only the project tells them apart.
  const decision = decideRemoteTimers(
    [
      { id: 'k1', settings: idle },
      { id: 'k2', settings: { ...idle, projectId: '5' } },
    ],
    [entry('a')],
    now,
    new Set()
  );

  assert.deepEqual(
    decision.pickUp.map(pick => pick.keyId),
    ['k1']
  );
});

test('an entry that starts in the future is not picked up', () => {
  const inTenMinutes = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const decision = decideRemoteTimers(
    [{ id: 'k1', settings: idle }],
    [entry('a', { started_at: inTenMinutes })],
    now,
    new Set()
  );

  assert.deepEqual(decision.pickUp, []);
});
