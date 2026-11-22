import type { JsonObject, JsonValue } from '../types/moneybird.js';

/** The part of a Stream Deck action that reads and writes its settings. */
export type SettingsAction<T> = {
  id: string;
  getSettings(): Promise<T>;
  setSettings(settings: T): Promise<void>;
};

/** Settings to merge into the key's latest settings, and keys to remove from them. */
export type SettingsPatch = {
  values: Record<string, JsonValue>;
  remove?: string[];
};

/**
 * Tasks for one key, the messages its property inspector sends (API key changes,
 * administration changes), run one after another in the order they were sent. Otherwise
 * a slow request could finish after a later quick one and undo it.
 */
const queues = new Map<string, Promise<unknown>>();

export function runInOrder<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(task);
  // A failed task rejects for its own caller only; the next task still runs.
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) {
      queues.delete(key);
    }
  });
  return run;
}

/**
 * Applies a patch to the key's settings as they are now, read right before the write. A
 * handler that read the settings before a Moneybird request and wrote that copy back
 * afterwards would undo anything saved meanwhile, such as a timer started by a key press.
 */
export async function writePatch<T extends JsonObject>(
  action: SettingsAction<T>,
  patch: SettingsPatch
): Promise<void> {
  const next: T = { ...(await action.getSettings()), ...patch.values };
  for (const key of patch.remove ?? []) {
    delete next[key];
  }
  await action.setSettings(next);
}
