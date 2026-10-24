import type { Pool } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { checkDatabase, createPool, extractErrorCode } from '../src/db/pool.js';
import { resolveWithinStorage, STORAGE_DIR_MODE } from '../src/storage/private-storage.js';
import { testEnv } from './support/test-env.js';

describe('checkDatabase', () => {
  it('reports success and latency when the pool answers', async () => {
    const pool = { query: async () => [[{ ok: 1 }], []] } as unknown as Pool;

    const result = await checkDatabase(pool, 200);

    expect(result.ok).toBe(true);
    expect(result.code).toBeUndefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a sanitized driver code when the connection fails', async () => {
    const pool = {
      query: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), {
          code: 'ECONNREFUSED',
        });
      },
    } as unknown as Pool;

    const result = await checkDatabase(pool, 200);

    expect(result.ok).toBe(false);
    expect(result.code).toBe('ECONNREFUSED');
    expect(JSON.stringify(result)).not.toContain('127.0.0.1');
  });

  it('times out instead of hanging the readiness endpoint', async () => {
    const pool = { query: () => new Promise(() => {}) } as unknown as Pool;

    const result = await checkDatabase(pool, 25);

    expect(result.ok).toBe(false);
    expect(result.code).toBe('TIMEOUT');
  });
});

describe('extractErrorCode', () => {
  it('keeps a bounded driver code', () => {
    expect(extractErrorCode(Object.assign(new Error('x'), { code: 'ER_ACCESS_DENIED_ERROR' }))).toBe(
      'ER_ACCESS_DENIED_ERROR',
    );
  });

  it('falls back to the error name, then to UNKNOWN', () => {
    expect(extractErrorCode(Object.assign(new Error('x'), { name: 'MysqlError' }))).toBe('MYSQLERROR');
    expect(extractErrorCode(new Error('plain'))).toBe('ERROR');
    expect(extractErrorCode('a string')).toBe('UNKNOWN');
    expect(extractErrorCode(null)).toBe('UNKNOWN');
  });

  it('rejects codes that could smuggle content into logs', () => {
    expect(extractErrorCode({ code: 'bad code with spaces' })).toBe('UNKNOWN');
    expect(extractErrorCode({ code: 'x'.repeat(64) })).toBe('UNKNOWN');
  });
});

describe('private storage helpers', () => {
  it('uses owner-only permissions', () => {
    expect(STORAGE_DIR_MODE).toBe(0o700);
  });

  it('resolves document paths inside the storage root', () => {
    const root = process.platform === 'win32' ? 'C:\\vault\\storage' : '/vault/storage';
    const resolved = resolveWithinStorage(root, 'tenant-1/doc.pdf');

    expect(resolved.endsWith('doc.pdf')).toBe(true);
  });

  it('rejects traversal outside the storage root', () => {
    const root = process.platform === 'win32' ? 'C:\\vault\\storage' : '/vault/storage';

    expect(() => resolveWithinStorage(root, '../secrets.env')).toThrow(/escapes/);
    expect(() => resolveWithinStorage(root, 'tenant/../../secrets.env')).toThrow(/escapes/);
  });

  it('rejects the storage root itself as a document path', () => {
    const root = process.platform === 'win32' ? 'C:\\vault\\storage' : '/vault/storage';

    expect(() => resolveWithinStorage(root, '.')).toThrow(/not the root itself/);
  });
});

