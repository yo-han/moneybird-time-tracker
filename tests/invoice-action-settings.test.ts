import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INVOICE_LISTS,
  applyInvoiceAdministrationChange,
} from '../src/utils/invoice-action-settings.js';
import { applyApiKeyEvent } from '../src/utils/api-key-settings.js';
import { GlobalSettingsStore } from '../src/utils/global-settings.js';
import type { InvoiceSettings, PluginGlobalSettings } from '../src/types/moneybird.js';

type MockAction = {
  action: {
    id: string;
    getSettings: () => Promise<InvoiceSettings>;
    setSettings: (settings: InvoiceSettings) => Promise<void>;
  };
  getLastSettings: () => InvoiceSettings | null;
  current: () => InvoiceSettings;
  /** Simulates another writer, such as the property inspector saving a field. */
  write: (settings: InvoiceSettings) => void;
};

let actionCount = 0;

function createAction(initialSettings: InvoiceSettings): MockAction {
  let currentSettings = { ...initialSettings };
  let lastSettings: InvoiceSettings | null = null;

  return {
    current: () => currentSettings,
    write: settings => {
      currentSettings = settings;
    },
    action: {
      id: `invoice-action-${++actionCount}`,
      async getSettings() {
        return currentSettings;
      },
      async setSettings(settings: InvoiceSettings) {
        currentSettings = settings;
        lastSettings = settings;
      },
    },
    getLastSettings() {
      return lastSettings;
    },
  };
}

function createLogger() {
  return {
    debug: (..._args: unknown[]) => {},
    warn: (..._args: unknown[]) => {},
    error: (..._args: unknown[]) => {},
  };
}

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

const twoContacts = () => ({
  async getContacts() {
    return [
      { id: 'c1', company_name: 'Acme', firstname: '', lastname: '' },
      { id: 'c2', company_name: '', firstname: 'Jane', lastname: 'Doe' },
    ];
  },
});

test('applyInvoiceAdministrationChange returns false when no API key is available', async () => {
  const action = createAction({
    apiKey: '',
    administrationId: '',
    contactId: '',
  });

  const updated = await applyInvoiceAdministrationChange(action.action, 'admin-1', {
    logger: createLogger(),
    store: createStore().store,
  });

  assert.equal(updated, false);
  assert.equal(action.getLastSettings(), null);
});

test('applyInvoiceAdministrationChange updates contacts and clears selected contact', async () => {
  const action = createAction({
    apiKey: 'secret',
    administrationId: 'old-admin',
    contactId: 'contact-old',
  });

  const updated = await applyInvoiceAdministrationChange(action.action, 'admin-1', {
    logger: createLogger(),
    store: createStore().store,
    createService: twoContacts,
  });

  assert.equal(updated, true);
  const saved = action.getLastSettings();
  assert.ok(saved);
  assert.equal(saved?.administrationId, 'admin-1');
  assert.equal(saved?.contactId, '');
  assert.equal(typeof saved?.contacts?.c1, 'object');
  assert.equal(typeof saved?.contacts?.c2, 'object');
});

test('applyInvoiceAdministrationChange uses the global key and remembers the administration as default', async () => {
  const action = createAction({ administrationId: '', contactId: '' });
  const global = createStore({ apiKey: 'global-key' });
  const usedKeys: string[] = [];

  const updated = await applyInvoiceAdministrationChange(action.action, 'admin-1', {
    logger: createLogger(),
    store: global.store,
    createService: apiKey => {
      usedKeys.push(apiKey);
      return twoContacts();
    },
  });

  assert.equal(updated, true);
  assert.deepEqual(usedKeys, ['global-key']);
  assert.equal(global.stored().defaultAdministrationId, 'admin-1');
});

test('a field saved while the contacts load is kept', async () => {
  const action = createAction({
    apiKey: 'secret',
    administrationId: 'old-admin',
    contactId: 'contact-old',
  });

  const updated = await applyInvoiceAdministrationChange(action.action, 'admin-1', {
    logger: createLogger(),
    store: createStore().store,
    createService: () => ({
      async getContacts() {
        // The user types a description while Moneybird answers.
        action.write({ ...action.current(), description: 'typed meanwhile' });
        return twoContacts().getContacts();
      },
    }),
  });

  assert.equal(updated, true);
  assert.equal(action.current().description, 'typed meanwhile');
  assert.equal(action.current().administrationId, 'admin-1');
  assert.equal(action.current().contactId, '');
  assert.deepEqual(Object.keys(action.current().contacts ?? {}), ['c1', 'c2']);
});

test('an administration change sent after a slower key event is applied last', async () => {
  const action = createAction({ apiKey: 'secret', administrationId: '100', contactId: '' });
  const global = createStore();
  const createService = () => ({
    async getAdministrations() {
      await new Promise(resolve => setTimeout(resolve, 30));
      return [
        { id: '100', name: 'Main' },
        { id: '200', name: 'Second' },
      ];
    },
    async getProjects() {
      return [];
    },
    async getUsers() {
      return [];
    },
    ...twoContacts(),
  });

  const keyEvent = applyApiKeyEvent(
    action.action,
    { event: 'loadAdministrations' },
    {
      store: global.store,
      logger: createLogger(),
      dependents: INVOICE_LISTS,
      notify: async () => {},
      createService,
    }
  );
  const adminChange = applyInvoiceAdministrationChange(action.action, '200', {
    logger: createLogger(),
    store: global.store,
    createService,
  });
  await Promise.all([keyEvent, adminChange]);

  assert.equal(action.current().administrationId, '200');
});
