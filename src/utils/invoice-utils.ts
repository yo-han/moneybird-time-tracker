import {
  endOfMonth,
  endOfQuarter,
  endOfYear,
  format,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subMonths,
} from 'date-fns';
import { calculateEntryDurationHours } from './time-entry-utils.js';

export type InvoicePeriodType = 'month' | 'quarter' | 'year';
export type InvoicePeriodRange = 'current' | 'last';
export type InvoicePeriodKey =
  | 'current_month'
  | 'last_month'
  | 'current_quarter'
  | 'last_quarter'
  | 'current_year'
  | 'last_year';

export type InvoicePeriodSettings = {
  periodType?: InvoicePeriodType;
  periodRange?: InvoicePeriodRange;
  period?: string;
};

export type TimeEntryLike = {
  started_at: string;
  ended_at: string | null;
  paused_duration: number;
};

export function resolvePeriodKey(settings: InvoicePeriodSettings): InvoicePeriodKey {
  if (settings.periodType && settings.periodRange) {
    const range = settings.periodRange === 'last' ? 'last' : 'current';
    return `${range}_${settings.periodType}` as InvoicePeriodKey;
  }

  if (
    settings.period === 'last_month' ||
    settings.period === 'current_quarter' ||
    settings.period === 'last_quarter' ||
    settings.period === 'current_year' ||
    settings.period === 'last_year'
  ) {
    return settings.period;
  }

  return 'current_month';
}

export function getPeriodLabel(periodKey: InvoicePeriodKey): string {
  switch (periodKey) {
    case 'last_month':
      return 'Last Month';
    case 'current_quarter':
      return 'This Quarter';
    case 'last_quarter':
      return 'Last Quarter';
    case 'current_year':
      return 'This Year';
    case 'last_year':
      return 'Last Year';
    default:
      return 'This Month';
  }
}

export function getPeriodRange(
  now: Date,
  periodKey: InvoicePeriodKey
): {
  startDate: Date;
  endDate: Date;
  description: string;
} {
  switch (periodKey) {
    case 'last_month': {
      const lastMonth = subMonths(now, 1);
      return {
        startDate: startOfMonth(lastMonth),
        endDate: endOfMonth(lastMonth),
        description: format(lastMonth, 'MMMM yyyy'),
      };
    }
    case 'current_quarter':
      return {
        startDate: startOfQuarter(now),
        endDate: endOfQuarter(now),
        description: `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`,
      };
    case 'last_quarter': {
      const lastQuarter = subMonths(now, 3);
      return {
        startDate: startOfQuarter(lastQuarter),
        endDate: endOfQuarter(lastQuarter),
        description: `Q${Math.floor(lastQuarter.getMonth() / 3) + 1} ${lastQuarter.getFullYear()}`,
      };
    }
    case 'current_year':
      return {
        startDate: startOfYear(now),
        endDate: endOfYear(now),
        description: format(now, 'yyyy'),
      };
    case 'last_year': {
      const lastYear = subMonths(now, 12);
      return {
        startDate: startOfYear(lastYear),
        endDate: endOfYear(lastYear),
        description: format(lastYear, 'yyyy'),
      };
    }
    default:
      return {
        startDate: startOfMonth(now),
        endDate: endOfMonth(now),
        description: format(now, 'MMMM yyyy'),
      };
  }
}

export function parseHourlyRate(hourlyRate: number | string | undefined, fallback = 75): number {
  const parsed = parseFloat(String(hourlyRate).replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function calculateTotalHours(timeEntries: TimeEntryLike[]): number {
  return timeEntries.reduce((total, entry) => {
    return total + calculateEntryDurationHours(entry);
  }, 0);
}
