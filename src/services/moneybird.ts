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
} from '../types/moneybird';
import { format } from 'date-fns';

export class MoneybirdService {
  private baseUrl = 'https://moneybird.com/api/v2';

  constructor(
    private readonly apiKey: string,
    private readonly administrationId?: string
  ) {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Invalid API key');
    }
  }

  private getHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
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
      });
    } else if (error.request) {
      errorMessage = 'No response received from Moneybird API. Check your internet connection.';
      streamDeck.logger.error('No response from Moneybird API:', error.request);
    } else {
      errorMessage = `Request setup error: ${error.message}`;
      streamDeck.logger.error('Moneybird API Request Error:', error.message);
    }

    throw new Error(errorMessage);
  }

  async getAdministrations(): Promise<MoneybirdAdministration[]> {
    try {
      streamDeck.logger.debug('Fetching administrations from Moneybird');
      const response = await axios.get<Array<{ id: string; name: string }>>(
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
      streamDeck.logger.debug(`Fetching users for administration ${administrationId}`);
      const response = await axios.get<Array<{ id: string; name: string; email?: string }>>(
        `${this.baseUrl}/${administrationId}/users.json`,
        {
          headers: this.getHeaders(),
        }
      );

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

      streamDeck.logger.debug(`Fetching projects for administration ${this.administrationId}`);
      const response = await axios.get<Array<{ id: string; name: string }>>(
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

      streamDeck.logger.debug(`Fetching contacts for administration ${this.administrationId}`);
      const response = await axios.get<
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
      let billable = settings.billable;
      if (settings.billable === undefined) {
        billable = true;
      } else if (typeof settings.billable == 'string') {
        billable = settings.billable == 'true';
      }

      const timeEntry = {
        time_entry: {
          started_at: this.formatDate(new Date()),
          user_id: settings.userId,
          project_id: settings.projectId,
          contact_id: settings.contactId || null,
          description: settings.description || 'Time registration',
          billable,
        },
      };

      streamDeck.logger.debug('Starting timer:', {
        url: `${this.baseUrl}/${this.administrationId}/time_entries`,
        data: timeEntry,
      });

      const response = await axios.post(
        `${this.baseUrl}/${this.administrationId}/time_entries.json`,
        timeEntry,
        {
          headers: this.getHeaders(),
        }
      );

      return response.data;
    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      streamDeck.logger.error('Moneybird API error:', {
        message: axiosError.message,
        status: axiosError.response?.status,
      });
      throw error;
    }
  }

  async stopTimer(timeEntryId: string): Promise<TimeEntry> {
    try {
      const timeEntry = {
        time_entry: {
          ended_at: this.formatDate(new Date()),
        },
      };

      streamDeck.logger.debug('Stopping timer:', {
        url: `${this.baseUrl}/${this.administrationId}/time_entries/${timeEntryId}`,
        data: timeEntry,
      });

      const response = await axios.patch(
        `${this.baseUrl}/${this.administrationId}/time_entries/${timeEntryId}.json`,
        timeEntry,
        {
          headers: this.getHeaders(),
        }
      );

      return response.data;
    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      streamDeck.logger.error('Moneybird API error in stopTimer:', {
        message: axiosError.message,
        status: axiosError.response?.status,
      });
      throw error;
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

      streamDeck.logger.debug(`Fetching time entries with filter: ${filter}`);

      const response = await axios.get(
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

      streamDeck.logger.debug(
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
      const groupedEntries = this.groupTimeEntries(timeEntries);

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

      streamDeck.logger.debug('Creating invoice in Moneybird');

      const response = await axios.post(
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

  private groupTimeEntries(timeEntries: MoneybirdTimeEntry[]): Array<{
    description: string;
    totalHours: number;
    entries: MoneybirdTimeEntry[];
  }> {
    const groups: Record<
      string,
      {
        description: string;
        totalHours: number;
        entries: MoneybirdTimeEntry[];
      }
    > = {};

    timeEntries.forEach(entry => {
      const key = entry.description || 'Werkzaamheden';

      if (!groups[key]) {
        groups[key] = {
          description: key,
          totalHours: 0,
          entries: [],
        };
      }

      const startTime = new Date(entry.started_at);
      const endTime = new Date(entry.ended_at);
      const durationMs = endTime.getTime() - startTime.getTime() - entry.paused_duration * 1000;
      const hours = durationMs / (1000 * 60 * 60);

      groups[key].totalHours += hours;
      groups[key].entries.push(entry);
    });

    return Object.values(groups);
  }

  private async linkTimeEntriesToInvoice(
    timeEntries: MoneybirdTimeEntry[],
    invoiceId: string
  ): Promise<void> {
    try {
      // Update each time entry with the invoice ID
      const updatePromises = timeEntries.map(entry =>
        axios.patch(
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
      streamDeck.logger.debug(`Linked ${timeEntries.length} time entries to invoice ${invoiceId}`);
    } catch (error) {
      streamDeck.logger.error('Error linking time entries to invoice:', error);
      // Don't throw here, the invoice is already created
    }
  }
}
