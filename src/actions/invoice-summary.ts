import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  SendToPluginEvent,
  DidReceiveSettingsEvent,
} from '@elgato/streamdeck';
import { MoneybirdService } from '../services/moneybird';
import { InvoiceSettings } from '../types/moneybird';
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

@action({ UUID: 'com.johan-kuijt.moneybird-timer.invoice-summary' })
export class InvoiceSummary extends SingletonAction<InvoiceSettings> {
  private updateInterval?: NodeJS.Timeout;

  private getImagePath(type: 'default' | 'preview' | 'error'): string {
    const baseDir = 'imgs/actions/invoice';
    const imageName = type === 'preview' ? 'key_success.png' : `key_${type}.png`;
    return path.join(baseDir, imageName);
  }

  private getPeriodDates(period: string): { start: Date; end: Date; description: string } {
    const now = new Date();

    switch (period) {
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
      default: // current_month
        return {
          start: startOfMonth(now),
          end: endOfMonth(now),
          description: format(now, 'MMMM yyyy'),
        };
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

  private async updateSummary(
    ev: WillAppearEvent<InvoiceSettings> | DidReceiveSettingsEvent<InvoiceSettings>
  ): Promise<void> {
    const settings = ev.payload.settings;

    if (!settings.apiKey || !settings.administrationId || !settings.contactId) {
      await ev.action.setTitle('Not configured');
      await ev.action.setImage(this.getImagePath('default'));
      return;
    }

    const moneybirdService = new MoneybirdService(settings.apiKey, settings.administrationId);
    const period = settings.period || 'current_month';
    const { start, end } = this.getPeriodDates(period);

    try {
      // Fetch time entries
      const timeEntries = await moneybirdService.getTimeEntriesForContact(
        settings.contactId,
        start,
        end
      );

      if (timeEntries.length === 0) {
        const periodLabel = this.getPeriodLabel(period);
        await ev.action.setTitle(`${periodLabel}\nNo hours`);
        await ev.action.setImage(this.getImagePath('default'));
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

      const hourlyRate = parseFloat(String(settings.hourlyRate)) || 75;
      const totalAmount = totalHours * hourlyRate;

      // Update display
      const periodLabel = this.getPeriodLabel(period);
      await ev.action.setTitle(
        `${periodLabel}\n${totalHours.toFixed(1)}h = €${totalAmount.toFixed(0)}`
      );
      await ev.action.setImage(this.getImagePath('preview'));
    } catch (error) {
      streamDeck.logger.error('Error fetching summary data:', error);
      const periodLabel = this.getPeriodLabel(period);
      await ev.action.setTitle(`${periodLabel}\nError`);
      await ev.action.setImage(this.getImagePath('error'));
    }
  }

  override async onWillAppear(ev: WillAppearEvent<InvoiceSettings>): Promise<void> {
    await this.updateSummary(ev);

    // Update every 30 seconds
    this.updateInterval = setInterval(() => {
      this.updateSummary(ev);
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
    await this.updateSummary(ev as any);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<InvoiceSettings>): Promise<void> {
    await this.updateSummary(ev);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<any, InvoiceSettings>): Promise<void> {
    // Handle same events as invoice creator for consistency
    if (
      ev.payload?.event === 'setGlobalSettings' ||
      ev.payload?.event === 'administrationSelected'
    ) {
      await this.updateSummary(ev as any);
    }
  }
}
