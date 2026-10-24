import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/password.js';
import {
  buildStorageKey,
  InMemoryDocumentStorage,
  StorageKeyError,
  STORAGE_KEY_PATTERN,
} from '../src/documents/storage.js';
import { InMemoryAuthStore } from './support/in-memory-auth-store.js';
import { InMemoryDocumentStore } from './support/in-memory-document-store.js';
import { testEnv, testLogger } from './support/test-env.js';

const PASSWORD = 'Correct-Horse-Battery-9';
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

interface Session {
  cookie: string;
  csrf: string;
  userId: string;
}

interface Stack {
  app: ReturnType<typeof createApp>;
  authStore: InMemoryAuthStore;
  documentStore: InMemoryDocumentStore;
  storage: InMemoryDocumentStorage;
}

function buildStack(envOverrides: Record<string, string | undefined> = {}): Stack {
  const env = testEnv(envOverrides);
  const authStore = new InMemoryAuthStore();
  const documentStore = new InMemoryDocumentStore();
  const storage = new InMemoryDocumentStorage();

  const app = createApp({
    env,
    logger: testLogger(env),
    pingDatabase: async () => ({ ok: true, latencyMs: 1 }),
    authStore,
    documentStore,
    documentStorage: storage,
  });

  return { app, authStore, documentStore, storage };
}

async function createUser(
  stack: Stack,
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

async function login(stack: Stack, email: string): Promise<Session> {
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
  stack: Stack,
  session: Session,
  options: {
    buffer: Buffer;
    filename: string;
    contentType: string;
    fields?: Record<string, string>;
  },
) {
  let pending = request(stack.app)
    .post('/api/documents')
    .set('Cookie', session.cookie)
    .set('X-CSRF-Token', session.csrf);

  for (const [key, value] of Object.entries(options.fields ?? {})) {
    pending = pending.field(key, value);
  }

  return pending.attach('file', options.buffer, {
    filename: options.filename,
    contentType: options.contentType,
  });
}

function binaryParser(
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error: Error) => callback(error, Buffer.alloc(0)));
}

function download(stack: Stack, session: Session, id: string) {
  return request(stack.app)
    .get(`/api/documents/${id}/download`)
    .set('Cookie', session.cookie)
    .buffer(true)
    .parse(binaryParser as never);
}

function uploadPdf(
  stack: Stack,
  session: Session,
  fields: Record<string, string> = {},
  filename = 'report.pdf',
) {
  return upload(stack, session, {
    buffer: PDF,
    filename,
    contentType: 'application/pdf',
    fields,
  });
}

