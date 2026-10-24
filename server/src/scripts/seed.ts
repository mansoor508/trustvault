import { randomBytes } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { hashPassword } from '../auth/password.js';
import { newId } from '../auth/tokens.js';
import type { UserRole } from '../auth/types.js';
import { EnvValidationError, loadEnv, type Env } from '../config/env.js';
import { createPool } from '../db/pool.js';

/**
 * Demo account seed.
 *
 * Safety properties:
 * - Refuses to run against production unless SEED_ALLOW_PRODUCTION=true.
 * - Never prints a password it did not generate itself (an operator-supplied
 *   SEED_*_PASSWORD is reported as "(provided via env)", never echoed).
 * - Idempotent: existing accounts are updated in place, never duplicated.
 * - Does not reset passwords unless `--rotate-passwords` is passed, so a demo
 *   re-run cannot silently break a teammate's saved login.
 * - Creates exactly one admin, and only through this operator-invoked path.
 *   There is no public registration endpoint at all.
 */

interface DemoAccount {
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  /** Env var that can supply this account's password instead of generating one. */
  readonly passwordEnv: string;
}

const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  {
    email: 'admin@trustvault.local',
    displayName: 'Ava Admin',
    role: 'platform_admin',
    passwordEnv: 'SEED_ADMIN_PASSWORD',
  },
  {
    email: 'owner@trustvault.local',
    displayName: 'Owen Owner',
    role: 'owner',
    passwordEnv: 'SEED_OWNER_PASSWORD',
  },
  {
    email: 'viewer@trustvault.local',
    displayName: 'Vera Viewer',
    role: 'viewer',
    passwordEnv: 'SEED_VIEWER_PASSWORD',
  },
];

interface ExistingUserRow extends RowDataPacket {
  id: string;
  role: UserRole;
}

function generatePassword(): string {
  // 18 random bytes -> 24 base64url characters, comfortably above the 12-char
  // minimum and below bcrypt's 72-byte limit.
  return randomBytes(18).toString('base64url');
}

export const DEMO_COMPANY_ID = 'c0000000-0000-4000-a000-000000000001';
export const DEMO_COMPANY_NAME = 'TrustVault Demo Org';
export const DEFAULT_DEMO_PASSWORD = 'TrustVault2026!';

export interface SeededAccount {
  email: string;
  role: UserRole;
  status: 'created' | 'updated' | 'password-rotated';
  password: string | null;
  passwordSource: 'generated' | 'env' | 'unchanged';
}

