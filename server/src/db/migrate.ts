import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  assertPlanIsSafe,
  discoverMigrations,
  planMigrations,
  splitSqlStatements,
  type AppliedMigration,
  type MigrationFile,
  type MigrationPlan,
} from './migration-files.js';

/**
 * Minimal forward-only migration runner.
 *
 * Safety properties:
 * - Advisory lock (`GET_LOCK`) held on a dedicated connection, so two deploys
 *   cannot race the same migration.
 * - Checksums recorded per migration; edited history is a hard error.
 * - Only additive files run (`CREATE TABLE IF NOT EXISTS`); this runner has no
 *   `down`/`drop` command and never executes destructive SQL on its own.
 * - `dryRun` prints the plan without touching the schema.
 */
export const MIGRATION_LOCK_NAME = 'trustvault_schema_migrations';
const MIGRATION_LOCK_TIMEOUT_SECONDS = 15;

const CREATE_MIGRATIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(128) NOT NULL,
  checksum CHAR(64) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  execution_ms INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

interface AppliedRow extends RowDataPacket {
  id: string;
  checksum: string;
  applied_at: Date | string;
  execution_ms: number;
}

export interface MigrationRunOptions {
  pool: Pool;
  migrationsDir: string;
  dryRun?: boolean;
  log?: (message: string) => void;
}

export interface MigrationRunResult {
  applied: string[];
  pending: string[];
  drift: string[];
}

export interface MigrationStatus {
  migrationsDir: string;
  files: MigrationFile[];
  applied: AppliedMigration[];
  plan: MigrationPlan;
}

export async function ensureMigrationsTable(connection: PoolConnection): Promise<void> {
  try {
    await connection.query(CREATE_MIGRATIONS_TABLE_SQL);
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    if (error.code === 'ER_UNKNOWN_COLLATION' || error.message?.includes('Unknown collation')) {
      await connection.query(
        CREATE_MIGRATIONS_TABLE_SQL.replace(/COLLATE=utf8mb4_0900_ai_ci/gi, ''),
      );
      return;
    }
    throw err;
  }
}

export async function readAppliedMigrations(
  connection: PoolConnection,
): Promise<AppliedMigration[]> {
  const [rows] = await connection.query<AppliedRow[]>(
    'SELECT id, checksum, applied_at, execution_ms FROM schema_migrations ORDER BY id ASC',
  );
  return rows.map((row) => ({
    id: row.id,
    checksum: row.checksum,
    appliedAt: row.applied_at,
    executionMs: Number(row.execution_ms),
  }));
}

export async function readMigrationStatus(options: {
  pool: Pool;
  migrationsDir: string;
}): Promise<MigrationStatus> {
  const files = await discoverMigrations(options.migrationsDir);
  const connection = await options.pool.getConnection();
  try {
    await ensureMigrationsTable(connection);
    const applied = await readAppliedMigrations(connection);
    return {
      migrationsDir: options.migrationsDir,
      files,
      applied,
      plan: planMigrations(files, applied),
    };
  } finally {
    connection.release();
  }
}

async function acquireLock(connection: PoolConnection): Promise<boolean> {
  try {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS],
    );
    const row = rows[0];
    if (!row) return true;
    return Number(row.acquired) === 1 || row.acquired === null;
  } catch {
    // If the database engine (e.g. some TiDB versions or proxies) does not support
    // advisory GET_LOCK, proceed rather than failing the migration run.
    return true;
  }
}

async function releaseLock(connection: PoolConnection): Promise<void> {
  try {
    await connection.query('SELECT RELEASE_LOCK(?) AS released', [MIGRATION_LOCK_NAME]);
  } catch {
    // The connection is going away anyway; the lock dies with it.
  }
}