describe('POST /api/documents (upload)', () => {
  it('stores a valid PDF under a server-generated storage key', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const response = await uploadPdf(stack, session, {
      title: 'Q3 financial report',
      category: 'report',
      description: 'Revenue and churn',
    }).expect(201);

    const document = response.body.document;
    expect(document).toMatchObject({
      title: 'Q3 financial report',
      category: 'report',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
      access: { mode: 'owner', permissionRole: null },
    });
    expect(document.owner.email).toBe('owner@trustvault.local');
    expect(Number.isNaN(Date.parse(document.createdAt))).toBe(false);
    expect(document.checksumSha256).toMatch(/^[0-9a-f]{64}$/);

    // The storage key and the original filename must not leak into the API.
    expect(JSON.stringify(response.body)).not.toContain('storageKey');
    expect(document.storageKey).toBeUndefined();

    expect(stack.storage.files.size).toBe(1);
    const [storageKey, bytes] = [...stack.storage.files.entries()][0] ?? ['', Buffer.alloc(0)];
    expect(storageKey).toMatch(STORAGE_KEY_PATTERN);
    expect(storageKey).not.toContain('report');
    expect(Buffer.compare(bytes, PDF)).toBe(0);
  });

  it('rejects an unauthenticated upload and writes nothing', async () => {
    const stack = buildStack();

    await request(stack.app)
      .post('/api/documents')
      .attach('file', PDF, { filename: 'report.pdf', contentType: 'application/pdf' })
      .expect(401);

    expect(stack.storage.files.size).toBe(0);
  });

  it('rejects an upload without a CSRF token', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const response = await request(stack.app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .attach('file', PDF, { filename: 'report.pdf', contentType: 'application/pdf' })
      .expect(403);

    expect(response.body.error.code).toBe('CSRF_TOKEN_INVALID');
    expect(stack.storage.files.size).toBe(0);
  });

  it('rejects an unsupported extension', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const response = await upload(stack, session, {
      buffer: Buffer.from('MZ\u0090\u0000executable', 'binary'),
      filename: 'malware.exe',
      contentType: 'application/octet-stream',
    }).expect(415);

    expect(response.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(stack.storage.files.size).toBe(0);
  });

  it('rejects content that does not match the extension', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const response = await upload(stack, session, {
      buffer: PNG,
      filename: 'not-really-a.pdf',
      contentType: 'application/pdf',
    }).expect(415);

    expect(response.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    expect(response.body.error.message).toContain('does not look like');
    expect(stack.storage.files.size).toBe(0);
  });

  it('rejects an empty file', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const response = await upload(stack, session, {
      buffer: Buffer.alloc(0),
      filename: 'empty.pdf',
      contentType: 'application/pdf',
    }).expect(422);

    expect(response.body.error.message).toContain('empty');
  });

  it('rejects a file without an extension', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    await upload(stack, session, {
      buffer: PDF,
      filename: 'no-extension',
      contentType: 'application/pdf',
    }).expect(422);
  });

  it('rejects a file above the configured size limit', async () => {
    const stack = buildStack({ MAX_UPLOAD_BYTES: '1024' });
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const oversized = Buffer.concat([PDF, Buffer.alloc(4_000, 0x41)]);

    const response = await upload(stack, session, {
      buffer: oversized,
      filename: 'big.pdf',
      contentType: 'application/pdf',
    }).expect(413);

    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(stack.storage.files.size).toBe(0);
  });

  it('never uses the uploaded filename as a filesystem path', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const response = await uploadPdf(
      stack,
      session,
      { title: 'Traversal attempt' },
      '../../../etc/passwd.pdf',
    ).expect(201);

    expect(response.body.document.fileName).toBe('passwd.pdf');
    const [storageKey] = [...stack.storage.files.keys()];
    expect(storageKey).toMatch(STORAGE_KEY_PATTERN);
    expect(storageKey).not.toContain('..');
    expect(storageKey).not.toContain('passwd');
  });

  it('gives two uploads of the same filename distinct storage keys', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const first = await uploadPdf(stack, session, { title: 'First' }).expect(201);
    const second = await uploadPdf(stack, session, { title: 'Second' }).expect(201);

    expect(first.body.document.id).not.toBe(second.body.document.id);
    expect(stack.storage.files.size).toBe(2);
  });
});

