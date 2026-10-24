import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { DatabaseHealthResult } from '../src/db/pool.js';
import { testEnv, testLogger } from './support/test-env.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildApp(result: DatabaseHealthResult = { ok: true, latencyMs: 3.2 }) {
  const env = testEnv();
  const pingDatabase = vi.fn(async () => result);

  return { app: createApp({ env, logger: testLogger(env), pingDatabase }), pingDatabase };
}

describe('GET /api/health (liveness)', () => {
  it('reports service metadata without touching the database', async () => {
    const { app, pingDatabase } = buildApp();

    const response = await request(app).get('/api/health').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'trustvault-api',
      version: '0.1.0',
      environment: 'test',
    });
    expect(typeof response.body.uptimeSeconds).toBe('number');
    expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
    expect(pingDatabase).not.toHaveBeenCalled();
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns the same request id in the header and the body', async () => {
    const { app } = buildApp();

    const response = await request(app).get('/api/health').expect(200);

    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    expect(response.body.requestId).toMatch(UUID_PATTERN);
  });

  it('echoes a well-formed inbound request id for log correlation', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .get('/api/health')
      .set('X-Request-Id', 'checkout-abc-123')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('checkout-abc-123');
    expect(response.body.requestId).toBe('checkout-abc-123');
  });

  it('replaces a hostile inbound request id instead of reflecting it', async () => {
    const { app } = buildApp();

    const response = await request(app)
      .get('/api/health')
      .set('X-Request-Id', 'short')
      .expect(200);

    expect(response.body.requestId).not.toBe('short');
    expect(response.body.requestId).toMatch(UUID_PATTERN);
  });
});

describe('GET /api/health/database (readiness)', () => {
  it('returns 200 and latency when MySQL answers', async () => {
    const { app, pingDatabase } = buildApp({ ok: true, latencyMs: 2.7 });

    const response = await request(app).get('/api/health/database').expect(200);

    expect(pingDatabase).toHaveBeenCalledTimes(1);
    expect(response.body).toMatchObject({
      status: 'ok',
      check: 'database',
      database: { status: 'up', latencyMs: 2.7 },
    });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('returns 503 with a sanitized error code when MySQL is unreachable', async () => {
    const { app } = buildApp({ ok: false, latencyMs: 2001, code: 'ECONNREFUSED' });

    const response = await request(app).get('/api/health/database').expect(503);

    expect(response.body).toMatchObject({
      status: 'error',
      database: { status: 'down', latencyMs: 2001, code: 'ECONNREFUSED' },
    });
    expect(JSON.stringify(response.body)).not.toContain('password');
  });

  it('returns 503 instead of crashing if the probe throws', async () => {
    const env = testEnv();
    const app = createApp({
      env,
      logger: testLogger(env),
      pingDatabase: async () => {
        throw new Error('driver exploded');
      },
    });

    const response = await request(app).get('/api/health/database').expect(503);

    expect(response.body.database.status).toBe('down');
    expect(JSON.stringify(response.body)).not.toContain('driver exploded');
  });

  it('exposes /api/health/db as a short alias', async () => {
    const { app } = buildApp();

    const response = await request(app).get('/api/health/db').expect(200);

    expect(response.body.check).toBe('database');
  });
});

describe('GET /', () => {
  it('returns a JSON service index', async () => {
    const { app } = buildApp();

    const response = await request(app).get('/').expect(200);

    expect(response.body).toEqual({
      service: 'trustvault-api',
      version: '0.1.0',
      health: '/api/health',
      databaseHealth: '/api/health/database',
      authentication: '/api/auth/login',
      documents: '/api/documents',
      admin: '/api/admin/overview',
    });
  });
});
