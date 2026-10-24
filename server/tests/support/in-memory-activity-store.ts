import type {
  ActivityPage,
  AdminUserFilters,
  DocumentActivityStore,
  DirectoryUser,
  PageRequest,
} from '../../src/documents/activity-store.js';
import type { DocumentViewer } from '../../src/documents/document-store.js';
import type {
  ActivityEntry,
  AdminCompanyEntry,
  AdminOverview,
  AdminUserEntry,
  DocumentCategory,
  DocumentPermissionEntry,
  DocumentStats,
  PermissionRole,
} from '../../src/documents/types.js';
import type { InMemoryAuthStore } from './in-memory-auth-store.js';
import type { InMemoryDocumentStore } from './in-memory-document-store.js';

/**
 * Test double for DocumentActivityStore.
 *
 * Analytics and history are computed from the in-memory document/auth stores so
 * the numbers reflect the same access rule the HTTP layer uses. Permission
 * writes go through the document store's grant table, which is what the
 * authorization checks read.
 *
 * Deliberately simple (list-then-filter) — this is a test fixture, not a
 * performance-critical path.
 */
export class InMemoryDocumentActivityStore implements DocumentActivityStore {
  private readonly permissionMeta = new Map<
    string,
    { grantedBy: string; grantedAt: Date }
  >();

  constructor(
    private readonly documents: InMemoryDocumentStore,
    private readonly auth: InMemoryAuthStore,
  ) {}

  private metaKey(documentId: string, userId: string): string {
    return `${documentId}:${userId}`;
  }

  private userById(userId: string): { email: string; displayName: string | null } | null {
    const user = this.auth.users.get(userId);
    if (!user) return null;
    return { email: user.email, displayName: user.displayName };
  }

  async stats(viewer: DocumentViewer): Promise<DocumentStats> {
    const { documents } = await this.documents.list(viewer, {
      sort: { field: 'created_at', order: 'desc' },
      limit: 1_000,
      offset: 0,
    });

    const counts = new Map<DocumentCategory, number>();
    let totalBytes = 0;
    let ownedCount = 0;
    let sharedCount = 0;

    for (const document of documents) {
      totalBytes += document.sizeBytes;
      if (document.access.mode === 'owner' || document.access.mode === 'admin') {
        ownedCount += 1;
      } else {
        sharedCount += 1;
      }
      counts.set(document.category, (counts.get(document.category) ?? 0) + 1);
    }

    return {
      totalDocuments: documents.length,
      totalBytes,
      ownedCount,
      sharedCount,
      byCategory: [...counts.entries()].map(([category, count]) => ({ category, count })),
    };
  }

  async listPermissions(documentId: string): Promise<DocumentPermissionEntry[]> {
    const grants = this.documents.grants.get(documentId);
    if (!grants) return [];

    return [...grants.entries()].map(([userId, role]) => {
      const user = this.userById(userId);
      const meta = this.permissionMeta.get(this.metaKey(documentId, userId));
      const granter = meta ? this.userById(meta.grantedBy) : null;
      return {
        userId,
        email: user?.email ?? 'unknown@example.test',
        displayName: user?.displayName ?? null,
        role,
        grantedBy: meta && granter ? { id: meta.grantedBy, email: granter.email } : null,
        createdAt: meta?.grantedAt ?? new Date(0),
      };
    });
  }

  async findUserByEmail(email: string): Promise<DirectoryUser | null> {
    for (const user of this.auth.users.values()) {
      if (user.email === email.toLowerCase()) {
        return {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          isActive: user.isActive,
          companyId: user.companyId ?? null,
        };
      }
    }
    return null;
  }

  async upsertPermission(input: {
    documentId: string;
    userId: string;
    role: PermissionRole;
    grantedBy: string;
    now: Date;
  }): Promise<void> {
    this.documents.grant(input.documentId, input.userId, input.role);
    this.permissionMeta.set(this.metaKey(input.documentId, input.userId), {
      grantedBy: input.grantedBy,
      grantedAt: input.now,
    });
  }

  async removePermission(documentId: string, userId: string): Promise<boolean> {
    const grants = this.documents.grants.get(documentId);
    if (!grants?.has(userId)) return false;
    this.documents.revoke(documentId, userId);
    this.permissionMeta.delete(this.metaKey(documentId, userId));
    return true;
  }

  private toActivity(event: {
    id?: number | string;
    user_id?: string | null;
    action: string;
    outcome: 'success' | 'failure' | 'denied';
    resourceId?: string | null;
    metadata?: Record<string, unknown> | null;
  }, index: number): ActivityEntry {
    const document =
      event.resourceId !== undefined && event.resourceId !== null
        ? this.documents.documents.get(event.resourceId)
        : undefined;

    const actor = event.user_id !== undefined && event.user_id !== null
      ? this.auth.users.get(event.user_id)
      : undefined;

    return {
      id: String(event.id ?? index),
      action: event.action,
      outcome: event.outcome,
      actorId: event.user_id ?? null,
      actorEmail: actor?.email ?? null,
      documentId: event.resourceId ?? null,
      documentTitle: document?.title ?? null,
      metadata: event.metadata ?? null,
      createdAt: new Date(),
    };
  }

