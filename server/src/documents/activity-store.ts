import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { UserRole } from '../auth/types.js';
import type {
  ActivityEntry,
  AdminCompanyEntry,
  AdminOverview,
  AdminUserEntry,
  DocumentCategory,
  DocumentPermissionEntry,
  DocumentStats,
  PermissionRole,
} from './types.js';

export interface AdminUserFilters {
  companyId?: string;
  search?: string;
  role?: string;
  status?: 'active' | 'disabled';
}
import type { DocumentViewer } from './document-store.js';

export interface DirectoryUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  isActive: boolean;
  companyId?: string | null;
}

export interface PermissionPage {
  entries: DocumentPermissionEntry[];
}

export interface ActivityPage {
  entries: ActivityEntry[];
  total: number;
}

export interface PageRequest {
  limit: number;
  offset: number;
}

/**
 * Read/write queries that support sharing, analytics, history and the admin
 * dashboard. Kept separate from DocumentStore so the document CRUD paths stay
 * small and the authorization checks stay in one service.
 */
export interface DocumentActivityStore {
  stats(viewer: DocumentViewer): Promise<DocumentStats>;
  listPermissions(documentId: string): Promise<DocumentPermissionEntry[]>;
  findUserByEmail(email: string): Promise<DirectoryUser | null>;
  upsertPermission(input: {
    documentId: string;
    userId: string;
    role: PermissionRole;
    grantedBy: string;
    now: Date;
  }): Promise<void>;
  removePermission(documentId: string, userId: string): Promise<boolean>;
  historyForDocument(documentId: string, page: PageRequest): Promise<ActivityPage>;
  historyForManager(viewer: DocumentViewer, page: PageRequest): Promise<ActivityPage>;
  adminOverview(): Promise<AdminOverview>;
  adminUsers(filters?: AdminUserFilters): Promise<AdminUserEntry[]>;
  adminCompanies(): Promise<AdminCompanyEntry[]>;
}

interface StatsRow extends RowDataPacket {
  total: number | string;
  bytes: number | string;
  owned: number | string;
  shared: number | string;
}

interface CategoryRow extends RowDataPacket {
  category: DocumentCategory;
  count: number | string;
}

interface PermissionRow extends RowDataPacket {
  user_id: string;
  role: PermissionRole;
  created_at: Date;
  email: string;
  display_name: string | null;
  granted_by_id: string | null;
  granted_by_email: string | null;
}

interface DirectoryRow extends RowDataPacket {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'owner' | 'viewer';
  is_active: number;
  company_id: string | null;
}

interface ActivityRow extends RowDataPacket {
  id: string | number;
  action: string;
  outcome: 'success' | 'failure';
  user_id: string | null;
  actor_email: string | null;
  document_id: string | null;
  document_title: string | null;
  metadata: unknown;
  created_at: Date;
}

interface CountRow extends RowDataPacket {
  total: number | string;
}

interface OverviewRow extends RowDataPacket {
  users: number | string;
  active_users: number | string;
  disabled_users?: number | string;
}

interface DocumentOverviewRow extends RowDataPacket {
  documents: number | string;
  deleted_documents: number | string;
  total_bytes: number | string;
}

interface SingleCountRow extends RowDataPacket {
  total: number | string;
}

interface AdminUserRow extends RowDataPacket {
  id: string;
  email: string;
  display_name: string | null;
  company_id: string | null;
  company_name: string | null;
  role: 'platform_admin' | 'owner' | 'admin' | 'editor' | 'viewer';
  is_active: number;
  created_at: Date;
  last_login_at: Date | null;
  document_count: number | string;
}

