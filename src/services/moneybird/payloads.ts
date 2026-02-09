import type { MoneybirdTimeEntry, TimerSettings } from '../../types/moneybird.js';
import { formatMoneybirdDate, groupTimeEntriesByDescription } from '../../utils/moneybird-utils.js';

function resolveBillable(settings: TimerSettings): boolean {
  if (settings.billable === undefined) {
    return true;
  }

  if (typeof settings.billable === 'string') {
    return settings.billable === 'true';
  }

  return settings.billable;
}

export function buildStartTimerPayload(
  settings: TimerSettings,
  now: Date
): {
  time_entry: {
    started_at: string;
    user_id: string;
    project_id: string;
    contact_id: string | null;
    description: string;
    billable: boolean;
  };
} {
  return {
    time_entry: {
      started_at: formatMoneybirdDate(now),
      user_id: settings.userId,
      project_id: settings.projectId,
      contact_id: settings.contactId || null,
      description: settings.description || 'Time registration',
      billable: resolveBillable(settings),
    },
  };
}

export function buildStopTimerPayload(now: Date): {
  time_entry: { ended_at: string };
} {
  return {
    time_entry: {
      ended_at: formatMoneybirdDate(now),
    },
  };
}

export function filterBillableContactEntries(
  entries: MoneybirdTimeEntry[],
  contactId: string
): MoneybirdTimeEntry[] {
  return entries.filter(
    entry => entry.contact_id === contactId && entry.billable === true && entry.ended_at !== null
  );
}

export function buildInvoicePayload(
  contactId: string,
  timeEntries: MoneybirdTimeEntry[],
  description: string,
  workflowId: string | undefined,
  hourlyRate: number
): {
  sales_invoice: {
    contact_id: string;
    reference: string;
    details_attributes: Array<{
      description: string;
      price: string;
      amount: string;
      row_order: number;
    }>;
    workflow_id: string | undefined;
    prices_are_incl_tax: false;
  };
} {
  const groupedEntries = groupTimeEntriesByDescription(timeEntries);

  const detailsAttributes = groupedEntries.map((group, index) => ({
    description: group.description,
    price: hourlyRate.toFixed(2),
    amount: `${group.totalHours.toFixed(2)} uur`,
    row_order: index,
  }));

  return {
    sales_invoice: {
      contact_id: contactId,
      reference: description,
      details_attributes: detailsAttributes,
      workflow_id: workflowId,
      prices_are_incl_tax: false,
    },
  };
}

export function buildTimeEntryInvoiceLinkPayload(invoiceId: string): {
  time_entry: { sales_invoice_id: string };
} {
  return {
    time_entry: {
      sales_invoice_id: invoiceId,
    },
  };
}
