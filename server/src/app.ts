import express, { type Express } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import type { Env } from './config/env.js';
import type { Logger } from './config/logger.js';
import { API_PREFIX, SERVICE_NAME, SERVICE_VERSION } from './config/service-info.js';
import { checkDatabase, getPool } from './db/pool.js';
import { AppError } from './http/errors.js';
import { createErrorHandler } from './http/middleware/error-handler.js';
import { notFoundHandler } from './http/middleware/not-found.js';
import { requestId } from './http/middleware/request-id.js';
import { requestLogger } from './http/middleware/request-logger.js';
import { createAdminRouter } from './http/routes/admin.js';
import { createAuthRouter } from './http/routes/auth.js';
import {
  createAccessHistoryRouter,
  createDocumentInsightsRouter,
} from './http/routes/document-insights.js';
import { createDocumentsRouter } from './http/routes/documents.js';
import { createHealthRouter, type DatabasePing } from './http/routes/health.js';
import { createWorkspaceRouter } from './http/routes/workspace.js';
import { createCompanyAdminRouter } from './http/routes/company-admin.js';
import { AuthService, normalizeEmail } from './auth/auth-service.js';
import { MySqlAuthStore, type AuthStore } from './auth/auth-store.js';
import { createRateLimiter } from './auth/rate-limit.js';
import { hashIpAddress, truncate } from './auth/tokens.js';
import { MySqlDocumentActivityStore, type DocumentActivityStore } from './documents/activity-store.js';
import { DocumentActivityService } from './documents/activity-service.js';
import type { DocumentAuditEvent } from './documents/document-service.js';
import type { DocumentStore } from './documents/document-store.js';
import { MySqlDocumentStore } from './documents/document-store.js';
import { DocumentService } from './documents/document-service.js';
import { FsDocumentStorage, R2DocumentStorage, type DocumentStorage } from './documents/storage.js';

import { isAllowedOrigin } from './auth/origin.js';
export { isAllowedOrigin };

export interface CreateAppOptions {
  env: Env;
  logger: Logger;
  /** Injected by tests; defaults to a real MySQL round-trip via the pool. */
  pingDatabase?: DatabasePing;
  /** Injected by tests; defaults to the MySQL-backed auth store. */
  authStore?: AuthStore;
  /** Injected by tests; defaults to the MySQL document store. */
  documentStore?: DocumentStore;
  /** Injected by tests; defaults to the MySQL activity store. */
  documentActivityStore?: DocumentActivityStore;
  /** Injected by tests; defaults to private filesystem storage. */
  documentStorage?: DocumentStorage;
  /** Injected by tests to make expiry deterministic. */
  clock?: () => Date;
}

/** JSON payloads are small; document uploads arrive as multipart. */
const JSON_BODY_LIMIT = '64kb';
const FORM_BODY_LIMIT = '16kb';

