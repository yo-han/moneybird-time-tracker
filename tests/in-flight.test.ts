import assert from 'node:assert/strict';
import test from 'node:test';
import { runExclusivePerKey } from '../src/utils/in-flight.js';

test('runExclusivePerKey skips a second call while the first is running', async () => {
  const inFlight = new Set<string>();
  let release: () => void = () => {};
  let runs = 0;

  const first = runExclusivePerKey(inFlight, 'key', async () => {
    runs++;
    await new Promise<void>(resolve => {
      release = resolve;
    });
  });
  const second = await runExclusivePerKey(inFlight, 'key', async () => {
    runs++;
  });

  assert.equal(second, false);
  release();
  assert.equal(await first, true);
  assert.equal(runs, 1);
});

test('runExclusivePerKey runs different keys independently', async () => {
  const inFlight = new Set<string>();
  let release: () => void = () => {};
  const blocking = runExclusivePerKey(inFlight, 'a', () => new Promise<void>(r => (release = r)));

  assert.equal(await runExclusivePerKey(inFlight, 'b', async () => {}), true);
  release();
  await blocking;
});

test('runExclusivePerKey frees the key after a failure', async () => {
  const inFlight = new Set<string>();

  await assert.rejects(
    runExclusivePerKey(inFlight, 'key', async () => {
      throw new Error('boom');
    }),
    /boom/
  );
  assert.equal(inFlight.has('key'), false);
  assert.equal(await runExclusivePerKey(inFlight, 'key', async () => {}), true);
});
