import assert from 'node:assert/strict';
import test from 'node:test';
import { throwMoneybirdApiError } from '../src/services/moneybird/error-handler.js';

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
