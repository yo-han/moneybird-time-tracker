import streamDeck, {
  action,
  KeyDownEvent,
  KeyUpEvent,
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
  getPeriodLabel,
  getPeriodRange,
  parseHourlyRate,
  resolvePeriodKey,
} from '../utils/invoice-utils';
import {
  applyInvoiceAdministrationChange,
  applyInvoiceGlobalSettings,
} from '../utils/invoice-action-settings';
import { clearTimeoutForKey } from '../utils/runtime-timers';

type InvoicePluginPayload = {
  event?: 'setGlobalSettings' | 'administrationSelected';
  apiKey?: string;
  administrationId?: string;
};

@action({ UUID: 'com.johan-kuijt.moneybird-timer.invoice-creator' })
export class InvoiceCreator extends SingletonAction<InvoiceSettings> {
  private longPressTimers: Map<string, NodeJS.Timeout> = new Map();
  private longPressTriggered: Set<string> = new Set();
  private periodCycleTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private resetDisplayTimeouts: Map<string, NodeJS.Timeout> = new Map();

  private getImagePath(type: 'default' | 'success' | 'error'): string {
    const baseDir = 'imgs/actions/invoice';
    const imageName = `key_${type}.png`;
    return path.join(baseDir, imageName);
  }

  private getDefaultTitle(settings: InvoiceSettings): string {
    const title = settings.displayTitle || 'Invoice';
    const periodLabel = getPeriodLabel(resolvePeriodKey(settings));
    return `${title}\n${periodLabel}`;
  }

