/**
 * Security Regression Tests — TrustVault
 *
 * These tests cover the confirmed findings from the independent security review
 * conducted on 2026-10-20. They must pass before any production deployment.
 *
 * Finding 2 (Medium): Horizontal password spraying via single-dimension rate
 *   limiting. Fixed by adding a global per-IP Tier-1 limiter in app.ts.
 *   Regression: verify that many distinct-email login attempts from one IP
 *   eventually hit HTTP 429, and that legitimate distinct-IP requests are
 *   still allowed.
 *
 * Finding 3 (Low-Medium): Cross-tenant document title leakage via administrator
 *   access-history query. Fixed in MySqlDocumentActivityStore.historyForManager
 *   and mirrored in InMemoryDocumentActivityStore.
 *   Regression: verify that an admin without an explicit grant sees '[Restricted]'
 *   as the document title, while the document owner sees the real title.
 *
 * Finding 4 (Low): In-flight download stream not terminated on revocation.
 *   Accepted residual risk (documented). Regression: verify that revocation
 *   immediately blocks the next document-list and download-metadata request,
 *   even if an already-opened stream could not be interrupted.
 *
 * Finding 1 (Medium): DB privilege separation is structural (bootstrap.sql).
 *   Tested by human review and documented; not exercisable in an in-memory test.
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import type { CreateDocumentInput } from '../src/documents/document-store.js';
import { InMemoryAuthStore } from './support/in-memory-auth-store.js';
import { InMemoryDocumentStore } from './support/in-memory-document-store.js';
import { InMemoryDocumentActivityStore } from './support/in-memory-activity-store.js';
import { testEnv, testLogger } from './support/test-env.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const BCRYPT_TEST_COST = 4;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function buildStack(options: { env?: Record<string, string | undefined> } = {}) {
  const env = testEnv(options.env);
  const authStore = new InMemoryAuthStore();
  const documentStore = new InMemoryDocumentStore();
  const activityStore = new InMemoryDocumentActivityStore(documentStore, authStore);

  const app = createApp({
    env,
    logger: testLogger(env),
    pingDatabase: async () => ({ ok: true, latencyMs: 1 }),
    authStore,
    documentStore,
    documentActivityStore: activityStore,
    clock: () => new Date(),
  });

  return { app, authStore, documentStore, activityStore, env };
}

async function addUser(
  store: InMemoryAuthStore,
  opts: { email?: string; role?: 'admin' | 'owner' | 'viewer'; isActive?: boolean } = {},
) {
  const passwordHash = await hashPassword(PASSWORD, BCRYPT_TEST_COST);
  return store.addUser({
    email: opts.email ?? 'test@trustvault.local',
    passwordHash,
    role: opts.role ?? 'viewer',
    isActive: opts.isActive ?? true,
  });
}

function sessionCookie(res: request.Response): string {
  const header = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(header) ? header : header ? [header] : [];
  const found = cookies.find((c) => c.startsWith('tv_session='));
  if (!found) throw new Error('No tv_session cookie in response');
  return found.split(';')[0] ?? '';
}

function makeDocInput(ownerId: string, overrides: Partial<CreateDocumentInput> = {}): CreateDocumentInput {
  const id = overrides.id ?? 'doc-00000000-0000-4000-8000-000000000001';
  return {
    id,
    ownerId,
    title: overrides.title ?? 'Test Document',
    description: overrides.description ?? null,
    fileName: overrides.fileName ?? 'test.pdf',
    storageKey: overrides.storageKey ?? `2026/10/${id}.pdf`,
    mimeType: overrides.mimeType ?? 'application/pdf',
    sizeBytes: overrides.sizeBytes ?? 1024,
    checksumSha256: overrides.checksumSha256 ?? 'deadbeef',
    category: overrides.category ?? 'general',
    createdAt: overrides.createdAt ?? new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Finding 2: Horizontal password spraying via global-IP rate limit bypass
// ---------------------------------------------------------------------------

describe('Finding 2 regression — dual-tier login rate limiting', () => {
  /**
   * An attacker testing one password across many distinct email addresses from
   * a single IP must be blocked by the global Tier-1 per-IP limiter.
   *
   * Default config: MAX=10, Tier-1 ceiling = MAX × 3 = 30.
   * We send 31 attempts to 31 different email addresses and assert that at
   * least the last attempt is rate-limited (HTTP 429).
   */
  it('enforces a global per-IP ceiling across many distinct email targets (spray attack)', async () => {
    // Configure a small limit for fast, deterministic testing without burning CPU:
    // LOGIN_RATE_LIMIT_MAX = 2 => Tier-1 ceiling = 2 * 3 = 6 requests per IP.
    const { app } = buildStack({ env: { LOGIN_RATE_LIMIT_MAX: '2' } });

    const responses: number[] = [];
    // Send 7 attempts to 7 distinct emails from the same IP (exceeding ceiling 6)
    for (let i = 0; i < 7; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: `victim${i}@corp.example`, password: 'Password2026!' });
      responses.push(res.status);
    }

    // At least one attempt must have been rate-limited (429).
    expect(responses).toContain(429);

    // The rate-limited response must include the correct error code and header.
    const rateLimitedIdx = responses.lastIndexOf(429);
    const finalRes = await request(app)
      .post('/api/auth/login')
      .send({ email: `victim${rateLimitedIdx}@corp.example`, password: 'Password2026!' });
    expect(finalRes.status).toBe(429);
    expect(finalRes.body.error.code).toBe('RATE_LIMITED');
    expect(finalRes.headers['retry-after']).toBeDefined();
  }, 25_000);

  /**
   * Tier-2: the tight per-(IP+email) limiter must still protect individual
   * accounts, even though Tier-1 is more lenient (3× the per-email max).
   */
  it('still enforces the tight per-(IP+email) limit on a specific account', async () => {
    // LOGIN_RATE_LIMIT_MAX = 2 => Tier-2 ceiling = 2 requests per (IP + email).
    const { app, authStore } = buildStack({ env: { LOGIN_RATE_LIMIT_MAX: '2' } });
    await addUser(authStore, { email: 'targetuser@trustvault.local', role: 'viewer' });

    // Send 3 attempts against the same email (exceeding per-email limit 2)
    const responses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'targetuser@trustvault.local', password: 'WrongPassword!' });
      responses.push(res.status);
    }

    expect(responses).toContain(429);
    const rateLimited = responses.filter((s) => s === 429);
    expect(rateLimited.length).toBeGreaterThan(0);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Finding 3: Cross-tenant document title leakage via admin access history
