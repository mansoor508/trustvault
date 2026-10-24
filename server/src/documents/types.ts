/** Closed set of categories. Mirrors the ENUM in migration 0003. */
export const DOCUMENT_CATEGORIES = [
  'general',
  'contract',
  'invoice',
  'report',
  'identity',
  'other',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export function isDocumentCategory(value: unknown): value is DocumentCategory {
  return typeof value === 'string' && (DOCUMENT_CATEGORIES as readonly string[]).includes(value);
}

export type PermissionRole = 'owner' | 'editor' | 'viewer';

export type DocumentAccessMode = 'admin' | 'owner' | 'editor' | 'co-owner' | 'viewer';

export interface DocumentAccess {
  mode: DocumentAccessMode;
  permissionRole: PermissionRole | null;
}

export interface DocumentOwner {
  id: string;
  email: string;
  displayName: string | null;
  companyId?: string | null;
}

/** Public document shape. Deliberately excludes `storage_key`. */
export interface DocumentRecord {
  id: string;
  owner: DocumentOwner;
  companyId?: string | null;
  title: string;
  description: string | null;
  fileName: string;
  category: DocumentCategory;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
  access: DocumentAccess;
}

/** Internal shape: adds the storage key, which never leaves the server. */
export interface DocumentWithStorage extends DocumentRecord {
  storageKey: string;
}

export interface DocumentSortField {
  field: 'created_at' | 'title' | 'size';
  order: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// Day 4: sharing, history and admin reporting
// ---------------------------------------------------------------------------

export interface DocumentPermissionEntry {
  userId: string;
  email: string;
  displayName: string | null;
  role: PermissionRole;
  grantedBy: { id: string; email: string } | null;
  createdAt: Date;
}

export interface DocumentStats {
  totalDocuments: number;
  totalBytes: number;
  ownedCount: number;
  sharedCount: number;
  byCategory: Array<{ category: DocumentCategory; count: number }>;
}

export interface ActivityEntry {
  id: string;
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  actorId: string | null;
  actorEmail: string | null;
  documentId: string | null;
  documentTitle: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface AdminOverview {
  totalEmployees: number;
  totalCompanies: number;
  activeAccounts: number;
  disabledAccounts: number;
  users: number;
  activeUsers: number;
  documents: number;
  deletedDocuments: number;
  totalBytes: number;
  activeSessions: number;
  auditEvents: number;
  grants: number;
}

export interface AdminUserEntry {
  id: string;
  email: string;
  displayName: string | null;
  companyId: string | null;
  companyName: string | null;
  role: 'platform_admin' | 'owner' | 'admin' | 'editor' | 'viewer';
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  documentCount: number;
}

export interface AdminCompanyEntry {
  id: string;
  name: string;
  domain: string | null;
  createdAt: Date;
  employeeCount: number;
  activeCount: number;
  documentCount: number;
}
