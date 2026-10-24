import { API_PREFIX, request, type ApiResult } from './api';
import type { AuthUser, UserRole } from './auth';

export interface Company {
  id: string;
  name: string;
  domain?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceStatus {
  company: Company | null;
  isPersonal: boolean;
}

export interface CompanyInvitation {
  id: string;
  companyId: string;
  companyName?: string;
  invitedBy: string;
  invitedByName?: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  token: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvitationDetails {
  email: string;
  companyName: string;
  role: 'admin' | 'editor' | 'viewer';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
}

export function fetchWorkspace(): Promise<ApiResult<WorkspaceStatus>> {
  return request<WorkspaceStatus>(`${API_PREFIX}/workspace`);
}

export function createWorkspace(
  companyName: string,
  csrfToken: string,
): Promise<ApiResult<{ user: AuthUser }>> {
  return request<{ user: AuthUser }>(`${API_PREFIX}/workspace`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ companyName }),
  });
}

export function updateWorkspaceSettings(
  patch: {
    name?: string;
    domain?: string | null;
  },
  csrfToken: string,
): Promise<ApiResult<{ company: Company }>> {
  return request<{ company: Company }>(`${API_PREFIX}/workspace`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(patch),
  });
}

export function fetchWorkspaceMembers(): Promise<ApiResult<{ members: AuthUser[] }>> {
  return request<{ members: AuthUser[] }>(`${API_PREFIX}/workspace/members`);
}

export function fetchWorkspaceInvitations(): Promise<
  ApiResult<{ invitations: CompanyInvitation[] }>
> {
  return request<{ invitations: CompanyInvitation[] }>(`${API_PREFIX}/workspace/invitations`);
}

export function verifyWorkspaceInvitation(
  token: string,
): Promise<ApiResult<InvitationDetails>> {
  return request<InvitationDetails>(
    `${API_PREFIX}/workspace/invitations/verify?token=${encodeURIComponent(token)}`,
  );
}

export function inviteWorkspaceMember(
  input: {
    email: string;
    role: 'admin' | 'editor' | 'viewer';
  },
  csrfToken: string,
): Promise<ApiResult<{ invitation: CompanyInvitation; inviteUrl?: string }>> {
  return request<{ invitation: CompanyInvitation; inviteUrl?: string }>(`${API_PREFIX}/workspace/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(input),
  });
}

export function revokeWorkspaceInvitation(
  id: string,
  csrfToken: string,
): Promise<ApiResult<void>> {
  return request<void>(`${API_PREFIX}/workspace/invitations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      'X-CSRF-Token': csrfToken,
    },
  });
}

export function acceptWorkspaceInvitation(
  token: string,
  csrfToken: string,
): Promise<ApiResult<{ user: AuthUser }>> {
  return request<{ user: AuthUser }>(`${API_PREFIX}/workspace/invitations/accept`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ token }),
  });
}

export function removeWorkspaceMember(
  userId: string,
  csrfToken: string,
): Promise<ApiResult<void>> {
  return request<void>(`${API_PREFIX}/workspace/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: {
      'X-CSRF-Token': csrfToken,
    },
  });
}

export function updateWorkspaceMemberRole(
  userId: string,
  role: UserRole,
  csrfToken: string,
): Promise<ApiResult<void>> {
  return request<void>(`${API_PREFIX}/workspace/members/${encodeURIComponent(userId)}/role`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({ role }),
  });
}

export interface CompanyAdminEmployee {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface CompanyAdminMetrics {
  totalEmployees: number;
  ownerCount: number;
  adminCount: number;
  activeEmployees: number;
  pendingInvitationsCount: number;
}

export interface CompanyAdminActivityEntry {
  id: string;
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface CompanyAdminOverview {
  company: {
    id: string;
    name: string;
    domain: string | null;
    createdAt: string;
  };
  metrics: CompanyAdminMetrics;
  employees: CompanyAdminEmployee[];
  recentActivity: CompanyAdminActivityEntry[];
}

export function fetchCompanyAdminOverview(): Promise<ApiResult<CompanyAdminOverview>> {
  return request<CompanyAdminOverview>(`${API_PREFIX}/workspace/company-admin`);
}
