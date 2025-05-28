import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  SendToPluginEvent,
  DidReceiveSettingsEvent,
} from '@elgato/streamdeck';
import { MoneybirdService } from '../services/moneybird';
import { InvoiceSettings, administrationToJson, contactToJson } from '../types/moneybird';
import {
  startOfMonth,
  endOfMonth,
  format,
  subMonths,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  endOfYear,
} from 'date-fns';
import path from 'path';

@action({ UUID: 'com.johan-kuijt.moneybird-timer.invoice-creator' })
export class InvoiceCreator extends SingletonAction<InvoiceSettings> {
  private longPressTimer?: NodeJS.Timeout;
  private isLongPress = false;
  private previewUpdateInterval?: NodeJS.Timeout;

  private getImagePath(type: 'default' | 'success' | 'error'): string {
    const baseDir = 'imgs/actions/invoice';
    const imageName = `key_${type}.png`;
    return path.join(baseDir, imageName);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<InvoiceSettings>): Promise<void> {
    try {
      const settings = ev.payload.settings;
      const instanceId = ev.action.id;

      if (settings.displayTitle !== undefined || settings.period !== undefined) {
        // Update title with period info if configured
        if (settings.apiKey && settings.administrationId && settings.contactId) {
          const periodLabel = this.getPeriodLabel(settings.period || 'current_month');
          const displayTitle = settings.displayTitle || 'Invoice';
          await ev.action.setTitle(`${displayTitle}\n${periodLabel}`);
        } else {
          const title = settings.displayTitle || 'Invoice';
          await ev.action.setTitle(String(title));
        }
      }

      streamDeck.logger.debug(`Invoice settings updated for instance ${instanceId}:`, settings);
    } catch (error) {
      streamDeck.logger.error('Error in onDidReceiveSettings:', error);
    }
  }

  override async onSendToPlugin(ev: SendToPluginEvent<any, InvoiceSettings>): Promise<void> {
    try {
      streamDeck.logger.debug(
        'Invoice plugin received SendToPlugin message:',
        JSON.stringify(ev.payload, null, 2)
      );

      if (ev.payload?.event === 'setGlobalSettings') {
        await this.handleGlobalSettings(ev);
      } else if (ev.payload?.event === 'administrationSelected') {
        await this.handleAdministrationChange(ev);
      }
    } catch (error) {
      streamDeck.logger.error('Unexpected error in onSendToPlugin:', {
        message: (error as Error).message,
        stack: (error as Error).stack,
      });
    }
  }

  private async handleAdministrationChange(
    ev: SendToPluginEvent<any, InvoiceSettings>
  ): Promise<void> {
    const { administrationId } = ev.payload;
    const currentSettings = await ev.action.getSettings();

    streamDeck.logger.debug(
      `handleAdministrationChange called with administrationId: ${administrationId}`
    );

    if (!currentSettings.apiKey || !administrationId) {
      streamDeck.logger.debug('Missing apiKey or administrationId, aborting');
      return;
    }

    try {
      const moneybirdService = new MoneybirdService(currentSettings.apiKey, administrationId);

      streamDeck.logger.debug('Fetching contacts...');
      const rawContacts = await moneybirdService.getContacts();

      const contacts = Object.fromEntries(
        rawContacts.map(contact => [contact.id, contactToJson(contact)])
      );

      streamDeck.logger.debug(
        `Fetched ${rawContacts.length} contacts for administration ${administrationId}`
      );

      const newSettings: InvoiceSettings = {
        ...currentSettings,
        administrationId,
        contacts,
        contactId: '',
      };

      await ev.action.setSettings(newSettings);
      streamDeck.logger.debug('Settings saved with new data');
    } catch (fetchError) {
      streamDeck.logger.error('Error fetching Moneybird data:', {
        message: (fetchError as Error).message,
        stack: (fetchError as Error).stack,
        response: (fetchError as any).response?.data,
      });
    }
  }

  private async handleGlobalSettings(ev: SendToPluginEvent<any, InvoiceSettings>): Promise<void> {
    const { apiKey } = ev.payload;
    const currentSettings = await ev.action.getSettings();

    if (!apiKey) {
      streamDeck.logger.warn('No API key provided');
      return;
    }

    try {
      const moneybirdService = new MoneybirdService(apiKey);

      const rawAdministrations = await moneybirdService.getAdministrations();
      const administrations = Object.fromEntries(
        rawAdministrations.map(admin => [admin.id, administrationToJson(admin)])
      );
      streamDeck.logger.debug(`Fetched ${rawAdministrations.length} administrations`);

      const newSettings: InvoiceSettings = {
        ...currentSettings,
        apiKey,
        administrations,
        displayTitle: currentSettings.displayTitle,
      };

      await ev.action.setSettings(newSettings);
    } catch (fetchError) {
      streamDeck.logger.error('Error fetching Moneybird data:', {
        message: (fetchError as Error).message,
        stack: (fetchError as Error).stack,
        response: (fetchError as any).response?.data,
      });

      const clearedSettings = {
        ...currentSettings,
        apiKey,
        administrations: {},
        contacts: {},
      };
      await ev.action.setSettings(clearedSettings);
    }
  }

