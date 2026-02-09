import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  SendToPluginEvent,
  WillDisappearEvent,
  DidReceiveSettingsEvent,
} from '@elgato/streamdeck';
import { MoneybirdService } from '../services/moneybird';
import {
  TimerSettings,
  projectToJson,
  administrationToJson,
  userToJson,
  contactToJson,
} from '../types/moneybird';
import { differenceInSeconds, differenceInMinutes, differenceInHours } from 'date-fns';
import path from 'path';
import { calculateRemainingAutoStopHours, normalizeAutoStopHours } from '../utils/auto-stop-utils';
import { clearIntervalForKey, clearTimeoutForKey } from '../utils/runtime-timers';
import { setConfigNeededDisplay, setErrorDisplay } from '../utils/action-display';

type TimerPluginPayload = {
  event?: 'setGlobalSettings' | 'administrationSelected';
  apiKey?: string;
  administrationId?: string;
};

@action({ UUID: 'com.johan-kuijt.moneybird-timer.time-tracker' })
export class TimeTracker extends SingletonAction<TimerSettings> {
  private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
  private autoStopTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private autoStopResetTimeouts: Map<string, NodeJS.Timeout> = new Map();

  private getImagePath(type: 'default' | 'active' | 'error'): string {
    const baseDir = 'imgs/actions/timer';
    const imageName = `key_${type}.png`;
    return path.join(baseDir, imageName);
  }

  private clearInstanceRuntime(instanceId: string): void {
    clearIntervalForKey(this.updateIntervals, instanceId);
    clearTimeoutForKey(this.autoStopTimeouts, instanceId);
    clearTimeoutForKey(this.autoStopResetTimeouts, instanceId);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TimerSettings>): Promise<void> {
    try {
      const settings = ev.payload.settings;
      const instanceId = ev.action.id;

      if (settings.displayTitle !== undefined && !settings.isRunning) {
        const title = settings.displayTitle || 'Start';
        await ev.action.setTitle(String(title));
      }

      streamDeck.logger.debug(`Settings updated for instance ${instanceId}`);
    } catch (error) {
      streamDeck.logger.error('Error in onDidReceiveSettings:', error);
    }
  }

  override async onSendToPlugin(
    ev: SendToPluginEvent<TimerPluginPayload, TimerSettings>
  ): Promise<void> {
    try {
      streamDeck.logger.debug(
        `Plugin received SendToPlugin event: ${ev.payload?.event || 'unknown'}`
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
    ev: SendToPluginEvent<TimerPluginPayload, TimerSettings>
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

      streamDeck.logger.debug('Fetching projects, users, and contacts...');
      const [rawProjects, rawUsers, rawContacts] = await Promise.all([
        moneybirdService.getProjects(),
        moneybirdService.getUsers(administrationId),
        moneybirdService.getContacts(),
      ]);

      const projects = Object.fromEntries(
        rawProjects.map(project => [project.id, projectToJson(project)])
      );
      const users = Object.fromEntries(rawUsers.map(user => [user.id, userToJson(user)]));
      const contacts = Object.fromEntries(
        rawContacts.map(contact => [contact.id, contactToJson(contact)])
      );

      streamDeck.logger.debug(
        `Fetched ${rawProjects.length} projects, ${rawUsers.length} users and ${rawContacts.length} contacts for administration ${administrationId}`
      );

      const newSettings: TimerSettings = {
        ...currentSettings,
        administrationId,
        projects,
        users,
        contacts,
        projectId: '',
        userId: '',
        contactId: '',
      };

      await ev.action.setSettings(newSettings);
      streamDeck.logger.debug('Settings saved with new data');
    } catch (fetchError) {
      streamDeck.logger.error('Error fetching Moneybird data:', {
        message: (fetchError as Error).message,
        stack: (fetchError as Error).stack,
      });
    }
  }

  private async handleGlobalSettings(
    ev: SendToPluginEvent<TimerPluginPayload, TimerSettings>
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

      const newSettings: TimerSettings = {
        ...currentSettings,
        apiKey,
        administrations,
        description: currentSettings.description,
        isRunning: currentSettings.isRunning,
        startTime: currentSettings.startTime,
        timeEntryId: currentSettings.timeEntryId,
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
        projects: {},
        users: {},
      };
      await ev.action.setSettings(clearedSettings);
    }
  }

