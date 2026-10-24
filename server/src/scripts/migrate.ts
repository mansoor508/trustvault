import path from 'node:path';
import { EnvValidationError, loadEnv, REPO_ROOT } from '../config/env.js';
import { readMigrationStatus, runMigrations } from '../db/migrate.js';
import { createPool } from '../db/pool.js';

/**
 * Migration CLI.
 *
 *   npm run migrate         apply pending migrations
 *   npm run migrate:status  show applied / pending / drift without changing anything
 *   npm run migrate:dry     print what would run, execute nothing
 *
 * Forward-only by design: there is intentionally no down/reset command, so this
 * tool can never drop data.
 */
const COMMANDS = ['up', 'status'] as const;
type Command = (typeof COMMANDS)[number];

export function resolveMigrationsDir(): string {
  const override = process.env.MIGRATIONS_DIR?.trim();
  if (override) return path.resolve(process.cwd(), override);
  return path.join(REPO_ROOT, 'database', 'migrations');
}

function formatAppliedAt(value: Date | string | undefined): string {
  if (value === undefined) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

async function main(): Promise<number> {
  const rawCommand = (process.argv[2] ?? 'up').toLowerCase();
  const dryRun = process.argv.includes('--dry-run');

  if (!COMMANDS.includes(rawCommand as Command)) {
    console.error(
      `Unknown command "${rawCommand}". Use one of: ${COMMANDS.join(', ')} (up supports --dry-run).`,
    );
    return 1;
  }
  const command = rawCommand as Command;

  const { env } = loadEnv();
  const migrationsDir = resolveMigrationsDir();
  const pool = createPool(env);

  console.log('');
  console.log('TrustVault migrations');
  console.log(`  command   : ${command}${dryRun ? ' (dry run)' : ''}`);
  console.log(`  directory : ${migrationsDir}`);
  console.log(
    `  database  : ${env.database.user}@${env.database.host}:${env.database.port}/${env.database.name}`,
  );
  console.log('');

  try {
    if (command === 'status') {
      const status = await readMigrationStatus({ pool, migrationsDir });

      if (status.files.length === 0) {
        console.log('  (no migration files found)');
      }

      for (const file of status.files) {
        const applied = status.applied.find((row) => row.id === file.id);
        const drift = status.plan.drift.some((entry) => entry.id === file.id);
        const state = drift ? 'DRIFT' : applied ? 'applied' : 'pending';
        console.log(
          `  ${file.id.padEnd(34)} ${state.padEnd(9)} ${formatAppliedAt(applied?.appliedAt).padEnd(26)} ${file.checksum.slice(0, 12)}`,
        );
      }

      for (const missing of status.plan.missingFiles) {
        console.log(`  ${missing.padEnd(34)} MISSING FILE (recorded as applied, file is gone)`);
      }

      console.log('');
      console.log(
        `  ${status.applied.length} applied, ${status.plan.pending.length} pending, ` +
          `${status.plan.drift.length} drifted, ${status.plan.missingFiles.length} missing.`,
      );
      return status.plan.drift.length > 0 || status.plan.missingFiles.length > 0 ? 1 : 0;
    }

    const result = await runMigrations({
      pool,
      migrationsDir,
      dryRun,
      log: (message) => console.log(`  ${message}`),
    });

    if (result.applied.length > 0) {
      console.log(`\n  Applied ${result.applied.length} migration(s).`);
    } else if (dryRun && result.pending.length > 0) {
      console.log(`\n  Dry run: ${result.pending.length} migration(s) would be applied.`);
    } else {
      console.log('\n  Database is up to date.');
    }
    return 0;
  } finally {
    await pool.end();
  }
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    if (error instanceof EnvValidationError) {
      console.error(`\n${error.message}\n`);
    } else if (error instanceof Error) {
      console.error(`\nMigration failed: ${error.message}`);
      if (error.cause instanceof Error) {
        console.error(`Caused by: ${error.cause.message}`);
      }
    } else {
      console.error('\nMigration failed:', error);
    }
    process.exitCode = 1;
  });
