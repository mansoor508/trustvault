import { Router, type Request, type Response } from 'express';
import type { AuthService } from '../../auth/auth-service.js';
import { requireAuth, requireAuthContext } from '../../auth/middleware.js';
import type { Env } from '../../config/env.js';
import type { Logger } from '../../config/logger.js';

export interface CompanyAdminRouterOptions {
  env: Env;
  service: AuthService;
  logger?: Logger;
}

/**
 * Company Administration surface.
 * Accessible strictly by Company Owners ('owner') and Company Admins ('admin')
 * belonging to a registered company workspace.
 *
 * Multi-tenant isolation is strictly enforced from the authenticated session
 * (actor.companyId). Client parameters can never override the authenticated company.
 */
export function createCompanyAdminRouter(options: CompanyAdminRouterOptions): Router {
  const { env, service, logger } = options;
  const guard = requireAuth({ service, env });
  const router = Router();

  const handleOverview = async (req: Request, res: Response): Promise<void> => {
    const actor = requireAuthContext(req).user;
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      res.status(403).json({ error: 'Only workspace owners and company administrators can access company administration.' });
      return;
    }

    const start = performance.now();
    const overview = await service.getCompanyAdminOverview(actor);
    const durationMs = Math.round(performance.now() - start);

    logger?.info(
      {
        requestId: req.id,
        companyId: actor.companyId,
        actorId: actor.id,
        employeeCount: overview.metrics.totalEmployees,
        durationMs,
      },
      'Company admin overview retrieved successfully',
    );

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(overview);
  };

  /** GET /api/company-admin and GET /api/company-admin/overview */
  router.get('/', guard, handleOverview);
  router.get('/overview', guard, handleOverview);

  return router;
}
