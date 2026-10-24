import type { Request, RequestHandler } from 'express';
import { AppError } from '../http/errors.js';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  /** Bucket key, e.g. ip + email. */
  key: (req: Request) => string;
  message?: string;
  clock?: () => number;
}

export interface RateLimiter extends RequestHandler {
  /** Test helper: drop all buckets. */
  reset: () => void;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Beyond this, expired buckets are swept on the next request. */
const MAX_TRACKED_BUCKETS = 5_000;

/**
 * Fixed-window in-memory limiter.
 *
 * Suitable for the demo and for a single API instance. A multi-instance
 * deployment needs a shared store (Redis); that trade-off is documented in
 * THREATS.md rather than hidden behind a library that would silently be
 * per-process anyway.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const buckets = new Map<string, Bucket>();
  const clock = options.clock ?? (() => Date.now());

  const sweep = (now: number): void => {
    if (buckets.size <= MAX_TRACKED_BUCKETS) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  };

  const handler: RequestHandler = (req, res, next) => {
    const now = clock();
    sweep(now);

    const key = options.key(req);
    const existing = buckets.get(key);
    const bucket =
      existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + options.windowMs };

    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      next(
        new AppError({
          statusCode: 429,
          code: 'RATE_LIMITED',
          message: options.message ?? 'Too many requests. Try again later.',
          details: { retryAfterSeconds },
        }),
      );
      return;
    }

    next();
  };

  return Object.assign(handler, { reset: () => buckets.clear() });
}
