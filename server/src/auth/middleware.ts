import type { Request, RequestHandler } from 'express';
import type { Env, } from '../config/env.js';
import { AuthError, type AuthService } from './auth-service.js';
import { readCookie } from './cookies.js';
import { extractRequestOrigin, isAllowedOrigin } from './origin.js';
import type { AuthContext, UserRole } from './types.js';

/** Methods that change state and therefore require a CSRF token. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface AuthGuardOptions {
  service: AuthService;
  env: Env;
}

/** Returns the authenticated context or throws. Never trusts client-supplied ids. */
export function requireAuthContext(req: Request): AuthContext {
  const context = req.auth;
  if (!context) {
    throw new AuthError(401, 'NOT_AUTHENTICATED', 'Sign in to continue.');
  }
  return context;
}

/**
 * CSRF defence for cookie-authenticated state-changing requests.
 *
 * Two independent checks:
 * 1. `Origin`, when the browser sends one, must be in the configured allow-list.
 * 2. `X-CSRF-Token` must equal this session's synchroniser token, compared in
 *    constant time. The token is delivered by /login and /me and held in memory
 *    by the client, so a cross-site form post can never present it.
 */
export function assertCsrfProtection(req: Request, options: AuthGuardOptions): void {
  const context = requireAuthContext(req);

  const origin = extractRequestOrigin(req);
  if (origin !== undefined && !isAllowedOrigin(origin, options.env.clientOrigins)) {
    throw new AuthError(
      403,
      'ORIGIN_NOT_ALLOWED',
      'This origin is not allowed to change data.',
    );
  }

  const provided = req.get('x-csrf-token');
  if (provided === undefined || !options.service.verifyCsrfToken(provided, context.session.csrfToken)) {
    throw new AuthError(
      403,
      'CSRF_TOKEN_INVALID',
      'Missing or invalid CSRF token. Reload the page and try again.',
    );
  }
}

/**
 * Authenticates the session cookie and, for unsafe methods, enforces CSRF.
 * Secure by default: a new protected route inherits both checks.
 */
export function requireAuth(options: AuthGuardOptions): RequestHandler {
  return (req, _res, next) => {
    const token = readCookie(req.headers.cookie, options.env.session.cookieName);

    void options.service
      .authenticate(token)
      .then((result) => {
        req.auth = { user: result.user, session: result.session };
        if (UNSAFE_METHODS.has(req.method.toUpperCase())) {
          assertCsrfProtection(req, options);
        }
        next();
      })
      .catch(next);
  };
}

/**
 * Role gate. Roles always come from the database row loaded with the session,
 * never from a header, body or query parameter.
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.auth?.user;
    if (!user) {
      next(new AuthError(401, 'NOT_AUTHENTICATED', 'Sign in to continue.'));
      return;
    }
    if (!roles.includes(user.role)) {
      next(
        new AuthError(403, 'FORBIDDEN', 'Your role does not allow this action.', {
          requiredRoles: roles,
        }),
      );
      return;
    }
    next();
  };
}
