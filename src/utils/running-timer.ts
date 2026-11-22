import type { JsonValue } from '../types/moneybird.js';

/**
 * The administration a running timer's entry lives in: the one pinned when it started, or,
 * for a timer started before that was stored, the key's administration.
 */
export function timerAdministrationOf(settings: {
  administrationId?: string;
  timerAdministrationId?: JsonValue;
}): string {
  const pinned = settings.timerAdministrationId;
  if (typeof pinned === 'string' && pinned !== '') {
    return pinned;
  }
  return settings.administrationId ?? '';
}
