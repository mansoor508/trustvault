import type { RequestHandler } from 'express';
import type { Logger } from '../../config/logger.js';

/** Health polling is expected to be quiet; log it at debug instead of info. */
const QUIET_PATHS = ['/api/health'];

function isQuiet(path: string): boolean {
  return QUIET_PATHS.some((quiet) => path === quiet || path.startsWith(`${quiet}/`));
}

export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    let settled = false;

    const finish = (aborted: boolean): void => {
      if (settled) return;
      settled = true;

      const durationMs = Math.round((Number(process.hrtime.bigint() - startedAt) / 1e6) * 100) / 100;
      const payload = {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
      };

      if (aborted) {
        logger.warn(payload, 'request aborted by client');
      } else if (isQuiet(req.path)) {
        logger.debug(payload, 'request completed');
      } else {
        logger.info(payload, 'request completed');
      }
    };

    res.on('finish', () => finish(false));
    res.on('close', () => {
      if (!res.writableEnded) finish(true);
    });

    next();
  };
}
