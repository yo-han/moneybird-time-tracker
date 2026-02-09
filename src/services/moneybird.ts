import axios, { AxiosError } from 'axios';
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
import { formatMoneybirdDate, groupTimeEntriesByDescription } from '../utils/moneybird-utils.js';
import { getErrorDetails } from '../utils/error-logging.js';

type MoneybirdLogger = {
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

type MoneybirdHttpClient = {
  get<T>(url: string, config?: unknown): Promise<{ data: T }>;
  post<T>(url: string, data?: unknown, config?: unknown): Promise<{ data: T }>;
  patch<T>(url: string, data?: unknown, config?: unknown): Promise<{ data: T }>;
};

type MoneybirdServiceDependencies = {
  httpClient?: MoneybirdHttpClient;
  logger?: MoneybirdLogger;
};

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

  private handleAxiosError(error: unknown): never {
    const axiosError = error as AxiosError;
    let errorMessage = 'Unknown error';

    if (axiosError.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      if (axiosError.response.status === 401) {
        errorMessage = 'Authentication failed. Please check your API key.';
      } else if (axiosError.response.status === 403) {
        errorMessage = 'Access forbidden. Check your permissions.';
      } else {
        errorMessage = `Server error: ${axiosError.response.status}`;
      }

      this.logger.error('Moneybird API Error Response:', {
        status: axiosError.response.status,
      });
    } else if (axiosError.request) {
      errorMessage = 'No response received from Moneybird API. Check your internet connection.';
      this.logger.error('No response from Moneybird API');
    } else {
      const errorDetails = getErrorDetails(error);
      errorMessage = `Request setup error: ${errorDetails.message}`;
      this.logger.error('Moneybird API Request Error', errorDetails);
    }

    throw new Error(errorMessage);
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

      return response.data.map(admin => ({
        id: admin.id,
        name: admin.name,
      }));
    } catch (error) {
      return this.handleAxiosError(error as AxiosError);
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

      return response.data.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email || 'No email',
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

      this.logger.debug(`Fetching projects for administration ${this.administrationId}`);
      const response = await this.httpClient.get<Array<{ id: string; name: string }>>(
        `${this.baseUrl}/${this.administrationId}/projects.json`,
        {
          headers: this.getHeaders(),
        }
      );

      return response.data.map(project => ({
        id: project.id,
        name: project.name,
      }));
    } catch (error) {
      return this.handleAxiosError(error as AxiosError);
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

      return response.data.map(contact => ({
        id: contact.id,
        company_name: contact.company_name || '',
        firstname: contact.firstname || '',
        lastname: contact.lastname || '',
      }));
    } catch (error) {
      return this.handleAxiosError(error as AxiosError);
    }
  }

  async startTimer(settings: TimerSettings): Promise<TimeEntry> {
    try {
      let billable = settings.billable;
      if (settings.billable === undefined) {
        billable = true;
      } else if (typeof settings.billable == 'string') {
        billable = settings.billable == 'true';
      }

      const timeEntry = {
        time_entry: {
          started_at: formatMoneybirdDate(new Date()),
          user_id: settings.userId,
          project_id: settings.projectId,
          contact_id: settings.contactId || null,
          description: settings.description || 'Time registration',
          billable,
        },
      };

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
      return this.handleAxiosError(error);
    }
  }

  async stopTimer(timeEntryId: string): Promise<TimeEntry> {
    try {
      const timeEntry = {
        time_entry: {
          ended_at: formatMoneybirdDate(new Date()),
        },
      };

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
      return this.handleAxiosError(error);
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
      const timeEntries = response.data.filter(
        (entry: MoneybirdTimeEntry) =>
          entry.contact_id === contactId && entry.billable === true && entry.ended_at !== null
      );

      this.logger.debug(
        `Found ${timeEntries.length} billable time entries for contact ${contactId}`
      );

      return timeEntries;
    } catch (error) {
      return this.handleAxiosError(error as AxiosError);
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

      // Group time entries by project and description
      const groupedEntries = groupTimeEntriesByDescription(timeEntries);

      // Create invoice details from grouped entries
      const details_attributes = groupedEntries.map((group, index) => ({
        description: group.description,
        price: hourlyRate.toFixed(2),
        amount: `${group.totalHours.toFixed(2)} uur`,
        row_order: index,
      }));

      const invoiceData = {
        sales_invoice: {
          contact_id: contactId,
          reference: description,
          details_attributes: details_attributes,
          workflow_id: workflowId,
          prices_are_incl_tax: false,
        },
      };

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
      return this.handleAxiosError(error as AxiosError);
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
          {
            time_entry: {
              sales_invoice_id: invoiceId,
            },
          },
          {
            headers: this.getHeaders(),
          }
        )
      );

      await Promise.all(updatePromises);
      this.logger.debug(`Linked ${timeEntries.length} time entries to invoice ${invoiceId}`);
    } catch (error) {
      this.logger.error('Error linking time entries to invoice', getErrorDetails(error));
      // Don't throw here, the invoice is already created
    }
  }
}
