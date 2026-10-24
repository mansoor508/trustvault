import request from 'supertest';
import type { Response } from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { hashSessionToken } from '../src/auth/tokens.js';
import type { UserRole } from '../src/auth/types.js';
import { InMemoryAuthStore } from './support/in-memory-auth-store.js';
import { STRONG_SECRET, testEnv, testLogger } from './support/test-env.js';

const START = new Date('2026-10-20T09:00:00.000Z');
const PASSWORD = 'Correct-Horse-Battery-9';
const BCRYPT_TEST_COST = 4; // fast hashing; production cost is enforced by env

interface StackOptions {
  env?: Record<string, string | undefined>;
  clock?: { now: Date };
}

function buildStack(options: StackOptions = {}) {
  const env = testEnv(options.env);
  const store = new InMemoryAuthStore();
  const clock = options.clock ?? { now: new Date(START) };

  const app = createApp({
    env,
    logger: testLogger(env),
    pingDatabase: async () => ({ ok: true, latencyMs: 1 }),
    authStore: store,
    clock: () => clock.now,
  });

  return { app, store, clock, env };
}

async function addUser(
  store: InMemoryAuthStore,
  options: {
    email?: string;
    role?: UserRole;
    isActive?: boolean;
    password?: string;
  } = {},
) {
  const passwordHash = await hashPassword(options.password ?? PASSWORD, BCRYPT_TEST_COST);
  return store.addUser({
    email: options.email ?? 'viewer@trustvault.local',
    passwordHash,
    role: options.role ?? 'viewer',
    isActive: options.isActive ?? true,
  });
}

function login(
  app: ReturnType<typeof buildStack>['app'],
  email: string,
  password: string = PASSWORD,
  extra: Record<string, unknown> = {},
) {
  return request(app).post('/api/auth/login').send({ email, password, ...extra });
}

function setCookieHeader(response: Response): string {
  const header = response.headers['set-cookie'] as string | string[] | undefined;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) throw new Error('Expected a Set-Cookie header');
  return raw;
}

function sessionCookie(response: Response): string {
  return setCookieHeader(response).split(';')[0] ?? '';
}

describe('POST /api/auth/login', () => {
  it('signs in with valid credentials and sets an HttpOnly session cookie', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store, { email: 'admin@trustvault.local', role: 'admin' });

    const response = await login(app, '  ADMIN@TrustVault.local ').expect(200);

    expect(response.body.user).toEqual({
      id: user.id,
      email: 'admin@trustvault.local',
      displayName: null,
      role: 'admin',
      isActive: true,
    });
    expect(response.body.session.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    expect(Date.parse(response.body.session.expiresAt)).toBeGreaterThan(START.getTime());

    const cookie = setCookieHeader(response);
    expect(cookie).toContain('tv_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
    expect(response.headers['cache-control']).toBe('no-store');

    expect(store.auditEvents.some((event) => event.action === 'login_success')).toBe(true);
    expect(store.firstSession().userId).toBe(user.id);
  });

  it('stores only the SHA-256 hash of the session token', async () => {
    const { app, store } = buildStack();
    await addUser(store);

    const response = await login(app, 'viewer@trustvault.local').expect(200);
    const rawToken = decodeURIComponent(sessionCookie(response).split('=')[1] ?? '');

    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(store.firstSession().tokenHash).toBe(hashSessionToken(rawToken));
    expect(store.firstSession().tokenHash).not.toBe(rawToken);
  });

  it('rejects a wrong password without revealing whether the email exists', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store);

    const response = await login(app, user.email, 'definitely-not-the-password').expect(401);

    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(response.body.error.message).toBe('Email or password is incorrect.');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(store.sessions.size).toBe(0);
    expect(store.users.get(user.id)?.failedLoginCount).toBe(1);
    expect(store.auditEvents.some((event) => event.action === 'login_failed')).toBe(true);
  });

  it('returns the identical error for an unknown email', async () => {
    const { app, store } = buildStack();

    const knownShape = await login(app, 'nobody@trustvault.local').expect(401);

    expect(knownShape.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(knownShape.body.error.message).toBe('Email or password is incorrect.');
    expect(store.auditEvents.some((event) => event.metadata?.['reason'] === 'unknown_email')).toBe(
      true,
    );
  });

  it('rejects a disabled account and creates no session', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store, { isActive: false });

    const response = await login(app, user.email).expect(401);

    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(store.sessions.size).toBe(0);
    expect(store.auditEvents.some((event) => event.metadata?.['reason'] === 'inactive')).toBe(true);
  });

  it('ignores role and userId supplied in the login body', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store, { role: 'viewer' });

    const response = await login(app, user.email, PASSWORD, {
      role: 'admin',
      userId: 'attacker-controlled-id',
      isActive: true,
    }).expect(200);

    expect(response.body.user.role).toBe('viewer');
    expect(response.body.user.id).toBe(user.id);
    expect(store.firstSession().userId).toBe(user.id);
    expect(store.users.get(user.id)?.role).toBe('viewer');
  });

  it('rotates the session when a session cookie is already presented', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store);

    const first = await login(app, user.email).expect(200);
    const firstCookie = sessionCookie(first);
    const firstSessionId = store.firstSession().id;

    const second = await login(app, user.email, PASSWORD).set('Cookie', firstCookie).expect(200);
    const secondCookie = sessionCookie(second);

    expect(secondCookie).not.toBe(firstCookie);
    expect(store.sessionsFor(user.id)).toHaveLength(2);

    const oldSession = store.sessions.get(firstSessionId);
    expect(oldSession?.revokedAt).not.toBeNull();

    // The old cookie no longer authenticates.
    await request(app).get('/api/auth/me').set('Cookie', firstCookie).expect(401);
  });

  it('validates the request body', async () => {
    const { app } = buildStack();

    await request(app).post('/api/auth/login').send({ email: 'not-an-email' }).expect(422);
    await request(app).post('/api/auth/login').send({}).expect(422);
  });
});