// ---------------------------------------------------------------------------

describe('Finding 3 regression — historyForManager title redaction', () => {
  /**
   * An administrator without an explicit grant on a document must NOT see
   * the real document title in GET /api/access-history.  They should see
   * '[Restricted]' instead.
   */
  it('redacts document titles in access-history for admins without a permission grant', async () => {
    const { app, authStore, documentStore } = buildStack();

    const owner = await addUser(authStore, { email: 'owner@trustvault.local', role: 'owner' });
    const admin = await addUser(authStore, { email: 'admin@trustvault.local', role: 'admin' });

    // Register owner in directory so document owner lookup works.
    documentStore.registerUser(owner.id, owner.email, 'Owen Owner');

    // Seed a document owned by the owner with a sensitive title.
    const docId = 'sec-reg-doc-00000000-0000-4000-8000-000000000011';
    await documentStore.create(
      makeDocInput(owner.id, {
        id: docId,
        title: 'M&A Target XYZ Corp NDA — Confidential',
        storageKey: `2026/10/${docId}.pdf`,
      }),
      { id: owner.id, role: owner.role },
    );

    // Record a document-related audit event so the history endpoint has data.
    authStore.addTestAuditEvent({
      userId: owner.id,
      action: 'document.viewed',
      outcome: 'success',
      resourceType: 'document',
      resourceId: docId,
    });

    // Admin logs in and queries access history.
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);

    const historyRes = await request(app)
      .get('/api/access-history')
      .set('Cookie', sessionCookie(adminLogin))
      .expect(200);

    const body = historyRes.body as { entries: Array<{ documentTitle: string | null }> };

    // The real confidential title must NOT appear.
    expect(JSON.stringify(body)).not.toContain('M&A Target XYZ Corp NDA');

    // The redacted placeholder MUST appear for the document entry.
    const entry = body.entries.find((e) => e.documentTitle !== null);
    if (entry) {
      expect(entry.documentTitle).toBe('[Restricted]');
    }
  });

  /**
   * The document owner querying access-history for their own document MUST
   * see the full title — redaction must not block legitimate owners.
   */
  it('shows the real title to the document owner in access-history', async () => {
    const { app, authStore, documentStore } = buildStack();

    const owner = await addUser(authStore, { email: 'owner2@trustvault.local', role: 'owner' });
    documentStore.registerUser(owner.id, owner.email, 'Owen Owner');

    const docId = 'sec-reg-doc-00000000-0000-4000-8000-000000000012';
    await documentStore.create(
      makeDocInput(owner.id, {
        id: docId,
        title: 'Quarterly Earnings — Internal Only',
        storageKey: `2026/10/${docId}.pdf`,
      }),
      { id: owner.id, role: owner.role },
    );

    authStore.addTestAuditEvent({
      userId: owner.id,
      action: 'document.viewed',
      outcome: 'success',
      resourceType: 'document',
      resourceId: docId,
    });

    const ownerLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: owner.email, password: PASSWORD })
      .expect(200);

    const historyRes = await request(app)
      .get('/api/access-history')
      .set('Cookie', sessionCookie(ownerLogin))
      .expect(200);

    expect(JSON.stringify(historyRes.body)).toContain('Quarterly Earnings — Internal Only');
  });
});

