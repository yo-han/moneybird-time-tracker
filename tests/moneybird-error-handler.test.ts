import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MoneybirdApiError,
  isMoneybirdNotFound,
  isPermanentRequestError,
  throwMoneybirdApiError,
} from '../src/services/moneybird/error-handler.js';

function createLogger() {
  const calls: Array<{ message: unknown; details?: unknown }> = [];
  return {
    logger: {
      debug: (..._args: unknown[]) => {},
      info: (..._args: unknown[]) => {},
      warn: (..._args: unknown[]) => {},
      error(message: unknown, details?: unknown) {
        calls.push({ message, details });
      },
    },
    calls,
  };
}

test('throws authentication message for 401 response', () => {
  const { logger } = createLogger();
  assert.throws(
    () => throwMoneybirdApiError(logger, { response: { status: 401 } }),
    /Authentication failed\. Please check your API key\./
  );
});

test('throws forbidden message for 403 response', () => {
  const { logger } = createLogger();
  assert.throws(
    () => throwMoneybirdApiError(logger, { response: { status: 403 } }),
    /Access forbidden\. Check your permissions\./
  );
});

test('throws server status message for other response errors', () => {
  const { logger } = createLogger();
  assert.throws(
    () => throwMoneybirdApiError(logger, { response: { status: 500 } }),
    /Server error: 500/
  );
});

test('throws connectivity message when request exists without response', () => {
  const { logger } = createLogger();
  assert.throws(
    () => throwMoneybirdApiError(logger, { request: {} }),
    /No response received from Moneybird API\. Check your internet connection\./
  );
});

test('logs request setup details for non-axios errors', () => {
  const { logger, calls } = createLogger();

  assert.throws(() => throwMoneybirdApiError(logger, new Error('setup failed')), /setup failed/);
  assert.equal(calls.length > 0, true);
  assert.equal(calls[calls.length - 1]?.message, 'Moneybird API Request Error');
});

test('throws a typed MoneybirdApiError carrying the status', () => {
  const { logger } = createLogger();
  assert.throws(
    () => throwMoneybirdApiError(logger, { response: { status: 404 } }),
    (error: unknown) =>
      error instanceof MoneybirdApiError &&
      error.status === 404 &&
      isMoneybirdNotFound(error) &&
      /Resource not found/.test(error.message)
  );
});

test('includes the Moneybird error text for rejected requests', () => {
  const { logger } = createLogger();
  assert.throws(
    () =>
      throwMoneybirdApiError(logger, {
        response: { status: 422, data: { error: 'Time entry is already invoiced' } },
      }),
    /Request rejected by Moneybird \(422\): Time entry is already invoiced/
  );
});

test('explains rate limiting', () => {
  const { logger } = createLogger();
  assert.throws(() => throwMoneybirdApiError(logger, { response: { status: 429 } }), /rate limit/);
});

test('rethrows an existing MoneybirdApiError unchanged', () => {
  const { logger, calls } = createLogger();
  const original = new MoneybirdApiError('original', 500);
  assert.throws(
    () => throwMoneybirdApiError(logger, original),
    (error: unknown) => error === original
  );
  assert.equal(calls.length, 0);
});

test('isMoneybirdNotFound is false for other errors', () => {
  assert.equal(isMoneybirdNotFound(new MoneybirdApiError('x', 500)), false);
  assert.equal(isMoneybirdNotFound(new Error('x')), false);
});

test('reads the first message of a validation error object', () => {
  const { logger } = createLogger();
  assert.throws(
    () =>
      throwMoneybirdApiError(logger, {
        response: { status: 422, data: { error: { contact_id: ['is required'] } } },
      }),
    /Request rejected by Moneybird \(422\): contact_id is required/
  );
});

test('isPermanentRequestError separates rejected requests from retryable failures', () => {
  const cases: Array<[number | undefined, boolean]> = [
    [400, true],
    [404, true],
    [422, true],
    [401, false],
    [403, false],
    [408, false],
    [429, false],
    [500, false],
    [503, false],
    [undefined, false],
  ];

  for (const [status, permanent] of cases) {
    assert.equal(
      isPermanentRequestError(new MoneybirdApiError('x', status)),
      permanent,
      `status ${status}`
    );
  }
  assert.equal(isPermanentRequestError(new Error('x')), false);
});