describe('GET /api/auth/me', () => {
  it('requires a session', async () => {
    const { app } = buildStack();

    const response = await request(app).get('/api/auth/me').expect(401);

    expect(response.body.error.code).toBe('NOT_AUTHENTICATED');
  });

  it('returns the current user and CSRF token after a reload', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store, { role: 'owner' });

    const loginResponse = await login(app, user.email).expect(200);
    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', sessionCookie(loginResponse))
      .expect(200);

    expect(response.body.user.email).toBe(user.email);
    expect(response.body.user.role).toBe('owner');
    expect(response.body.session.csrfToken).toBe(loginResponse.body.session.csrfToken);
  });

  it('rejects a forged session token', async () => {
    const { app } = buildStack();

    const response = await request(app).get('/api/auth/me').set('Cookie', 'tv_session=forged').expect(401);

    expect(response.body.error.code).toBe('SESSION_INVALID');
  });

  it('expires the session after the absolute TTL', async () => {
    const { app, store, clock } = buildStack();
    const user = await addUser(store);
    const loginResponse = await login(app, user.email).expect(200);

    clock.now = new Date(START.getTime() + 13 * 60 * 60 * 1_000); // TTL is 12h

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', sessionCookie(loginResponse))
      .expect(401);

    expect(response.body.error.code).toBe('SESSION_EXPIRED');
    expect(store.sessionsFor(user.id)[0]?.revokedAt).not.toBeNull();
  });

  it('expires the session after the idle timeout even before the TTL', async () => {
    const { app, store, clock } = buildStack({ env: { SESSION_IDLE_MINUTES: '15' } });
    const user = await addUser(store);
    const loginResponse = await login(app, user.email).expect(200);

    clock.now = new Date(START.getTime() + 16 * 60 * 1_000);

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', sessionCookie(loginResponse))
      .expect(401);

    expect(response.body.error.code).toBe('SESSION_IDLE_TIMEOUT');
  });

  it('rejects a session whose account was disabled after login', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store);
    const loginResponse = await login(app, user.email).expect(200);

    store.setActive(user.id, false);

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', sessionCookie(loginResponse))
      .expect(403);

    expect(response.body.error.code).toBe('ACCOUNT_DISABLED');
    expect(store.sessionsFor(user.id).every((session) => session.revokedAt !== null)).toBe(true);
    expect(store.auditEvents.some((event) => event.action === 'session_denied')).toBe(true);
  });

  it('rejects sessions created before a password change', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store);
    const loginResponse = await login(app, user.email).expect(200);

    store.setPasswordChangedAt(user.id, new Date(START.getTime() + 1_000));

    const response = await request(app)
      .get('/api/auth/me')
      .set('Cookie', sessionCookie(loginResponse))
      .expect(401);

    expect(response.body.error.code).toBe('SESSION_INVALID');
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store);
    const loginResponse = await login(app, user.email).expect(200);
    const cookie = sessionCookie(loginResponse);
    const csrfToken = loginResponse.body.session.csrfToken as string;

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .expect(204);

    const clearedCookie = setCookieHeader(response);
    expect(clearedCookie).toContain('tv_session=');
    expect(clearedCookie).toContain('Expires=Thu, 01 Jan 1970');
    expect(store.sessionsFor(user.id)[0]?.revokedAt).not.toBeNull();
    expect(store.auditEvents.some((event) => event.action === 'logout')).toBe(true);

    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('requires a valid CSRF token and leaves the session usable when it is missing', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store);
    const loginResponse = await login(app, user.email).expect(200);
    const cookie = sessionCookie(loginResponse);

    const response = await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(403);

    expect(response.body.error.code).toBe('CSRF_TOKEN_INVALID');
    expect(store.sessionsFor(user.id)[0]?.revokedAt).toBeNull();

    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
  });

  it('rejects a CSRF token minted for a different session', async () => {
    const { app, store } = buildStack();
    const viewer = await addUser(store, { email: 'viewer@trustvault.local' });
    const owner = await addUser(store, { email: 'owner@trustvault.local', role: 'owner' });

    const viewerLogin = await login(app, viewer.email).expect(200);
    const ownerLogin = await login(app, owner.email).expect(200);

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', sessionCookie(viewerLogin))
      .set('X-CSRF-Token', ownerLogin.body.session.csrfToken as string)
      .expect(403);

    expect(response.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });
});