describe('GET /api/documents (listing and search)', () => {
  it('lists only documents the viewer is allowed to discover', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner-a@trustvault.local', role: 'owner' });
    await createUser(stack, { email: 'owner-b@trustvault.local', role: 'owner' });
    await createUser(stack, { email: 'admin@trustvault.local', role: 'admin' });
    await createUser(stack, { email: 'stranger@trustvault.local', role: 'viewer' });

    const sessionA = await login(stack, 'owner-a@trustvault.local');
    const sessionB = await login(stack, 'owner-b@trustvault.local');
    const adminSession = await login(stack, 'admin@trustvault.local');
    const strangerSession = await login(stack, 'stranger@trustvault.local');

    await uploadPdf(stack, sessionA, { title: 'A report' }, 'a.pdf').expect(201);
    await uploadPdf(stack, sessionB, { title: 'B report' }, 'b.pdf').expect(201);

    const own = await request(stack.app)
      .get('/api/documents')
      .set('Cookie', sessionA.cookie)
      .expect(200);
    expect(own.body.documents).toHaveLength(1);
    expect(own.body.documents[0].title).toBe('A report');
    expect(own.body.pagination.total).toBe(1);

    const stranger = await request(stack.app)
      .get('/api/documents')
      .set('Cookie', strangerSession.cookie)
      .expect(200);
    expect(stranger.body.documents).toHaveLength(0);

    const admin = await request(stack.app)
      .get('/api/documents')
      .set('Cookie', adminSession.cookie)
      .expect(200);
    // Administrators do not automatically have permission to read document contents
    expect(admin.body.documents).toHaveLength(0);
  });

  it('includes documents shared through an active permission grant', async () => {
    const stack = buildStack();
    const owner = await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');

    const uploaded = await uploadPdf(stack, ownerSession, { title: 'Shared plan' }).expect(201);
    const documentId = uploaded.body.document.id as string;

    const before = await request(stack.app)
      .get('/api/documents')
      .set('Cookie', viewerSession.cookie)
      .expect(200);
    expect(before.body.documents).toHaveLength(0);

    stack.documentStore.grant(documentId, viewer.id, 'viewer');

    const after = await request(stack.app)
      .get('/api/documents')
      .set('Cookie', viewerSession.cookie)
      .expect(200);
    expect(after.body.documents).toHaveLength(1);
    expect(after.body.documents[0].access.mode).toBe('viewer');
    expect(after.body.documents[0].owner.email).toBe('owner@trustvault.local');
    expect(after.body.documents[0].owner.id).toBe(owner.id);
  });

  it('searches by title and file name', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    await uploadPdf(stack, session, { title: 'Quarterly report' }, 'q3.pdf').expect(201);
    await uploadPdf(stack, session, { title: 'Invoice batch' }, 'inv.pdf').expect(201);

    const byTitle = await request(stack.app)
      .get('/api/documents?search=quarterly')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(byTitle.body.documents).toHaveLength(1);
    expect(byTitle.body.documents[0].title).toBe('Quarterly report');

    const byFileName = await request(stack.app)
      .get('/api/documents?search=inv.pdf')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(byFileName.body.documents).toHaveLength(1);
    expect(byFileName.body.documents[0].fileName).toBe('inv.pdf');
  });

  it('filters by category and by owner', async () => {
    const stack = buildStack();
    await createUser(stack, {
      email: 'owner@trustvault.local',
      role: 'owner',
      displayName: 'Owen Owner',
    });
    await createUser(stack, { email: 'admin@trustvault.local', role: 'admin' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const adminSession = await login(stack, 'admin@trustvault.local');

    await uploadPdf(stack, ownerSession, { title: 'Contract', category: 'contract' }).expect(201);
    await uploadPdf(stack, ownerSession, { title: 'Invoice', category: 'invoice' }).expect(201);

    const byCategory = await request(stack.app)
      .get('/api/documents?category=contract')
      .set('Cookie', ownerSession.cookie)
      .expect(200);
    expect(byCategory.body.documents).toHaveLength(1);
    expect(byCategory.body.documents[0].title).toBe('Contract');

    const byOwnerEmail = await request(stack.app)
      .get('/api/documents?owner=owner@trustvault.local')
      .set('Cookie', ownerSession.cookie)
      .expect(200);
    expect(byOwnerEmail.body.documents).toHaveLength(2);

    const byOwnerName = await request(stack.app)
      .get('/api/documents?owner=Owen')
      .set('Cookie', ownerSession.cookie)
      .expect(200);
    expect(byOwnerName.body.documents).toHaveLength(2);

    const noMatch = await request(stack.app)
      .get('/api/documents?owner=nobody@trustvault.local')
      .set('Cookie', ownerSession.cookie)
      .expect(200);
    expect(noMatch.body.documents).toHaveLength(0);
  });

  it('filters by creation date', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');
    await uploadPdf(stack, session).expect(201);

    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    const inRange = await request(stack.app)
      .get(`/api/documents?from=${today}&to=${today}`)
      .set('Cookie', session.cookie)
      .expect(200);
    expect(inRange.body.documents).toHaveLength(1);

    const future = await request(stack.app)
      .get(`/api/documents?from=${tomorrow}`)
      .set('Cookie', session.cookie)
      .expect(200);
    expect(future.body.documents).toHaveLength(0);
  });

  it('escapes LIKE wildcards instead of matching everything', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');
    await uploadPdf(stack, session, { title: 'Quarterly report' }).expect(201);

    const response = await request(stack.app)
      .get('/api/documents?search=%25')
      .set('Cookie', session.cookie)
      .expect(200);

    // A literal "%" is not in the title, so an escaped search returns nothing.
    expect(response.body.documents).toHaveLength(0);
  });

  it('paginates results', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    await uploadPdf(stack, session, { title: 'One' }).expect(201);
    await uploadPdf(stack, session, { title: 'Two' }).expect(201);
    await uploadPdf(stack, session, { title: 'Three' }).expect(201);

    const firstPage = await request(stack.app)
      .get('/api/documents?limit=2&offset=0')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(firstPage.body.documents).toHaveLength(2);
    expect(firstPage.body.pagination).toEqual({ limit: 2, offset: 0, total: 3 });

    const secondPage = await request(stack.app)
      .get('/api/documents?limit=2&offset=2')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(secondPage.body.documents).toHaveLength(1);

    // Dashboard query: limit=6, sort=created_at, order=desc
    const dashboardQuery = await request(stack.app)
      .get('/api/documents?limit=6&sort=created_at&order=desc')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(dashboardQuery.body.documents).toHaveLength(3);
    expect(dashboardQuery.body.pagination).toEqual({ limit: 6, offset: 0, total: 3 });
  });

  it('rejects invalid or negative pagination parameters with 422', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    await request(stack.app)
      .get('/api/documents?limit=-1')
      .set('Cookie', session.cookie)
      .expect(422);

    await request(stack.app)
      .get('/api/documents?limit=0')
      .set('Cookie', session.cookie)
      .expect(422);

    await request(stack.app)
      .get('/api/documents?offset=-5')
      .set('Cookie', session.cookie)
      .expect(422);
  });

  it('requires a session to list documents', async () => {
    const stack = buildStack();
    await request(stack.app).get('/api/documents').expect(401);
  });
});

