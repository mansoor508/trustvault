import {
  computeCheckpointHash,
  computeEntryHash,
  GENESIS_HASH,
} from '../../src/auth/audit-crypto.js';
import type {
  AuditEventInput,
  AuditFilterParams,
  AuditLogEntry,
  AuditRecoveryIncident,
  AuditVerificationResult,
  AuthStore,
  CheckpointRecord,
  CreateSessionInput,
  CreateUserInput,
  SessionRecord,
  UserWithCredentials,
} from '../../src/auth/auth-store.js';
import type {
  AuthUser,
  Company,
  CompanyAdminActivityEntry,
  CompanyAdminEmployee,
  CompanyAdminOverview,
  CompanyInvitation,
  UserRole,
} from '../../src/auth/types.js';

interface StoredSession {
  id: string;
  userId: string;
  tokenHash: string;
  csrfToken: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

export interface NewUserInput {
  email: string;
  passwordHash: string;
  role?: UserRole;
  isActive?: boolean;
  displayName?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  createdAt?: Date;
  lastLoginAt?: Date | null;
  failedLoginCount?: number;
  lockedUntil?: Date | null;
  passwordChangedAt?: Date | null;
}

/**
 * Test double for AuthStore.
 *
 * It mirrors the MySQL semantics (hashed token lookup, revocation, lockout
 * counters, tamper-evident hash chaining, and append-only audit enforcement)
 * without a database, so the auth and audit flows can be exercised through real
 * HTTP requests.
 */
export class InMemoryAuthStore implements AuthStore {
  readonly companies = new Map<string, Company>();
  readonly users = new Map<string, UserWithCredentials>();
  readonly invitations = new Map<string, CompanyInvitation>();
  readonly sessions = new Map<string, StoredSession>();
  readonly auditEvents: AuditLogEntry[] = [];
  readonly checkpoints: CheckpointRecord[] = [];
  readonly recoveryIncidents = new Map<string, AuditRecoveryIncident>();

  private userSequence = 0;
  private auditSequence = 0;
  private checkpointSequence = 0;