export function createApp(options: CreateAppOptions): Express {
  const { env, logger } = options;
  const pingDatabase: DatabasePing =
    options.pingDatabase ?? (() => checkDatabase(getPool(env)));
  const clock = options.clock ?? (() => new Date());

  // The stores are lazy: constructing them never opens a socket, so health-only
  // tests and cold starts do not touch MySQL or the filesystem.
  const authStore: AuthStore = options.authStore ?? new MySqlAuthStore(getPool(env));
  const authService = new AuthService({
    store: authStore,
    env,
    clock,
    logger,
  });

  const documentStore: DocumentStore =
    options.documentStore ?? new MySqlDocumentStore(getPool(env));
  const activityStore: DocumentActivityStore =
    options.documentActivityStore ?? new MySqlDocumentActivityStore(getPool(env));
  const documentStorage: DocumentStorage =
    options.documentStorage ??
    (env.storage?.driver === 'r2' && env.storage.r2
      ? new R2DocumentStorage(env.storage.r2)
      : new FsDocumentStorage(env.storageDir));

  // One audit sink for every document-related action, so history and the admin
  // dashboard see a single, consistent stream.
  const auditSink = async (event: DocumentAuditEvent): Promise<void> => {
    await authStore.recordAudit({
      userId: event.actorId,
      targetUserId: event.targetUserId ?? null,
      action: event.action,
      outcome: event.outcome ?? 'success',
      resourceType: 'document',
      resourceId: event.resourceId,
      ipHash: hashIpAddress(event.ip, env.session.secret),
      userAgent: truncate(event.userAgent, 255),
      requestId: event.requestId ?? null,
      metadata: event.metadata ?? null,
    });
  };

  const documentService = new DocumentService({
    store: documentStore,
    storage: documentStorage,
    maxUploadBytes: env.maxUploadBytes,
    clock,
    logger,
    audit: auditSink,
  });

  const activityService = new DocumentActivityService({
    documents: documentStore,
    activity: activityStore,
    clock,
    logger,
    audit: auditSink,
  });

  // Tier-1: global per-IP limiter — prevents horizontal password spraying.
  // An attacker testing one common password across thousands of distinct email
  // addresses never trips the per-(IP+email) bucket, so we add an independent
  // ceiling on the total number of login attempts from a single IP.
  const loginIpRateLimiter = createRateLimiter({
    windowMs: env.security.loginRateLimitWindowMinutes * 60_000,
    max: env.security.loginRateLimitMax * 3, // 3× the per-email max
    key: (req) => `ip|${req.ip ?? 'unknown'}`,
    message: 'Too many sign-in attempts from this address. Try again later.',
    clock: () => clock().getTime(),
  });

  // Tier-2: per-(IP+email) limiter — tight account-level brute-force throttle.
  const loginRateLimiter = createRateLimiter({
    windowMs: env.security.loginRateLimitWindowMinutes * 60_000,
    max: env.security.loginRateLimitMax,
    key: (req) => {
      const body = req.body as { email?: unknown } | undefined;
      const email = typeof body?.email === 'string' ? normalizeEmail(body.email) : '';
      return `${req.ip ?? 'unknown'}|${email}`;
    },
    message: 'Too many sign-in attempts from this address. Try again later.',
    clock: () => clock().getTime(),
  });

  const app = express();

  // --- Baseline hardening ---------------------------------------------------
  app.disable('x-powered-by');
  app.set('trust proxy', env.trustProxy);
  // Escapes <, >, &, U+2028/2029 in JSON so a JSON response cannot be
  // interpreted as HTML when a browser is tricked into sniffing it.
  app.set('json escape', true);
  app.set('etag', false);

  // --- Observability --------------------------------------------------------
  app.use(requestId());
  app.use(requestLogger(logger));

  // --- Security headers -----------------------------------------------------
  app.use(
    helmet({
      // This process serves JSON (and file downloads). The SPA's CSP belongs to
      // the static host that delivers index.html.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: env.isProduction
        ? { maxAge: 15_552_000, includeSubDomains: true, preload: false }
        : false,
    }),
  );

  // --- CORS: exact allow-list only -----------------------------------------
  const corsOptions: CorsOptions = {
    origin(origin, callback) {
      // No Origin header: curl, server-to-server, health probes. Not a browser
      // cross-origin request, so there is nothing to authorize.
      if (!origin || isAllowedOrigin(origin, env.clientOrigins)) {
        callback(null, true);
        return;
      }
      callback(
        new AppError({
          statusCode: 403,
          code: 'ORIGIN_NOT_ALLOWED',
          message: 'This origin is not allowed to call the API.',
        }),
      );
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Request-Id', 'X-CSRF-Token', 'Accept', 'Authorization'],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'Content-Disposition'],
    maxAge: 600,
    optionsSuccessStatus: 204,
  };
  app.use(cors(corsOptions));

  // --- Body parsing ---------------------------------------------------------
  // Multipart uploads are parsed by multer inside the documents router, with
  // its own size ceiling; these limits only cover JSON and form bodies.
  app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));
  app.use(express.urlencoded({ extended: false, limit: FORM_BODY_LIMIT }));

  // --- Routes ---------------------------------------------------------------
  app.get('/', (_req, res) => {
    res.json({
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      health: `${API_PREFIX}/health`,
      databaseHealth: `${API_PREFIX}/health/database`,
      authentication: `${API_PREFIX}/auth/login`,
      documents: `${API_PREFIX}/documents`,
      admin: `${API_PREFIX}/admin/overview`,
    });
  });

  app.use(`${API_PREFIX}/health`, createHealthRouter({ env, pingDatabase }));

  // Authentication. /login is the only unauthenticated state-changing route and
  // it is rate limited; /logout validates the session plus its CSRF token.
  app.use(
    `${API_PREFIX}/auth`,
    createAuthRouter({ env, service: authService, loginIpRateLimiter, loginRateLimiter }),
  );

  app.use(
    `${API_PREFIX}/workspace`,
    createWorkspaceRouter({ env, service: authService, logger }),
  );

  app.use(
    `${API_PREFIX}/company-admin`,
    createCompanyAdminRouter({ env, service: authService, logger }),
  );

  // Insights and sharing must be mounted before the CRUD router so /stats is
  // not captured by /:id.
  app.use(
    `${API_PREFIX}/documents`,
    createDocumentInsightsRouter({ env, service: activityService, authService }),
  );

  // Documents: every route is behind a session, and the service applies the
  // owner/co-owner/viewer/admin rule on every operation.
  app.use(
    `${API_PREFIX}/documents`,
    createDocumentsRouter({
      env,
      service: documentService,
      authService,
      logger,
    }),
  );

  app.use(
    `${API_PREFIX}/access-history`,
    createAccessHistoryRouter({ env, service: activityService, authService }),
  );

  // Admin surface: role is read from the database row, never from the request.
  app.use(
    `${API_PREFIX}/admin`,
    createAdminRouter({ env, service: authService, activityService }),
  );

  // --- Fallbacks ------------------------------------------------------------
  app.use(notFoundHandler());
  app.use(createErrorHandler({ env, logger }));

  return app;
}
