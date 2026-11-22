import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GlobalSettingsLoadTimeoutError,
  GlobalSettingsStore,
} from '../src/utils/global-settings.js';
import type { PluginGlobalSettings } from '../src/types/moneybird.js';

function createBackend(initial: PluginGlobalSettings = {}) {
  let stored: PluginGlobalSettings = { ...initial };
  const calls = { load: 0, save: 0 };
  let failNextSave = false;

  return {
    calls,
    stored: () => stored,
    failNextSave: () => {
      failNextSave = true;
    },
    backend: {
      async load() {
        calls.load++;
        // Yield so concurrent callers really interleave around the load.
        await new Promise(resolve => setImmediate(resolve));
        return { ...stored };
      },
      async save(next: PluginGlobalSettings) {
        calls.save++;
        await new Promise(resolve => setImmediate(resolve));
        if (failNextSave) {
          failNextSave = false;
          throw new Error('save failed');
        }
        stored = { ...next };
      },
    },
  };
}

test('global settings are loaded once and then served from the cache', async () => {
  const fake = createBackend({ apiKey: 'global-key' });
  const store = new GlobalSettingsStore(fake.backend);

  assert.equal((await store.get()).apiKey, 'global-key');
  assert.equal((await store.get()).apiKey, 'global-key');
  await store.update(current => ({ ...current, defaultAdministrationId: '7' }));

  assert.equal(fake.calls.load, 1);
});

test('an update is saved and visible to the next read', async () => {
  const fake = createBackend();
  const store = new GlobalSettingsStore(fake.backend);

  const next = await store.update(current => ({ ...current, apiKey: 'new-key' }));

  assert.equal(next.apiKey, 'new-key');
  assert.equal((await store.get()).apiKey, 'new-key');
  assert.deepEqual(fake.stored(), { apiKey: 'new-key' });
});

test('an update that returns the current settings does not write', async () => {
  const fake = createBackend({ apiKey: 'global-key' });
  const store = new GlobalSettingsStore(fake.backend);

  await store.update(current => current);

  assert.equal(fake.calls.save, 0);
});

test('concurrent updates run one after another, each seeing the previous result', async () => {
  const fake = createBackend();
  const store = new GlobalSettingsStore(fake.backend);
  const adoptIfMissing = (key: string) =>
    store.update(current => (current.apiKey ? current : { ...current, apiKey: key }));

  const [first, second] = await Promise.all([adoptIfMissing('key-a'), adoptIfMissing('key-b')]);

  assert.equal(first.apiKey, 'key-a');
  assert.equal(second.apiKey, 'key-a');
  assert.equal(fake.stored().apiKey, 'key-a');
  assert.equal(fake.calls.save, 1);
});

test('a failed save rejects that update, keeps the old value and does not block later updates', async () => {
  const fake = createBackend({ apiKey: 'old-key' });
  const store = new GlobalSettingsStore(fake.backend);
  fake.failNextSave();

  await assert.rejects(
    store.update(current => ({ ...current, apiKey: 'lost-key' })),
    /save failed/
  );
  assert.equal((await store.get()).apiKey, 'old-key');

  await store.update(current => ({ ...current, apiKey: 'next-key' }));
  assert.equal(fake.stored().apiKey, 'next-key');
});

test('a load that never answers times out, is not cached, and is tried again', async () => {
  let loads = 0;
  const store = new GlobalSettingsStore(
    {
      load() {
        loads++;
        return loads === 1 ? new Promise(() => {}) : Promise.resolve({ apiKey: 'late-key' });
      },
      async save() {},
    },
    20
  );

  await assert.rejects(store.get(), GlobalSettingsLoadTimeoutError);
  assert.equal((await store.get()).apiKey, 'late-key');
  assert.equal(loads, 2);
});
