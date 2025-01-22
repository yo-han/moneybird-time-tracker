import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  SendToPluginEvent,
  WillDisappearEvent,
  JsonValue,
  DidReceiveSettingsEvent,
} from '@elgato/streamdeck';
import { MoneybirdService } from '../services/moneybird';
import { TimerSettings, projectToJson, administrationToJson, userToJson } from '../types/moneybird';
import { differenceInSeconds, differenceInMinutes, differenceInHours } from 'date-fns';
import path from 'path';

@action({ UUID: 'com.johan-kuijt.moneybird-timer.time-tracker' })
export class TimeTracker extends SingletonAction<TimerSettings> {
  private updateIntervals: Map<string, NodeJS.Timeout> = new Map();

  private getImagePath(type: 'default' | 'active' | 'error'): string {
    const baseDir = 'imgs/actions/timer';
    const imageName = `key_${type}.png`;
    return path.join(baseDir, imageName);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TimerSettings>): Promise<void> {
    try {
      const settings = ev.payload.settings;
      const instanceId = ev.action.id;

      if (settings.displayTitle !== undefined && !settings.isRunning) {
        const title = settings.displayTitle || 'Start';
        await ev.action.setTitle(String(title));
      }

      streamDeck.logger.debug(`Settings updated for instance ${instanceId}:`, settings);
    } catch (error) {
      streamDeck.logger.error('Error in onDidReceiveSettings:', error);
    }
  }

  override async onSendToPlugin(ev: SendToPluginEvent<any, TimerSettings>): Promise<void> {
    try {
      streamDeck.logger.debug(
        'Plugin received SendToPlugin message:',
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
    ev: SendToPluginEvent<any, TimerSettings>
  ): Promise<void> {
    const { administrationId } = ev.payload;
    const currentSettings = await ev.action.getSettings();

    if (!currentSettings.apiKey || !administrationId) {
      return;
    }

    try {
      const moneybirdService = new MoneybirdService(currentSettings.apiKey, administrationId);

      const [rawProjects, rawUsers] = await Promise.all([
        moneybirdService.getProjects(),
        moneybirdService.getUsers(administrationId),
      ]);

      const projects = Object.fromEntries(
        rawProjects.map(project => [project.id, projectToJson(project)])
      );
      const users = Object.fromEntries(rawUsers.map(user => [user.id, userToJson(user)]));

      streamDeck.logger.debug(
        `Fetched ${rawProjects.length} projects and ${rawUsers.length} users for administration ${administrationId}`
      );

      const newSettings: TimerSettings = {
        ...currentSettings,
        administrationId,
        projects,
        users,
        projectId: '',
        userId: '',
      };

      await ev.action.setSettings(newSettings);
    } catch (fetchError) {
      streamDeck.logger.error('Error fetching Moneybird data:', {
        message: (fetchError as Error).message,
        stack: (fetchError as Error).stack,
        response: (fetchError as any).response?.data,
      });
    }
  }

  private async handleGlobalSettings(ev: SendToPluginEvent<any, TimerSettings>): Promise<void> {
    const { apiKey, administrationId } = ev.payload;
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

      if (administrationId) {
        await this.handleAdministrationChange(ev);
      }
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
        projects: {},
        users: {},
      };
      await ev.action.setSettings(clearedSettings);
    }
  }

  override async onWillAppear(ev: WillAppearEvent<TimerSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const instanceId = ev.action.id;

    streamDeck.logger.debug(`Action appeared with settings for instance ${instanceId}:`, settings);

    if (settings.isRunning && settings.startTime) {
      await this.updateTimerDisplay(ev);
      this.startUpdateInterval(ev);
    } else {
      await ev.action.setImage(this.getImagePath('default'));

      const title = settings.displayTitle ? settings.displayTitle : 'Start';
      await ev.action.setTitle(String(title));
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent<TimerSettings>): Promise<void> {
    const instanceId = ev.action.id;
    const interval = this.updateIntervals.get(instanceId);
    if (interval) {
      clearInterval(interval);
      this.updateIntervals.delete(instanceId);
    }
  }

  override async onKeyDown(ev: KeyDownEvent<TimerSettings>): Promise<void> {
    const settings = ev.payload.settings;
    const instanceId = ev.action.id;

    streamDeck.logger.debug(`Key pressed for instance ${instanceId} with settings:`, settings);

    if (!settings.apiKey || !settings.administrationId || !settings.projectId || !settings.userId) {
      streamDeck.logger.debug('Missing required settings');
      await ev.action.setImage(this.getImagePath('default'));
      await ev.action.setTitle('Config needed');
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

        const interval = this.updateIntervals.get(instanceId);
        if (interval) {
          clearInterval(interval);
          this.updateIntervals.delete(instanceId);
        }
      }
    } catch (error: any) {
      streamDeck.logger.error(`Error managing timer for instance ${instanceId}:`, error);

      await ev.action.setImage(this.getImagePath('error'));
      await ev.action.setTitle('Error');

      const newSettings = {
        ...settings,
        isRunning: false,
        startTime: undefined,
        timeEntryId: undefined,
      };
      await ev.action.setSettings(newSettings);

      const interval = this.updateIntervals.get(instanceId);
      if (interval) {
        clearInterval(interval);
        this.updateIntervals.delete(instanceId);
      }
    }
  }

  private startUpdateInterval(
    ev: WillAppearEvent<TimerSettings> | KeyDownEvent<TimerSettings>
  ): void {
    const instanceId = ev.action.id;
    const settings = ev.payload.settings;

    streamDeck.logger.debug(
      'Starting update interval with settings:',
      JSON.stringify(settings, null, 2)
    );

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
      let imagePath: string;

      if (totalMinutes < 1) {
        displayTime = `${totalSeconds}s`;
      } else if (totalHours < 1) {
        displayTime = `${totalMinutes}m`;
      } else {
        displayTime = `${totalHours}h`;
      }

      imagePath = this.getImagePath('active');

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
}
