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
import { MoneybirdService } from '../services/moneybird.js';
import { InvoiceSettings } from '../types/moneybird.js';
import path from 'path';
import {
  DEFAULT_HOURLY_RATE,
  getPeriodLabel,
  getPeriodRange,
  parseHourlyRate,
  resolvePeriodKey,
} from '../utils/invoice-utils.js';
import {
  INVOICE_LISTS,
  applyInvoiceAdministrationChange,
} from '../utils/invoice-action-settings.js';
import { clearTimeoutForKey, setTimeoutForKey } from '../utils/runtime-timers.js';
import { setConfigNeededDisplay, setErrorDisplay } from '../utils/action-display.js';
import { logError } from '../utils/error-logging.js';
import { isKeyActionEvent } from '../utils/key-action.js';
import { runExclusivePerKey } from '../utils/in-flight.js';
import { applyApiKeyEvent, type ApiKeyEventPayload } from '../utils/api-key-settings.js';
import { migrateKeyCredentials, resolveApiKeyFromStore } from '../utils/credentials.js';
import type { GlobalSettingsStore } from '../utils/global-settings.js';
import { notifyPropertyInspector, pluginGlobalSettings } from '../utils/plugin-global-settings.js';

type InvoiceService = Pick<
  MoneybirdService,
  'getTimeEntriesForContact' | 'createInvoiceFromTimeEntries'
>;

export type CreateInvoiceService = (apiKey: string, administrationId: string) => InvoiceService;

function createMoneybirdService(apiKey: string, administrationId: string): InvoiceService {
  return new MoneybirdService(apiKey, administrationId);
}

@action({ UUID: 'com.johan-kuijt.moneybird-timer.invoice-creator' })
export class InvoiceCreator extends SingletonAction<InvoiceSettings> {
  private longPressTimers: Map<string, NodeJS.Timeout> = new Map();
  private longPressTriggered: Set<string> = new Set();
  private periodCycleTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private resetDisplayTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private invoicesInFlight: Set<string> = new Set();

  constructor(
    private readonly createService: CreateInvoiceService = createMoneybirdService,
    private readonly globalSettings: GlobalSettingsStore = pluginGlobalSettings
  ) {
    super();
  }

  private async resolveApiKey(settings: InvoiceSettings): Promise<string | undefined> {
    return resolveApiKeyFromStore(settings, this.globalSettings, streamDeck.logger);
  }

  private async isConfigured(settings: InvoiceSettings): Promise<boolean> {
    return Boolean(
      (await this.resolveApiKey(settings)) && settings.administrationId && settings.contactId
    );
  }

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
    const timeout = setTimeout(async () => {
      try {
        await action.setTitle(this.getDefaultTitle(settings));
        await action.setImage(this.getImagePath('default'));
      } catch (error) {
        logError(streamDeck.logger, 'Failed to reset invoice creator display', error);
      } finally {
        this.resetDisplayTimeouts.delete(instanceId);
      }
    }, delayMs);

