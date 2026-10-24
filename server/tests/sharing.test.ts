import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import type { UserRole } from '../src/auth/types.js';
import { InMemoryDocumentStorage } from '../src/documents/storage.js';
import { InMemoryAuthStore } from './support/in-memory-auth-store.js';
import { InMemoryDocumentActivityStore } from './support/in-memory-activity-store.js';
import { InMemoryDocumentStore } from './support/in-memory-document-store.js';
import { testEnv, testLogger } from './support/test-env.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8');

interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

function buildStack() {
  const env = testEnv();
  const authStore = new InMemoryAuthStore();
  const documentStore = new InMemoryDocumentStore();
  const activityStore = new InMemoryDocumentActivityStore(documentStore, authStore);
  const storage = new InMemoryDocumentStorage();

  const app = createApp({
    env,
    logger: testLogger(env),
    pingDatabase: async () => ({ ok: true, latencyMs: 1 }),
    authStore,
    documentStore,
    documentActivityStore: activityStore,
    documentStorage: storage,
  });

  return { app, authStore, documentStore, activityStore, storage };
}

async function createUser(
  stack: ReturnType<typeof buildStack>,
  options: { email: string; role?: UserRole; displayName?: string },
) {
  const passwordHash = await hashPassword(PASSWORD, 4);
  const user = stack.authStore.addUser({
    email: options.email,
    passwordHash,
    role: options.role ?? 'viewer',
    displayName: options.displayName ?? null,
  });
  stack.documentStore.registerUser(user.id, user.email, user.displayName);
  return user;
}

async function login(stack: ReturnType<typeof buildStack>, email: string): Promise<Session> {
  const response = await request(stack.app)
    .post('/api/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);

  const header = response.headers['set-cookie'] as string | string[] | undefined;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) throw new Error('Expected a session cookie');
  return {
    cookie: raw.split(';')[0] ?? '',
    csrf: response.body.session.csrfToken as string,
    userId: response.body.user.id as string,
  };
}

function upload(
  stack: ReturnType<typeof buildStack>,
  session: Session,
  fields: Record<string, string> = {},
) {
  let pending = request(stack.app)
    .post('/api/documents')
    .set('Cookie', session.cookie)
    .set('X-CSRF-Token', session.csrf);

  for (const [key, value] of Object.entries(fields)) {
    pending = pending.field(key, value);
  }

  return pending.attach('file', PDF, {
    filename: 'report.pdf',
    contentType: 'application/pdf',
  });
}

function grant(
  stack: ReturnType<typeof buildStack>,
  session: Session,
  documentId: string,
  body: Record<string, unknown>,
) {
  return request(stack.app)
    .post(`/api/documents/${documentId}/permissions`)
    .set('Cookie', session.cookie)
    .set('X-CSRF-Token', session.csrf)
    .send(body);
}

describe('upload role restriction', () => {
  it('forbids a viewer from uploading', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    const session = await login(stack, 'viewer@trustvault.local');

    const response = await upload(stack, session).expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(stack.storage.files.size).toBe(0);
  });

  it('allows an owner and an admin to upload', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    await createUser(stack, { email: 'admin@trustvault.local', role: 'admin' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const adminSession = await login(stack, 'admin@trustvault.local');

    await upload(stack, ownerSession).expect(201);
    await upload(stack, adminSession).expect(201);
  });
});

