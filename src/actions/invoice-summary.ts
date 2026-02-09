import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  SendToPluginEvent,
  DidReceiveSettingsEvent,
} from '@elgato/streamdeck';
import { MoneybirdService } from '../services/moneybird';
import { InvoiceSettings } from '../types/moneybird';
import path from 'path';
import {
  calculateTotalHours,
  getPeriodLabel,
  getPeriodRange,
  parseHourlyRate,
  resolvePeriodKey,
} from '../utils/invoice-utils';
import {
  applyInvoiceAdministrationChange,
  applyInvoiceGlobalSettings,
} from '../utils/invoice-action-settings';
import { clearIntervalForKey, setIntervalForKey } from '../utils/runtime-timers';
import { setActionDisplay } from '../utils/action-display';
import { logError } from '../utils/error-logging';

type InvoicePluginPayload = {
  event?: 'setGlobalSettings' | 'administrationSelected';
  apiKey?: string;
  administrationId?: string;
};

type SummaryAction = {
  setTitle(title: string): Promise<void>;
  setImage(image: string): Promise<void>;
  getSettings(): Promise<InvoiceSettings>;
};

@action({ UUID: 'com.johan-kuijt.moneybird-timer.invoice-summary' })
export class InvoiceSummary extends SingletonAction<InvoiceSettings> {
  private updateIntervals: Map<string, NodeJS.Timeout> = new Map();

  private getImagePath(type: 'default' | 'preview' | 'error'): string {
    const baseDir = 'imgs/actions/invoice';
    const imageName = type === 'preview' ? 'key_success.png' : `key_${type}.png`;
    return path.join(baseDir, imageName);
  }

  private async updateSummary(action: SummaryAction, settings: InvoiceSettings): Promise<void> {
    if (!settings.apiKey || !settings.administrationId || !settings.contactId) {
      const displayTitle = settings.displayTitle || 'Not configured';
      await setActionDisplay(action, displayTitle, this.getImagePath('default'));
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
        await setActionDisplay(action, `${displayTitle}\nNo hours`, this.getImagePath('default'));
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

      await setActionDisplay(action, displayText, this.getImagePath('preview'));
    } catch (error) {
      logError(streamDeck.logger, 'Error fetching summary data', error);
      const displayTitle = settings.displayTitle || getPeriodLabel(periodKey);
      await setActionDisplay(action, `${displayTitle}\nError`, this.getImagePath('error'));
    }
  }

  private async updateSummaryFromAction(action: SummaryAction): Promise<void> {
    const settings = await action.getSettings();
    await this.updateSummary(action, settings);
  }

  override async onWillAppear(ev: WillAppearEvent<InvoiceSettings>): Promise<void> {
    const instanceId = ev.action.id;
    await this.updateSummaryFromAction(ev.action);

    // Update every 30 seconds
    const interval = setInterval(() => {
      this.updateSummaryFromAction(ev.action).catch(error => {
        logError(streamDeck.logger, 'Error in periodic summary refresh', error);
      });
    }, 30000);

    setIntervalForKey(this.updateIntervals, instanceId, interval);
  }

  override async onWillDisappear(ev: WillDisappearEvent<InvoiceSettings>): Promise<void> {
    const instanceId = ev.action.id;
    clearIntervalForKey(this.updateIntervals, instanceId);
  }

  override async onKeyDown(ev: KeyDownEvent<InvoiceSettings>): Promise<void> {
    // Refresh on press
    await this.updateSummaryFromAction(ev.action);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<InvoiceSettings>): Promise<void> {
    streamDeck.logger.debug('[InvoiceSummary] Settings received');
    await this.updateSummaryFromAction(ev.action);
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
      logError(streamDeck.logger, 'Unexpected error in onSendToPlugin', error);
    }
  }

  private async handleAdministrationChange(
    ev: SendToPluginEvent<InvoicePluginPayload, InvoiceSettings>
  ): Promise<void> {
    const updated = await applyInvoiceAdministrationChange(ev.action, ev.payload.administrationId, {
      logger: streamDeck.logger,
    });

    if (updated) {
      // Update summary after loading new data
      await this.updateSummaryFromAction(ev.action);
    }
  }

  private async handleGlobalSettings(
    ev: SendToPluginEvent<InvoicePluginPayload, InvoiceSettings>
  ): Promise<void> {
    await applyInvoiceGlobalSettings(ev.action, ev.payload.apiKey, {
      logger: streamDeck.logger,
    });
  }
}
