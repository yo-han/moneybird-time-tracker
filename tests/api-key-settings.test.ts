import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyApiKeyEvent,
  type ApiKeyEventPayload,
  type DependentList,
} from '../src/utils/api-key-settings.js';
import { GlobalSettingsStore } from '../src/utils/global-settings.js';
import { MoneybirdApiError } from '../src/services/moneybird/error-handler.js';
import type { JsonValue, PluginGlobalSettings, TimerSettings } from '../src/types/moneybird.js';

type ServiceCall = { apiKey: string; administrationId?: string; method: string };

function createStore(initial: PluginGlobalSettings = {}) {
  let stored: PluginGlobalSettings = { ...initial };
  return {
    stored: () => stored,
    store: new GlobalSettingsStore({
      async load() {
        return { ...stored };
      },
      async save(next) {
        stored = { ...next };
      },
    }),
  };
}

/** Moneybird as seen by one API key: which administrations it can open, and their projects. */
const ACCOUNTS: Record<string, Record<string, string[]>> = {
  'key-a': { '100': ['p1', 'p2'], '200': ['p9'] },
  'key-b': { '100': ['p1'] },
  'key-other-account': { '300': ['p7'] },
};

function createFakeMoneybird() {
  const calls: ServiceCall[] = [];
  const createService = (apiKey: string, administrationId?: string) => ({
    async getAdministrations() {
      calls.push({ apiKey, method: 'getAdministrations' });
      const account = ACCOUNTS[apiKey];
      if (!account) {
        throw new MoneybirdApiError('Authentication failed', 401);
      }
      return Object.keys(account).map(id => ({ id, name: `Admin ${id}` }));
    },
    async getProjects() {
      calls.push({ apiKey, administrationId, method: 'getProjects' });
      return (ACCOUNTS[apiKey]?.[administrationId ?? ''] ?? []).map(id => ({ id, name: id }));
    },
    async getUsers() {
      return [];
    },
    async getContacts() {
      return [];
    },
  });
  return { calls, createService };
}

const projectList: DependentList = {
  list: 'projects',
  selection: 'projectId',
  fetch: async service =>
    Object.fromEntries(
      (await service.getProjects()).map(project => [
        project.id,
        { id: project.id, name: project.name },
      ])
    ) as Record<string, JsonValue>,
};

function createAction(initial: TimerSettings) {
  let settings = initial;
  const saved: TimerSettings[] = [];
  return {
    saved,
    current: () => settings,
    action: {
      async getSettings() {
        return settings;
      },
      async setSettings(next: TimerSettings) {
        settings = next;
        saved.push(next);
      },
    },
  };
}

const logger = { error: () => {}, debug: () => {}, warn: () => {} };

function run(
  action: ReturnType<typeof createAction>,
  payload: ApiKeyEventPayload,
  store: GlobalSettingsStore,
  moneybird: ReturnType<typeof createFakeMoneybird>
) {
  const notices: JsonValue[] = [];
  const result = applyApiKeyEvent(action.action, payload, {
    store,
    logger,
    dependents: [projectList],
    createService: moneybird.createService,
    notify: async message => {
      notices.push(message);
    },
  });
  return { result, notices };
}

const configured: TimerSettings = {
  administrationId: '100',
  projectId: 'p2',
  userId: 'u1',
};

test('a valid new global key is stored and refreshes the lists, keeping selections that still exist', async () => {
  const global = createStore({ apiKey: 'key-a' });
  const action = createAction({ ...configured, projectId: 'p1' });
  const moneybird = createFakeMoneybird();

  const { result, notices } = run(
    action,
    { event: 'apiKeyChanged', scope: 'global', apiKey: ' key-b ' },
    global.store,
    moneybird
  );

  assert.equal(await result, true);
  assert.equal(global.stored().apiKey, 'key-b');
  assert.deepEqual(Object.keys(action.current().administrations ?? {}), ['100']);
  assert.deepEqual(Object.keys(action.current().projects ?? {}), ['p1']);
  assert.equal(action.current().administrationId, '100');
  assert.equal(action.current().projectId, 'p1');
  assert.equal('apiKey' in action.current(), false);
  assert.deepEqual(notices, [{ event: 'apiKeyAccepted', scope: 'global' }]);
});

test('a selection that no longer exists under the new key is cleared', async () => {
  const global = createStore({ apiKey: 'key-a' });
  const action = createAction(configured); // project p2 is not visible to key-b
  const moneybird = createFakeMoneybird();

  await run(
    action,
    { event: 'apiKeyChanged', scope: 'global', apiKey: 'key-b' },
    global.store,
    moneybird
  ).result;

  assert.equal(action.current().projectId, '');
  assert.equal(action.current().userId, 'u1');
});

test('an administration the new key cannot open is cleared with its lists', async () => {
  const global = createStore({ apiKey: 'key-a' });
  const action = createAction({ ...configured, projects: { p2: { id: 'p2', name: 'p2' } } });
  const moneybird = createFakeMoneybird();

  await run(
    action,
    { event: 'apiKeyChanged', scope: 'global', apiKey: 'key-other-account' },
    global.store,
    moneybird
  ).result;

  assert.equal(action.current().administrationId, '');
  assert.deepEqual(action.current().projects, {});
  assert.equal(action.current().projectId, '');
});

