import type { RequestHandler } from 'express';
import { AppError } from '../errors.js';

/** Keeps a hostile, very long URL from bloating the log line and response. */
const MAX_PATH_LENGTH = 200;

export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => {
    const target = req.originalUrl.slice(0, MAX_PATH_LENGTH);
    next(
      new AppError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: `No route matches ${req.method} ${target}`,
      }),
    );
  };
}
