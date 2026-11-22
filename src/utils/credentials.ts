import { createHash } from 'node:crypto';
import type { KeyCredentials, PluginGlobalSettings } from '../types/moneybird.js';
import type { GlobalSettingsStore } from './global-settings.js';
import { logError } from './error-logging.js';

type ErrorLogger = Parameters<typeof logError>[0];

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** The API key a key uses: its own when it has one, otherwise the global key. */
export function resolveApiKey(
  settings: Pick<KeyCredentials, 'apiKey'>,
  global: PluginGlobalSettings
): string | undefined {
  return nonEmpty(settings.apiKey) ?? nonEmpty(global.apiKey);
}

/**
 * Resolves the API key for a key press or refresh. When the global settings cannot be read,
 * the key falls back to its own API key (if any) instead of failing, and the failure is
 * logged.
 */
export async function resolveApiKeyFromStore(
  settings: Pick<KeyCredentials, 'apiKey'>,
  store: GlobalSettingsStore,
  logger: ErrorLogger
): Promise<string | undefined> {
  let global: PluginGlobalSettings = {};
  try {
    global = await store.get();
  } catch (error) {
    logError(logger, "Could not read the global settings; using this key's own API key", error);
  }
  return resolveApiKey(settings, global);
}

/** Hash used to recognise the adopted key later without storing a second copy of it. */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey.trim()).digest('hex');
}

function withoutApiKey<T extends KeyCredentials>(settings: T): T {
  const rest: T = { ...settings };
  delete rest.apiKey;
  return rest;
}

/**
 * Migrates a key that was configured before the global API key existed.
 *
 * - No global key yet: this key's API key becomes the global key (with this key's
 *   administration as the default) and is removed from the key.
 * - The key carries the global key, or the key that was adopted at upgrade (the global key
 *   may have been rotated since): removed from the key, which then follows the global key.
 * - Any other key: kept, and marked as an override, because it is a different API key on
 *   purpose (another Moneybird account).
 *
 * A key that is already an override, or has no API key of its own, is returned as is.
 * Running timer state is never touched.
 */
export async function adoptPerKeyApiKey<T extends KeyCredentials>(
  settings: T,
  store: GlobalSettingsStore
): Promise<T> {
  const ownKey = nonEmpty(settings.apiKey);
  if (!ownKey || settings.apiKeyIsOverride) {
    return settings;
  }

  const ownHash = hashApiKey(ownKey);
  const global = await store.update(current => {
    if (current.apiKey) {
      return current;
    }
    const adopted: PluginGlobalSettings = {
      ...current,
      apiKey: ownKey,
      adoptedApiKeyHash: ownHash,
    };
    if (!current.defaultAdministrationId && settings.administrationId) {
      adopted.defaultAdministrationId = settings.administrationId;
    }
    return adopted;
  });

  if (global.apiKey === ownKey || global.adoptedApiKeyHash === ownHash) {
    return withoutApiKey(settings);
  }

  return { ...settings, apiKeyIsOverride: true };
}

/**
 * Runs the migration for a key that appears and saves the result when it changed. If the
 * global settings cannot be read or written, the key keeps its settings: its own API key
 * still works, and the migration is tried again the next time it appears.
 */
export async function migrateKeyCredentials<T extends KeyCredentials>(
  action: { setSettings(settings: T): Promise<void> },
  settings: T,
  store: GlobalSettingsStore,
  logger: ErrorLogger
): Promise<T> {
  try {
    const migrated = await adoptPerKeyApiKey(settings, store);
    if (migrated !== settings) {
      await action.setSettings(migrated);
    }
    return migrated;
  } catch (error) {
    logError(logger, 'Could not migrate the API key of this key to the global settings', error);
    return settings;
  }
}
