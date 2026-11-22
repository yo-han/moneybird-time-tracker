import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import type {
  KeyDownEvent,
  SendToPluginEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from '@elgato/streamdeck';
import { TimeTracker, type CreateTimerService } from '../src/actions/time-tracker.js';
import { MoneybirdApiError } from '../src/services/moneybird/error-handler.js';
import { GlobalSettingsStore } from '../src/utils/global-settings.js';
import type {
  MoneybirdTimeEntry,
  PluginGlobalSettings,
  TimerSettings,
} from '../src/types/moneybird.js';

const HOUR_MS = 60 * 60 * 1000;

type StopCall = { timeEntryId: string; endedAt: Date };

function createFakeAction(initial: TimerSettings) {
  let settings = initial;
  const titles: string[] = [];
  const savedSettings: TimerSettings[] = [];

  return {
    titles,
    savedSettings,
    current: () => settings,
    action: {
      id: 'instance-1',
      isKey: () => true,
      async setTitle(title: string) {
        titles.push(title);
      },
      async setImage(_image: string) {},
      async getSettings() {
        return settings;
      },
      async setSettings(next: TimerSettings) {
        settings = next;
        savedSettings.push(next);
      },
    },
  };
}

function createFakeService() {
  const stopCalls: StopCall[] = [];
  const usedApiKeys: string[] = [];
  const state: {
    startTimer: () => Promise<MoneybirdTimeEntry>;
    stopTimer: () => Promise<MoneybirdTimeEntry>;
    startCount: number;
    beforeLists?: () => Promise<void>;
    administrationsDelayMs?: number;
  } = {
    startTimer: async () => ({ id: 'entry-1' }) as MoneybirdTimeEntry,
    stopTimer: async () => ({ id: 'entry-1' }) as MoneybirdTimeEntry,
    startCount: 0,
  };

  const factory: CreateTimerService = apiKey => {
    usedApiKeys.push(apiKey);
    return {
      getAdministrations: async () => {
        await new Promise(resolve => setTimeout(resolve, state.administrationsDelayMs ?? 0));
        return [];
      },
      getProjects: async () => {
        await state.beforeLists?.();
        return [];
      },
      getUsers: async () => [],
      getContacts: async () => [],
      startTimer: async () => {
        state.startCount++;
        return state.startTimer();
      },
      stopTimer: async (timeEntryId: string, endedAt: Date = new Date()) => {
        stopCalls.push({ timeEntryId, endedAt });
        return state.stopTimer();
      },
    };
  };

  return { factory, state, stopCalls, usedApiKeys };
}

const configured: TimerSettings = {
  apiKey: 'key',
  administrationId: '1',
  projectId: '2',
  userId: '3',
};

function runningSince(startTime: Date, extra: Partial<TimerSettings> = {}): TimerSettings {
  return {
    ...configured,
    isRunning: true,
    startTime: startTime.toISOString(),
    timeEntryId: 'entry-1',
    ...extra,
  };
}

const trackers: Array<{ tracker: TimeTracker; action: unknown }> = [];

function createGlobalStore(initial: PluginGlobalSettings = {}) {
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

function setup(settings: TimerSettings, globalSettings: PluginGlobalSettings = {}) {
  const fake = createFakeAction(settings);
  const service = createFakeService();
  const global = createGlobalStore(globalSettings);
  const tracker = new TimeTracker(service.factory, global.store);
  trackers.push({ tracker, action: fake.action });

  const keyDown = () =>
    tracker.onKeyDown({
      action: fake.action,
      payload: { settings: fake.current() },
    } as unknown as KeyDownEvent<TimerSettings>);

  return { fake, service, tracker, keyDown, global };
}

afterEach(async () => {
  // Clear intervals and timeouts so the test process can exit.
  for (const { tracker, action } of trackers.splice(0)) {
    await tracker.onWillDisappear({ action } as unknown as WillDisappearEvent<TimerSettings>);
  }
  mock.timers.reset();
});

test('a failed stop keeps the running state so the next press can retry', async () => {
  const { fake, service, keyDown } = setup(runningSince(new Date(Date.now() - 60_000)));
  service.state.stopTimer = async () => {
    throw new MoneybirdApiError('Server error: 503', 503);
  };

  await keyDown();

  assert.equal(service.stopCalls.length, 1);
  assert.equal(fake.savedSettings.length, 0);
  assert.equal(fake.current().isRunning, true);
  assert.equal(fake.current().timeEntryId, 'entry-1');
  assert.equal(fake.titles.at(-1), 'Error');
});

test('an auth failure on stop also keeps the running state', async () => {
  const { fake, service, keyDown } = setup(runningSince(new Date(Date.now() - 60_000)));
  service.state.stopTimer = async () => {
    throw new MoneybirdApiError('Authentication failed', 401);
  };

  await keyDown();

  assert.equal(fake.current().isRunning, true);
});

test('a permanent rejection on stop releases the key', async () => {
  for (const status of [404, 422]) {
    const { fake, service, keyDown } = setup(runningSince(new Date(Date.now() - 60_000)));
    service.state.stopTimer = async () => {
      throw new MoneybirdApiError('rejected', status);
    };

    await keyDown();

    assert.equal(fake.current().isRunning, false, `status ${status}`);
    assert.equal(fake.current().timeEntryId, undefined, `status ${status}`);
  }
});

test('a second press while the start request is in flight is ignored', async () => {
  const { fake, service, keyDown } = setup({ ...configured });
  // Release every pending start at once, so a missing guard shows up as a second start
  // call instead of a press that never finishes.
  const pending: Array<(entry: MoneybirdTimeEntry) => void> = [];
  service.state.startTimer = () => new Promise(resolve => pending.push(resolve));

  const first = keyDown();
  const second = keyDown();
  await new Promise(resolve => setImmediate(resolve));
  for (const finishStart of pending.splice(0)) {
    finishStart({ id: 'entry-1' } as MoneybirdTimeEntry);
  }
  await Promise.all([first, second]);

  assert.equal(service.state.startCount, 1);
  assert.equal(fake.current().isRunning, true);
  assert.equal(fake.current().timeEntryId, 'entry-1');
});

test('a manual stop after the auto-stop limit ends the entry at the limit', async () => {
  const start = new Date(Date.now() - 10 * HOUR_MS);
  const { service, keyDown } = setup(
    runningSince(start, { autoStopEnabled: true, autoStopHours: 4 })
  );

  await keyDown();

  assert.equal(service.stopCalls[0]?.endedAt.getTime(), start.getTime() + 4 * HOUR_MS);
});

test('a manual stop without auto-stop ends the entry now', async () => {
  const start = new Date(Date.now() - 10 * HOUR_MS);
  const { service, keyDown } = setup(runningSince(start));
  const before = Date.now();

  await keyDown();

  assert.ok((service.stopCalls[0]?.endedAt.getTime() ?? 0) >= before);
});

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

test('auto-stop ends the entry at the limit and does not retry a failure in a loop', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const start = new Date(Date.now() - 5 * HOUR_MS);
  const { fake, service, tracker } = setup(
    runningSince(start, { autoStopEnabled: true, autoStopHours: 4 })
  );
  service.state.stopTimer = async () => {
    throw new MoneybirdApiError('Server error: 500', 500);
  };

  await tracker.onWillAppear({
    action: fake.action,
    payload: { settings: fake.current() },
  } as unknown as WillAppearEvent<TimerSettings>);

  mock.timers.tick(1_000);
  await flushPromises();
  assert.equal(service.stopCalls.length, 1);
  assert.equal(service.stopCalls[0]?.endedAt.getTime(), start.getTime() + 4 * HOUR_MS);

  // Error flash, redraw, and plenty of time for a retry loop to show up.
  for (let i = 0; i < 30; i++) {
    mock.timers.tick(1_000);
    await flushPromises();
  }

  assert.equal(service.stopCalls.length, 1);
  assert.equal(fake.current().isRunning, true);
});

test('a successful auto-stop resets the key', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const start = new Date(Date.now() - 5 * HOUR_MS);
  const { fake, service, tracker } = setup(
    runningSince(start, { autoStopEnabled: true, autoStopHours: 4 })
  );

  await tracker.onWillAppear({
    action: fake.action,
    payload: { settings: fake.current() },
  } as unknown as WillAppearEvent<TimerSettings>);
  mock.timers.tick(1_000);
  await flushPromises();

  assert.equal(service.stopCalls.length, 1);
  assert.equal(fake.current().isRunning, false);
  assert.ok(fake.titles.includes('Auto-stopped'));
});

