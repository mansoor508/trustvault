import { Router } from 'express';
import { z } from 'zod';
import type { Env } from '../../config/env.js';
import type { AuthService } from '../../auth/auth-service.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import type { DocumentActivityService } from '../../documents/activity-service.js';

const listQuerySchema = z.object({
  actor: z.string().trim().max(120).optional(),
  documentId: z.string().trim().max(64).optional(),
  action: z.string().trim().max(64).optional(),
  outcome: z.enum(['success', 'failure', 'denied']).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const userStatusSchema = z.object({
  isActive: z.boolean(),
});

const userFilterSchema = z.object({
  companyId: z.string().trim().optional(),
  search: z.string().trim().max(100).optional(),
  role: z.string().trim().optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export interface AdminRouterOptions {
  env: Env;
  service: AuthService;
  activityService: DocumentActivityService;
}

/**
 * Admin-only surface. Every handler is behind requireRole('admin'), and the
 * service re-checks the role from the session's database row, so a forged
 * frontend cannot reach any of it.
 *
 * Administrators can inspect platform metrics, audit logs, and permission history,
 * but NEVER receive automatic access to view or download document contents.
 */
export function createAdminRouter(options: AdminRouterOptions): Router {
  const { env, service, activityService } = options;
  const router = Router();
  const guard = [requireAuth({ service, env }), requireRole('platform_admin')];

  /** GET /api/admin/audit-logs/verify — cryptographic hash chain and checkpoint verification. */
  router.get('/audit-logs/verify', ...guard, async (_req, res) => {
    const result = await service.verifyAuditIntegrity();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(result);
  });

  /** POST /api/admin/audit-logs/checkpoints — create a tamper-evident checkpoint snapshot. */
  router.post('/audit-logs/checkpoints', ...guard, async (_req, res) => {
    const checkpoint = await service.createCheckpoint();
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ checkpoint });
  });

  /** GET /api/admin/audit-logs/checkpoints — list recent audit checkpoints. */
  router.get('/audit-logs/checkpoints', ...guard, async (_req, res) => {
    const checkpoints = await service.listCheckpoints();
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ checkpoints });
  });

  /** GET /api/admin/audit-logs — filtered platform audit trail. */
  router.get('/audit-logs', ...guard, async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw parsed.error;

    const { entries, total } = await service.listAuditLogs(parsed.data);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      entries,
      pagination: {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        total,
      },
    });
  });

  /** GET /api/admin/permission-history — cross-tenant permission grant and revocation audit trail. */
  router.get('/permission-history', ...guard, async (req, res) => {
    const parsed = z
      .object({
        documentId: z.string().trim().max(64).optional(),
        actor: z.string().trim().max(120).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).max(100_000).default(0),
      })
      .safeParse(req.query);
    if (!parsed.success) throw parsed.error;

    const { entries, total } = await service.listAuditLogs({
      action: 'document.permission_%',
      documentId: parsed.data.documentId,
      actor: parsed.data.actor,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      entries,
      pagination: {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        total,
      },
    });
  });

  /** GET /api/admin/overview — platform counters for the admin dashboard. */
  router.get('/overview', ...guard, async (req, res) => {
    const actor = req.auth?.user;
    if (!actor) return;

    const overview = await activityService.adminOverview(actor);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ overview });
  });

  /** GET /api/admin/companies — list all company workspaces with employee counts. */
  router.get('/companies', ...guard, async (req, res) => {
    const actor = req.auth?.user;
    if (!actor) return;

    const companies = await activityService.adminCompanies(actor);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ companies });
  });

  /** GET /api/admin/companies/:id/employees — list employees belonging to a specific company workspace. */
  router.get('/companies/:id/employees', ...guard, async (req, res) => {
    const actor = req.auth?.user;
    if (!actor) return;

    const companyId = String(req.params.id ?? '');
    const employees = await activityService.adminUsers(actor, { companyId });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ employees });
  });

  /** GET /api/admin/users — all registered employees across all companies, with search & filtering. */
  router.get('/users', ...guard, async (req, res) => {
    const actor = req.auth?.user;
    if (!actor) return;

    const parsed = userFilterSchema.safeParse(req.query);
    const filters = parsed.success ? parsed.data : undefined;

    const users = await activityService.adminUsers(actor, filters);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ users });
  });

  /** PATCH /api/admin/users/:id/status — activate or deactivate an account. */
  router.patch('/users/:id/status', ...guard, async (req, res) => {
    const actor = req.auth?.user;
    if (!actor) return;

    const targetUserId = String(req.params.id ?? '');
    const parsed = userStatusSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    await service.setUserStatus(actor, targetUserId, parsed.data.isActive, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.id,
    });

    res.status(200).json({ ok: true, userId: targetUserId, isActive: parsed.data.isActive });
  });

  return router;
}
