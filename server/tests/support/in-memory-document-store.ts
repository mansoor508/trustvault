import type {
  CreateDocumentInput,
  DocumentListResult,
  DocumentStore,
  DocumentViewer,
  ListDocumentsQuery,
  UpdateDocumentInput,
} from '../../src/documents/document-store.js';
import { likePattern } from '../../src/documents/document-store.js';
import type {
  DocumentAccessMode,
  DocumentWithStorage,
  PermissionRole,
} from '../../src/documents/types.js';

interface StoredDocument {
  id: string;
  ownerId: string;
  companyId?: string | null;
  title: string;
  description: string | null;
  fileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  status: 'active' | 'archived';
  category: CreateDocumentInput['category'];
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface DirectoryEntry {
  email: string;
  displayName: string | null;
}

/** Mirrors the LIKE escaping used by the MySQL store. */
function matchesLike(value: string, pattern: string): boolean {
  const escaped = pattern.slice(1, -1);
  const literal = escaped.replace(/!(.)/g, '$1').toLowerCase();
  return value.toLowerCase().includes(literal);
}

/**
 * Test double for DocumentStore.
 *
 * It reproduces the production access rule (admin OR owner OR grant), the soft
 * delete filter, search/filter semantics and stable ordering, so HTTP-level
 * tests exercise real authorization logic rather than a stub that always says
 * yes.
 */
export class InMemoryDocumentStore implements DocumentStore {
  readonly documents = new Map<string, StoredDocument>();
  readonly grants = new Map<string, Map<string, PermissionRole>>();
  private readonly directory = new Map<string, DirectoryEntry>();

  registerUser(id: string, email: string, displayName: string | null = null): void {
    this.directory.set(id, { email, displayName });
  }

  grant(documentId: string, userId: string, role: PermissionRole = 'viewer'): void {
    const existing = this.grants.get(documentId) ?? new Map<string, PermissionRole>();
    existing.set(userId, role);
    this.grants.set(documentId, existing);
  }

  revoke(documentId: string, userId: string): void {
    this.grants.get(documentId)?.delete(userId);
  }

  revokeGrantsForUserInCompany(userId: string, companyId: string): void {
    for (const [docId, doc] of this.documents.entries()) {
      if (doc.companyId === companyId) {
        this.grants.get(docId)?.delete(userId);
      }
    }
  }

  private ownerOf(document: StoredDocument): { id: string; email: string; displayName: string | null } {
    const entry = this.directory.get(document.ownerId);
    return {
      id: document.ownerId,
      email: entry?.email ?? 'unknown@example.test',
      displayName: entry?.displayName ?? null,
    };
  }

  private accessFor(
    document: StoredDocument,
    viewer: DocumentViewer,
  ): { mode: DocumentAccessMode; role: PermissionRole | null } | null {
    // 1. Explicit grant allows authorized access (including explicit cross-company sharing)
    const grant = this.grants.get(document.id)?.get(viewer.id);
    if (grant === 'editor' || grant === 'owner') return { mode: 'editor', role: grant };
    if (grant === 'viewer') return { mode: 'viewer', role: 'viewer' };

    // 2. Strict tenant isolation: ungranted access across companies is blocked
    if (viewer.companyId && document.companyId && viewer.companyId !== document.companyId) {
      return null;
    }

    // 3. Document owner has owner access
    if (document.ownerId === viewer.id) return { mode: 'owner', role: null };

    return null;
  }

  private toRecord(document: StoredDocument, access: NonNullable<ReturnType<InMemoryDocumentStore['accessFor']>>): DocumentWithStorage {
    return {
      id: document.id,
      companyId: document.companyId ?? null,
      owner: this.ownerOf(document),
      title: document.title,
      description: document.description,
      fileName: document.fileName,
      category: document.category,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      checksumSha256: document.checksumSha256,
      status: document.status,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      access: { mode: access.mode, permissionRole: access.role },
      storageKey: document.storageKey,
    };
  }

  async list(viewer: DocumentViewer, query: ListDocumentsQuery): Promise<DocumentListResult> {
    const visible = [...this.documents.values()].flatMap((document) => {
      if (document.deletedAt !== null) return [];
      const access = this.accessFor(document, viewer);
      if (!access) return [];
      return [{ document, access }];
    });

    const searchPattern = query.search === undefined ? null : likePattern(query.search);
    const ownerPattern = query.owner === undefined ? null : likePattern(query.owner);

    const filtered = visible.filter(({ document }) => {
      if (searchPattern !== null) {
        const matches =
          matchesLike(document.title, searchPattern) ||
          matchesLike(document.fileName, searchPattern);
        if (!matches) return false;
      }
      if (query.category !== undefined && document.category !== query.category) return false;

      if (ownerPattern !== null) {
        const owner = this.ownerOf(document);
        const matches =
          matchesLike(owner.email, ownerPattern) ||
          (owner.displayName !== null && matchesLike(owner.displayName, ownerPattern));
        if (!matches) return false;
      }

      if (query.createdFrom !== undefined && document.createdAt < query.createdFrom) return false;
      if (query.createdTo !== undefined && document.createdAt > query.createdTo) return false;

      if (query.scope === 'mine' && document.ownerId !== viewer.id) return false;
      if (query.scope === 'shared' && (document.ownerId === viewer.id || !this.grants.get(document.id)?.has(viewer.id))) return false;
      if (query.scope === 'company' && document.companyId !== viewer.companyId) return false;

      return true;
    });

    const direction = query.sort.order === 'asc' ? 1 : -1;
    filtered.sort((left, right) => {
      const a = left.document;
      const b = right.document;
      let comparison = 0;
      if (query.sort.field === 'title') comparison = a.title.localeCompare(b.title);
      else if (query.sort.field === 'size') comparison = a.sizeBytes - b.sizeBytes;
      else comparison = a.createdAt.getTime() - b.createdAt.getTime();
      if (comparison === 0) comparison = a.id.localeCompare(b.id);
      return comparison * direction;
    });

    const page = filtered.slice(query.offset, query.offset + query.limit);

    return {
      documents: page.map(({ document, access }) => this.toRecord(document, access)),
      total: filtered.length,
    };
  }

  async findAccessible(
    id: string,
    viewer: DocumentViewer,
  ): Promise<DocumentWithStorage | null> {
    const document = this.documents.get(id);
    if (!document || document.deletedAt !== null) return null;
    const access = this.accessFor(document, viewer);
    if (!access) return null;
    return this.toRecord(document, access);
  }

  async create(
    input: CreateDocumentInput,
    viewer: DocumentViewer,
  ): Promise<DocumentWithStorage> {
    const document: StoredDocument = {
      id: input.id,
      ownerId: input.ownerId,
      companyId: input.companyId ?? null,
      title: input.title,
      description: input.description,
      fileName: input.fileName,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
      status: 'active',
      category: input.category,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      deletedAt: null,
    };
    this.documents.set(document.id, document);

    const created = await this.findAccessible(document.id, viewer);
    if (!created) throw new Error('Created document is not visible to its owner');
    return created;
  }

  async update(id: string, input: UpdateDocumentInput): Promise<void> {
    const document = this.documents.get(id);
    if (!document || document.deletedAt !== null) return;
    document.title = input.title;
    document.description = input.description;
    document.category = input.category;
    document.updatedAt = input.updatedAt;
  }

  async softDelete(id: string, deletedAt: Date): Promise<boolean> {
    const document = this.documents.get(id);
    if (!document || document.deletedAt !== null) return false;
    document.deletedAt = deletedAt;
    document.updatedAt = deletedAt;
    return true;
  }
}
