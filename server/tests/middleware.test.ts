import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { AppError } from '../src/http/errors.js';
import { createErrorHandler } from '../src/http/middleware/error-handler.js';
import { STRONG_SECRET, testEnv, testLogger } from './support/test-env.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';

function buildApp() {
  const env = testEnv();
  return createApp({
    env,
    logger: testLogger(env),
    pingDatabase: async () => ({ ok: true, latencyMs: 1 }),
  });
}

/** Minimal app that exercises the central error handler directly. */
function buildErrorApp(env = testEnv()) {
  const app = express();

  app.get('/boom', () => {
    throw new Error('kaboom: internal detail with password=hunter2');
  });

  app.get('/teapot', () => {
    throw new AppError({ statusCode: 418, code: 'TEAPOT', message: 'I am a teapot' });
  });

  app.get('/hidden', () => {
    throw new AppError({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'the database password is hunter2',
    });
  });

  app.get('/zod', () => {
    const result = z.object({ email: z.string().min(5) }).safeParse({ email: 'x' });
    if (!result.success) throw result.error;
    throw new Error('unreachable');
  });

  app.use(createErrorHandler({ env, logger: testLogger(env) }));
  return app;
}

describe('unknown routes', () => {
  it('returns a structured 404 with a request id', async () => {
    const response = await request(buildApp()).get('/api/does-not-exist').expect(404);

    expect(response.body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('/api/does-not-exist'),
    });
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });
});

describe('security headers (helmet)', () => {
  it('sets baseline headers and hides the framework', async () => {
    const response = await request(buildApp()).get('/api/health').expect(200);

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['cross-origin-resource-policy']).toBe('same-site');
    // HSTS is production-only; it must not be advertised over local HTTP.
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });
});

describe('CORS allow-list', () => {
  it('allows a configured origin with credentials', async () => {
    const response = await request(buildApp())
      .get('/api/health')
      .set('Origin', ALLOWED_ORIGIN)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers.vary).toContain('Origin');
  });

  it('answers preflight requests for an allowed origin', async () => {
    const response = await request(buildApp())
      .options('/api/health')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-methods']).toContain('GET');
  });

  it('answers preflight requests for Render and GitHub Pages origins', async () => {
    const renderOrigin = 'https://trustvault-app.onrender.com';
    const renderResponse = await request(buildApp())
      .options('/api/health')
      .set('Origin', renderOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);

    expect(renderResponse.headers['access-control-allow-origin']).toBe(renderOrigin);
    expect(renderResponse.headers['access-control-allow-credentials']).toBe('true');

    const ghOrigin = 'https://trustvault-preview.github.io';
    const ghResponse = await request(buildApp())
      .options('/api/health')
      .set('Origin', ghOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);

    expect(ghResponse.headers['access-control-allow-origin']).toBe(ghOrigin);
  });

  it('answers preflight requests for /api/auth/login and /api/auth/me from Render frontend', async () => {
    const renderOrigin = 'https://trustvault-app.onrender.com';
    const loginResponse = await request(buildApp())
      .options('/api/auth/login')
      .set('Origin', renderOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type, x-csrf-token')
      .expect(204);

    expect(loginResponse.headers['access-control-allow-origin']).toBe(renderOrigin);
    expect(loginResponse.headers['access-control-allow-credentials']).toBe('true');
    expect(loginResponse.headers['access-control-allow-methods']).toContain('POST');

    const meResponse = await request(buildApp())
      .options('/api/auth/me')
      .set('Origin', renderOrigin)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);

    expect(meResponse.headers['access-control-allow-origin']).toBe(renderOrigin);
    expect(meResponse.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects an unlisted origin with a typed 403', async () => {
    const response = await request(buildApp())
      .get('/api/health')
      .set('Origin', 'https://attacker.example')
      .expect(403);

    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects an untrusted foreign render service with a typed 403', async () => {
    const response = await request(buildApp())
      .get('/api/health')
      .set('Origin', 'https://evil-hacker.onrender.com')
      .expect(403);

    expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows the deployed TrustVault frontend on Render (trustvault-app-1i2l.onrender.com)', async () => {
    const deployedOrigin = 'https://trustvault-app-1i2l.onrender.com';
    const response = await request(buildApp())
      .options('/api/documents')
      .set('Origin', deployedOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type, x-csrf-token')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(deployedOrigin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('body parsing limits', () => {
  it('rejects oversized JSON bodies with 413', async () => {
    const response = await request(buildApp())
      .post('/api/health')
      .send({ payload: 'x'.repeat(100_000) })
      .expect(413);

    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await request(buildApp())
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":')
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_JSON');
  });
});

describe('central error handler', () => {
  it('exposes AppError messages for 4xx responses', async () => {
    const response = await request(buildErrorApp()).get('/teapot').expect(418);

    expect(response.body.error).toMatchObject({ code: 'TEAPOT', message: 'I am a teapot' });
  });

  it('hides the message of a 5xx AppError even outside production', async () => {
    const response = await request(buildErrorApp()).get('/hidden').expect(500);

    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });

  it('returns the real message for unexpected errors in development', async () => {
    const response = await request(buildErrorApp()).get('/boom').expect(500);

    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).toContain('kaboom');
  });

  it('never leaks internals in production', async () => {
    const productionEnv = testEnv({
      NODE_ENV: 'production',
      CLIENT_ORIGINS: 'https://trustvault.app',
      DATABASE_PASSWORD: 'an-actual-production-password',
      SESSION_SECRET: STRONG_SECRET,
      LOG_LEVEL: 'silent',
    });

    const response = await request(buildErrorApp(productionEnv)).get('/boom').expect(500);

    expect(response.body.error.message).not.toContain('kaboom');
    expect(response.body.error.message).not.toContain('hunter2');
    expect(response.body.error.details).toBeUndefined();
  });

  it('maps ZodError to 422 with field details', async () => {
    const response = await request(buildErrorApp()).get('/zod').expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual([
      { path: 'email', message: expect.any(String) },
    ]);
  });
});
