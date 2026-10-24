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
const PDF_CONTENT = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8');

interface Session {
  cookie: string;
  csrf: string;
  userId: string;
  email: string;
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

  const cookie = response.headers['set-cookie']?.[0]?.split(';')[0] ?? '';
  const csrf = response.body.session.csrfToken as string;
  const userId = response.body.user.id as string;
  return { cookie, csrf, userId, email };
}

describe('TrustVault Audit Trail and Administrator Governance', () => {
  it('records full document lifecycle events with correlation IDs and safe metadata', async () => {
    const stack = buildStack();
    const owner = await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const ownerSession = await login(stack, owner.email);

    // 1. Upload document
    const uploadRes = await request(stack.app)
      .post('/api/documents')
      .set('Cookie', ownerSession.cookie)
      .set('x-csrf-token', ownerSession.csrf)
      .set('x-request-id', 'req-upload-001')
      .attach('file', PDF_CONTENT, 'audit-contract.pdf')
      .field('title', 'Confidential Audit Contract')
      .field('category', 'contract')
      .expect(201);

    const docId = uploadRes.body.document.id as string;

    // 2. View document metadata
    await request(stack.app)
      .get(`/api/documents/${docId}`)
      .set('Cookie', ownerSession.cookie)
      .set('x-request-id', 'req-view-002')
      .expect(200);

    // 3. Download document
    await request(stack.app)
      .get(`/api/documents/${docId}/download`)
      .set('Cookie', ownerSession.cookie)
      .set('x-request-id', 'req-download-003')
      .expect(200);

    // 4. Update document metadata
    await request(stack.app)
      .patch(`/api/documents/${docId}`)
      .set('Cookie', ownerSession.cookie)
      .set('x-csrf-token', ownerSession.csrf)
      .set('x-request-id', 'req-edit-004')
      .send({ title: 'Updated Audit Contract' })
      .expect(200);

    // 5. Soft-delete document
    await request(stack.app)
      .delete(`/api/documents/${docId}`)
      .set('Cookie', ownerSession.cookie)
      .set('x-csrf-token', ownerSession.csrf)
      .set('x-request-id', 'req-delete-005')
      .expect(204);

    // Verify all lifecycle audit entries
    const logs = stack.authStore.auditEvents;
    const uploadLog = logs.find((l) => l.action === 'document.uploaded');
    expect(uploadLog).toBeDefined();
    expect(uploadLog?.userId).toBe(owner.id);
    expect(uploadLog?.resourceId).toBe(docId);
    expect(uploadLog?.outcome).toBe('success');
    expect(uploadLog?.requestId).toBe('req-upload-001');

    const viewLog = logs.find((l) => l.action === 'document.viewed');
    expect(viewLog).toBeDefined();
    expect(viewLog?.userId).toBe(owner.id);
    expect(viewLog?.resourceId).toBe(docId);
    expect(viewLog?.outcome).toBe('success');
    expect(viewLog?.requestId).toBe('req-view-002');

    const downloadLog = logs.find((l) => l.action === 'document.downloaded');
    expect(downloadLog).toBeDefined();
    expect(downloadLog?.userId).toBe(owner.id);
    expect(downloadLog?.resourceId).toBe(docId);
    expect(downloadLog?.outcome).toBe('success');
    expect(downloadLog?.requestId).toBe('req-download-003');

    const updateLog = logs.find((l) => l.action === 'document.updated');
    expect(updateLog).toBeDefined();
    expect(updateLog?.userId).toBe(owner.id);
    expect(updateLog?.resourceId).toBe(docId);
    expect(updateLog?.outcome).toBe('success');
    expect(updateLog?.requestId).toBe('req-edit-004');

    const deleteLog = logs.find((l) => l.action === 'document.deleted');
    expect(deleteLog).toBeDefined();
    expect(deleteLog?.userId).toBe(owner.id);
    expect(deleteLog?.resourceId).toBe(docId);
    expect(deleteLog?.outcome).toBe('success');
    expect(deleteLog?.requestId).toBe('req-delete-005');

    // Never log passwords, tokens, or file contents
    for (const log of logs) {
      const serialized = JSON.stringify(log);
      expect(serialized).not.toContain(PASSWORD);
      expect(serialized).not.toContain(ownerSession.csrf);
      expect(serialized).not.toContain('%PDF-1.7');
    }
  });

  it('records permission grants and revocations with target user IDs and roles', async () => {
    const stack = buildStack();
    const owner = await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    const ownerSession = await login(stack, owner.email);

    // Upload
    const uploadRes = await request(stack.app)
      .post('/api/documents')
      .set('Cookie', ownerSession.cookie)
      .set('x-csrf-token', ownerSession.csrf)
      .attach('file', PDF_CONTENT, 'share-doc.pdf')
      .expect(201);
    const docId = uploadRes.body.document.id as string;

    // Grant edit permission to viewer
    await request(stack.app)
      .post(`/api/documents/${docId}/permissions`)
      .set('Cookie', ownerSession.cookie)
      .set('x-csrf-token', ownerSession.csrf)
      .set('x-request-id', 'req-grant-101')
      .send({ email: viewer.email, role: 'editor' })
      .expect(200);

    // Revoke permission
    await request(stack.app)
      .delete(`/api/documents/${docId}/permissions/${viewer.id}`)
      .set('Cookie', ownerSession.cookie)
      .set('x-csrf-token', ownerSession.csrf)
      .set('x-request-id', 'req-revoke-102')
      .expect(200);

    const logs = stack.authStore.auditEvents;

    const grantLog = logs.find((l) => l.action === 'document.permission_granted');
    expect(grantLog).toBeDefined();
    expect(grantLog?.userId).toBe(owner.id);
    expect(grantLog?.targetUserId).toBe(viewer.id);
    expect(grantLog?.resourceId).toBe(docId);
    expect(grantLog?.outcome).toBe('success');
    expect(grantLog?.requestId).toBe('req-grant-101');
    expect(grantLog?.metadata).toMatchObject({ role: 'editor', targetEmail: viewer.email });

    const revokeLog = logs.find((l) => l.action === 'document.permission_revoked');
    expect(revokeLog).toBeDefined();
    expect(revokeLog?.userId).toBe(owner.id);
    expect(revokeLog?.targetUserId).toBe(viewer.id);
    expect(revokeLog?.resourceId).toBe(docId);
    expect(revokeLog?.outcome).toBe('success');
    expect(revokeLog?.requestId).toBe('req-revoke-102');
  });

  it('logs denied access attempts with outcome "denied" without leaking confidential metadata in response', async () => {
    const stack = buildStack();
    const owner = await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const unauthorized = await createUser(stack, { email: 'stranger@trustvault.local', role: 'viewer' });
    const ownerSession = await login(stack, owner.email);
    const strangerSession = await login(stack, unauthorized.email);

    // Owner creates confidential document
    const uploadRes = await request(stack.app)
      .post('/api/documents')
      .set('Cookie', ownerSession.cookie)
      .set('x-csrf-token', ownerSession.csrf)
      .attach('file', PDF_CONTENT, 'super-secret.pdf')
      .field('title', 'Ultra Confidential Blueprint')
      .expect(201);
    const docId = uploadRes.body.document.id as string;

    // 1. Stranger attempts unauthorized download -> 404
    const downloadDeniedRes = await request(stack.app)
      .get(`/api/documents/${docId}/download`)
      .set('Cookie', strangerSession.cookie)
      .set('x-request-id', 'req-denied-dl')
      .expect(404);

    expect(downloadDeniedRes.body.error.code).toBe('DOCUMENT_NOT_FOUND');
    expect(JSON.stringify(downloadDeniedRes.body)).not.toContain('Ultra Confidential Blueprint');
    expect(JSON.stringify(downloadDeniedRes.body)).not.toContain('super-secret.pdf');

    // 2. Stranger attempts unauthorized update -> 404
    const editDeniedRes = await request(stack.app)
      .patch(`/api/documents/${docId}`)
      .set('Cookie', strangerSession.cookie)
      .set('x-csrf-token', strangerSession.csrf)
      .set('x-request-id', 'req-denied-edit')
      .send({ title: 'Hacked Title' })
      .expect(404);

    expect(editDeniedRes.body.error.code).toBe('DOCUMENT_NOT_FOUND');

    // 3. Stranger attempts unauthorized deletion -> 404
    const deleteDeniedRes = await request(stack.app)
      .delete(`/api/documents/${docId}`)
      .set('Cookie', strangerSession.cookie)
      .set('x-csrf-token', strangerSession.csrf)
      .set('x-request-id', 'req-denied-del')
      .expect(404);

    expect(deleteDeniedRes.body.error.code).toBe('DOCUMENT_NOT_FOUND');

    // 4. Stranger attempts to grant permissions -> 404
    const grantDeniedRes = await request(stack.app)
      .post(`/api/documents/${docId}/permissions`)
      .set('Cookie', strangerSession.cookie)
      .set('x-csrf-token', strangerSession.csrf)
      .set('x-request-id', 'req-denied-grant')
      .send({ email: 'collaborator@trustvault.local', role: 'editor' })
      .expect(404);

    expect(grantDeniedRes.body.error.code).toBe('DOCUMENT_NOT_FOUND');

    // Verify all denied audit entries
    const deniedLogs = stack.authStore.auditEvents.filter((l) => l.outcome === 'denied');
    expect(deniedLogs.length).toBeGreaterThanOrEqual(4);

    const deniedDl = deniedLogs.find((l) => l.action === 'document.download_denied');
    expect(deniedDl).toBeDefined();
    expect(deniedDl?.userId).toBe(unauthorized.id);
    expect(deniedDl?.resourceId).toBe(docId);
    expect(deniedDl?.outcome).toBe('denied');
    expect(deniedDl?.requestId).toBe('req-denied-dl');

    const deniedEdit = deniedLogs.find((l) => l.action === 'document.edit_denied');
    expect(deniedEdit).toBeDefined();
    expect(deniedEdit?.userId).toBe(unauthorized.id);
    expect(deniedEdit?.outcome).toBe('denied');

    const deniedDel = deniedLogs.find((l) => l.action === 'document.delete_denied');
    expect(deniedDel).toBeDefined();
    expect(deniedDel?.userId).toBe(unauthorized.id);
    expect(deniedDel?.outcome).toBe('denied');

    const deniedGrant = deniedLogs.find((l) => l.action === 'document.permission_grant_denied');
    expect(deniedGrant).toBeDefined();
    expect(deniedGrant?.userId).toBe(unauthorized.id);
    expect(deniedGrant?.outcome).toBe('denied');
  });

    it('records denied document history access attempts', async () => {
    const stack = buildStack();
    const owner = await createUser(stack, { email: 'history-owner@trustvault.local', role: 'owner' });
    const unauthorized = await createUser(stack, { email: 'history-stranger@trustvault.local', role: 'viewer' });
    const ownerSession = await login(stack, owner.email);
    const strangerSession = await login(stack, unauthorized.email);

    const uploadRes = await request(stack.app)
      .post('/api/documents')
      .set('Cookie', ownerSession.cookie)
      .set('x-csrf-token', ownerSession.csrf)
      .attach('file', PDF_CONTENT, 'history-test.pdf')
      .expect(201);

    const docId = uploadRes.body.document.id as string;

    // Stranger attempts to access the document's audit history.
    const historyRes = await request(stack.app)
      .get(`/api/documents/${docId}/access-history`)
      .set('Cookie', strangerSession.cookie)
      .set('x-request-id', 'req-denied-history')
      .expect(404);

    expect(historyRes.body.error.code).toBe('DOCUMENT_NOT_FOUND');

    const deniedHistory = stack.authStore.auditEvents.find(
      (entry) => entry.action === 'document.history_denied',
    );

    expect(deniedHistory).toBeDefined();
    expect(deniedHistory?.userId).toBe(unauthorized.id);
    expect(deniedHistory?.resourceId).toBe(docId);
    expect(deniedHistory?.outcome).toBe('denied');
    expect(deniedHistory?.requestId).toBe('req-denied-history');
  });

  it('enforces ledger immutability and catches unauthorized mutations via cryptographic hash chaining', async () => {
    const stack = buildStack();
    const admin = await createUser(stack, { email: 'admin@trustvault.local', role: 'platform_admin' });
    const adminSession = await login(stack, admin.email);

    // Verify initial integrity of the ledger
    const initialVerify = await stack.authStore.verifyAuditIntegrity();
    expect(initialVerify.verified).toBe(true);
    expect(initialVerify.totalEntries).toBeGreaterThan(0);

    // Verify that attempting to UPDATE an audit record is rejected
    await expect(stack.authStore.attemptUpdateAudit('1', { outcome: 'success' })).rejects.toThrow(
      /immutable and cannot be updated/,
    );

    // Verify that attempting to DELETE an audit record is rejected
    await expect(stack.authStore.attemptDeleteAudit('1')).rejects.toThrow(
      /immutable and cannot be deleted/,
    );

    // Create an audit checkpoint
    const cp = await stack.authStore.createCheckpoint();
    expect(cp).not.toBeNull();
    expect(cp?.checkpointSeq).toBe(1);
    expect(cp?.checkpointHash).toMatch(/^[0-9a-f]{64}$/);

    // Verify integrity passes after checkpoint
    const verifyWithCp = await stack.authStore.verifyAuditIntegrity();
    expect(verifyWithCp.verified).toBe(true);
    expect(verifyWithCp.checkedCheckpoints).toBe(1);

    // Simulate an attacker tampering with an existing log entry
    const targetEntry = stack.authStore.auditEvents[0];
    expect(targetEntry).toBeDefined();
    if (!targetEntry) throw new Error('Target entry must exist');

    stack.authStore.simulateTamper(targetEntry.id, { outcome: 'denied' });

    // The tamper must be caught immediately!
    const tamperedVerify = await stack.authStore.verifyAuditIntegrity();
    expect(tamperedVerify.verified).toBe(false);
    expect(tamperedVerify.failedAtId).toBe(targetEntry.id);
    expect(tamperedVerify.failureReason).toContain('Tampered log content');

    // Also check via HTTP API
    const httpVerify = await request(stack.app)
      .get('/api/admin/audit-logs/verify')
      .set('Cookie', adminSession.cookie)
      .expect(200);

    expect(httpVerify.body.verified).toBe(false);
    expect(httpVerify.body.failedAtId).toBe(targetEntry.id);
  });

  it('supports admin search, filtering, account deactivation, and prevents admin document content access', async () => {
    const stack = buildStack();
    const admin = await createUser(stack, { email: 'admin@trustvault.local', role: 'platform_admin' });
    const owner = await createUser(stack, { email: 'alice@trustvault.local', role: 'owner' });
    const targetUser = await createUser(stack, { email: 'bob@trustvault.local', role: 'viewer' });

    const adminSession = await login(stack, admin.email);
    const ownerSession = await login(stack, owner.email);
    const targetSession = await login(stack, targetUser.email);

    // Owner uploads document
    const uploadRes = await request(stack.app)
      .post('/api/documents')
      .set('Cookie', ownerSession.cookie)
      .set('x-csrf-token', ownerSession.csrf)
      .attach('file', PDF_CONTENT, 'alice-secrets.pdf')
      .expect(201);
    const docId = uploadRes.body.document.id as string;

    // Owner shares with Bob
    await request(stack.app)
      .post(`/api/documents/${docId}/permissions`)
      .set('Cookie', ownerSession.cookie)
      .set('x-csrf-token', ownerSession.csrf)
      .send({ email: targetUser.email, role: 'viewer' })
      .expect(200);

    // 1. Admin filters audit logs by action
    const actionFilterRes = await request(stack.app)
      .get('/api/admin/audit-logs?action=document.uploaded')
      .set('Cookie', adminSession.cookie)
      .expect(200);

    expect(actionFilterRes.body.entries).toHaveLength(1);
    expect(actionFilterRes.body.entries[0].action).toBe('document.uploaded');
    expect(actionFilterRes.body.entries[0].resourceId).toBe(docId);

    // 2. Admin filters audit logs by actor
    const actorFilterRes = await request(stack.app)
      .get(`/api/admin/audit-logs?actor=${owner.email}`)
      .set('Cookie', adminSession.cookie)
      .expect(200);

    expect(actorFilterRes.body.entries.length).toBeGreaterThanOrEqual(2);
    for (const entry of actorFilterRes.body.entries) {
      expect(entry.userId).toBe(owner.id);
    }

    // 3. Admin checks cross-tenant permission history
    const permHistoryRes = await request(stack.app)
      .get('/api/admin/permission-history')
      .set('Cookie', adminSession.cookie)
      .expect(200);

    expect(permHistoryRes.body.entries.length).toBeGreaterThanOrEqual(1);
    const grantEntry = permHistoryRes.body.entries[0];
    expect(grantEntry.action).toBe('document.permission_granted');
    expect(grantEntry.resourceId).toBe(docId);
    expect(grantEntry.targetUserId).toBe(targetUser.id);

    // 4. ADMIN ISOLATION INVARIANT: Admin has ZERO automatic read access to document contents
    await request(stack.app)
      .get(`/api/documents/${docId}/download`)
      .set('Cookie', adminSession.cookie)
      .expect(404);

    await request(stack.app)
      .get(`/api/documents/${docId}`)
      .set('Cookie', adminSession.cookie)
      .expect(404);

    // 5. Account governance: Admin deactivates Bob's account
    const deactivateRes = await request(stack.app)
      .patch(`/api/admin/users/${targetUser.id}/status`)
      .set('Cookie', adminSession.cookie)
      .set('x-csrf-token', adminSession.csrf)
      .send({ isActive: false })
      .expect(200);

    expect(deactivateRes.body.ok).toBe(true);
    expect(deactivateRes.body.isActive).toBe(false);

    // Deactivated user's active session is immediately revoked and blocked on next request
    const meRes = await request(stack.app)
      .get('/api/auth/me')
      .set('Cookie', targetSession.cookie);
    expect([401, 403]).toContain(meRes.status);

    // Subsequent login attempt by deactivated user is rejected with generic error
    await request(stack.app)
      .post('/api/auth/login')
      .send({ email: targetUser.email, password: PASSWORD })
      .expect(401);

    // Audit log contains user.deactivated event
    const deactAudit = stack.authStore.auditEvents.find((l) => l.action === 'user.deactivated');
    expect(deactAudit).toBeDefined();
    expect(deactAudit?.userId).toBe(admin.id);
    expect(deactAudit?.targetUserId).toBe(targetUser.id);

    // Admin cannot deactivate own account
    const selfDeactRes = await request(stack.app)
      .patch(`/api/admin/users/${admin.id}/status`)
      .set('Cookie', adminSession.cookie)
      .set('x-csrf-token', adminSession.csrf)
      .send({ isActive: false })
      .expect(422);

    expect(selfDeactRes.body.error.code).toBe('CANNOT_DEACTIVATE_SELF');

    // Non-admin cannot access admin endpoints
    await request(stack.app)
      .get('/api/admin/audit-logs')
      .set('Cookie', ownerSession.cookie)
      .expect(403);

    await request(stack.app)
      .patch(`/api/admin/users/${targetUser.id}/status`)
      .set('Cookie', ownerSession.cookie)
      .set('x-csrf-token', ownerSession.csrf)
      .send({ isActive: true })
      .expect(403);
  });



  it('handles high-concurrency audit writes without hash chain forks or broken links', async () => {
    const stack = buildStack();
    const user = await createUser(stack, { email: 'concurrency@trustvault.local', role: 'owner' });

    // Spawn 20 simultaneous concurrent audit writes
    const writes = Array.from({ length: 20 }, (_, i) =>
      stack.authStore.recordAudit({
        userId: user.id,
        action: `concurrent.event.${i}`,
        outcome: 'success',
        metadata: { index: i },
      }),
    );

    const results = await Promise.all(writes);
    expect(results).toHaveLength(20);

    // Verify all entries form a 100% contiguous SHA-256 chain
    const verification = await stack.authStore.verifyAuditIntegrity();
    expect(verification.verified).toBe(true);
    expect(verification.failureReason).toBeUndefined();

    // Verify each row's prevHash matches exactly the predecessor's entryHash
    const logs = await stack.authStore.listAuditLogs({ limit: 100, offset: 0 });
    // listAuditLogs returns DESC; sort ASC to trace the chain
    const sorted = [...logs].sort((a, b) => Number(a.id) - Number(b.id));
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.prevHash).toBe(sorted[i - 1]!.entryHash);
    }
  });

  it('detects checkpoint tampering when checkpoint hash is modified', async () => {
    const stack = buildStack();
    const user = await createUser(stack, { email: 'checkpoint-test@trustvault.local', role: 'owner' });

    // Seed an audit event so there is an entry to checkpoint
    await stack.authStore.recordAudit({
      userId: user.id,
      action: 'checkpoint.initial',
      outcome: 'success',
    });

    // Create a checkpoint
    const cp = await stack.authStore.createCheckpoint();
    expect(cp).not.toBeNull();
    expect(cp?.checkpointSeq).toBe(1);

    // Pre-tamper verify passes
    const beforeVerify = await stack.authStore.verifyAuditIntegrity();
    expect(beforeVerify.verified).toBe(true);

    // Tamper with the checkpoint's stored hash
    stack.authStore.simulateCheckpointTamper(1, {
      checkpointHash: 'a'.repeat(64),
    });

    // Verification must catch the checkpoint hash mismatch
    const afterVerify = await stack.authStore.verifyAuditIntegrity();
    expect(afterVerify.verified).toBe(false);
    expect(afterVerify.failureReason).toContain('Checkpoint 1 hash mismatch');
  });

  it('preserves immutable audit history with original user UUIDs even when user accounts are altered', async () => {
    const stack = buildStack();
    const owner = await createUser(stack, { email: 'immutable@trustvault.local', role: 'owner' });
    const ownerSession = await login(stack, owner.email);

    // Record an action
    await request(stack.app)
      .post('/api/documents')
      .set('Cookie', ownerSession.cookie)
      .set('x-csrf-token', ownerSession.csrf)
      .attach('file', PDF_CONTENT, 'immutability-test.pdf')
      .expect(201);

    // Find the audit entry for upload
    const uploadAudit = stack.authStore.auditEvents.find((e) => e.action === 'document.uploaded');
    expect(uploadAudit).toBeDefined();
    expect(uploadAudit?.userId).toBe(owner.id);

    // Deactivate user account
    await stack.authStore.setUserActive(owner.id, false);

    // Verify the historical audit record still retains owner.id and ledger passes verification
    const reloadedAudit = stack.authStore.auditEvents.find((e) => e.action === 'document.uploaded');
    expect(reloadedAudit?.userId).toBe(owner.id);

    const integrity = await stack.authStore.verifyAuditIntegrity();
    expect(integrity.verified).toBe(true);
  });

  it('ensures user deletion (soft delete) deactivates user and revokes sessions while preserving historical audit payloads intact', async () => {
    const stack = buildStack();
    const user = await createUser(stack, { email: 'softdelete-audit@trustvault.local', role: 'owner' });
    const session = await login(stack, user.email);

    // Record an audit action
    await request(stack.app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .set('x-csrf-token', session.csrf)
      .attach('file', PDF_CONTENT, 'softdelete-contract.pdf')
      .expect(201);

    const uploadEntry = stack.authStore.auditEvents.find((e) => e.action === 'document.uploaded');
    expect(uploadEntry).toBeDefined();
    expect(uploadEntry?.userId).toBe(user.id);

    // Initial audit integrity passes
    const beforeDelete = await stack.authStore.verifyAuditIntegrity();
    expect(beforeDelete.verified).toBe(true);

    // Perform deletion-safe user account deletion
    const deleted = await stack.authStore.deleteUserAccount(user.id);
    expect(deleted).toBe(true);

    // Account is deactivated, PII anonymized
    const foundUser = await stack.authStore.findUserById(user.id);
    expect(foundUser?.isActive).toBe(false);
    expect(foundUser?.email).toContain(`deleted_${user.id}`);
    expect(foundUser?.displayName).toBe('Deleted Account');

    // Sessions are revoked
    const sessions = stack.authStore.sessionsFor(user.id);
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);

    // Crucially: historical audit log is unchanged - original userId preserved!
    const preservedEntry = stack.authStore.auditEvents.find((e) => e.action === 'document.uploaded');
    expect(preservedEntry?.userId).toBe(user.id);

    // Audit integrity check succeeds with zero tampering
    const afterDelete = await stack.authStore.verifyAuditIntegrity();
    expect(afterDelete.verified).toBe(true);
    expect(afterDelete.failureReason).toBeUndefined();
  });

  it('attests and surfaces recovery incidents for legacy cascade anomalies while strictly rejecting unexplained tampering', async () => {
    const stack = buildStack();
    const admin = await createUser(stack, { email: 'admin-recovery@trustvault.local', role: 'admin' });
    const user = await createUser(stack, { email: 'cascade-victim@trustvault.local', role: 'owner' });

    // Seed events
    await stack.authStore.recordAudit({
      userId: user.id,
      action: 'user_registered',
      outcome: 'success',
    });
    await stack.authStore.recordAudit({
      userId: user.id,
      action: 'logout',
      outcome: 'success',
    });

    const event1 = stack.authStore.auditEvents[0]!;
    const originalHash1 = event1.entryHash!;

    // Case 1: Unexplained tampering (payload corrupted without attestation)
    // Simulate legacy foreign-key cascade clearing userId to null
    event1.userId = null;

    const unverifiedResult = await stack.authStore.verifyAuditIntegrity();
    expect(unverifiedResult.verified).toBe(false);
    expect(unverifiedResult.failedAtId).toBe(event1.id);
    expect(unverifiedResult.failureReason).toContain('Tampered log content');

    // Case 2: Documented and attested recovery incident in registry
    stack.authStore.addRecoveryIncident({
      eventId: event1.id,
      incidentType: 'legacy_fk_cascade_null',
      action: event1.action,
      corruptedField: 'user_id',
      remediationStatus: 'explained_legacy_cascade',
      forensicNote: 'user_id was set to null by legacy relational foreign key cascade prior to migration 0008; chain intact',
    });

    // When attested with unbroken chain, verification succeeds with incident details
    const attestedResult = await stack.authStore.verifyAuditIntegrity();
    expect(attestedResult.verified).toBe(true);
    expect(attestedResult.failureReason).toBeUndefined();
    expect(attestedResult.incidents).toHaveLength(1);
    expect(attestedResult.incidents?.[0]?.eventId).toBe(event1.id);
    expect(attestedResult.incidents?.[0]?.remediationStatus).toBe('explained_legacy_cascade');

    // Case 3: If cryptographic chain itself is broken, verification MUST fail regardless of incident attestation
    event1.prevHash = 'broken_prev_hash_000000000000000000000000000000000000000000000000';
    const brokenChainResult = await stack.authStore.verifyAuditIntegrity();
    // For event 0 (if prevHash doesn't match GENESIS_HASH) or event 1 (if prevHash doesn't match event 0):
    const event2 = stack.authStore.auditEvents[1]!;
    event2.prevHash = 'broken_chain_link_11111111111111111111111111111111111111111111111';
    const brokenResult = await stack.authStore.verifyAuditIntegrity();
    expect(brokenResult.verified).toBe(false);
    expect(brokenResult.failureReason).toContain('Hash chain broken');
  });
});
