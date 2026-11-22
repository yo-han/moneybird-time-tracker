import assert from 'node:assert/strict';
import test from 'node:test';
import { runInOrder, writePatch } from '../src/utils/settings-writes.js';
import type { TimerSettings } from '../src/types/moneybird.js';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('tasks for one key run in the order they were queued', async () => {
  const done: string[] = [];

  await Promise.all([
    runInOrder('key-1', async () => {
      await wait(20);
      done.push('slow');
    }),
    runInOrder('key-1', async () => {
      done.push('fast');
    }),
  ]);

  assert.deepEqual(done, ['slow', 'fast']);
});

test('tasks for different keys do not wait for each other', async () => {
  const done: string[] = [];

  await Promise.all([
    runInOrder('key-a', async () => {
      await wait(20);
      done.push('a');
    }),
    runInOrder('key-b', async () => {
      done.push('b');
    }),
  ]);

  assert.deepEqual(done, ['b', 'a']);
});

test('a failed task rejects for its caller and does not block the next one', async () => {
  const failed = runInOrder('key-2', async () => {
    throw new Error('boom');
  });
  const next = runInOrder('key-2', async () => 'ran');

  await assert.rejects(failed, /boom/);
  assert.equal(await next, 'ran');
});

test('a patch is written onto the latest settings and can remove keys', async () => {
  let settings: TimerSettings = {
    administrationId: '1',
    projectId: 'p1',
    userId: 'u1',
    apiKey: 'own',
  };
  const action = {
    id: 'key-3',
    async getSettings() {
      return settings;
    },
    async setSettings(next: TimerSettings) {
      settings = next;
    },
  };
  // Written by someone else after the patch was computed.
  settings = { ...settings, isRunning: true, timeEntryId: 'entry-1' };

  await writePatch(action, { values: { projectId: 'p2' }, remove: ['apiKey'] });

  assert.deepEqual(settings, {
    administrationId: '1',
    projectId: 'p2',
    userId: 'u1',
    isRunning: true,
    timeEntryId: 'entry-1',
  });
});