  override async onWillAppear(ev: WillAppearEvent<InvoiceSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const instanceId = ev.action.id;

    streamDeck.logger.debug(
      `Invoice action appeared with settings for instance ${instanceId}:`,
      settings
    );

    await ev.action.setImage(this.getImagePath('default'));

    // Show period in title if configured
    if (settings.apiKey && settings.administrationId && settings.contactId) {
      const periodLabel = this.getPeriodLabel(settings.period || 'current_month');
      const displayTitle = settings.displayTitle || 'Invoice';
      await ev.action.setTitle(`${displayTitle}\n${periodLabel}`);
    } else {
      const title = settings.displayTitle ? settings.displayTitle : 'Invoice';
      await ev.action.setTitle(String(title));
    }
  }

  private getPeriodLabel(period: string): string {
    switch (period) {
      case 'last_month':
        return 'Last Month';
      case 'current_quarter':
        return 'This Quarter';
      case 'last_quarter':
        return 'Last Quarter';
      case 'current_year':
        return 'This Year';
      default:
        return 'This Month';
    }
  }

  override async onKeyDown(ev: KeyDownEvent<InvoiceSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const instanceId = ev.action.id;

    streamDeck.logger.debug(
      `Invoice key pressed for instance ${instanceId} with settings:`,
      settings
    );

    if (!settings.apiKey || !settings.administrationId || !settings.contactId) {
      streamDeck.logger.debug('Missing required settings');
      await ev.action.setImage(this.getImagePath('default'));
      await ev.action.setTitle('Config needed');
      return;
    }

    const moneybirdService = new MoneybirdService(settings.apiKey, settings.administrationId);

    try {
      // Show processing state
      await ev.action.setTitle('Creating...');

      // Determine period
      const now = new Date();
      let startDate: Date;
      let endDate: Date;
      let periodDescription: string;

      switch (settings.period) {
        case 'last_month': {
          const lastMonth = subMonths(now, 1);
          startDate = startOfMonth(lastMonth);
          endDate = endOfMonth(lastMonth);
          periodDescription = format(lastMonth, 'MMMM yyyy');
          break;
        }
        case 'current_quarter': {
          startDate = startOfQuarter(now);
          endDate = endOfQuarter(now);
          periodDescription = `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;
          break;
        }
        case 'last_quarter': {
          const lastQuarter = subMonths(now, 3);
          startDate = startOfQuarter(lastQuarter);
          endDate = endOfQuarter(lastQuarter);
          periodDescription = `Q${Math.floor(lastQuarter.getMonth() / 3) + 1} ${lastQuarter.getFullYear()}`;
          break;
        }
        case 'current_year': {
          startDate = startOfYear(now);
          endDate = endOfYear(now);
          periodDescription = format(now, 'yyyy');
          break;
        }
        default: // current_month
          startDate = startOfMonth(now);
          endDate = endOfMonth(now);
          periodDescription = format(now, 'MMMM yyyy');
      }

      streamDeck.logger.debug(`Fetching time entries from ${startDate} to ${endDate}`);

      // Fetch time entries for the contact in the selected period
      const timeEntries = await moneybirdService.getTimeEntriesForContact(
        settings.contactId,
        startDate,
        endDate
      );

      if (timeEntries.length === 0) {
        await ev.action.setTitle('No hours');
        await ev.action.setImage(this.getImagePath('error'));

        // Reset after 3 seconds
        setTimeout(async () => {
          const title = settings.displayTitle || 'Invoice';
          await ev.action.setTitle(String(title));
          await ev.action.setImage(this.getImagePath('default'));
        }, 3000);

        return;
      }

      // Create invoice
      const hourlyRate = parseFloat(String(settings.hourlyRate)) || 75;
      const invoice = await moneybirdService.createInvoiceFromTimeEntries(
        settings.contactId,
        timeEntries,
        settings.description || `Werkzaamheden ${periodDescription}`,
        settings.workflow_id,
        hourlyRate
      );

      streamDeck.logger.debug(`Invoice created successfully:`, invoice);

      // Show success state
      await ev.action.setTitle('✓ Created');
      await ev.action.setImage(this.getImagePath('success'));

      // Reset after 3 seconds
      setTimeout(async () => {
        const title = settings.displayTitle || 'Invoice';
        await ev.action.setTitle(String(title));
        await ev.action.setImage(this.getImagePath('default'));
      }, 3000);
    } catch (error: any) {
      streamDeck.logger.error(`Error creating invoice for instance ${instanceId}:`, error);

      await ev.action.setImage(this.getImagePath('error'));
      await ev.action.setTitle('Error');

      // Reset after 3 seconds
      setTimeout(async () => {
        const title = settings.displayTitle || 'Invoice';
        await ev.action.setTitle(String(title));
        await ev.action.setImage(this.getImagePath('default'));
      }, 3000);
    }
  }
}
