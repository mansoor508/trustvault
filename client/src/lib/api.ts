/**
 * Typed API client for the TrustVault backend.
 *
 * Design notes:
 * - `credentials: 'include'` is set from day one: sessions will be HttpOnly
 *   cookies, so every call must be allowed to send them. The server answers
 *   with an explicit CORS allow-list (never `*`) and `credentials: true`.
 * - Requests are time-boxed so a hung backend cannot leave the UI spinning.
 * - The `X-Request-Id` response header is surfaced so a user can quote it in a
 *   bug report and an operator can find the matching log line.
 */

import { notifyUnauthorized } from './session-events';

export const DEFAULT_API_BASE_URL = 'http://localhost:4000';
export const API_PREFIX = '/api';

const DEFAULT_TIMEOUT_MS = 8_000;

export interface ApiHealth {
  status: 'ok';
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  requestId: string;
}

export interface DatabaseHealth {
  status: 'ok' | 'error';
  check: 'database';
  database: {
    status: 'up' | 'down';
    latencyMs: number;
    code?: string;
  };
  timestamp: string;
  requestId: string;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
  requestId: string | null;
}

export class ApiError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly requestId: string | null;

  constructor(
    message: string,
    options: { status?: number; code?: string; requestId?: string | null; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId ?? null;
  }
}

/** Trims trailing slashes and falls back to the local API when unset. */
export function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  const base = trimmed === '' ? DEFAULT_API_BASE_URL : trimmed;
  return base.replace(/\/+$/, '');
}

/** Joins a base URL and an absolute path without doubling slashes. */
export function buildUrl(baseUrl: string, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${normalizeBaseUrl(baseUrl)}${suffix}`;
}

export const apiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);

function toApiError(error: unknown, url: string, timeoutMs: number): ApiError {
  if (error instanceof ApiError) return error;

  if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
    return new ApiError(`The API did not answer within ${timeoutMs / 1000}s (${url}).`, { cause: error });
  }

  return new ApiError(`Could not reach the API at ${url}. Is the backend running?`, { cause: error });
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ApiResult<T>> {
  const url = buildUrl(apiBaseUrl, path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  try {
    const response = await fetch(url, {
      credentials: 'include',
      ...init,
      headers,
      signal: controller.signal,
    });

    const requestId = response.headers.get('x-request-id');

    // A 401 on an authenticated endpoint means the server-side session is gone
    // (expired, revoked or idle). Tell the app shell so it can return to the
    // login screen with an explanation. /auth/login and /auth/me are excluded:
    // a 401 there is a normal "not signed in" answer.
    if (
      response.status === 401 &&
      !path.startsWith(`${API_PREFIX}/auth/login`) &&
      !path.startsWith(`${API_PREFIX}/auth/me`)
    ) {
      notifyUnauthorized();
    }

    // 204 (logout, future deletes) has no body by design: `null` is a valid payload.
    if (response.status === 204) {
      return { ok: response.ok, status: 204, data: null as T, requestId };
    }

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (data === null) {
      throw new ApiError('The API returned a response that was not JSON.', {
        status: response.status,
        requestId,
      });
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data as T,
      requestId,
    };
  } catch (error) {
    throw toApiError(error, url, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

export function fetchApiHealth(): Promise<ApiResult<ApiHealth>> {
  return request<ApiHealth>(`${API_PREFIX}/health`);
}

/**
 * Readiness probe. A 503 with `database.status === 'down'` is a *valid* answer,
 * so this resolves with `ok: false` instead of throwing.
 */
export function fetchDatabaseHealth(): Promise<ApiResult<DatabaseHealth>> {
  return request<DatabaseHealth>(`${API_PREFIX}/health/database`);
}
