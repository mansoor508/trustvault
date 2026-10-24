/**
 * Application error type.
 *
 * Only `AppError` instances with `expose: true` have their message returned to
 * clients. Everything else is reported as a generic 500 so internals (SQL,
 * stack traces, file paths) never leak.
 */
export interface AppErrorOptions {
  statusCode: number;
  /** Stable, machine-readable code for clients, e.g. ORIGIN_NOT_ALLOWED. */
  code: string;
  message: string;
  /** Extra, client-safe context (never secrets or stack traces). */
  details?: unknown;
  /** Defaults to true for 4xx and false for 5xx. */
  expose?: boolean;
  cause?: unknown;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;
  readonly expose: boolean;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.details = options.details;
    this.expose = options.expose ?? options.statusCode < 500;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super({ statusCode: 404, code: 'NOT_FOUND', message });
    this.name = 'NotFoundError';
  }
}
