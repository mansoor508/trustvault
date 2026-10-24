import type { Pool, RowDataPacket } from 'mysql2/promise';
import { withDbTimeout } from '../db/timeout.js';
import {
  computeCheckpointHash,
  computeEntryHash,
  GENESIS_HASH,
} from './audit-crypto.js';
import type {
  AuthUser,
  Company,
  CompanyAdminActivityEntry,
  CompanyAdminEmployee,
  CompanyAdminOverview,
  CompanyInvitation,
  UserRole,
} from './types.js';

export interface UserWithCredentials extends AuthUser {
  passwordHash: string;
  failedLoginCount: number;
  lockedUntil: Date | null;
  passwordChangedAt: Date | null;
  createdAt?: Date;
  lastLoginAt?: Date | null;
}

export interface SessionUser extends AuthUser {
  passwordChangedAt: Date | null;
}

export interface SessionRecord {
  id: string;
  tokenHash: string;
  csrfToken: string | null;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  user: SessionUser;
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  tokenHash: string;
  csrfToken: string;
  ipHash: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface CreateUserInput {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  passwordHash: string;
  companyId?: string | null;
  createdAt: Date;
}

export interface AuditEventInput {
  userId: string | null;
  companyId?: string | null;
  targetUserId?: string | null;
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  resourceType?: string | null;
  resourceId?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
  prevHash?: string | null;
  entryHash?: string | null;
  createdAt?: Date;
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  companyId: string | null;
  targetUserId: string | null;
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  resourceType: string | null;
  resourceId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  prevHash: string | null;
  entryHash: string | null;
  createdAt: string;
}

export interface AuditFilterParams {
  actor?: string | undefined;
  documentId?: string | undefined;
  action?: string | undefined;
  outcome?: 'success' | 'failure' | 'denied' | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit: number;
  offset: number;
}

export interface CheckpointRecord {
  id: string;
  checkpointSeq: number;
  lastLogId: string;
  checkpointHash: string;
  entryCount: number;
  createdAt: string;
}

export interface AuditRecoveryIncident {
  eventId: string;
  incidentType: string;
  action: string;
  corruptedField: string;
  remediationStatus: string;
  forensicNote: string;
}

export interface AuditVerificationResult {
  verified: boolean;
  totalEntries: number;
  checkedCheckpoints: number;
  lastVerifiedHash: string | null;
  failureReason?: string;
  failedAtId?: string;
  incidents?: AuditRecoveryIncident[];
}

/**
 * Persistence boundary for authentication and audit log ledger.
 */
export interface AuthStore {
  createCompany(input: { id: string; name: string; domain?: string | null; createdAt: Date }): Promise<Company>;
  findCompanyById(id: string): Promise<Company | null>;
  updateCompany(id: string, patch: { name?: string; domain?: string | null }): Promise<Company | null>;
  createUser(input: CreateUserInput): Promise<UserWithCredentials>;
  deleteUserAccount(userId: string): Promise<boolean>;
  listCompanyUsers(companyId: string): Promise<AuthUser[]>;
  getCompanyAdminOverview(companyId: string): Promise<CompanyAdminOverview>;
  updateUserRoleAndCompany(userId: string, companyId: string | null, role: UserRole): Promise<void>;
  removeCompanyMember(userId: string, companyId: string): Promise<void>;
  createInvitation(input: {
    id: string;
    companyId: string;
    invitedBy: string;
    email: string;
    role: 'admin' | 'editor' | 'viewer';
    token: string;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<CompanyInvitation>;
  findInvitationByToken(token: string): Promise<CompanyInvitation | null>;
  findInvitationById(id: string): Promise<CompanyInvitation | null>;
  findPendingInvitationByEmail(companyId: string, email: string): Promise<CompanyInvitation | null>;
  updatePendingInvitation(
    id: string,
    input: { token: string; role: 'admin' | 'editor' | 'viewer'; expiresAt: Date },
  ): Promise<CompanyInvitation>;
  deleteInvitation(id: string): Promise<void>;
  listCompanyInvitations(companyId: string): Promise<CompanyInvitation[]>;
  updateInvitationStatus(id: string, status: 'accepted' | 'revoked' | 'expired'): Promise<void>;
  findUserByEmail(email: string): Promise<UserWithCredentials | null>;
  findUserById(id: string): Promise<UserWithCredentials | null>;
  updateUserProfile(userId: string, patch: { displayName: string }): Promise<AuthUser | null>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  setUserActive(userId: string, isActive: boolean): Promise<boolean>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  createSession(input: CreateSessionInput): Promise<void>;
  touchSession(sessionId: string, seenAt: Date): Promise<void>;
  revokeSession(sessionId: string, revokedAt: Date): Promise<void>;
  revokeUserSessions(userId: string, revokedAt: Date, exceptSessionId?: string): Promise<void>;
  recordLoginFailure(
    userId: string,
    params: { now: Date; maxAttempts: number; lockMinutes: number },
  ): Promise<void>;
  recordLoginSuccess(userId: string, now: Date): Promise<void>;
  recordAudit(event: AuditEventInput): Promise<AuditLogEntry>;
  listAuditLogs(params: AuditFilterParams): Promise<AuditLogEntry[]>;
  countAuditLogs(params?: Omit<AuditFilterParams, 'limit' | 'offset'>): Promise<number>;
  getLatestAuditHash(): Promise<string | null>;
  createCheckpoint(): Promise<CheckpointRecord | null>;
  listCheckpoints(): Promise<CheckpointRecord[]>;
  verifyAuditIntegrity(): Promise<AuditVerificationResult>;
}

// ---------------------------------------------------------------------------
// MySQL implementation
// ---------------------------------------------------------------------------

interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  display_name: string | null;
  company_id: string | null;
  company_name?: string | null;
  role: UserRole;
  is_active: number;
  created_at?: Date;
  last_login_at?: Date | null;
  deleted_at?: Date | null;
  password_hash: string;
  failed_login_count: number;
  locked_until: Date | null;
  password_changed_at: Date | null;
}

interface CompanyActivityRow extends RowDataPacket {
  id: string | number;
  user_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  resource_type: string | null;
  resource_id: string | null;
  metadata: unknown;
  created_at: Date;
}

interface IncidentRow extends RowDataPacket {
  id: string | number;
  event_id: string | number;
  incident_type: string;
  original_entry_hash: string;
  prev_hash: string;
  action: string;
  corrupted_field: string;
  remediation_status: string;
  forensic_note: string;
  created_at: Date;
}

interface SessionRow extends RowDataPacket {
  session_id: string;
  token_hash: string;
  csrf_token: string | null;
  session_created_at: Date;
  expires_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
  user_id: string;
  email: string;
  display_name: string | null;
  company_id: string | null;
  company_name: string | null;
  role: UserRole;
  is_active: number;
  password_changed_at: Date | null;
}

interface AuditRow extends RowDataPacket {
  id: string | number;
  user_id: string | null;
  company_id?: string | null;
  target_user_id?: string | null;
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  resource_type: string | null;
  resource_id: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  request_id?: string | null;
  prev_hash?: string | null;
  entry_hash?: string | null;
  metadata: unknown;
  created_at: Date;
}

interface CheckpointRow extends RowDataPacket {
  id: string | number;
  checkpoint_seq: number;
  last_log_id: string | number;
  checkpoint_hash: string;
  entry_count: number;
  created_at: Date;
}

interface CountRow extends RowDataPacket {
  total: number;
}

interface LatestHashRow extends RowDataPacket {
  entry_hash: string | null;
}

function toDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  let str = String(value).trim();
  if (str.includes(' ') && !str.includes('T')) {
    str = str.replace(' ', 'T');
  }
  if (!str.endsWith('Z') && !/[+-]\d{2}(:\d{2})?$/.test(str)) {
    str += 'Z';
  }
  return new Date(str);
}

function toDateOrNull(value: Date | string | null): Date | null {
  return value === null ? null : toDate(value);
}

function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toUser(row: UserRow): UserWithCredentials {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    companyId: row.company_id ?? null,
    companyName: row.company_name ?? null,
    role: row.role,
    isActive: row.is_active === 1 && !row.deleted_at,
    passwordHash: row.password_hash,
    failedLoginCount: Number(row.failed_login_count),
    lockedUntil: toDateOrNull(row.locked_until),
    passwordChangedAt: toDateOrNull(row.password_changed_at),
    createdAt: row.created_at ? toDate(row.created_at) : undefined,
    lastLoginAt: row.last_login_at ? toDate(row.last_login_at) : null,
  };
}

