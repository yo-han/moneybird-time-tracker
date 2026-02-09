import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyInvoiceAdministrationChange,
  applyInvoiceGlobalSettings,
} from '../src/utils/invoice-action-settings.js';
import type { InvoiceSettings } from '../src/types/moneybird.js';

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

test('applyInvoiceAdministrationChange returns false when required settings are missing', async () => {
  const action = createAction({
    apiKey: '',
    administrationId: '',
    contactId: '',
  });

  const updated = await applyInvoiceAdministrationChange(action.action, 'admin-1', {
    logger: createLogger(),
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
    createService: () => ({
      async getContacts() {
        return [
          { id: 'c1', company_name: 'Acme', firstname: '', lastname: '' },
          { id: 'c2', company_name: '', firstname: 'Jane', lastname: 'Doe' },
        ];
      },
      async getAdministrations() {
        return [];
      },
    }),
  });

  assert.equal(updated, true);
  const saved = action.getLastSettings();
  assert.ok(saved);
  assert.equal(saved?.administrationId, 'admin-1');
  assert.equal(saved?.contactId, '');
  assert.equal(typeof saved?.contacts?.c1, 'object');
  assert.equal(typeof saved?.contacts?.c2, 'object');
});

test('applyInvoiceGlobalSettings stores administrations for a valid API key', async () => {
  const action = createAction({
    apiKey: '',
    administrationId: '',
    contactId: '',
  });

  const updated = await applyInvoiceGlobalSettings(action.action, 'new-key', {
    logger: createLogger(),
    createService: () => ({
      async getAdministrations() {
        return [
          { id: 'a1', name: 'Main' },
          { id: 'a2', name: 'Second' },
        ];
      },
      async getContacts() {
        return [];
      },
    }),
  });

  assert.equal(updated, true);
  const saved = action.getLastSettings();
  assert.ok(saved);
  assert.equal(saved?.apiKey, 'new-key');
  assert.equal(typeof saved?.administrations?.a1, 'object');
  assert.equal(typeof saved?.administrations?.a2, 'object');
});

test('applyInvoiceGlobalSettings clears options on fetch failure', async () => {
  const action = createAction({
    apiKey: '',
    administrationId: '',
    contactId: '',
    administrations: { old: { id: 'old' } },
    contacts: { old: { id: 'old' } },
  });

  const updated = await applyInvoiceGlobalSettings(action.action, 'new-key', {
    logger: createLogger(),
    createService: () => ({
      async getAdministrations() {
        throw new Error('boom');
      },
      async getContacts() {
        return [];
      },
    }),
  });

  assert.equal(updated, false);
  const saved = action.getLastSettings();
  assert.ok(saved);
  assert.equal(saved?.apiKey, 'new-key');
  assert.deepEqual(saved?.administrations, {});
  assert.deepEqual(saved?.contacts, {});
});
