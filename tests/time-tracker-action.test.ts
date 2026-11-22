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

type StopCall = { timeEntryId: string; endedAt: Date; apiKey: string };

let fakeActionCount = 0;

function createFakeAction(initial: TimerSettings) {
  let settings = initial;
  const titles: string[] = [];
  const savedSettings: TimerSettings[] = [];

  return {
    titles,
    savedSettings,
    current: () => settings,
    action: {
      // Unique per test: the settings queue is shared by key id across the whole file.
      id: `instance-${++fakeActionCount}`,
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
  const usedAdministrationIds: Array<string | undefined> = [];
  const lookups: Array<{ apiKey: string; administrationId?: string; userId: string }> = [];
  const entryFetches: string[] = [];
  const state: {
    startTimer: () => Promise<MoneybirdTimeEntry>;
    stopTimer: () => Promise<MoneybirdTimeEntry>;
    startCount: number;
    beforeLists?: () => Promise<void>;
    administrationsDelayMs?: number;
    listLoads?: number;
    administrations?: Array<{ id: string; name: string }>;
    projects?: Array<{ id: string; name: string }>;
    users?: Array<{ id: string; name: string; email: string }>;
    recentEntries?: MoneybirdTimeEntry[];
    lookupError?: Error;
    timeEntry?: Partial<MoneybirdTimeEntry>;
  } = {
    startTimer: async () => ({ id: 'entry-1' }) as MoneybirdTimeEntry,
    stopTimer: async () => ({ id: 'entry-1' }) as MoneybirdTimeEntry,
    startCount: 0,
  };

  const factory: CreateTimerService = (apiKey, administrationId) => {
    usedApiKeys.push(apiKey);
    usedAdministrationIds.push(administrationId);
    return {
      getAdministrations: async () => {
        await new Promise(resolve => setTimeout(resolve, state.administrationsDelayMs ?? 0));
        return state.administrations ?? [];
      },
      getProjects: async () => {
        state.listLoads = (state.listLoads ?? 0) + 1;
        await state.beforeLists?.();
        return state.projects ?? [];
      },
      getUsers: async () => state.users ?? [],
      getContacts: async () => [],
      getRecentTimeEntries: async (userId: string) => {
        lookups.push({ apiKey, administrationId, userId });
        if (state.lookupError) {
          throw state.lookupError;
        }
        return state.recentEntries ?? [];
      },
      getTimeEntry: async (timeEntryId: string) => {
        entryFetches.push(timeEntryId);
        return { id: timeEntryId, ended_at: null, ...state.timeEntry } as MoneybirdTimeEntry;
      },
      startTimer: async () => {
        state.startCount++;
        return state.startTimer();
      },
      stopTimer: async (timeEntryId: string, endedAt: Date = new Date()) => {
        stopCalls.push({ timeEntryId, endedAt, apiKey });
        return state.stopTimer();
      },
    };
  };

  return { factory, state, stopCalls, usedApiKeys, usedAdministrationIds, lookups, entryFetches };
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

function setup(
  settings: TimerSettings,
  globalSettings: PluginGlobalSettings = {},
  { syncLoop = false }: { syncLoop?: boolean } = {}
) {
  const fake = createFakeAction(settings);
  const service = createFakeService();
  const global = createGlobalStore(globalSettings);
  const notices: unknown[] = [];
  const tracker = new TimeTracker(
    service.factory,
    global.store,
    async message => {
      notices.push(message);
    },
    { syncLoop }
  );
  trackers.push({ tracker, action: fake.action });

  const keyDown = () =>
    tracker.onKeyDown({
      action: fake.action,
      payload: { settings: fake.current() },
    } as unknown as KeyDownEvent<TimerSettings>);

  return { fake, service, tracker, keyDown, global, notices };
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

test('a timer started while the administration lists load is kept, and the change refused', async () => {
  const { fake, service, tracker, notices } = setup({ ...configured });
  // Simulates a timer starting while Moneybird answers the projects request. Key presses
  // queue behind the change, so this guards the handler's own re-check.
  service.state.beforeLists = async () => {
    await fake.action.setSettings({
      ...fake.current(),
      isRunning: true,
      startTime: '2026-11-22T10:00:00.000Z',
      timeEntryId: 'entry-7',
      timerAdministrationId: '1',
    });
  };

  await tracker.onSendToPlugin({
    action: fake.action,
    payload: { event: 'administrationSelected', administrationId: '9' },
  } as unknown as SendToPluginEvent<{ event: 'administrationSelected' }, TimerSettings>);

  // The timer started while the lists loaded, so the change is refused after all: the key
  // keeps its administration and selections (#205).
  assert.equal(fake.current().isRunning, true);
  assert.equal(fake.current().timeEntryId, 'entry-7');
  assert.equal(fake.current().timerAdministrationId, '1');
  assert.equal(fake.current().administrationId, '1');
  assert.equal(fake.current().projectId, '2');
  assert.equal(fake.current().userId, '3');
  assert.equal(fake.current().projects, undefined);
  assert.equal(notices.length, 1);
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

const sendAdministration = (tracker: TimeTracker, action: unknown, administrationId: string) =>
  tracker.onSendToPlugin({
    action,
    payload: { event: 'administrationSelected', administrationId },
  } as unknown as SendToPluginEvent<{ event: 'administrationSelected' }, TimerSettings>);

test('starting a timer pins the administration its entry lives in, stopping releases it', async () => {
  const { fake, keyDown } = setup({ ...configured });

  await keyDown();
  assert.equal(fake.current().timerAdministrationId, '1');

  await keyDown();
  assert.equal(fake.current().isRunning, false);
  assert.equal(fake.current().timerAdministrationId, undefined);
});

test('a running timer is stopped in its own administration, even after the key changed', async () => {
  const start = new Date(Date.now() - 60_000);
  const { service, keyDown } = setup(
    runningSince(start, { administrationId: '9', timerAdministrationId: '1' })
  );

  await keyDown();

  assert.equal(service.stopCalls.length, 1);
  assert.deepEqual(service.usedAdministrationIds, ['1']);
});

test('a running timer can be stopped without a project or user selected', async () => {
  const start = new Date(Date.now() - 60_000);
  const { fake, service, keyDown } = setup(runningSince(start, { projectId: '', userId: '' }));

  await keyDown();

  assert.equal(service.stopCalls.length, 1);
  assert.equal(service.stopCalls[0]?.timeEntryId, 'entry-1');
  assert.equal(fake.current().isRunning, false);
  assert.ok(!fake.titles.includes('Config needed'));
});

test('a timer started before this version is stopped in the key administration', async () => {
  const start = new Date(Date.now() - 60_000);
  const { service, keyDown } = setup(runningSince(start));

  await keyDown();

  assert.deepEqual(service.usedAdministrationIds, ['1']);
});

test('auto-stop stops the entry in its own administration', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const start = new Date(Date.now() - 5 * HOUR_MS);
  const { fake, service, tracker } = setup(
    runningSince(start, {
      administrationId: '9',
      timerAdministrationId: '1',
      autoStopEnabled: true,
      autoStopHours: 4,
    })
  );

  await tracker.onWillAppear({
    action: fake.action,
    payload: { settings: fake.current() },
  } as unknown as WillAppearEvent<TimerSettings>);
  mock.timers.tick(1_000);
  await flushPromises();

  assert.equal(service.stopCalls.length, 1);
  assert.deepEqual(service.usedAdministrationIds, ['1']);
});

test('an administration change is refused while the timer runs, and the administration restored', async () => {
  const start = new Date(Date.now() - 60_000);
  const { fake, service, tracker, notices, global } = setup(
    runningSince(start, { timerAdministrationId: '1' })
  );
  // The property inspector already saved the new administration before it told the plugin.
  await fake.action.setSettings({ ...fake.current(), administrationId: '9' });

  await sendAdministration(tracker, fake.action, '9');

  assert.equal(service.state.listLoads ?? 0, 0);
  assert.equal(fake.current().administrationId, '1');
  assert.equal(fake.current().projectId, '2');
  assert.equal(fake.current().userId, '3');
  assert.equal(fake.current().isRunning, true);
  assert.equal(global.stored().defaultAdministrationId, undefined);
  assert.deepEqual(notices, [
    {
      event: 'administrationRejected',
      actionId: fake.action.id,
      message: 'Stop the running timer first to change the administration',
    },
  ]);
});

test('picking the timer administration again while it runs changes nothing', async () => {
  const start = new Date(Date.now() - 60_000);
  const { fake, service, tracker, notices } = setup(
    runningSince(start, { timerAdministrationId: '1' })
  );
  const before = fake.savedSettings.length;

  await sendAdministration(tracker, fake.action, '1');

  assert.equal(service.state.listLoads ?? 0, 0);
  assert.equal(fake.savedSettings.length, before);
  assert.deepEqual(notices, []);
});

/** Simulates the property inspector saving fields while a Moneybird request is in flight. */
const saveMeanwhile = (fake: ReturnType<typeof createFakeAction>) =>
  fake.action.setSettings({
    ...fake.current(),
    description: 'typed meanwhile',
    projects: { p9: { id: 'p9', name: 'Loaded meanwhile' } },
  });

test('fields saved while the start request is in flight are kept', async () => {
  const { fake, service, keyDown } = setup({ ...configured });
  service.state.startTimer = async () => {
    await saveMeanwhile(fake);
    return { id: 'entry-1' } as MoneybirdTimeEntry;
  };

  await keyDown();

  assert.equal(fake.current().isRunning, true);
  assert.equal(fake.current().timeEntryId, 'entry-1');
  assert.equal(fake.current().timerAdministrationId, '1');
  assert.equal(fake.current().description, 'typed meanwhile');
  assert.deepEqual(Object.keys(fake.current().projects ?? {}), ['p9']);
});

test('fields saved while the stop request is in flight are kept', async () => {
  const start = new Date(Date.now() - 60_000);
  const { fake, service, keyDown } = setup(runningSince(start, { timerAdministrationId: '1' }));
  service.state.stopTimer = async () => {
    await saveMeanwhile(fake);
    return { id: 'entry-1' } as MoneybirdTimeEntry;
  };

  await keyDown();

  assert.equal(fake.current().isRunning, false);
  assert.equal('timeEntryId' in fake.current(), false);
  assert.equal('startTime' in fake.current(), false);
  assert.equal('timerAdministrationId' in fake.current(), false);
  assert.equal(fake.current().description, 'typed meanwhile');
  assert.deepEqual(Object.keys(fake.current().projects ?? {}), ['p9']);
});

test('fields saved while an auto-stop request is in flight are kept', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const start = new Date(Date.now() - 5 * HOUR_MS);
  const { fake, service, tracker } = setup(
    runningSince(start, { autoStopEnabled: true, autoStopHours: 4 })
  );
  service.state.stopTimer = async () => {
    await saveMeanwhile(fake);
    return { id: 'entry-1' } as MoneybirdTimeEntry;
  };

  await tracker.onWillAppear({
    action: fake.action,
    payload: { settings: fake.current() },
  } as unknown as WillAppearEvent<TimerSettings>);
  mock.timers.tick(1_000);
  await flushPromises();

  assert.equal(service.stopCalls.length, 1);
  assert.equal(fake.current().isRunning, false);
  assert.equal(fake.current().description, 'typed meanwhile');
});

const slowStart = (service: ReturnType<typeof createFakeService>) => {
  service.state.startTimer = async () => {
    await new Promise(resolve => setTimeout(resolve, 30));
    return { id: 'entry-1' } as MoneybirdTimeEntry;
  };
};

test('a key press right after an administration change waits for it, so no mismatched timer starts', async () => {
  const { fake, service, tracker, keyDown } = setup({ ...configured });
  slowStart(service);

  // The property inspector sends the change, then the key is pressed.
  const change = sendAdministration(tracker, fake.action, '9');
  const press = keyDown();
  await Promise.all([change, press]);

  // The change cleared the project, so the key needs configuration instead of starting a
  // timer in administration 1 while it shows 9.
  assert.equal(service.state.startCount, 0);
  assert.equal(fake.current().administrationId, '9');
  assert.equal(fake.current().isRunning, undefined);
  assert.equal(fake.titles.at(-1), 'Config needed');
});

test('a key press right after an own API key change waits for it', async () => {
  const { fake, service, tracker, keyDown } = setup({ ...configured });
  slowStart(service);
  service.state.administrationsDelayMs = 10;

  const change = tracker.onSendToPlugin({
    action: fake.action,
    payload: { event: 'apiKeyChanged', scope: 'key', apiKey: 'other-account-key' },
  } as unknown as SendToPluginEvent<{ event: 'apiKeyChanged' }, TimerSettings>);
  const press = keyDown();
  await Promise.all([change, press]);

  // The new key cannot open administration 1 (the fake returns none), so the key was
  // cleared before the press was handled: no timer runs behind a key that cannot stop it.
  assert.equal(service.state.startCount, 0);
  assert.equal(fake.current().apiKey, 'other-account-key');
  assert.equal(fake.current().isRunning, undefined);
});

test('an auto-stop that fires during an API key change waits for it and stops with the new key', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const start = new Date(Date.now() - 5 * HOUR_MS);
  const { fake, service, tracker } = setup(
    runningSince(start, { timerAdministrationId: '1', autoStopEnabled: true, autoStopHours: 4 })
  );
  // The new own key can open the timer's administration, but loading takes 2 s.
  service.state.administrations = [{ id: '1', name: 'Main' }];
  service.state.administrationsDelayMs = 2_000;

  await tracker.onWillAppear({
    action: fake.action,
    payload: { settings: fake.current() },
  } as unknown as WillAppearEvent<TimerSettings>);
  const change = tracker.onSendToPlugin({
    action: fake.action,
    payload: { event: 'apiKeyChanged', scope: 'key', apiKey: 'own-2' },
  } as unknown as SendToPluginEvent<{ event: 'apiKeyChanged' }, TimerSettings>);
  // Let the key change reach its (mocked) 2 s administrations request.
  await flushPromises();

  // Auto-stop is due after 1 s, while the key change is still loading.
  mock.timers.tick(1_000);
  await flushPromises();
  assert.equal(service.stopCalls.length, 0);

  mock.timers.tick(1_000);
  await flushPromises();
  await change;
  await flushPromises();

  assert.equal(service.stopCalls.length, 1);
  assert.equal(service.stopCalls[0]?.apiKey, 'own-2');
  assert.equal(fake.current().isRunning, false);
});

test('a press that waits behind a slow list load records the moment of the press', async () => {
  const start = new Date(Date.now() - 60_000);
  const { fake, service, tracker, keyDown } = setup(
    runningSince(start, { timerAdministrationId: '1' })
  );
  service.state.administrations = [{ id: '1', name: 'Main' }];
  service.state.administrationsDelayMs = 60;

  const load = tracker.onSendToPlugin({
    action: fake.action,
    payload: { event: 'loadAdministrations' },
  } as unknown as SendToPluginEvent<{ event: 'loadAdministrations' }, TimerSettings>);
  const pressedAt = Date.now();
  await Promise.all([load, keyDown()]);

  // The stop waited about 60 ms for the load, but ends the entry when the key was pressed.
  const endedAt = service.stopCalls[0]?.endedAt.getTime() ?? 0;
  assert.ok(
    endedAt >= pressedAt && endedAt < pressedAt + 30,
    `ended ${endedAt - pressedAt} ms late`
  );
  assert.equal(fake.current().isRunning, false);
});

test('a start that waits behind a slow list load records the moment of the press', async () => {
  const { fake, service, tracker, keyDown } = setup({ ...configured });
  // The load keeps the key's administration, project and user, so the press can start.
  service.state.administrations = [{ id: '1', name: 'Main' }];
  service.state.projects = [{ id: '2', name: 'Project' }];
  service.state.users = [{ id: '3', name: 'Me', email: 'me@example.com' }];
  service.state.administrationsDelayMs = 60;

  const load = tracker.onSendToPlugin({
    action: fake.action,
    payload: { event: 'loadAdministrations' },
  } as unknown as SendToPluginEvent<{ event: 'loadAdministrations' }, TimerSettings>);
  const pressedAt = Date.now();
  await Promise.all([load, keyDown()]);

  const startedAt = new Date(fake.current().startTime ?? 0).getTime();
  assert.equal(fake.current().isRunning, true);
  assert.ok(
    startedAt >= pressedAt && startedAt < pressedAt + 30,
    `started ${startedAt - pressedAt} ms late`
  );
});

// ---- Timers started or stopped outside the Stream Deck (#197) ----

const MINUTE_MS = 60 * 1000;

function remoteEntry(extra: Partial<MoneybirdTimeEntry> = {}): MoneybirdTimeEntry {
  return {
    id: 'remote-1',
    user_id: '3',
    project_id: '2',
    contact_id: '',
    description: 'Time registration',
    billable: true,
    started_at: new Date(Date.now() - 10 * MINUTE_MS).toISOString(),
    ended_at: null,
    paused_duration: 0,
    created_at: '',
    updated_at: '',
    ...extra,
  } as MoneybirdTimeEntry;
}

async function appear(tracker: TimeTracker, fake: ReturnType<typeof createFakeAction>) {
  await tracker.onWillAppear({
    action: fake.action,
    payload: { settings: fake.current() },
  } as unknown as WillAppearEvent<TimerSettings>);
}

/** A second key on the same tracker, also cleaned up after the test. */
function addKey(tracker: TimeTracker, settings: TimerSettings) {
  const fake = createFakeAction(settings);
  trackers.push({ tracker, action: fake.action });
  return fake;
}

test('an idle key picks up a matching timer started elsewhere', async () => {
  const { fake, service, tracker } = setup({ ...configured });
  const entry = remoteEntry();
  service.state.recentEntries = [entry];
  await appear(tracker, fake);

  await tracker.syncWithMoneybird();

  assert.equal(fake.current().isRunning, true);
  assert.equal(fake.current().timeEntryId, 'remote-1');
  assert.equal(fake.current().startTime, entry.started_at);
  assert.equal(fake.current().timerAdministrationId, '1');
  assert.match(fake.titles.at(-1) ?? '', /⏱️ 10m/);
});

test('pressing a key that picked up a timer stops that entry instead of starting one', async () => {
  const { fake, service, tracker, keyDown } = setup({ ...configured });
  service.state.recentEntries = [remoteEntry()];
  await appear(tracker, fake);
  await tracker.syncWithMoneybird();

  await keyDown();

  assert.equal(service.state.startCount, 0);
  assert.equal(service.stopCalls.length, 1);
  assert.equal(service.stopCalls[0]?.timeEntryId, 'remote-1');
  assert.equal(fake.current().isRunning, false);
});

test('a running key whose entry was stopped elsewhere goes idle without stopping it again', async () => {
  const start = new Date(Date.now() - 30 * MINUTE_MS);
  const { fake, service, tracker } = setup(runningSince(start, { timerAdministrationId: '1' }));
  service.state.recentEntries = [
    remoteEntry({
      id: 'entry-1',
      ended_at: new Date().toISOString(),
      started_at: start.toISOString(),
    }),
  ];
  await appear(tracker, fake);

  await tracker.syncWithMoneybird();

  assert.equal(fake.current().isRunning, false);
  assert.equal('timeEntryId' in fake.current(), false);
  assert.equal(service.stopCalls.length, 0);
});

test('a stop press does not overwrite an end time set elsewhere', async () => {
  const start = new Date(Date.now() - 30 * MINUTE_MS);
  const { fake, service, keyDown } = setup(runningSince(start, { timerAdministrationId: '1' }));
  service.state.timeEntry = { ended_at: new Date(Date.now() - 5 * MINUTE_MS).toISOString() };

  await keyDown();

  assert.deepEqual(service.entryFetches, ['entry-1']);
  assert.equal(service.stopCalls.length, 0);
  assert.equal(fake.current().isRunning, false);
});

test('a failed lookup leaves the keys as they are and shows no error', async () => {
  const start = new Date(Date.now() - 30 * MINUTE_MS);
  const { fake, service, tracker } = setup(runningSince(start, { timerAdministrationId: '1' }));
  service.state.lookupError = new MoneybirdApiError('Server error: 503', 503);
  await appear(tracker, fake);
  const before = fake.savedSettings.length;

  await tracker.syncWithMoneybird();

  assert.equal(fake.savedSettings.length, before);
  assert.equal(fake.current().isRunning, true);
  assert.ok(!fake.titles.includes('Error'));
});

test('keys of one administration and user share one lookup', async () => {
  const { fake, service, tracker } = setup({ ...configured });
  const other = addKey(tracker, { ...configured, projectId: '5' });
  await appear(tracker, fake);
  await appear(tracker, other);

  await tracker.syncWithMoneybird();

  assert.equal(service.lookups.length, 1);
  assert.deepEqual(service.lookups[0], { apiKey: 'key', administrationId: '1', userId: '3' });
});

test('of two keys matching the same entry, the one with the same description picks it up', async () => {
  const { fake, service, tracker } = setup({ ...configured, description: 'Review' });
  const other = addKey(tracker, { ...configured, description: 'Meeting' });
  service.state.recentEntries = [remoteEntry({ description: 'Meeting' })];
  await appear(tracker, fake);
  await appear(tracker, other);

  await tracker.syncWithMoneybird();

  assert.equal(other.current().isRunning, true);
  assert.equal(other.current().timeEntryId, 'remote-1');
  assert.equal(fake.current().isRunning, undefined);
});

test('when two keys match an entry and neither description decides, neither picks it up', async () => {
  const { fake, service, tracker } = setup({ ...configured, description: 'Review' });
  const other = addKey(tracker, { ...configured, description: 'Meeting' });
  service.state.recentEntries = [remoteEntry({ description: 'Something else' })];
  await appear(tracker, fake);
  await appear(tracker, other);

  await tracker.syncWithMoneybird();

  assert.equal(fake.current().isRunning, undefined);
  assert.equal(other.current().isRunning, undefined);
});

test('an entry already shown by another key is not picked up again', async () => {
  const start = new Date(Date.now() - 10 * MINUTE_MS);
  const { fake, service, tracker } = setup(
    runningSince(start, { timeEntryId: 'remote-1', timerAdministrationId: '1' })
  );
  const idle = addKey(tracker, { ...configured });
  service.state.recentEntries = [remoteEntry({ started_at: start.toISOString() })];
  await appear(tracker, fake);
  await appear(tracker, idle);

  await tracker.syncWithMoneybird();

  assert.equal(idle.current().isRunning, undefined);
  assert.equal(fake.current().timeEntryId, 'remote-1');
});

test('a running entry that started more than 24 hours ago is not picked up', async () => {
  const { fake, service, tracker } = setup({ ...configured });
  service.state.recentEntries = [
    remoteEntry({ started_at: new Date(Date.now() - 27 * 24 * 60 * MINUTE_MS).toISOString() }),
  ];
  await appear(tracker, fake);

  await tracker.syncWithMoneybird();

  assert.equal(fake.current().isRunning, undefined);
});

test('a key with another project or user does not pick up the entry', async () => {
  const { fake, service, tracker } = setup({ ...configured, projectId: '5' });
  service.state.recentEntries = [
    remoteEntry(),
    remoteEntry({ id: 'remote-2', user_id: '8', project_id: '5' }),
  ];
  await appear(tracker, fake);

  await tracker.syncWithMoneybird();

  assert.equal(fake.current().isRunning, undefined);
});

test('auto-stop applies to a picked-up timer, counted from its own start', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const startedAt = new Date(Date.now() - 5 * HOUR_MS);
  const { fake, service, tracker } = setup({
    ...configured,
    autoStopEnabled: true,
    autoStopHours: 4,
  });
  service.state.recentEntries = [remoteEntry({ started_at: startedAt.toISOString() })];
  await appear(tracker, fake);

  await tracker.syncWithMoneybird();
  mock.timers.tick(1_000);
  await flushPromises();

  assert.equal(service.stopCalls.length, 1);
  assert.equal(service.stopCalls[0]?.timeEntryId, 'remote-1');
  assert.equal(service.stopCalls[0]?.endedAt.getTime(), startedAt.getTime() + 4 * HOUR_MS);
});

test('keys look up Moneybird shortly after they appear and then every minute', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { fake, service, tracker } = setup({ ...configured }, {}, { syncLoop: true });
  await appear(tracker, fake);
  assert.equal(service.lookups.length, 0);

  mock.timers.tick(1_000);
  await flushPromises();
  assert.equal(service.lookups.length, 1);

  mock.timers.tick(60_000);
  await flushPromises();
  assert.equal(service.lookups.length, 2);

  await tracker.onWillDisappear({
    action: fake.action,
  } as unknown as WillDisappearEvent<TimerSettings>);
  mock.timers.tick(60_000);
  await flushPromises();
  assert.equal(service.lookups.length, 2);
});