describe('GET /api/documents/:id (metadata)', () => {
  it('returns metadata without the storage key', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');
    const uploaded = await uploadPdf(stack, session, { title: 'Spec' }).expect(201);

    const response = await request(stack.app)
      .get(`/api/documents/${uploaded.body.document.id}`)
      .set('Cookie', session.cookie)
      .expect(200);

    expect(response.body.document.title).toBe('Spec');
    expect(response.body.document.storageKey).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('storageKey');
  });

  it('returns 404 for an unrelated user', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    await createUser(stack, { email: 'stranger@trustvault.local', role: 'viewer' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const strangerSession = await login(stack, 'stranger@trustvault.local');

    const uploaded = await uploadPdf(stack, ownerSession).expect(201);

    const response = await request(stack.app)
      .get(`/api/documents/${uploaded.body.document.id}`)
      .set('Cookie', strangerSession.cookie)
      .expect(404);

    expect(response.body.error.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it('returns 404 for a malformed id instead of hitting the database', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    await request(stack.app)
      .get('/api/documents/not-a-uuid')
      .set('Cookie', session.cookie)
      .expect(404);
  });
});

describe('PATCH /api/documents/:id (metadata edits)', () => {
  it('lets the owner edit title, description and category', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');
    const uploaded = await uploadPdf(stack, session).expect(201);

    const response = await request(stack.app)
      .patch(`/api/documents/${uploaded.body.document.id}`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ title: 'Renamed', description: 'Updated notes', category: 'invoice' })
      .expect(200);

    expect(response.body.document).toMatchObject({
      title: 'Renamed',
      description: 'Updated notes',
      category: 'invoice',
    });
    expect(Date.parse(response.body.document.updatedAt)).toBeGreaterThanOrEqual(
      Date.parse(response.body.document.createdAt),
    );
  });

  it('forbids a viewer with read-only access', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');

    const uploaded = await uploadPdf(stack, ownerSession).expect(201);
    stack.documentStore.grant(uploaded.body.document.id, viewer.id, 'viewer');

    const response = await request(stack.app)
      .patch(`/api/documents/${uploaded.body.document.id}`)
      .set('Cookie', viewerSession.cookie)
      .set('X-CSRF-Token', viewerSession.csrf)
      .send({ title: 'Hijacked' })
      .expect(403);

    expect(response.body.error.code).toBe('DOCUMENT_FORBIDDEN');
  });

  it('lets a co-owner edit', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const coOwner = await createUser(stack, { email: 'coowner@trustvault.local', role: 'viewer' });

    const ownerSession = await login(stack, 'owner@trustvault.local');
    const coOwnerSession = await login(stack, 'coowner@trustvault.local');

    const uploaded = await uploadPdf(stack, ownerSession).expect(201);
    stack.documentStore.grant(uploaded.body.document.id, coOwner.id, 'owner');

    await request(stack.app)
      .patch(`/api/documents/${uploaded.body.document.id}`)
      .set('Cookie', coOwnerSession.cookie)
      .set('X-CSRF-Token', coOwnerSession.csrf)
      .send({ title: 'Edited by co-owner' })
      .expect(200);
  });

  it('rejects an empty patch and an unknown category', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');
    const uploaded = await uploadPdf(stack, session).expect(201);

    await request(stack.app)
      .patch(`/api/documents/${uploaded.body.document.id}`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({})
      .expect(422);

    await request(stack.app)
      .patch(`/api/documents/${uploaded.body.document.id}`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ category: 'not-a-category' })
      .expect(422);
  });

  it('returns 404 for an unrelated user', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    await createUser(stack, { email: 'stranger@trustvault.local', role: 'viewer' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const strangerSession = await login(stack, 'stranger@trustvault.local');

    const uploaded = await uploadPdf(stack, ownerSession).expect(201);

    await request(stack.app)
      .patch(`/api/documents/${uploaded.body.document.id}`)
      .set('Cookie', strangerSession.cookie)
      .set('X-CSRF-Token', strangerSession.csrf)
      .send({ title: 'Nope' })
      .expect(404);
  });

  it('allows an authorized editor to edit metadata, but rejects an ungranted admin', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const editor = await createUser(stack, { email: 'editor@trustvault.local', role: 'viewer' });
    await createUser(stack, { email: 'admin@trustvault.local', role: 'admin' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const editorSession = await login(stack, 'editor@trustvault.local');
    const adminSession = await login(stack, 'admin@trustvault.local');

    const uploaded = await uploadPdf(stack, ownerSession).expect(201);
    const documentId = uploaded.body.document.id as string;

    // Admin without explicit grant cannot edit (denied by default, 404)
    await request(stack.app)
      .patch(`/api/documents/${documentId}`)
      .set('Cookie', adminSession.cookie)
      .set('X-CSRF-Token', adminSession.csrf)
      .send({ category: 'identity' })
      .expect(404);

    // Grant edit access to the editor
    stack.documentStore.grant(documentId, editor.id, 'editor');

    // Editor can edit metadata
    await request(stack.app)
      .patch(`/api/documents/${documentId}`)
      .set('Cookie', editorSession.cookie)
      .set('X-CSRF-Token', editorSession.csrf)
      .send({ category: 'identity' })
      .expect(200);
  });
});