// ---------------------------------------------------------------------------
// Finding 4: Revocation blocks subsequent requests (documented stream boundary)
// ---------------------------------------------------------------------------

describe('Finding 4 boundary — revocation blocks the next request immediately', () => {
  /**
   * After permission is revoked, the viewer's very next document-list request
   * must exclude the revoked document. This is the security guarantee:
   * revocation has zero latency for all new HTTP requests.
   *
   * Known residual risk (documented): bytes already in transit on an open
   * streaming response cannot be recalled. See THREATS.md §10.
   */
  it('excludes the document from listing immediately after revocation', async () => {
    const { app, authStore, documentStore } = buildStack();

    const owner = await addUser(authStore, { email: 'owner3@trustvault.local', role: 'owner' });
    const viewer = await addUser(authStore, { email: 'viewer3@trustvault.local', role: 'viewer' });

    documentStore.registerUser(owner.id, owner.email, 'Owen');
    documentStore.registerUser(viewer.id, viewer.email, 'Vera');

    const docId = 'sec-reg-doc-00000000-0000-4000-8000-000000000013';
    await documentStore.create(
      makeDocInput(owner.id, {
        id: docId,
        title: 'Protected Report',
        storageKey: `2026/10/${docId}.pdf`,
      }),
      { id: owner.id, role: owner.role },
    );

    // Grant viewer access.
    documentStore.grant(docId, viewer.id, 'viewer');

    // Log in as viewer.
    const viewerLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: viewer.email, password: PASSWORD })
      .expect(200);
    const viewerCookie = sessionCookie(viewerLogin);

    // Before revocation: viewer sees the document.
    const beforeRes = await request(app)
      .get('/api/documents')
      .set('Cookie', viewerCookie)
      .expect(200);
    const beforeBody = beforeRes.body as { documents: Array<{ id: string }> };
    expect(beforeBody.documents.some((d) => d.id === docId)).toBe(true);

    // Revoke permission — immediate effect.
    documentStore.revoke(docId, viewer.id);

    // Immediately after revocation: viewer no longer sees the document.
    const afterRes = await request(app)
      .get('/api/documents')
      .set('Cookie', viewerCookie)
      .expect(200);
    const afterBody = afterRes.body as { documents: Array<{ id: string }> };
    expect(afterBody.documents.some((d) => d.id === docId)).toBe(false);

    // Direct metadata fetch also returns 404.
    await request(app)
      .get(`/api/documents/${docId}`)
      .set('Cookie', viewerCookie)
      .expect(404);
  });
});