test('a key without an API key of its own starts the timer with the global key', async () => {
  const { fake, service, keyDown } = setup(
    { administrationId: '1', projectId: '2', userId: '3' },
    { apiKey: 'global-key' }
  );

  await keyDown();

  assert.equal(service.state.startCount, 1);
  assert.deepEqual(service.usedApiKeys, ['global-key']);
  assert.equal(fake.current().isRunning, true);
});

test('a key without any API key shows that it needs configuration', async () => {
  const { fake, service, keyDown } = setup({
    administrationId: '1',
    projectId: '2',
    userId: '3',
  });

  await keyDown();

  assert.equal(service.state.startCount, 0);
  assert.deepEqual(service.usedApiKeys, []);
  assert.equal(fake.titles.at(-1), 'Config needed');
});

test('a key with its own key keeps using it next to a global key', async () => {
  const { service, keyDown } = setup(
    { ...configured, apiKey: 'own-key', apiKeyIsOverride: true },
    { apiKey: 'global-key' }
  );

  await keyDown();

  assert.deepEqual(service.usedApiKeys, ['own-key']);
});

test('a running key that appears hands its API key to the global settings and keeps running', async () => {
  const start = new Date(Date.now() - 60_000);
  const { fake, tracker, global } = setup(runningSince(start));

  await tracker.onWillAppear({
    action: fake.action,
    payload: { settings: fake.current() },
  } as unknown as WillAppearEvent<TimerSettings>);

  assert.equal(global.stored().apiKey, 'key');
  assert.equal('apiKey' in fake.current(), false);
  assert.equal(fake.current().isRunning, true);
  assert.equal(fake.current().timeEntryId, 'entry-1');
  assert.equal(fake.current().startTime, start.toISOString());
});