describe('GET /api/documents/:id/download', () => {
  it('streams the exact bytes to the owner as an attachment', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');
    const uploaded = await uploadPdf(stack, session).expect(201);

    const response = await download(stack, session, uploaded.body.document.id).expect(200);

    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toContain('report.pdf');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(Buffer.compare(response.body as Buffer, PDF)).toBe(0);
  });

  it('rejects an unauthenticated download', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');
    const uploaded = await uploadPdf(stack, session).expect(201);

    await request(stack.app)
      .get(`/api/documents/${uploaded.body.document.id}/download`)
      .expect(401);
  });

  it('returns 404 for a user without a grant', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    await createUser(stack, { email: 'stranger@trustvault.local', role: 'viewer' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const strangerSession = await login(stack, 'stranger@trustvault.local');
    const uploaded = await uploadPdf(stack, ownerSession).expect(201);

    const response = await request(stack.app)
      .get(`/api/documents/${uploaded.body.document.id}/download`)
      .set('Cookie', strangerSession.cookie)
      .expect(404);

    expect(response.body.error.code).toBe('DOCUMENT_NOT_FOUND');
  });

  it('allows a granted viewer to download', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');
    const uploaded = await uploadPdf(stack, ownerSession).expect(201);

    stack.documentStore.grant(uploaded.body.document.id, viewer.id, 'viewer');

    const response = await download(stack, viewerSession, uploaded.body.document.id).expect(200);
    expect(Buffer.compare(response.body as Buffer, PDF)).toBe(0);
  });

  it('refuses to download a soft-deleted document', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');
    const uploaded = await uploadPdf(stack, session).expect(201);
    const id = uploaded.body.document.id as string;

    await request(stack.app)
      .delete(`/api/documents/${id}`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .expect(204);

    await request(stack.app)
      .get(`/api/documents/${id}/download`)
      .set('Cookie', session.cookie)
      .expect(404);

    // Soft delete keeps the bytes for recovery; it just stops serving them.
    expect(stack.storage.files.size).toBe(1);
  });

  it('never exposes a storage path or a public link', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');
    const uploaded = await uploadPdf(stack, session).expect(201);

    const response = await download(stack, session, uploaded.body.document.id).expect(200);

    expect(response.headers['location']).toBeUndefined();
    const storageKey = [...stack.storage.files.keys()][0] ?? '';
    expect(storageKey.length).toBeGreaterThan(0);
    expect(JSON.stringify(response.headers)).not.toContain(storageKey);
  });
});

