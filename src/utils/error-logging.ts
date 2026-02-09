type ErrorLogger = {
  error: (...args: unknown[]) => void;
};

type ErrorContext = Record<string, unknown>;

export function getErrorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === 'string') {
    return {
      message: error,
    };
  }

  return {
    message: 'Unknown error',
  };
}

export function logError(
  logger: ErrorLogger,
  message: string,
  error: unknown,
  context?: ErrorContext
): void {
  const details = getErrorDetails(error);
  if (context) {
    logger.error(message, {
      ...context,
      ...details,
    });
    return;
  }

  logger.error(message, details);
}
