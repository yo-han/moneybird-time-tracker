import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adoptPerKeyApiKey,
  hashApiKey,
  matchesApiKeyHash,
  migrateKeyCredentials,
  resolveApiKey,
  resolveApiKeyFromStore,
} from '../src/utils/credentials.js';
import { GlobalSettingsStore } from '../src/utils/global-settings.js';
import type { PluginGlobalSettings, TimerSettings } from '../src/types/moneybird.js';

function createStore(initial: PluginGlobalSettings = {}) {
  let stored: PluginGlobalSettings = { ...initial };
  let saves = 0;
  const store = new GlobalSettingsStore({
    async load() {
      await new Promise(resolve => setImmediate(resolve));
      return { ...stored };
    },
    async save(next) {
      saves++;
      await new Promise(resolve => setImmediate(resolve));
      stored = { ...next };
    },
  });
  return { store, stored: () => stored, saves: () => saves };
}

const runningKey: TimerSettings = {
  apiKey: 'key-a',
  administrationId: '100',
  projectId: '2',
  userId: '3',
  isRunning: true,
  startTime: '2026-11-22T09:00:00.000Z',
  timeEntryId: 'entry-1',
};

test('resolveApiKey prefers the key of its own, then the global key', () => {
  assert.equal(resolveApiKey({ apiKey: 'own' }, { apiKey: 'global' }), 'own');
  assert.equal(resolveApiKey({}, { apiKey: 'global' }), 'global');
  assert.equal(resolveApiKey({ apiKey: '  ' }, { apiKey: 'global' }), 'global');
  assert.equal(resolveApiKey({ apiKey: '' }, {}), undefined);
});

test('a per-key API key becomes the global key when there is none yet', async () => {
  const fake = createStore();

  const migrated = await adoptPerKeyApiKey(runningKey, fake.store);

  const { adoptedApiKeyHash, ...rest } = fake.stored();
  assert.deepEqual(rest, { apiKey: 'key-a', defaultAdministrationId: '100' });
  assert.equal(matchesApiKeyHash('key-a', adoptedApiKeyHash), true);
  assert.equal(migrated.apiKey, undefined);
  assert.equal('apiKey' in migrated, false);
  // The running timer is untouched.
  assert.equal(migrated.isRunning, true);
  assert.equal(migrated.startTime, runningKey.startTime);
  assert.equal(migrated.timeEntryId, 'entry-1');
  assert.equal(migrated.administrationId, '100');
});

