import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import {
  assertPlanIsSafe,
  checksumSql,
  discoverMigrations,
  parseMigrationFileName,
  planMigrations,
  splitSqlStatements,
} from '../src/db/migration-files.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../database/migrations', import.meta.url));

interface AppliedRowStub {
  id: string;
  checksum: string;
  applied_at: string;
  execution_ms: number;
}

/**
 * Standalone stub of a mysql2 connection. Records statements so tests can
 * assert what the runner executed without needing a MySQL server.
 */
class StubConnection {
  readonly queries: string[] = [];
  readonly inserts: Array<{ sql: string; values: unknown[] }> = [];
  released = false;

  constructor(private readonly applied: AppliedRowStub[] = []) {}

  async query(sql: string): Promise<[unknown, unknown]> {
    this.queries.push(sql);
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }], []];
    if (sql.includes('FROM schema_migrations')) return [this.applied, []];
    return [[], []];
  }

  async execute(sql: string, values: unknown[]): Promise<[unknown, unknown]> {
    this.inserts.push({ sql, values });
    return [{}, []];
  }

  release(): void {
    this.released = true;
  }
}

function stubPool(connection: StubConnection): Pool {
  return { getConnection: async () => connection } as unknown as Pool;
}

async function readMigrationSql(id: string): Promise<string> {
  return fs.readFile(path.join(MIGRATIONS_DIR, `${id}.sql`), 'utf8');
}

describe('parseMigrationFileName', () => {
  it.each([
    ['0001_foundation.sql', '0001_foundation'],
    ['0042_add_document_shares.sql', '0042_add_document_shares'],
  ])('accepts %s', (fileName, expected) => {
    expect(parseMigrationFileName(fileName)).toBe(expected);
  });

  it.each([
    '001_short.sql',
    '0001-Foundation.sql',
    '0001_foundation.SQL',
    'foundation.sql',
    '0001_foundation.sql.bak',
    '0001_.sql',
  ])('rejects %s', (fileName) => {
    expect(parseMigrationFileName(fileName)).toBeNull();
  });
});

