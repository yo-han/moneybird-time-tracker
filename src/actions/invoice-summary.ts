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

  private getPeriodKey(settings: InvoiceSettings): string {
    // Use new format if available
    if (settings.periodType && settings.periodRange) {
      const range = settings.periodRange === 'last' ? 'last' : 'current';
      return `${range}_${settings.periodType}`;
    }
    // Fall back to old format
    return settings.period || 'current_month';
  }

  private getPeriodDates(settings: InvoiceSettings): {
    start: Date;
    end: Date;
    description: string;
  } {
    const now = new Date();
    const periodKey = this.getPeriodKey(settings);

    switch (periodKey) {
      case 'last_month': {
        const lastMonth = subMonths(now, 1);
        return {
          start: startOfMonth(lastMonth),
          end: endOfMonth(lastMonth),
          description: format(lastMonth, 'MMMM yyyy'),
        };
      }
      case 'current_quarter': {
        return {
          start: startOfQuarter(now),
          end: endOfQuarter(now),
          description: `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`,
        };
      }
      case 'last_quarter': {
        const lastQuarter = subMonths(now, 3);
        return {
          start: startOfQuarter(lastQuarter),
          end: endOfQuarter(lastQuarter),
          description: `Q${Math.floor(lastQuarter.getMonth() / 3) + 1} ${lastQuarter.getFullYear()}`,
        };
      }
      case 'current_year': {
        return {
          start: startOfYear(now),
          end: endOfYear(now),
          description: format(now, 'yyyy'),
        };
      }
      case 'last_year': {
        const lastYear = subMonths(now, 12);
        return {
          start: startOfYear(lastYear),
          end: endOfYear(lastYear),
          description: format(lastYear, 'yyyy'),
        };
      }
      default: // current_month
        return {
          start: startOfMonth(now),
          end: endOfMonth(now),
          description: format(now, 'MMMM yyyy'),
        };
    }
  }
  private getPeriodLabel(settings: InvoiceSettings): string {
    const periodKey = this.getPeriodKey(settings);
    switch (periodKey) {
      case 'last_month':
        return 'Last Month';
      case 'current_quarter':
        return 'This Quarter';
      case 'last_quarter':
        return 'Last Quarter';
      case 'current_year':
        return 'This Year';
      case 'last_year':
        return 'Last Year';
      default:
        return 'This Month';
    }
  }

  private async updateSummary(action: SummaryAction, settings: InvoiceSettings): Promise<void> {
    if (!settings.apiKey || !settings.administrationId || !settings.contactId) {
      const displayTitle = settings.displayTitle || 'Not configured';
      await action.setTitle(displayTitle);
      await action.setImage(this.getImagePath('default'));
      return;
    }

    const moneybirdService = new MoneybirdService(settings.apiKey, settings.administrationId);
    const { start, end } = this.getPeriodDates(settings);

    try {
      // Fetch time entries
      const timeEntries = await moneybirdService.getTimeEntriesForContact(
        settings.contactId,
        start,
        end
      );

      if (timeEntries.length === 0) {
        const displayTitle = settings.displayTitle || this.getPeriodLabel(settings);
        await action.setTitle(`${displayTitle}\nNo hours`);
        await action.setImage(this.getImagePath('default'));
        return;
      }

      // Calculate total hours and amount
      let totalHours = 0;
      timeEntries.forEach(entry => {
        const startTime = new Date(entry.started_at);
        const endTime = new Date(entry.ended_at);
        const durationMs = endTime.getTime() - startTime.getTime() - entry.paused_duration * 1000;
        totalHours += durationMs / (1000 * 60 * 60);
      });

      const hourlyRateString = String(settings.hourlyRate).replace(',', '.');
      const hourlyRate = parseFloat(hourlyRateString) || 75;
      const totalAmount = totalHours * hourlyRate;

      // Update display based on settings
      const displayTitle = settings.displayTitle || this.getPeriodLabel(settings);
      let displayText = `${displayTitle}\n${totalHours.toFixed(1)}h`;

      // Add price if hourly rate is configured
      if (settings.hourlyRate && settings.hourlyRate !== '') {
        displayText += ` = €${totalAmount.toFixed(0)}`;
      }

      await action.setTitle(displayText);
      await action.setImage(this.getImagePath('preview'));
    } catch (error) {
      streamDeck.logger.error('Error fetching summary data:', error);
      const displayTitle = settings.displayTitle || this.getPeriodLabel(settings);
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