describe('document sharing', () => {
  it('grants a viewer access and shows the grant', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');

    const uploaded = await upload(stack, ownerSession).expect(201);
    const documentId = uploaded.body.document.id as string;

    const granted = await grant(stack, ownerSession, documentId, {
      email: 'viewer@trustvault.local',
      role: 'viewer',
    }).expect(200);

    expect(granted.body.permissions).toHaveLength(1);
    expect(granted.body.permissions[0]).toMatchObject({
      userId: viewer.id,
      email: 'viewer@trustvault.local',
      role: 'viewer',
    });

    const list = await request(stack.app)
      .get('/api/documents')
      .set('Cookie', viewerSession.cookie)
      .expect(200);
    expect(list.body.pagination.total).toBe(1);
    expect(list.body.documents[0].access.mode).toBe('viewer');

    await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', viewerSession.cookie)
      .expect(200);
  });

  it('can grant a co-owner who may edit', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');

    const uploaded = await upload(stack, ownerSession).expect(201);
    const documentId = uploaded.body.document.id as string;

    await grant(stack, ownerSession, documentId, {
      email: 'viewer@trustvault.local',
      role: 'owner',
    }).expect(200);

    await request(stack.app)
      .patch(`/api/documents/${documentId}`)
      .set('Cookie', viewerSession.cookie)
      .set('X-CSRF-Token', viewerSession.csrf)
      .send({ title: 'Co-owner edit' })
      .expect(200);
  });

  it('rejects an unknown email, a self grant and an invalid role', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const uploaded = await upload(stack, ownerSession).expect(201);
    const documentId = uploaded.body.document.id as string;

    const unknown = await grant(stack, ownerSession, documentId, {
      email: 'ghost@trustvault.local',
      role: 'viewer',
    }).expect(404);
    expect(unknown.body.error.code).toBe('USER_NOT_FOUND');

    const self = await grant(stack, ownerSession, documentId, {
      email: 'owner@trustvault.local',
      role: 'viewer',
    }).expect(422);
    expect(self.body.error.code).toBe('INVALID_GRANT');

    await grant(stack, ownerSession, documentId, {
      email: 'viewer@trustvault.local',
      role: 'admin',
    }).expect(422);
  });

  it('rejects grants from a viewer and from a stranger', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    await createUser(stack, { email: 'stranger@trustvault.local', role: 'viewer' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');
    const strangerSession = await login(stack, 'stranger@trustvault.local');

    const uploaded = await upload(stack, ownerSession).expect(201);
    const documentId = uploaded.body.document.id as string;

    stack.documentStore.grant(documentId, viewer.id, 'viewer');

    const fromViewer = await grant(stack, viewerSession, documentId, {
      email: 'stranger@trustvault.local',
      role: 'viewer',
    }).expect(403);
    expect(fromViewer.body.error.code).toBe('DOCUMENT_FORBIDDEN');

    const fromStranger = await grant(stack, strangerSession, documentId, {
      email: 'viewer@trustvault.local',
      role: 'viewer',
    }).expect(404);
    expect(fromStranger.body.error.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it('requires CSRF for a grant', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const uploaded = await upload(stack, ownerSession).expect(201);

    await request(stack.app)
      .post(`/api/documents/${uploaded.body.document.id}/permissions`)
      .set('Cookie', ownerSession.cookie)
      .send({ email: 'viewer@trustvault.local', role: 'viewer' })
      .expect(403);
  });

  it('revokes access and empties the interface state', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');

    const uploaded = await upload(stack, ownerSession).expect(201);
    const documentId = uploaded.body.document.id as string;

    await grant(stack, ownerSession, documentId, {
      email: 'viewer@trustvault.local',
      role: 'viewer',
    }).expect(200);

    const revoked = await request(stack.app)
      .delete(`/api/documents/${documentId}/permissions/${viewer.id}`)
      .set('Cookie', ownerSession.cookie)
      .set('X-CSRF-Token', ownerSession.csrf)
      .expect(200);

    expect(revoked.body.permissions).toEqual([]);

    const viewerList = await request(stack.app)
      .get('/api/documents')
      .set('Cookie', viewerSession.cookie)
      .expect(200);
    expect(viewerList.body.pagination.total).toBe(0);

    await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', viewerSession.cookie)
      .expect(404);

    await request(stack.app)
      .delete(`/api/documents/${documentId}/permissions/${viewer.id}`)
      .set('Cookie', ownerSession.cookie)
      .set('X-CSRF-Token', ownerSession.csrf)
      .expect(404);
  });

  it('refuses to revoke the owner', async () => {
    const stack = buildStack();
    const owner = await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const uploaded = await upload(stack, ownerSession).expect(201);

    const response = await request(stack.app)
      .delete(`/api/documents/${uploaded.body.document.id}/permissions/${owner.id}`)
      .set('Cookie', ownerSession.cookie)
      .set('X-CSRF-Token', ownerSession.csrf)
      .expect(422);

    expect(response.body.error.code).toBe('INVALID_REVOKE');
  });
});

