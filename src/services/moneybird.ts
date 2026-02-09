import axios from 'axios';
import streamDeck from '@elgato/streamdeck';
import {
  TimeEntry,
  TimerSettings,
  MoneybirdProject,
  MoneybirdAdministration,
  MoneybirdUser,
  MoneybirdContact,
  MoneybirdTimeEntry,
  MoneybirdSalesInvoice,
} from '../types/moneybird.js';
import { format } from 'date-fns';
import { throwMoneybirdApiError } from './moneybird/error-handler.js';
import {
  buildInvoicePayload,
  buildStartTimerPayload,
  buildStopTimerPayload,
  buildTimeEntryInvoiceLinkPayload,
  filterBillableContactEntries,
} from './moneybird/payloads.js';
import {
  mapAdministrations,
  mapContacts,
  mapProjects,
  mapUsers,
} from './moneybird/response-mappers.js';
import type {
  MoneybirdHttpClient,
  MoneybirdLogger,
  MoneybirdServiceDependencies,
} from './moneybird/types.js';

export class MoneybirdService {
  private baseUrl = 'https://moneybird.com/api/v2';
  private readonly httpClient: MoneybirdHttpClient;
  private readonly logger: MoneybirdLogger;

  constructor(
    private readonly apiKey: string,
    private readonly administrationId?: string,
    dependencies: MoneybirdServiceDependencies = {}
  ) {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Invalid API key');
    }

    this.httpClient = dependencies.httpClient ?? axios;
    this.logger = dependencies.logger ?? streamDeck.logger;
  }

  private getHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async getAdministrations(): Promise<MoneybirdAdministration[]> {
    try {
      this.logger.debug('Fetching administrations from Moneybird');
      const response = await this.httpClient.get<Array<{ id: string; name: string }>>(
        `${this.baseUrl}/administrations.json`,
        {
          headers: this.getHeaders(),
        }
      );

      return mapAdministrations(response.data);
    } catch (error) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  async getUsers(administrationId: string): Promise<MoneybirdUser[]> {
    try {
      this.logger.debug(`Fetching users for administration ${administrationId}`);
      const response = await this.httpClient.get<
        Array<{ id: string; name: string; email?: string }>
      >(`${this.baseUrl}/${administrationId}/users.json`, {
        headers: this.getHeaders(),
      });

      return mapUsers(response.data);
    } catch (error) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  async getProjects(): Promise<MoneybirdProject[]> {
    try {
      if (!this.administrationId) {
        throw new Error('No administration ID provided');
      }

      this.logger.debug(`Fetching projects for administration ${this.administrationId}`);
      const response = await this.httpClient.get<Array<{ id: string; name: string }>>(
        `${this.baseUrl}/${this.administrationId}/projects.json`,
        {
          headers: this.getHeaders(),
        }
      );

      return mapProjects(response.data);
    } catch (error) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  async getContacts(): Promise<MoneybirdContact[]> {
    try {
      if (!this.administrationId) {
        throw new Error('No administration ID provided');
      }

      this.logger.debug(`Fetching contacts for administration ${this.administrationId}`);
      const response = await this.httpClient.get<
        Array<{
          id: string;
          company_name?: string;
          firstname?: string;
          lastname?: string;
        }>
      >(`${this.baseUrl}/${this.administrationId}/contacts.json`, {
        headers: this.getHeaders(),
      });

      return mapContacts(response.data);
    } catch (error) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  async startTimer(settings: TimerSettings): Promise<TimeEntry> {
    try {
      const timeEntry = buildStartTimerPayload(settings, new Date());

      this.logger.debug('Starting timer:', {
        url: `${this.baseUrl}/${this.administrationId}/time_entries`,
        data: timeEntry,
      });

      const response = await this.httpClient.post<TimeEntry>(
        `${this.baseUrl}/${this.administrationId}/time_entries.json`,
        timeEntry,
        {
          headers: this.getHeaders(),
        }
      );

      return response.data;
    } catch (error: unknown) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  async stopTimer(timeEntryId: string): Promise<TimeEntry> {
    try {
      const timeEntry = buildStopTimerPayload(new Date());

      this.logger.debug('Stopping timer:', {
        url: `${this.baseUrl}/${this.administrationId}/time_entries/${timeEntryId}`,
        data: timeEntry,
      });

      const response = await this.httpClient.patch<TimeEntry>(
        `${this.baseUrl}/${this.administrationId}/time_entries/${timeEntryId}.json`,
        timeEntry,
        {
          headers: this.getHeaders(),
        }
      );

      return response.data;
    } catch (error: unknown) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  async getTimeEntriesForContact(
    contactId: string,
    startDate: Date,
    endDate: Date
  ): Promise<MoneybirdTimeEntry[]> {
    try {
      if (!this.administrationId) {
        throw new Error('No administration ID provided');
      }

      const filter = `period:${format(startDate, 'yyyyMMdd')}..${format(endDate, 'yyyyMMdd')}`;

      this.logger.debug(`Fetching time entries with filter: ${filter}`);

      const response = await this.httpClient.get<MoneybirdTimeEntry[]>(
        `${this.baseUrl}/${this.administrationId}/time_entries.json`,
        {
          headers: this.getHeaders(),
          params: {
            filter: filter,
            per_page: 100,
          },
        }
      );

      // Filter for the specific contact and billable entries
      const timeEntries = filterBillableContactEntries(response.data, contactId);

      this.logger.debug(
        `Found ${timeEntries.length} billable time entries for contact ${contactId}`
      );

      return timeEntries;
    } catch (error) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  async createInvoiceFromTimeEntries(
    contactId: string,
    timeEntries: MoneybirdTimeEntry[],
    description: string,
    workflowId?: string,
    hourlyRate: number = 75
  ): Promise<MoneybirdSalesInvoice> {
    try {
      if (!this.administrationId) {
        throw new Error('No administration ID provided');
      }

      const invoiceData = buildInvoicePayload(
        contactId,
        timeEntries,
        description,
        workflowId,
        hourlyRate
      );

      this.logger.debug('Creating invoice in Moneybird');

      const response = await this.httpClient.post<MoneybirdSalesInvoice>(
        `${this.baseUrl}/${this.administrationId}/sales_invoices.json`,
        invoiceData,
        {
          headers: this.getHeaders(),
        }
      );

      // Link time entries to the invoice
      const invoiceId = response.data.id;
      await this.linkTimeEntriesToInvoice(timeEntries, invoiceId);

      return response.data;
    } catch (error) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  private async linkTimeEntriesToInvoice(
    timeEntries: MoneybirdTimeEntry[],
    invoiceId: string
  ): Promise<void> {
    try {
      // Update each time entry with the invoice ID
      const updatePromises = timeEntries.map(entry =>
        this.httpClient.patch(
          `${this.baseUrl}/${this.administrationId}/time_entries/${entry.id}.json`,
          buildTimeEntryInvoiceLinkPayload(invoiceId),
          {
            headers: this.getHeaders(),
          }
        )
      );

      await Promise.all(updatePromises);
      this.logger.debug(`Linked ${timeEntries.length} time entries to invoice ${invoiceId}`);
    } catch (error) {
      this.logger.error('Error linking time entries to invoice', error);
      // Don't throw here, the invoice is already created
    }
  }
}
