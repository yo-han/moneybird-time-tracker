import type { AxiosError } from 'axios';
import { getErrorDetails } from '../../utils/error-logging.js';
import type { MoneybirdLogger } from './types.js';

/**
 * Error thrown for every failed Moneybird request. `status` is the HTTP status code, or
 * `undefined` when no response was received or the request could not be set up.
 */
export class MoneybirdApiError extends Error {
  /**
   * @param noResponse true when the request went out but no answer came back (a timeout or
   *   a dropped connection): Moneybird may or may not have handled it.
   */
  constructor(
    message: string,
    readonly status?: number,
    readonly noResponse: boolean = false
  ) {
    super(message);
    this.name = 'MoneybirdApiError';
  }
}

export function isMoneybirdNotFound(error: unknown): boolean {
  return error instanceof MoneybirdApiError && error.status === 404;
}

/** The request went out but no answer came back, so its outcome is unknown. */
export function isNoResponseError(error: unknown): boolean {
  return error instanceof MoneybirdApiError && error.noResponse;
}

export function isMoneybirdRateLimited(error: unknown): boolean {
  return error instanceof MoneybirdApiError && error.status === 429;
}

/** Statuses in the 4xx range that can succeed when the same request is sent again. */
const RETRYABLE_CLIENT_STATUSES = new Set([401, 403, 408, 429]);

/**
 * True when Moneybird rejected the request itself (404, 422, ...), so sending it again
 * cannot succeed. Network errors, auth problems, rate limits and 5xx are not permanent.
 */
export function isPermanentRequestError(error: unknown): boolean {
  if (!(error instanceof MoneybirdApiError) || error.status === undefined) {
    return false;
  }
  return error.status >= 400 && error.status < 500 && !RETRYABLE_CLIENT_STATUSES.has(error.status);
}

/**
 * Moneybird sends `error` either as a string or, for validation failures, as an object
 * of field -> messages. Returns the first readable message, e.g. "contact_id is required".
 */
function extractMoneybirdErrorText(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }

  const { error } = data as { error?: unknown };
  if (typeof error === 'string') {
    return error.trim() || undefined;
  }

  if (typeof error === 'object' && error !== null) {
    for (const [field, messages] of Object.entries(error)) {
      const first = Array.isArray(messages) ? messages[0] : messages;
      if (typeof first === 'string' && first.trim() !== '') {
        return `${field} ${first.trim()}`;
      }
    }
  }

  return undefined;
}

function describeResponseStatus(status: number, detail: string | undefined): string {
  if (status === 401) {
    return 'Authentication failed. Please check your API key.';
  }
  if (status === 403) {
    return 'Access forbidden. Check your permissions.';
  }
  if (status === 404) {
    return 'Resource not found in Moneybird.';
  }
  if (status === 429) {
    return 'Moneybird rate limit reached. Try again in a few minutes.';
  }
  if (status >= 400 && status < 500) {
    return detail
      ? `Request rejected by Moneybird (${status}): ${detail}`
      : `Request rejected by Moneybird (${status})`;
  }
  return `Server error: ${status}`;
}

/** Maps any request failure to a MoneybirdApiError and logs it (without secrets). */
export function toMoneybirdApiError(logger: MoneybirdLogger, error: unknown): MoneybirdApiError {
  if (error instanceof MoneybirdApiError) {
    return error;
  }

  const axiosError = error as AxiosError;

  if (axiosError.response) {
    const { status } = axiosError.response;
    const detail = extractMoneybirdErrorText(axiosError.response.data);

    logger.error('Moneybird API Error Response', { status, detail });
    return new MoneybirdApiError(describeResponseStatus(status, detail), status);
  }

  if (axiosError.request) {
    logger.error('No response from Moneybird API');
    return new MoneybirdApiError(
      'No response received from Moneybird API. Check your internet connection.',
      undefined,
      true
    );
  }

  const errorDetails = getErrorDetails(error);
  logger.error('Moneybird API Request Error', errorDetails);
  return new MoneybirdApiError(`Request setup error: ${errorDetails.message}`);
}

export function throwMoneybirdApiError(logger: MoneybirdLogger, error: unknown): never {
  throw toMoneybirdApiError(logger, error);
}