describe('DELETE /api/documents/:id (soft delete)', () => {
  it('soft-deletes for the owner and hides the document', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');
    const uploaded = await uploadPdf(stack, session).expect(201);
    const id = uploaded.body.document.id as string;

    await request(stack.app)
      .delete(`/api/documents/${id}`)
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .expect(204);

    await request(stack.app).get(`/api/documents/${id}`).set('Cookie', session.cookie).expect(404);

    const list = await request(stack.app)
      .get('/api/documents')
      .set('Cookie', session.cookie)
      .expect(200);
    expect(list.body.documents).toHaveLength(0);
  });

  it('forbids a granted viewer from deleting', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const viewer = await createUser(stack, { email: 'viewer@trustvault.local', role: 'viewer' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const viewerSession = await login(stack, 'viewer@trustvault.local');
    const uploaded = await uploadPdf(stack, ownerSession).expect(201);

    stack.documentStore.grant(uploaded.body.document.id, viewer.id, 'viewer');

    const response = await request(stack.app)
      .delete(`/api/documents/${uploaded.body.document.id}`)
      .set('Cookie', viewerSession.cookie)
      .set('X-CSRF-Token', viewerSession.csrf)
      .expect(403);

    expect(response.body.error.code).toBe('DOCUMENT_FORBIDDEN');
  });

  it('requires CSRF for deletion', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');
    const uploaded = await uploadPdf(stack, session).expect(201);

    await request(stack.app)
      .delete(`/api/documents/${uploaded.body.document.id}`)
      .set('Cookie', session.cookie)
      .expect(403);
  });

  it('returns 404 for an unrelated user', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    await createUser(stack, { email: 'stranger@trustvault.local', role: 'viewer' });
    const ownerSession = await login(stack, 'owner@trustvault.local');
    const strangerSession = await login(stack, 'stranger@trustvault.local');
    const uploaded = await uploadPdf(stack, ownerSession).expect(201);

    await request(stack.app)
      .delete(`/api/documents/${uploaded.body.document.id}`)
      .set('Cookie', strangerSession.cookie)
      .set('X-CSRF-Token', strangerSession.csrf)
      .expect(404);
  });
});

