import { API_PREFIX, request, type ApiResult } from './api';

export type UserRole = 'platform_admin' | 'owner' | 'admin' | 'editor' | 'viewer';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  companyId?: string | null;
  companyName?: string | null;
  role: UserRole;
  isActive: boolean;
}

export interface AuthSession {
  csrfToken: string;
  createdAt: string;
  expiresAt: string;
}

export interface AuthPayload {
  user: AuthUser;
  session: AuthSession;
}

export interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  outcome: 'success' | 'failure';
  resourceType: string | null;
  resourceId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AuditPage {
  entries: AuditEntry[];
  pagination: { limit: number; offset: number; total: number };
}

/**
 * Extracts the server's safe error message from an error envelope. The API
 * never returns stack traces, so whatever is here is safe to display.
 */
export function extractErrorMessage(data: unknown): string | null {
  if (data === null || typeof data !== 'object') return null;
  const envelope = (data as { error?: { message?: unknown } }).error;
  if (envelope === undefined || typeof envelope.message !== 'string') return null;
  return envelope.message;
}

export function login(
  email: string,
  password: string,
  inviteToken?: string,
): Promise<ApiResult<AuthPayload>> {
  return request<AuthPayload>(`${API_PREFIX}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, inviteToken: inviteToken || undefined }),
  });
}

export interface InvitationDetails {
  email: string;
  companyName: string;
  role: 'admin' | 'editor' | 'viewer';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
}

export function fetchInvitationDetails(token: string): Promise<ApiResult<InvitationDetails>> {
  return request<InvitationDetails>(
    `${API_PREFIX}/auth/invitation?token=${encodeURIComponent(token)}`,
  );
}

export function register(input: {
  name: string;
  email: string;
  password: string;
  companyName?: string;
  inviteToken?: string;
}): Promise<ApiResult<AuthPayload>> {
  return request<AuthPayload>(`${API_PREFIX}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export const registerCompany = register;

export function fetchMe(): Promise<ApiResult<AuthPayload>> {
  return request<AuthPayload>(`${API_PREFIX}/auth/me`);
}

/**
 * Logout is a state-changing request, so it carries the per-session CSRF token
 * as a header. The HttpOnly session cookie proves *who* is calling.
 */
export function logout(csrfToken: string): Promise<ApiResult<null>> {
  return request<null>(`${API_PREFIX}/auth/logout`, {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
  });
}

export function updateProfile(
  displayName: string,
  csrfToken: string,
): Promise<ApiResult<{ user: AuthUser }>> {
  return request<{ user: AuthUser }>(`${API_PREFIX}/auth/profile`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ displayName }),
  });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
  csrfToken: string,
): Promise<ApiResult<{ success: boolean; message: string }>> {
  return request<{ success: boolean; message: string }>(`${API_PREFIX}/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function fetchAuditLogs(limit = 25, offset = 0): Promise<ApiResult<AuditPage>> {
  return request<AuditPage>(`${API_PREFIX}/admin/audit-logs?limit=${limit}&offset=${offset}`);
}