  override async onWillAppear(ev: WillAppearEvent<TimerSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const instanceId = ev.action.id;

    streamDeck.logger.debug(`Action appeared for instance ${instanceId}`);

    if (settings.isRunning && settings.startTime) {
      await this.updateTimerDisplay(ev);
      this.startUpdateInterval(ev);

      // Set up auto-stop if enabled and timer is running
      if (settings.autoStopEnabled) {
        const autoStopHours = normalizeAutoStopHours(settings.autoStopHours);
        if (autoStopHours !== null) {
          const remainingHours = calculateRemainingAutoStopHours(settings.startTime, autoStopHours);
          this.setupAutoStop(instanceId, Math.max(remainingHours, 0.001), ev);
        }
      }
    } else {
      await ev.action.setImage(this.getImagePath('default'));

      const title = settings.displayTitle ? settings.displayTitle : 'Start';
      await ev.action.setTitle(String(title));
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent<TimerSettings>): Promise<void> {
    const instanceId = ev.action.id;
    this.clearInstanceRuntime(instanceId);
  }

  override async onKeyDown(ev: KeyDownEvent<TimerSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const instanceId = ev.action.id;

    streamDeck.logger.debug(`Key pressed for instance ${instanceId}`);

    if (!settings.apiKey || !settings.administrationId || !settings.projectId || !settings.userId) {
      streamDeck.logger.debug('Missing required settings');
      await setConfigNeededDisplay(ev.action, this.getImagePath('default'));
      return;
    }

    const moneybirdService = new MoneybirdService(settings.apiKey, settings.administrationId);

    try {
      if (!settings.isRunning) {
        streamDeck.logger.debug(`Starting timer for instance ${instanceId}`);
        const timeEntry = await moneybirdService.startTimer(settings);

        const newSettings = {
          ...settings,
          isRunning: true,
          startTime: new Date().toISOString(),
          timeEntryId: timeEntry.id,
        };

        await ev.action.setSettings(newSettings);

        const updatedEvent = {
          ...ev,
          payload: {
            ...ev.payload,
            settings: newSettings,
          },
        };

        await this.updateTimerDisplay(updatedEvent);
        this.startUpdateInterval(updatedEvent);

        // Set up auto-stop if enabled
        if (settings.autoStopEnabled) {
          const autoStopHours = normalizeAutoStopHours(settings.autoStopHours);
          if (autoStopHours !== null) {
            this.setupAutoStop(instanceId, autoStopHours, updatedEvent);
          }
        }

        streamDeck.logger.debug(`Timer started successfully for instance ${instanceId}`);
      } else {
        streamDeck.logger.debug(`Stopping timer for instance ${instanceId}`);

        if (!settings.timeEntryId) {
          throw new Error('No time entry ID found');
        }

        await moneybirdService.stopTimer(settings.timeEntryId);
        streamDeck.logger.debug(`Timer stopped successfully for instance ${instanceId}`);

        const newSettings = {
          ...settings,
          isRunning: false,
          startTime: undefined,
          timeEntryId: undefined,
        };

        await ev.action.setSettings(newSettings);
        await ev.action.setImage(this.getImagePath('default'));

        const title = settings.displayTitle ? settings.displayTitle : 'Start';
        await ev.action.setTitle(String(title));
        this.clearInstanceRuntime(instanceId);
      }
    } catch (error: unknown) {
      streamDeck.logger.error(`Error managing timer for instance ${instanceId}:`, error);

      await setErrorDisplay(ev.action, this.getImagePath('error'));

      const newSettings = {
        ...settings,
        isRunning: false,
        startTime: undefined,
        timeEntryId: undefined,
      };
      await ev.action.setSettings(newSettings);
      this.clearInstanceRuntime(instanceId);
    }
  }

  private startUpdateInterval(
    ev: WillAppearEvent<TimerSettings> | KeyDownEvent<TimerSettings>
  ): void {
    const instanceId = ev.action.id;
    const settings = ev.payload.settings;

    streamDeck.logger.debug(`Starting update interval for instance ${instanceId}`);

    if (!settings || !settings.isRunning || !settings.startTime) {
      streamDeck.logger.debug('Not starting interval - conditions not met');
      return;
    }

    const existingInterval = this.updateIntervals.get(instanceId);

    if (existingInterval) {
      clearInterval(existingInterval);
    }

    const interval = setInterval(() => {
      this.updateTimerDisplay(ev).catch(error =>
        streamDeck.logger.error(`Error updating display for instance ${instanceId}:`, error)
      );
    }, 1000);

    this.updateIntervals.set(instanceId, interval);
    streamDeck.logger.debug(`Interval started for instance ${instanceId}`);
  }

  private async updateTimerDisplay(
    ev: WillAppearEvent<TimerSettings> | KeyDownEvent<TimerSettings>
  ): Promise<void> {
    const settings = ev.payload.settings;

    // streamDeck.logger.debug(
    //   'updateTimerDisplay called with settings:',
    //   JSON.stringify(settings, null, 2)
    // );

    if (settings && settings.isRunning && settings.startTime) {
      const startDate = new Date(settings.startTime);
      const now = new Date();
      const totalSeconds = differenceInSeconds(now, startDate);
      const totalMinutes = differenceInMinutes(now, startDate);
      const totalHours = differenceInHours(now, startDate);

      let displayTime: string;

      if (totalMinutes < 1) {
        displayTime = `${totalSeconds}s`;
      } else if (totalHours < 1) {
        displayTime = `${totalMinutes}m`;
      } else {
        displayTime = `${totalHours}h`;
      }

      const imagePath = this.getImagePath('active');

      // Check if we're approaching auto-stop time
      if (settings.autoStopEnabled) {
        const autoStopHours = normalizeAutoStopHours(settings.autoStopHours);
        if (autoStopHours !== null) {
          const elapsedHours = totalSeconds / 3600;
          const remainingMinutes = (autoStopHours - elapsedHours) * 60;

          if (remainingMinutes <= 5 && remainingMinutes > 0) {
            // Show warning in last 5 minutes
            displayTime = `⚠️ ${displayTime}`;
          }
        }
      }

      // streamDeck.logger.debug(`Setting title to: ⏱️ ${displayTime}`);
      // streamDeck.logger.debug(`Setting image to: ${imagePath}`);

      try {
        await ev.action.setTitle(`⏱️ ${displayTime}`);
        await ev.action.setImage(imagePath);
      } catch (error) {
        streamDeck.logger.error('Error updating timer display:', error);
      }
    } else {
      streamDeck.logger.debug('Not updating timer display - conditions not met');
    }
  }

  private setupAutoStop(
    instanceId: string,
    hours: number,
    ev: WillAppearEvent<TimerSettings> | KeyDownEvent<TimerSettings>
  ): void {
    // Clear any existing timeout
    clearTimeoutForKey(this.autoStopTimeouts, instanceId);
    clearTimeoutForKey(this.autoStopResetTimeouts, instanceId);

    if (!Number.isFinite(hours) || hours <= 0) {
      streamDeck.logger.warn(
        `Skipping auto-stop for instance ${instanceId}: invalid hours ${hours}`
      );
      return;
    }

    // Set new timeout
    const milliseconds = hours * 60 * 60 * 1000;
    streamDeck.logger.debug(`Setting auto-stop for instance ${instanceId} after ${hours} hours`);

    const timeout = setTimeout(async () => {
      streamDeck.logger.debug(`Auto-stop triggered for instance ${instanceId}`);

      try {
        const settings = await ev.action.getSettings();

        if (settings.isRunning && settings.timeEntryId) {
          // Stop the timer
          const moneybirdService = new MoneybirdService(settings.apiKey, settings.administrationId);
          await moneybirdService.stopTimer(settings.timeEntryId);

          // Update settings
          const newSettings = {
            ...settings,
            isRunning: false,
            startTime: undefined,
            timeEntryId: undefined,
          };

          await ev.action.setSettings(newSettings);
          await ev.action.setImage(this.getImagePath('default'));
          await ev.action.setTitle('Auto-stopped');

          // Clear intervals
          clearIntervalForKey(this.updateIntervals, instanceId);

          // Show notification
          streamDeck.logger.info(
            `Timer auto-stopped after ${hours} hours for instance ${instanceId}`
          );

          // Reset title after 3 seconds
          const resetTimeout = setTimeout(async () => {
            const title = settings.displayTitle || 'Start';
            await ev.action.setTitle(String(title));
            this.autoStopResetTimeouts.delete(instanceId);
          }, 3000);

          this.autoStopResetTimeouts.set(instanceId, resetTimeout);
        }
      } catch (error) {
        streamDeck.logger.error(`Error during auto-stop for instance ${instanceId}:`, error);
      }

      // Remove timeout from map
      this.autoStopTimeouts.delete(instanceId);
    }, milliseconds);

    this.autoStopTimeouts.set(instanceId, timeout);
  }
}
