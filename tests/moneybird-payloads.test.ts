import assert from 'node:assert/strict';
import test from 'node:test';
import type { MoneybirdTimeEntry } from '../src/types/moneybird.js';
import {
  buildInvoicePayload,
  buildStartTimerPayload,
  buildStopTimerPayload,
  buildTimeEntryInvoiceLinkPayload,
  filterBillableContactEntries,
} from '../src/services/moneybird/payloads.js';

test('buildStartTimerPayload maps settings with defaults', () => {
  const payload = buildStartTimerPayload(
    {
      apiKey: 'key',
      administrationId: 'admin',
      projectId: 'project-1',
      userId: 'user-1',
      description: '',
    },
    new Date('2026-02-09T12:34:00.000Z')
  );

  assert.equal(payload.time_entry.user_id, 'user-1');
  assert.equal(payload.time_entry.project_id, 'project-1');
  assert.equal(payload.time_entry.contact_id, null);
  assert.equal(payload.time_entry.description, 'Time registration');
  assert.equal(payload.time_entry.billable, true);
});

test('buildStopTimerPayload sets ended_at', () => {
  const payload = buildStopTimerPayload(new Date('2026-02-09T12:34:00.000Z'));
  assert.equal(typeof payload.time_entry.ended_at, 'string');
  assert.equal(payload.time_entry.ended_at.includes('2026-02-09'), true);
});

test('filterBillableContactEntries filters by contact, billable and ended_at', () => {
  const entries: MoneybirdTimeEntry[] = [
    {
      id: '1',
      contact_id: 'c1',
      billable: true,
      ended_at: 'x',
      description: 'a',
      started_at: '2026-02-09T10:00:00.000Z',
      user_id: 'u',
      project_id: 'p',
      paused_duration: 0,
      created_at: 'x',
      updated_at: 'x',
    },
    {
      id: '2',
      contact_id: 'c2',
      billable: true,
      ended_at: 'x',
      description: 'a',
      started_at: '2026-02-09T10:00:00.000Z',
      user_id: 'u',
      project_id: 'p',
      paused_duration: 0,
      created_at: 'x',
      updated_at: 'x',
    },
    {
      id: '3',
      contact_id: 'c1',
      billable: false,
      ended_at: 'x',
      description: 'a',
      started_at: '2026-02-09T10:00:00.000Z',
      user_id: 'u',
      project_id: 'p',
      paused_duration: 0,
      created_at: 'x',
      updated_at: 'x',
    },
    {
      id: '4',
      contact_id: 'c1',
      billable: true,
      ended_at: null,
      description: 'a',
      started_at: '2026-02-09T10:00:00.000Z',
      user_id: 'u',
      project_id: 'p',
      paused_duration: 0,
      created_at: 'x',
      updated_at: 'x',
    },
  ];

  const filtered = filterBillableContactEntries(
    entries,
    'c1'
  );

  assert.deepEqual(filtered.map(entry => entry.id), ['1']);
});

test('buildInvoicePayload groups entries and builds rows', () => {
  const timeEntries: MoneybirdTimeEntry[] = [
    {
      id: 'a',
      contact_id: 'contact-1',
      billable: true,
      description: 'Dev',
      started_at: '2026-02-09T10:00:00.000Z',
      ended_at: '2026-02-09T11:00:00.000Z',
      paused_duration: 0,
      user_id: 'u',
      project_id: 'p',
      created_at: 'x',
      updated_at: 'x',
    },
    {
      id: 'b',
      contact_id: 'contact-1',
      billable: true,
      description: 'Dev',
      started_at: '2026-02-09T11:00:00.000Z',
      ended_at: '2026-02-09T12:00:00.000Z',
      paused_duration: 1800,
      user_id: 'u',
      project_id: 'p',
      created_at: 'x',
      updated_at: 'x',
    },
  ];

  const payload = buildInvoicePayload(
    'contact-1',
    timeEntries,
    'Werkzaamheden februari',
    'wf-1',
    80
  );

  assert.equal(payload.sales_invoice.contact_id, 'contact-1');
  assert.equal(payload.sales_invoice.reference, 'Werkzaamheden februari');
  assert.equal(payload.sales_invoice.workflow_id, 'wf-1');
  assert.equal(payload.sales_invoice.details_attributes.length, 1);
  assert.equal(payload.sales_invoice.details_attributes[0]?.description, 'Dev');
  assert.equal(payload.sales_invoice.details_attributes[0]?.price, '80.00');
  assert.equal(payload.sales_invoice.details_attributes[0]?.amount, '1.50 uur');
});

test('buildTimeEntryInvoiceLinkPayload sets invoice id', () => {
  const payload = buildTimeEntryInvoiceLinkPayload('inv-1');
  assert.equal(payload.time_entry.sales_invoice_id, 'inv-1');
});