describe('SQL query parameter integrity (TiDB/MySQL)', () => {
  it('ensures MySqlDocumentStore generates zero leftover question marks across scopes', async () => {
    const executedQueries: Array<{ sql: string; values: unknown[] }> = [];
    const fakePool = {
      query: async (sql: string, values?: unknown[]) => {
        executedQueries.push({ sql, values: values ?? [] });
        return [[], []];
      },
    } as unknown as Pool;

    const { MySqlDocumentStore } = await import('../src/documents/document-store.js');
    const store = new MySqlDocumentStore(fakePool);
    const mysql = await import('mysql2');

    const scopes = [undefined, 'all', 'mine', 'shared', 'company'] as const;
    const viewers = [
      { id: 'usr-1111', role: 'owner' as const, companyId: 'cmp-9999' },
      { id: 'usr-2222', role: 'owner' as const, companyId: null },
    ];

    for (const viewer of viewers) {
      for (const scope of scopes) {
        executedQueries.length = 0;
        await store.list(viewer, {
          sort: { field: 'created_at', order: 'desc' },
          limit: 10,
          offset: 0,
          scope,
          search: 'quarterly report',
        });

        expect(executedQueries.length).toBe(2); // rows query + countRows query
        for (const { sql, values } of executedQueries) {
          const formatted = (mysql as any).format(sql, values);
          expect(formatted).not.toContain('?');
        }
      }

      // Test findAccessible
      executedQueries.length = 0;
      await store.findAccessible('doc-3333', viewer);
      expect(executedQueries.length).toBe(1);
      const formatted = (mysql as any).format(executedQueries[0]!.sql, executedQueries[0]!.values);
      expect(formatted).not.toContain('?');
    }
  });

  it('ensures MySqlDocumentActivityStore.stats generates valid parameter bindings for TiDB', async () => {
    const executedQueries: Array<{ sql: string; values: unknown[] }> = [];
    const fakePool = {
      execute: async (sql: string, values?: unknown[]) => {
        executedQueries.push({ sql, values: values ?? [] });
        return [[], []];
      },
    } as unknown as Pool;

    const { MySqlDocumentActivityStore } = await import('../src/documents/activity-store.js');
    const store = new MySqlDocumentActivityStore(fakePool);
    const mysql = await import('mysql2');

    const viewers = [
      { id: 'usr-1111', role: 'owner' as const, companyId: 'cmp-9999' },
      { id: 'usr-2222', role: 'owner' as const, companyId: null },
    ];

    for (const viewer of viewers) {
      executedQueries.length = 0;
      await store.stats(viewer);
      expect(executedQueries.length).toBe(2); // totals + byCategory
      for (const { sql, values } of executedQueries) {
        const formatted = (mysql as any).format(sql, values);
        expect(formatted).not.toContain('?');
      }
    }
  });
});

describe('createPool connection event and promise handling', () => {
  it('safely handles core mysql2 connection events without throwing non-promise query errors', async () => {
    const env = testEnv();
    const pool = createPool(env);

    try {
      let promiseQueryCalled = false;
      let promiseQuerySql = '';

      // Simulate the exact core mysql2 connection structure passed by inheritEvents
      const mockCoreConnection = {
        promise: () => ({
          query: async (sql: string) => {
            promiseQueryCalled = true;
            promiseQuerySql = sql;
            return [[], []];
          },
        }),
        query: () => {
          // If the listener mistakenly calls .catch() or .then() on this, it throws
          return {
            then() {
              throw new Error(
                'You have tried to call .then(), .catch(), or invoked await on the result of query that is not a promise',
              );
            },
            catch() {
              throw new Error(
                'You have tried to call .then(), .catch(), or invoked await on the result of query that is not a promise',
              );
            },
          };
        },
      };

      // Emit 'connection' on the pool as mysql2 does upon opening a socket
      expect(() => {
        (pool as any).emit('connection', mockCoreConnection);
      }).not.toThrow();

      expect(promiseQueryCalled).toBe(true);
      expect(promiseQuerySql).toBe("SET time_zone = '+00:00'");
    } finally {
      await pool.end().catch(() => {});
    }
  });

  it('safely handles callback connections and rejects gracefully without uncaught exceptions', async () => {
    const env = testEnv();
    const pool = createPool(env);

    try {
      let callbackQueryCalled = false;
      let callbackQuerySql = '';

      const mockCallbackConnection = {
        query: (sql: string, callback?: (err: unknown) => void) => {
          callbackQueryCalled = true;
          callbackQuerySql = sql;
          if (callback) callback(null);
        },
      };

      expect(() => {
        (pool as any).emit('connection', mockCallbackConnection);
      }).not.toThrow();

      expect(callbackQueryCalled).toBe(true);
      expect(callbackQuerySql).toBe("SET time_zone = '+00:00'");

      // Also verify rejecting promise doesn't throw uncaught exception
      const mockFailingConnection = {
        promise: () => ({
          query: async () => {
            throw new Error('Connection lost');
          },
        }),
      };

      expect(() => {
        (pool as any).emit('connection', mockFailingConnection);
      }).not.toThrow();
    } finally {
      await pool.end().catch(() => {});
    }
  });
});

