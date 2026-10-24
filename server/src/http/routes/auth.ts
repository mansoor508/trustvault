import { Router, type CookieOptions, type Request as ExpressRequest, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { AuthService } from '../../auth/auth-service.js';
import { readCookie } from '../../auth/cookies.js';
import { requireAuth, requireAuthContext } from '../../auth/middleware.js';
import type { AuthContext } from '../../auth/types.js';

const loginBodySchema = z.object({
  email: z
    .string()
    .trim()
    .min(3)
    .max(320)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address'),
  // Only shape is validated here. Password *policy* belongs to account
  // creation; a login must fail as invalid credentials, not as a 422.
  password: z.string().min(1).max(200),
  inviteToken: z.string().trim().max(128).optional(),
});

const registerBodySchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z
    .string()
    .trim()
    .min(3)
    .max(320)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address'),
  companyName: z.string().trim().max(120).optional(),
  inviteToken: z.string().trim().max(128).optional(),
  password: z.string().min(12, 'Password must be at least 12 characters').max(128),
});

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required').max(128),
  newPassword: z.string().min(12, 'New password must be at least 12 characters').max(128),
});

export interface AuthRouterOptions {
  env: Env;
  service: AuthService;
  /**
   * Tier-1: global per-IP limiter, applied first.
   * Prevents horizontal password spraying across many email addresses.
   */
  loginIpRateLimiter?: RequestHandler;
  /** Tier-2: per-(IP+email) limiter — tight account-level brute-force throttle. */
  loginRateLimiter?: RequestHandler;
}

function cookieOptions(env: Env, req?: ExpressRequest): CookieOptions {
  const isHttps = Boolean(
    env.session.secure ||
    req?.secure ||
    req?.headers['x-forwarded-proto'] === 'https'
  );

  const originHeader = typeof req?.headers.origin === 'string' ? req.headers.origin : undefined;
  const hostHeader = typeof req?.headers.host === 'string' ? req.headers.host : undefined;
  const isCrossOrigin = Boolean(
    originHeader &&
    hostHeader &&
    !originHeader.includes(hostHeader)
  );

  const shouldSameSiteNone =
    env.session.sameSite === 'none' ||
    (isHttps && isCrossOrigin);

  return {
    httpOnly: true,
    secure: shouldSameSiteNone ? true : env.session.secure,
    sameSite: shouldSameSiteNone ? 'none' : env.session.sameSite,
    path: '/',
    ...(shouldSameSiteNone ? { partitioned: true } : {}),
  } as CookieOptions;
}

function serializeSession(context: AuthContext): {
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
} {
  return {
    csrfToken: context.session.csrfToken,
    createdAt: context.session.createdAt.toISOString(),
    expiresAt: context.session.expiresAt.toISOString(),
  };
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const { env, service } = options;
  const router = Router();
  const guard = requireAuth({ service, env });

  const loginHandlers: RequestHandler[] = [
    ...(options.loginIpRateLimiter ? [options.loginIpRateLimiter] : []),
    ...(options.loginRateLimiter ? [options.loginRateLimiter] : []),
    login,
  ];

  /**
   * POST /api/auth/login
   * Body: { email, password }. Any `role`/`userId` in the body is stripped by
   * the schema and ignored: identity comes from the database row only.
   */
  async function login(
    req: Parameters<RequestHandler>[0],
    res: Parameters<RequestHandler>[1],
  ): Promise<void> {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const result = await service.login({
      email: parsed.data.email,
      password: parsed.data.password,
      inviteToken: parsed.data.inviteToken,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.id,
      existingToken: readCookie(req.headers.cookie, env.session.cookieName),
    });

    const maxAge = Math.max(0, result.session.expiresAt.getTime() - Date.now());
    res.cookie(env.session.cookieName, result.token, { ...cookieOptions(env, req), maxAge });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      user: result.user,
      session: {
        csrfToken: result.session.csrfToken,
        createdAt: result.session.createdAt.toISOString(),
        expiresAt: result.session.expiresAt.toISOString(),
      },
    });
  }

  /**
   * POST /api/auth/register
   * Public company workspace registration. Creates company and owner.
   */
  async function register(
    req: Parameters<RequestHandler>[0],
    res: Parameters<RequestHandler>[1],
  ): Promise<void> {
    const parsed = registerBodySchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const result = await service.register({
      displayName: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      companyName: parsed.data.companyName?.trim() || undefined,
      inviteToken: parsed.data.inviteToken?.trim() || undefined,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.id,
    });

    const maxAge = Math.max(0, result.session.expiresAt.getTime() - Date.now());
    res.cookie(env.session.cookieName, result.token, { ...cookieOptions(env, req), maxAge });
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({
      user: result.user,
      session: {
        csrfToken: result.session.csrfToken,
        createdAt: result.session.createdAt.toISOString(),
        expiresAt: result.session.expiresAt.toISOString(),
      },
    });
  }

  router.post('/login', ...loginHandlers);
  router.post('/register', ...(options.loginIpRateLimiter ? [options.loginIpRateLimiter] : []), register);

  /** GET /api/auth/me — who am I, and what is my CSRF token after a reload. */
  router.get('/me', guard, (req, res) => {
    const context = requireAuthContext(req);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      user: context.user,
      session: serializeSession(context),
    });
  });

  /**
   * PATCH /api/auth/profile
   * Updates display name for the authenticated user.
   */
  router.patch('/profile', guard, async (req, res) => {
    const context = requireAuthContext(req);
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const updated = await service.updateProfile(
      context.user,
      { displayName: parsed.data.displayName },
      {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        requestId: req.id,
      },
    );

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ user: updated });
  });

  /**
   * POST /api/auth/change-password
   * Changes password for the authenticated user and revokes other sessions.
   */
  router.post('/change-password', guard, async (req, res) => {
    const context = requireAuthContext(req);
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const result = await service.changePassword(
      context.user,
      {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
      },
      {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        requestId: req.id,
      },
      context.session.id,
    );

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  });

  /**
   * GET /api/auth/invitation?token=...
   * Public endpoint to verify invitation token and get workspace metadata.
   */
  router.get('/invitation', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const details = await service.getInvitationDetails(token);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(details);
  });

  /**
   * POST /api/auth/logout — revokes the server-side session, then clears the
   * cookie. CSRF-protected because it mutates server state.
   */
  router.post('/logout', guard, async (req, res) => {
    const context = requireAuthContext(req);
    await service.logout(context, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.id,
    });
    res.clearCookie(env.session.cookieName, cookieOptions(env, req));
    res.status(204).end();
  });

  return router;
}
