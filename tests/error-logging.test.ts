import assert from 'node:assert/strict';
import test from 'node:test';
import { getErrorDetails, logError } from '../src/utils/error-logging.js';

test('getErrorDetails extracts message and stack from Error', () => {
  const error = new Error('boom');
  const details = getErrorDetails(error);

  assert.equal(details.message, 'boom');
  assert.equal(typeof details.stack, 'string');
});

test('getErrorDetails handles string and unknown values', () => {
  assert.deepEqual(getErrorDetails('bad'), { message: 'bad' });
  assert.deepEqual(getErrorDetails({ foo: 'bar' }), { message: 'Unknown error' });
});

test('logError logs details with optional context', () => {
  const calls: Array<{ message: unknown; details: unknown }> = [];
  const logger = {
    error(...args: unknown[]) {
      const [message, details] = args;
      calls.push({ message, details });
    },
  };

  logError(logger, 'operation failed', new Error('broken'), { instanceId: 'x1' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.message, 'operation failed');
  const details = calls[0]?.details as { instanceId?: string; message?: string; stack?: string };
  assert.equal(details.instanceId, 'x1');
  assert.equal(details.message, 'broken');
  assert.equal(typeof details.stack, 'string');
});