test('a rejected global key is not stored and is reported to the property inspector', async () => {
  const global = createStore({ apiKey: 'key-a' });
  const action = createAction(configured);
  const moneybird = createFakeMoneybird();

  const { result, notices } = run(
    action,
    { event: 'apiKeyChanged', scope: 'global', apiKey: 'half-typed' },
    global.store,
    moneybird
  );

  assert.equal(await result, false);
  assert.equal(global.stored().apiKey, 'key-a');
  assert.equal(action.saved.length, 0);
  assert.deepEqual(notices, [
    { event: 'apiKeyRejected', scope: 'global', message: 'Moneybird rejected this API key' },
  ]);
});

test('changing the global key on a key with its own key validates the new key but keeps the own lists', async () => {
  const global = createStore({ apiKey: 'key-a' });
  const action = createAction({ ...configured, apiKey: 'key-a', apiKeyIsOverride: true });
  const moneybird = createFakeMoneybird();

  await run(
    action,
    { event: 'apiKeyChanged', scope: 'global', apiKey: 'key-b' },
    global.store,
    moneybird
  ).result;

  assert.equal(global.stored().apiKey, 'key-b');
  assert.ok(
    moneybird.calls.some(call => call.apiKey === 'key-b' && call.method === 'getAdministrations')
  );
  assert.ok(
    moneybird.calls.every(call => call.method !== 'getProjects' || call.apiKey === 'key-a')
  );
  assert.equal(action.current().apiKey, 'key-a');
  assert.equal(action.current().projectId, 'p2');
});

test('an own key is stored on the key only, marked as override', async () => {
  const global = createStore({ apiKey: 'key-b' });
  const action = createAction(configured);
  const moneybird = createFakeMoneybird();

  await run(
    action,
    { event: 'apiKeyChanged', scope: 'key', apiKey: 'key-a' },
    global.store,
    moneybird
  ).result;

  assert.equal(global.stored().apiKey, 'key-b');
  assert.equal(action.current().apiKey, 'key-a');
  assert.equal(action.current().apiKeyIsOverride, true);
  assert.deepEqual(Object.keys(action.current().projects ?? {}), ['p1', 'p2']);
});

test('removing the own key falls back to the global key', async () => {
  const global = createStore({ apiKey: 'key-b' });
  const action = createAction({
    ...configured,
    projectId: 'p1',
    apiKey: 'key-a',
    apiKeyIsOverride: true,
  });
  const moneybird = createFakeMoneybird();

  await run(action, { event: 'apiKeyChanged', scope: 'key', apiKey: '' }, global.store, moneybird)
    .result;

  assert.equal('apiKey' in action.current(), false);
  assert.equal(action.current().apiKeyIsOverride, false);
  assert.ok(moneybird.calls.every(call => call.apiKey === 'key-b'));
});

test('a new key loads with the global key and preselects the default administration', async () => {
  const global = createStore({ apiKey: 'key-a', defaultAdministrationId: '200' });
  const action = createAction({ administrationId: '', projectId: '', userId: '' });
  const moneybird = createFakeMoneybird();

  assert.equal(
    await run(action, { event: 'loadAdministrations' }, global.store, moneybird).result,
    true
  );

  assert.equal(action.current().administrationId, '200');
  assert.deepEqual(Object.keys(action.current().projects ?? {}), ['p9']);
});

test('loading without any API key does nothing', async () => {
  const global = createStore();
  const action = createAction({ administrationId: '', projectId: '', userId: '' });
  const moneybird = createFakeMoneybird();

  assert.equal(
    await run(action, { event: 'loadAdministrations' }, global.store, moneybird).result,
    false
  );
  assert.equal(action.saved.length, 0);
  assert.equal(moneybird.calls.length, 0);
});

test('a running timer survives a key change', async () => {
  const global = createStore({ apiKey: 'key-a' });
  const running: TimerSettings = {
    ...configured,
    projectId: 'p1',
    isRunning: true,
    startTime: '2026-11-22T09:00:00.000Z',
    timeEntryId: 'entry-1',
  };
  const action = createAction(running);
  const moneybird = createFakeMoneybird();

  await run(
    action,
    { event: 'apiKeyChanged', scope: 'global', apiKey: 'key-b' },
    global.store,
    moneybird
  ).result;

  assert.equal(action.current().isRunning, true);
  assert.equal(action.current().startTime, running.startTime);
  assert.equal(action.current().timeEntryId, 'entry-1');
});

test('an emptied global key field changes nothing', async () => {
  const global = createStore({ apiKey: 'key-a' });
  const action = createAction(configured);
  const moneybird = createFakeMoneybird();

  const { result, notices } = run(
    action,
    { event: 'apiKeyChanged', scope: 'global', apiKey: '   ' },
    global.store,
    moneybird
  );

  assert.equal(await result, false);
  assert.equal(global.stored().apiKey, 'key-a');
  assert.equal(action.saved.length, 0);
  assert.deepEqual(notices, []);
  assert.equal(moneybird.calls.length, 0);
});
