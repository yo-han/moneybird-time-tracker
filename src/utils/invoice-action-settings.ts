import { MoneybirdService } from '../services/moneybird.js';
import { InvoiceSettings, contactToJson, JsonValue } from '../types/moneybird.js';
import { logError } from './error-logging.js';
import { resolveApiKeyFromStore } from './credentials.js';
import type { GlobalSettingsStore } from './global-settings.js';
import { rememberDefaultAdministration, type DependentList } from './api-key-settings.js';
import { runInOrder, writePatch, type SettingsAction } from './settings-writes.js';

type InvoiceSettingsAction = SettingsAction<InvoiceSettings>;

type InvoiceLogger = {
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type MoneybirdSettingsService = Pick<MoneybirdService, 'getContacts'>;

type SettingsDependencies = {
  logger: InvoiceLogger;
  store: GlobalSettingsStore;
  createService?: (apiKey: string, administrationId?: string) => MoneybirdSettingsService;
};

function defaultCreateService(apiKey: string, administrationId?: string): MoneybirdSettingsService {
  return new MoneybirdService(apiKey, administrationId);
}

function mapContactsToSettings(
  contacts: Awaited<ReturnType<MoneybirdSettingsService['getContacts']>>
) {
  return Object.fromEntries(
    contacts.map(contact => [contact.id, contactToJson(contact)])
  ) as Record<string, JsonValue>;
}

/** The lists in the invoice property inspectors that depend on the administration. */
export const INVOICE_LISTS: DependentList[] = [
  {
    list: 'contacts',
    selection: 'contactId',
    fetch: async service => mapContactsToSettings(await service.getContacts()),
  },
];

/**
 * Loads the contacts of the picked administration. Runs in the key's queue with the API key
 * events, and writes only its own fields onto the settings as they are once the contacts are
 * in, so a field saved meanwhile is kept.
 */
export function applyInvoiceAdministrationChange(
  action: InvoiceSettingsAction,
  administrationId: string | undefined,
  dependencies: SettingsDependencies
): Promise<boolean> {
  return runInOrder(action.id, () =>
    loadInvoiceAdministration(action, administrationId, dependencies)
  );
}

async function loadInvoiceAdministration(
  action: InvoiceSettingsAction,
  administrationId: string | undefined,
  dependencies: SettingsDependencies
): Promise<boolean> {
  const { logger, store, createService = defaultCreateService } = dependencies;
  const currentSettings = await action.getSettings();
  const apiKey = await resolveApiKeyFromStore(currentSettings, store, logger);

  logger.debug(`handleAdministrationChange called with administrationId: ${administrationId}`);

  if (!apiKey || !administrationId) {
    logger.debug('Missing apiKey or administrationId, aborting');
    return false;
  }

  await rememberDefaultAdministration(store, administrationId, logger);

  try {
    logger.debug('Fetching contacts...');
    const moneybirdService = createService(apiKey, administrationId);
    const contacts = mapContactsToSettings(await moneybirdService.getContacts());

    await writePatch(action, { values: { administrationId, contacts, contactId: '' } });
    logger.debug('Settings saved with new data');
    return true;
  } catch (fetchError) {
    logError(logger, 'Error loading the administration contacts', fetchError);
    return false;
  }
}
