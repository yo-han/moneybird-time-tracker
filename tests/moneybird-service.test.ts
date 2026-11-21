import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MONEYBIRD_MAX_PAGES,
  MONEYBIRD_PAGE_SIZE,
  MONEYBIRD_REQUEST_TIMEOUT_MS,
  MoneybirdService,
} from '../src/services/moneybird.js';
import { MoneybirdApiError } from '../src/services/moneybird/error-handler.js';
import type { MoneybirdTimeEntry } from '../src/types/moneybird.js';

type CallRecord = {
  method: 'get' | 'post' | 'patch';
  url: string;
  data?: unknown;
  config?: unknown;
};

function createHttpClient() {
  const calls: CallRecord[] = [];
  const responses: {
    get?: unknown | ((url: string, config?: unknown) => unknown);
    post?: unknown;
    patch?: unknown;
  } = {};
  const failures: {
    get?: unknown;
    post?: unknown;
    patch?: unknown | ((url: string) => unknown);
  } = {};

  return {
    calls,
    responses,
    failures,
    client: {
      async get<T>(url: string, config?: unknown): Promise<{ data: T }> {
        calls.push({ method: 'get', url, config });
        if (failures.get) {
          throw failures.get;
        }
        if (typeof responses.get === 'function') {
          return { data: responses.get(url, config) as T };
        }
        return { data: responses.get as T };
      },
      async post<T>(url: string, data?: unknown, config?: unknown): Promise<{ data: T }> {
        calls.push({ method: 'post', url, data, config });
        if (failures.post) {
          throw failures.post;
        }
        return { data: responses.post as T };
      },
      async patch<T>(url: string, data?: unknown, config?: unknown): Promise<{ data: T }> {
        calls.push({ method: 'patch', url, data, config });
        if (typeof failures.patch === 'function') {
          const failure = failures.patch(url);
          if (failure) {
            throw failure;
          }
        } else if (failures.patch) {
          throw failures.patch;
        }
        return { data: responses.patch as T };
      },
    },
  };
}

function createLogger() {
  return {
    debug: (..._args: unknown[]) => {},
    error: (..._args: unknown[]) => {},
    info: (..._args: unknown[]) => {},
    warn: (..._args: unknown[]) => {},
  };
}

test('constructor rejects empty API key', () => {
  assert.throws(() => new MoneybirdService(''), /Invalid API key/);
  assert.throws(() => new MoneybirdService('   '), /Invalid API key/);
});

test('getAdministrations sends authenticated request and maps response', async () => {
  const http = createHttpClient();
  http.responses.get = [{ id: '1', name: 'Main Admin' }];

  const service = new MoneybirdService('secret-key', undefined, {
    httpClient: http.client,
    logger: createLogger(),
  });

  const administrations = await service.getAdministrations();

  assert.deepEqual(administrations, [{ id: '1', name: 'Main Admin' }]);
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0]?.method, 'get');
  assert.equal(http.calls[0]?.url, 'https://moneybird.com/api/v2/administrations.json');
  assert.deepEqual(http.calls[0]?.config, {
    headers: {
      Authorization: 'Bearer secret-key',
      'Content-Type': 'application/json',
    },
    timeout: MONEYBIRD_REQUEST_TIMEOUT_MS,
  });
});

test('startTimer defaults billable to true and posts payload', async () => {
  const http = createHttpClient();
  http.responses.post = { id: 'time-entry-1' };

  const service = new MoneybirdService('secret-key', 'admin-1', {
    httpClient: http.client,
    logger: createLogger(),
  });

  await service.startTimer({
    apiKey: 'secret-key',
    administrationId: 'admin-1',
    projectId: 'project-1',
    userId: 'user-1',
    description: 'Consultancy',
  });

  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0]?.method, 'post');
  assert.equal(http.calls[0]?.url, 'https://moneybird.com/api/v2/admin-1/time_entries.json');
  const postData = http.calls[0]?.data as {
    time_entry: {
      billable: boolean;
      user_id: string;
      project_id: string;
    };
  };
  assert.equal(postData.time_entry.billable, true);
  assert.equal(postData.time_entry.user_id, 'user-1');
  assert.equal(postData.time_entry.project_id, 'project-1');
});

