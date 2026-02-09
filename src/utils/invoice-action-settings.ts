import { MoneybirdService } from '../services/moneybird.js';
import {
  InvoiceSettings,
  administrationToJson,
  contactToJson,
  JsonValue,
} from '../types/moneybird.js';

type InvoiceSettingsAction = {
  getSettings(): Promise<InvoiceSettings>;
  setSettings(settings: InvoiceSettings): Promise<void>;
};

type InvoiceLogger = {
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type MoneybirdSettingsService = Pick<MoneybirdService, 'getAdministrations' | 'getContacts'>;

type SettingsDependencies = {
  logger: InvoiceLogger;
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

function mapAdministrationsToSettings(
  administrations: Awaited<ReturnType<MoneybirdSettingsService['getAdministrations']>>
) {
  return Object.fromEntries(
    administrations.map(administration => [administration.id, administrationToJson(administration)])
  ) as Record<string, JsonValue>;
}

export async function applyInvoiceAdministrationChange(
  action: InvoiceSettingsAction,
  administrationId: string | undefined,
  dependencies: SettingsDependencies
): Promise<boolean> {
  const { logger, createService = defaultCreateService } = dependencies;
  const currentSettings = await action.getSettings();

  logger.debug(`handleAdministrationChange called with administrationId: ${administrationId}`);

  if (!currentSettings.apiKey || !administrationId) {
    logger.debug('Missing apiKey or administrationId, aborting');
    return false;
  }

  try {
    logger.debug('Fetching contacts...');
    const moneybirdService = createService(currentSettings.apiKey, administrationId);
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
    logger.error('Error fetching Moneybird data:', {
      message: (fetchError as Error).message,
      stack: (fetchError as Error).stack,
    });
    return false;
  }
}

export async function applyInvoiceGlobalSettings(
  action: InvoiceSettingsAction,
  apiKey: string | undefined,
  dependencies: SettingsDependencies
): Promise<boolean> {
  const { logger, createService = defaultCreateService } = dependencies;
  const currentSettings = await action.getSettings();

  if (!apiKey) {
    logger.warn('No API key provided');
    return false;
  }

  try {
    const moneybirdService = createService(apiKey);
    const administrations = mapAdministrationsToSettings(
      await moneybirdService.getAdministrations()
    );
    logger.debug(`Fetched ${Object.keys(administrations).length} administrations`);

    const newSettings: InvoiceSettings = {
      ...currentSettings,
      apiKey,
      administrations,
      displayTitle: currentSettings.displayTitle,
    };

    await action.setSettings(newSettings);
    return true;
  } catch (fetchError) {
    logger.error('Error fetching Moneybird data:', {
      message: (fetchError as Error).message,
      stack: (fetchError as Error).stack,
    });

    const clearedSettings: InvoiceSettings = {
      ...currentSettings,
      apiKey,
      administrations: {},
      contacts: {},
    };
    await action.setSettings(clearedSettings);
    return false;
  }
}
