import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import type { UserRole } from '../src/auth/types.js';
import { InMemoryAuthStore } from './support/in-memory-auth-store.js';
import { InMemoryDocumentStore } from './support/in-memory-document-store.js';
import { InMemoryDocumentActivityStore } from './support/in-memory-activity-store.js';
import { STRONG_SECRET, testEnv, testLogger } from './support/test-env.js';
import type { DocumentStorage } from '../src/documents/storage.js';

const PDF_SAMPLE = Buffer.from('%PDF-1.4 sample content');

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
    save: async () => ({ storageKey: 'test/storage-key-1', sizeBytes: PDF_SAMPLE.length }),
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

async function addTestUser(
  authStore: InMemoryAuthStore,
  input: {
    id: string;
    email: string;
    displayName: string;
    companyId: string | null;
    role: UserRole;
    isActive?: boolean;
  },
) {
  const passwordHash = await hashPassword('Password123!', 4);
  return authStore.createUser({
    id: input.id,
    email: input.email,
    displayName: input.displayName,
    companyId: input.companyId,
    role: input.role,
    passwordHash,
    createdAt: new Date(),
  });
}

describe('Platform Administrator Account & Tenant Security Boundaries', () => {
  // Case 1 & 2: Platform Administrator cross-company visibility & overview
  it('Platform Administrator can view employees from Company A and Company B, overview metrics, and company directories', async () => {
    const { app, authStore } = buildStack();

    // 1. Register Company A with Owner A
    const resA = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice Owner',
        email: 'alice@alpha.example',
        companyName: 'Alpha Corp',
        password: 'Password123!',
      })
      .expect(201);
    const companyAId = resA.body.user.companyId;

    // 2. Register Company B with Owner B
    const resB = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Bob Owner',
        email: 'bob@beta.example',
        companyName: 'Beta Inc',
        password: 'Password123!',
      })
      .expect(201);
    const companyBId = resB.body.user.companyId;

    // 3. Create a member in Company A
    await addTestUser(authStore, {
      id: '00000000-0000-4000-a000-000000000003',
      email: 'carol@alpha.example',
      displayName: 'Carol Engineer',
      companyId: companyAId,
      role: 'editor',
    });

    // 4. Create Platform Administrator account
    await addTestUser(authStore, {
      id: '00000000-0000-4000-a000-000000000001',
      email: 'creator@trustvault.local',
      displayName: 'System Creator',
      companyId: null,
      role: 'platform_admin',
    });

    // Authenticate as Platform Administrator
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'creator@trustvault.local', password: 'Password123!' })
      .expect(200);
    const adminCookie = sessionCookie(loginRes);

    // Platform Admin views overview
    const overviewRes = await request(app)
      .get('/api/admin/overview')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(overviewRes.body.overview.totalCompanies).toBe(2);
    expect(overviewRes.body.overview.totalEmployees).toBe(4); // Alice, Bob, Carol, Creator
    expect(overviewRes.body.overview.activeAccounts).toBe(4);
    expect(overviewRes.body.overview.disabledAccounts).toBe(0);

    // Platform Admin lists all users across all companies (Case 1)
    const allUsersRes = await request(app)
      .get('/api/admin/users')
      .set('Cookie', adminCookie)
      .expect(200);
    const allEmails = (allUsersRes.body.users as Array<{ email: string }>).map((u) => u.email);
    expect(allEmails).toContain('alice@alpha.example');
    expect(allEmails).toContain('bob@beta.example');
    expect(allEmails).toContain('carol@alpha.example');
    expect(allEmails).toContain('creator@trustvault.local');

    // Platform Admin filters by Company A
    const companyAUsersRes = await request(app)
      .get(`/api/admin/users?companyId=${companyAId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    const companyAEmails = (companyAUsersRes.body.users as Array<{ email: string }>).map((u) => u.email);
    expect(companyAEmails).toContain('alice@alpha.example');
    expect(companyAEmails).toContain('carol@alpha.example');
    expect(companyAEmails).not.toContain('bob@beta.example');

    // Platform Admin lists companies (Case 2)
    const companiesRes = await request(app)
      .get('/api/admin/companies')
      .set('Cookie', adminCookie)
      .expect(200);
    const companyNames = (companiesRes.body.companies as Array<{ name: string }>).map((c) => c.name);
    expect(companyNames).toContain('Alpha Corp');
    expect(companyNames).toContain('Beta Inc');

    // Platform Admin views specific company employee list
    const companyBEmployeesRes = await request(app)
      .get(`/api/admin/companies/${companyBId}/employees`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(companyBEmployeesRes.body.employees.some((e: any) => e.email === 'bob@beta.example')).toBe(true);
    expect(companyBEmployeesRes.body.employees.some((e: any) => e.email === 'alice@alpha.example')).toBe(false);
  });

  // Case 3 & 4: Company isolation for Company Owner and Company Admin
  it('Company Owner and Company Admin can only view and manage employees within their own company workspace', async () => {
    const { app, authStore } = buildStack();

    // Register Company A (Owner A)
    const resA = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice Owner',
        email: 'alice@alpha.example',
        companyName: 'Alpha Corp',
        password: 'Password123!',
      })
      .expect(201);
    const cookieA = sessionCookie(resA);
    const companyAId = resA.body.user.companyId;

    // Register Company B (Owner B)
    const resB = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Bob Owner',
        email: 'bob@beta.example',
        companyName: 'Beta Inc',
        password: 'Password123!',
      })
      .expect(201);
    const cookieB = sessionCookie(resB);

    // Add Company A Admin
    await addTestUser(authStore, {
      id: '00000000-0000-4000-a000-000000000005',
      email: 'admin_a@alpha.example',
      displayName: 'Admin Alpha',
      companyId: companyAId,
      role: 'admin',
    });

    const adminALogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin_a@alpha.example', password: 'Password123!' })
      .expect(200);
    const cookieAdminA = sessionCookie(adminALogin);

    // Case 3: Company A owner views members -> only Company A members visible
    const membersA = await request(app)
      .get('/api/workspace/members')
      .set('Cookie', cookieA)
      .expect(200);
    const emailsA = (membersA.body.members as Array<{ email: string }>).map((m) => m.email);
    expect(emailsA).toContain('alice@alpha.example');
    expect(emailsA).toContain('admin_a@alpha.example');
    expect(emailsA).not.toContain('bob@beta.example');

    // Case 4: Company A admin views members -> only Company A members visible
    const membersAdminA = await request(app)
      .get('/api/workspace/members')
      .set('Cookie', cookieAdminA)
      .expect(200);
    const emailsAdminA = (membersAdminA.body.members as Array<{ email: string }>).map((m) => m.email);
    expect(emailsAdminA).toContain('alice@alpha.example');
    expect(emailsAdminA).toContain('admin_a@alpha.example');
    expect(emailsAdminA).not.toContain('bob@beta.example');

    // Company B owner views members -> only Company B members visible
    const membersB = await request(app)
      .get('/api/workspace/members')
      .set('Cookie', cookieB)
      .expect(200);
    const emailsB = (membersB.body.members as Array<{ email: string }>).map((m) => m.email);
    expect(emailsB).toContain('bob@beta.example');
    expect(emailsB).not.toContain('alice@alpha.example');
    expect(emailsB).not.toContain('admin_a@alpha.example');
  });

  // Case 5: Normal employee (editor/viewer) and Company Owner/Admin cannot access Platform Administration APIs
  it('rejects access to Platform Administration APIs (403) for company owners, company admins, editors, and viewers', async () => {
    const { app, authStore } = buildStack();

    // Register Company A
    const resA = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice Owner',
        email: 'alice@alpha.example',
        companyName: 'Alpha Corp',
        password: 'Password123!',
      })
      .expect(201);
    const cookieOwner = sessionCookie(resA);
    const companyAId = resA.body.user.companyId;

    // Create Company Admin
    await addTestUser(authStore, {
      id: '00000000-0000-4000-a000-000000000010',
      email: 'admin@alpha.example',
      displayName: 'Admin Alpha',
      companyId: companyAId,
      role: 'admin',
    });
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@alpha.example', password: 'Password123!' })
      .expect(200);
    const cookieAdmin = sessionCookie(adminLogin);

    // Create Editor
    await addTestUser(authStore, {
      id: '00000000-0000-4000-a000-000000000011',
      email: 'editor@alpha.example',
      displayName: 'Editor Alpha',
      companyId: companyAId,
      role: 'editor',
    });
    const editorLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'editor@alpha.example', password: 'Password123!' })
      .expect(200);
    const cookieEditor = sessionCookie(editorLogin);

    // Create Viewer
    await addTestUser(authStore, {
      id: '00000000-0000-4000-a000-000000000012',
      email: 'viewer@alpha.example',
      displayName: 'Viewer Alpha',
      companyId: companyAId,
      role: 'viewer',
    });
    const viewerLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'viewer@alpha.example', password: 'Password123!' })
      .expect(200);
    const cookieViewer = sessionCookie(viewerLogin);

    const endpoints = [
      '/api/admin/overview',
      '/api/admin/users',
      '/api/admin/companies',
      '/api/admin/audit-logs',
    ];

    for (const endpoint of endpoints) {
      // Company Owner -> 403
      await request(app).get(endpoint).set('Cookie', cookieOwner).expect(403);
      // Company Admin -> 403
      await request(app).get(endpoint).set('Cookie', cookieAdmin).expect(403);
      // Editor -> 403
      await request(app).get(endpoint).set('Cookie', cookieEditor).expect(403);
      // Viewer -> 403
      await request(app).get(endpoint).set('Cookie', cookieViewer).expect(403);
    }
  });

  // Case 6: Company owners and company admins cannot create or promote anyone to Platform Administrator
  it('prevents company owners and admins from creating or promoting anyone to Platform Administrator', async () => {
    const { app, authStore } = buildStack();

    // Register Company A
    const resA = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice Owner',
        email: 'alice@alpha.example',
        companyName: 'Alpha Corp',
        password: 'Password123!',
      })
      .expect(201);
    const cookieOwner = sessionCookie(resA);
    const csrfOwner = resA.body.session.csrfToken;
    const companyAId = resA.body.user.companyId;

    // Create an employee in Company A
    const employee = await addTestUser(authStore, {
      id: '00000000-0000-4000-a000-000000000020',
      email: 'employee@alpha.example',
      displayName: 'Employee Alpha',
      companyId: companyAId,
      role: 'editor',
    });

    // Attempt to promote employee to platform_admin via PATCH /api/workspace/members/:id/role
    const promoteRes = await request(app)
      .patch(`/api/workspace/members/${employee.id}/role`)
      .set('Cookie', cookieOwner)
      .set('X-CSRF-Token', csrfOwner)
      .send({ role: 'platform_admin' });

    // Must be rejected (either 422/400 validation error from Zod enum or 403 Forbidden)
    expect([400, 403, 422]).toContain(promoteRes.status);

    // Verify employee role remains unchanged
    const storedUser = await authStore.findUserById(employee.id);
    expect(storedUser?.role).toBe('editor');

    // Attempt to invite a user with platform_admin role via POST /api/workspace/invitations
    const inviteRes = await request(app)
      .post('/api/workspace/invitations')
      .set('Cookie', cookieOwner)
      .set('X-CSRF-Token', csrfOwner)
      .send({ email: 'newbie@alpha.example', role: 'platform_admin' });

    expect([400, 403, 422]).toContain(inviteRes.status);
  });

  // Case 7: Unauthorized cross-company data tampering / IDOR prevention
  it('prevents cross-company member deletion or modification (IDOR protection)', async () => {
    const { app, authStore } = buildStack();

    // Register Company A
    const resA = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Alice Owner',
        email: 'alice@alpha.example',
        companyName: 'Alpha Corp',
        password: 'Password123!',
      })
      .expect(201);
    const cookieA = sessionCookie(resA);
    const csrfA = resA.body.session.csrfToken;

    // Register Company B
    const resB = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Bob Owner',
        email: 'bob@beta.example',
        companyName: 'Beta Inc',
        password: 'Password123!',
      })
      .expect(201);
    const companyBId = resB.body.user.companyId;

    // Create employee in Company B
    const bobEmployee = await addTestUser(authStore, {
      id: '00000000-0000-4000-b000-000000000030',
      email: 'bob_staff@beta.example',
      displayName: 'Bob Staff',
      companyId: companyBId,
      role: 'editor',
    });

    // Alice (Company A owner) attempts to delete Bob's employee from Company B
    const deleteRes = await request(app)
      .delete(`/api/workspace/members/${bobEmployee.id}`)
      .set('Cookie', cookieA)
      .set('X-CSRF-Token', csrfA);

    // Must be rejected with 404 (or 403)
    expect([403, 404]).toContain(deleteRes.status);

    // Verify Bob's employee is still in Company B
    const verifyUser = await authStore.findUserById(bobEmployee.id);
    expect(verifyUser?.companyId).toBe(companyBId);

    // Alice attempts to update Bob's employee role
    const updateRoleRes = await request(app)
      .patch(`/api/workspace/members/${bobEmployee.id}/role`)
      .set('Cookie', cookieA)
      .set('X-CSRF-Token', csrfA)
      .send({ role: 'admin' });

    expect([403, 404]).toContain(updateRoleRes.status);
    const verifyRole = await authStore.findUserById(bobEmployee.id);
    expect(verifyRole?.role).toBe('editor');
  });

  // Case 8: Existing authentication, document sharing, revocation, and audit logging continue working seamlessly
  it('preserves existing document upload, sharing, revocation, and audit logging functionality', async () => {
    const { app, authStore, documentStore } = buildStack();

    // Register Company Owner
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Document Owner',
        email: 'docowner@alpha.example',
        companyName: 'Alpha Corp',
        password: 'Password123!',
      })
      .expect(201);
    const ownerCookie = sessionCookie(regRes);
    const ownerCsrf = regRes.body.session.csrfToken;
    const ownerUser = regRes.body.user;

    // Create a viewer in the same company
    const viewerUser = await addTestUser(authStore, {
      id: '00000000-0000-4000-a000-000000000040',
      email: 'docviewer@alpha.example',
      displayName: 'Doc Viewer',
      companyId: ownerUser.companyId,
      role: 'viewer',
    });
    const viewerLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'docviewer@alpha.example', password: 'Password123!' })
      .expect(200);
    const viewerCookie = sessionCookie(viewerLogin);

    // 1. Owner creates a document
    const doc = await documentStore.create({
      id: 'd0000000-0000-4000-a000-000000000001',
      ownerId: ownerUser.id,
      companyId: ownerUser.companyId,
      title: 'Q4 Financial Review',
      description: 'Audit file',
      fileName: 'review.pdf',
      storageKey: '2026/10/review.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF_SAMPLE.length,
      checksumSha256: null,
      category: 'report',
      createdAt: new Date(),
    }, { id: ownerUser.id, role: 'owner', companyId: ownerUser.companyId });

    // 2. Owner shares document with viewer
    const shareRes = await request(app)
      .post(`/api/documents/${doc.id}/permissions`)
      .set('Cookie', ownerCookie)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ email: viewerUser.email, role: 'viewer' })
      .expect(200);
    expect(shareRes.body.permissions.some((p: any) => p.email === viewerUser.email)).toBe(true);

    // 3. Viewer can access the document
    const viewRes = await request(app)
      .get(`/api/documents/${doc.id}`)
      .set('Cookie', viewerCookie)
      .expect(200);
    expect(viewRes.body.document.id).toBe(doc.id);

    // 4. Owner revokes access
    await request(app)
      .delete(`/api/documents/${doc.id}/permissions/${viewerUser.id}`)
      .set('Cookie', ownerCookie)
      .set('X-CSRF-Token', ownerCsrf)
      .expect(200);

    // 5. Viewer immediately loses access (404)
    await request(app)
      .get(`/api/documents/${doc.id}`)
      .set('Cookie', viewerCookie)
      .expect(404);

    // 6. Cryptographic audit trail integrity remains verified
    const integrity = await authStore.verifyAuditIntegrity();
    expect(integrity.verified).toBe(true);
    expect(integrity.totalEntries).toBeGreaterThan(0);
  });

  // Account status management by Platform Administrator
  it('allows Platform Administrator to disable and reactivate accounts, which immediately revokes sessions', async () => {
    const { app, authStore } = buildStack();

    // Create Platform Admin
    await addTestUser(authStore, {
      id: '00000000-0000-4000-a000-000000000001',
      email: 'creator@trustvault.local',
      displayName: 'Platform Admin',
      companyId: null,
      role: 'platform_admin',
    });
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'creator@trustvault.local', password: 'Password123!' })
      .expect(200);
    const adminCookie = sessionCookie(adminLogin);
    const adminCsrf = adminLogin.body.session.csrfToken;

    // Create a regular user
    const user = await addTestUser(authStore, {
      id: '00000000-0000-4000-a000-000000000050',
      email: 'target@example.com',
      displayName: 'Target User',
      companyId: null,
      role: 'editor',
    });

    // User logs in
    const userLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'target@example.com', password: 'Password123!' })
      .expect(200);
    const userCookie = sessionCookie(userLogin);

    // User can access /api/auth/me
    await request(app).get('/api/auth/me').set('Cookie', userCookie).expect(200);

    // Platform Admin disables user account
    await request(app)
      .patch(`/api/admin/users/${user.id}/status`)
      .set('Cookie', adminCookie)
      .set('X-CSRF-Token', adminCsrf)
      .send({ isActive: false })
      .expect(200);

    // User's active session is now rejected (401)
    await request(app).get('/api/auth/me').set('Cookie', userCookie).expect(401);

    // User cannot log in
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'target@example.com', password: 'Password123!' })
      .expect(401);

    // Platform Admin reactivates account
    await request(app)
      .patch(`/api/admin/users/${user.id}/status`)
      .set('Cookie', adminCookie)
      .set('X-CSRF-Token', adminCsrf)
      .send({ isActive: true })
      .expect(200);

    // User can now log in again
    const userRelogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'target@example.com', password: 'Password123!' })
      .expect(200);
    const newCookie = sessionCookie(userRelogin);
    await request(app).get('/api/auth/me').set('Cookie', newCookie).expect(200);
  });
});
