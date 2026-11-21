import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { KeyDownEvent, KeyUpEvent, WillDisappearEvent } from '@elgato/streamdeck';
import { InvoiceCreator, type CreateInvoiceService } from '../src/actions/invoice-creator.js';
import type { CreatedInvoice } from '../src/services/moneybird.js';
import type { BillableEntryFilterOptions } from '../src/services/moneybird/payloads.js';
import type {
  InvoiceSettings,
  MoneybirdSalesInvoice,
  MoneybirdTimeEntry,
} from '../src/types/moneybird.js';

const settings: InvoiceSettings = {
  apiKey: 'key',
  administrationId: '1',
  contactId: '111',
  hourlyRate: '90',
};

const entry = {
  id: 'e1',
  contact_id: '111',
  billable: true,
  started_at: '2026-02-09T09:00:00.000Z',
  ended_at: '2026-02-09T10:00:00.000Z',
  description: 'Work',
  paused_duration: 0,
} as MoneybirdTimeEntry;

function setup() {
  const titles: string[] = [];
  const fetchOptions: Array<BillableEntryFilterOptions | undefined> = [];
  const state: {
    createInvoice: () => Promise<CreatedInvoice>;
    createCount: number;
  } = {
    createInvoice: async () => ({
      invoice: { id: 'inv-1' } as MoneybirdSalesInvoice,
      unlinkedEntryIds: [],
    }),
    createCount: 0,
  };

  const factory: CreateInvoiceService = () => ({
    getTimeEntriesForContact: async (_contactId, _start, _end, options) => {
      fetchOptions.push(options);
      return [entry];
    },
    createInvoiceFromTimeEntries: async () => {
      state.createCount++;
      return state.createInvoice();
    },
  });

  const action = {
    id: 'invoice-1',
    isKey: () => true,
    async setTitle(title: string) {
      titles.push(title);
    },
    async setImage(_image: string) {},
    async getSettings() {
      return settings;
    },
    async setSettings(_next: InvoiceSettings) {},
  };

  const creator = new InvoiceCreator(factory);
  const event = { action, payload: { settings } };

  const shortPress = async () => {
    await creator.onKeyDown(event as unknown as KeyDownEvent<InvoiceSettings>);
    await creator.onKeyUp(event as unknown as KeyUpEvent<InvoiceSettings>);
  };

  created.push(async () =>
    creator.onWillDisappear({ action } as unknown as WillDisappearEvent<InvoiceSettings>)
  );

  return { titles, fetchOptions, state, shortPress, creator, event };
}

const created: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of created.splice(0)) {
    await cleanup();
  }
});

test('invoice creator only fetches hours that are not invoiced yet', async () => {
  const { fetchOptions, shortPress, titles } = setup();

  await shortPress();

  assert.deepEqual(fetchOptions, [{ excludeInvoiced: true }]);
  assert.ok(titles.includes('✓ Created'));
});

test('a second press while an invoice is being created is ignored', async () => {
  const { state, creator, event } = setup();
  let finish: (result: CreatedInvoice) => void = () => {};
  state.createInvoice = () =>
    new Promise(resolve => {
      finish = resolve;
    });

  await creator.onKeyDown(event as unknown as KeyDownEvent<InvoiceSettings>);
  const first = creator.onKeyUp(event as unknown as KeyUpEvent<InvoiceSettings>);
  // Let the first press reach the create call before pressing again.
  await new Promise(resolve => setImmediate(resolve));
  await creator.onKeyDown(event as unknown as KeyDownEvent<InvoiceSettings>);
  await creator.onKeyUp(event as unknown as KeyUpEvent<InvoiceSettings>);

  finish({ invoice: { id: 'inv-1' } as MoneybirdSalesInvoice, unlinkedEntryIds: [] });
  await first;

  assert.equal(state.createCount, 1);
});

test('unlinked hours are shown on the key instead of a plain success', async () => {
  const { state, shortPress, titles } = setup();
  state.createInvoice = async () => ({
    invoice: { id: 'inv-1' } as MoneybirdSalesInvoice,
    unlinkedEntryIds: ['e1'],
  });

  await shortPress();

  assert.ok(titles.some(title => title.includes('Check hours')));
  assert.ok(!titles.includes('✓ Created'));
});