describe('checksumSql', () => {
  it('is stable across line-ending and trailing-whitespace changes', () => {
    const unix = 'CREATE TABLE t (\n  id INT\n);\n';
    const windows = 'CREATE TABLE t (\r\n  id INT   \r\n);\r\n';

    expect(checksumSql(windows)).toBe(checksumSql(unix));
    expect(checksumSql(unix)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the SQL actually changes', () => {
    expect(checksumSql('SELECT 1;')).not.toBe(checksumSql('SELECT 2;'));
  });
});

describe('splitSqlStatements', () => {
  it('splits on statement terminators', () => {
    const statements = splitSqlStatements('CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);');

    expect(statements).toEqual(['CREATE TABLE a (id INT)', 'CREATE TABLE b (id INT)']);
  });

  it('keeps a trailing statement that has no semicolon', () => {
    expect(splitSqlStatements('SELECT 1')).toEqual(['SELECT 1']);
  });

  it('does not split inside single-quoted strings', () => {
    const statements = splitSqlStatements("INSERT INTO t VALUES ('a;b', 'it''s ok');");

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("'a;b'");
  });

  it('does not split inside backtick identifiers', () => {
    expect(splitSqlStatements('SELECT `weird;name` FROM t;')).toEqual([
      'SELECT `weird;name` FROM t',
    ]);
  });

  it('strips line and block comments', () => {
    const sql = [
      '-- leading comment with ; semicolon',
      '# hash comment',
      '/* block ; comment */',
      'CREATE TABLE t (id INT);',
    ].join('\n');

    expect(splitSqlStatements(sql)).toEqual(['CREATE TABLE t (id INT)']);
  });

  it('handles escaped quotes inside strings', () => {
    expect(splitSqlStatements("INSERT INTO t VALUES ('a\\'b;c');")).toHaveLength(1);
  });

  it('returns nothing for an empty or comment-only file', () => {
    expect(splitSqlStatements('')).toEqual([]);
    expect(splitSqlStatements('-- nothing here\n')).toEqual([]);
  });

  it('refuses DELIMITER blocks instead of mis-parsing them', () => {
    expect(() => splitSqlStatements('DELIMITER //\nCREATE PROCEDURE p() BEGIN END //')).toThrow(
      /DELIMITER is not supported/,
    );
  });

  it('rejects an unterminated string', () => {
    expect(() => splitSqlStatements("SELECT 'unterminated;")).toThrow(/Unterminated/);
  });
});

describe('discoverMigrations', () => {
  it('finds the real migrations in order with stable checksums', async () => {
    const migrations = await discoverMigrations(MIGRATIONS_DIR);

    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations[0]?.id).toBe('0001_foundation');
    expect(migrations[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(migrations.map((migration) => migration.id)).toEqual(
      [...migrations.map((migration) => migration.id)].sort(),
    );
  });

  it('fails with a clear message when the directory is missing', async () => {
    await expect(discoverMigrations(path.join(MIGRATIONS_DIR, 'nope'))).rejects.toThrow(
      /Cannot read migrations directory/,
    );
  });
});

describe('planMigrations', () => {
  const file = {
    id: '0001_foundation',
    fileName: '0001_foundation.sql',
    absolutePath: '/tmp/0001_foundation.sql',
    sql: 'SELECT 1;',
    checksum: 'a'.repeat(64),
  };

  it('marks unapplied files as pending', () => {
    const plan = planMigrations([file], []);

    expect(plan.pending.map((entry) => entry.id)).toEqual(['0001_foundation']);
    expect(plan.drift).toEqual([]);
    expect(plan.missingFiles).toEqual([]);
  });

  it('marks matching applied files as done', () => {
    const plan = planMigrations([file], [{ id: file.id, checksum: file.checksum, appliedAt: new Date() }]);

    expect(plan.pending).toEqual([]);
  });

  it('detects edited history', () => {
    const plan = planMigrations([file], [
      { id: file.id, checksum: 'b'.repeat(64), appliedAt: new Date() },
    ]);

    expect(plan.drift).toEqual([{ id: file.id, expected: file.checksum, actual: 'b'.repeat(64) }]);
    expect(() => assertPlanIsSafe(plan)).toThrow(/forward-only/);
  });

  it('detects applied migrations whose file disappeared', () => {
    const plan = planMigrations([], [{ id: '0009_lost', checksum: 'c'.repeat(64), appliedAt: new Date() }]);

    expect(plan.missingFiles).toEqual(['0009_lost']);
    expect(() => assertPlanIsSafe(plan)).toThrow(/files are missing/);
  });
});

describe('runMigrations', () => {
  it('applies every pending migration, records checksums and releases the lock', async () => {
    const migrations = await discoverMigrations(MIGRATIONS_DIR);
    const connection = new StubConnection();
    const result = await runMigrations({ pool: stubPool(connection), migrationsDir: MIGRATIONS_DIR });

    expect(migrations.length).toBeGreaterThanOrEqual(2);
    expect(result.applied).toEqual(migrations.map((migration) => migration.id));
    expect(connection.inserts).toHaveLength(migrations.length);
    expect(connection.inserts[0]?.values[0]).toBe('0001_foundation');
    expect(connection.inserts[0]?.values[1]).toBe(
      checksumSql(await readMigrationSql('0001_foundation')),
    );
    expect(connection.queries.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS `users`'))).toBe(
      true,
    );
    // The auth migration widens the role enum.
    expect(connection.queries.some((sql) => sql.includes('ALTER TABLE `users`'))).toBe(true);
    expect(connection.queries.some((sql) => sql.includes('RELEASE_LOCK'))).toBe(true);
    expect(connection.released).toBe(true);
  });

  it('does nothing when the database is already up to date', async () => {
    const migrations = await discoverMigrations(MIGRATIONS_DIR);
    const connection = new StubConnection(
      migrations.map((migration) => ({
        id: migration.id,
        checksum: migration.checksum,
        applied_at: '2026-01-01 00:00:00.000',
        execution_ms: 7,
      })),
    );

    const result = await runMigrations({ pool: stubPool(connection), migrationsDir: MIGRATIONS_DIR });

    expect(result.applied).toEqual([]);
    expect(connection.inserts).toHaveLength(0);
    expect(
      connection.queries.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS `users`')),
    ).toBe(false);
  });

  it('refuses to run when history was edited', async () => {
    const connection = new StubConnection([
      { id: '0001_foundation', checksum: 'f'.repeat(64), applied_at: '2026-01-01', execution_ms: 1 },
    ]);

    await expect(
      runMigrations({ pool: stubPool(connection), migrationsDir: MIGRATIONS_DIR }),
    ).rejects.toThrow(/forward-only/);

    expect(connection.released).toBe(true);
  });

  it('dry run reports the plan without touching data', async () => {
    const migrations = await discoverMigrations(MIGRATIONS_DIR);
    const connection = new StubConnection();
    const result = await runMigrations({
      pool: stubPool(connection),
      migrationsDir: MIGRATIONS_DIR,
      dryRun: true,
    });

    expect(result.pending).toEqual(migrations.map((migration) => migration.id));
    expect(result.applied).toEqual([]);
    expect(connection.inserts).toHaveLength(0);
    expect(
      connection.queries.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS `users`')),
    ).toBe(false);
  });

  it('reports the failing statement instead of leaking raw SQL errors', async () => {
    const connection = new StubConnection();
    connection.query = async (sql: string): Promise<[unknown, unknown]> => {
      connection.queries.push(sql);
      if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
      if (sql.includes('FROM schema_migrations')) return [[], []];
      if (sql.includes('CREATE TABLE IF NOT EXISTS `users`')) {
        throw new Error('ER_NO_SUCH_TABLE: internal detail');
      }
      return [[], []];
    };

    await expect(
      runMigrations({ pool: stubPool(connection), migrationsDir: MIGRATIONS_DIR }),
    ).rejects.toThrow(/Migration 0001_foundation failed at statement/);
  });

  it('aborts when another process holds the migration lock', async () => {
    const connection = new StubConnection();
    connection.query = async (sql: string): Promise<[unknown, unknown]> => {
      connection.queries.push(sql);
      if (sql.includes('GET_LOCK')) return [[{ acquired: 0 }], []];
      if (sql.includes('RELEASE_LOCK')) return [[{ released: null }], []];
      return [[], []];
    };

    await expect(
      runMigrations({ pool: stubPool(connection), migrationsDir: MIGRATIONS_DIR }),
    ).rejects.toThrow(/migration lock/);
  });
});
