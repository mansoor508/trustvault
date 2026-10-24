import {
  createConnection as createMysqlConnection,
  createPool as createMysqlPool,
  type Pool,
} from 'mysql2/promise';
import type { Env } from '../config/env.js';
import type { Logger } from '../config/logger.js';

/** Upper bound for the readiness probe so /health never hangs. */
export const DB_PING_TIMEOUT_MS = 2_000;

export interface DatabaseHealthResult {
  ok: boolean;
  latencyMs: number;
  /** Sanitized driver error code, e.g. ECONNREFUSED or ER_ACCESS_DENIED_ERROR. */
  code?: string;
}

class DatabaseTimeoutError extends Error {
  readonly code = 'TIMEOUT';

  constructor(timeoutMs: number) {
    super(`Database health check timed out after ${timeoutMs} ms`);
    this.name = 'DatabaseTimeoutError';
  }
}

/**
 * Builds the mysql2 pool.
 *
 * Deliberate choices:
 * - `multipleStatements: false` so a single injection cannot chain queries.
 * - `namedPlaceholders` for readable, still-parameterized queries.
 * - UTC (`timezone: 'Z'`) so persisted timestamps are unambiguous.
 */
export function createPool(env: Env): Pool {
  const pool = createMysqlPool({
    host: env.database.host,
    port: env.database.port,
    user: env.database.user,
    password: env.database.password,
    database: env.database.name,
    waitForConnections: true,
    connectionLimit: env.database.connectionLimit,
    maxIdle: env.database.connectionLimit,
    idleTimeout: 60_000,
    queueLimit: 0,
    connectTimeout: 5_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: 'Z',
    charset: 'utf8mb4',
    decimalNumbers: true,
    namedPlaceholders: true,
    multipleStatements: false,
    ssl:
      env.database.ssl ||
      env.database.host.includes('tidbcloud.com') ||
      env.database.host.includes('aivencloud.com') ||
      env.database.port === 4000
        ? {
            minVersion: 'TLSv1.2',
            rejectUnauthorized: env.database.sslRejectUnauthorized !== false,
          }
        : undefined,
  });

  // Pin every pooled connection to UTC.
  //
  // `timezone: 'Z'` above only tells the driver how to *parse and format*
  // dates. Server-side expressions such as NOW() still use the MySQL session
  // time zone, which on a Windows install is the machine's local zone. Mixing
  // the two made `password_changed_at` (written with NOW()) appear hours in the
  // future, which invalidated freshly created sessions. One SET per connection
  // keeps SQL time and driver time in the same frame.
  //
  // Note on mysql2/promise: the pool's 'connection' event receives the underlying
  // core callback connection, not a PromisePoolConnection. Calling connection.query()
  // directly returns a Query EventEmitter whose .then() and .catch() getters throw:
  // "You have tried to call .then(), .catch(), or invoked await on the result of query that is not a promise".
  // Invoking connection.promise().query() yields a real Promise, while connection.query(..., cb)
  // handles callback-only connections safely.
  pool.on('connection', (connection: unknown) => {
    try {
      const conn = connection as {
        promise?: () => { query: (sql: string) => Promise<unknown> };
        query?: (sql: string, callback?: (err: unknown) => void) => unknown;
      };

      if (typeof conn.promise === 'function') {
        void conn.promise().query("SET time_zone = '+00:00'").catch(() => {});
      } else if (typeof conn.query === 'function') {
        conn.query("SET time_zone = '+00:00'", () => {});
      }
    } catch {
      // Non-fatal if session time zone cannot be applied
    }
  });

  return pool;
}

let pool: Pool | null = null;

/**
 * Ensures the target database exists on the MySQL / TiDB server by connecting
 * without a database selected and issuing CREATE DATABASE IF NOT EXISTS.
 */
export async function ensureDatabase(env: Env, logger?: Logger): Promise<boolean> {
  try {
    const connection = await createMysqlConnection({
      host: env.database.host,
      port: env.database.port,
      user: env.database.user,
      password: env.database.password,
      connectTimeout: 10_000,
      ssl:
        env.database.ssl ||
        env.database.host.includes('tidbcloud.com') ||
        env.database.host.includes('aivencloud.com') ||
        env.database.port === 4000
          ? {
              minVersion: 'TLSv1.2',
              rejectUnauthorized: env.database.sslRejectUnauthorized !== false,
            }
          : undefined,
    });

    try {
      await connection.query(`CREATE DATABASE IF NOT EXISTS \`${env.database.name}\``);
      logger?.info({ database: env.database.name }, 'database verified or created successfully');
      return true;
    } finally {
      await connection.end().catch(() => {});
    }
  } catch (error) {
    logger?.warn(
      { err: error, database: env.database.name },
      'could not auto-create database (proceeding with pool connection)',
    );
    return false;
  }
}

/** Process-wide pool. Created lazily so importing the app never opens sockets. */
export function getPool(env: Env): Pool {
  pool ??= createPool(env);
  return pool;
}

export function hasPool(): boolean {
  return pool !== null;
}

/** Closes the pool if one exists. Safe to call during shutdown or tests. */
export async function closePool(): Promise<void> {
  const current = pool;
  pool = null;
  if (!current) return;
  try {
    await current.end();
  } catch {
    // Already closed or never connected: nothing useful to do.
  }
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Never echo raw driver messages to clients: only a bounded code. */
export function extractErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const { code, name } = error as { code?: unknown; name?: unknown };
    if (typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code)) return code;
    if (typeof name === 'string' && /^[A-Za-z0-9_]{2,40}$/.test(name)) return name.toUpperCase();
  }
  return 'UNKNOWN';
}

/**
 * Readiness probe: runs a trivial round-trip and reports latency.
 * Never throws - a failed probe is data, not an exception.
 */
export async function checkDatabase(
  pool: Pool,
  timeoutMs: number = DB_PING_TIMEOUT_MS,
): Promise<DatabaseHealthResult> {
  const startedAt = performance.now();
  let timer: NodeJS.Timeout | undefined;

  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new DatabaseTimeoutError(timeoutMs)), timeoutMs);
      timer.unref();
    });

    await Promise.race([pool.query('SELECT 1 AS ok'), timeout]);
    return { ok: true, latencyMs: roundMs(performance.now() - startedAt) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: roundMs(performance.now() - startedAt),
      code: extractErrorCode(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
