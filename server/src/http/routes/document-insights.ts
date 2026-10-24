import { Router } from 'express';
import { z } from 'zod';
import type { AuthService } from '../../auth/auth-service.js';
import { requireAuth, requireAuthContext, requireRole } from '../../auth/middleware.js';
import type { Env } from '../../config/env.js';
import type { DocumentActivityService } from '../../documents/activity-service.js';
import { AppError } from '../errors.js';

const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const grantBodySchema = z.object({
  email: z
    .string()
    .trim()
    .min(3)
    .max(320)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address'),
  role: z.enum(['owner', 'editor', 'viewer']),
});

function requireDocumentId(raw: string): string {
  if (!DOCUMENT_ID_PATTERN.test(raw)) {
    throw new AppError({
      statusCode: 404,
      code: 'DOCUMENT_NOT_FOUND',
      message: 'That document does not exist or you do not have access to it.',
    });
  }
  return raw;
}

function requireUserId(raw: string): string {
  if (!DOCUMENT_ID_PATTERN.test(raw)) {
    throw new AppError({
      statusCode: 404,
      code: 'PERMISSION_NOT_FOUND',
      message: 'That account does not have a grant on this document.',
    });
  }
  return raw;
}

export interface DocumentInsightsRouterOptions {
  env: Env;
  service: DocumentActivityService;
  authService: AuthService;
}

/**
 * Mounted at /api/documents *before* the CRUD router so /stats and
 * /:id/permissions are matched before /:id.
 */
export function createDocumentInsightsRouter(options: DocumentInsightsRouterOptions): Router {
  const { env, service, authService } = options;
  const guard = requireAuth({ service: authService, env });
  const router = Router();

  /** GET /api/documents/stats — dashboard counters for the current viewer. */
  router.get('/stats', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const stats = await service.stats(actor);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ stats });
  });

  /** GET /api/documents/:id/permissions — current grants (managers only). */
  router.get('/:id/permissions', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const documentId = requireDocumentId(String(req.params.id ?? ''));
    const reqCtx = { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id };

    const permissions = await service.listPermissions(documentId, actor, reqCtx);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ permissions });
  });

  /** POST /api/documents/:id/permissions — grant or update a share. */
  router.post('/:id/permissions', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const documentId = requireDocumentId(String(req.params.id ?? ''));
    const reqCtx = { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id };

    const parsed = grantBodySchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const permissions = await service.grantPermission(documentId, actor, {
      email: parsed.data.email,
      role: parsed.data.role,
    }, reqCtx);

    res.status(200).json({ permissions });
  });

  /** DELETE /api/documents/:id/permissions/:userId — revoke a share. */
  router.delete('/:id/permissions/:userId', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const documentId = requireDocumentId(String(req.params.id ?? ''));
    const userId = requireUserId(String(req.params.userId ?? ''));
    const reqCtx = { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id };

    const permissions = await service.revokePermission(documentId, actor, userId, reqCtx);
    res.status(200).json({ permissions });
  });

  /** GET /api/documents/:id/access-history — who did what to this document. */
  router.get('/:id/access-history', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const documentId = requireDocumentId(String(req.params.id ?? ''));

    const parsed = pageQuerySchema.safeParse(req.query);
    if (!parsed.success) throw parsed.error;

    const page = await service.documentHistory(documentId, actor, parsed.data, {
  ip: req.ip,
  userAgent: req.get('user-agent'),
  requestId: req.id,
});
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      entries: page.entries,
      pagination: { ...parsed.data, total: page.total },
    });
  });

  return router;
}

export interface AccessHistoryRouterOptions {
  env: Env;
  service: DocumentActivityService;
  authService: AuthService;
}

/** GET /api/access-history — activity across every document the viewer manages. */
export function createAccessHistoryRouter(options: AccessHistoryRouterOptions): Router {
  const { env, service, authService } = options;
  const guard = requireAuth({ service: authService, env });
  const router = Router();

  router.get('/', guard, requireRole('admin', 'owner'), async (req, res) => {
    const actor = requireAuthContext(req).user;

    const parsed = pageQuerySchema.safeParse(req.query);
    if (!parsed.success) throw parsed.error;

    const page = await service.managerHistory(actor, parsed.data);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      entries: page.entries,
      pagination: { ...parsed.data, total: page.total },
    });
  });

  return router;
}