describe('private storage invariants', () => {
  it('rejects path traversal in storage keys', async () => {
    const storage = new InMemoryDocumentStorage();

    await expect(storage.open('../../etc/passwd')).rejects.toBeInstanceOf(StorageKeyError);
    await expect(storage.remove('../secrets.env')).rejects.toBeInstanceOf(StorageKeyError);
  });

  it('rejects an absolute storage key', async () => {
    const storage = new InMemoryDocumentStorage();
    await expect(storage.open('/etc/passwd')).rejects.toBeInstanceOf(StorageKeyError);
  });

  it('builds keys only from server-controlled values', () => {
    expect(() =>
      buildStorageKey({
        documentId: '../../etc/passwd',
        extension: 'pdf',
        now: new Date('2026-10-20T00:00:00Z'),
      }),
    ).toThrow(StorageKeyError);

    expect(
      buildStorageKey({
        documentId: '11111111-2222-4333-8444-555555555555',
        extension: 'pdf',
        now: new Date('2026-10-20T00:00:00Z'),
      }),
    ).toBe('2026/10/11111111-2222-4333-8444-555555555555.pdf');
  });
});

describe('file uploads from deployed frontend and origin validation', () => {
  const DEPLOYED_ORIGIN = 'https://trustvault-app-1i2l.onrender.com';
  const DOCX = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('[Content_Types].xml', 'utf8'),
    Buffer.from('word/document.xml', 'utf8'),
  ]);

  it('allows PDF upload from the deployed Render frontend origin', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const res = await request(stack.app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .set('Origin', DEPLOYED_ORIGIN)
      .attach('file', PDF, { filename: 'raja_resume.pdf', contentType: 'application/pdf' })
      .expect(201);

    expect(res.body.document.fileName).toBe('raja_resume.pdf');
    expect(res.body.document.mimeType).toBe('application/pdf');
  });

  it('allows DOCX upload from the deployed Render frontend origin', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const res = await request(stack.app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .set('Origin', DEPLOYED_ORIGIN)
      .attach('file', DOCX, {
        filename: 'contract.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      .expect(201);

    expect(res.body.document.fileName).toBe('contract.docx');
    expect(res.body.document.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('allows image (PNG) upload from the deployed Render frontend origin', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const res = await request(stack.app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .set('Origin', DEPLOYED_ORIGIN)
      .attach('file', PNG, { filename: 'screenshot.png', contentType: 'image/png' })
      .expect(201);

    expect(res.body.document.fileName).toBe('screenshot.png');
    expect(res.body.document.mimeType).toBe('image/png');
  });

  it('allows upload when Origin is absent but Referer is the deployed frontend', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const res = await request(stack.app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .set('Referer', `${DEPLOYED_ORIGIN}/documents/new`)
      .attach('file', PDF, { filename: 'via_referer.pdf', contentType: 'application/pdf' })
      .expect(201);

    expect(res.body.document.fileName).toBe('via_referer.pdf');
  });

  it('rejects upload from an untrusted origin with 403 ORIGIN_NOT_ALLOWED', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const res = await request(stack.app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .set('Origin', 'https://attacker.example.com')
      .attach('file', PDF, { filename: 'malicious.pdf', contentType: 'application/pdf' })
      .expect(403);

    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(res.body.error.message).toMatch(/This origin is not allowed/);
  });

  it('rejects upload from an arbitrary foreign Render service with 403 ORIGIN_NOT_ALLOWED', async () => {
    const stack = buildStack();
    await createUser(stack, { email: 'owner@trustvault.local', role: 'owner' });
    const session = await login(stack, 'owner@trustvault.local');

    const res = await request(stack.app)
      .post('/api/documents')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .set('Origin', 'https://evil-hacker.onrender.com')
      .attach('file', PDF, { filename: 'evil.pdf', contentType: 'application/pdf' })
      .expect(403);

    expect(res.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    expect(res.body.error.message).toMatch(/This origin is not allowed/);
  });
});

