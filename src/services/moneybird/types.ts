export type MoneybirdLogger = {
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

export type MoneybirdHttpClient = {
  get<T>(url: string, config?: unknown): Promise<{ data: T }>;
  post<T>(url: string, data?: unknown, config?: unknown): Promise<{ data: T }>;
  patch<T>(url: string, data?: unknown, config?: unknown): Promise<{ data: T }>;
};

export type MoneybirdServiceDependencies = {
  httpClient?: MoneybirdHttpClient;
  logger?: MoneybirdLogger;
};
