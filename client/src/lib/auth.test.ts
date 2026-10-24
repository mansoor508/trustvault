import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractErrorMessage, fetchAuditLogs, fetchMe, login, logout } from './auth';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-test-1', ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extractErrorMessage', () => {
  it('reads the safe message from an error envelope', () => {
    expect(extractErrorMessage({ error: { message: 'Email or password is incorrect.' } })).toBe(
      'Email or password is incorrect.',
    );
  });

  it('returns null for anything else', () => {
    expect(extractErrorMessage(null)).toBeNull();
    expect(extractErrorMessage('nope')).toBeNull();
    expect(extractErrorMessage({ error: {} })).toBeNull();
    expect(extractErrorMessage({ user: {} })).toBeNull();
  });
});

describe('auth requests', () => {
  it('posts credentials as JSON with cookies enabled', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        user: { id: 'u1', email: 'a@b.co', displayName: null, role: 'viewer', isActive: true },
        session: { csrfToken: 'c'.repeat(64), createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-01T12:00:00Z' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await login('a@b.co', 'secret-password');

    expect(result.ok).toBe(true);
    expect(result.requestId).toBe('req-test-1');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.co', password: 'secret-password' }));
  });

  it('sends the CSRF token on logout and accepts an empty 204 response', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 204, headers: { 'X-Request-Id': 'req-logout' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await logout('c'.repeat(64));

    expect(result.ok).toBe(true);
    expect(result.status).toBe(204);
    expect(result.data).toBeNull();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('c'.repeat(64));
  });

  it('surfaces a 401 body instead of throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'NOT_AUTHENTICATED', message: 'Sign in to continue.' } }, 401),
      ),
    );

    const result = await fetchMe();

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(extractErrorMessage(result.data)).toBe('Sign in to continue.');
  });

  it('requests audit logs with pagination parameters', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ entries: [], pagination: { limit: 15, offset: 0, total: 0 } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAuditLogs(15, 0);

    expect(result.ok).toBe(true);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('/api/admin/audit-logs?limit=15&offset=0');
  });
});
