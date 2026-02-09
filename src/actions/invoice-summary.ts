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
import path from 'path';
import {
  calculateTotalHours,
  getPeriodLabel,
  getPeriodRange,
  parseHourlyRate,
  resolvePeriodKey,
} from '../utils/invoice-utils';

type InvoicePluginPayload = {
  event?: 'setGlobalSettings' | 'administrationSelected';
  apiKey?: string;
  administrationId?: string;
};

type SummaryAction = {
  setTitle(title: string): Promise<void>;
  setImage(image: string): Promise<void>;
};

@action({ UUID: 'com.johan-kuijt.moneybird-timer.invoice-summary' })
export class InvoiceSummary extends SingletonAction<InvoiceSettings> {
  private updateInterval?: NodeJS.Timeout;

  private getImagePath(type: 'default' | 'preview' | 'error'): string {
    const baseDir = 'imgs/actions/invoice';
    const imageName = type === 'preview' ? 'key_success.png' : `key_${type}.png`;
    return path.join(baseDir, imageName);
  }

  private async updateSummary(action: SummaryAction, settings: InvoiceSettings): Promise<void> {
    if (!settings.apiKey || !settings.administrationId || !settings.contactId) {
      const displayTitle = settings.displayTitle || 'Not configured';
      await action.setTitle(displayTitle);
      await action.setImage(this.getImagePath('default'));
      return;
    }

    const moneybirdService = new MoneybirdService(settings.apiKey, settings.administrationId);
    const periodKey = resolvePeriodKey(settings);
    const { startDate, endDate } = getPeriodRange(new Date(), periodKey);

    try {
      // Fetch time entries
      const timeEntries = await moneybirdService.getTimeEntriesForContact(
        settings.contactId,
        startDate,
        endDate
      );

      if (timeEntries.length === 0) {
        const displayTitle = settings.displayTitle || getPeriodLabel(periodKey);
        await action.setTitle(`${displayTitle}\nNo hours`);
        await action.setImage(this.getImagePath('default'));
        return;
      }

      // Calculate total hours and amount
      const totalHours = calculateTotalHours(timeEntries);
      const hourlyRate = parseHourlyRate(settings.hourlyRate, 75);
      const totalAmount = totalHours * hourlyRate;

      // Update display based on settings
      const displayTitle = settings.displayTitle || getPeriodLabel(periodKey);
      let displayText = `${displayTitle}\n${totalHours.toFixed(1)}h`;

      // Add price if hourly rate is configured
      if (settings.hourlyRate && settings.hourlyRate !== '') {
        displayText += ` = €${totalAmount.toFixed(0)}`;
      }

      await action.setTitle(displayText);
      await action.setImage(this.getImagePath('preview'));
    } catch (error) {
      streamDeck.logger.error('Error fetching summary data:', error);
      const displayTitle = settings.displayTitle || getPeriodLabel(periodKey);
      await action.setTitle(`${displayTitle}\nError`);
      await action.setImage(this.getImagePath('error'));
    }
  }

  override async onWillAppear(ev: WillAppearEvent<InvoiceSettings>): Promise<void> {
    await this.updateSummary(ev.action, ev.payload.settings);

    // Update every 30 seconds
    this.updateInterval = setInterval(() => {
      this.updateSummary(ev.action, ev.payload.settings);
    }, 30000);
  }

  override async onWillDisappear(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
  }

  override async onKeyDown(ev: KeyDownEvent<InvoiceSettings>): Promise<void> {
    // Refresh on press
    await this.updateSummary(ev.action, ev.payload.settings);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<InvoiceSettings>): Promise<void> {
    streamDeck.logger.debug('[InvoiceSummary] Settings received');
    await this.updateSummary(ev.action, ev.payload.settings);
  }

  override async onSendToPlugin(
    ev: SendToPluginEvent<InvoicePluginPayload, InvoiceSettings>
  ): Promise<void> {
    try {
      streamDeck.logger.debug(
        `Invoice summary received SendToPlugin event: ${ev.payload?.event || 'unknown'}`
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
    ev: SendToPluginEvent<InvoicePluginPayload, InvoiceSettings>
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

      // Update summary after loading new data
      await this.updateSummary(ev.action, newSettings);
    } catch (fetchError) {
      streamDeck.logger.error('Error fetching Moneybird data:', {
        message: (fetchError as Error).message,
        stack: (fetchError as Error).stack,
      });
    }
  }

  private async handleGlobalSettings(
    ev: SendToPluginEvent<InvoicePluginPayload, InvoiceSettings>
  ): Promise<void> {
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
}
