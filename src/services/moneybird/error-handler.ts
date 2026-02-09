import type { AxiosError } from 'axios';
import { getErrorDetails } from '../../utils/error-logging.js';
import type { MoneybirdLogger } from './types.js';

export function throwMoneybirdApiError(logger: MoneybirdLogger, error: unknown): never {
  const axiosError = error as AxiosError;
  let errorMessage = 'Unknown error';

  if (axiosError.response) {
    if (axiosError.response.status === 401) {
      errorMessage = 'Authentication failed. Please check your API key.';
    } else if (axiosError.response.status === 403) {
      errorMessage = 'Access forbidden. Check your permissions.';
    } else {
      errorMessage = `Server error: ${axiosError.response.status}`;
    }

    logger.error('Moneybird API Error Response', {
      status: axiosError.response.status,
    });
  } else if (axiosError.request) {
    errorMessage = 'No response received from Moneybird API. Check your internet connection.';
    logger.error('No response from Moneybird API');
  } else {
    const errorDetails = getErrorDetails(error);
    errorMessage = `Request setup error: ${errorDetails.message}`;
    logger.error('Moneybird API Request Error', errorDetails);
  }

  throw new Error(errorMessage);
}