function toAuditEntry(row: AuditRow): AuditLogEntry {
  return {
    id: String(row.id),
    userId: row.user_id,
    companyId: row.company_id ?? null,
    targetUserId: row.target_user_id ?? null,
    action: row.action,
    outcome: row.outcome,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    ipHash: row.ip_hash,
    userAgent: row.user_agent,
    requestId: row.request_id ?? null,
    metadata: parseMetadata(row.metadata),
    prevHash: row.prev_hash ?? null,
    entryHash: row.entry_hash ?? null,
    createdAt: toDate(row.created_at).toISOString(),
  };
}

export class MySqlAuthStore implements AuthStore {
  constructor(private readonly pool: Pool) {}

  async createCompany(input: { id: string; name: string; domain?: string | null; createdAt: Date }): Promise<Company> {
    await this.pool.execute(
      `INSERT INTO companies (id, name, domain, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [input.id, input.name, input.domain ?? null, input.createdAt, input.createdAt],
    );
    return {
      id: input.id,
      name: input.name,
      domain: input.domain ?? null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
  }

  async findCompanyById(id: string): Promise<Company | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id, name, domain, created_at, updated_at FROM companies WHERE id = ? LIMIT 1`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      domain: row.domain ?? null,
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  async updateCompany(id: string, patch: { name?: string; domain?: string | null }): Promise<Company | null> {
    const fields: string[] = [];
    const values: any[] = [];
    if (patch.name !== undefined) {
      fields.push('name = ?');
      values.push(patch.name);
    }
    if (patch.domain !== undefined) {
      fields.push('domain = ?');
      values.push(patch.domain);
    }
    if (fields.length > 0) {
      values.push(id);
      await this.pool.execute(
        `UPDATE companies SET ${fields.join(', ')} WHERE id = ?`,
        values,
      );
    }
    return this.findCompanyById(id);
  }

  async createUser(input: CreateUserInput): Promise<UserWithCredentials> {
    await this.pool.execute(
      `INSERT INTO users (id, email, password_hash, display_name, company_id, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        input.id,
        input.email,
        input.passwordHash,
        input.displayName,
        input.companyId ?? null,
        input.role,
        input.createdAt,
        input.createdAt,
      ],
    );
    return {
      id: input.id,
      email: input.email,
      displayName: input.displayName,
      companyId: input.companyId ?? null,
      companyName: null,
      role: input.role,
      isActive: true,
      passwordHash: input.passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
      passwordChangedAt: null,
      createdAt: input.createdAt,
      lastLoginAt: null,
    };
  }

  async listCompanyUsers(companyId: string): Promise<AuthUser[]> {
    const [rows] = await withDbTimeout(
      this.pool.execute<UserRow[]>(
        `SELECT u.id, u.email, u.display_name, u.company_id, c.name AS company_name, u.role, u.is_active,
                u.password_hash, u.failed_login_count, u.locked_until, u.password_changed_at
           FROM users u
           LEFT JOIN companies c ON c.id = u.company_id
          WHERE u.company_id = ?
          ORDER BY u.created_at ASC`,
        [companyId],
      ),
      5_000,
      'listCompanyUsers',
    );
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name,
      companyId: r.company_id,
      companyName: r.company_name,
      role: r.role,
      isActive: r.is_active === 1,
    }));
  }

  async getCompanyAdminOverview(companyId: string): Promise<CompanyAdminOverview> {
    const company = await this.findCompanyById(companyId);
    if (!company) {
      throw new Error('Workspace not found');
    }

    const [empRows] = await withDbTimeout(
      this.pool.execute<UserRow[]>(
        `SELECT u.id, u.email, u.display_name, u.role, u.is_active, u.created_at, u.last_login_at
           FROM users u
          WHERE u.company_id = ?
          ORDER BY u.created_at ASC, u.email ASC`,
        [companyId],
      ),
      5_000,
      'getCompanyAdminOverview:employees',
    );

    const [invRows] = await withDbTimeout(
      this.pool.execute<CountRow[]>(
        `SELECT COUNT(*) AS total
           FROM company_invitations
          WHERE company_id = ?
            AND status = 'pending'
            AND expires_at > UTC_TIMESTAMP(3)`,
        [companyId],
      ),
      5_000,
      'getCompanyAdminOverview:invitations',
    );

    const [actRows] = await withDbTimeout(
      this.pool.query<CompanyActivityRow[]>(
        `SELECT a.id, a.user_id, a.action, a.outcome, a.resource_type, a.resource_id,
                a.metadata, a.created_at, u.email AS actor_email, u.display_name AS actor_name
           FROM audit_logs a
           LEFT JOIN users u ON u.id = a.user_id
          WHERE a.company_id = ?
          ORDER BY a.id DESC
          LIMIT 20`,
        [companyId],
      ),
      5_000,
      'getCompanyAdminOverview:activity',
    );

    const employees: CompanyAdminEmployee[] = empRows.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      isActive: r.is_active === 1 && !r.deleted_at,
      createdAt: r.created_at ? toDate(r.created_at) : company.createdAt,
      lastLoginAt: r.last_login_at ? toDate(r.last_login_at) : null,
    }));

    const totalEmployees = employees.length;
    const ownerCount = employees.filter((e) => e.role === 'owner').length;
    const adminCount = employees.filter((e) => e.role === 'admin').length;
    const activeEmployees = employees.filter((e) => e.isActive).length;
    const pendingInvitationsCount = Number(invRows[0]?.total ?? 0);

    const recentActivity: CompanyAdminActivityEntry[] = actRows.map((r) => ({
      id: String(r.id),
      action: r.action,
      outcome: r.outcome,
      actorId: r.user_id,
      actorEmail: r.actor_email ?? null,
      actorName: r.actor_name ?? null,
      resourceType: r.resource_type ?? null,
      resourceId: r.resource_id ?? null,
      metadata: (parseMetadata(r.metadata) as Record<string, unknown>) ?? null,
      createdAt: toDate(r.created_at).toISOString(),
    }));

    return {
      company: {
        id: company.id,
        name: company.name,
        domain: company.domain ?? null,
        createdAt: company.createdAt,
      },
      metrics: {
        totalEmployees,
        ownerCount,
        adminCount,
        activeEmployees,
        pendingInvitationsCount,
      },
      employees,
      recentActivity,
    };
  }

  async updateUserRoleAndCompany(userId: string, companyId: string | null, role: UserRole): Promise<void> {
    await this.pool.execute(
      'UPDATE users SET company_id = ?, role = ? WHERE id = ?',
      [companyId, role, userId],
    );
  }

  async removeCompanyMember(userId: string, companyId: string): Promise<void> {
    await withDbTimeout(
      this.pool.execute(
        'UPDATE users SET company_id = NULL, role = ? WHERE id = ?',
        ['owner', userId],
      ),
      5_000,
      'removeCompanyMember.updateUser',
    );

    await withDbTimeout(
      this.pool.execute(
        `DELETE p FROM document_permissions p
          INNER JOIN documents d ON d.id = p.document_id
         WHERE p.user_id = ? AND d.company_id = ?`,
        [userId, companyId],
      ),
      5_000,
      'removeCompanyMember.revokePermissions',
    );
  }

  async createInvitation(input: {
    id: string;
    companyId: string;
    invitedBy: string;
    email: string;
    role: 'admin' | 'editor' | 'viewer';
    token: string;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<CompanyInvitation> {
    await withDbTimeout(
      this.pool.execute(
        `INSERT INTO company_invitations (id, company_id, invited_by, email, role, token, status, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        [
          input.id,
          input.companyId,
          input.invitedBy,
          input.email,
          input.role,
          input.token,
          input.expiresAt,
          input.createdAt,
          input.createdAt,
        ],
      ),
      5_000,
      'createInvitation',
    );
    return {
      id: input.id,
      companyId: input.companyId,
      invitedBy: input.invitedBy,
      email: input.email,
      role: input.role,
      token: input.token,
      status: 'pending',
      expiresAt: input.expiresAt,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
  }

  async findInvitationByToken(token: string): Promise<CompanyInvitation | null> {
    const [rows] = await withDbTimeout(
      this.pool.execute<RowDataPacket[]>(
        `SELECT i.id, i.company_id, i.invited_by, i.email, i.role, i.token, i.status,
                i.expires_at, i.created_at, i.updated_at,
                c.name AS company_name, u.display_name AS invited_by_name
           FROM company_invitations i
           LEFT JOIN companies c ON c.id = i.company_id
           LEFT JOIN users u ON u.id = i.invited_by
          WHERE i.token = ? LIMIT 1`,
        [token],
      ),
      5_000,
      'findInvitationByToken',
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      companyId: row.company_id,
      companyName: row.company_name ?? 'Workspace',
      invitedBy: row.invited_by,
      invitedByName: row.invited_by_name ?? null,
      email: row.email,
      role: row.role,
      token: row.token,
      status: row.status,
      expiresAt: toDate(row.expires_at),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  async findInvitationById(id: string): Promise<CompanyInvitation | null> {
    const [rows] = await withDbTimeout(
      this.pool.execute<RowDataPacket[]>(
        `SELECT i.id, i.company_id, i.invited_by, i.email, i.role, i.token, i.status,
                i.expires_at, i.created_at, i.updated_at,
                c.name AS company_name, u.display_name AS invited_by_name
           FROM company_invitations i
           LEFT JOIN companies c ON c.id = i.company_id
           LEFT JOIN users u ON u.id = i.invited_by
          WHERE i.id = ? LIMIT 1`,
        [id],
      ),
      5_000,
      'findInvitationById',
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      companyId: row.company_id,
      companyName: row.company_name ?? 'Workspace',
      invitedBy: row.invited_by,
      invitedByName: row.invited_by_name ?? null,
      email: row.email,
      role: row.role,
      token: row.token,
      status: row.status,
      expiresAt: toDate(row.expires_at),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  async listCompanyInvitations(companyId: string): Promise<CompanyInvitation[]> {
    const [rows] = await withDbTimeout(
      this.pool.execute<RowDataPacket[]>(
        `SELECT i.id, i.company_id, i.invited_by, i.email, i.role, i.token, i.status,
                i.expires_at, i.created_at, i.updated_at,
                c.name AS company_name, u.display_name AS invited_by_name
           FROM company_invitations i
           LEFT JOIN companies c ON c.id = i.company_id
           LEFT JOIN users u ON u.id = i.invited_by
          WHERE i.company_id = ?
          ORDER BY i.created_at DESC`,
        [companyId],
      ),
      5_000,
      'listCompanyInvitations',
    );
    const now = Date.now();
    return rows.map((row) => {
      const expiresAt = toDate(row.expires_at);
      let status = row.status;
      if (status === 'pending' && expiresAt.getTime() <= now) {
        status = 'expired';
      }
      return {
        id: row.id,
        companyId: row.company_id,
        companyName: row.company_name ?? 'Workspace',
        invitedBy: row.invited_by,
        invitedByName: row.invited_by_name ?? null,
        email: row.email,
        role: row.role,
        token: row.token,
        status,
        expiresAt,
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
      };
    });
  }

  async updateInvitationStatus(id: string, status: 'accepted' | 'revoked' | 'expired'): Promise<void> {
    await withDbTimeout(
      this.pool.execute(
        'UPDATE company_invitations SET status = ?, updated_at = NOW() WHERE id = ?',
        [status, id],
      ),
      5_000,
      'updateInvitationStatus',
    );
  }

  async findPendingInvitationByEmail(
    companyId: string,
    email: string,
  ): Promise<CompanyInvitation | null> {
    const [rows] = await withDbTimeout(
      this.pool.execute<RowDataPacket[]>(
        `SELECT i.id, i.company_id, i.invited_by, i.email, i.role, i.token, i.status,
                i.expires_at, i.created_at, i.updated_at,
                c.name AS company_name, u.display_name AS invited_by_name
           FROM company_invitations i
           LEFT JOIN companies c ON c.id = i.company_id
           LEFT JOIN users u ON u.id = i.invited_by
          WHERE i.company_id = ? AND i.email = ? AND i.status = 'pending'
          ORDER BY i.created_at DESC
          LIMIT 1`,
        [companyId, email],
      ),
      5_000,
      'findPendingInvitationByEmail',
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      companyId: row.company_id,
      companyName: row.company_name ?? 'Workspace',
      invitedBy: row.invited_by,
      invitedByName: row.invited_by_name ?? null,
      email: row.email,
      role: row.role,
      token: row.token,
      status: row.status,
      expiresAt: toDate(row.expires_at),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  async updatePendingInvitation(
    id: string,
    input: { token: string; role: 'admin' | 'editor' | 'viewer'; expiresAt: Date },
  ): Promise<CompanyInvitation> {
    const now = new Date();
    await withDbTimeout(
      this.pool.execute(
        `UPDATE company_invitations
            SET token = ?, role = ?, expires_at = ?, status = 'pending', updated_at = ?
          WHERE id = ?`,
        [input.token, input.role, input.expiresAt, now, id],
      ),
      5_000,
      'updatePendingInvitation',
    );
    const updated = await this.findInvitationById(id);
    if (!updated) throw new Error('Invitation record not found after update');
    return updated;
  }

  async deleteInvitation(id: string): Promise<void> {
    await withDbTimeout(
      this.pool.execute('DELETE FROM company_invitations WHERE id = ?', [id]),
      5_000,
      'deleteInvitation',
    );
  }

  async findUserByEmail(email: string): Promise<UserWithCredentials | null> {
    const [rows] = await this.pool.execute<UserRow[]>(
      `SELECT u.id, u.email, u.display_name, u.company_id, c.name AS company_name, u.role, u.is_active,
              u.password_hash, u.failed_login_count, u.locked_until, u.password_changed_at
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
        WHERE u.email = ?
        LIMIT 1`,
      [email],
    );
    const row = rows[0];
    return row ? toUser(row) : null;
  }

  async findUserById(id: string): Promise<UserWithCredentials | null> {
    const [rows] = await this.pool.execute<UserRow[]>(
      `SELECT u.id, u.email, u.display_name, u.company_id, c.name AS company_name, u.role, u.is_active,
              u.password_hash, u.failed_login_count, u.locked_until, u.password_changed_at
         FROM users u
         LEFT JOIN companies c ON c.id = u.company_id
        WHERE u.id = ?
        LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row ? toUser(row) : null;
  }

  async updateUserProfile(userId: string, patch: { displayName: string }): Promise<AuthUser | null> {
    await withDbTimeout(
      this.pool.execute(
        'UPDATE users SET display_name = ?, updated_at = NOW() WHERE id = ?',
        [patch.displayName, userId],
      ),
      5_000,
      'updateUserProfile',
    );
    const user = await this.findUserById(userId);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      companyId: user.companyId,
      companyName: user.companyName,
      role: user.role,
      isActive: user.isActive,
    };
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await withDbTimeout(
      this.pool.execute(
        'UPDATE users SET password_hash = ?, password_changed_at = NOW(3), updated_at = NOW() WHERE id = ?',
        [passwordHash, userId],
      ),
      5_000,
      'updateUserPassword',
    );
  }

  async setUserActive(userId: string, isActive: boolean): Promise<boolean> {
    const [result] = await this.pool.execute(
      'UPDATE users SET is_active = ? WHERE id = ?',
      [isActive ? 1 : 0, userId],
    );
    const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
    if (!isActive && affected > 0) {
      await this.pool.execute(
        'UPDATE sessions SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL',
        [userId],
      );
    }
    return affected > 0;
  }

  async deleteUserAccount(userId: string): Promise<boolean> {
    const now = new Date();
    const [result] = await withDbTimeout(
      this.pool.execute(
        `UPDATE users
            SET is_active = 0,
                deleted_at = ?,
                email = CONCAT('deleted_', id, '@trustvault.local'),
                display_name = 'Deleted Account'
          WHERE id = ? AND deleted_at IS NULL`,
        [now, userId],
      ),
      5_000,
      'deleteUserAccount',
    );
    const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
    if (affected > 0) {
      await withDbTimeout(
        this.pool.execute(
          'UPDATE sessions SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL',
          [userId],
        ),
        5_000,
        'deleteUserAccount.revokeSessions',
      );
    }
    return affected > 0;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const [rows] = await withDbTimeout(
      this.pool.execute<SessionRow[]>(
        `SELECT s.id            AS session_id,
                s.token_hash,
                s.csrf_token,
                s.created_at    AS session_created_at,
                s.expires_at,
                s.last_seen_at,
                s.revoked_at,
                u.id            AS user_id,
                u.email,
                u.display_name,
                u.company_id,
                c.name          AS company_name,
                u.role,
                u.is_active,
                u.password_changed_at
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN companies c ON c.id = u.company_id
          WHERE s.token_hash = ?
          LIMIT 1`,
        [tokenHash],
      ),
      5_000,
      'findSessionByTokenHash',
    );
    const row = rows[0];
    if (!row) return null;

    return {
      id: row.session_id,
      tokenHash: row.token_hash,
      csrfToken: row.csrf_token,
      createdAt: toDate(row.session_created_at),
      expiresAt: toDate(row.expires_at),
      lastSeenAt: toDate(row.last_seen_at),
      revokedAt: toDateOrNull(row.revoked_at),
      user: {
        id: row.user_id,
        email: row.email,
        displayName: row.display_name,
        companyId: row.company_id ?? null,
        companyName: row.company_name ?? null,
        role: row.role,
        isActive: row.is_active === 1,
        passwordChangedAt: toDateOrNull(row.password_changed_at),
      },
    };
  }

  async createSession(input: CreateSessionInput): Promise<void> {
    await this.pool.execute(
      `INSERT INTO sessions
         (id, user_id, token_hash, csrf_token, ip_hash, user_agent, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.userId,
        input.tokenHash,
        input.csrfToken,
        input.ipHash,
        input.userAgent,
        input.createdAt,
        input.createdAt,
        input.expiresAt,
      ],
    );
  }

  async touchSession(sessionId: string, seenAt: Date): Promise<void> {
    await this.pool.execute(
      'UPDATE sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL',
      [seenAt, sessionId],
    );
  }

  async revokeSession(sessionId: string, revokedAt: Date): Promise<void> {
    await this.pool.execute(
      'UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
      [revokedAt, sessionId],
    );
  }

  async revokeUserSessions(
    userId: string,
    revokedAt: Date,
    exceptSessionId?: string,
  ): Promise<void> {
    if (exceptSessionId === undefined) {
      await this.pool.execute(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
        [revokedAt, userId],
      );
      return;
    }
    await this.pool.execute(
      'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id <> ?',
      [revokedAt, userId, exceptSessionId],
    );
  }

  async recordLoginFailure(
    userId: string,
    params: { now: Date; maxAttempts: number; lockMinutes: number },
  ): Promise<void> {
    const lockedUntil = new Date(params.now.getTime() + params.lockMinutes * 60_000);
    await this.pool.execute(
      `UPDATE users
          SET failed_login_count = failed_login_count + 1,
              locked_until = CASE
                WHEN failed_login_count + 1 >= ? THEN ?
                ELSE locked_until
              END
        WHERE id = ?`,
      [params.maxAttempts, lockedUntil, userId],
    );
  }

  async recordLoginSuccess(userId: string, now: Date): Promise<void> {
    await this.pool.execute(
      `UPDATE users
          SET failed_login_count = 0,
              locked_until = NULL,
              last_login_at = ?
        WHERE id = ?`,
      [now, userId],
    );
  }

  async getLatestAuditHash(): Promise<string | null> {
    const [rows] = await this.pool.query<LatestHashRow[]>(
      'SELECT entry_hash FROM audit_logs WHERE entry_hash IS NOT NULL ORDER BY id DESC LIMIT 1',
    );
    return rows[0]?.entry_hash ?? null;
  }

  private auditMutex: Promise<void> = Promise.resolve();

  async recordAudit(event: AuditEventInput): Promise<AuditLogEntry> {
    const unlock = await new Promise<() => void>((resolve) => {
      this.auditMutex = this.auditMutex
        .catch(() => {})
        .then(() => new Promise<void>((done) => resolve(done)));
    });

    const conn = await this.pool.getConnection();
    let advisoryLockAcquired = false;

    try {
      try {
        const [lockRows] = await conn.query<RowDataPacket[]>(
          'SELECT GET_LOCK("tv_audit_write", 10) AS acquired',
        );
        advisoryLockAcquired = Number(lockRows[0]?.acquired) === 1;
      } catch {
        advisoryLockAcquired = false;
      }

      const now = event.createdAt ?? new Date();

      let prevHash = event.prevHash;
      if (!prevHash) {
        const [latestRows] = await conn.query<LatestHashRow[]>(
          'SELECT entry_hash FROM audit_logs WHERE entry_hash IS NOT NULL ORDER BY id DESC LIMIT 1',
        );
        prevHash = latestRows[0]?.entry_hash ?? GENESIS_HASH;
      }

      const entryHash =
        event.entryHash ??
        computeEntryHash({
          prevHash,
          userId: event.userId,
          targetUserId: event.targetUserId,
          action: event.action,
          outcome: event.outcome,
          resourceType: event.resourceType ?? null,
          resourceId: event.resourceId ?? null,
          requestId: event.requestId ?? null,
          createdAt: now,
          metadata: event.metadata ?? null,
        });

      const [result] = await conn.execute(
        `INSERT INTO audit_logs
           (user_id, company_id, target_user_id, action, outcome, resource_type, resource_id,
            ip_hash, user_agent, request_id, prev_hash, entry_hash, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.userId,
          event.companyId ?? null,
          event.targetUserId ?? null,
          event.action,
          event.outcome,
          event.resourceType ?? null,
          event.resourceId ?? null,
          event.ipHash ?? null,
          event.userAgent ?? null,
          event.requestId ?? null,
          prevHash,
          entryHash,
          event.metadata === undefined || event.metadata === null
            ? null
            : JSON.stringify(event.metadata),
          now,
        ],
      );

      const insertId = String((result as { insertId?: number }).insertId ?? '0');

      return {
        id: insertId,
        userId: event.userId,
        companyId: event.companyId ?? null,
        targetUserId: event.targetUserId ?? null,
        action: event.action,
        outcome: event.outcome,
        resourceType: event.resourceType ?? null,
        resourceId: event.resourceId ?? null,
        ipHash: event.ipHash ?? null,
        userAgent: event.userAgent ?? null,
        requestId: event.requestId ?? null,
        metadata: event.metadata ?? null,
        prevHash,
        entryHash,
        createdAt: now.toISOString(),
      };
    } finally {
      if (advisoryLockAcquired) {
        try {
          await conn.query('SELECT RELEASE_LOCK("tv_audit_write")');
        } catch {
          // ignore
        }
      }
      conn.release();
      unlock();
    }
  }

  private buildFilterClauses(params?: Omit<AuditFilterParams, 'limit' | 'offset'>): {
    where: string;
    bindings: unknown[];
  } {
    if (!params) return { where: '', bindings: [] };
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (params.actor) {
      conditions.push('(user_id = ? OR user_id IN (SELECT id FROM users WHERE email = ?))');
      bindings.push(params.actor, params.actor.toLowerCase());
    }

    if (params.documentId) {
      conditions.push('(resource_id = ? AND (resource_type = "document" OR resource_type IS NULL))');
      bindings.push(params.documentId);
    }

    if (params.action) {
      if (params.action.includes('%')) {
        conditions.push('action LIKE ?');
        bindings.push(params.action);
      } else {
        conditions.push('action = ?');
        bindings.push(params.action);
      }
    }

    if (params.outcome) {
      conditions.push('outcome = ?');
      bindings.push(params.outcome);
    }

    if (params.from) {
      conditions.push('created_at >= ?');
      bindings.push(new Date(`${params.from}T00:00:00.000Z`));
    }

    if (params.to) {
      conditions.push('created_at <= ?');
      bindings.push(new Date(`${params.to}T23:59:59.999Z`));
    }

    return {
      where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      bindings,
    };
  }

  async listAuditLogs(params: AuditFilterParams): Promise<AuditLogEntry[]> {
    const limit = Math.min(Math.max(Math.trunc(params.limit), 1), 100);
    const offset = Math.min(Math.max(Math.trunc(params.offset), 0), 1_000_000);
    const { where, bindings } = this.buildFilterClauses(params);

    const [rows] = await this.pool.query<AuditRow[]>(
      `SELECT id, user_id, target_user_id, action, outcome, resource_type, resource_id,
              ip_hash, user_agent, request_id, prev_hash, entry_hash, metadata, created_at
         FROM audit_logs
         ${where}
        ORDER BY id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      bindings,
    );

    return rows.map(toAuditEntry);
  }

  async countAuditLogs(params?: Omit<AuditFilterParams, 'limit' | 'offset'>): Promise<number> {
    const { where, bindings } = this.buildFilterClauses(params);
    const [rows] = await this.pool.query<CountRow[]>(
      `SELECT COUNT(*) AS total FROM audit_logs ${where}`,
      bindings,
    );
    return Number(rows[0]?.total ?? 0);
  }

  async createCheckpoint(): Promise<CheckpointRecord | null> {
    const [latestRows] = await this.pool.query<AuditRow[]>(
      'SELECT id, entry_hash FROM audit_logs WHERE entry_hash IS NOT NULL ORDER BY id DESC LIMIT 1',
    );
    const latest = latestRows[0];
    if (!latest || !latest.entry_hash) return null;

    const totalCount = await this.countAuditLogs();

    const [seqRows] = await this.pool.query<RowDataPacket[]>(
      'SELECT COALESCE(MAX(checkpoint_seq), 0) + 1 AS next_seq FROM audit_checkpoints',
    );
    const seq = Number((seqRows[0] as { next_seq?: number })?.next_seq ?? 1);

    const checkpointHash = computeCheckpointHash({
      checkpointSeq: seq,
      lastLogId: latest.id,
      lastEntryHash: latest.entry_hash,
      entryCount: totalCount,
    });

    const now = new Date();
    const [result] = await this.pool.execute(
      `INSERT INTO audit_checkpoints
         (checkpoint_seq, last_log_id, checkpoint_hash, entry_count, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [seq, latest.id, checkpointHash, totalCount, now],
    );

    const insertId = String((result as { insertId?: number }).insertId ?? '0');
    return {
      id: insertId,
      checkpointSeq: seq,
      lastLogId: String(latest.id),
      checkpointHash,
      entryCount: totalCount,
      createdAt: now.toISOString(),
    };
  }

  async listCheckpoints(): Promise<CheckpointRecord[]> {
    const [rows] = await this.pool.query<CheckpointRow[]>(
      'SELECT id, checkpoint_seq, last_log_id, checkpoint_hash, entry_count, created_at FROM audit_checkpoints ORDER BY checkpoint_seq DESC LIMIT 50',
    );
    return rows.map((row) => ({
      id: String(row.id),
      checkpointSeq: row.checkpoint_seq,
      lastLogId: String(row.last_log_id),
      checkpointHash: row.checkpoint_hash,
      entryCount: row.entry_count,
      createdAt: toDate(row.created_at).toISOString(),
    }));
  }

  async verifyAuditIntegrity(): Promise<AuditVerificationResult> {
    const [rows] = await this.pool.query<AuditRow[]>(
      `SELECT id, user_id, target_user_id, action, outcome, resource_type, resource_id,
              request_id, prev_hash, entry_hash, metadata, created_at
         FROM audit_logs
        ORDER BY id ASC`,
    );

    const incidentMap = new Map<string, IncidentRow>();
    try {
      const [incidentRows] = await this.pool.query<IncidentRow[]>(
        'SELECT event_id, incident_type, original_entry_hash, prev_hash, action, corrupted_field, remediation_status, forensic_note FROM audit_recovery_incidents',
      );
      for (const inc of incidentRows) {
        incidentMap.set(String(inc.event_id), inc);
      }
    } catch {
      // Table may not exist yet in environments prior to migration 0009
    }

    const recoveredIncidents: AuditRecoveryIncident[] = [];
    let lastHash: string = GENESIS_HASH;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      // If legacy un-hashed row, skip hash check
      if (!row.entry_hash) continue;

      if (i > 0 && row.prev_hash && row.prev_hash !== lastHash) {
        return {
          verified: false,
          totalEntries: rows.length,
          checkedCheckpoints: 0,
          lastVerifiedHash: lastHash,
          failureReason: `Hash chain broken at event ${row.id}: prev_hash does not match previous entry_hash`,
          failedAtId: String(row.id),
        };
      }

      const expectedHash = computeEntryHash({
        prevHash: row.prev_hash ?? lastHash,
        userId: row.user_id,
        targetUserId: row.target_user_id ?? null,
        action: row.action,
        outcome: row.outcome,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        requestId: row.request_id ?? null,
        createdAt: toDate(row.created_at),
        metadata: parseMetadata(row.metadata),
      });

      if (row.entry_hash !== expectedHash) {
        const incident = incidentMap.get(String(row.id));
        const isAttested =
          incident &&
          incident.original_entry_hash === row.entry_hash &&
          incident.prev_hash === (row.prev_hash ?? lastHash) &&
          (incident.remediation_status === 'explained_legacy_cascade' ||
            incident.remediation_status === 'forensic_attested');

        if (isAttested) {
          recoveredIncidents.push({
            eventId: String(incident.event_id),
            incidentType: incident.incident_type,
            action: incident.action,
            corruptedField: incident.corrupted_field,
            remediationStatus: incident.remediation_status,
            forensicNote: incident.forensic_note,
          });
        } else {
          const isCascadeNulled =
            (row.user_id === null || row.user_id === '') &&
            row.action !== 'demo_seed' &&
            row.action !== 'login_failed';
          const failureReason = isCascadeNulled
            ? `Tampered log content at event ${row.id}: entry_hash does not match canonical payload digest (user_id was set to null by legacy relational foreign key cascade on user deletion; cryptographic chain remains intact)`
            : `Tampered log content at event ${row.id}: entry_hash does not match canonical payload digest`;

          return {
            verified: false,
            totalEntries: rows.length,
            checkedCheckpoints: 0,
            lastVerifiedHash: lastHash,
            failureReason,
            failedAtId: String(row.id),
          };
        }
      }

      lastHash = row.entry_hash;
    }

    const checkpoints = await this.listCheckpoints();
    for (const cp of checkpoints) {
      const targetEntry = rows.find((r) => String(r.id) === String(cp.lastLogId));
      if (!targetEntry || !targetEntry.entry_hash) {
        return {
          verified: false,
          totalEntries: rows.length,
          checkedCheckpoints: checkpoints.length,
          lastVerifiedHash: lastHash,
          failureReason: `Checkpoint ${cp.checkpointSeq} references non-existent or unhashed log entry ${cp.lastLogId}`,
          failedAtId: String(cp.lastLogId),
        };
      }

      const expectedCpHash = computeCheckpointHash({
        checkpointSeq: cp.checkpointSeq,
        lastLogId: String(cp.lastLogId),
        lastEntryHash: targetEntry.entry_hash,
        entryCount: cp.entryCount,
      });

      if (cp.checkpointHash !== expectedCpHash) {
        return {
          verified: false,
          totalEntries: rows.length,
          checkedCheckpoints: checkpoints.length,
          lastVerifiedHash: lastHash,
          failureReason: `Checkpoint ${cp.checkpointSeq} hash mismatch: expected ${expectedCpHash}, found ${cp.checkpointHash}`,
        };
      }
    }

    return {
      verified: true,
      totalEntries: rows.length,
      checkedCheckpoints: checkpoints.length,
      lastVerifiedHash: rows.length > 0 ? lastHash : null,
      incidents: recoveredIncidents.length > 0 ? recoveredIncidents : undefined,
    };
  }
}