interface AdminCompanyRow extends RowDataPacket {
  id: string;
  name: string;
  domain: string | null;
  created_at: Date;
  employee_count: number | string;
  active_count: number | string;
  document_count: number | string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function parseMetadata(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function toActivity(row: ActivityRow): ActivityEntry {
  return {
    id: String(row.id),
    action: row.action,
    outcome: row.outcome,
    actorId: row.user_id,
    actorEmail: row.actor_email,
    documentId: row.document_id,
    documentTitle: row.document_title,
    metadata: parseMetadata(row.metadata),
    createdAt: toDate(row.created_at),
  };
}

export class MySqlDocumentActivityStore implements DocumentActivityStore {
  constructor(private readonly pool: Pool) {}

  async stats(viewer: DocumentViewer): Promise<DocumentStats> {
    const access = viewer.companyId
      ? `d.deleted_at IS NULL AND (d.company_id = ? OR d.owner_id = ? OR p.user_id IS NOT NULL)`
      : `d.deleted_at IS NULL AND (d.owner_id = ? OR p.user_id IS NOT NULL)`;
    const accessParams = viewer.companyId ? [viewer.companyId, viewer.id] : [viewer.id];

    const [totals] = await this.pool.execute<StatsRow[]>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(d.size_bytes), 0) AS bytes,
              COALESCE(SUM(d.owner_id = ?), 0) AS owned,
              COALESCE(SUM(d.owner_id <> ?), 0) AS shared
         FROM documents d
         LEFT JOIN document_permissions p
                ON p.document_id = d.id AND p.user_id = ?
        WHERE ${access}`,
      [viewer.id, viewer.id, viewer.id, ...accessParams],
    );

    const [byCategory] = await this.pool.execute<CategoryRow[]>(
      `SELECT d.category, COUNT(*) AS count
         FROM documents d
         LEFT JOIN document_permissions p
                ON p.document_id = d.id AND p.user_id = ?
        WHERE ${access}
        GROUP BY d.category
        ORDER BY d.category ASC`,
      [viewer.id, ...accessParams],
    );

    const total = totals[0];
    return {
      totalDocuments: Number(total?.total ?? 0),
      totalBytes: Number(total?.bytes ?? 0),
      ownedCount: Number(total?.owned ?? 0),
      sharedCount: Number(total?.shared ?? 0),
      byCategory: byCategory.map((row) => ({
        category: row.category,
        count: Number(row.count),
      })),
    };
  }

  async listPermissions(documentId: string): Promise<DocumentPermissionEntry[]> {
    const [rows] = await this.pool.execute<PermissionRow[]>(
      `SELECT p.user_id, p.role, p.created_at,
              u.email, u.display_name,
              g.id AS granted_by_id, g.email AS granted_by_email
         FROM document_permissions p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN users g ON g.id = p.granted_by
        WHERE p.document_id = ?
        ORDER BY p.created_at ASC, u.email ASC`,
      [documentId],
    );

    return rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      grantedBy:
        row.granted_by_id !== null
          ? { id: row.granted_by_id, email: row.granted_by_email ?? '' }
          : null,
      createdAt: toDate(row.created_at),
    }));
  }

  async findUserByEmail(email: string): Promise<DirectoryUser | null> {
    const [rows] = await this.pool.execute<DirectoryRow[]>(
      `SELECT id, email, display_name, role, is_active, company_id
         FROM users
        WHERE email = ?
        LIMIT 1`,
      [email],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role,
      isActive: row.is_active === 1,
      companyId: row.company_id ?? null,
    };
  }

  async upsertPermission(input: {
    documentId: string;
    userId: string;
    role: PermissionRole;
    grantedBy: string;
    now: Date;
  }): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const id = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO document_permissions (id, document_id, user_id, role, granted_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           role = VALUES(role),
           granted_by = VALUES(granted_by),
           updated_at = ?`,
        [id, input.documentId, input.userId, input.role, input.grantedBy, input.now, input.now],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async removePermission(documentId: string, userId: string): Promise<boolean> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        'DELETE FROM document_permissions WHERE document_id = ? AND user_id = ?',
        [documentId, userId],
      );
      await connection.commit();
      return result.affectedRows > 0;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async historyForDocument(documentId: string, page: PageRequest): Promise<ActivityPage> {
    const limit = Math.min(Math.max(Math.trunc(Number(page.limit) || 25), 1), 100);
    const offset = Math.min(Math.max(Math.trunc(Number(page.offset) || 0), 0), 1_000_000);

    const [rows] = await this.pool.query<ActivityRow[]>(
      `SELECT a.id, a.action, a.outcome, a.user_id, u.email AS actor_email,
              a.resource_id AS document_id, d.title AS document_title,
              a.metadata, a.created_at
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN documents d ON d.id = a.resource_id AND a.resource_type = 'document'
        WHERE a.resource_type = 'document' AND a.resource_id = ?
        ORDER BY a.id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      [documentId],
    );

    const [countRows] = await this.pool.query<CountRow[]>(
      `SELECT COUNT(*) AS total
         FROM audit_logs a
        WHERE a.resource_type = 'document' AND a.resource_id = ?`,
      [documentId],
    );

    return {
      entries: rows.map(toActivity),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async historyForManager(viewer: DocumentViewer, page: PageRequest): Promise<ActivityPage> {
    const limit = Math.min(Math.max(Math.trunc(Number(page.limit) || 25), 1), 100);
    const offset = Math.min(Math.max(Math.trunc(Number(page.offset) || 0), 0), 1_000_000);
    const managePredicate = `(? = 'admin' OR d.owner_id = ? OR p.user_id IS NOT NULL)`;

    // Administrators may read the audit event itself (actor, action, outcome,
    // timestamp) for governance purposes, but they must NOT see the document
    // title unless they hold an explicit grant or own the document.  Exposing
    // titles to admins who lack a grant leaks confidential metadata (e.g. an
    // M&A document title visible to infrastructure staff).
    //
    // The CASE expression below redacts the title to '[Restricted]' whenever
    // the viewing user is not the document owner and has no explicit permission
    // row.  Owners and explicitly-granted users always see the full title.
    const [rows] = await this.pool.query<ActivityRow[]>(
      `SELECT a.id, a.action, a.outcome, a.user_id, u.email AS actor_email,
              a.resource_id AS document_id,
              CASE
                WHEN d.owner_id = ? OR p.user_id IS NOT NULL THEN d.title
                ELSE '[Restricted]'
              END AS document_title,
              a.metadata, a.created_at
         FROM audit_logs a
         JOIN documents d ON d.id = a.resource_id AND a.resource_type = 'document'
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN document_permissions p
                ON p.document_id = d.id AND p.user_id = ?
        WHERE ${managePredicate}
        ORDER BY a.id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      [viewer.id, viewer.id, viewer.role, viewer.id],
    );

    const [countRows] = await this.pool.query<CountRow[]>(
  `SELECT COUNT(*) AS total
     FROM audit_logs a
     JOIN documents d ON d.id = a.resource_id AND a.resource_type = 'document'
     LEFT JOIN document_permissions p
            ON p.document_id = d.id AND p.user_id = ?
   WHERE ${managePredicate}`,
  [viewer.id, viewer.role, viewer.id],
);

    return {
      entries: rows.map(toActivity),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async adminOverview(): Promise<AdminOverview> {
    const [[userRows], [companyRows], [documentRows], [sessionRows], [auditRows], [grantRows]] =
      await Promise.all([
        this.pool.execute<OverviewRow[]>(
          'SELECT COUNT(*) AS users, COALESCE(SUM(is_active = 1), 0) AS active_users, COALESCE(SUM(is_active = 0), 0) AS disabled_users FROM users',
        ),
        this.pool.execute<SingleCountRow[]>('SELECT COUNT(*) AS total FROM companies'),
        this.pool.execute<DocumentOverviewRow[]>(
          `SELECT COUNT(*) AS documents,
                  COALESCE(SUM(deleted_at IS NOT NULL), 0) AS deleted_documents,
                  COALESCE(SUM(size_bytes), 0) AS total_bytes
             FROM documents`,
        ),
        this.pool.execute<SingleCountRow[]>(
          `SELECT COUNT(*) AS total
             FROM sessions
            WHERE revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)`,
        ),
        this.pool.execute<SingleCountRow[]>('SELECT COUNT(*) AS total FROM audit_logs'),
        this.pool.execute<SingleCountRow[]>('SELECT COUNT(*) AS total FROM document_permissions'),
      ]);

    const totalUsers = Number(userRows[0]?.users ?? 0);
    const activeUsers = Number(userRows[0]?.active_users ?? 0);
    const disabledUsers = Number(userRows[0]?.disabled_users ?? 0);
    const totalCompanies = Number(companyRows[0]?.total ?? 0);

    return {
      totalEmployees: totalUsers,
      totalCompanies,
      activeAccounts: activeUsers,
      disabledAccounts: disabledUsers,
      users: totalUsers,
      activeUsers,
      documents: Number(documentRows[0]?.documents ?? 0),
      deletedDocuments: Number(documentRows[0]?.deleted_documents ?? 0),
      totalBytes: Number(documentRows[0]?.total_bytes ?? 0),
      activeSessions: Number(sessionRows[0]?.total ?? 0),
      auditEvents: Number(auditRows[0]?.total ?? 0),
      grants: Number(grantRows[0]?.total ?? 0),
    };
  }

  async adminUsers(filters?: AdminUserFilters): Promise<AdminUserEntry[]> {
    const conditions: string[] = [];
    const params: string[] = [];

    if (filters?.companyId) {
      if (filters.companyId === 'none' || filters.companyId === 'personal') {
        conditions.push('u.company_id IS NULL');
      } else {
        conditions.push('u.company_id = ?');
        params.push(filters.companyId);
      }
    }

    if (filters?.search && filters.search.trim()) {
      conditions.push('(LOWER(u.email) LIKE ? OR LOWER(u.display_name) LIKE ?)');
      const term = `%${filters.search.trim().toLowerCase()}%`;
      params.push(term, term);
    }

    if (filters?.role && filters.role.trim()) {
      conditions.push('u.role = ?');
      params.push(filters.role.trim());
    }

    if (filters?.status) {
      if (filters.status === 'active') {
        conditions.push('u.is_active = 1');
      } else if (filters.status === 'disabled') {
        conditions.push('u.is_active = 0');
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await this.pool.execute<AdminUserRow[]>(
      `SELECT u.id, u.email, u.display_name, u.company_id, c.name AS company_name,
              u.role, u.is_active, u.created_at, u.last_login_at,
              (SELECT COUNT(*) FROM documents d
                WHERE d.owner_id = u.id AND d.deleted_at IS NULL) AS document_count
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
         ${where}
        ORDER BY u.created_at ASC, u.email ASC`,
      params,
    );

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      companyId: row.company_id ?? null,
      companyName: row.company_name ?? null,
      role: row.role,
      isActive: row.is_active === 1,
      createdAt: toDate(row.created_at),
      lastLoginAt: row.last_login_at === null ? null : toDate(row.last_login_at),
      documentCount: Number(row.document_count),
    }));
  }

  async adminCompanies(): Promise<AdminCompanyEntry[]> {
    const [rows] = await this.pool.execute<AdminCompanyRow[]>(
      `SELECT c.id, c.name, c.domain, c.created_at,
              (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id) AS employee_count,
              (SELECT COUNT(*) FROM users u WHERE u.company_id = c.id AND u.is_active = 1) AS active_count,
              (SELECT COUNT(*) FROM documents d WHERE d.company_id = c.id AND d.deleted_at IS NULL) AS document_count
         FROM companies c
        ORDER BY c.name ASC`,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      domain: row.domain,
      createdAt: toDate(row.created_at),
      employeeCount: Number(row.employee_count),
      activeCount: Number(row.active_count),
      documentCount: Number(row.document_count),
    }));
  }
}
