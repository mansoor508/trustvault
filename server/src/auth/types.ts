/** The product roles: platform_admin (site-wide governance), owner (full workspace control), admin (company-level member management), editor (edit own and granted), viewer (read/download). */
export const USER_ROLES = ['platform_admin', 'owner', 'admin', 'editor', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const COMPANY_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

/** Account-level role check that never trusts client input. */
export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export interface Company {
  id: string;
  name: string;
  domain?: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** The only user shape that is ever returned by an API response. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  isActive: boolean;
  companyId?: string | null;
  companyName?: string | null;
}

export interface AuthenticatedSession {
  id: string;
  /** Synchroniser token the browser must echo on state-changing requests. */
  csrfToken: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuthContext {
  user: AuthUser;
  session: AuthenticatedSession;
}

export interface CompanyAdminEmployee {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
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
    createdAt: Date;
  };
  metrics: CompanyAdminMetrics;
  employees: CompanyAdminEmployee[];
  recentActivity: CompanyAdminActivityEntry[];
}

