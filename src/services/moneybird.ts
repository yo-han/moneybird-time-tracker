import axios from 'axios';
import streamDeck from '@elgato/streamdeck';
import {
  TimerSettings,
  MoneybirdProject,
  MoneybirdAdministration,
  MoneybirdUser,
  MoneybirdContact,
  MoneybirdTimeEntry,
  MoneybirdSalesInvoice,
} from '../types/moneybird.js';
import { MoneybirdApiError, throwMoneybirdApiError } from './moneybird/error-handler.js';
import {
  buildInvoicePayload,
  buildStartTimerPayload,
  buildStopTimerPayload,
  buildTimeEntriesFilter,
  buildTimeEntryInvoiceLinkPayload,
  filterBillableContactEntries,
  type BillableEntryFilterOptions,
} from './moneybird/payloads.js';
import {
  mapAdministrations,
  mapContacts,
  mapProjects,
  mapUsers,
} from './moneybird/response-mappers.js';
import { getErrorDetails } from '../utils/error-logging.js';
import type {
  MoneybirdHttpClient,
  MoneybirdLogger,
  MoneybirdServiceDependencies,
} from './moneybird/types.js';

/** Largest page Moneybird serves on its index endpoints. */
export const MONEYBIRD_PAGE_SIZE = 100;
/** Upper bound on pages per listing, so a misbehaving endpoint cannot loop forever. */
export const MONEYBIRD_MAX_PAGES = 50;
export const MONEYBIRD_REQUEST_TIMEOUT_MS = 15_000;

type QueryParams = Record<string, string | number>;

type PaginationLimit = 'throw' | 'truncate';

export type CreatedInvoice = {
  invoice: MoneybirdSalesInvoice;
  /** Entries that could not be linked to the invoice and would be billed again next time. */
  unlinkedEntryIds: string[];
};

export class MoneybirdService {
  private readonly baseUrl = 'https://moneybird.com/api/v2';
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

  private requestConfig(params?: QueryParams) {
    return {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: MONEYBIRD_REQUEST_TIMEOUT_MS,
      ...(params ? { params } : {}),
    };
  }

  private requireAdministrationId(): string {
    if (!this.administrationId) {
      throw new Error('No administration ID provided');
    }
    return this.administrationId;
  }

  private administrationUrl(path: string): string {
    return `${this.baseUrl}/${this.requireAdministrationId()}/${path}`;
  }

  /**
   * Walks an index endpoint page by page. Stops at the first short page, or at a page that
   * adds no new ids (an endpoint that ignores `page` would otherwise repeat forever).
   * `onLimit` decides what happens when there are more than MONEYBIRD_MAX_PAGES pages:
   * listings that drive billing must throw instead of silently using a partial list.
   */
  private async getAllPages<T extends { id: string }>(
    url: string,
    params: QueryParams,
    onLimit: PaginationLimit
  ): Promise<T[]> {
    const itemsById = new Map<string, T>();

    for (let page = 1; page <= MONEYBIRD_MAX_PAGES; page++) {
      const response = await this.httpClient.get<T[]>(
        url,
        this.requestConfig({ ...params, page, per_page: MONEYBIRD_PAGE_SIZE })
      );

      if (!Array.isArray(response.data)) {
        throw new MoneybirdApiError(`Unexpected response from ${url}: expected a list`);
      }

      const knownCount = itemsById.size;
      for (const item of response.data) {
        itemsById.set(item.id, item);
      }

      const isLastPage = response.data.length < MONEYBIRD_PAGE_SIZE;
      const addedNothing = itemsById.size === knownCount;
      if (isLastPage || addedNothing) {
        return Array.from(itemsById.values());
      }
    }

    const limitMessage = `More than ${MONEYBIRD_MAX_PAGES} pages at ${url}`;
    if (onLimit === 'throw') {
      throw new MoneybirdApiError(`${limitMessage}; refusing to continue with a partial list`);
    }

    this.logger.warn(`${limitMessage}; using the first ${itemsById.size} records`);
    return Array.from(itemsById.values());
  }

