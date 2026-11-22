import { MoneybirdService } from '../services/moneybird.js';
import { InvoiceSettings, contactToJson, JsonValue } from '../types/moneybird.js';
import { logError } from './error-logging.js';
import { resolveApiKey } from './credentials.js';
import type { GlobalSettingsStore } from './global-settings.js';
import { rememberDefaultAdministration, type DependentList } from './api-key-settings.js';

type InvoiceSettingsAction = {
  getSettings(): Promise<InvoiceSettings>;
  setSettings(settings: InvoiceSettings): Promise<void>;
};

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

export async function applyInvoiceAdministrationChange(
  action: InvoiceSettingsAction,
  administrationId: string | undefined,
  dependencies: SettingsDependencies
): Promise<boolean> {
  const { logger, store, createService = defaultCreateService } = dependencies;
  const currentSettings = await action.getSettings();
  const apiKey = resolveApiKey(currentSettings, await store.get());

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

    const newSettings: InvoiceSettings = {
      ...currentSettings,
      administrationId,
      contacts,
      contactId: '',
    };

    await action.setSettings(newSettings);
    logger.debug('Settings saved with new data');
    return true;
  } catch (fetchError) {
    logError(logger, 'Error fetching Moneybird data', fetchError);
    return false;
  }
}
