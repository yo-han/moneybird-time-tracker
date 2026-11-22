import assert from 'node:assert/strict';
import test from 'node:test';
import type { KeyDownEvent } from '@elgato/streamdeck';
import { InvoiceSummary, type CreateSummaryService } from '../src/actions/invoice-summary.js';
import { GlobalSettingsStore } from '../src/utils/global-settings.js';
import type {
  InvoiceSettings,
  MoneybirdTimeEntry,
  PluginGlobalSettings,
} from '../src/types/moneybird.js';

const entry = {
  id: 'e1',
  contact_id: '111',
  billable: true,
  started_at: '2026-02-09T09:00:00.000Z',
  ended_at: '2026-02-09T11:00:00.000Z',
  description: 'Work',
  paused_duration: 0,
} as MoneybirdTimeEntry;

function setup(settings: InvoiceSettings, globalSettings: PluginGlobalSettings = {}) {
  const titles: string[] = [];
  const usedApiKeys: string[] = [];
  const factory: CreateSummaryService = apiKey => {
    usedApiKeys.push(apiKey);
    return { getTimeEntriesForContact: async () => [entry] };
  };
  const stored = { ...globalSettings };
  const store = new GlobalSettingsStore({
    async load() {
      return stored;
    },
    async save() {},
  });
  const action = {
    id: 'summary-1',
    async setTitle(title: string) {
      titles.push(title);
    },
    async setImage(_image: string) {},
    async getSettings() {
      return settings;
    },
  };
  const summary = new InvoiceSummary(factory, store);
  const press = () =>
    summary.onKeyDown({
      action,
      payload: { settings },
    } as unknown as KeyDownEvent<InvoiceSettings>);

  return { titles, usedApiKeys, press };
}

const configured: InvoiceSettings = {
  administrationId: '1',
  contactId: '111',
  displayTitle: 'Acme',
};

test('a summary key without an API key of its own uses the global key', async () => {
  const { titles, usedApiKeys, press } = setup(configured, { apiKey: 'global-key' });

  await press();

  assert.deepEqual(usedApiKeys, ['global-key']);
  assert.equal(titles.at(-1), 'Acme\n2.0h');
});

test('a summary key without any API key shows it is not configured', async () => {
  const { titles, usedApiKeys, press } = setup(configured);

  await press();

  assert.deepEqual(usedApiKeys, []);
  assert.equal(titles.at(-1), 'Acme');
});
