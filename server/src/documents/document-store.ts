import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { UserRole } from '../auth/types.js';
import type {
  DocumentAccessMode,
  DocumentCategory,
  DocumentRecord,
  DocumentSortField,
  DocumentWithStorage,
  PermissionRole,
} from './types.js';

export interface DocumentViewer {
  id: string;
  role: UserRole;
  companyId?: string | null;
}

export interface ListDocumentsQuery {
  search?: string | undefined;
  category?: DocumentCategory | undefined;
  /** Matches the owner's email or display name. */
  owner?: string | undefined;
  createdFrom?: Date | undefined;
  createdTo?: Date | undefined;
  sort: DocumentSortField;
  limit: number;
  offset: number;
  scope?: 'all' | 'mine' | 'shared' | 'company' | undefined;
}

export interface DocumentListResult {
  documents: DocumentWithStorage[];
  total: number;
}

export interface CreateDocumentInput {
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
  category: DocumentCategory;
  createdAt: Date;
}

export interface UpdateDocumentInput {
  title: string;
  description: string | null;
  category: DocumentCategory;
  updatedAt: Date;
}

export interface DocumentStore {
  list(viewer: DocumentViewer, query: ListDocumentsQuery): Promise<DocumentListResult>;
  /**
   * Returns the document only when the viewer may see it. `null` means
   * "not found or not permitted" on purpose: callers must not be able to tell
   * the two apart.
   */
  findAccessible(id: string, viewer: DocumentViewer): Promise<DocumentWithStorage | null>;
  create(input: CreateDocumentInput, viewer: DocumentViewer): Promise<DocumentWithStorage>;
  update(id: string, input: UpdateDocumentInput): Promise<void>;
  softDelete(id: string, deletedAt: Date): Promise<boolean>;
}

interface DocumentRow extends RowDataPacket {
  id: string;
  owner_id: string;
  company_id?: string | null;
  title: string;
  description: string | null;
  file_name: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number | string;
  checksum_sha256: string | null;
  status: 'active' | 'archived';
  category: DocumentCategory;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  owner_email: string;
  owner_display_name: string | null;
  access_mode: DocumentAccessMode | null;
  permission_role: PermissionRole | null;
}

interface CountRow extends RowDataPacket {
  total: number | string;
}

const SORT_COLUMNS: Record<DocumentSortField['field'], string> = {
  created_at: 'd.created_at',
  title: 'd.title',
  size: 'd.size_bytes',
};

/** Escapes LIKE wildcards so a search for "50%" cannot match everything. */
export function likePattern(value: string): string {
  return `%${value.replace(/[!%_]/g, (character) => `!${character}`)}%`;
}

function toDocument(row: DocumentRow): DocumentWithStorage {
  return {
    id: row.id,
    companyId: row.company_id ?? null,
    owner: {
      id: row.owner_id,
      email: row.owner_email,
      displayName: row.owner_display_name,
      companyId: row.company_id ?? null,
    },
    title: row.title,
    description: row.description,
    fileName: row.file_name,
    category: row.category,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    access: {
      mode: row.access_mode ?? 'viewer',
      permissionRole: row.permission_role,
    },
    storageKey: row.storage_key,
  };
}

/**
 * Access predicate, duplicated intentionally in list/count/find so every path
 * applies exactly the same rule:
 *
 *   owner OR an active row in document_permissions
 *
 * Administrators do not automatically have permission to read document contents.
 * Access is denied by default.
 * The viewer id comes from the authenticated session, never from the request.
 */
const ACCESS_PREDICATE = `(d.owner_id = ? OR p.user_id IS NOT NULL)`;

const SELECT_COLUMNS = `
  d.id, d.owner_id, d.company_id, d.title, d.description, d.file_name, d.storage_key,
  d.mime_type, d.size_bytes, d.checksum_sha256, d.status, d.category,
  d.created_at, d.updated_at, d.deleted_at,
  u.email AS owner_email, u.display_name AS owner_display_name,
  CASE
    WHEN d.owner_id = ? THEN 'owner'
    WHEN p.role = 'editor' OR p.role = 'owner' THEN 'editor'
    WHEN p.user_id IS NOT NULL THEN 'viewer'
    ELSE NULL
  END AS access_mode,
  p.role AS permission_role`;

export class MySqlDocumentStore implements DocumentStore {
  constructor(private readonly pool: Pool) {}