test('auto-stop stops the entry with the global key', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const start = new Date(Date.now() - 5 * HOUR_MS);
  const { fake, service, tracker } = setup(
    runningSince(start, { apiKey: '', autoStopEnabled: true, autoStopHours: 4 }),
    { apiKey: 'global-key' }
  );

  await tracker.onWillAppear({
    action: fake.action,
    payload: { settings: fake.current() },
  } as unknown as WillAppearEvent<TimerSettings>);
  mock.timers.tick(1_000);
  await flushPromises();

  assert.equal(service.stopCalls.length, 1);
  assert.deepEqual(service.usedApiKeys, ['global-key']);
});

test('a timer started while the administration lists load is kept', async () => {
  const { fake, service, tracker } = setup({ ...configured });
  // The key is pressed while Moneybird answers the projects request.
  service.state.beforeLists = async () => {
    await fake.action.setSettings({
      ...fake.current(),
      isRunning: true,
      startTime: '2026-11-22T10:00:00.000Z',
      timeEntryId: 'entry-7',
    });
  };

  await tracker.onSendToPlugin({
    action: fake.action,
    payload: { event: 'administrationSelected', administrationId: '9' },
  } as unknown as SendToPluginEvent<{ event: 'administrationSelected' }, TimerSettings>);

  assert.equal(fake.current().administrationId, '9');
  assert.deepEqual(fake.current().projects, {});
  assert.equal(fake.current().isRunning, true);
  assert.equal(fake.current().timeEntryId, 'entry-7');
});

test('an administration change sent after a slower list load is applied last', async () => {
  const { fake, service, tracker } = setup({ ...configured });
  // The property inspector opens (load lists, slow), then the user picks an administration.
  service.state.administrationsDelayMs = 30;
  const send = (payload: Record<string, string>) =>
    tracker.onSendToPlugin({
      action: fake.action,
      payload,
    } as unknown as SendToPluginEvent<{ event: 'administrationSelected' }, TimerSettings>);

  await Promise.all([
    send({ event: 'loadAdministrations' }),
    send({ event: 'administrationSelected', administrationId: '9' }),
  ]);

  assert.equal(fake.current().administrationId, '9');
});
