import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { InMemoryAuthStore } from './support/in-memory-auth-store.js';
import { InMemoryDocumentStore } from './support/in-memory-document-store.js';
import { InMemoryDocumentActivityStore } from './support/in-memory-activity-store.js';
import { STRONG_SECRET, testEnv, testLogger } from './support/test-env.js';
import type { DocumentStorage } from '../src/documents/storage.js';

function sessionCookie(response: request.Response): string {
  const header = response.headers['set-cookie'] as string | string[] | undefined;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) throw new Error('Expected a Set-Cookie header');
  return raw.split(';')[0] ?? '';
}

function buildStack() {
  const env = testEnv({
    SESSION_SECRET: STRONG_SECRET,
    NODE_ENV: 'test',
  });
  const authStore = new InMemoryAuthStore();
  const documentStore = new InMemoryDocumentStore();
  const activityStore = new InMemoryDocumentActivityStore(documentStore, authStore);

  const fakeStorage: DocumentStorage = {
    save: async () => ({ storageKey: 'test/key-123', sizeBytes: 1024 }),
    open: async () => null,
    remove: async () => {},
  };

  const app = createApp({
    env,
    logger: testLogger(env),
    pingDatabase: async () => ({ ok: true, latencyMs: 1 }),
    authStore,
    documentStore,
    documentActivityStore: activityStore,
    documentStorage: fakeStorage,
  });

  return { app, authStore, documentStore };
}

describe('Company Registration and Multi-Tenant Isolation', () => {
  it('registers a new company workspace and owner account successfully', async () => {
    const { app, authStore } = buildStack();

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice Founder',
        email: 'alice@acme.example',
        companyName: 'Acme Corp',
        password: 'SuperSecretPassword123!',
      })
      .expect(201);

    expect(response.body.user).toMatchObject({
      email: 'alice@acme.example',
      displayName: 'Alice Founder',
      role: 'owner',
      isActive: true,
      companyName: 'Acme Corp',
    });
    expect(response.body.user.companyId).toBeDefined();
    expect(response.body.session.csrfToken).toBeDefined();

    // Verify session cookie was set
    expect(sessionCookie(response)).toMatch(/tv_session=[^;]+/);

    // Verify company was created in store
    const company = await authStore.findCompanyById(response.body.user.companyId);
    expect(company).toBeDefined();
    expect(company?.name).toBe('Acme Corp');
  });

  it('rejects duplicate email registrations with a friendly 409 Conflict', async () => {
    const { app } = buildStack();

    // Register first user
    await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice Founder',
        email: 'alice@acme.example',
        companyName: 'Acme Corp',
        password: 'SuperSecretPassword123!',
      })
      .expect(201);

    // Attempt second registration with same email
    const duplicateRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice Imposter',
        email: 'ALICE@ACME.EXAMPLE', // Case-insensitive duplicate
        companyName: 'Another Corp',
        password: 'SuperSecretPassword123!',
      })
      .expect(409);

    expect(duplicateRes.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(duplicateRes.body.error.message).toContain('already exists');
    // Ensure no SQL or DB internals are leaked
    expect(duplicateRes.text).not.toContain('Duplicate entry');
    expect(duplicateRes.text).not.toContain('uq_users_email');
  });

  it('rejects weak passwords (< 12 characters)', async () => {
    const { app } = buildStack();

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Bob Weak',
        email: 'bob@example.com',
        companyName: 'Bob Corp',
        password: 'short',
      })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('strips any role or admin parameter in body to prevent privilege escalation', async () => {
    const { app } = buildStack();

    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Hacker Joe',
        email: 'hacker@example.com',
        companyName: 'Hackers Inc',
        password: 'StrongPassword123!',
        role: 'admin', // Malicious attempt to escalate to platform admin
      })
      .expect(201);

    // Must be assigned 'owner' of their company, NOT platform admin
    expect(response.body.user.role).toBe('owner');
  });

  it('enforces multi-tenant company isolation on documents', async () => {
    const { app, documentStore } = buildStack();

    // 1. Register Company A
    const resA = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice A',
        email: 'alice@companya.example',
        companyName: 'Company A',
        password: 'Password123456!',
      })
      .expect(201);
    const cookieA = sessionCookie(resA);
    const userA = resA.body.user;

    // 2. Register Company B
    const resB = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Bob B',
        email: 'bob@companyb.example',
        companyName: 'Company B',
        password: 'Password123456!',
      })
      .expect(201);
    const cookieB = sessionCookie(resB);

    // 3. User A creates a document in Company A
    const doc = await documentStore.create({
      id: 'a0000000-0000-4000-a000-000000000001',
      ownerId: userA.id,
      companyId: userA.companyId,
      title: 'Company A Confidential Strategy',
      description: 'Secret plans',
      fileName: 'strategy.pdf',
      storageKey: '2026/10/a0000000-0000-4000-a000-000000000001.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      checksumSha256: null,
      category: 'report',
      createdAt: new Date(),
    }, { id: userA.id, role: 'owner', companyId: userA.companyId });

    // 4. User A can see it in their document list
    const listA = await request(app)
      .get('/api/documents')
      .set('Cookie', cookieA)
      .expect(200);
    expect(listA.body.documents.some((d: any) => d.id === doc.id)).toBe(true);

    // 5. User B CANNOT see Company A's document in their list
    const listB = await request(app)
      .get('/api/documents')
      .set('Cookie', cookieB)
      .expect(200);
    expect(listB.body.documents.some((d: any) => d.id === doc.id)).toBe(false);

    // 6. User B attempting direct access returns 404 (IDOR protection across tenants)
    await request(app)
      .get(`/api/documents/${doc.id}`)
      .set('Cookie', cookieB)
      .expect(404);

    // 7. Explicit cross-company sharing: User A can explicitly grant access to User B
    const csrfA = resA.body.session.csrfToken;
    const shareRes = await request(app)
      .post(`/api/documents/${doc.id}/permissions`)
      .set('Cookie', cookieA)
      .set('X-CSRF-Token', csrfA)
      .send({ email: 'bob@companyb.example', role: 'viewer' })
      .expect(200);
    expect(shareRes.body.permissions.some((p: any) => p.email === 'bob@companyb.example')).toBe(true);

    // 8. User B now sees the shared document and can access it
    const directAccessRes = await request(app)
      .get(`/api/documents/${doc.id}`)
      .set('Cookie', cookieB)
      .expect(200);
    expect(directAccessRes.body.document.id).toBe(doc.id);

    // 9. When User A revokes access, User B immediately loses access (404)
    await request(app)
      .delete(`/api/documents/${doc.id}/permissions/${resB.body.user.id}`)
      .set('Cookie', cookieA)
      .set('X-CSRF-Token', csrfA)
      .expect(200);

    await request(app)
      .get(`/api/documents/${doc.id}`)
      .set('Cookie', cookieB)
      .expect(404);
  });
});
