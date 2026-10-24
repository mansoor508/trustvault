import { Router, type Request, type Response } from 'express';
import type { Env } from '../../config/env.js';
import { SERVICE_NAME, SERVICE_VERSION } from '../../config/service-info.js';
import type { DatabaseHealthResult } from '../../db/pool.js';

export type DatabasePing = () => Promise<DatabaseHealthResult>;

export interface HealthRouterOptions {
  env: Env;
  /**
   * Injected so tests can simulate a healthy or unreachable database without
   * needing a MySQL server.
   */
  pingDatabase: DatabasePing;
}

/**
 * Two distinct endpoints, on purpose:
 *
 * - GET /api/health           liveness. Never touches the database, so a
 *                             platform restart loop is not triggered by a
 *                             transient DB outage.
 * - GET /api/health/database  readiness. 200 when the DB answers, 503 when it
 *                             does not.
 */
export function createHealthRouter(options: HealthRouterOptions): Router {
  const { env, pingDatabase } = options;
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      environment: env.nodeEnv,
      uptimeSeconds: Math.round(process.uptime() * 100) / 100,
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  });

  const databaseHealth = async (req: Request, res: Response): Promise<void> => {
    let result: DatabaseHealthResult;

    try {
      result = await pingDatabase();
    } catch {
      // Defensive: the probe is written not to throw, but a custom probe might.
      result = { ok: false, latencyMs: 0, code: 'UNKNOWN' };
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(result.ok ? 200 : 503).json({
      status: result.ok ? 'ok' : 'error',
      check: 'database',
      database: {
        status: result.ok ? 'up' : 'down',
        latencyMs: result.latencyMs,
        ...(result.code ? { code: result.code } : {}),
      },
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  };

  router.get('/database', databaseHealth);
  // Short alias, handy in curl and uptime checks.
  router.get('/db', databaseHealth);

  return router;
}
