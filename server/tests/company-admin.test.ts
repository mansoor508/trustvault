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
    save: async () => ({ storageKey: 'test/storage-key-1', sizeBytes: 1024 }),
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

  return { app, authStore, documentStore, activityStore };
}

describe('Company Administration Dashboard & Multi-Tenant Security Boundaries', () => {
  it('allows Company Owner and Company Admin to retrieve company details, metrics, employee directory, and activity', async () => {
    const { app } = buildStack();

    // 1. Register Company A with Owner A
    const regOwnerRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice Owner',
        email: 'alice@acme.example',
        companyName: 'Acme Corporation',
        password: 'Password123!',
      })
      .expect(201);
    const ownerCookie = sessionCookie(regOwnerRes);
    const ownerCsrf = regOwnerRes.body.session.csrfToken;
    const companyId = regOwnerRes.body.user.companyId;

    // 2. Owner invites a Company Admin and a Viewer
    const inviteAdminRes = await request(app)
      .post('/api/workspace/invitations')
      .set('Cookie', ownerCookie)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ email: 'bob.admin@acme.example', role: 'admin' })
      .expect(201);
    const adminInviteToken = inviteAdminRes.body.invitation.token;

    const inviteViewerRes = await request(app)
      .post('/api/workspace/invitations')
      .set('Cookie', ownerCookie)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ email: 'carol.viewer@acme.example', role: 'viewer' })
      .expect(201);

    // 3. Bob accepts invite to become Company Admin
    const regBobRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Bob Admin',
        email: 'bob.admin@acme.example',
        password: 'Password123!',
        inviteToken: adminInviteToken,
      })
      .expect(201);
    const adminCookie = sessionCookie(regBobRes);

    // 4. Bob (Company Admin) accesses GET /api/workspace/company-admin
    const overviewRes = await request(app)
      .get('/api/workspace/company-admin')
      .set('Cookie', adminCookie)
      .expect(200);

    const body = overviewRes.body;

    // Company details
    expect(body.company).toBeDefined();
    expect(body.company.id).toBe(companyId);
    expect(body.company.name).toBe('Acme Corporation');
    expect(body.company.createdAt).toBeDefined();

    // Key metrics
    expect(body.metrics).toBeDefined();
    expect(body.metrics.totalEmployees).toBe(2); // Alice + Bob
    expect(body.metrics.ownerCount).toBe(1); // Alice
    expect(body.metrics.adminCount).toBe(1); // Bob
    expect(body.metrics.activeEmployees).toBe(2);
    expect(body.metrics.pendingInvitationsCount).toBe(1); // Carol is pending

    // Employee directory
    expect(Array.isArray(body.employees)).toBe(true);
    expect(body.employees).toHaveLength(2);
    const alice = body.employees.find((e: any) => e.email === 'alice@acme.example');
    expect(alice).toBeDefined();
    expect(alice.displayName).toBe('Alice Owner');
    expect(alice.role).toBe('owner');
    expect(alice.isActive).toBe(true);
    expect(alice.createdAt).toBeDefined();

    const bob = body.employees.find((e: any) => e.email === 'bob.admin@acme.example');
    expect(bob).toBeDefined();
    expect(bob.displayName).toBe('Bob Admin');
    expect(bob.role).toBe('admin');
    expect(bob.isActive).toBe(true);
    expect(bob.createdAt).toBeDefined();

    // Recent company activity
    expect(Array.isArray(body.recentActivity)).toBe(true);
    expect(body.recentActivity.length).toBeGreaterThanOrEqual(1);
    const inviteEvent = body.recentActivity.find((a: any) => a.action === 'company.member_invited');
    expect(inviteEvent).toBeDefined();
    expect(inviteEvent.outcome).toBe('success');

    // 5. Also verify GET /api/company-admin alias returns the identical data
    const aliasRes = await request(app)
      .get('/api/company-admin')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(aliasRes.body.company.id).toBe(companyId);
    expect(aliasRes.body.metrics.totalEmployees).toBe(2);
  });

  it('strictly enforces multi-tenant isolation: Company A Admin never sees Company B data', async () => {
    const { app } = buildStack();

    // 1. Company A
    const regARes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice A',
        email: 'alice@companya.example',
        companyName: 'Company A Corp',
        password: 'Password123!',
      })
      .expect(201);
    const companyAId = regARes.body.user.companyId;
    const cookieA = sessionCookie(regARes);

    // 2. Company B
    const regBRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Bob B',
        email: 'bob@companyb.example',
        companyName: 'Company B Inc',
        password: 'Password123!',
      })
      .expect(201);
    const companyBId = regBRes.body.user.companyId;
    const cookieB = sessionCookie(regBRes);
    const csrfB = regBRes.body.session.csrfToken;

    // Company B invites someone
    await request(app)
      .post('/api/workspace/invitations')
      .set('Cookie', cookieB)
      .set('X-CSRF-Token', csrfB)
      .send({ email: 'secret.employee@companyb.example', role: 'editor' })
      .expect(201);

    // 3. Company A queries company admin
    const aOverview = await request(app)
      .get('/api/workspace/company-admin')
      .set('Cookie', cookieA)
      .expect(200);

    expect(aOverview.body.company.id).toBe(companyAId);
    expect(aOverview.body.company.name).toBe('Company A Corp');
    expect(aOverview.body.metrics.totalEmployees).toBe(1);
    expect(aOverview.body.metrics.pendingInvitationsCount).toBe(0);

    // Verify Bob from Company B is NOT in Company A employees
    const bFoundInA = aOverview.body.employees.some((e: any) => e.email.includes('companyb.example'));
    expect(bFoundInA).toBe(false);

    // Verify Company B's invitation activity is NOT in Company A's recentActivity
    const bActivityInA = aOverview.body.recentActivity.some(
      (act: any) => act.metadata?.targetEmail?.includes('companyb.example'),
    );
    expect(bActivityInA).toBe(false);

    // 4. IDOR attempt: Company A tries to pass companyBId in query/body
    const idorRes = await request(app)
      .get(`/api/workspace/company-admin?companyId=${companyBId}`)
      .set('Cookie', cookieA)
      .expect(200);

    // Server MUST use authenticated session's companyId, ignoring client query parameter
    expect(idorRes.body.company.id).toBe(companyAId);
    expect(idorRes.body.company.name).toBe('Company A Corp');
  });

  it('rejects non-admin company members (editors, viewers) and unauthenticated callers with 401/403', async () => {
    const { app } = buildStack();

    // 1. Unauthenticated request
    await request(app)
      .get('/api/workspace/company-admin')
      .expect(401);

    // 2. Register company and add a viewer
    const regOwnerRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Dan Owner',
        email: 'dan@company.example',
        companyName: 'Dan Enterprises',
        password: 'Password123!',
      })
      .expect(201);
    const ownerCookie = sessionCookie(regOwnerRes);
    const ownerCsrf = regOwnerRes.body.session.csrfToken;

    const inviteViewerRes = await request(app)
      .post('/api/workspace/invitations')
      .set('Cookie', ownerCookie)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ email: 'val@company.example', role: 'viewer' })
      .expect(201);

    const regViewerRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Val Viewer',
        email: 'val@company.example',
        password: 'Password123!',
        inviteToken: inviteViewerRes.body.invitation.token,
      })
      .expect(201);
    const viewerCookie = sessionCookie(regViewerRes);

    // 3. Viewer attempts to access Company Admin
    await request(app)
      .get('/api/workspace/company-admin')
      .set('Cookie', viewerCookie)
      .expect(403);

    await request(app)
      .get('/api/company-admin')
      .set('Cookie', viewerCookie)
      .expect(403);
  });

  it('rejects personal workspace users without a company', async () => {
    const { app } = buildStack();

    // Register a personal account (no company)
    const regPersonalRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Perry Personal',
        email: 'perry@personal.example',
        password: 'Password123!',
      })
      .expect(201);
    const personalCookie = sessionCookie(regPersonalRes);

    // Personal user has no companyId
    const res = await request(app)
      .get('/api/workspace/company-admin')
      .set('Cookie', personalCookie);

    expect([400, 403]).toContain(res.status);
  });

  it('guarantees that Company Admins cannot access platform-wide administration APIs (/api/admin/*)', async () => {
    const { app } = buildStack();

    // Register Company and Admin
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Boss Admin',
        email: 'boss@corp.example',
        companyName: 'Boss Corp',
        password: 'Password123!',
      })
      .expect(201);
    const adminCookie = sessionCookie(regRes);

    // Platform admin endpoints must strictly reject Company Admins with 403
    await request(app)
      .get('/api/admin/overview')
      .set('Cookie', adminCookie)
      .expect(403);

    await request(app)
      .get('/api/admin/companies')
      .set('Cookie', adminCookie)
      .expect(403);

    await request(app)
      .get('/api/admin/users')
      .set('Cookie', adminCookie)
      .expect(403);

    await request(app)
      .get('/api/admin/audit-logs')
      .set('Cookie', adminCookie)
      .expect(403);

    await request(app)
      .get('/api/admin/audit-logs/verify')
      .set('Cookie', adminCookie)
      .expect(403);
  });
});
