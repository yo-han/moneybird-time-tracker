import streamDeck, {
  action,
  KeyAction,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  SendToPluginEvent,
  WillDisappearEvent,
  DidReceiveSettingsEvent,
} from '@elgato/streamdeck';
import { MoneybirdService } from '../services/moneybird.js';
import { isPermanentRequestError } from '../services/moneybird/error-handler.js';
import {
  TimerSettings,
  projectToJson,
  userToJson,
  contactToJson,
  type JsonValue,
} from '../types/moneybird.js';
import path from 'path';
import {
  calculateRemainingAutoStopHours,
  normalizeAutoStopHours,
  resolveAutoStopEndTime,
} from '../utils/auto-stop-utils.js';
import {
  clearIntervalForKey,
  clearTimeoutForKey,
  setIntervalForKey,
  setTimeoutForKey,
} from '../utils/runtime-timers.js';
import { setConfigNeededDisplay, setErrorDisplay } from '../utils/action-display.js';
import { logError } from '../utils/error-logging.js';
import { isKeyActionEvent } from '../utils/key-action.js';
import { formatElapsedTime } from '../utils/elapsed-time.js';
import { runExclusivePerKey } from '../utils/in-flight.js';
import {
  applyApiKeyEvent,
  rememberDefaultAdministration,
  type ApiKeyEventPayload,
  type DependentList,
} from '../utils/api-key-settings.js';
import { migrateKeyCredentials, resolveApiKeyFromStore } from '../utils/credentials.js';
import {
  runInOrder,
  writePatch,
  type SettingsAction,
  type SettingsPatch,
} from '../utils/settings-writes.js';
import { timerAdministrationOf } from '../utils/running-timer.js';
import type { GlobalSettingsStore } from '../utils/global-settings.js';
import { notifyPropertyInspector, pluginGlobalSettings } from '../utils/plugin-global-settings.js';

type TimerKeyAction = KeyAction<TimerSettings>;

type TimerService = Pick<
  MoneybirdService,
  'getAdministrations' | 'getProjects' | 'getUsers' | 'getContacts' | 'startTimer' | 'stopTimer'
>;

export type CreateTimerService = (apiKey: string, administrationId?: string) => TimerService;

function createMoneybirdService(apiKey: string, administrationId?: string): TimerService {
  return new MoneybirdService(apiKey, administrationId);
}

const MS_PER_HOUR = 60 * 60 * 1000;
const DISPLAY_REFRESH_MS = 1000;
const ERROR_DISPLAY_MS = 2000;
const AUTO_STOP_NOTICE_MS = 3000;
const AUTO_STOP_WARNING_MINUTES = 5;
/** Lower bound for the auto-stop delay of a timer whose limit already passed. */
const MIN_AUTO_STOP_DELAY_MS = 1000;

/** The lists in the timer's property inspector that depend on the administration. */
const TIMER_LISTS: DependentList[] = [
  {
    list: 'projects',
    selection: 'projectId',
    fetch: async service =>
      Object.fromEntries((await service.getProjects()).map(p => [p.id, projectToJson(p)])),
  },
  {
    list: 'users',
    selection: 'userId',
    fetch: async service =>
      Object.fromEntries((await service.getUsers()).map(u => [u.id, userToJson(u)])),
  },
  {
    list: 'contacts',
    selection: 'contactId',
    fetch: async service =>
      Object.fromEntries((await service.getContacts()).map(c => [c.id, contactToJson(c)])),
  },
];

/**
 * Ends the timer state of a key. Only these fields are written, onto the settings as they
 * are at that moment: anything saved while the stop request was in flight is kept.
 */
const IDLE_TIMER_PATCH: SettingsPatch = {
  values: { isRunning: false },
  remove: ['startTime', 'timeEntryId', 'timerAdministrationId'],
};

const ADMINISTRATION_LOCKED_MESSAGE = 'Stop the running timer first to change the administration';

@action({ UUID: 'com.johan-kuijt.moneybird-timer.time-tracker' })
export class TimeTracker extends SingletonAction<TimerSettings> {
  private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
  private autoStopTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private displayResetTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private requestsInFlight: Set<string> = new Set();