test('getTimeEntriesForContact filters contact, billable and ended entries', async () => {
  const http = createHttpClient();
  http.responses.get = [
    {
      id: '1',
      contact_id: '111',
      billable: true,
      ended_at: '2026-02-09T10:00:00.000Z',
    },
    {
      id: '2',
      contact_id: '222',
      billable: true,
      ended_at: '2026-02-09T10:00:00.000Z',
    },
    {
      id: '3',
      contact_id: '111',
      billable: false,
      ended_at: '2026-02-09T10:00:00.000Z',
    },
    {
      id: '4',
      contact_id: '111',
      billable: true,
      ended_at: null,
    },
  ] as MoneybirdTimeEntry[];

  const service = new MoneybirdService('secret-key', 'admin-1', {
    httpClient: http.client,
    logger: createLogger(),
  });

  const result = await service.getTimeEntriesForContact(
    '111',
    new Date('2026-02-01T00:00:00.000Z'),
    new Date('2026-02-09T00:00:00.000Z')
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, '1');
  assert.deepEqual((http.calls[0]?.config as { params: unknown }).params, {
    filter: 'period:20260201..20260209,contact_id:111,state:all',
    page: 1,
    per_page: MONEYBIRD_PAGE_SIZE,
  });
});

test('returns user-friendly authentication error for 401 responses', async () => {
  const http = createHttpClient();
  http.failures.get = { response: { status: 401 } };

  const service = new MoneybirdService('secret-key', undefined, {
    httpClient: http.client,
    logger: createLogger(),
  });

  await assert.rejects(
    service.getAdministrations(),
    /Authentication failed\. Please check your API key\./
  );
});

test('returns user-friendly network error when no response is received', async () => {
  const http = createHttpClient();
  http.failures.get = { request: {} };

  const service = new MoneybirdService('secret-key', undefined, {
    httpClient: http.client,
    logger: createLogger(),
  });

  await assert.rejects(
    service.getAdministrations(),
    /No response received from Moneybird API\. Check your internet connection\./
  );
});

function billableEntry(
  id: string,
  overrides: Partial<MoneybirdTimeEntry> = {}
): MoneybirdTimeEntry {
  return {
    id,
    contact_id: '111',
    billable: true,
    started_at: '2026-02-09T09:00:00.000Z',
    ended_at: '2026-02-09T10:00:00.000Z',
    description: 'Work',
    user_id: 'u',
    project_id: 'p',
    paused_duration: 0,
    created_at: 'x',
    updated_at: 'x',
    sales_invoice_id: null,
    ...overrides,
  };
}

function pageOf(config: unknown): number {
  return (config as { params: { page: number } }).params.page;
}

function createService(http: ReturnType<typeof createHttpClient>, logger = createLogger()) {
  return new MoneybirdService('secret-key', 'admin-1', { httpClient: http.client, logger });
}

const FEB_START = new Date('2026-02-01T00:00:00.000Z');
const FEB_END = new Date('2026-02-09T00:00:00.000Z');

test('getTimeEntriesForContact walks every page until a short page', async () => {
  const http = createHttpClient();
  const firstPage = Array.from({ length: MONEYBIRD_PAGE_SIZE }, (_, i) => billableEntry(`a${i}`));
  http.responses.get = (_url: string, config?: unknown) =>
    pageOf(config) === 1 ? firstPage : [billableEntry('last')];

  const result = await createService(http).getTimeEntriesForContact('111', FEB_START, FEB_END);

  assert.equal(result.length, MONEYBIRD_PAGE_SIZE + 1);
  assert.deepEqual(
    http.calls.map(call => pageOf(call.config)),
    [1, 2]
  );
});

test('pagination stops when an endpoint ignores the page parameter', async () => {
  const http = createHttpClient();
  const samePage = Array.from({ length: MONEYBIRD_PAGE_SIZE }, (_, i) => billableEntry(`a${i}`));
  http.responses.get = samePage;

  const result = await createService(http).getTimeEntriesForContact('111', FEB_START, FEB_END);

  assert.equal(result.length, MONEYBIRD_PAGE_SIZE);
  assert.equal(http.calls.length, 2);
});

