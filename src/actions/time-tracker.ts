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
import {
  isPermanentRequestError,
  isRejectedByMoneybird,
} from '../services/moneybird/error-handler.js';
import {
  TimerSettings,
  projectToJson,
  userToJson,
  contactToJson,
  type JsonValue,
  type MoneybirdTimeEntry,
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
import { PICK_UP_WINDOW_MS, decideRemoteTimers } from '../utils/remote-timers.js';
import { DEFAULT_TIME_ENTRY_DESCRIPTION } from '../services/moneybird/payloads.js';
import type { GlobalSettingsStore } from '../utils/global-settings.js';
import { notifyPropertyInspector, pluginGlobalSettings } from '../utils/plugin-global-settings.js';

type TimerKeyAction = KeyAction<TimerSettings>;

type TimerService = Pick<
  MoneybirdService,
  | 'getAdministrations'
  | 'getProjects'
  | 'getUsers'
  | 'getContacts'
  | 'startTimer'
  | 'stopTimer'
  | 'getRecentTimeEntries'
  | 'getTimeEntry'
>;

export type CreateTimerService = (apiKey: string, administrationId?: string) => TimerService;

function createMoneybirdService(apiKey: string, administrationId?: string): TimerService {
  return new MoneybirdService(apiKey, administrationId);
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const DISPLAY_REFRESH_MS = 1000;
const ERROR_DISPLAY_MS = 2000;
const AUTO_STOP_NOTICE_MS = 3000;
const AUTO_STOP_WARNING_MINUTES = 5;
/** Lower bound for the auto-stop delay of a timer whose limit already passed. */
const MIN_AUTO_STOP_DELAY_MS = 1000;
/** How often visible keys compare their state with Moneybird (#197). */
const SYNC_INTERVAL_MS = 60 * 1000;
/** Delay after a key appears, so keys appearing together share one lookup. */
const SYNC_AFTER_APPEAR_MS = 1000;

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
  remove: ['startTime', 'timeEntryId', 'timerAdministrationId', 'timerPickedUp'],
};

/**
 * The auto-stop limit that applies to the key's running timer, or null for none. A timer
 * picked up from elsewhere is left alone: it was started outside this key, possibly hours
 * ago, and stopping it at once at start plus the key's limit would end work that may still
 * be going on.
 */
function autoStopHoursFor(settings: TimerSettings): number | null {
  if (!settings.autoStopEnabled || settings.timerPickedUp === true) {
    return null;
  }
  return normalizeAutoStopHours(settings.autoStopHours);
}

const ADMINISTRATION_LOCKED_MESSAGE = 'Stop the running timer first to change the administration';

@action({ UUID: 'com.johan-kuijt.moneybird-timer.time-tracker' })
export class TimeTracker extends SingletonAction<TimerSettings> {
  private updateIntervals: Map<string, NodeJS.Timeout> = new Map();
  private autoStopTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private displayResetTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private requestsInFlight: Set<string> = new Set();
  /** Visible keys, for the lookup of timers started or stopped elsewhere. */
  private visibleKeys: Map<string, TimerKeyAction> = new Map();
  private syncInterval: NodeJS.Timeout | undefined;
  private syncSoonTimeout: NodeJS.Timeout | undefined;
  private syncRun: Promise<void> | undefined;
  private syncAgain = false;
  /**
   * Starts whose outcome stayed unknown (no answer, and the entry not found right away),
   * per key: if the sync finds that entry later, it is the key's own timer, not one
   * picked up from elsewhere, so it keeps auto-stop.
   */
  private unconfirmedStarts: Map<
    string,
    { startedAt: number; projectId: string; description: string }
  > = new Map();

  constructor(
    private readonly createService: CreateTimerService = createMoneybirdService,
    private readonly globalSettings: GlobalSettingsStore = pluginGlobalSettings,
    private readonly notify: (message: JsonValue) => Promise<void> = notifyPropertyInspector,
    private readonly options: { syncLoop?: boolean } = {}
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

      // Defence in depth: key presses run in the same queue, so a timer cannot normally
      // start while the lists load. If one did, it keeps its administration and selections.
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

    this.visibleKeys.set(ev.action.id, ev.action);
    this.startSyncLoop();
  }

  override async onWillDisappear(ev: WillDisappearEvent<TimerSettings>): Promise<void> {
    this.clearInstanceRuntime(ev.action.id);
    this.visibleKeys.delete(ev.action.id);
    if (this.visibleKeys.size === 0) {
      this.stopSyncLoop();
    }
  }

  /** Looks up Moneybird soon (keys appearing together share it) and then every minute. */
  private startSyncLoop(): void {
    if (this.options.syncLoop === false) {
      return;
    }
    clearTimeout(this.syncSoonTimeout);
    this.syncSoonTimeout = setTimeout(() => {
      this.syncSoonTimeout = undefined;
      void this.syncWithMoneybird();
    }, SYNC_AFTER_APPEAR_MS);
    if (!this.syncInterval) {
      this.syncInterval = setInterval(() => void this.syncWithMoneybird(), SYNC_INTERVAL_MS);
    }
  }

  private stopSyncLoop(): void {
    clearTimeout(this.syncSoonTimeout);
    clearInterval(this.syncInterval);
    this.syncSoonTimeout = undefined;
    this.syncInterval = undefined;
  }

  /**
   * Brings the visible keys in line with Moneybird: a key picks up a matching timer that
   * was started elsewhere (the web app, another machine), and a key whose timer was
   * stopped elsewhere goes idle. One lookup per administration and user, whatever the
   * number of keys. A failed lookup changes nothing and shows nothing; the next one
   * tries again. Runs never overlap.
   */
  syncWithMoneybird(): Promise<void> {
    if (this.syncRun) {
      // A key that appeared after the run took its snapshot gets one more run right after.
      this.syncAgain = true;
      return this.syncRun;
    }
    this.syncRun = (async () => {
      do {
        this.syncAgain = false;
        await this.runSync().catch(error =>
          logError(streamDeck.logger, 'Error syncing timers with Moneybird', error)
        );
      } while (this.syncAgain && this.visibleKeys.size > 0);
    })().finally(() => {
      this.syncRun = undefined;
    });
    return this.syncRun;
  }

  private async runSync(): Promise<void> {
    const now = new Date();
    const keys = await Promise.all(
      Array.from(this.visibleKeys.values()).map(async action => ({
        action,
        settings: await action.getSettings(),
      }))
    );
    const shownEntryIds = new Set(
      keys.flatMap(key =>
        key.settings.isRunning && key.settings.timeEntryId ? [key.settings.timeEntryId] : []
      )
    );

    type Group = {
      apiKey: string;
      administrationId: string;
      userId: string;
      members: typeof keys;
    };
    const groups = new Map<string, Group>();
    for (const key of keys) {
      const apiKey = await this.resolveApiKey(key.settings);
      const administrationId = key.settings.isRunning
        ? timerAdministrationOf(key.settings)
        : key.settings.administrationId;
      const userId = key.settings.userId;
      if (!apiKey || !administrationId || !userId) {
        continue;
      }
      const groupKey = JSON.stringify([apiKey, administrationId, userId]);
      const group = groups.get(groupKey) ?? { apiKey, administrationId, userId, members: [] };
      group.members.push(key);
      groups.set(groupKey, group);
    }

    for (const group of groups.values()) {
      let entries;
      try {
        entries = await this.createService(
          group.apiKey,
          group.administrationId
        ).getRecentTimeEntries(group.userId, new Date(now.getTime() - PICK_UP_WINDOW_MS), now);
      } catch (error) {
        logError(streamDeck.logger, 'Could not look up timers in Moneybird', error, {
          administrationId: group.administrationId,
        });
        continue;
      }

      const members = group.members;
      const service = this.createService(group.apiKey, group.administrationId);
      const knownIds = new Set(entries.map(entry => entry.id));
      // A running entry that started before the lookup period is not in the list: read it
      // on its own, so a stop elsewhere is still noticed.
      const olderEntries = await Promise.all(
        members
          .filter(
            member =>
              member.settings.isRunning === true &&
              member.settings.timeEntryId &&
              !knownIds.has(member.settings.timeEntryId)
          )
          .map(member =>
            service.getTimeEntry(member.settings.timeEntryId as string).catch(error => {
              logError(streamDeck.logger, 'Could not check a running timer', error, {
                timeEntryId: member.settings.timeEntryId,
              });
              return undefined;
            })
          )
      );

      const decision = decideRemoteTimers(
        members.map(member => ({ id: member.action.id, settings: member.settings })),
        [...entries, ...olderEntries.filter(entry => entry !== undefined)],
        now,
        shownEntryIds
      );
      // Every key takes part in the decision (a key mid-start still wins its own entry by
      // description), but a key with a press in flight is left to that press: its request
      // (a start may take up to a minute) must not hold up the sync for every other key. Checked
      // here, after the last await, so a press that started meanwhile is seen too.
      const actions = new Map(
        members
          .filter(member => !this.requestsInFlight.has(member.action.id))
          .map(member => [member.action.id, member.action])
      );

      const tasks = [
        ...decision.endedElsewhere.map(({ keyId, entry }) => {
          const action = actions.get(keyId);
          return action ? this.releaseStoppedElsewhere(action, entry.id) : undefined;
        }),
        ...decision.pickUp.map(({ keyId, entry }) => {
          const action = actions.get(keyId);
          return action ? this.pickUpRemoteTimer(action, entry, group.administrationId) : undefined;
        }),
      ];
      // Different keys do not wait for each other's queue.
      await Promise.all(
        tasks.map(task =>
          task?.catch(error => logError(streamDeck.logger, 'Error applying a timer sync', error))
        )
      );
    }
  }

  /** The key's own entry already has an end time in Moneybird: go idle, without a stop. */
  private releaseStoppedElsewhere(action: TimerKeyAction, entryId: string): Promise<void> {
    return runInOrder(action.id, async () => {
      const latest = await action.getSettings();
      if (!latest.isRunning || latest.timeEntryId !== entryId) {
        return;
      }
      streamDeck.logger.info(`Timer ${entryId} of ${action.id} was stopped outside the key`);
      await this.resetToIdle(action, latest);
    });
  }

  /** Shows a timer started elsewhere on an idle key, so a press stops it. */
  private pickUpRemoteTimer(
    action: TimerKeyAction,
    entry: MoneybirdTimeEntry,
    administrationId: string
  ): Promise<void> {
    return runInOrder(action.id, async () => {
      // A press waiting for its turn decides what the key does; so does a key now gone.
      if (!this.visibleKeys.has(action.id) || this.requestsInFlight.has(action.id)) {
        return;
      }
      const latest = await action.getSettings();
      if (
        latest.isRunning ||
        latest.administrationId !== administrationId ||
        latest.userId !== entry.user_id ||
        latest.projectId !== entry.project_id
      ) {
        return;
      }
      // An error flash from an earlier press would otherwise redraw the key as idle.
      clearTimeoutForKey(this.displayResetTimeouts, action.id);

      const unconfirmed = this.unconfirmedStarts.get(action.id);
      const startedByThisKey =
        unconfirmed !== undefined &&
        new Date(entry.started_at).getTime() === unconfirmed.startedAt &&
        entry.project_id === unconfirmed.projectId &&
        entry.description === unconfirmed.description;
      this.unconfirmedStarts.delete(action.id);

      const timerState = {
        isRunning: true,
        startTime: new Date(entry.started_at).toISOString(),
        timeEntryId: entry.id,
        timerAdministrationId: administrationId,
        ...(startedByThisKey ? {} : { timerPickedUp: true }),
      };
      await writePatch(action, {
        values: timerState,
        remove: startedByThisKey ? ['timerPickedUp'] : [],
      });
      streamDeck.logger.info(
        startedByThisKey
          ? `Key ${action.id} found its unconfirmed start ${entry.id}`
          : `Key ${action.id} picked up timer ${entry.id} started elsewhere`
      );
      // The display gets the same mark as the stored settings, so a leftover one from
      // `latest` cannot switch off the auto-stop of the key's own start.
      await this.showRunning(action, {
        ...latest,
        ...timerState,
        timerPickedUp: startedByThisKey ? undefined : true,
      });
    });
  }

  override async onKeyDown(ev: KeyDownEvent<TimerSettings>): Promise<void> {
    const instanceId = ev.action.id;
    // The press may wait in the queue below; the entry starts or ends when the key was
    // pressed, not when its turn comes.
    const pressedAt = new Date();

    // runExclusivePerKey drops a double press. runInOrder puts the press in the key's queue
    // with the property inspector's messages, so a start or stop never overlaps an API key
    // or administration change, and both decide on the same, current settings.
    const handled = await runExclusivePerKey(this.requestsInFlight, instanceId, () =>
      runInOrder(instanceId, () => this.toggleTimer(ev.action, pressedAt))
    );

    if (!handled) {
      streamDeck.logger.debug(`Ignoring key press for ${instanceId}: request still in flight`);
    }
  }

  private async toggleTimer(action: TimerKeyAction, pressedAt: Date): Promise<void> {
    // Read now, not from the key press: an earlier message in the queue may have changed them.
    const settings = await action.getSettings();
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
      await this.stopTimer(
        action,
        settings,
        this.createService(apiKey, timerAdministrationId),
        pressedAt
      );
      return;
    }

    if (!apiKey || !settings.administrationId || !settings.projectId || !settings.userId) {
      streamDeck.logger.debug('Missing required settings');
      await setConfigNeededDisplay(action, this.getImagePath('default'));
      return;
    }

    await this.startTimer(
      action,
      settings,
      this.createService(apiKey, settings.administrationId),
      pressedAt
    );
  }

  private async startTimer(
    action: TimerKeyAction,
    settings: TimerSettings,
    moneybirdService: TimerService,
    startedAt: Date
  ): Promise<void> {
    const instanceId = action.id;

    let timeEntry: MoneybirdTimeEntry | undefined;
    try {
      timeEntry = await moneybirdService.startTimer(settings, startedAt);
    } catch (error: unknown) {
      logError(streamDeck.logger, 'Error starting timer', error, { instanceId });
      // Unless Moneybird refused it, it may have created the entry anyway (a timeout, a
      // dropped connection, a cut-off answer). Look for it instead of retrying, which could
      // create a second one (#208).
      timeEntry = isRejectedByMoneybird(error)
        ? undefined
        : await this.findUnansweredStart(action, moneybirdService, settings, startedAt);
      if (!timeEntry) {
        // Nothing was stored, so the key simply stays idle. If Moneybird did create the
        // entry after all, the next sync with Moneybird picks it up, as this key's own.
        if (!isRejectedByMoneybird(error)) {
          this.rememberUnconfirmedStart(instanceId, settings, startedAt);
        }
        await this.flashError(action, () => this.showIdle(action, settings));
        return;
      }
      streamDeck.logger.info(
        `Start for ${instanceId} got no answer; found entry ${timeEntry.id} in Moneybird`
      );
    }

    // This press got its entry, so an earlier start the key could not confirm is no longer
    // the key's last start: an entry from it that turns up later is treated as picked up.
    this.unconfirmedStarts.delete(instanceId);

    try {
      const timerState = {
        isRunning: true,
        startTime: startedAt.toISOString(),
        timeEntryId: timeEntry.id,
        timerAdministrationId: settings.administrationId,
      };

      // Only the timer fields are written, onto the settings as they are now: anything
      // saved while the start request was in flight is kept.
      // A started timer is the key's own: a leftover picked-up mark must not switch off
      // its auto-stop.
      await writePatch(action, { values: timerState, remove: ['timerPickedUp'] });
      await this.showRunning(action, { ...settings, ...timerState, timerPickedUp: undefined });
      streamDeck.logger.debug(`Timer started for instance ${instanceId}`);
    } catch (error: unknown) {
      logError(streamDeck.logger, 'Error saving the started timer', error, {
        instanceId,
        timeEntryId: timeEntry.id,
      });
      // The entry exists in Moneybird, but the key does not show it. Remember it like a
      // start without an answer, so the next sync picks it up as this key's own and keeps
      // its auto-stop.
      this.rememberUnconfirmedStart(instanceId, settings, startedAt);
      await this.flashError(action, () => this.showIdle(action, settings));
    }
  }

  /**
   * Remembers a start whose entry the key may not show, so the sync can tell it from a
   * timer started elsewhere. Moneybird stores the start as the press minute exactly.
   */
  private rememberUnconfirmedStart(
    instanceId: string,
    settings: TimerSettings,
    startedAt: Date
  ): void {
    this.unconfirmedStarts.set(instanceId, {
      startedAt: Math.floor(startedAt.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE,
      projectId: settings.projectId,
      description: settings.description || DEFAULT_TIME_ENTRY_DESCRIPTION,
    });
  }

  /**
   * After a start whose outcome is unknown: the entry this press created, if Moneybird did.
   * Moneybird stores the start as the press minute exactly (the payload sends HH:mm), so the
   * entry must have that start, this key's project and description, and not be shown by
   * another key; only a single such entry is taken.
   */
  private async findUnansweredStart(
    action: TimerKeyAction,
    moneybirdService: TimerService,
    settings: TimerSettings,
    startedAt: Date
  ): Promise<MoneybirdTimeEntry | undefined> {
    const pressMinute = Math.floor(startedAt.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE;
    const description = settings.description || DEFAULT_TIME_ENTRY_DESCRIPTION;
    try {
      const shownElsewhere = new Set(
        (
          await Promise.all(
            Array.from(this.visibleKeys.values())
              .filter(key => key.id !== action.id)
              .map(key => key.getSettings())
          )
        ).flatMap(other => (other.isRunning && other.timeEntryId ? [other.timeEntryId] : []))
      );
      // A day of margin on both sides: the period is a date in Moneybird's time zone.
      const entries = await moneybirdService.getRecentTimeEntries(
        settings.userId,
        new Date(startedAt.getTime() - MS_PER_DAY),
        new Date(Date.now() + MS_PER_DAY)
      );
      const matches = entries.filter(
        entry =>
          entry.ended_at === null &&
          entry.project_id === settings.projectId &&
          entry.description === description &&
          new Date(entry.started_at).getTime() === pressMinute &&
          !shownElsewhere.has(entry.id)
      );
      return matches.length === 1 ? matches[0] : undefined;
    } catch (error) {
      logError(streamDeck.logger, 'Could not check whether the start was created', error);
      return undefined;
    }
  }

  private async stopTimer(
    action: TimerKeyAction,
    settings: TimerSettings,
    moneybirdService: TimerService,
    pressedAt: Date
  ): Promise<void> {
    const instanceId = action.id;

    if (!settings.timeEntryId) {
      streamDeck.logger.warn(`Timer for ${instanceId} is marked running without a time entry`);
      await this.resetToIdle(action, settings);
      return;
    }

    if (await this.isStoppedElsewhere(moneybirdService, settings.timeEntryId)) {
      // Stopped in the web app or elsewhere: keep that end time instead of overwriting it.
      streamDeck.logger.info(`Timer ${settings.timeEntryId} was already stopped elsewhere`);
      await this.resetToIdle(action, settings);
      return;
    }

    try {
      await moneybirdService.stopTimer(
        settings.timeEntryId,
        this.resolveStopTime(settings, pressedAt)
      );
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

  /**
   * True when Moneybird already has an end time for the entry. When that cannot be read,
   * the stop request itself goes ahead and reports its own errors.
   */
  private async isStoppedElsewhere(
    moneybirdService: TimerService,
    timeEntryId: string
  ): Promise<boolean> {
    try {
      return Boolean((await moneybirdService.getTimeEntry(timeEntryId)).ended_at);
    } catch (error) {
      logError(streamDeck.logger, 'Could not check the time entry before stopping', error, {
        timeEntryId,
      });
      return false;
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
   * the machine slept through the auto-stop timeout; otherwise when the key was pressed.
   */
  private resolveStopTime(settings: TimerSettings, pressedAt: Date): Date {
    const autoStopHours = autoStopHoursFor(settings);

    if (autoStopHours === null || !settings.startTime) {
      return pressedAt;
    }
    return resolveAutoStopEndTime(settings.startTime, autoStopHours, pressedAt);
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

    const autoStopHours = autoStopHoursFor(settings);
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

    const autoStopHours = autoStopHoursFor(settings);
    if (autoStopHours === null || !settings.startTime) {
      return;
    }

    const remainingHours = calculateRemainingAutoStopHours(settings.startTime, autoStopHours);
    const delayMs = Math.max(remainingHours * MS_PER_HOUR, MIN_AUTO_STOP_DELAY_MS);
    streamDeck.logger.debug(`Auto-stop for ${instanceId} in ${Math.round(delayMs / 1000)}s`);

    const timeout = setTimeout(() => {
      this.autoStopTimeouts.delete(instanceId);
      runExclusivePerKey(this.requestsInFlight, instanceId, () =>
        runInOrder(instanceId, () => this.autoStop(action, autoStopHours))
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

    const apiKey = await this.resolveApiKey(settings);
    const moneybirdService = apiKey
      ? this.createService(apiKey, timerAdministrationOf(settings))
      : undefined;
    if (
      moneybirdService &&
      (await this.isStoppedElsewhere(moneybirdService, settings.timeEntryId))
    ) {
      // Stopped elsewhere while the key could not see it (asleep, offline): keep that end.
      streamDeck.logger.info(`Timer ${settings.timeEntryId} was already stopped elsewhere`);
      await this.resetToIdle(action, settings);
      return;
    }

    try {
      if (!moneybirdService) {
        throw new Error('No Moneybird API key configured');
      }
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