  constructor(
    private readonly createService: CreateTimerService = createMoneybirdService,
    private readonly globalSettings: GlobalSettingsStore = pluginGlobalSettings,
    private readonly notify: (message: JsonValue) => Promise<void> = notifyPropertyInspector
  ) {
    super();
  }

  private async resolveApiKey(settings: TimerSettings): Promise<string | undefined> {
    return resolveApiKeyFromStore(settings, this.globalSettings, streamDeck.logger);
  }

  private getImagePath(type: 'default' | 'active' | 'error'): string {
    return path.join('imgs/actions/timer', `key_${type}.png`);
  }

  private getIdleTitle(settings: TimerSettings): string {
    return settings.displayTitle || 'Start';
  }

  private clearInstanceRuntime(instanceId: string): void {
    clearIntervalForKey(this.updateIntervals, instanceId);
    clearTimeoutForKey(this.autoStopTimeouts, instanceId);
    clearTimeoutForKey(this.displayResetTimeouts, instanceId);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TimerSettings>): Promise<void> {
    try {
      const settings = ev.payload.settings;

      if (isKeyActionEvent(ev) && settings.displayTitle !== undefined && !settings.isRunning) {
        await ev.action.setTitle(this.getIdleTitle(settings));
      }

      streamDeck.logger.debug(`Settings updated for instance ${ev.action.id}`);
    } catch (error) {
      logError(streamDeck.logger, 'Error in onDidReceiveSettings', error);
    }
  }

  override async onSendToPlugin(
    ev: SendToPluginEvent<ApiKeyEventPayload, TimerSettings>
  ): Promise<void> {
    try {
      streamDeck.logger.debug(
        `Plugin received SendToPlugin event: ${ev.payload?.event || 'unknown'}`
      );

      const event = ev.payload?.event;
      if (event === 'apiKeyChanged' || event === 'loadAdministrations') {
        await applyApiKeyEvent(ev.action, ev.payload, {
          store: this.globalSettings,
          logger: streamDeck.logger,
          dependents: TIMER_LISTS,
          notify: this.notify,
          createService: this.createService,
        });
      } else if (event === 'administrationSelected') {
        await this.handleAdministrationChange(ev);
      }
    } catch (error) {
      logError(streamDeck.logger, 'Unexpected error in onSendToPlugin', error);
    }
  }

  /**
   * Loads the lists of the picked administration. Runs in the key's queue with the API key
   * events, and writes only its own fields onto the settings as they are once the lists
   * are in, so a timer started or a field saved meanwhile is kept.
   */
  private handleAdministrationChange(
    ev: SendToPluginEvent<ApiKeyEventPayload, TimerSettings>
  ): Promise<void> {
    return runInOrder(ev.action.id, () => this.loadAdministrationLists(ev));
  }

  private async loadAdministrationLists(
    ev: SendToPluginEvent<ApiKeyEventPayload, TimerSettings>
  ): Promise<void> {
    const { administrationId } = ev.payload;
    const currentSettings = await ev.action.getSettings();
    const apiKey = await this.resolveApiKey(currentSettings);

    if (!apiKey || !administrationId) {
      streamDeck.logger.debug('Missing apiKey or administrationId, aborting');
      return;
    }

    if (currentSettings.isRunning) {
      await this.refuseAdministrationChange(ev.action, currentSettings, administrationId);
      return;
    }

    await rememberDefaultAdministration(this.globalSettings, administrationId, streamDeck.logger);

    try {
      const moneybirdService = this.createService(apiKey, administrationId);

      const [rawProjects, rawUsers, rawContacts] = await Promise.all([
        moneybirdService.getProjects(),
        moneybirdService.getUsers(),
        moneybirdService.getContacts(),
      ]);

      streamDeck.logger.debug(
        `Fetched ${rawProjects.length} projects, ${rawUsers.length} users and ${rawContacts.length} contacts for administration ${administrationId}`
      );

      // The key may have been pressed while the lists loaded: a timer that started
      // meanwhile keeps its administration and selections too.
      const latestSettings = await ev.action.getSettings();
      if (latestSettings.isRunning) {
        await this.refuseAdministrationChange(ev.action, latestSettings, administrationId);
        return;
      }

      await writePatch(ev.action, {
        values: {
          administrationId,
          projects: Object.fromEntries(
            rawProjects.map(project => [project.id, projectToJson(project)])
          ),
          users: Object.fromEntries(rawUsers.map(user => [user.id, userToJson(user)])),
          contacts: Object.fromEntries(
            rawContacts.map(contact => [contact.id, contactToJson(contact)])
          ),
          projectId: '',
          userId: '',
          contactId: '',
        },
      });
    } catch (fetchError) {
      logError(streamDeck.logger, 'Error loading the administration lists', fetchError, {
        administrationId,
      });
    }
  }