test('getTimeEntriesForContact refuses a partial list beyond the page limit', async () => {
  const http = createHttpClient();
  http.responses.get = (_url: string, config?: unknown) =>
    Array.from({ length: MONEYBIRD_PAGE_SIZE }, (_, i) => billableEntry(`p${pageOf(config)}-${i}`));

  await assert.rejects(
    createService(http).getTimeEntriesForContact('111', FEB_START, FEB_END),
    (error: unknown) =>
      error instanceof MoneybirdApiError &&
      /refusing to continue with a partial list/.test(error.message)
  );
  assert.equal(http.calls.length, MONEYBIRD_MAX_PAGES);
});

test('getContacts truncates beyond the page limit and warns', async () => {
  const http = createHttpClient();
  http.responses.get = (_url: string, config?: unknown) =>
    Array.from({ length: MONEYBIRD_PAGE_SIZE }, (_, i) => ({
      id: `${pageOf(config)}-${i}`,
      company_name: 'Acme',
    }));
  const warnings: unknown[] = [];
  const logger = { ...createLogger(), warn: (...args: unknown[]) => warnings.push(args[0]) };

  const contacts = await createService(http, logger).getContacts();

  assert.equal(contacts.length, MONEYBIRD_MAX_PAGES * MONEYBIRD_PAGE_SIZE);
  assert.equal(warnings.length, 1);
});

test('getTimeEntriesForContact can exclude entries that are already invoiced', async () => {
  const http = createHttpClient();
  http.responses.get = [
    billableEntry('open'),
    billableEntry('invoiced', { sales_invoice_id: '999' }),
  ];
  const service = createService(http);

  const all = await service.getTimeEntriesForContact('111', FEB_START, FEB_END);
  const uninvoiced = await service.getTimeEntriesForContact('111', FEB_START, FEB_END, {
    excludeInvoiced: true,
  });

  assert.deepEqual(
    all.map(entry => entry.id),
    ['open', 'invoiced']
  );
  assert.deepEqual(
    uninvoiced.map(entry => entry.id),
    ['open']
  );
});

test('getTimeEntriesForContact rejects a non-numeric contact id before any request', async () => {
  const http = createHttpClient();

  await assert.rejects(
    createService(http).getTimeEntriesForContact('1,state:open', FEB_START, FEB_END),
    /Invalid Moneybird contact id/
  );
  assert.equal(http.calls.length, 0);
});

test('startTimer fails fast when Moneybird returns no time entry id', async () => {
  const http = createHttpClient();
  http.responses.post = {};

  await assert.rejects(
    createService(http).startTimer({
      apiKey: 'secret-key',
      administrationId: 'admin-1',
      projectId: 'project-1',
      userId: 'user-1',
    }),
    /did not return an id/
  );
});

test('stopTimer ends the entry at the given time', async () => {
  const http = createHttpClient();
  http.responses.patch = billableEntry('42');
  const endedAt = new Date(2026, 1, 9, 13, 30);

  await createService(http).stopTimer('42', endedAt);

  assert.equal(http.calls[0]?.url, 'https://moneybird.com/api/v2/admin-1/time_entries/42.json');
  const payload = http.calls[0]?.data as { time_entry: { ended_at: string } };
  assert.match(payload.time_entry.ended_at, /^2026-02-09 13:30:00 /);
});

test('createInvoiceFromTimeEntries reports entries it could not link', async () => {
  const http = createHttpClient();
  http.responses.post = { id: 'invoice-1' };
  http.failures.patch = (url: string) =>
    url.endsWith('/time_entries/2.json') ? { response: { status: 422 } } : undefined;

  const result = await createService(http).createInvoiceFromTimeEntries(
    '111',
    [billableEntry('1'), billableEntry('2'), billableEntry('3')],
    'February',
    undefined,
    90
  );

  assert.equal(result.invoice.id, 'invoice-1');
  assert.deepEqual(result.unlinkedEntryIds, ['2']);
  assert.equal(http.calls.filter(call => call.method === 'patch').length, 3);
});

test('createInvoiceFromTimeEntries returns no unlinked ids when every link succeeds', async () => {
  const http = createHttpClient();
  http.responses.post = { id: 'invoice-1' };

  const result = await createService(http).createInvoiceFromTimeEntries(
    '111',
    [billableEntry('1')],
    'February',
    undefined,
    90
  );

  assert.deepEqual(result.unlinkedEntryIds, []);
});
