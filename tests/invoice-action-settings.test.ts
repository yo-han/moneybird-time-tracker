import assert from 'node:assert/strict';
import test from 'node:test';
import { applyInvoiceAdministrationChange } from '../src/utils/invoice-action-settings.js';
import { GlobalSettingsStore } from '../src/utils/global-settings.js';
import type { InvoiceSettings, PluginGlobalSettings } from '../src/types/moneybird.js';

type MockAction = {
  action: {
    getSettings: () => Promise<InvoiceSettings>;
    setSettings: (settings: InvoiceSettings) => Promise<void>;
  };
  getLastSettings: () => InvoiceSettings | null;
};

function createAction(initialSettings: InvoiceSettings): MockAction {
  let currentSettings = { ...initialSettings };
  let lastSettings: InvoiceSettings | null = null;

  return {
    action: {
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
