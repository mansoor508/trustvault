import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Env } from '../../config/env.js';
import type { Logger } from '../../config/logger.js';
import { isAppError } from '../errors.js';

export interface NormalizedError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  expose: boolean;
}

const GENERIC_500_MESSAGE = 'An unexpected error occurred. The request has been logged.';

/**
 * Database failures map to stable HTTP semantics without echoing SQL.
 * Keep this list narrow: anything unknown becomes a generic 500.
 */
const ERROR_CODE_MAP: Record<string, { statusCode: number; code: string; message: string }> = {
  ER_DUP_ENTRY: { statusCode: 409, code: 'CONFLICT', message: 'That value is already in use.' },
  ER_ROW_IS_REFERENCED_2: {
    statusCode: 409,
    code: 'CONFLICT',
    message: 'This record is still referenced by other data.',
  },
  ER_NO_REFERENCED_ROW_2: {
    statusCode: 409,
    code: 'CONFLICT',
    message: 'A referenced record does not exist.',
  },
  ECONNREFUSED: {
    statusCode: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'A required service is unavailable. Try again shortly.',
  },
  ETIMEDOUT: {
    statusCode: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'A required service is unavailable. Try again shortly.',
  },
  ENOTFOUND: {
    statusCode: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'A required service is unavailable. Try again shortly.',
  },
  PROTOCOL_CONNECTION_LOST: {
    statusCode: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'A required service is unavailable. Try again shortly.',
  },
  ER_ACCESS_DENIED_ERROR: {
    statusCode: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'The service is temporarily unavailable.',
  },
  ER_NO_SUCH_TABLE: {
    statusCode: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: 'The service is temporarily unavailable.',
  },
};

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'Unknown error';
}

/**
 * Turns anything thrown anywhere in the stack into a safe, typed response.
 * Pure function: no logging, no side effects.
 */
export function normalizeError(error: unknown, env: Env): NormalizedError {
  if (isAppError(error)) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.expose ? error.message : GENERIC_500_MESSAGE,
      details: error.expose ? error.details : undefined,
      expose: error.expose,
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      details: error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join('.') || '(root)',
        message: issue.message,
      })),
      expose: true,
    };
  }

  if (error !== null && typeof error === 'object') {
    const { type, code } = error as { type?: unknown; code?: unknown };

    switch (type) {
      case 'entity.too.large':
        return {
          statusCode: 413,
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body is too large.',
          expose: true,
        };
      case 'entity.parse.failed':
        return {
          statusCode: 400,
          code: 'INVALID_JSON',
          message: 'Request body is not valid JSON.',
          expose: true,
        };
      case 'encoding.unsupported':
      case 'charset.unsupported':
        return {
          statusCode: 415,
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Unsupported request encoding.',
          expose: true,
        };
      case 'request.aborted':
        return {
          statusCode: 400,
          code: 'REQUEST_ABORTED',
          message: 'The request was aborted before it completed.',
          expose: true,
        };
      default:
        break;
    }

    if (typeof code === 'string') {
      const mapped = ERROR_CODE_MAP[code];
      if (mapped) return { ...mapped, expose: true };
    }
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    // Local development gets the real message; production never does.
    message: env.isProduction ? GENERIC_500_MESSAGE : describeError(error),
    expose: !env.isProduction,
  };
}

/** Reads a bounded Retry-After hint out of a structured error's details. */
function retryAfterSecondsFrom(details: unknown): number | null {
  if (details === null || typeof details !== 'object') return null;
  const value = (details as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.ceil(value);
}

/**
 * Final error middleware. Must be registered last and keep all four arguments
 * so Express recognises it as an error handler.
 */
export function createErrorHandler(options: { env: Env; logger: Logger }): ErrorRequestHandler {
  const { env, logger } = options;

  return (error, req, res, next) => {
    if (res.headersSent) {
      // The response already started; let Express destroy the socket.
      next(error);
      return;
    }

    const requestId = req.id ?? 'unknown';
    const normalized = normalizeError(error, env);

    if (normalized.statusCode >= 500) {
      logger.error(
        {
          requestId,
          method: req.method,
          path: req.originalUrl,
          statusCode: normalized.statusCode,
          errorCode: normalized.code,
          err: error,
        },
        'request failed',
      );
    } else {
      logger.warn(
        {
          requestId,
          method: req.method,
          path: req.originalUrl,
          statusCode: normalized.statusCode,
          errorCode: normalized.code,
        },
        'request rejected',
      );
    }

    const details =
      normalized.expose && normalized.details !== undefined ? { details: normalized.details } : {};

    // 429 responses advertise how long to wait, for both clients and proxies.
    if (normalized.statusCode === 429) {
      const retryAfterSeconds = retryAfterSecondsFrom(normalized.details);
      if (retryAfterSeconds !== null && !res.hasHeader('Retry-After')) {
        res.setHeader('Retry-After', String(retryAfterSeconds));
      }
    }

    res.status(normalized.statusCode).json({
      error: {
        code: normalized.code,
        message: normalized.message,
        requestId,
        ...details,
      },
    });
  };
}
