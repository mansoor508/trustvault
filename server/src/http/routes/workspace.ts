import { Router } from 'express';
import { z } from 'zod';
import type { AuthService } from '../../auth/auth-service.js';
import { requireAuth, requireAuthContext } from '../../auth/middleware.js';
import type { Env } from '../../config/env.js';
import type { Logger } from '../../config/logger.js';
import { USER_ROLES } from '../../auth/types.js';

export interface WorkspaceRouterOptions {
  env: Env;
  service: AuthService;
  logger?: Logger;
}

const createWorkspaceSchema = z.object({
  companyName: z.string().trim().min(2, 'Company name must be at least 2 characters').max(120),
});

const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(2, 'Company name must be at least 2 characters').max(120).optional(),
  domain: z.string().trim().max(120).nullable().optional(),
});

const inviteMemberSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  role: z.enum(['admin', 'editor', 'viewer']),
});

const acceptInviteSchema = z.object({
  token: z.string().trim().min(1, 'Invitation token is required'),
});

const updateRoleSchema = z.object({
  role: z.enum(['admin', 'editor', 'viewer']),
});

export function createWorkspaceRouter(options: WorkspaceRouterOptions): Router {
  const { env, service, logger } = options;
  const guard = requireAuth({ service, env });
  const router = Router();

  /** GET /api/workspace/invitations/verify — public verification of an invitation token. */
  router.get('/invitations/verify', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const details = await service.getInvitationDetails(token);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(details);
  });

  /** GET /api/workspace — get current workspace status (company vs personal). */
  router.get('/', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const workspace = await service.getWorkspace(actor);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(workspace);
  });

  /** GET /api/workspace/company-admin — dedicated company administration overview (owner/admin). */
  router.get('/company-admin', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      res.status(403).json({ error: 'Only workspace owners and company administrators can access company administration.' });
      return;
    }
    const overview = await service.getCompanyAdminOverview(actor);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(overview);
  });

  /** POST /api/workspace — create a company workspace for a personal user. */
  router.post('/', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const parsed = createWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const user = await service.createCompanyWorkspace(
      actor,
      { companyName: parsed.data.companyName },
      { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id },
    );

    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ user });
  });

  /** PATCH /api/workspace — update company workspace settings (owner only). */
  router.patch('/', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const parsed = updateWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const company = await service.updateWorkspaceSettings(
      actor,
      parsed.data,
      { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id },
    );

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ company });
  });

  /** GET /api/workspace/members — list all members of the current workspace. */
  router.get('/members', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const start = performance.now();
    const members = await service.listWorkspaceMembers(actor);
    const durationMs = Math.round(performance.now() - start);

    logger?.info(
      {
        requestId: req.id,
        companyId: actor.companyId,
        count: members.length,
        durationMs,
      },
      'Workspace members retrieved successfully',
    );

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ members });
  });

  /** POST /api/workspace/invitations — invite a user to the workspace (owner/admin). */
  router.post('/invitations', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const parsed = inviteMemberSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const start = performance.now();
    logger?.info(
      {
        requestId: req.id,
        companyId: actor.companyId,
        actorId: actor.id,
        role: parsed.data.role,
        targetEmail: parsed.data.email,
      },
      'Processing member invitation',
    );

    const invitation = await service.inviteMember(
      actor,
      parsed.data,
      { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id },
    );

    const frontendUrl = env.frontendUrl.replace(/\/+$/, '');
    const inviteUrl = `${frontendUrl}/register?invite=${encodeURIComponent(invitation.token)}`;

    const durationMs = Math.round(performance.now() - start);
    logger?.info(
      {
        requestId: req.id,
        companyId: actor.companyId,
        invitationId: invitation.id,
        durationMs,
      },
      'Member invitation created successfully',
    );

    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ invitation, inviteUrl });
  });

  /** GET /api/workspace/invitations — list pending invitations (owner/admin). */
  router.get('/invitations', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const start = performance.now();
    logger?.debug(
      { requestId: req.id, companyId: actor.companyId, userId: actor.id },
      'Fetching workspace invitations',
    );

    const invitations = await service.listWorkspaceInvitations(actor);
    const durationMs = Math.round(performance.now() - start);

    logger?.info(
      {
        requestId: req.id,
        companyId: actor.companyId,
        count: invitations.length,
        durationMs,
      },
      'Workspace invitations retrieved successfully',
    );

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ invitations });
  });

  /** DELETE /api/workspace/invitations/:id — revoke an invitation (owner/admin). */
  router.delete('/invitations/:id', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const id = String(req.params.id);
    await service.revokeInvitation(
      actor,
      id,
      { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id },
    );
    res.status(204).end();
  });

  /** POST /api/workspace/invitations/accept — accept an invitation token. */
  router.post('/invitations/accept', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const parsed = acceptInviteSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const user = await service.acceptInvitation(
      actor,
      parsed.data.token,
      { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id },
    );

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ user });
  });

  /** DELETE /api/workspace/members/:userId — remove a member from the workspace (owner/admin). */
  router.delete('/members/:userId', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const targetUserId = String(req.params.userId);
    await service.removeMember(
      actor,
      targetUserId,
      { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id },
    );
    res.status(204).end();
  });

  /** PATCH /api/workspace/members/:userId/role — update a member's role (owner only). */
  router.patch('/members/:userId/role', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const targetUserId = String(req.params.userId);
    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    await service.updateMemberRole(
      actor,
      targetUserId,
      parsed.data.role,
      { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id },
    );

    res.status(204).end();
  });

  return router;
}
