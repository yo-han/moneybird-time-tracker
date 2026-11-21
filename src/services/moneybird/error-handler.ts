import type { AxiosError } from 'axios';
import { getErrorDetails } from '../../utils/error-logging.js';
import type { MoneybirdLogger } from './types.js';

/**
 * Error thrown for every failed Moneybird request. `status` is the HTTP status code, or
 * `undefined` when no response was received or the request could not be set up.
 */
export class MoneybirdApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'MoneybirdApiError';
  }
}

export function isMoneybirdNotFound(error: unknown): boolean {
  return error instanceof MoneybirdApiError && error.status === 404;
}

function extractMoneybirdErrorText(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }

  const { error } = data as { error?: unknown };
  return typeof error === 'string' && error.trim() !== '' ? error.trim() : undefined;
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

export function throwMoneybirdApiError(logger: MoneybirdLogger, error: unknown): never {
  if (error instanceof MoneybirdApiError) {
    throw error;
  }

  const axiosError = error as AxiosError;

  if (axiosError.response) {
    const { status } = axiosError.response;
    const detail = extractMoneybirdErrorText(axiosError.response.data);

    logger.error('Moneybird API Error Response', { status, detail });
    throw new MoneybirdApiError(describeResponseStatus(status, detail), status);
  }

  if (axiosError.request) {
    logger.error('No response from Moneybird API');
    throw new MoneybirdApiError(
      'No response received from Moneybird API. Check your internet connection.'
    );
  }

  const errorDetails = getErrorDetails(error);
  logger.error('Moneybird API Request Error', errorDetails);
  throw new MoneybirdApiError(`Request setup error: ${errorDetails.message}`);
}
