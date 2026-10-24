import { API_PREFIX, apiBaseUrl, ApiError, buildUrl, request, type ApiResult } from './api';
import { extractErrorMessage } from './auth';

export const DOCUMENT_CATEGORIES = [
  'general',
  'contract',
  'invoice',
  'report',
  'identity',
  'other',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  general: 'General',
  contract: 'Contract',
  invoice: 'Invoice',
  report: 'Report',
  identity: 'Identity',
  other: 'Other',
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx,.txt,.md,.csv';

export type DocumentAccessMode = 'admin' | 'owner' | 'editor' | 'co-owner' | 'viewer';

export interface DocumentOwner {
  id: string;
  email: string;
  displayName: string | null;
}

export interface DocumentAccess {
  mode: DocumentAccessMode;
  permissionRole: 'owner' | 'editor' | 'viewer' | null;
}

export interface DocumentItem {
  id: string;
  owner: DocumentOwner;
  title: string;
  description: string | null;
  fileName: string;
  category: DocumentCategory;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  access: DocumentAccess;
}

export interface DocumentPage {
  documents: DocumentItem[];
  pagination: { limit: number; offset: number; total: number };
}

export interface DocumentFilters {
  search?: string;
  category?: DocumentCategory | '';
  owner?: string;
  from?: string;
  to?: string;
  sort?: 'created_at' | 'title' | 'size';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  scope?: 'all' | 'mine' | 'shared' | 'company';
}

/** Builds a query string from the filters that are actually set. */
export function buildDocumentsQuery(filters: DocumentFilters): string {
  const params = new URLSearchParams();

  const search = filters.search?.trim();
  if (search) params.set('search', search);

  if (filters.category) params.set('category', filters.category);

  const owner = filters.owner?.trim();
  if (owner) params.set('owner', owner);

  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.order) params.set('order', filters.order);
  if (filters.scope && filters.scope !== 'all') params.set('scope', filters.scope);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.offset !== undefined) params.set('offset', String(filters.offset));

  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

export function fetchDocuments(filters: DocumentFilters = {}): Promise<ApiResult<DocumentPage>> {
  return request<DocumentPage>(`${API_PREFIX}/documents${buildDocumentsQuery(filters)}`);
}

export function fetchDocument(id: string): Promise<ApiResult<{ document: DocumentItem }>> {
  return request<{ document: DocumentItem }>(`${API_PREFIX}/documents/${encodeURIComponent(id)}`);
}

export interface UploadDocumentInput {
  file: File;
  title?: string;
  description?: string;
  category?: DocumentCategory;
}

/**
 * Multipart upload. The CSRF token travels in a header; the session cookie is
 * sent automatically (`credentials: include` inside `request`).
 */
export function uploadDocument(
  input: UploadDocumentInput,
  csrfToken: string,
): Promise<ApiResult<{ document: DocumentItem }>> {
  const body = new FormData();
  body.append('file', input.file, input.file.name);

  const title = input.title?.trim();
  if (title) body.append('title', title);

  const description = input.description?.trim();
  if (description) body.append('description', description);

  if (input.category) body.append('category', input.category);

  // No Content-Type header on purpose: the browser adds the multipart boundary.
  return request<{ document: DocumentItem }>(`${API_PREFIX}/documents`, {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
    body,
  });
}

export interface DocumentPatch {
  title?: string;
  description?: string | null;
  category?: DocumentCategory;
}

export function updateDocument(
  id: string,
  patch: DocumentPatch,
  csrfToken: string,
): Promise<ApiResult<{ document: DocumentItem }>> {
  return request<{ document: DocumentItem }>(
    `${API_PREFIX}/documents/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(patch),
    },
  );
}

export function deleteDocument(id: string, csrfToken: string): Promise<ApiResult<null>> {
  return request<null>(`${API_PREFIX}/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'X-CSRF-Token': csrfToken },
  });
}

/**
 * Downloads through the protected endpoint and returns the bytes as a Blob.
 * There is no public URL: the request carries the session cookie and the API
 * authorizes it before streaming anything.
 */
export async function downloadDocument(id: string): Promise<Blob> {
  const url = buildUrl(apiBaseUrl, `${API_PREFIX}/documents/${encodeURIComponent(id)}/download`);
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    let message = `Download failed (HTTP ${response.status}).`;
    try {
      const data: unknown = await response.json();
      message = extractErrorMessage(data) ?? message;
    } catch {
      // Non-JSON error body: keep the generic message.
    }
    throw new ApiError(message, { status: response.status });
  }

  return response.blob();
}

/** Triggered by the UI after a successful download. DOM-only, not unit tested. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = sanitizeDownloadName(fileName);
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Keeps a server-provided name from carrying path separators into the save dialog. */
export function sanitizeDownloadName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'document';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

export function canManageDocument(document: DocumentItem): boolean {
  return document.access.mode !== 'viewer';
}

export function isSharedWithMe(document: DocumentItem): boolean {
  return document.access.mode === 'viewer' || document.access.mode === 'co-owner';
}

// ---------------------------------------------------------------------------
// Day 4: sharing, dashboard statistics and activity history
// ---------------------------------------------------------------------------

export type PermissionRole = 'owner' | 'editor' | 'viewer';

export interface DocumentPermissionEntry {
  userId: string;
  email: string;
  displayName: string | null;
  role: PermissionRole;
  grantedBy: { id: string; email: string } | null;
  createdAt: string;
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
  outcome: 'success' | 'failure';
  actorId: string | null;
  actorEmail: string | null;
  documentId: string | null;
  documentTitle: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  pagination: { limit: number; offset: number; total: number };
}

export function fetchDocumentStats(): Promise<ApiResult<{ stats: DocumentStats }>> {
  return request<{ stats: DocumentStats }>(`${API_PREFIX}/documents/stats`);
}

export function fetchPermissions(
  documentId: string,
): Promise<ApiResult<{ permissions: DocumentPermissionEntry[] }>> {
  return request<{ permissions: DocumentPermissionEntry[] }>(
    `${API_PREFIX}/documents/${encodeURIComponent(documentId)}/permissions`,
  );
}

export function grantPermission(
  documentId: string,
  input: { email: string; role: PermissionRole },
  csrfToken: string,
): Promise<ApiResult<{ permissions: DocumentPermissionEntry[] }>> {
  return request<{ permissions: DocumentPermissionEntry[] }>(
    `${API_PREFIX}/documents/${encodeURIComponent(documentId)}/permissions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify(input),
    },
  );
}

export function revokePermission(
  documentId: string,
  userId: string,
  csrfToken: string,
): Promise<ApiResult<{ permissions: DocumentPermissionEntry[] }>> {
  return request<{ permissions: DocumentPermissionEntry[] }>(
    `${API_PREFIX}/documents/${encodeURIComponent(documentId)}/permissions/${encodeURIComponent(userId)}`,
    { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } },
  );
}

export function fetchDocumentHistory(
  documentId: string,
  limit = 25,
  offset = 0,
): Promise<ApiResult<ActivityPage>> {
  return request<ActivityPage>(
    `${API_PREFIX}/documents/${encodeURIComponent(documentId)}/access-history?limit=${limit}&offset=${offset}`,
  );
}

export function fetchAccessHistory(limit = 25, offset = 0): Promise<ApiResult<ActivityPage>> {
  return request<ActivityPage>(`${API_PREFIX}/access-history?limit=${limit}&offset=${offset}`);
}
