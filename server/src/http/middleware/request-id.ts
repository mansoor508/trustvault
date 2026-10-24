import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Accepts an inbound correlation id only when it is boring and safe:
 * 8-128 chars of [A-Za-z0-9._:-]. Anything else (log injection attempts,
 * very long values, newlines) is replaced with a fresh UUID.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function requestId(): RequestHandler {
  return (req, res, next) => {
    const inbound = req.get(REQUEST_ID_HEADER);
    const id = typeof inbound === 'string' && SAFE_REQUEST_ID.test(inbound) ? inbound : randomUUID();

    req.id = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  };
}