describe('dashboard statistics', () => {
  it('counts owned and shared documents for a viewer', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');

    const uploaded = await upload(stack, ownerSession, { category: 'report' }).expect(201);
    await upload(stack, ownerSession, { category: 'contract' }).expect(201);

    const ownerStats = await request(stack.app)
      .get('/api/documents/stats')
      .set('Cookie', ownerSession.cookie)
      .expect(200);
    expect(ownerStats.body.stats).toMatchObject({
      totalDocuments: 2,
      ownedCount: 2,
      sharedCount: 0,
      totalBytes: PDF.length * 2,
    });
    expect(ownerStats.body.stats.byCategory).toHaveLength(2);

    stack.documentStore.grant(uploaded.body.document.id, viewer.id, 'viewer');

    const viewerStats = await request(stack.app)
      .get('/api/documents/stats')
      .set('Cookie', viewerSession.cookie)
      .expect(200);
    expect(viewerStats.body.stats).toMatchObject({
      totalDocuments: 1,
      ownedCount: 0,
      sharedCount: 1,
    });
  });
});

describe('access history', () => {
  it('shows permission and download events to a manager only', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    await createUser(stack, { email: 'stranger@trustvault.local', role: 'viewer' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');
    const strangerSession = await login(stack, 'stranger@trustvault.local');

    const uploaded = await upload(stack, ownerSession).expect(201);
    const documentId = uploaded.body.document.id as string;

    await grant(stack, ownerSession, documentId, {
      email: 'viewer@trustvault.local',
      role: 'viewer',
    }).expect(200);

    await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', viewerSession.cookie)
      .expect(200);

    const history = await request(stack.app)
      .get(`/api/documents/${documentId}/access-history`)
      .set('Cookie', ownerSession.cookie)
      .expect(200);

    const actions = (history.body.entries as Array<{ action: string }>).map((entry) => entry.action);
    expect(actions).toContain('document.uploaded');
    expect(actions).toContain('document.permission_granted');
    expect(actions).toContain('document.downloaded');
    expect(history.body.pagination.total).toBeGreaterThanOrEqual(3);

    await request(stack.app)
      .get(`/api/documents/${documentId}/access-history`)
      .set('Cookie', viewerSession.cookie)
      .expect(403);

    await request(stack.app)
      .get(`/api/documents/${documentId}/access-history`)
      .set('Cookie', strangerSession.cookie)
      .expect(404);
  });

  it('lists activity across manageable documents', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    await createUser(stack, { email: 'admin@trustvault.local', role: 'admin' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const adminSession = await login(stack, 'admin@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');

    const uploaded = await upload(stack, ownerSession).expect(201);
    stack.documentStore.grant(uploaded.body.document.id, viewer.id, 'viewer');

    const ownerHistory = await request(stack.app)
      .get('/api/access-history')
      .set('Cookie', ownerSession.cookie)
      .expect(200);
    expect(ownerHistory.body.entries.length).toBeGreaterThan(0);

    const adminHistory = await request(stack.app)
      .get('/api/access-history')
      .set('Cookie', adminSession.cookie)
      .expect(200);
    expect(adminHistory.body.entries.length).toBeGreaterThanOrEqual(
      ownerHistory.body.entries.length,
    );

    // A viewer has no manageable documents and no history endpoint access.
    await request(stack.app)
      .get('/api/access-history')
      .set('Cookie', viewerSession.cookie)
      .expect(403);
  });
});

describe('admin dashboards', () => {
  it('returns overview counters and the user directory to admins only', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    await createUser(stack, { email: 'admin@trustvault.local', role: 'platform_admin' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const adminSession = await login(stack, 'admin@trustvault.local');

    await upload(stack, ownerSession).expect(201);

    const overview = await request(stack.app)
      .get('/api/admin/overview')
      .set('Cookie', adminSession.cookie)
      .expect(200);
    expect(overview.body.overview).toMatchObject({
      users: 2,
      activeUsers: 2,
      documents: 1,
      deletedDocuments: 0,
      totalBytes: PDF.length,
    });
    expect(overview.body.overview.auditEvents).toBeGreaterThanOrEqual(1);

    const users = await request(stack.app)
      .get('/api/admin/users')
      .set('Cookie', adminSession.cookie)
      .expect(200);
    const emails = (users.body.users as Array<{ email: string }>).map((user) => user.email);
    expect(emails).toContain('owner@trustvault.local');
    expect(users.body.users[0]).toHaveProperty('documentCount');

    await request(stack.app)
      .get('/api/admin/overview')
      .set('Cookie', ownerSession.cookie)
      .expect(403);
  });
});
