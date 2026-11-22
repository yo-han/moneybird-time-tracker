import { MoneybirdService } from '../services/moneybird.js';
import { MoneybirdApiError } from '../services/moneybird/error-handler.js';
import {
  administrationToJson,
  type JsonValue,
  type KeyCredentials,
  type PluginGlobalSettings,
} from '../types/moneybird.js';
import type { GlobalSettingsStore } from './global-settings.js';
import { logError } from './error-logging.js';
import { resolveApiKey } from './credentials.js';

/**
 * Messages a property inspector sends about the API key.
 * - `apiKeyChanged` with `scope: 'global'`: the shared key was edited. It is stored only
 *   after Moneybird accepted it, so a half typed key never replaces the key of every button.
 * - `apiKeyChanged` with `scope: 'key'`: this key's own key was edited; empty removes it.
 * - `loadAdministrations`: the property inspector opened without lists to show.
 */
export type ApiKeyEventPayload = {
  event?: 'apiKeyChanged' | 'loadAdministrations' | 'administrationSelected';
  scope?: 'global' | 'key';
  apiKey?: string;
  administrationId?: string;
};

export type ListService = Pick<
  MoneybirdService,
  'getAdministrations' | 'getProjects' | 'getUsers' | 'getContacts'
>;

/** A list that depends on the selected administration, and the setting that selects from it. */
export type DependentList = {
  list: string;
  selection: string;
  fetch: (service: ListService) => Promise<Record<string, JsonValue>>;
};

type SettingsAction<T> = {
  getSettings(): Promise<T>;
  setSettings(settings: T): Promise<void>;
};

type Logger = Parameters<typeof logError>[0];

export type ApiKeyEventDependencies = {
  store: GlobalSettingsStore;
  logger: Logger;
  dependents: DependentList[];
  notify: (message: JsonValue) => Promise<void>;
  createService?: (apiKey: string, administrationId?: string) => ListService;
};

function defaultCreateService(apiKey: string, administrationId?: string): ListService {
  return new MoneybirdService(apiKey, administrationId);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function describeRejection(error: unknown): string {
  if (error instanceof MoneybirdApiError && (error.status === 401 || error.status === 403)) {
    return 'Moneybird rejected this API key';
  }
  return 'Could not load administrations';
}

/**
 * Loads the administrations an API key can open and, for the administration to show, the
 * lists that depend on it. Selections that still exist are kept; an administration the key
 * cannot open is cleared together with its lists.
 */
async function loadLists<T extends KeyCredentials>(
  settings: T,
  apiKey: string,
  administrationId: string,
  dependents: DependentList[],
  createService: NonNullable<ApiKeyEventDependencies['createService']>
): Promise<T> {
  const administrations = Object.fromEntries(
    (await createService(apiKey).getAdministrations()).map(admin => [
      admin.id,
      administrationToJson(admin),
    ])
  ) as Record<string, JsonValue>;

  const next: Record<string, JsonValue | undefined> = { ...settings, administrations };

  if (administrationId && administrationId in administrations) {
    const service = createService(apiKey, administrationId);
    const lists = await Promise.all(dependents.map(dependent => dependent.fetch(service)));
    next.administrationId = administrationId;
    dependents.forEach((dependent, index) => {
      next[dependent.list] = lists[index];
      const selected = settings[dependent.selection];
      if (typeof selected === 'string' && selected !== '' && !(selected in lists[index])) {
        next[dependent.selection] = '';
      }
    });
  } else {
    next.administrationId = '';
    for (const dependent of dependents) {
      next[dependent.list] = {};
      next[dependent.selection] = '';
    }
  }

  return next as T;
}

function withOwnKey<T extends KeyCredentials>(settings: T, ownKey: string | undefined): T {
  if (ownKey) {
    return { ...settings, apiKey: ownKey, apiKeyIsOverride: true };
  }
  const rest: T = { ...settings, apiKeyIsOverride: false };
  delete rest.apiKey;
  return rest;
}

/**
 * Handles an API key message from a property inspector. Returns true when the key's
 * settings were updated.
 */
export async function applyApiKeyEvent<T extends KeyCredentials>(
  action: SettingsAction<T>,
  payload: ApiKeyEventPayload,
  dependencies: ApiKeyEventDependencies
): Promise<boolean> {
  const { store, logger, dependents, notify, createService = defaultCreateService } = dependencies;
  const settings = await action.getSettings();
  const global: PluginGlobalSettings = await store.get();
  const scope = payload.scope === 'key' ? 'key' : 'global';
  const isChange = payload.event === 'apiKeyChanged';
  const typedKey = nonEmpty(payload.apiKey);

  if (isChange && scope === 'global' && !typedKey) {
    // An emptied field does not remove the key from every button.
    return false;
  }

  // The key whose lists this button shows after the change.
  const listKey = !isChange
    ? resolveApiKey(settings, global)
    : scope === 'global'
      ? (nonEmpty(settings.apiKey) ?? typedKey)
      : (typedKey ?? nonEmpty(global.apiKey));

  try {
    if (isChange && scope === 'global' && listKey !== typedKey && typedKey) {
      // This button has a key of its own, so its lists stay; only validate the new key.
      await createService(typedKey).getAdministrations();
    }

    let next = settings;
    if (listKey) {
      const administrationId = settings.administrationId || global.defaultAdministrationId || '';
      next = await loadLists(settings, listKey, administrationId, dependents, createService);
    } else if (!isChange) {
      return false;
    }

    if (isChange && scope === 'global' && typedKey) {
      await store.update(current =>
        current.apiKey === typedKey ? current : { ...current, apiKey: typedKey }
      );
    }
    if (isChange && scope === 'key') {
      next = withOwnKey(next, typedKey);
    }

    await action.setSettings(next);
    if (isChange) {
      await notify({ event: 'apiKeyAccepted', scope });
    }
    return true;
  } catch (error) {
    logError(logger, 'Could not load Moneybird administrations', error, { scope });
    await notify({ event: 'apiKeyRejected', scope, message: describeRejection(error) });
    return false;
  }
}

/** Makes the administration picked in a property inspector the default for new keys. */
export async function rememberDefaultAdministration(
  store: GlobalSettingsStore,
  administrationId: string,
  logger: Logger
): Promise<void> {
  try {
    await store.update(current =>
      current.defaultAdministrationId === administrationId
        ? current
        : { ...current, defaultAdministrationId: administrationId }
    );
  } catch (error) {
    logError(logger, 'Could not save the default administration', error, { administrationId });
  }
}