  async createCompany(input: { id: string; name: string; domain?: string | null; createdAt: Date }): Promise<Company> {
    const company: Company = {
      id: input.id,
      name: input.name,
      domain: input.domain ?? null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.companies.set(company.id, company);
    return company;
  }

  async findCompanyById(id: string): Promise<Company | null> {
    const company = this.companies.get(id);
    return company ? { ...company } : null;
  }

  async updateCompany(id: string, patch: { name?: string; domain?: string | null }): Promise<Company | null> {
    const company = this.companies.get(id);
    if (!company) return null;
    if (patch.name !== undefined) company.name = patch.name;
    if (patch.domain !== undefined) company.domain = patch.domain;
    company.updatedAt = new Date();
    return { ...company };
  }

  async createUser(input: CreateUserInput): Promise<UserWithCredentials> {
    const user: UserWithCredentials = {
      id: input.id,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName ?? null,
      companyId: input.companyId ?? null,
      companyName: input.companyId ? this.companies.get(input.companyId)?.name ?? null : null,
      role: input.role,
      isActive: true,
      passwordHash: input.passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
      passwordChangedAt: null,
      createdAt: input.createdAt,
      lastLoginAt: null,
    };
    this.users.set(user.id, user);
    return user;
  }

  async deleteUserAccount(userId: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user || !user.isActive) return false;
    user.isActive = false;
    user.email = `deleted_${userId}@trustvault.local`;
    user.displayName = 'Deleted Account';

    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = new Date();
      }
    }
    return true;
  }

  async listCompanyUsers(companyId: string): Promise<AuthUser[]> {
    return [...this.users.values()]
      .filter((u) => u.companyId === companyId)
      .map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        companyId: u.companyId,
        companyName: u.companyName,
        role: u.role,
        isActive: u.isActive,
      }));
  }

  async getCompanyAdminOverview(companyId: string): Promise<CompanyAdminOverview> {
    const company = this.companies.get(companyId);
    if (!company) {
      throw new Error('Workspace not found');
    }

    const employees: CompanyAdminEmployee[] = [...this.users.values()]
      .filter((u) => u.companyId === companyId)
      .map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        isActive: u.isActive,
        createdAt: u.createdAt ?? company.createdAt,
        lastLoginAt: u.lastLoginAt ?? null,
      }))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const totalEmployees = employees.length;
    const ownerCount = employees.filter((e) => e.role === 'owner').length;
    const adminCount = employees.filter((e) => e.role === 'admin').length;
    const activeEmployees = employees.filter((e) => e.isActive).length;

    const now = Date.now();
    const pendingInvitationsCount = [...this.invitations.values()].filter(
      (inv) => inv.companyId === companyId && inv.status === 'pending' && inv.expiresAt.getTime() > now,
    ).length;

    const userMap = new Map<string, UserWithCredentials>();
    for (const u of this.users.values()) {
      userMap.set(u.id, u);
    }

    const recentActivity: CompanyAdminActivityEntry[] = this.auditEvents
      .filter((e) => e.companyId === companyId)
      .slice(-20)
      .reverse()
      .map((e) => {
        const actor = e.userId ? userMap.get(e.userId) : null;
        return {
          id: e.id,
          action: e.action,
          outcome: e.outcome,
          actorId: e.userId,
          actorEmail: actor?.email ?? null,
          actorName: actor?.displayName ?? null,
          resourceType: e.resourceType,
          resourceId: e.resourceId,
          metadata: e.metadata,
          createdAt: e.createdAt,
        };
      });

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

  onMemberRemoved?: (userId: string, companyId: string) => void;

  async updateUserRoleAndCompany(userId: string, companyId: string | null, role: UserRole): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.companyId = companyId;
      user.companyName = companyId ? this.companies.get(companyId)?.name ?? null : null;
      user.role = role;
    }
  }

  async removeCompanyMember(userId: string, companyId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.companyId = null;
      user.companyName = null;
      user.role = 'owner';
    }
    this.onMemberRemoved?.(userId, companyId);
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
    const company = this.companies.get(input.companyId);
    const inviter = this.users.get(input.invitedBy);
    const invitation: CompanyInvitation = {
      id: input.id,
      companyId: input.companyId,
      companyName: company?.name,
      invitedBy: input.invitedBy,
      invitedByName: inviter?.displayName ?? undefined,
      email: input.email.trim().toLowerCase(),
      role: input.role,
      token: input.token,
      status: 'pending',
      expiresAt: input.expiresAt,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    this.invitations.set(invitation.id, invitation);
    return invitation;
  }

  async findInvitationByToken(token: string): Promise<CompanyInvitation | null> {
    for (const inv of this.invitations.values()) {
      if (inv.token === token) return { ...inv };
    }
    return null;
  }

  async findInvitationById(id: string): Promise<CompanyInvitation | null> {
    const inv = this.invitations.get(id);
    return inv ? { ...inv } : null;
  }

  async listCompanyInvitations(companyId: string): Promise<CompanyInvitation[]> {
    const now = Date.now();
    return [...this.invitations.values()]
      .filter((i) => i.companyId === companyId)
      .map((i) => {
        let status = i.status;
        if (status === 'pending' && i.expiresAt.getTime() <= now) {
          status = 'expired';
        }
        return { ...i, status };
      });
  }

  async updateInvitationStatus(id: string, status: 'accepted' | 'revoked' | 'expired'): Promise<void> {
    const inv = this.invitations.get(id);
    if (inv) {
      inv.status = status;
      inv.updatedAt = new Date();
    }
  }

  async findPendingInvitationByEmail(
    companyId: string,
    email: string,
  ): Promise<CompanyInvitation | null> {
    const normalized = email.trim().toLowerCase();
    for (const inv of this.invitations.values()) {
      if (inv.companyId === companyId && inv.email === normalized && inv.status === 'pending') {
        return { ...inv };
      }
    }
    return null;
  }

  async updatePendingInvitation(
    id: string,
    input: { token: string; role: 'admin' | 'editor' | 'viewer'; expiresAt: Date },
  ): Promise<CompanyInvitation> {
    const inv = this.invitations.get(id);
    if (!inv) throw new Error('Invitation record not found in memory store');
    inv.token = input.token;
    inv.role = input.role;
    inv.expiresAt = input.expiresAt;
    inv.status = 'pending';
    inv.updatedAt = new Date();
    return { ...inv };
  }

  async deleteInvitation(id: string): Promise<void> {
    this.invitations.delete(id);
  }

  addUser(input: NewUserInput): UserWithCredentials {
    this.userSequence += 1;
    const user: UserWithCredentials = {
      id: `00000000-0000-4000-8000-${String(this.userSequence).padStart(12, '0')}`,
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName ?? null,
      companyId: input.companyId ?? null,
      companyName: input.companyName ?? (input.companyId ? this.companies.get(input.companyId)?.name ?? null : null),
      role: input.role ?? 'viewer',
      isActive: input.isActive ?? true,
      passwordHash: input.passwordHash,
      failedLoginCount: input.failedLoginCount ?? 0,
      lockedUntil: input.lockedUntil ?? null,
      passwordChangedAt: input.passwordChangedAt ?? null,
      createdAt: input.createdAt ?? new Date(),
      lastLoginAt: input.lastLoginAt ?? null,
    };
    this.users.set(user.id, user);
    return user;
  }

  setActive(userId: string, isActive: boolean): void {
    const user = this.users.get(userId);
    if (user) user.isActive = isActive;
  }

  setPasswordChangedAt(userId: string, changedAt: Date): void {
    const user = this.users.get(userId);
    if (user) user.passwordChangedAt = changedAt;
  }

  sessionsFor(userId: string): StoredSession[] {
    return [...this.sessions.values()].filter((session) => session.userId === userId);
  }

  firstSession(): StoredSession {
    const session = [...this.sessions.values()][0];
    if (!session) throw new Error('Expected at least one session in the store');
    return session;
  }

  async findUserByEmail(email: string): Promise<UserWithCredentials | null> {
    const normalized = email.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (user.email === normalized) return { ...user };
    }
    return null;
  }

  async findUserById(id: string): Promise<UserWithCredentials | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async updateUserProfile(userId: string, patch: { displayName: string }): Promise<AuthUser | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    user.displayName = patch.displayName;
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
    const user = this.users.get(userId);
    if (!user) return;
    user.passwordHash = passwordHash;
    user.passwordChangedAt = new Date();
  }

  async setUserActive(userId: string, isActive: boolean): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) return false;
    user.isActive = isActive;
    if (!isActive) {
      const now = new Date();
      for (const session of this.sessions.values()) {
        if (session.userId === userId && session.revokedAt === null) {
          session.revokedAt = now;
        }
      }
    }
    return true;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    for (const session of this.sessions.values()) {
      if (session.tokenHash !== tokenHash) continue;
      const user = this.users.get(session.userId);
      if (!user) return null;
      return {
        id: session.id,
        tokenHash: session.tokenHash,
        csrfToken: session.csrfToken,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        lastSeenAt: session.lastSeenAt,
        revokedAt: session.revokedAt,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          isActive: user.isActive,
          passwordChangedAt: user.passwordChangedAt,
          companyId: user.companyId ?? null,
          companyName: user.companyName ?? null,
        },
      };
    }
    return null;
  }

  async createSession(input: CreateSessionInput): Promise<void> {
    this.sessions.set(input.id, {
      id: input.id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      csrfToken: input.csrfToken,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      lastSeenAt: input.createdAt,
      revokedAt: null,
    });
  }

  async touchSession(sessionId: string, seenAt: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session && session.revokedAt === null) session.lastSeenAt = seenAt;
  }

  async revokeSession(sessionId: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session && session.revokedAt === null) session.revokedAt = revokedAt;
  }

  async revokeUserSessions(
    userId: string,
    revokedAt: Date,
    exceptSessionId?: string,
  ): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.userId !== userId) continue;
      if (exceptSessionId !== undefined && session.id === exceptSessionId) continue;
      if (session.revokedAt === null) session.revokedAt = revokedAt;
    }
  }

  async recordLoginFailure(
    userId: string,
    params: { now: Date; maxAttempts: number; lockMinutes: number },
  ): Promise<void> {
    const user = this.users.get(userId);
    if (!user) return;
    user.failedLoginCount += 1;
    if (user.failedLoginCount >= params.maxAttempts) {
      user.lockedUntil = new Date(params.now.getTime() + params.lockMinutes * 60_000);
    }
  }

  async recordLoginSuccess(userId: string, now?: Date): Promise<void> {
    const user = this.users.get(userId);
    if (!user) return;
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    user.lastLoginAt = now ?? new Date();
  }

  async getLatestAuditHash(): Promise<string | null> {
    const last = this.auditEvents[this.auditEvents.length - 1];
    return last?.entryHash ?? null;
  }

  private auditMutex: Promise<void> = Promise.resolve();

  async recordAudit(event: AuditEventInput): Promise<AuditLogEntry> {
    const unlock = await new Promise<() => void>((resolve) => {
      this.auditMutex = this.auditMutex
        .catch(() => {})
        .then(() => new Promise<void>((done) => resolve(done)));
    });

    try {
      this.auditSequence += 1;
      const now = event.createdAt ?? new Date();
      const prevHash = event.prevHash ?? (await this.getLatestAuditHash()) ?? GENESIS_HASH;

      const entryHash =
        event.entryHash ??
        computeEntryHash({
          prevHash,
          userId: event.userId,
          targetUserId: event.targetUserId ?? null,
          action: event.action,
          outcome: event.outcome,
          resourceType: event.resourceType ?? null,
          resourceId: event.resourceId ?? null,
          requestId: event.requestId ?? null,
          createdAt: now,
          metadata: event.metadata ?? null,
        });

      const entry: AuditLogEntry = {
        id: String(this.auditSequence),
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

      this.auditEvents.push(entry);
      return entry;
    } finally {
      unlock();
    }
  }

  private filterAuditEvents(
    params?: Omit<AuditFilterParams, 'limit' | 'offset'>,
  ): AuditLogEntry[] {
    if (!params) return [...this.auditEvents];

    return this.auditEvents.filter((event) => {
      if (params.actor) {
        const actorMatches =
          event.userId === params.actor ||
          (event.userId !== null &&
            this.users.get(event.userId)?.email === params.actor.toLowerCase());
        if (!actorMatches) return false;
      }
      if (params.documentId && event.resourceId !== params.documentId) {
        return false;
      }
      if (params.action) {
        if (params.action.endsWith('%')) {
          const prefix = params.action.slice(0, -1);
          if (!event.action.startsWith(prefix)) return false;
        } else if (event.action !== params.action) {
          return false;
        }
      }
      if (params.outcome && event.outcome !== params.outcome) {
        return false;
      }
      if (params.from) {
        const fromDate = new Date(`${params.from}T00:00:00.000Z`);
        if (new Date(event.createdAt) < fromDate) return false;
      }
      if (params.to) {
        const toDate = new Date(`${params.to}T23:59:59.999Z`);
        if (new Date(event.createdAt) > toDate) return false;
      }
      return true;
    });
  }

  async listAuditLogs(params: AuditFilterParams): Promise<AuditLogEntry[]> {
    const filtered = this.filterAuditEvents(params);
    return [...filtered]
      .reverse()
      .slice(params.offset, params.offset + params.limit);
  }

  async countAuditLogs(
    params?: Omit<AuditFilterParams, 'limit' | 'offset'>,
  ): Promise<number> {
    return this.filterAuditEvents(params).length;
  }

  async createCheckpoint(): Promise<CheckpointRecord | null> {
    const last = this.auditEvents[this.auditEvents.length - 1];
    if (!last || !last.entryHash) return null;

    this.checkpointSequence += 1;
    const count = this.auditEvents.length;
    const checkpointHash = computeCheckpointHash({
      checkpointSeq: this.checkpointSequence,
      lastLogId: last.id,
      lastEntryHash: last.entryHash,
      entryCount: count,
    });

    const checkpoint: CheckpointRecord = {
      id: String(this.checkpointSequence),
      checkpointSeq: this.checkpointSequence,
      lastLogId: last.id,
      checkpointHash,
      entryCount: count,
      createdAt: new Date().toISOString(),
    };

    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  async listCheckpoints(): Promise<CheckpointRecord[]> {
    return [...this.checkpoints].reverse();
  }

  async verifyAuditIntegrity(): Promise<AuditVerificationResult> {
    const recoveredIncidents: AuditRecoveryIncident[] = [];
    let lastHash: string = GENESIS_HASH;

    for (let i = 0; i < this.auditEvents.length; i++) {
      const entry = this.auditEvents[i]!;

      if (i > 0 && entry.prevHash !== lastHash) {
        return {
          verified: false,
          totalEntries: this.auditEvents.length,
          checkedCheckpoints: this.checkpoints.length,
          lastVerifiedHash: lastHash,
          failureReason: `Hash chain broken at event ${entry.id}: prevHash does not match previous entryHash`,
          failedAtId: entry.id,
        };
      }

      const expectedHash = computeEntryHash({
        prevHash: entry.prevHash ?? lastHash,
        userId: entry.userId,
        targetUserId: entry.targetUserId,
        action: entry.action,
        outcome: entry.outcome,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        requestId: entry.requestId,
        createdAt: new Date(entry.createdAt),
        metadata: entry.metadata,
      });

      if (entry.entryHash !== expectedHash) {
        const incident = this.recoveryIncidents.get(entry.id);
        const isAttested =
          incident &&
          (incident.remediationStatus === 'explained_legacy_cascade' ||
            incident.remediationStatus === 'forensic_attested');

        if (isAttested) {
          recoveredIncidents.push(incident);
        } else {
          return {
            verified: false,
            totalEntries: this.auditEvents.length,
            checkedCheckpoints: this.checkpoints.length,
            lastVerifiedHash: lastHash,
            failureReason: `Tampered log content at event ${entry.id}: entryHash does not match canonical payload digest`,
            failedAtId: entry.id,
          };
        }
      }

      lastHash = entry.entryHash!;
    }

    // Verify checkpoints against chain
    for (const cp of this.checkpoints) {
      const targetEntry = this.auditEvents.find((e) => e.id === cp.lastLogId);
      if (!targetEntry || !targetEntry.entryHash) {
        return {
          verified: false,
          totalEntries: this.auditEvents.length,
          checkedCheckpoints: this.checkpoints.length,
          lastVerifiedHash: lastHash,
          failureReason: `Checkpoint ${cp.checkpointSeq} references non-existent or unhashed log entry ${cp.lastLogId}`,
          failedAtId: cp.lastLogId,
        };
      }
      const expectedCpHash = computeCheckpointHash({
        checkpointSeq: cp.checkpointSeq,
        lastLogId: cp.lastLogId,
        lastEntryHash: targetEntry.entryHash,
        entryCount: cp.entryCount,
      });
      if (cp.checkpointHash !== expectedCpHash) {
        return {
          verified: false,
          totalEntries: this.auditEvents.length,
          checkedCheckpoints: this.checkpoints.length,
          lastVerifiedHash: lastHash,
          failureReason: `Checkpoint ${cp.checkpointSeq} hash mismatch`,
        };
      }
    }

    return {
      verified: true,
      totalEntries: this.auditEvents.length,
      checkedCheckpoints: this.checkpoints.length,
      lastVerifiedHash: this.auditEvents.length > 0 ? lastHash : null,
      incidents: recoveredIncidents.length > 0 ? recoveredIncidents : undefined,
    };
  }

  addRecoveryIncident(incident: AuditRecoveryIncident): void {
    this.recoveryIncidents.set(incident.eventId, incident);
  }

  /**
   * Simulates the database BEFORE UPDATE trigger rejecting modification.
   */
  async attemptUpdateAudit(_id: string, _patch: unknown): Promise<never> {
    throw new Error('Audit log records are immutable and cannot be updated');
  }

  /**
   * Simulates the database BEFORE DELETE trigger rejecting deletion.
   */
  async attemptDeleteAudit(_id: string): Promise<never> {
    throw new Error('Audit log records are immutable and cannot be deleted');
  }

  /**
   * Test helper to simulate attacker tampering with an in-memory record
   * to prove that verifyAuditIntegrity accurately detects unauthorized mutations.
   */
  simulateTamper(id: string, patch: Partial<AuditLogEntry>): void {
    const entry = this.auditEvents.find((e) => e.id === id);
    if (entry) Object.assign(entry, patch);
  }

  simulateCheckpointTamper(seq: number, patch: Partial<CheckpointRecord>): void {
    const cp = this.checkpoints.find((c) => c.checkpointSeq === seq);
    if (cp) Object.assign(cp, patch);
  }

  /**
   * Convenience helper for tests that need to seed audit events directly
   * without going through the full HTTP stack.
   */
  addTestAuditEvent(input: {
    userId?: string | null;
    action: string;
    outcome: 'success' | 'failure' | 'denied';
    resourceType?: string | null;
    resourceId?: string | null;
  }): void {
    void this.recordAudit({
      userId: input.userId ?? null,
      action: input.action,
      outcome: input.outcome,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
    });
  }
}
