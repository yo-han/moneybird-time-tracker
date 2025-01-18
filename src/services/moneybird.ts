import axios, { AxiosError } from 'axios';
import streamDeck from '@elgato/streamdeck';
import { TimeEntry, TimerSettings, MoneybirdProject, MoneybirdAdministration, MoneybirdUser } from '../types/moneybird';

export class MoneybirdService {
    private baseUrl = 'https://moneybird.com/api/v2';
    
    constructor(
        private readonly apiKey: string,
        private readonly administrationId?: string
    ) {
        // Validate API key
        if (!apiKey || apiKey.trim() === '') {
            throw new Error('Invalid API key');
        }
    }

    private getHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    private handleAxiosError(error: AxiosError): never {
        let errorMessage = 'Unknown error';
        
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            if (error.response.status === 401) {
                errorMessage = 'Authentication failed. Please check your API key.';
            } else if (error.response.status === 403) {
                errorMessage = 'Access forbidden. Check your permissions.';
            } else {
                errorMessage = `Server error: ${error.response.status}`;
            }
            
            streamDeck.logger.error('Moneybird API Error Response:', {
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            });
        } else if (error.request) {
            // The request was made but no response was received
            errorMessage = 'No response received from Moneybird API. Check your internet connection.';
            streamDeck.logger.error('No response from Moneybird API:', error.request);
        } else {
            // Something happened in setting up the request that triggered an Error
            errorMessage = `Request setup error: ${error.message}`;
            streamDeck.logger.error('Moneybird API Request Error:', error.message);
        }

        throw new Error(errorMessage);
    }

    async getAdministrations(): Promise<MoneybirdAdministration[]> {
        try {
            streamDeck.logger.debug('Fetching administrations from Moneybird');
            const response = await axios.get(
                `${this.baseUrl}/administrations.json`,
                {
                    headers: this.getHeaders()
                }
            );

            // Map the response to our MoneybirdAdministration interface
            return response.data.map((admin: any) => ({
                id: admin.id,
                name: admin.name
            }));
        } catch (error) {
            return this.handleAxiosError(error as AxiosError);
        }
    }

    async getUsers(administrationId: string): Promise<MoneybirdUser[]> {
        try {
            streamDeck.logger.debug(`Fetching users for administration ${administrationId}`);
            const response = await axios.get(
                `${this.baseUrl}/${administrationId}/users.json`,
                {
                    headers: this.getHeaders()
                }
            );

            // Map the response to our MoneybirdUser interface
            return response.data.map((user: any) => ({
                id: user.id,
                name: user.name,
                email: user.email || 'No email'
            }));
        } catch (error) {
            return this.handleAxiosError(error as AxiosError);
        }
    }

    async getProjects(): Promise<MoneybirdProject[]> {
        try {
            if (!this.administrationId) {
                throw new Error('No administration ID provided');
            }

            streamDeck.logger.debug(`Fetching projects for administration ${this.administrationId}`);
            const response = await axios.get(
                `${this.baseUrl}/${this.administrationId}/projects.json`,
                {
                    headers: this.getHeaders()
                }
            );

            // Map the response to our MoneybirdProject interface
            return response.data.map((project: any) => ({
                id: project.id,
                name: project.name
            }));
        } catch (error) {
            return this.handleAxiosError(error as AxiosError);
        }
    }

    private formatDate(date: Date): string {
        const pad = (num: number) => num.toString().padStart(2, '0');
        
        const year = date.getFullYear();
        const month = pad(date.getMonth() + 1);
        const day = pad(date.getDate());
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const offset = -date.getTimezoneOffset();
        const offsetHours = Math.floor(Math.abs(offset) / 60);
        const offsetMinutes = Math.abs(offset) % 60;
        const offsetSign = offset >= 0 ? '+' : '-';
        
        return `${year}-${month}-${day} ${hours}:${minutes}:00 ${offsetSign}${pad(offsetHours)}:${pad(offsetMinutes)}`;
    }

    async startTimer(settings: TimerSettings): Promise<TimeEntry> {
        try {
            const timeEntry = {
                time_entry: {
                    started_at: this.formatDate(new Date()),
                    user_id: settings.userId,
                    project_id: settings.projectId,
                    description: settings.description || 'Time registration',
                    billable: settings.billable !== undefined ? settings.billable : true
                }
            };

            streamDeck.logger.debug('Starting timer:', {
                url: `${this.baseUrl}/${this.administrationId}/time_entries`,
                data: timeEntry
            });

            const response = await axios.post(
                `${this.baseUrl}/${this.administrationId}/time_entries.json`,
                timeEntry,
                {
                    headers: this.getHeaders()
                }
            );

            return response.data;
        } catch (error: any) {
            streamDeck.logger.error('Moneybird API error:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }

    async stopTimer(timeEntryId: string): Promise<TimeEntry> {
        try {
            const timeEntry = {
                time_entry: {
                    ended_at: this.formatDate(new Date())
                }
            };

            streamDeck.logger.debug('Stopping timer:', {
                url: `${this.baseUrl}/${this.administrationId}/time_entries/${timeEntryId}`,
                data: timeEntry
            });

            const response = await axios.patch(
                `${this.baseUrl}/${this.administrationId}/time_entries/${timeEntryId}.json`,
                timeEntry,
                {
                    headers: this.getHeaders()
                }
            );

            return response.data;
        } catch (error: any) {
            streamDeck.logger.error('Moneybird API error in stopTimer:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        }
    }
}