  async list(viewer: DocumentViewer, query: ListDocumentsQuery): Promise<DocumentListResult> {
    const conditions: string[] = ['d.deleted_at IS NULL', ACCESS_PREDICATE];
    const filterParams: Array<string | number | Date> = [viewer.id];

    if (query.search !== undefined && query.search.length > 0) {
      const pattern = likePattern(query.search);
      conditions.push(`(d.title LIKE ? ESCAPE '!' OR d.file_name LIKE ? ESCAPE '!')`);
      filterParams.push(pattern, pattern);
    }
    if (query.category !== undefined) {
      conditions.push('d.category = ?');
      filterParams.push(query.category);
    }
    if (query.owner !== undefined && query.owner.length > 0) {
      const pattern = likePattern(query.owner);
      conditions.push(`(u.email LIKE ? ESCAPE '!' OR u.display_name LIKE ? ESCAPE '!')`);
      filterParams.push(pattern, pattern);
    }
    if (query.createdFrom !== undefined) {
      conditions.push('d.created_at >= ?');
      filterParams.push(query.createdFrom);
    }
    if (query.createdTo !== undefined) {
      conditions.push('d.created_at <= ?');
      filterParams.push(query.createdTo);
    }

    if (query.scope === 'mine') {
      conditions.push('d.owner_id = ?');
      filterParams.push(viewer.id);
    } else if (query.scope === 'shared') {
      conditions.push('(p.user_id IS NOT NULL AND d.owner_id <> ?)');
      filterParams.push(viewer.id);
    } else if (query.scope === 'company' && viewer.companyId) {
      conditions.push('d.company_id = ?');
      filterParams.push(viewer.companyId);
    } else if (viewer.companyId) {
      conditions.push('(d.company_id = ? OR p.user_id IS NOT NULL OR d.owner_id = ?)');
      filterParams.push(viewer.companyId, viewer.id);
    } else {
      conditions.push('(d.company_id IS NULL OR p.user_id IS NOT NULL OR d.owner_id = ?)');
      filterParams.push(viewer.id);
    }

    const where = conditions.join(' AND ');
    const order = query.sort.order === 'asc' ? 'ASC' : 'DESC';
    const sortColumn = SORT_COLUMNS[query.sort.field];

    const limit = Math.min(Math.max(Math.trunc(Number(query.limit) || 25), 1), 100);
    const offset = Math.min(Math.max(Math.trunc(Number(query.offset) || 0), 0), 1_000_000);

    const [rows] = await this.pool.query<DocumentRow[]>(
      `SELECT ${SELECT_COLUMNS}
         FROM documents d
         JOIN users u ON u.id = d.owner_id
         LEFT JOIN document_permissions p
                ON p.document_id = d.id AND p.user_id = ?
        WHERE ${where}
        ORDER BY ${sortColumn} ${order}, d.id ${order}
        LIMIT ${limit} OFFSET ${offset}`,
      [viewer.id, viewer.id, ...filterParams],
    );

    const [countRows] = await this.pool.query<CountRow[]>(
      `SELECT COUNT(*) AS total
         FROM documents d
         JOIN users u ON u.id = d.owner_id
         LEFT JOIN document_permissions p
                ON p.document_id = d.id AND p.user_id = ?
        WHERE ${where}`,
      [viewer.id, ...filterParams],
    );

    return {
      documents: rows.map(toDocument),
      total: Number(countRows[0]?.total ?? 0),
    };
  }

  async findAccessible(
    id: string,
    viewer: DocumentViewer,
  ): Promise<DocumentWithStorage | null> {
    const conditions = ['d.id = ?', 'd.deleted_at IS NULL', ACCESS_PREDICATE];
    const bindings: Array<string | number | Date> = [viewer.id, viewer.id, id, viewer.id];
    if (viewer.companyId) {
      conditions.push('(d.company_id = ? OR p.user_id IS NOT NULL OR d.owner_id = ?)');
      bindings.push(viewer.companyId, viewer.id);
    } else {
      conditions.push('(d.company_id IS NULL OR p.user_id IS NOT NULL OR d.owner_id = ?)');
      bindings.push(viewer.id);
    }

    const [rows] = await this.pool.query<DocumentRow[]>(
      `SELECT ${SELECT_COLUMNS}
         FROM documents d
         JOIN users u ON u.id = d.owner_id
         LEFT JOIN document_permissions p
                ON p.document_id = d.id AND p.user_id = ?
        WHERE ${conditions.join(' AND ')}
        LIMIT 1`,
      bindings,
    );

    const row = rows[0];
    return row ? toDocument(row) : null;
  }

  async create(
    input: CreateDocumentInput,
    viewer: DocumentViewer,
  ): Promise<DocumentWithStorage> {
    await this.pool.execute(
      `INSERT INTO documents
         (id, owner_id, company_id, title, description, file_name, storage_key, mime_type,
          size_bytes, checksum_sha256, status, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [
        input.id,
        input.ownerId,
        input.companyId ?? null,
        input.title,
        input.description,
        input.fileName,
        input.storageKey,
        input.mimeType,
        input.sizeBytes,
        input.checksumSha256,
        input.category,
        input.createdAt,
        input.createdAt,
      ],
    );

    const created = await this.findAccessible(input.id, viewer);
    if (!created) {
      throw new Error('Document was created but could not be read back');
    }
    return created;
  }

  async update(id: string, input: UpdateDocumentInput): Promise<void> {
    await this.pool.execute(
      `UPDATE documents
          SET title = ?, description = ?, category = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [input.title, input.description, input.category, input.updatedAt, id],
    );
  }

  async softDelete(id: string, deletedAt: Date): Promise<boolean> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `UPDATE documents
          SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [deletedAt, deletedAt, id],
    );
    return result.affectedRows > 0;
  }
}

/** Keeps TypeScript honest about the public shape used by the API layer. */
export type PublicDocument = DocumentRecord;