    setTimeoutForKey(this.resetDisplayTimeouts, instanceId, timeout);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<InvoiceSettings>): Promise<void> {
    try {
      const settings = ev.payload.settings;
      const instanceId = ev.action.id;

      streamDeck.logger.debug(`[InvoiceCreator] Settings received for instance ${instanceId}`);

      if (
        isKeyActionEvent(ev) &&
        (settings.displayTitle !== undefined ||
          settings.periodType !== undefined ||
          settings.periodRange !== undefined)
      ) {
        // Update title with period info if configured
        if (await this.isConfigured(settings)) {
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
      logError(streamDeck.logger, 'Error in onDidReceiveSettings', error);
    }
  }

  override async onSendToPlugin(
    ev: SendToPluginEvent<ApiKeyEventPayload, InvoiceSettings>
  ): Promise<void> {
    try {
      streamDeck.logger.debug(
        `Invoice plugin received SendToPlugin event: ${ev.payload?.event || 'unknown'}`
      );

      const event = ev.payload?.event;
      if (event === 'apiKeyChanged' || event === 'loadAdministrations') {
        await applyApiKeyEvent(ev.action, ev.payload, {
          store: this.globalSettings,
          logger: streamDeck.logger,
          dependents: INVOICE_LISTS,
          notify: notifyPropertyInspector,
        });
      } else if (event === 'administrationSelected') {
        await applyInvoiceAdministrationChange(ev.action, ev.payload.administrationId, {
          logger: streamDeck.logger,
          store: this.globalSettings,
        });
      }
    } catch (error) {
      logError(streamDeck.logger, 'Unexpected error in onSendToPlugin', error);
    }
  }

  override async onWillAppear(ev: WillAppearEvent<InvoiceSettings>): Promise<void> {
    if (!isKeyActionEvent(ev)) {
      streamDeck.logger.warn(`Ignoring non-key action for instance ${ev.action.id}`);
      return;
    }

    const settings = await migrateKeyCredentials(
      ev.action,
      ev.payload.settings,
      this.globalSettings,
      streamDeck.logger
    );
    const instanceId = ev.action.id;

    streamDeck.logger.debug(`Invoice action appeared for instance ${instanceId}`);

    await ev.action.setImage(this.getImagePath('default'));

    // Show period in title if configured
    if (await this.isConfigured(settings)) {
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

    if (!(await this.isConfigured(settings))) {
      streamDeck.logger.debug('Missing required settings');
      await setConfigNeededDisplay(ev.action, this.getImagePath('default'));
      return;
    }

    // Set up long press detection
    clearTimeoutForKey(this.longPressTimers, instanceId);

    this.longPressTriggered.delete(instanceId);
    const longPressTimeout = setTimeout(() => {
      this.longPressTriggered.add(instanceId);
      this.cyclePeriod(ev).catch(error =>
        logError(streamDeck.logger, 'Error cycling invoice period', error, { instanceId })
      );
    }, 500); // 500ms = long press
    setTimeoutForKey(this.longPressTimers, instanceId, longPressTimeout);
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

    // Normal press - create invoice. A second press while the first invoice is still
    // being created is ignored, otherwise the same hours would be invoiced twice.
    const handled = await runExclusivePerKey(this.invoicesInFlight, instanceId, () =>
      this.createInvoice(ev)
    );
    if (!handled) {
      streamDeck.logger.debug(`Ignoring key press for ${instanceId}: invoice still in progress`);
    }
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
        logError(streamDeck.logger, 'Failed to reset invoice creator cycle image', error);
      } finally {
        this.periodCycleTimeouts.delete(instanceId);
      }
    }, 1000);
    setTimeoutForKey(this.periodCycleTimeouts, instanceId, timeout);
  }

  private async createInvoice(ev: KeyUpEvent<InvoiceSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const instanceId = ev.action.id;

    try {
      const apiKey = await this.resolveApiKey(settings);
      if (!apiKey) {
        throw new Error('No Moneybird API key configured');
      }
      const moneybirdService = this.createService(apiKey, settings.administrationId);

      // Show processing state
      await ev.action.setTitle('Creating...');

      const now = new Date();
      const periodKey = resolvePeriodKey(settings);
      const { startDate, endDate, description: periodDescription } = getPeriodRange(now, periodKey);

      streamDeck.logger.debug(`Fetching time entries from ${startDate} to ${endDate}`);

      // Fetch the not yet invoiced time entries for the contact in the selected period
      const timeEntries = await moneybirdService.getTimeEntriesForContact(
        settings.contactId,
        startDate,
        endDate,
        { excludeInvoiced: true }
      );

      if (timeEntries.length === 0) {
        await ev.action.setTitle('No hours');
        await ev.action.setImage(this.getImagePath('error'));
        this.resetDisplayAfterDelay(ev.action, settings, 3000, instanceId);

        return;
      }

      // Create invoice
      const hourlyRate = parseHourlyRate(settings.hourlyRate, DEFAULT_HOURLY_RATE);
      const { invoice, unlinkedEntryIds } = await moneybirdService.createInvoiceFromTimeEntries(
        settings.contactId,
        timeEntries,
        settings.description || `Werkzaamheden ${periodDescription}`,
        settings.workflow_id,
        hourlyRate
      );

      streamDeck.logger.info(`Invoice ${invoice.id} created for ${timeEntries.length} entries`);

      if (unlinkedEntryIds.length > 0) {
        // The invoice exists, but these hours are not marked as invoiced in Moneybird and
        // would be picked up again by the next invoice. Make that visible on the key.
        streamDeck.logger.warn(
          `Invoice ${invoice.id} created, but ${unlinkedEntryIds.length} time entries are not linked`
        );
        await ev.action.setTitle('⚠️ Created\nCheck hours');
        await ev.action.setImage(this.getImagePath('error'));
        this.resetDisplayAfterDelay(ev.action, settings, 5000, instanceId);
        return;
      }

      // Show success state
      await ev.action.setTitle('✓ Created');
      await ev.action.setImage(this.getImagePath('success'));
      this.resetDisplayAfterDelay(ev.action, settings, 3000, instanceId);
    } catch (error: unknown) {
      logError(streamDeck.logger, 'Error creating invoice', error, { instanceId });

      await setErrorDisplay(ev.action, this.getImagePath('error'));
      this.resetDisplayAfterDelay(ev.action, settings, 3000, instanceId);
    }
  }
}
