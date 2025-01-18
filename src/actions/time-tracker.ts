import streamDeck, { action, KeyDownEvent, SingletonAction, WillAppearEvent, SendToPluginEvent } from "@elgato/streamdeck";
import { MoneybirdService } from "../services/moneybird";
import { TimerSettings } from "../types/moneybird";
import { differenceInSeconds, differenceInMinutes, differenceInHours } from 'date-fns';
import path from 'path';

@action({ UUID: "com.johan-kuijt.moneybird-timer.time-tracker" })
export class TimeTracker extends SingletonAction<TimerSettings> {
    private updateInterval?: NodeJS.Timeout;

    private getImagePath(type: 'default' | 'active' | 'error'): string {
        const baseDir = 'imgs/actions/timer';
        const imageName = `key_${type}.png`;
        return path.join(baseDir, imageName);
    }

    override async onSendToPlugin(ev: SendToPluginEvent<any, TimerSettings>): Promise<void> {
        try {
            streamDeck.logger.debug('Plugin received SendToPlugin message:', JSON.stringify(ev.payload, null, 2));

            if (ev.payload && ev.payload.event === 'setGlobalSettings') {
                const { apiKey, administrationId } = ev.payload;
                
                // Validate API key is not empty
                if (!apiKey) {
                    streamDeck.logger.warn('No API key provided');
                    return;
                }

                try {
                    // First, create service with just API key to fetch administrations
                    const moneybirdService = new MoneybirdService(apiKey);
                    
                    // Fetch administrations
                    const administrations = await moneybirdService.getAdministrations();
                    streamDeck.logger.debug(`Fetched ${administrations.length} administrations`);
                    
                    // If a specific administration is selected, fetch its projects and users
                    let projects: any[] = [];
                    let users: any[] = [];
                    if (administrationId) {
                        const selectedService = new MoneybirdService(apiKey, administrationId);
                        projects = await selectedService.getProjects();
                        users = await selectedService.getUsers(administrationId);
                        
                        streamDeck.logger.debug(`Fetched ${projects.length} projects and ${users.length} users for administration ${administrationId}`);
                    }

                    // Send data back to the property inspector
                    await ev.action.setSettings({
                        ...ev.payload.settings,
                        apiKey: apiKey,
                        administrations: administrations,
                        projects: projects,
                        users: users
                    });
                } catch (fetchError) {
                    // More detailed error logging
                    streamDeck.logger.error('Error fetching Moneybird data:', {
                        message: (fetchError as Error).message,
                        stack: (fetchError as Error).stack,
                        response: (fetchError as any).response?.data
                    });

                    // Clear settings on error
                    await ev.action.setSettings({
                        ...ev.payload.settings,
                        apiKey: apiKey,
                        administrations: [],
                        projects: [],
                        users: []
                    });
                }
            }
        } catch (error) {
            // Catch any unexpected errors
            streamDeck.logger.error('Unexpected error in onSendToPlugin:', {
                message: (error as Error).message,
                stack: (error as Error).stack
            });
        }
    }

    override async onWillAppear(ev: WillAppearEvent<TimerSettings>): Promise<void> {
        const settings = ev.payload.settings;
        
        streamDeck.logger.debug('Action appeared with settings:', settings);
        
        if (settings.isRunning && settings.startTime) {
            await this.updateTimerDisplay(ev);
            this.startUpdateInterval(ev);
        } else {
            await ev.action.setImage(this.getImagePath('default'));

            const title = settings.displayTitle ? settings.displayTitle : 'Start';
            await ev.action.setTitle(String(title));
        }
    }

    override async onWillDisappear(): Promise<void> {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
    }

    override async onKeyDown(ev: KeyDownEvent<TimerSettings>): Promise<void> {
        const settings = ev.payload.settings;
        streamDeck.logger.debug('Key pressed with settings:', settings);

        if (!settings.apiKey || !settings.administrationId || !settings.projectId || !settings.userId) {
            streamDeck.logger.debug('Missing required settings');
            await ev.action.setImage(this.getImagePath('default'));
            await ev.action.setTitle('Config needed');
            return;
        }

        const moneybirdService = new MoneybirdService(settings.apiKey, settings.administrationId);

        try {
            if (!settings.isRunning) {
                streamDeck.logger.debug('Starting timer');
                const timeEntry = await moneybirdService.startTimer(settings);

                settings.isRunning = true;
                settings.startTime = new Date().toISOString();
                settings.timeEntryId = timeEntry.id;
                
                await ev.action.setSettings(settings);
                await this.updateTimerDisplay(ev);
                this.startUpdateInterval(ev);
                
                streamDeck.logger.debug('Timer started successfully');
            } else {
                streamDeck.logger.debug('Stopping timer');

                if (!settings.timeEntryId) {
                    throw new Error('No time entry ID found');
                }

                await moneybirdService.stopTimer(settings.timeEntryId);
                streamDeck.logger.debug('Timer stopped successfully');

                settings.isRunning = false;
                settings.startTime = undefined;
                settings.timeEntryId = undefined;
                
                await ev.action.setSettings(settings);
                await ev.action.setImage(this.getImagePath('default'));
                
                const title = settings.displayTitle ? settings.displayTitle : 'Start';
                await ev.action.setTitle(String(title));
                
                if (this.updateInterval) {
                    clearInterval(this.updateInterval);
                }
            }
        } catch (error: any) {
            streamDeck.logger.error('Error managing timer:', error);
            
            await ev.action.setImage(this.getImagePath('error'));
            await ev.action.setTitle('Error');
            
            settings.isRunning = false;
            settings.startTime = undefined;
            settings.timeEntryId = undefined;
            await ev.action.setSettings(settings);
            
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
            }
        }
    }

    private startUpdateInterval(ev: WillAppearEvent<TimerSettings> | KeyDownEvent<TimerSettings>): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        this.updateInterval = setInterval(() => {
            this.updateTimerDisplay(ev).catch(error => 
                streamDeck.logger.error('Error updating display:', error)
            );
        }, 1000);
    }

    private async updateTimerDisplay(ev: WillAppearEvent<TimerSettings> | KeyDownEvent<TimerSettings>): Promise<void> {
        const settings = ev.payload.settings;
        if (settings.startTime) {
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

            await ev.action.setTitle(`⏱️ ${displayTime}`);
            await ev.action.setImage(imagePath);
        }
    }
}