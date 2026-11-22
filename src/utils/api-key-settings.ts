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
import {
  runInOrder,
  writePatch,
  type SettingsAction,
  type SettingsPatch,
} from './settings-writes.js';

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

type Logger = Parameters<typeof logError>[0];

export type ApiKeyEventDependencies = {
  store: GlobalSettingsStore;
  logger: Logger;
  dependents: DependentList[];
  notify: (message: JsonValue) => Promise<void>;
  createService?: (apiKey: string, administrationId?: string) => ListService;
};

type Scope = 'global' | 'key';

/**
 * Thrown when a key change would leave this key's running timer behind an API key that
 * cannot open its administration: the entry could then no longer be stopped from the key.
 */
export class RunningTimerUnreachableError extends Error {
  constructor(administrationId: string) {
    super(
      `Stop the running timer first: this API key cannot open its administration (${administrationId})`
    );
    this.name = 'RunningTimerUnreachableError';
  }
}

function defaultCreateService(apiKey: string, administrationId?: string): ListService {
  return new MoneybirdService(apiKey, administrationId);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function describeFailure(error: unknown): string {
  if (error instanceof RunningTimerUnreachableError) {
    return error.message;
  }
  if (error instanceof MoneybirdApiError && (error.status === 401 || error.status === 403)) {
    return 'Moneybird rejected this API key';
  }
  return 'Could not load administrations';
}

/**
 * Loads the administrations an API key can open and, for the administration to show, the
 * lists that depend on it. Returns the changes to apply, not a full settings object.
 *
 * Selections that still exist are kept; an administration the key cannot open is cleared
 * with its lists. A key with a running timer keeps its selections, and refuses an API key
 * that cannot open the timer's administration.
 */
async function loadLists(
  settings: KeyCredentials,
  apiKey: string,
  administrationId: string,
  dependents: DependentList[],
  createService: NonNullable<ApiKeyEventDependencies['createService']>
): Promise<SettingsPatch> {
  const isRunning = settings.isRunning === true;
  const administrations = Object.fromEntries(
    (await createService(apiKey).getAdministrations()).map(admin => [
      admin.id,
      administrationToJson(admin),
    ])
  ) as Record<string, JsonValue>;

  const values: Record<string, JsonValue> = { administrations };

  if (administrationId && administrationId in administrations) {
    const service = createService(apiKey, administrationId);
    const lists = await Promise.all(dependents.map(dependent => dependent.fetch(service)));
    values.administrationId = administrationId;
    dependents.forEach((dependent, index) => {
      values[dependent.list] = lists[index];
      const selected = settings[dependent.selection];
      if (
        !isRunning &&
        typeof selected === 'string' &&
        selected !== '' &&
        !(selected in lists[index])
      ) {
        values[dependent.selection] = '';
      }
    });
    return { values };
  }

  if (isRunning && settings.administrationId) {
    throw new RunningTimerUnreachableError(settings.administrationId);
  }

  values.administrationId = '';
  for (const dependent of dependents) {
    values[dependent.list] = {};
    values[dependent.selection] = '';
  }
  return { values };
}

/**
 * Handles an API key message from a property inspector. Returns true when the change was
 * applied. Every outcome of a change is reported back with `apiKeyAccepted` or
 * `apiKeyRejected`, addressed to this key's property inspector by `actionId`.
 */
export function applyApiKeyEvent<T extends KeyCredentials>(
  action: SettingsAction<T>,
  payload: ApiKeyEventPayload,
  dependencies: ApiKeyEventDependencies
): Promise<boolean> {
  return runInOrder(action.id, () => handleApiKeyEvent(action, payload, dependencies));
}

async function handleApiKeyEvent<T extends KeyCredentials>(
  action: SettingsAction<T>,
  payload: ApiKeyEventPayload,
  dependencies: ApiKeyEventDependencies
): Promise<boolean> {
  const { store, logger, dependents, notify, createService = defaultCreateService } = dependencies;
  const typedKey = nonEmpty(payload.apiKey);
  const isChange = payload.event === 'apiKeyChanged';
  const changeScope: Scope = payload.scope === 'key' ? 'key' : 'global';

  const report = async (scope: Scope, error?: unknown): Promise<false> => {
    logError(logger, 'Could not apply the Moneybird API key', error, {
      actionId: action.id,
      scope,
    });
    await notify({
      event: 'apiKeyRejected',
      scope,
      actionId: action.id,
      message: describeFailure(error),
    });
    return false;
  };
  const accept = (scope: Scope) => notify({ event: 'apiKeyAccepted', scope, actionId: action.id });

  if (isChange && changeScope === 'global' && !typedKey) {
    // An emptied field does not remove the key from every button.
    return false;
  }

  let settings: T;
  let global: PluginGlobalSettings;
  try {
    settings = await action.getSettings();
    global = await store.get();
  } catch (error) {
    return report(changeScope, error);
  }

  const ownKey = nonEmpty(settings.apiKey);
  const administrationId = settings.administrationId || global.defaultAdministrationId || '';
  const load = (apiKey: string) =>
    loadLists(settings, apiKey, administrationId, dependents, createService);

  if (isChange && changeScope === 'global' && typedKey) {
    try {
      if (ownKey) {
        // This key uses its own key, so its lists stay as they are: only check the new
        // shared key before storing it.
        await createService(typedKey).getAdministrations();
        await store.update(current =>
          current.apiKey === typedKey ? current : { ...current, apiKey: typedKey }
        );
      } else {
        const patch = await load(typedKey);
        await store.update(current =>
          current.apiKey === typedKey ? current : { ...current, apiKey: typedKey }
        );
        await writePatch(action, patch);
      }
      await accept('global');
      return true;
    } catch (error) {
      return report('global', error);
    }
  }

  if (isChange && changeScope === 'key' && typedKey) {
    try {
      const patch = await load(typedKey);
      await writePatch(action, {
        values: { ...patch.values, apiKey: typedKey, apiKeyIsOverride: true },
      });
      await accept('key');
      return true;
    } catch (error) {
      return report('key', error);
    }
  }

  if (isChange && changeScope === 'key') {
    return removeOwnKey(action, settings, nonEmpty(global.apiKey), load, report, accept);
  }

  // loadAdministrations
  const listKey = resolveApiKey(settings, global);
  if (!listKey) {
    return false;
  }
  try {
    await writePatch(action, await load(listKey));
    return true;
  } catch (error) {
    return report(ownKey ? 'key' : 'global', error);
  }
}

/**
 * Falls back from this key's own API key to the shared key. The own key is removed even when
 * the shared key's lists cannot be loaded, so an untick never silently fails; only a running
 * timer is checked first, because it must stay reachable with the key that will stop it.
 */
async function removeOwnKey<T extends KeyCredentials>(
  action: SettingsAction<T>,
  settings: T,
  sharedKey: string | undefined,
  load: (apiKey: string) => Promise<SettingsPatch>,
  report: (scope: Scope, error?: unknown) => Promise<false>,
  accept: (scope: Scope) => Promise<void>
): Promise<boolean> {
  const removal: SettingsPatch = { values: { apiKeyIsOverride: false }, remove: ['apiKey'] };

  if (settings.isRunning === true) {
    if (!sharedKey) {
      return report('key', new RunningTimerUnreachableError(settings.administrationId));
    }
    try {
      const patch = await load(sharedKey);
      await writePatch(action, {
        values: { ...patch.values, ...removal.values },
        remove: ['apiKey'],
      });
      await accept('key');
      return true;
    } catch (error) {
      return report('key', error);
    }
  }

  try {
    await writePatch(action, removal);
  } catch (error) {
    return report('key', error);
  }
  await accept('key');

  if (!sharedKey) {
    return true;
  }
  try {
    await writePatch(action, await load(sharedKey));
    return true;
  } catch (error) {
    // The own key is gone, so the change itself was applied; the lists of the shared key
    // load on the next try. The failure is shown under the shared key field.
    await report('global', error);
    return true;
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
