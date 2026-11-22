import { DEFAULT_TIME_ENTRY_DESCRIPTION } from '../services/moneybird/payloads.js';
import type { MoneybirdTimeEntry, TimerSettings } from '../types/moneybird.js';

/**
 * Only running entries that started this recently are picked up. An older one is most
 * likely a forgotten timer: shown on a key, one press would record days of work.
 */
export const PICK_UP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A start this far ahead of the plugin's clock is still taken as clock skew, not more. */
export const CLOCK_SKEW_MS = 2 * 60 * 1000;

export type KeySnapshot = { id: string; settings: TimerSettings };

export type RemoteTimerDecision = {
  /** Idle keys that should show a running entry started elsewhere. */
  pickUp: Array<{ keyId: string; entry: MoneybirdTimeEntry }>;
  /** Running keys whose own entry was stopped elsewhere. */
  endedElsewhere: Array<{ keyId: string; entry: MoneybirdTimeEntry }>;
};

function descriptionOf(settings: TimerSettings): string {
  return settings.description || DEFAULT_TIME_ENTRY_DESCRIPTION;
}

/**
 * Decides what the keys of one administration and user do with that user's recent entries.
 *
 * - A running key whose entry has an `ended_at` was stopped elsewhere.
 * - A running entry that no key shows yet (`shownEntryIds`, across all keys) and that
 *   started within PICK_UP_WINDOW_MS goes to the idle key with the same user and project.
 *   If several keys match, the one with the same description wins; otherwise none does.
 *   A key that would get more than one entry gets none.
 */
export function decideRemoteTimers(
  keys: KeySnapshot[],
  entries: MoneybirdTimeEntry[],
  now: Date,
  shownEntryIds: Set<string>
): RemoteTimerDecision {
  const entriesById = new Map(entries.map(entry => [entry.id, entry]));

  const endedElsewhere = keys.flatMap(key => {
    const entry =
      key.settings.isRunning && key.settings.timeEntryId
        ? entriesById.get(key.settings.timeEntryId)
        : undefined;
    return entry && entry.ended_at ? [{ keyId: key.id, entry }] : [];
  });

  const idleKeys = keys.filter(key => key.settings.isRunning !== true);
  const entriesPerKey = new Map<string, MoneybirdTimeEntry[]>();

  for (const entry of entries) {
    const startedAt = new Date(entry.started_at).getTime();
    const isRecentAndRunning =
      entry.ended_at === null &&
      !shownEntryIds.has(entry.id) &&
      Number.isFinite(startedAt) &&
      now.getTime() - startedAt <= PICK_UP_WINDOW_MS &&
      startedAt - now.getTime() <= CLOCK_SKEW_MS;
    if (!isRecentAndRunning) {
      continue;
    }

    const candidates = idleKeys.filter(
      key => key.settings.userId === entry.user_id && key.settings.projectId === entry.project_id
    );
    const chosen =
      candidates.length > 1
        ? candidates.filter(key => descriptionOf(key.settings) === entry.description)
        : candidates;
    if (chosen.length !== 1) {
      continue;
    }

    const keyId = chosen[0].id;
    entriesPerKey.set(keyId, [...(entriesPerKey.get(keyId) ?? []), entry]);
  }

  const pickUp = Array.from(entriesPerKey.entries()).flatMap(([keyId, keyEntries]) =>
    keyEntries.length === 1 ? [{ keyId, entry: keyEntries[0] }] : []
  );

  return { pickUp, endedElsewhere };
}