  async getAdministrations(): Promise<MoneybirdAdministration[]> {
    try {
      this.logger.debug('Fetching administrations from Moneybird');
      const response = await this.httpClient.get<Array<{ id: string; name: string }>>(
        `${this.baseUrl}/administrations.json`,
        this.requestConfig()
      );

      return mapAdministrations(response.data);
    } catch (error) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  async getUsers(): Promise<MoneybirdUser[]> {
    try {
      this.logger.debug(`Fetching users for administration ${this.administrationId}`);
      const response = await this.httpClient.get<
        Array<{ id: string; name: string; email?: string }>
      >(this.administrationUrl('users.json'), this.requestConfig());

      return mapUsers(response.data);
    } catch (error) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  async getProjects(): Promise<MoneybirdProject[]> {
    try {
      this.logger.debug(`Fetching projects for administration ${this.administrationId}`);
      const projects = await this.getAllPages<{ id: string; name: string }>(
        this.administrationUrl('projects.json'),
        {},
        'truncate'
      );

      return mapProjects(projects);
    } catch (error) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  async getContacts(): Promise<MoneybirdContact[]> {
    try {
      this.logger.debug(`Fetching contacts for administration ${this.administrationId}`);
      const contacts = await this.getAllPages<{
        id: string;
        company_name?: string;
        firstname?: string;
        lastname?: string;
      }>(this.administrationUrl('contacts.json'), {}, 'truncate');

      return mapContacts(contacts);
    } catch (error) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  async startTimer(settings: TimerSettings, now: Date = new Date()): Promise<MoneybirdTimeEntry> {
    try {
      const url = this.administrationUrl('time_entries.json');
      const payload = buildStartTimerPayload(settings, now);

      this.logger.debug('Starting timer', { url, data: payload });

      const response = await this.httpClient.post<MoneybirdTimeEntry>(
        url,
        payload,
        this.requestConfig()
      );

      if (!response.data?.id) {
        throw new MoneybirdApiError('Moneybird did not return an id for the new time entry');
      }

      return response.data;
    } catch (error: unknown) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  /**
   * Ends a running time entry. `endedAt` defaults to now; auto-stop passes the configured
   * limit so a timer that fires late (sleep, restart) never records more than the limit.
   */
  async stopTimer(timeEntryId: string, endedAt: Date = new Date()): Promise<MoneybirdTimeEntry> {
    try {
      const url = this.administrationUrl(`time_entries/${timeEntryId}.json`);
      const payload = buildStopTimerPayload(endedAt);

      this.logger.debug('Stopping timer', { url, data: payload });

      const response = await this.httpClient.patch<MoneybirdTimeEntry>(
        url,
        payload,
        this.requestConfig()
      );

      return response.data;
    } catch (error: unknown) {
      return throwMoneybirdApiError(this.logger, error);
    }
  }

  /** All billable, finished entries of a contact within the period, across every page. */
  async getTimeEntriesForContact(
    contactId: string,
    startDate: Date,
    endDate: Date,
    options: BillableEntryFilterOptions = {}
  ): Promise<MoneybirdTimeEntry[]> {
    try {
      const filter = buildTimeEntriesFilter(contactId, startDate, endDate);
      this.logger.debug(`Fetching time entries with filter: ${filter}`);

      const entries = await this.getAllPages<MoneybirdTimeEntry>(
        this.administrationUrl('time_entries.json'),
        { filter },
        'throw'
      );

      const timeEntries = filterBillableContactEntries(entries, contactId, options);
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
    workflowId: string | undefined,
    hourlyRate: number
  ): Promise<CreatedInvoice> {
    let invoice: MoneybirdSalesInvoice;

    try {
      const invoiceData = buildInvoicePayload(
        contactId,
        timeEntries,
        description,
        workflowId,
        hourlyRate
      );

      this.logger.debug('Creating invoice in Moneybird');

      const response = await this.httpClient.post<MoneybirdSalesInvoice>(
        this.administrationUrl('sales_invoices.json'),
        invoiceData,
        this.requestConfig()
      );
      invoice = response.data;
    } catch (error) {
      return throwMoneybirdApiError(this.logger, error);
    }

    // The invoice exists from here on, so a linking failure must not be reported as a
    // failed invoice: the caller gets the ids that are still unlinked instead.
    const unlinkedEntryIds = await this.linkTimeEntriesToInvoice(timeEntries, invoice.id);
    return { invoice, unlinkedEntryIds };
  }

  private async linkTimeEntriesToInvoice(
    timeEntries: MoneybirdTimeEntry[],
    invoiceId: string
  ): Promise<string[]> {
    const results = await Promise.allSettled(
      timeEntries.map(entry =>
        this.httpClient.patch(
          this.administrationUrl(`time_entries/${entry.id}.json`),
          buildTimeEntryInvoiceLinkPayload(invoiceId),
          this.requestConfig()
        )
      )
    );

    const unlinkedEntryIds = timeEntries
      .filter((_entry, index) => results[index]?.status === 'rejected')
      .map(entry => entry.id);

    if (unlinkedEntryIds.length > 0) {
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      this.logger.error('Error linking time entries to invoice', {
        invoiceId,
        unlinkedEntryIds,
        entryCount: timeEntries.length,
        ...getErrorDetails(firstFailure?.reason),
      });
    } else {
      this.logger.debug(`Linked ${timeEntries.length} time entries to invoice ${invoiceId}`);
    }

    return unlinkedEntryIds;
  }
}
