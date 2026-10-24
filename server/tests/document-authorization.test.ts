import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import { InMemoryDocumentStorage } from '../src/documents/storage.js';
import { InMemoryAuthStore } from './support/in-memory-auth-store.js';
import { InMemoryDocumentActivityStore } from './support/in-memory-activity-store.js';
import { InMemoryDocumentStore } from './support/in-memory-document-store.js';
import { testEnv, testLogger } from './support/test-env.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const PDF_CONTENT = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8');

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
  options: { email: string; role?: 'admin' | 'owner' | 'viewer'; displayName?: string },
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

function uploadDocument(
  stack: ReturnType<typeof buildStack>,
  session: Session,
  fields: Record<string, string> = { title: 'Confidential Report' },
) {
  let pending = request(stack.app)
    .post('/api/documents')
    .set('Cookie', session.cookie)
    .set('X-CSRF-Token', session.csrf);

  for (const [key, value] of Object.entries(fields)) {
    pending = pending.field(key, value);
  }

  return pending.attach('file', PDF_CONTENT, {
    filename: 'confidential.pdf',
    contentType: 'application/pdf',
  });
}

describe('Document-level authorization and immediate revocation', () => {
  it('prevents IDOR and information leakage on guessed document IDs', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    await createUser(stack, { email: 'stranger@trustvault.local', role: 'viewer' });
    await createUser(stack, { email: 'admin@trustvault.local', role: 'admin' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const strangerSession = await login(stack, 'stranger@trustvault.local');
    const adminSession = await login(stack, 'admin@trustvault.local');

    const uploadResponse = await uploadDocument(stack, ownerSession).expect(201);
    const realDocId = uploadResponse.body.document.id as string;
    const nonExistentDocId = '00000000-0000-0000-0000-000000000000';

    // 1. Non-existent ID: returns 404 for stranger and admin
    const nonExistentStranger = await request(stack.app)
      .get(`/api/documents/${nonExistentDocId}`)
      .set('Cookie', strangerSession.cookie)
      .expect(404);
    expect(nonExistentStranger.body.error.code).toBe('DOCUMENT_NOT_FOUND');

    // 2. Real document guessed by unauthorized viewer: returns identical 404 (no existence leak)
    const realStranger = await request(stack.app)
      .get(`/api/documents/${realDocId}`)
      .set('Cookie', strangerSession.cookie)
      .expect(404);
    expect(realStranger.body.error.code).toBe('DOCUMENT_NOT_FOUND');

    // 3. Real document guessed by administrator without explicit grant: returns identical 404
    const realAdmin = await request(stack.app)
      .get(`/api/documents/${realDocId}`)
      .set('Cookie', adminSession.cookie)
      .expect(404);
    expect(realAdmin.body.error.code).toBe('DOCUMENT_NOT_FOUND');

    // 4. Download on guessed ID returns 404 for stranger and admin
    await request(stack.app)
      .get(`/api/documents/${realDocId}/download`)
      .set('Cookie', strangerSession.cookie)
      .expect(404);

    await request(stack.app)
      .get(`/api/documents/${realDocId}/download`)
      .set('Cookie', adminSession.cookie)
      .expect(404);
  });

  it('protects direct API downloads with database-enforced permissions', async () => {
    const stack = buildStack();
    const owner = await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    const editor = await createUser(stack, { email: 'editor@trustvault.local', role: 'viewer' });
    await createUser(stack, { email: 'stranger@trustvault.local', role: 'viewer' });
    await createUser(stack, { email: 'admin@trustvault.local', role: 'admin' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');
    const editorSession = await login(stack, 'editor@trustvault.local');
    const strangerSession = await login(stack, 'stranger@trustvault.local');
    const adminSession = await login(stack, 'admin@trustvault.local');

    const uploaded = await uploadDocument(stack, ownerSession).expect(201);
    const documentId = uploaded.body.document.id as string;

    // Grants: viewer -> read-only ('viewer'), editor -> edit ('editor')
    stack.documentStore.grant(documentId, viewer.id, 'viewer');
    stack.documentStore.grant(documentId, editor.id, 'editor');

    // 1. Unauthenticated download fails with 401
    await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .expect(401);

    // 2. Stranger download fails with 404
    await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', strangerSession.cookie)
      .expect(404);

    // 3. Admin without grant fails with 404
    await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', adminSession.cookie)
      .expect(404);

    // 4. Owner downloads successfully
    const ownerDownload = await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', ownerSession.cookie)
      .expect(200);
    expect(ownerDownload.headers['content-disposition']).toContain('attachment');
    expect(ownerDownload.headers['cache-control']).toContain('no-store');
    expect(Buffer.from(ownerDownload.body as Buffer).equals(PDF_CONTENT) || ownerDownload.text.startsWith('%PDF')).toBe(true);

    // 5. Authorized viewer downloads successfully
    await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', viewerSession.cookie)
      .expect(200);

    // 6. Authorized editor downloads successfully
    await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', editorSession.cookie)
      .expect(200);
  });

  it('rejects read-only edit attempts but allows users with edit permission', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    const editor = await createUser(stack, { email: 'editor@trustvault.local', role: 'viewer' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');
    const editorSession = await login(stack, 'editor@trustvault.local');

    const uploaded = await uploadDocument(stack, ownerSession, { title: 'Original Title' }).expect(201);
    const documentId = uploaded.body.document.id as string;

    // Grant viewer read-only access
    stack.documentStore.grant(documentId, viewer.id, 'viewer');
    // Grant editor edit access
    stack.documentStore.grant(documentId, editor.id, 'editor');

    // 1. Read-only viewer attempts to PATCH metadata: forbidden with 403
    const viewerEdit = await request(stack.app)
      .patch(`/api/documents/${documentId}`)
      .set('Cookie', viewerSession.cookie)
      .set('X-CSRF-Token', viewerSession.csrf)
      .send({ title: 'Tampered Title' })
      .expect(403);

    expect(viewerEdit.body.error.code).toBe('DOCUMENT_FORBIDDEN');
    expect(viewerEdit.body.error.message).toMatch(/read-only/i);

    // Verify title remains unchanged in DB
    const checkDoc = await request(stack.app)
      .get(`/api/documents/${documentId}`)
      .set('Cookie', ownerSession.cookie)
      .expect(200);
    expect(checkDoc.body.document.title).toBe('Original Title');

    // 2. Editor with edit permission successfully edits metadata: 200
    const editorEdit = await request(stack.app)
      .patch(`/api/documents/${documentId}`)
      .set('Cookie', editorSession.cookie)
      .set('X-CSRF-Token', editorSession.csrf)
      .send({ title: 'Editor Approved Update' })
      .expect(200);

    expect(editorEdit.body.document.title).toBe('Editor Approved Update');
  });

  it('enforces that only the document owner can delete a document', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    const editor = await createUser(stack, { email: 'editor@trustvault.local', role: 'viewer' });
    await createUser(stack, { email: 'admin@trustvault.local', role: 'admin' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');
    const editorSession = await login(stack, 'editor@trustvault.local');
    const adminSession = await login(stack, 'admin@trustvault.local');

    const uploaded = await uploadDocument(stack, ownerSession).expect(201);
    const documentId = uploaded.body.document.id as string;

    stack.documentStore.grant(documentId, viewer.id, 'viewer');
    stack.documentStore.grant(documentId, editor.id, 'editor');

    // 1. Viewer attempts deletion: rejected with 403
    const viewerDelete = await request(stack.app)
      .delete(`/api/documents/${documentId}`)
      .set('Cookie', viewerSession.cookie)
      .set('X-CSRF-Token', viewerSession.csrf)
      .expect(403);
    expect(viewerDelete.body.error.code).toBe('DOCUMENT_FORBIDDEN');

    // 2. Editor attempts deletion: rejected with 403
    const editorDelete = await request(stack.app)
      .delete(`/api/documents/${documentId}`)
      .set('Cookie', editorSession.cookie)
      .set('X-CSRF-Token', editorSession.csrf)
      .expect(403);
    expect(editorDelete.body.error.code).toBe('DOCUMENT_FORBIDDEN');

    // 3. Admin (non-owner) attempts deletion: rejected with 404 (not accessible)
    await request(stack.app)
      .delete(`/api/documents/${documentId}`)
      .set('Cookie', adminSession.cookie)
      .set('X-CSRF-Token', adminSession.csrf)
      .expect(404);

    // Verify document is still intact
    await request(stack.app)
      .get(`/api/documents/${documentId}`)
      .set('Cookie', ownerSession.cookie)
      .expect(200);

    // 4. Owner deletes document: 204 No Content
    await request(stack.app)
      .delete(`/api/documents/${documentId}`)
      .set('Cookie', ownerSession.cookie)
      .set('X-CSRF-Token', ownerSession.csrf)
      .expect(204);

    // After soft-delete, document is inaccessible
    await request(stack.app)
      .get(`/api/documents/${documentId}`)
      .set('Cookie', ownerSession.cookie)
      .expect(404);
  });

  it('prevents permission escalation: non-owners cannot grant or revoke access', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    const editor = await createUser(stack, { email: 'editor@trustvault.local', role: 'viewer' });
    const target = await createUser(stack, { email: 'target@trustvault.local', role: 'viewer' });
    await createUser(stack, { email: 'admin@trustvault.local', role: 'admin' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');
    const editorSession = await login(stack, 'editor@trustvault.local');
    const adminSession = await login(stack, 'admin@trustvault.local');

    const uploaded = await uploadDocument(stack, ownerSession).expect(201);
    const documentId = uploaded.body.document.id as string;

    stack.documentStore.grant(documentId, viewer.id, 'viewer');
    stack.documentStore.grant(documentId, editor.id, 'editor');

    // 1. Viewer attempts to grant access to target: 403
    const viewerGrant = await request(stack.app)
      .post(`/api/documents/${documentId}/permissions`)
      .set('Cookie', viewerSession.cookie)
      .set('X-CSRF-Token', viewerSession.csrf)
      .send({ email: 'target@trustvault.local', role: 'viewer' })
      .expect(403);
    expect(viewerGrant.body.error.code).toBe('DOCUMENT_FORBIDDEN');

    // 2. Editor attempts to grant access to target: 403
    const editorGrant = await request(stack.app)
      .post(`/api/documents/${documentId}/permissions`)
      .set('Cookie', editorSession.cookie)
      .set('X-CSRF-Token', editorSession.csrf)
      .send({ email: 'target@trustvault.local', role: 'viewer' })
      .expect(403);
    expect(editorGrant.body.error.code).toBe('DOCUMENT_FORBIDDEN');

    // 3. Admin (non-owner) attempts to grant access: 404 (document is not theirs)
    await request(stack.app)
      .post(`/api/documents/${documentId}/permissions`)
      .set('Cookie', adminSession.cookie)
      .set('X-CSRF-Token', adminSession.csrf)
      .send({ email: 'target@trustvault.local', role: 'viewer' })
      .expect(404);

    // 4. Viewer attempts to revoke editor's access: 403
    const viewerRevoke = await request(stack.app)
      .delete(`/api/documents/${documentId}/permissions/${editor.id}`)
      .set('Cookie', viewerSession.cookie)
      .set('X-CSRF-Token', viewerSession.csrf)
      .expect(403);
    expect(viewerRevoke.body.error.code).toBe('DOCUMENT_FORBIDDEN');

    // 5. Editor attempts to revoke viewer's access: 403
    const editorRevoke = await request(stack.app)
      .delete(`/api/documents/${documentId}/permissions/${viewer.id}`)
      .set('Cookie', editorSession.cookie)
      .set('X-CSRF-Token', editorSession.csrf)
      .expect(403);
    expect(editorRevoke.body.error.code).toBe('DOCUMENT_FORBIDDEN');

    // 6. Only owner can grant: 200
    await request(stack.app)
      .post(`/api/documents/${documentId}/permissions`)
      .set('Cookie', ownerSession.cookie)
      .set('X-CSRF-Token', ownerSession.csrf)
      .send({ email: 'target@trustvault.local', role: 'viewer' })
      .expect(200);

    // 7. Only owner can view access permissions list: 200
    const perms = await request(stack.app)
      .get(`/api/documents/${documentId}/permissions`)
      .set('Cookie', ownerSession.cookie)
      .expect(200);
    expect(perms.body.permissions.length).toBeGreaterThanOrEqual(1);

    // Viewer cannot view access permissions list: 403
    await request(stack.app)
      .get(`/api/documents/${documentId}/permissions`)
      .set('Cookie', viewerSession.cookie)
      .expect(403);
  });

  it('guarantees immediate revocation blocking viewer on their next request', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');

    const uploaded = await uploadDocument(stack, ownerSession).expect(201);
    const documentId = uploaded.body.document.id as string;

    // 1. Owner grants viewer access
    await request(stack.app)
      .post(`/api/documents/${documentId}/permissions`)
      .set('Cookie', ownerSession.cookie)
      .set('X-CSRF-Token', ownerSession.csrf)
      .send({ email: 'viewer@trustvault.local', role: 'viewer' })
      .expect(200);

    // Viewer can view and download
    await request(stack.app)
      .get(`/api/documents/${documentId}`)
      .set('Cookie', viewerSession.cookie)
      .expect(200);

    await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', viewerSession.cookie)
      .expect(200);

    const viewerListBefore = await request(stack.app)
      .get('/api/documents')
      .set('Cookie', viewerSession.cookie)
      .expect(200);
    expect(viewerListBefore.body.pagination.total).toBe(1);

    // 2. Owner revokes viewer's permission
    const revokeResponse = await request(stack.app)
      .delete(`/api/documents/${documentId}/permissions/${viewer.id}`)
      .set('Cookie', ownerSession.cookie)
      .set('X-CSRF-Token', ownerSession.csrf)
      .expect(200);
    expect(revokeResponse.body.permissions).toEqual([]);

    // 3. Immediately on viewer's next request, access is blocked:
    // Metadata: 404
    const nextMeta = await request(stack.app)
      .get(`/api/documents/${documentId}`)
      .set('Cookie', viewerSession.cookie)
      .expect(404);
    expect(nextMeta.body.error.code).toBe('DOCUMENT_NOT_FOUND');

    // Download: 404
    await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', viewerSession.cookie)
      .expect(404);

    // Document list: 0 visible
    const viewerListAfter = await request(stack.app)
      .get('/api/documents')
      .set('Cookie', viewerSession.cookie)
      .expect(200);
    expect(viewerListAfter.body.pagination.total).toBe(0);
  });

  it('enforces that administrators do not automatically have permission to read document contents', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const admin = await createUser(stack, { email: 'admin@trustvault.local', role: 'admin' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const adminSession = await login(stack, 'admin@trustvault.local');

    const uploaded = await uploadDocument(stack, ownerSession, { title: 'Secret Financials' }).expect(201);
    const documentId = uploaded.body.document.id as string;

    // 1. Admin attempts to list documents: sees 0 (access denied by default)
    const adminList = await request(stack.app)
      .get('/api/documents')
      .set('Cookie', adminSession.cookie)
      .expect(200);
    expect(adminList.body.pagination.total).toBe(0);
    expect(adminList.body.documents).toHaveLength(0);

    // 2. Admin attempts to inspect document metadata: 404
    await request(stack.app)
      .get(`/api/documents/${documentId}`)
      .set('Cookie', adminSession.cookie)
      .expect(404);

    // 3. Admin attempts to download document contents: 404
    await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', adminSession.cookie)
      .expect(404);

    // 4. Owner explicitly grants read permission to the administrator
    await request(stack.app)
      .post(`/api/documents/${documentId}/permissions`)
      .set('Cookie', ownerSession.cookie)
      .set('X-CSRF-Token', ownerSession.csrf)
      .send({ email: 'admin@trustvault.local', role: 'viewer' })
      .expect(200);

    // 5. Admin can now view metadata and download
    const adminDoc = await request(stack.app)
      .get(`/api/documents/${documentId}`)
      .set('Cookie', adminSession.cookie)
      .expect(200);
    expect(adminDoc.body.document.title).toBe('Secret Financials');

    await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', adminSession.cookie)
      .expect(200);

    // 6. Owner revokes administrator's grant
    await request(stack.app)
      .delete(`/api/documents/${documentId}/permissions/${admin.id}`)
      .set('Cookie', ownerSession.cookie)
      .set('X-CSRF-Token', ownerSession.csrf)
      .expect(200);

    // 7. Administrator is immediately blocked again (404)
    await request(stack.app)
      .get(`/api/documents/${documentId}`)
      .set('Cookie', adminSession.cookie)
      .expect(404);

    await request(stack.app)
      .get(`/api/documents/${documentId}/download`)
      .set('Cookie', adminSession.cookie)
      .expect(404);
  });
});
