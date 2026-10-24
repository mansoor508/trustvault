import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { normalizeEmail } from '../src/auth/auth-service.js';
import { parseCookieHeader, readCookie } from '../src/auth/cookies.js';
import {
  hashPassword,
  MAX_PASSWORD_BYTES,
  verifyAgainstDummyHash,
  verifyPassword,
} from '../src/auth/password.js';
import { createRateLimiter } from '../src/auth/rate-limit.js';
import {
  constantTimeEqual,
  generateCsrfToken,
  generateSessionToken,
  hashIpAddress,
  hashSessionToken,
} from '../src/auth/tokens.js';
import { AppError } from '../src/http/errors.js';

describe('cookie parsing', () => {
  it('reads a single cookie', () => {
    expect(readCookie('tv_session=abc123', 'tv_session')).toBe('abc123');
  });

  it('finds a cookie among others and tolerates whitespace', () => {
    expect(readCookie('theme=dark;  tv_session = abc123 ; other=1', 'tv_session')).toBe('abc123');
  });

  it('does not match a cookie whose name merely ends with the target', () => {
    expect(readCookie('not_tv_session=evil; tv_session=good', 'tv_session')).toBe('good');
  });

  it('strips surrounding quotes and decodes percent-encoding', () => {
    expect(readCookie('tv_session="a%20b"', 'tv_session')).toBe('a b');
  });

  it('falls back to the raw value when percent-encoding is malformed', () => {
    expect(readCookie('tv_session=100%', 'tv_session')).toBe('100%');
  });

  it('returns null for missing, empty or malformed headers', () => {
    expect(readCookie(undefined, 'tv_session')).toBeNull();
    expect(readCookie('', 'tv_session')).toBeNull();
    expect(readCookie('other=1', 'tv_session')).toBeNull();
    expect(readCookie('tv_session=', 'tv_session')).toBeNull();
    expect(readCookie('tv_session', 'tv_session')).toBeNull();
  });

  it('parses the whole header into an object with first-value wins', () => {
    expect(parseCookieHeader('a=1; b=2; a=3')).toEqual({ a: '1', b: '2' });
    expect(parseCookieHeader(undefined)).toEqual({});
  });
});

describe('tokens', () => {
  it('generates unique, URL-safe session tokens', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateSessionToken()));

    expect(tokens.size).toBe(20);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('hashes session tokens to 64 hex characters without keeping the input', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashSessionToken(token)).toBe(hash);
  });

  it('generates 256-bit CSRF tokens', () => {
    expect(generateCsrfToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('compares tokens without leaking length mismatches', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});

describe('ip hashing', () => {
  const secret = 'test-session-secret-value-0123456789abcdef';

  it('is deterministic per secret and never stores the raw address', () => {
    const hash = hashIpAddress('203.0.113.9', secret);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashIpAddress('203.0.113.9', secret));
    expect(hash).not.toContain('203.0.113.9');
  });

  it('differs with a different secret', () => {
    expect(hashIpAddress('203.0.113.9', secret)).not.toBe(
      hashIpAddress('203.0.113.9', `${secret}-other`),
    );
  });

  it('returns null for missing addresses', () => {
    expect(hashIpAddress(undefined, secret)).toBeNull();
    expect(hashIpAddress(null, secret)).toBeNull();
    expect(hashIpAddress('   ', secret)).toBeNull();
  });
});

describe('passwords', () => {
  const password = 'Correct-Horse-Battery-9';

  it('hashes and verifies a password', async () => {
    const hash = await hashPassword(password, 4);

    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    expect(hash).not.toContain(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword(`${password}x`, hash)).resolves.toBe(false);
  });

  it('rejects short or over-long passwords when hashing', async () => {
    await expect(hashPassword('short', 4)).rejects.toThrow(/at least/);
    await expect(hashPassword('a'.repeat(MAX_PASSWORD_BYTES + 1), 4)).rejects.toThrow(
      /at most 72 bytes/,
    );
  });

  it('treats a malformed stored hash as a failed login instead of throwing', async () => {
    await expect(verifyPassword(password, 'not-a-bcrypt-hash')).resolves.toBe(false);
    await expect(verifyPassword('', '')).resolves.toBe(false);
  });

  it('burns time for unknown accounts without throwing', async () => {
    await expect(verifyAgainstDummyHash(password)).resolves.toBeUndefined();
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Admin@TrustVault.Local ')).toBe('admin@trustvault.local');
  });
});

describe('rate limiter', () => {
  function makeRequest(): Request {
    return {} as Request;
  }

  function makeResponse(): Response {
    return { setHeader: vi.fn() } as unknown as Response;
  }

  it('allows requests up to the limit and rejects the next one with Retry-After', () => {
    let now = 1_000;
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, key: () => 'bucket', clock: () => now });
    const res = makeResponse();
    const next = vi.fn();

    limiter(makeRequest(), res, next);
    limiter(makeRequest(), res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();

    now += 1_000;
    limiter(makeRequest(), res, next);

    const error = next.mock.calls[2]?.[0] as unknown;
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(429);
    expect((error as AppError).code).toBe('RATE_LIMITED');
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '59');
  });

  it('resets the bucket after the window elapses', () => {
    let now = 0;
    const limiter = createRateLimiter({ windowMs: 1_000, max: 1, key: () => 'bucket', clock: () => now });
    const next = vi.fn();

    limiter(makeRequest(), makeResponse(), next);
    limiter(makeRequest(), makeResponse(), next);
    expect(next.mock.calls[1]?.[0]).toBeInstanceOf(AppError);

    now = 1_001;
    limiter(makeRequest(), makeResponse(), next);
    expect(next.mock.calls[2]?.[0]).toBeUndefined();
  });

  it('keeps separate buckets per key', () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 1,
      key: (req) => (req as unknown as { key: string }).key,
      clock: () => 0,
    });
    const next = vi.fn();

    limiter({ key: 'a' } as unknown as Request, makeResponse(), next);
    limiter({ key: 'b' } as unknown as Request, makeResponse(), next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(next.mock.calls[0]?.[0]).toBeUndefined();
    expect(next.mock.calls[1]?.[0]).toBeUndefined();
  });
});