describe('rate limiting and account lockout', () => {
  it('rate limits repeated attempts for the same address and email', async () => {
    const { app, store } = buildStack({
      env: { LOGIN_RATE_LIMIT_MAX: '2', LOGIN_MAX_FAILED_ATTEMPTS: '10' },
    });
    await addUser(store);

    await login(app, 'viewer@trustvault.local', 'wrong').expect(401);
    await login(app, 'viewer@trustvault.local', 'wrong').expect(401);

    const limited = await login(app, 'viewer@trustvault.local', PASSWORD).expect(429);

    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('locks the account after repeated failures, even for a correct password', async () => {
    const { app, store } = buildStack({
      env: { LOGIN_MAX_FAILED_ATTEMPTS: '3', LOGIN_RATE_LIMIT_MAX: '50' },
    });
    const user = await addUser(store);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await login(app, user.email, 'wrong-password').expect(401);
    }

    const locked = await login(app, user.email, PASSWORD).expect(429);

    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    expect(store.users.get(user.id)?.lockedUntil).not.toBeNull();
  });

  it('does not leak whether a locked account exists through a different error', async () => {
    const { app, store } = buildStack({ env: { LOGIN_MAX_FAILED_ATTEMPTS: '3' } });
    const user = await addUser(store);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await login(app, user.email, 'wrong-password').expect(401);
    }

    const unknown = await login(app, 'ghost@trustvault.local', 'wrong-password');
    const locked = await login(app, user.email, 'wrong-password');

    expect(unknown.status).toBe(401);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('authorization (privilege escalation)', () => {
  it('forbids a viewer from reading admin audit logs', async () => {
    const { app, store } = buildStack();
    const viewer = await addUser(store, { role: 'viewer' });
    const loginResponse = await login(app, viewer.email).expect(200);

    const response = await request(app)
      .get('/api/admin/audit-logs')
      .set('Cookie', sessionCookie(loginResponse))
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.details).toEqual({ requiredRoles: ['platform_admin'] });
  });

  it('forbids an owner and company admin from reading platform admin audit logs', async () => {
    const { app, store } = buildStack();
    const owner = await addUser(store, { email: 'owner@trustvault.local', role: 'owner' });
    const ownerLogin = await login(app, owner.email).expect(200);

    await request(app)
      .get('/api/admin/audit-logs')
      .set('Cookie', sessionCookie(ownerLogin))
      .expect(403);

    const companyAdmin = await addUser(store, { email: 'company-admin@trustvault.local', role: 'admin' });
    const adminLogin = await login(app, companyAdmin.email).expect(200);

    await request(app)
      .get('/api/admin/audit-logs')
      .set('Cookie', sessionCookie(adminLogin))
      .expect(403);
  });

  it('allows an admin and returns the audit trail newest first', async () => {
    const { app, store } = buildStack();
    const admin = await addUser(store, { email: 'admin@trustvault.local', role: 'platform_admin' });
    const loginResponse = await login(app, admin.email).expect(200);

    const response = await request(app)
      .get('/api/admin/audit-logs?limit=10&offset=0')
      .set('Cookie', sessionCookie(loginResponse))
      .expect(200);

    expect(Array.isArray(response.body.entries)).toBe(true);
    expect(response.body.entries.length).toBeGreaterThan(0);
    expect(response.body.entries[0].action).toBe('login_success');
    expect(response.body.pagination).toEqual({ limit: 10, offset: 0, total: response.body.entries.length });
    expect(JSON.stringify(response.body)).not.toContain('$2b$');
  });

  it('rejects admin access with a tampered cookie', async () => {
    const { app, store } = buildStack();
    await addUser(store, { role: 'admin' });

    await request(app)
      .get('/api/admin/audit-logs')
      .set('Cookie', 'tv_session=not-a-real-token')
      .expect(401);
  });
});

describe('cookie hardening', () => {
  it('marks the session cookie Secure in production', async () => {
    const { app, store } = buildStack({
      env: {
        NODE_ENV: 'production',
        CLIENT_ORIGINS: 'https://trustvault.app',
        DATABASE_PASSWORD: 'a-real-production-password',
        SESSION_SECRET: STRONG_SECRET,
      },
    });
    await addUser(store);

    const response = await login(app, 'viewer@trustvault.local').expect(200);

    const cookie = setCookieHeader(response);
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });
});

describe('response hygiene', () => {
  it('never returns a password hash or the raw session token', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store);

    const loginResponse = await login(app, user.email).expect(200);
    const rawToken = decodeURIComponent(sessionCookie(loginResponse).split('=')[1] ?? '');

    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', sessionCookie(loginResponse))
      .expect(200);

    for (const payload of [loginResponse.body, me.body]) {
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain('$2b$');
      expect(serialized).not.toContain(user.passwordHash);
      expect(serialized).not.toContain(rawToken);
      expect(serialized).not.toContain('tokenHash');
      expect(serialized).not.toContain('password_hash');
    }
  });
});

describe('profile and password settings', () => {
  it('updates display name when authenticated with valid CSRF token', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store, { email: 'user@trustvault.local' });

    const loginResponse = await login(app, user.email).expect(200);
    const cookie = sessionCookie(loginResponse);
    const csrfToken = loginResponse.body.session.csrfToken;

    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ displayName: 'Alex Security Pro' })
      .expect(200);

    expect(res.body.user.displayName).toBe('Alex Security Pro');

    // Verify persistence via /me
    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);

    expect(me.body.user.displayName).toBe('Alex Security Pro');
  });

  it('rejects profile update without CSRF token', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store);

    const loginResponse = await login(app, user.email).expect(200);
    const cookie = sessionCookie(loginResponse);

    await request(app)
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .send({ displayName: 'Attacker' })
      .expect(403);
  });

  it('changes password securely and allows subsequent login with new password', async () => {
    const { app, store } = buildStack();
    const user = await addUser(store, { email: 'passchange@trustvault.local', password: 'OldPassword123!Secure' });

    const loginResponse = await login(app, user.email, 'OldPassword123!Secure').expect(200);
    const cookie = sessionCookie(loginResponse);
    const csrfToken = loginResponse.body.session.csrfToken;

    // Fail if current password wrong
    await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ currentPassword: 'WrongPassword!', newPassword: 'NewPassword123!Super' })
      .expect(401);

    // Fail if new password same as current
    await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ currentPassword: 'OldPassword123!Secure', newPassword: 'OldPassword123!Secure' })
      .expect(400);

    // Succeed with valid passwords
    await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ currentPassword: 'OldPassword123!Secure', newPassword: 'BrandNewSecure2026!Pass' })
      .expect(200);

    // Login with old password must fail
    await login(app, user.email, 'OldPassword123!Secure').expect(401);

    // Login with new password must succeed
    await login(app, user.email, 'BrandNewSecure2026!Pass').expect(200);
  });
});