  private resetDisplayAfterDelay(
    action: KeyDownEvent<InvoiceSettings>['action'] | KeyUpEvent<InvoiceSettings>['action'],
    settings: InvoiceSettings,
    delayMs: number,
    instanceId: string
  ): void {
    const existingTimeout = this.resetDisplayTimeouts.get(instanceId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(async () => {
      try {
        await action.setTitle(this.getDefaultTitle(settings));
        await action.setImage(this.getImagePath('default'));
      } catch (error) {
        streamDeck.logger.error('Failed to reset invoice creator display:', error);
      } finally {
        this.resetDisplayTimeouts.delete(instanceId);
      }
    }, delayMs);

    this.resetDisplayTimeouts.set(instanceId, timeout);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<InvoiceSettings>): Promise<void> {
    try {
      const settings = ev.payload.settings;
      const instanceId = ev.action.id;

      streamDeck.logger.debug(`[InvoiceCreator] Settings received for instance ${instanceId}`);

      if (
        settings.displayTitle !== undefined ||
        settings.periodType !== undefined ||
        settings.periodRange !== undefined
      ) {
        // Update title with period info if configured
        if (settings.apiKey && settings.administrationId && settings.contactId) {
          const periodLabel = getPeriodLabel(resolvePeriodKey(settings));
          const displayTitle = settings.displayTitle || 'Invoice';
          await ev.action.setTitle(`${displayTitle}\n${periodLabel}`);
        } else {
          const title = settings.displayTitle || 'Invoice';
          await ev.action.setTitle(String(title));
        }
      }

      streamDeck.logger.debug(`[InvoiceCreator] Settings updated for instance ${instanceId}`);
    } catch (error) {
      streamDeck.logger.error('Error in onDidReceiveSettings:', error);
    }
  }

  override async onSendToPlugin(
    ev: SendToPluginEvent<InvoicePluginPayload, InvoiceSettings>
  ): Promise<void> {
    try {
      streamDeck.logger.debug(
        `Invoice plugin received SendToPlugin event: ${ev.payload?.event || 'unknown'}`
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
    await applyInvoiceAdministrationChange(ev.action, ev.payload.administrationId, {
      logger: streamDeck.logger,
    });
  }

  private async handleGlobalSettings(
    ev: SendToPluginEvent<InvoicePluginPayload, InvoiceSettings>
  ): Promise<void> {
    await applyInvoiceGlobalSettings(ev.action, ev.payload.apiKey, {
      logger: streamDeck.logger,
    });
  }

  override async onWillAppear(ev: WillAppearEvent<InvoiceSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const instanceId = ev.action.id;

    streamDeck.logger.debug(`Invoice action appeared for instance ${instanceId}`);

    await ev.action.setImage(this.getImagePath('default'));

    // Show period in title if configured
    if (settings.apiKey && settings.administrationId && settings.contactId) {
      const periodLabel = getPeriodLabel(resolvePeriodKey(settings));
      const displayTitle = settings.displayTitle || 'Invoice';
      await ev.action.setTitle(`${displayTitle}\n${periodLabel}`);
    } else {
      const title = settings.displayTitle ? settings.displayTitle : 'Invoice';
      await ev.action.setTitle(String(title));
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent<InvoiceSettings>): Promise<void> {
    const instanceId = ev.action.id;

    clearTimeoutForKey(this.longPressTimers, instanceId);
    clearTimeoutForKey(this.periodCycleTimeouts, instanceId);
    clearTimeoutForKey(this.resetDisplayTimeouts, instanceId);

    this.longPressTriggered.delete(instanceId);
  }

  override async onKeyDown(ev: KeyDownEvent<InvoiceSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const instanceId = ev.action.id;

    streamDeck.logger.debug(`Invoice key pressed for instance ${instanceId}`);

    if (!settings.apiKey || !settings.administrationId || !settings.contactId) {
      streamDeck.logger.debug('Missing required settings');
      await ev.action.setImage(this.getImagePath('default'));
      await ev.action.setTitle('Config needed');
      return;
    }

    // Set up long press detection
    clearTimeoutForKey(this.longPressTimers, instanceId);

    this.longPressTriggered.delete(instanceId);
    const longPressTimeout = setTimeout(() => {
      this.longPressTriggered.add(instanceId);
      this.cyclePeriod(ev);
    }, 500); // 500ms = long press
    this.longPressTimers.set(instanceId, longPressTimeout);
  }

  override async onKeyUp(ev: KeyUpEvent<InvoiceSettings>): Promise<void> {
    const instanceId = ev.action.id;

    // Clear the long press timer
    clearTimeoutForKey(this.longPressTimers, instanceId);

    // If it was a long press, we already handled it
    if (this.longPressTriggered.has(instanceId)) {
      this.longPressTriggered.delete(instanceId);
      return;
    }

    // Normal press - create invoice
    await this.createInvoice(ev);
  }

  private async cyclePeriod(
    ev: KeyDownEvent<InvoiceSettings> | KeyUpEvent<InvoiceSettings>
  ): Promise<void> {
    const settings = ev.payload.settings;
    const instanceId = ev.action.id;

    // Toggle between current and last
    const currentRange = settings.periodRange || 'current';
    const newRange = currentRange === 'current' ? 'last' : 'current';

    // Update settings - only for this action instance
    const newSettings: InvoiceSettings = {
      ...settings,
      periodRange: newRange,
    };

    // Use action-specific setSettings
    await ev.action.setSettings(newSettings);

    // Update display
    const displayTitle = settings.displayTitle || 'Invoice';
    const periodLabel = getPeriodLabel(resolvePeriodKey(newSettings));
    await ev.action.setTitle(`${displayTitle}\n${periodLabel}`);

    // Show temporary feedback
    await ev.action.setImage(this.getImagePath('success'));

    // Clear any existing timeout
    clearTimeoutForKey(this.periodCycleTimeouts, instanceId);

    // Reset image after a short delay
    const timeout = setTimeout(async () => {
      try {
        await ev.action.setImage(this.getImagePath('default'));
      } catch (error) {
        streamDeck.logger.error('Failed to reset invoice creator cycle image:', error);
      } finally {
        this.periodCycleTimeouts.delete(instanceId);
      }
    }, 1000);
    this.periodCycleTimeouts.set(instanceId, timeout);
  }

  private async createInvoice(ev: KeyUpEvent<InvoiceSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const instanceId = ev.action.id;

    const moneybirdService = new MoneybirdService(settings.apiKey, settings.administrationId);

    try {
      // Show processing state
      await ev.action.setTitle('Creating...');

      const now = new Date();
      const periodKey = resolvePeriodKey(settings);
      const { startDate, endDate, description: periodDescription } = getPeriodRange(now, periodKey);

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
        this.resetDisplayAfterDelay(ev.action, settings, 3000, instanceId);

        return;
      }

      // Create invoice
      const hourlyRate = parseHourlyRate(settings.hourlyRate, 75);
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
      this.resetDisplayAfterDelay(ev.action, settings, 3000, instanceId);
    } catch (error: unknown) {
      streamDeck.logger.error(`Error creating invoice for instance ${instanceId}:`, error);

      await ev.action.setImage(this.getImagePath('error'));
      await ev.action.setTitle('Error');
      this.resetDisplayAfterDelay(ev.action, settings, 3000, instanceId);
    }
  }
}
