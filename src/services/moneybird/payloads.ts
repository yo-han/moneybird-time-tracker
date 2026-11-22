import { format } from 'date-fns';
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

/** Description of an entry started without one; also how a key without one is matched. */
export const DEFAULT_TIME_ENTRY_DESCRIPTION = 'Time registration';

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
      description: settings.description || DEFAULT_TIME_ENTRY_DESCRIPTION,
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

const MONEYBIRD_ID_PATTERN = /^\d+$/;

/**
 * Builds the `filter` query value for the time entries index. Moneybird filters on contact
 * and period server side, so pagination only has to walk the entries that matter.
 * The contact id is validated because it is interpolated into a comma separated filter.
 */
export function buildTimeEntriesFilter(contactId: string, startDate: Date, endDate: Date): string {
  if (!MONEYBIRD_ID_PATTERN.test(contactId)) {
    throw new Error(`Invalid Moneybird contact id: "${contactId}"`);
  }

  return `period:${format(startDate, 'yyyyMMdd')}..${format(endDate, 'yyyyMMdd')},contact_id:${contactId},state:all`;
}

/**
 * Builds the `filter` for every entry of one user in a period, running ones included
 * (`include_active`; Moneybird leaves entries without `ended_at` out by default). The period
 * is matched on the start date. The user id is validated because it is interpolated.
 */
export function buildRecentTimeEntriesFilter(userId: string, since: Date, until: Date): string {
  if (!MONEYBIRD_ID_PATTERN.test(userId)) {
    throw new Error(`Invalid Moneybird user id: "${userId}"`);
  }

  return `period:${format(since, 'yyyyMMdd')}..${format(until, 'yyyyMMdd')},state:all,include_active:true,user_id:${userId}`;
}

export type BillableEntryFilterOptions = {
  /** Drop entries that are already on a sales invoice, so they are never billed twice. */
  excludeInvoiced?: boolean;
};

export function filterBillableContactEntries(
  entries: MoneybirdTimeEntry[],
  contactId: string,
  options: BillableEntryFilterOptions = {}
): MoneybirdTimeEntry[] {
  return entries.filter(
    entry =>
      entry.contact_id === contactId &&
      entry.billable === true &&
      entry.ended_at !== null &&
      !(options.excludeInvoiced && entry.sales_invoice_id)
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