test('the adopted key is stored trimmed, and only a salted scrypt hash of it is kept', async () => {
  const fake = createStore();

  await adoptPerKeyApiKey({ ...runningKey, apiKey: '  key-a  ' }, fake.store);

  const stored = fake.stored().adoptedApiKeyHash ?? '';
  assert.equal(fake.stored().apiKey, 'key-a');
  assert.match(stored, /^scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.equal(stored.includes('key-a'), false);
  assert.equal(matchesApiKeyHash('key-a', stored), true);
});

test('matchesApiKeyHash only matches the hashed key, and rejects unknown formats', () => {
  const stored = hashApiKey('key-a');

  assert.notEqual(hashApiKey('key-a'), stored); // a fresh salt every time
  assert.equal(matchesApiKeyHash(' key-a ', stored), true);
  assert.equal(matchesApiKeyHash('key-b', stored), false);
  assert.equal(matchesApiKeyHash('key-a', undefined), false);
  assert.equal(matchesApiKeyHash('key-a', 'a'.repeat(64)), false);
  assert.equal(matchesApiKeyHash('key-a', stored.replace(/.$/, '')), false);
});

test('a per-key key equal to the global key is removed from the key', async () => {
  const fake = createStore({ apiKey: 'key-a', defaultAdministrationId: '999' });

  const migrated = await adoptPerKeyApiKey(runningKey, fake.store);

  assert.equal('apiKey' in migrated, false);
  assert.equal(fake.saves(), 0);
  assert.equal(fake.stored().defaultAdministrationId, '999');
});

test('a per-key key that differs from the global key stays, marked as override', async () => {
  const fake = createStore({ apiKey: 'key-b', adoptedApiKeyHash: hashApiKey('key-b') });

  const migrated = await adoptPerKeyApiKey(runningKey, fake.store);

  assert.equal(migrated.apiKey, 'key-a');
  assert.equal(migrated.apiKeyIsOverride, true);
  assert.equal(fake.stored().apiKey, 'key-b');
});

test('a key that still carries the adopted key is migrated after the global key was rotated', async () => {
  // key-a became global at upgrade, then the user rotated the global key to key-b while
  // this key was on a page that had not been shown yet.
  const fake = createStore({ apiKey: 'key-b', adoptedApiKeyHash: hashApiKey('key-a') });

  const migrated = await adoptPerKeyApiKey(runningKey, fake.store);

  assert.equal('apiKey' in migrated, false);
  assert.equal(resolveApiKey(migrated, fake.stored()), 'key-b');
});

test('an explicit override is left alone', async () => {
  const fake = createStore({ apiKey: 'key-b', adoptedApiKeyHash: hashApiKey('key-a') });
  const override = { ...runningKey, apiKeyIsOverride: true };

  const migrated = await adoptPerKeyApiKey(override, fake.store);

  assert.equal(migrated, override);
  assert.equal(fake.saves(), 0);
});

test('a key without its own API key is returned unchanged', async () => {
  const fake = createStore({ apiKey: 'key-b' });
  const settings = { ...runningKey, apiKey: '' };

  assert.equal(await adoptPerKeyApiKey(settings, fake.store), settings);
  assert.equal(fake.saves(), 0);
});

test('two keys with different API keys appearing at once: one becomes global, the other an override', async () => {
  const fake = createStore();

  const [first, second] = await Promise.all([
    adoptPerKeyApiKey({ ...runningKey, apiKey: 'key-a' }, fake.store),
    adoptPerKeyApiKey({ ...runningKey, apiKey: 'key-b' }, fake.store),
  ]);

  assert.equal(fake.stored().apiKey, 'key-a');
  assert.equal(resolveApiKey(first, fake.stored()), 'key-a');
  assert.equal(resolveApiKey(second, fake.stored()), 'key-b');
  assert.equal(second.apiKeyIsOverride, true);
});

test('migrateKeyCredentials saves only when the settings changed', async () => {
  const saved: TimerSettings[] = [];
  const action = {
    async setSettings(next: TimerSettings) {
      saved.push(next);
    },
  };
  const logger = { error: () => {} };
  const fake = createStore();

  const migrated = await migrateKeyCredentials(action, runningKey, fake.store, logger);
  assert.equal(saved.length, 1);
  assert.equal(saved[0], migrated);

  await migrateKeyCredentials(action, migrated, fake.store, logger);
  assert.equal(saved.length, 1);
});

test('migrateKeyCredentials keeps the original settings when the global settings fail', async () => {
  const errors: unknown[][] = [];
  const store = new GlobalSettingsStore({
    async load() {
      throw new Error('not connected');
    },
    async save() {},
  });
  let saves = 0;
  const action = {
    async setSettings() {
      saves++;
    },
  };

  const migrated = await migrateKeyCredentials(action, runningKey, store, {
    error: (...args: unknown[]) => errors.push(args),
  });

  assert.equal(migrated, runningKey);
  assert.equal(saves, 0);
  assert.equal(errors.length, 1);
});

test('resolveApiKeyFromStore falls back to the own key when the global settings fail', async () => {
  const errors: unknown[][] = [];
  const store = new GlobalSettingsStore({
    async load() {
      throw new Error('not connected');
    },
    async save() {},
  });
  const logger = { error: (...args: unknown[]) => errors.push(args) };

  assert.equal(await resolveApiKeyFromStore({ apiKey: 'own' }, store, logger), 'own');
  assert.equal(await resolveApiKeyFromStore({}, store, logger), undefined);
  assert.equal(errors.length, 2);
});