  /**
   * A running timer keeps its administration: its entry lives there, and the selections
   * belong to it. The property inspector may already have saved the new administration,
   * so it is put back, and the property inspector is told why.
   */
  private async refuseAdministrationChange(
    action: SettingsAction<TimerSettings>,
    settings: TimerSettings,
    requestedAdministrationId: string
  ): Promise<void> {
    const timerAdministrationId = timerAdministrationOf(settings);
    if (
      requestedAdministrationId === timerAdministrationId &&
      settings.administrationId === timerAdministrationId
    ) {
      return;
    }

    streamDeck.logger.warn(
      `Refusing administration change for ${action.id}: a timer is running in administration ${timerAdministrationId}`
    );
    if (settings.administrationId !== timerAdministrationId) {
      await writePatch(action, { values: { administrationId: timerAdministrationId } });
    }
    await this.notify({
      event: 'administrationRejected',
      actionId: action.id,
      message: ADMINISTRATION_LOCKED_MESSAGE,
    });
  }

  override async onWillAppear(ev: WillAppearEvent<TimerSettings>): Promise<void> {
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
    streamDeck.logger.debug(`Action appeared for instance ${ev.action.id}`);

    if (settings.isRunning && settings.startTime) {
      await this.showRunning(ev.action, settings);
    } else {
      await this.showIdle(ev.action, settings);
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent<TimerSettings>): Promise<void> {
    this.clearInstanceRuntime(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<TimerSettings>): Promise<void> {
    const instanceId = ev.action.id;

    const handled = await runExclusivePerKey(this.requestsInFlight, instanceId, () =>
      this.toggleTimer(ev.action, ev.payload.settings)
    );

    if (!handled) {
      streamDeck.logger.debug(`Ignoring key press for ${instanceId}: request still in flight`);
    }
  }

  private async toggleTimer(action: TimerKeyAction, settings: TimerSettings): Promise<void> {
    const apiKey = await this.resolveApiKey(settings);

    if (settings.isRunning) {
      // Stopping needs only the entry and its administration, not a project or user: a
      // running timer must stay stoppable whatever happened to the key's selections.
      const timerAdministrationId = timerAdministrationOf(settings);
      if (!apiKey || !timerAdministrationId) {
        streamDeck.logger.debug('Missing API key or administration for the running timer');
        await setConfigNeededDisplay(action, this.getImagePath('default'));
        return;
      }
      await this.stopTimer(action, settings, this.createService(apiKey, timerAdministrationId));
      return;
    }

    if (!apiKey || !settings.administrationId || !settings.projectId || !settings.userId) {
      streamDeck.logger.debug('Missing required settings');
      await setConfigNeededDisplay(action, this.getImagePath('default'));
      return;
    }

    await this.startTimer(action, settings, this.createService(apiKey, settings.administrationId));
  }

  private async startTimer(
    action: TimerKeyAction,
    settings: TimerSettings,
    moneybirdService: TimerService
  ): Promise<void> {
    const instanceId = action.id;

    try {
      const startedAt = new Date();
      const timeEntry = await moneybirdService.startTimer(settings, startedAt);

      const timerState = {
        isRunning: true,
        startTime: startedAt.toISOString(),
        timeEntryId: timeEntry.id,
        timerAdministrationId: settings.administrationId,
      };

      // Only the timer fields are written, onto the settings as they are now: anything
      // saved while the start request was in flight is kept.
      await writePatch(action, { values: timerState });
      await this.showRunning(action, { ...settings, ...timerState });
      streamDeck.logger.debug(`Timer started for instance ${instanceId}`);
    } catch (error: unknown) {
      // Nothing was stored yet, so the key simply stays idle.
      logError(streamDeck.logger, 'Error starting timer', error, { instanceId });
      await this.flashError(action, () => this.showIdle(action, settings));
    }
  }

  private async stopTimer(
    action: TimerKeyAction,
    settings: TimerSettings,
    moneybirdService: TimerService
  ): Promise<void> {
    const instanceId = action.id;

    if (!settings.timeEntryId) {
      streamDeck.logger.warn(`Timer for ${instanceId} is marked running without a time entry`);
      await this.resetToIdle(action, settings);
      return;
    }

    try {
      await moneybirdService.stopTimer(settings.timeEntryId, this.resolveStopTime(settings));
      await this.resetToIdle(action, settings);
      streamDeck.logger.debug(`Timer stopped for instance ${instanceId}`);
    } catch (error: unknown) {
      logError(streamDeck.logger, 'Error stopping timer', error, {
        instanceId,
        timeEntryId: settings.timeEntryId,
      });

      if (isPermanentRequestError(error)) {
        // Moneybird refuses this entry for good (deleted, invoiced or invalid): retrying
        // cannot stop it, so release the key. The log above names the entry to check.
        await this.resetToIdle(action, settings);
        await this.flashError(action, () => this.showIdle(action, settings));
        return;
      }

      // Network, auth, rate limit or server error: the entry may still be running in
      // Moneybird. Keep its id so the next press can retry instead of orphaning it.
      await this.flashError(action, () =>
        this.showRunning(action, settings, { scheduleAutoStop: false })
      );
    }
  }

  private async resetToIdle(action: TimerKeyAction, settings: TimerSettings): Promise<void> {
    this.clearInstanceRuntime(action.id);
    await writePatch(action, IDLE_TIMER_PATCH);
    await this.showIdle(action, settings);
  }

  private async showIdle(action: TimerKeyAction, settings: TimerSettings): Promise<void> {
    await action.setImage(this.getImagePath('default'));
    await action.setTitle(this.getIdleTitle(settings));
  }

  /**
   * Ends a manual stop at the auto-stop limit when that has already passed, e.g. because
   * the machine slept through the auto-stop timeout; otherwise now.
   */
  private resolveStopTime(settings: TimerSettings): Date {
    const autoStopHours = settings.autoStopEnabled
      ? normalizeAutoStopHours(settings.autoStopHours)
      : null;

    if (autoStopHours === null || !settings.startTime) {
      return new Date();
    }
    return resolveAutoStopEndTime(settings.startTime, autoStopHours);
  }

  /**
   * Shows the running state and (re)starts the per-second refresh. Auto-stop is scheduled
   * too, except when redrawing after a failed stop: with the limit already passed that
   * would retry the failing request every second.
   */
  private async showRunning(
    action: TimerKeyAction,
    settings: TimerSettings,
    { scheduleAutoStop = true }: { scheduleAutoStop?: boolean } = {}
  ): Promise<void> {
    const instanceId = action.id;

    await action.setImage(this.getImagePath('active'));
    await this.renderElapsedTitle(action, settings);

    const interval = setInterval(() => {
      this.renderElapsedTitle(action, settings).catch(error =>
        logError(streamDeck.logger, 'Error updating display', error, { instanceId })
      );
    }, DISPLAY_REFRESH_MS);
    setIntervalForKey(this.updateIntervals, instanceId, interval);

    if (scheduleAutoStop) {
      this.scheduleAutoStop(action, settings);
    }
  }

  /**
   * Shows "Error" for a moment, then lets `restore` redraw the key. The refresh interval is
   * paused meanwhile, otherwise it would overwrite the error within a second.
   */
  private async flashError(action: TimerKeyAction, restore: () => Promise<void>): Promise<void> {
    const instanceId = action.id;

    clearIntervalForKey(this.updateIntervals, instanceId);
    await setErrorDisplay(action, this.getImagePath('error'));

    const timeout = setTimeout(() => {
      this.displayResetTimeouts.delete(instanceId);
      restore().catch(error =>
        logError(streamDeck.logger, 'Error restoring display', error, { instanceId })
      );
    }, ERROR_DISPLAY_MS);
    setTimeoutForKey(this.displayResetTimeouts, instanceId, timeout);
  }

  private async renderElapsedTitle(action: TimerKeyAction, settings: TimerSettings): Promise<void> {
    if (!settings.startTime) {
      return;
    }

    const elapsedSeconds = (Date.now() - new Date(settings.startTime).getTime()) / 1000;
    let title = `⏱️ ${formatElapsedTime(elapsedSeconds)}`;

    const autoStopHours = settings.autoStopEnabled
      ? normalizeAutoStopHours(settings.autoStopHours)
      : null;
    if (autoStopHours !== null) {
      const remainingMinutes = (autoStopHours * 3600 - elapsedSeconds) / 60;
      if (remainingMinutes > 0 && remainingMinutes <= AUTO_STOP_WARNING_MINUTES) {
        title = `⚠️ ${title}`;
      }
    }

    await action.setTitle(title);
  }

  private scheduleAutoStop(action: TimerKeyAction, settings: TimerSettings): void {
    const instanceId = action.id;
    clearTimeoutForKey(this.autoStopTimeouts, instanceId);

    const autoStopHours = settings.autoStopEnabled
      ? normalizeAutoStopHours(settings.autoStopHours)
      : null;
    if (autoStopHours === null || !settings.startTime) {
      return;
    }

    const remainingHours = calculateRemainingAutoStopHours(settings.startTime, autoStopHours);
    const delayMs = Math.max(remainingHours * MS_PER_HOUR, MIN_AUTO_STOP_DELAY_MS);
    streamDeck.logger.debug(`Auto-stop for ${instanceId} in ${Math.round(delayMs / 1000)}s`);

    const timeout = setTimeout(() => {
      this.autoStopTimeouts.delete(instanceId);
      runExclusivePerKey(this.requestsInFlight, instanceId, () =>
        this.autoStop(action, autoStopHours)
      ).catch(error =>
        logError(streamDeck.logger, 'Error during auto-stop', error, { instanceId })
      );
    }, delayMs);
    setTimeoutForKey(this.autoStopTimeouts, instanceId, timeout);
  }

  private async autoStop(action: TimerKeyAction, autoStopHours: number): Promise<void> {
    const instanceId = action.id;
    const settings = await action.getSettings();

    if (!settings.isRunning || !settings.timeEntryId || !settings.startTime) {
      return;
    }

    const endedAt = resolveAutoStopEndTime(settings.startTime, autoStopHours);

    try {
      const apiKey = await this.resolveApiKey(settings);
      if (!apiKey) {
        throw new Error('No Moneybird API key configured');
      }
      const moneybirdService = this.createService(apiKey, timerAdministrationOf(settings));
      await moneybirdService.stopTimer(settings.timeEntryId, endedAt);
    } catch (error) {
      logError(streamDeck.logger, 'Error during auto-stop', error, {
        instanceId,
        timeEntryId: settings.timeEntryId,
      });

      if (!isPermanentRequestError(error)) {
        // Possibly still running in Moneybird: keep the state so a key press can stop it.
        // No automatic retry; the manual stop ends the entry at the same limit.
        await this.flashError(action, () =>
          this.showRunning(action, settings, { scheduleAutoStop: false })
        );
        return;
      }
    }

    await this.resetToIdle(action, settings);
    await action.setTitle('Auto-stopped');
    streamDeck.logger.info(`Timer auto-stopped after ${autoStopHours} hours for ${instanceId}`);

    const resetTimeout = setTimeout(() => {
      this.displayResetTimeouts.delete(instanceId);
      action
        .setTitle(this.getIdleTitle(settings))
        .catch(error =>
          logError(streamDeck.logger, 'Error resetting title', error, { instanceId })
        );
    }, AUTO_STOP_NOTICE_MS);
    setTimeoutForKey(this.displayResetTimeouts, instanceId, resetTimeout);
  }
}
