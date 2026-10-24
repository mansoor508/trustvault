import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createApp } from './app.js';
import { EnvValidationError, loadEnv, REPO_ROOT, SERVER_ROOT } from './config/env.js';
import { createLogger } from './config/logger.js';
import { API_PREFIX, SERVICE_NAME, SERVICE_VERSION } from './config/service-info.js';
import { runMigrations } from './db/migrate.js';
import { closePool, ensureDatabase, getPool, hasPool } from './db/pool.js';
import { seedDemoAccounts } from './scripts/seed.js';
import { ensureStorageDir } from './storage/private-storage.js';

/** How long in-flight requests get before the process is forced down. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const { env, warnings, loadedFiles } = loadEnv();
  const logger = createLogger(env);

  for (const warning of warnings) logger.warn(warning);
  if (loadedFiles.length > 0) logger.debug({ loadedFiles }, 'environment files loaded');

  try {
    await ensureStorageDir(env.storageDir, logger);
  } catch (error) {
    // Storage is prepared here so upload endpoints can rely on it. Failing to
    // create it must not stop health checks from answering.
    logger.warn({ err: error, storageDir: env.storageDir }, 'private storage directory unavailable');
  }

  // Ensure target database exists before connecting the pool
  await ensureDatabase(env, logger);

  // Auto-run schema migrations on startup so deployments are ready out of the box.
  try {
    const candidates = [
      process.env.MIGRATIONS_DIR,
      path.join(REPO_ROOT, 'database', 'migrations'),
      path.join(SERVER_ROOT, '..', 'database', 'migrations'),
      path.join(process.cwd(), 'database', 'migrations'),
      path.join(process.cwd(), '..', 'database', 'migrations'),
    ];
    const migrationsDir = candidates.find((dir) => Boolean(dir && fs.existsSync(dir)));
    if (migrationsDir) {
      const pool = getPool(env);
      const result = await runMigrations({
        pool,
        migrationsDir,
        log: (msg) => logger.info({ msg }, 'migration'),
      });
      if (result.applied.length > 0) {
        logger.info({ applied: result.applied }, 'applied database migrations successfully');
      }
    }
  } catch (migError) {
    logger.warn({ err: migError }, 'database migration check failed on startup; will continue');
  }

  // Auto-seed demo accounts on startup if requested via environment variables
  if (process.env.SEED_DEMO_ACCOUNTS === 'true' || process.env.AUTO_SEED_DEMO_ACCOUNTS === 'true') {
    try {
      const pool = getPool(env);
      const rotate = process.env.SEED_ROTATE_PASSWORDS === 'true';
      logger.info('SEED_DEMO_ACCOUNTS enabled: provisioning demo accounts...');
      const seeded = await seedDemoAccounts(pool, env, rotate);
      for (const acc of seeded) {
        logger.info(
          {
            email: acc.email,
            role: acc.role,
            status: acc.status,
            passwordSource: acc.passwordSource,
            password: acc.passwordSource === 'generated' ? acc.password : undefined,
          },
          'demo account provisioned',
        );
      }
    } catch (seedErr) {
      logger.warn({ err: seedErr }, 'demo account seeding failed on startup; will continue');
    }
  }

  const app = createApp({ env, logger });
  const server = http.createServer(app);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown signal received, finishing in-flight requests');

    const forceTimer = setTimeout(() => {
      logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'graceful shutdown timed out, exiting');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();

    server.close((closeError) => {
      void (async () => {
        if (closeError) logger.error({ err: closeError }, 'error while closing the HTTP server');
        if (hasPool()) await closePool();
        logger.info('shutdown complete');
        process.exit(closeError ? 1 : 0);
      })();
    });
  };

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.fatal({ port: env.port }, 'port is already in use');
    } else {
      logger.fatal({ err: error }, 'HTTP server failed to start');
    }
    process.exit(1);
  });

  server.listen(env.port, env.host, () => {
    logger.info(
      {
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        environment: env.nodeEnv,
        health: `http://localhost:${env.port}${API_PREFIX}/health`,
        databaseHealth: `http://localhost:${env.port}${API_PREFIX}/health/database`,
        database: `${env.database.user}@${env.database.host}:${env.database.port}/${env.database.name}`,
        clientOrigins: env.clientOrigins,
        storageDir: env.storageDir,
      },
      `TrustVault API listening on http://${env.host}:${env.port}`,
    );
  });

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    process.exit(1);
  });
}

main().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    // Configuration errors are for the operator, not the logger: print the
    // full, actionable list before exiting.
    console.error(`\n${error.message}\n`);
  } else {
    console.error('Failed to start TrustVault API:', error);
  }
  process.exit(1);
});