  /**
   * Like toActivity but redacts document title for viewers/admins who lack an
   * explicit permission grant or ownership, mirroring the MySQL CASE expression
   * added to historyForManager to address Finding 3 of the security review.
   */
  private toActivityWithTitleRedaction(
    event: Parameters<InMemoryDocumentActivityStore['toActivity']>[0],
    index: number,
    viewer: DocumentViewer,
  ): ActivityEntry {
    const base = this.toActivity(event, index);

    if (base.documentId === null || base.documentTitle === null) return base;

    const document = this.documents.documents.get(base.documentId);
    if (!document) return base;

    // Owner always sees the title.
    if (document.ownerId === viewer.id) return base;

    // Explicitly granted users see the title.
    const grant = this.documents.grants.get(base.documentId)?.get(viewer.id);
    if (grant !== undefined) return base;

    // Everyone else (including admins without a grant) gets redacted title.
    return { ...base, documentTitle: '[Restricted]' };
  }

  async historyForDocument(documentId: string, page: PageRequest): Promise<ActivityPage> {
    const events = this.auth.auditEvents
      .filter((event) => event.resourceType === 'document' && event.resourceId === documentId)
      .reverse();

    const entries = events
      .slice(page.offset, page.offset + page.limit)
      .map((event, index) => this.toActivity({ ...event, id: events.length - index }, index));

    return { entries, total: events.length };
  }

  async historyForManager(viewer: DocumentViewer, page: PageRequest): Promise<ActivityPage> {
    let manageable: Set<string>;
    if (viewer.role === 'admin') {
      manageable = new Set(this.documents.documents.keys());
    } else {
      const { documents } = await this.documents.list(viewer, {
        sort: { field: 'created_at', order: 'desc' },
        limit: 1_000,
        offset: 0,
      });

      manageable = new Set(
        documents
          .filter((document) => document.access.mode !== 'viewer')
          .map((document) => document.id),
      );
    }

    const events = this.auth.auditEvents
      .filter(
        (event) =>
          event.resourceType === 'document' &&
          event.resourceId !== undefined &&
          event.resourceId !== null &&
          manageable.has(event.resourceId),
      )
      .reverse();

    const entries = events
      .slice(page.offset, page.offset + page.limit)
      .map((event, index) => this.toActivityWithTitleRedaction(
        { ...event, id: undefined },
        index,
        viewer,
      ));

    return { entries, total: events.length };
  }

  async adminOverview(): Promise<AdminOverview> {
    const users = [...this.auth.users.values()];
    const documents = [...this.documents.documents.values()];
    const sessions = [...this.auth.sessions.values()];
    const activeUsers = users.filter((user) => user.isActive).length;
    const disabledUsers = users.filter((user) => !user.isActive).length;

    return {
      totalEmployees: users.length,
      totalCompanies: this.auth.companies.size,
      activeAccounts: activeUsers,
      disabledAccounts: disabledUsers,
      users: users.length,
      activeUsers,
      documents: documents.length,
      deletedDocuments: documents.filter((document) => document.deletedAt !== null).length,
      totalBytes: documents.reduce((sum, document) => sum + document.sizeBytes, 0),
      activeSessions: sessions.filter((session) => session.revokedAt === null).length,
      auditEvents: this.auth.auditEvents.length,
      grants: [...this.documents.grants.values()].reduce((sum, grants) => sum + grants.size, 0),
    };
  }

  async adminUsers(filters?: AdminUserFilters): Promise<AdminUserEntry[]> {
    let users = [...this.auth.users.values()];

    if (filters?.companyId) {
      if (filters.companyId === 'none' || filters.companyId === 'personal') {
        users = users.filter((u) => !u.companyId);
      } else {
        users = users.filter((u) => u.companyId === filters.companyId);
      }
    }

    if (filters?.search && filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      users = users.filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          (u.displayName && u.displayName.toLowerCase().includes(q)),
      );
    }

    if (filters?.role && filters.role.trim()) {
      users = users.filter((u) => u.role === filters.role);
    }

    if (filters?.status) {
      if (filters.status === 'active') {
        users = users.filter((u) => u.isActive);
      } else if (filters.status === 'disabled') {
        users = users.filter((u) => !u.isActive);
      }
    }

    return users.map((user) => {
      const company = user.companyId ? this.auth.companies.get(user.companyId) : null;
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        companyId: user.companyId ?? null,
        companyName: company?.name ?? null,
        role: user.role,
        isActive: user.isActive,
        createdAt: new Date(0),
        lastLoginAt: null,
        documentCount: [...this.documents.documents.values()].filter(
          (document) => document.ownerId === user.id && document.deletedAt === null,
        ).length,
      };
    });
  }

  async adminCompanies(): Promise<AdminCompanyEntry[]> {
    return [...this.auth.companies.values()].map((company) => {
      const employees = [...this.auth.users.values()].filter((u) => u.companyId === company.id);
      const docs = [...this.documents.documents.values()].filter(
        (d) => d.companyId === company.id && d.deletedAt === null,
      );
      return {
        id: company.id,
        name: company.name,
        domain: company.domain ?? null,
        createdAt: company.createdAt,
        employeeCount: employees.length,
        activeCount: employees.filter((u) => u.isActive).length,
        documentCount: docs.length,
      };
    });
  }
}