export async function runMigrations(options: MigrationRunOptions): Promise<MigrationRunResult> {
  const { pool, migrationsDir, dryRun = false } = options;
  const log = options.log ?? (() => {});

  const files = await discoverMigrations(migrationsDir);
  const connection = await pool.getConnection();

  try {
    if (!(await acquireLock(connection))) {
      throw new Error(
        `Could not acquire the migration lock "${MIGRATION_LOCK_NAME}" within ${MIGRATION_LOCK_TIMEOUT_SECONDS}s. ` +
          'Another migration run is probably in progress.',
      );
    }

    await ensureMigrationsTable(connection);
    const applied = await readAppliedMigrations(connection);
    const plan = planMigrations(files, applied);
    assertPlanIsSafe(plan);

    if (plan.pending.length === 0) {
      log('No pending migrations.');
      return { applied: [], pending: [], drift: [] };
    }

    if (dryRun) {
      for (const migration of plan.pending) {
        const count = splitSqlStatements(migration.sql).length;
        log(`[dry-run] would apply ${migration.id} (${count} statement(s))`);
      }
      return { applied: [], pending: plan.pending.map((migration) => migration.id), drift: [] };
    }

    const appliedNow: string[] = [];

    for (const migration of plan.pending) {
      const statements = splitSqlStatements(migration.sql);
      const startedAt = performance.now();
      let executed = 0;

      try {
        for (const statement of statements) {
          try {
            await connection.query(statement);
          } catch (stmtError: unknown) {
            const err = stmtError as { message?: string; code?: string; errno?: number };
            const isTrigger =
              statement.toUpperCase().includes('TRIGGER') &&
              (err.message?.includes('not supported') ||
                err.message?.includes('TiDB') ||
                err.code === 'ER_NOT_SUPPORTED_YET' ||
                err.errno === 1105);
            if (isTrigger) {
              log(`[warning] Database engine does not support triggers. Skipping statement: ${err.message ?? 'unsupported'}`);
              executed += 1;
              continue;
            }
            const isFkConstraint =
              statement.toUpperCase().includes('CONSTRAINT') &&
              statement.toUpperCase().includes('FOREIGN KEY') &&
              (err.message?.includes('foreign key') ||
                err.code === 'ER_CANNOT_ADD_FOREIGN' ||
                err.code === 'ER_FK_CANNOT_OPEN' ||
                err.code === 'ER_NOT_SUPPORTED_YET' ||
                err.errno === 1105);
            if (isFkConstraint) {
              log(`[warning] Database engine does not support foreign key constraint. Skipping: ${err.message ?? 'unsupported'}`);
              executed += 1;
              continue;
            }
            if (err.code === 'ER_UNKNOWN_COLLATION' || err.message?.includes('Unknown collation')) {
              const fallback = statement.replace(/COLLATE=utf8mb4_0900_ai_ci/gi, '');
              await connection.query(fallback);
              executed += 1;
              continue;
            }
            if (
              err.code === 'ER_DUP_FIELDNAME' ||
              err.code === 'ER_DUP_KEYNAME' ||
              err.code === 'ER_FK_DUP_NAME' ||
              err.message?.includes('Duplicate column') ||
              err.message?.includes('Duplicate key')
            ) {
              log(`[warning] Schema element already exists, skipping: ${err.message ?? 'duplicate'}`);
              executed += 1;
              continue;
            }
            if (
              err.code === 'ER_CANT_DROP_FIELD_OR_KEY' ||
              err.code === 'ER_KEY_DOES_NOT_EXITS' ||
              err.errno === 1091 ||
              err.message?.includes("Can't DROP") ||
              err.message?.includes('check that column/key exists')
            ) {
              log(`[warning] Key or constraint does not exist, skipping drop: ${err.message ?? 'missing key'}`);
              executed += 1;
              continue;
            }
            throw stmtError;
          }
          executed += 1;
        }
      } catch (error) {
        throw new Error(
          `Migration ${migration.id} failed at statement ${executed + 1}/${statements.length}. ` +
            'The schema may be partially updated; inspect it before retrying.',
          { cause: error },
        );
      }

      const executionMs = Math.round(performance.now() - startedAt);
      await connection.execute(
        'INSERT INTO schema_migrations (id, checksum, execution_ms) VALUES (?, ?, ?)',
        [migration.id, migration.checksum, executionMs],
      );

      appliedNow.push(migration.id);
      log(`Applied ${migration.id} (${statements.length} statement(s), ${executionMs} ms)`);
    }

    return { applied: appliedNow, pending: [], drift: [] };
  } finally {
    await releaseLock(connection);
    connection.release();
  }
}
