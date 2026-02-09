import type { MoneybirdTimeEntry } from '../types/moneybird.js';
import { calculateEntryDurationHours } from './time-entry-utils.js';

type GroupedTimeEntries = {
  description: string;
  totalHours: number;
  entries: MoneybirdTimeEntry[];
};

export function formatMoneybirdDate(date: Date): string {
  const pad = (num: number) => num.toString().padStart(2, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const offset = -date.getTimezoneOffset();
  const offsetHours = Math.floor(Math.abs(offset) / 60);
  const offsetMinutes = Math.abs(offset) % 60;
  const offsetSign = offset >= 0 ? '+' : '-';

  return `${year}-${month}-${day} ${hours}:${minutes}:00 ${offsetSign}${pad(offsetHours)}:${pad(offsetMinutes)}`;
}

export function groupTimeEntriesByDescription(
  timeEntries: MoneybirdTimeEntry[]
): GroupedTimeEntries[] {
  const groups = new Map<string, GroupedTimeEntries>();

  for (const entry of timeEntries) {
    if (!entry.ended_at) {
      continue;
    }

    const key = entry.description || 'Werkzaamheden';
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        description: key,
        totalHours: 0,
        entries: [],
      });
    }

    const hours = calculateEntryDurationHours(entry);

    const group = groups.get(key);
    if (!group) {
      continue;
    }
    group.totalHours += hours;
    group.entries.push(entry);
  }

  return Array.from(groups.values());
}