export async function seed(
  pool: ReturnType<typeof createPool>,
  env: Env,
  rotatePasswords: boolean,
): Promise<SeededAccount[]> {
  const results: SeededAccount[] = [];
  const now = new Date();

  // Ensure the default demo organization exists before provisioning users
  await pool.execute(
    `INSERT IGNORE INTO companies (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
    [DEMO_COMPANY_ID, DEMO_COMPANY_NAME, now, now],
  );

  const envDefaultPassword = process.env.SEED_DEFAULT_PASSWORD?.trim() ?? '';

  for (const account of DEMO_ACCOUNTS) {
    const [rows] = await pool.execute<ExistingUserRow[]>(
      'SELECT id, role FROM users WHERE email = ? LIMIT 1',
      [account.email],
    );
    const existing = rows[0];

    const specificPassword = process.env[account.passwordEnv]?.trim() ?? '';
    const suppliedPassword = specificPassword.length > 0 ? specificPassword : envDefaultPassword;
    const hasSuppliedPassword = suppliedPassword.length > 0;
    const shouldSetPassword = existing === undefined || rotatePasswords || hasSuppliedPassword;

    const password = shouldSetPassword
      ? hasSuppliedPassword
        ? suppliedPassword
        : DEFAULT_DEMO_PASSWORD
      : null;

    const passwordHash =
      password === null ? null : await hashPassword(password, env.security.bcryptCost);

    if (existing === undefined) {
      await pool.execute(
        `INSERT INTO users
           (id, email, display_name, company_id, role, is_active, password_hash, password_changed_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [newId(), account.email, account.displayName, DEMO_COMPANY_ID, account.role, passwordHash, now],
      );
    } else if (passwordHash !== null) {
      await pool.execute(
        `UPDATE users
            SET display_name = ?, role = ?, is_active = 1, password_hash = ?,
                password_changed_at = ?, failed_login_count = 0, locked_until = NULL
          WHERE id = ?`,
        [account.displayName, account.role, passwordHash, now, existing.id],
      );
    } else {
      await pool.execute(
        `UPDATE users
            SET display_name = ?, role = ?, is_active = 1
          WHERE id = ?`,
        [account.displayName, account.role, existing.id],
      );
    }

    results.push({
      email: account.email,
      role: account.role,
      status:
        existing === undefined
          ? 'created'
          : passwordHash !== null
            ? 'password-rotated'
            : 'updated',
      password,
      passwordSource: !shouldSetPassword
        ? 'unchanged'
        : hasSuppliedPassword
          ? 'env'
          : 'generated',
    });
  }

  await pool.execute(
    `INSERT INTO audit_logs (user_id, action, outcome, resource_type, metadata)
     VALUES (NULL, 'demo_seed', 'success', 'user', ?)`,
    [JSON.stringify({ accounts: results.map((entry) => entry.email), rotatePasswords })],
  );

  return results;
}

export const seedDemoAccounts = seed;

async function main(): Promise<number> {
  const { env } = loadEnv();
  const rotatePasswords = process.argv.includes('--rotate-passwords');

  const allowProduction =
    process.env.SEED_ALLOW_PRODUCTION === 'true' ||
    process.env.SEED_DEMO_ACCOUNTS === 'true' ||
    process.env.AUTO_SEED_DEMO_ACCOUNTS === 'true';

  if (env.isProduction && !allowProduction) {
    console.error(
      'Refusing to seed demo accounts with NODE_ENV=production.\n' +
        'If this is a throwaway environment, re-run with SEED_ALLOW_PRODUCTION=true.',
    );
    return 1;
  }

  console.log('');
  console.log('TrustVault demo seed');
  console.log(`  environment : ${env.nodeEnv}`);
  console.log(`  bcrypt cost : ${env.security.bcryptCost}`);
  console.log(
    `  database    : ${env.database.user}@${env.database.host}:${env.database.port}/${env.database.name}`,
  );
  console.log(`  passwords   : ${rotatePasswords ? 'rotate existing' : 'keep existing'}`);
  console.log('');

  const pool = createPool(env);
  try {
    const results = await seed(pool, env, rotatePasswords);

    console.log('  email                        role     status            password');
    console.log('  ---------------------------  -------  ----------------  ------------------------------');
    for (const result of results) {
      const passwordCell =
        result.password === null
          ? '(unchanged)'
          : result.passwordSource === 'env'
            ? '(from environment)'
            : result.password;
      console.log(
        `  ${result.email.padEnd(29)}${result.role.padEnd(9)}${result.status.padEnd(18)}${passwordCell}`,
      );
    }

    const generated = results.filter((entry) => entry.passwordSource === 'generated');
    if (generated.length > 0) {
      console.log('');
      console.log('  These passwords are shown once and are not stored anywhere in plaintext.');
      console.log('  Save them now, or re-run with --rotate-passwords to issue new ones.');
    }

    console.log('');
    console.log(`  Done: ${results.length} demo account(s) processed.`);
    return 0;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      if (error instanceof EnvValidationError) {
        console.error(`\n${error.message}\n`);
      } else if (error instanceof Error) {
        console.error(`\nSeed failed: ${error.message}`);
        if (error.cause instanceof Error) console.error(`Caused by: ${error.cause.message}`);
      } else {
        console.error('\nSeed failed:', error);
      }
      process.exitCode = 1;
    });
}
