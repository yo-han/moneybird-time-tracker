import assert from 'node:assert/strict';
import test from 'node:test';
import { MoneybirdService } from '../src/services/moneybird.js';
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
    get?: unknown;
    post?: unknown;
    patch?: unknown;
  } = {};
  const failures: {
    get?: unknown;
    post?: unknown;
    patch?: unknown;
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
        if (failures.patch) {
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
  assert.equal(
    http.calls[0]?.url,
    'https://moneybird.com/api/v2/administrations.json'
  );
  assert.deepEqual(http.calls[0]?.config, {
    headers: {
      Authorization: 'Bearer secret-key',
      'Content-Type': 'application/json',
    },
  });
});

test('startTimer defaults billable to true and posts payload', async () => {
  const http = createHttpClient();
  http.responses.post = { id: 'time-entry-1', time_entry: { started_at: 'ignored' } };

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
  assert.equal(
    http.calls[0]?.url,
    'https://moneybird.com/api/v2/admin-1/time_entries.json'
  );
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
      contact_id: 'contact-1',
      billable: true,
      ended_at: '2026-02-09T10:00:00.000Z',
    },
    {
      id: '2',
      contact_id: 'contact-2',
      billable: true,
      ended_at: '2026-02-09T10:00:00.000Z',
    },
    {
      id: '3',
      contact_id: 'contact-1',
      billable: false,
      ended_at: '2026-02-09T10:00:00.000Z',
    },
    {
      id: '4',
      contact_id: 'contact-1',
      billable: true,
      ended_at: null,
    },
  ] as MoneybirdTimeEntry[];

  const service = new MoneybirdService('secret-key', 'admin-1', {
    httpClient: http.client,
    logger: createLogger(),
  });

  const result = await service.getTimeEntriesForContact(
    'contact-1',
    new Date('2026-02-01T00:00:00.000Z'),
    new Date('2026-02-09T00:00:00.000Z')
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, '1');
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
