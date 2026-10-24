import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Migration file helpers.
 *
 * Everything in this module is pure (plus filesystem reads) so it can be
 * unit-tested without a MySQL server.
 *
 * File naming contract: `NNNN_snake_case_name.sql`, where NNNN is a
 * zero-padded, monotonically increasing version. Files are applied in
 * filename order and never edited after they have run.
 */
export interface MigrationFile {
  /** Stable identity, e.g. `0001_foundation`. */
  id: string;
  fileName: string;
  absolutePath: string;
  sql: string;
  /** SHA-256 of the normalized SQL, used to detect edited-after-apply drift. */
  checksum: string;
}

export interface AppliedMigration {
  id: string;
  checksum: string;
  appliedAt: Date | string;
  executionMs?: number;
}

export interface MigrationDrift {
  id: string;
  /** Checksum of the file currently on disk. */
  expected: string;
  /** Checksum recorded in schema_migrations when it was applied. */
  actual: string;
}

export interface MigrationPlan {
  pending: MigrationFile[];
  /** Applied migrations whose file changed afterwards. Always an error. */
  drift: MigrationDrift[];
  /** Rows in schema_migrations with no matching file on disk. Always an error. */
  missingFiles: string[];
}

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

export function parseMigrationFileName(fileName: string): string | null {
  const match = MIGRATION_FILE_PATTERN.exec(fileName);
  const order = match?.[1];
  const name = match?.[2];
  if (!order || !name) return null;
  return `${order}_${name}`;
}

/**
 * Normalizes line endings and trailing whitespace before hashing so that a
 * checkout on Windows does not look like a modified migration.
 */
export function checksumSql(sql: string): string {
  const normalized = sql
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/** Reads and validates every migration file in `directory`, sorted by version. */
export async function discoverMigrations(directory: string): Promise<MigrationFile[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch (error) {
    throw new Error(`Cannot read migrations directory "${directory}".`, { cause: error });
  }

  const sqlFiles = entries.filter((entry) => entry.toLowerCase().endsWith('.sql'));
  const invalid = sqlFiles.filter((entry) => !MIGRATION_FILE_PATTERN.test(entry));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid migration file name(s): ${invalid.join(', ')}. ` +
        'Expected NNNN_snake_case_name.sql (e.g. 0002_documents.sql).',
    );
  }

  const migrations = await Promise.all(
    sqlFiles.sort((a, b) => a.localeCompare(b, 'en')).map(async (fileName): Promise<MigrationFile> => {
      const id = parseMigrationFileName(fileName);
      if (!id) throw new Error(`Invalid migration file name "${fileName}".`);
      const absolutePath = path.join(directory, fileName);
      const sql = await fs.readFile(absolutePath, 'utf8');
      return { id, fileName, absolutePath, sql, checksum: checksumSql(sql) };
    }),
  );

  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      throw new Error(`Duplicate migration id "${migration.id}".`);
    }
    seen.add(migration.id);
  }

  return migrations;
}

/**
 * Splits a migration file into individual statements.
 *
 * MySQL DDL cannot run inside a transaction, so statements execute one by one
 * and must be independently valid. The splitter understands `--`/`#` line
 * comments, `/* *\/` block comments, and single/double/backtick quoting, so
 * semicolons inside string literals do not split a statement. Stored routines
 * are intentionally unsupported (no DELIMITER handling).
 */
export function splitSqlStatements(sql: string): string[] {
  if (/^[ \t]*DELIMITER\b/im.test(sql)) {
    throw new Error(
      'DELIMITER is not supported in migrations. Keep each statement self-contained.',
    );
  }

  const statements: string[] = [];
  let current = '';
  let index = 0;
  let state: 'code' | 'single' | 'double' | 'backtick' | 'lineComment' | 'blockComment' = 'code';

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) statements.push(trimmed);
    current = '';
  };

  while (index < sql.length) {
    const char = sql[index] ?? '';
    const next = sql[index + 1] ?? '';

    if (state === 'lineComment') {
      if (char === '\n') state = 'code';
      index += 1;
      continue;
    }

    if (state === 'blockComment') {
      if (char === '*' && next === '/') {
        state = 'code';
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'backtick') {
      const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      const backslashEscapes = state !== 'backtick';

      if (char === '\\' && backslashEscapes) {
        current += char + next;
        index += 2;
        continue;
      }
      if (char === quote) {
        // A doubled quote is an escaped literal, not the end of the string.
        if (next === quote) {
          current += char + next;
          index += 2;
          continue;
        }
        state = 'code';
      }
      current += char;
      index += 1;
      continue;
    }

    // state === 'code'
    if (char === '-' && next === '-') {
      state = 'lineComment';
      index += 2;
      continue;
    }
    if (char === '#') {
      state = 'lineComment';
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'blockComment';
      index += 2;
      continue;
    }
    if (char === "'") {
      state = 'single';
      current += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      state = 'double';
      current += char;
      index += 1;
      continue;
    }
    if (char === '`') {
      state = 'backtick';
      current += char;
      index += 1;
      continue;
    }
    if (char === ';') {
      flush();
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  if (state === 'single' || state === 'double' || state === 'backtick') {
    throw new Error('Unterminated quoted string in migration SQL.');
  }
  if (state === 'blockComment') {
    throw new Error('Unterminated block comment in migration SQL.');
  }

  flush();
  return statements;
}

/** Compares on-disk migrations against the applied rows. */
export function planMigrations(
  files: MigrationFile[],
  applied: AppliedMigration[],
): MigrationPlan {
  const filesById = new Map(files.map((file) => [file.id, file]));
  const appliedIds = new Set(applied.map((row) => row.id));

  const drift: MigrationDrift[] = [];
  const missingFiles: string[] = [];

  for (const row of applied) {
    const file = filesById.get(row.id);
    if (!file) {
      missingFiles.push(row.id);
      continue;
    }
    if (file.checksum !== row.checksum) {
      drift.push({ id: row.id, expected: file.checksum, actual: row.checksum });
    }
  }

  const pending = files.filter((file) => !appliedIds.has(file.id));
  return { pending, drift, missingFiles };
}

/**
 * Refuses to continue when history has diverged from the database.
 * Migrations are forward-only: the fix is a new migration, never an edit.
 */
export function assertPlanIsSafe(plan: MigrationPlan): void {
  if (plan.missingFiles.length > 0) {
    throw new Error(
      `These migrations are recorded as applied but their files are missing: ${plan.missingFiles.join(', ')}. ` +
        'Restore the files before running migrations.',
    );
  }
  if (plan.drift.length > 0) {
    const detail = plan.drift
      .map((entry) => `${entry.id} (expected ${entry.expected.slice(0, 12)}..., found ${entry.actual.slice(0, 12)}...)`)
      .join(', ');
    throw new Error(
      `Applied migrations were edited after running: ${detail}. ` +
        'Migrations are forward-only; add a new migration instead of editing history.',
    );
  }
}
