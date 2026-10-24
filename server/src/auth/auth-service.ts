import type { Env } from '../config/env.js';
import type { Logger } from '../config/logger.js';
import { AppError } from '../http/errors.js';
import type {
  AuditEventInput,
  AuditFilterParams,
  AuditLogEntry,
  AuditVerificationResult,
  AuthStore,
  CheckpointRecord,
  UserWithCredentials,
} from './auth-store.js';
import { hashPassword, verifyAgainstDummyHash, verifyPassword } from './password.js';
import {
  constantTimeEqual,
  generateCsrfToken,
  generateInvitationToken,
  generateSessionToken,
  hashInvitationToken,
  hashIpAddress,
  hashSessionToken,
  newId,
  truncate,
} from './tokens.js';
import type { AuthContext, AuthUser, CompanyAdminOverview } from './types.js';

export class AuthError extends AppError {
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super({ statusCode, code, message, details, expose: true });
    this.name = 'AuthError';
  }
}

export interface LoginInput {
  email: string;
  password: string;
  inviteToken?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
  /** A session cookie presented alongside the login request (fixation defence). */
  existingToken?: string | null;
}

export interface InvitationPublicDetails {
  email: string;
  companyName: string;
  role: 'admin' | 'editor' | 'viewer';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: Date;
}

export interface LoginResult {
  user: AuthUser;
  session: { id: string; csrfToken: string; createdAt: Date; expiresAt: Date };
  /** Raw session token. Only ever written to the HttpOnly cookie. */
  token: string;
}

export interface AuthenticateResult extends AuthContext {
  token: string;
}

export interface RequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export interface AuthServiceOptions {
  store: AuthStore;
  env: Env;
  clock?: () => Date;
  logger?: Logger;
}

/** Re-touch at most once a minute: a read on every request, a write rarely. */
const TOUCH_INTERVAL_MS = 60_000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

import type { Company, CompanyInvitation, UserRole } from './types.js';

export interface RegisterUserInput {
  displayName: string;
  email: string;
  password: string;
  companyName?: string | undefined;
  inviteToken?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export interface RegisterCompanyInput {
  displayName: string;
  email: string;
  password: string;
  companyName: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

function toAuthUser(user: AuthUser): AuthUser {
  const result: AuthUser = {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
  };
  if (user.companyId) result.companyId = user.companyId;
  if (user.companyName) result.companyName = user.companyName;
  return result;
}

function invalidCredentials(): AuthError {
  // Deliberately identical for unknown email, wrong password and disabled
  // account: the response must not reveal which one it was.
  return new AuthError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
}

export class AuthService {
  private readonly store: AuthStore;
  private readonly env: Env;
  private readonly clock: () => Date;
  private readonly logger: Logger | undefined;

  constructor(options: AuthServiceOptions) {
    this.store = options.store;
    this.env = options.env;
    this.clock = options.clock ?? (() => new Date());
    this.logger = options.logger;
  }

  private async resolveInvitation(rawToken: string, now: Date): Promise<CompanyInvitation> {
    const trimmed = rawToken.trim();
    if (!trimmed) {
      throw new AuthError(400, 'INVALID_INVITATION', 'Invitation token is required.');
    }
    const tokenHash = hashInvitationToken(trimmed);
    let invite = await this.store.findInvitationByToken(tokenHash);
    if (!invite) {
      invite = await this.store.findInvitationByToken(trimmed);
    }
    if (!invite) {
      throw new AuthError(404, 'INVALID_INVITATION', 'This invitation does not exist.');
    }
    if (invite.status === 'revoked') {
      throw new AuthError(410, 'INVITATION_REVOKED', 'This invitation has been revoked by the workspace administrator.');
    }
    if (invite.status === 'accepted') {
      throw new AuthError(409, 'INVITATION_ALREADY_ACCEPTED', 'This invitation has already been accepted.');
    }
    if (invite.status === 'expired' || invite.expiresAt.getTime() <= now.getTime()) {
      if (invite.status === 'pending') {
        await this.store.updateInvitationStatus(invite.id, 'expired');
      }
      throw new AuthError(410, 'INVITATION_EXPIRED', 'This invitation has expired.');
    }
    return invite;
  }

  async getInvitationDetails(token: string): Promise<InvitationPublicDetails> {
    const now = this.clock();
    const invite = await this.resolveInvitation(token, now);
    return {
      email: invite.email,
      companyName: invite.companyName ?? 'Workspace',
      role: invite.role,
      status: invite.status,
      expiresAt: invite.expiresAt,
    };
  }

  async registerCompany(input: RegisterCompanyInput): Promise<LoginResult> {
    return this.register(input);
  }

  async register(input: RegisterUserInput): Promise<LoginResult> {
    const now = this.clock();
    const email = normalizeEmail(input.email);

    if (input.password.length < 12) {
      throw new AuthError(422, 'WEAK_PASSWORD', 'Password must be at least 12 characters.');
    }

    const existing = await this.store.findUserByEmail(email);
    if (existing) {
      throw new AuthError(
        409,
        'EMAIL_ALREADY_EXISTS',
        'An account with this email address already exists. Please sign in or use a different email.',
      );
    }

    let companyId: string | null = null;
    let companyName: string | null = null;
    let role: UserRole = 'owner';
    let pendingInviteId: string | null = null;

    // 1. If an invitation token is provided, validate and join that company
    if (input.inviteToken?.trim()) {
      const invite = await this.resolveInvitation(input.inviteToken, now);
      if (email !== normalizeEmail(invite.email)) {
        throw new AuthError(
          403,
          'INVITATION_EMAIL_MISMATCH',
          `This invitation was issued for ${invite.email}. Please register with that email address.`,
        );
      }
      companyId = invite.companyId;
      companyName = invite.companyName ?? null;
      role = invite.role;
      pendingInviteId = invite.id;
    } else if (input.companyName && input.companyName.trim().length >= 2) {
      // 2. If company name is provided, create a new company workspace
      const newCompanyId = newId();
      const company = await this.store.createCompany({
        id: newCompanyId,
        name: input.companyName.trim(),
        createdAt: now,
      });
      companyId = company.id;
      companyName = company.name;
      role = 'owner';
    } else {
      // 3. Personal workspace: no company, user owns their personal workspace
      companyId = null;
      companyName = null;
      role = 'owner';
    }

    const passwordHash = await hashPassword(input.password, this.env.security.bcryptCost);
    const userId = newId();
    const user = await this.store.createUser({
      id: userId,
      email,
      displayName: input.displayName.trim(),
      companyId,
      role,
      passwordHash,
      createdAt: now,
    });
    user.companyName = companyName;

    if (pendingInviteId) {
      await this.store.updateInvitationStatus(pendingInviteId, 'accepted');
    }

    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const csrfToken = generateCsrfToken();
    const sessionId = newId();
    const expiresAt = new Date(now.getTime() + this.env.session.ttlHours * 3600_000);

    await this.store.createSession({
      id: sessionId,
      userId: user.id,
      tokenHash,
      csrfToken,
      ipHash: hashIpAddress(input.ip, this.env.session.secret),
      userAgent: truncate(input.userAgent, 255),
      createdAt: now,
      expiresAt,
    });

    await this.audit({
      userId: user.id,
      companyId,
      action: companyId ? 'company_registered' : 'user_registered',
      outcome: 'success',
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
      metadata: companyName ? { companyName } : { workspaceType: 'personal' },
    });

    return {
      user: toAuthUser(user),
      session: {
        id: sessionId,
        csrfToken,
        createdAt: now,
        expiresAt,
      },
      token,
    };
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const now = this.clock();
    const email = normalizeEmail(input.email);
    const user = await this.store.findUserByEmail(email);

    if (!user) {
      // Spend the same bcrypt time as a real verification.
      await verifyAgainstDummyHash(input.password);
      await this.audit({
        userId: null,
        action: 'login_failed',
        outcome: 'failure',
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
        metadata: { reason: 'unknown_email' },
      });
      throw invalidCredentials();
    }

    if (user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime()) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1_000),
      );
      await this.audit({
        userId: user.id,
        action: 'login_locked',
        outcome: 'failure',
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
        metadata: { retryAfterSeconds },
      });
      throw new AuthError(
        429,
        'ACCOUNT_LOCKED',
        'Too many failed sign-in attempts. Try again later.',
        { retryAfterSeconds },
      );
    }

    const passwordMatches = await verifyPassword(input.password, user.passwordHash);

    if (!passwordMatches) {
      await this.store.recordLoginFailure(user.id, {
        now,
        maxAttempts: this.env.security.maxFailedLoginAttempts,
        lockMinutes: this.env.security.lockMinutes,
      });
      await this.audit({
        userId: user.id,
        action: 'login_failed',
        outcome: 'failure',
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
        metadata: { reason: 'bad_password' },
      });
      throw invalidCredentials();
    }

    // The account must be active. A disabled account cannot obtain a session
    // even with the correct password, and the response stays generic.
    if (!user.isActive) {
      await this.audit({
        userId: user.id,
        action: 'login_denied',
        outcome: 'denied',
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
        metadata: { reason: 'inactive' },
      });
      throw invalidCredentials();
    }

    await this.store.recordLoginSuccess(user.id, now);

    // If an invitation token is provided during login, accept it and join the company
    if (input.inviteToken?.trim()) {
      const invite = await this.resolveInvitation(input.inviteToken, now);
      if (email !== normalizeEmail(invite.email)) {
        throw new AuthError(
          403,
          'INVITATION_EMAIL_MISMATCH',
          `This invitation was issued for ${invite.email}, but you signed in with ${email}.`,
        );
      }

      await this.store.updateUserRoleAndCompany(user.id, invite.companyId, invite.role);
      await this.store.updateInvitationStatus(invite.id, 'accepted');

      user.companyId = invite.companyId;
      user.companyName = invite.companyName ?? null;
      user.role = invite.role;

      await this.audit({
        userId: user.id,
        companyId: invite.companyId,
        action: 'company.invitation_accepted',
        outcome: 'success',
        resourceType: 'company',
        resourceId: invite.companyId,
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
        metadata: { role: invite.role },
      });
    }

    // Session-fixation defence: whatever session the browser presented is
    // destroyed before a brand-new id/token pair is issued.
    if (input.existingToken) {
      const existing = await this.store.findSessionByTokenHash(
        hashSessionToken(input.existingToken),
      );
      if (existing) await this.store.revokeSession(existing.id, now);
    }

    const token = generateSessionToken();
    const csrfToken = generateCsrfToken();
    const sessionId = newId();
    const expiresAt = new Date(now.getTime() + this.env.session.ttlHours * 3_600_000);

    await this.store.createSession({
      id: sessionId,
      userId: user.id,
      tokenHash: hashSessionToken(token),
      csrfToken,
      ipHash: hashIpAddress(input.ip, this.env.session.secret),
      userAgent: truncate(input.userAgent, 255),
      createdAt: now,
      expiresAt,
    });

    await this.audit({
      userId: user.id,
      action: 'login_success',
      outcome: 'success',
      resourceType: 'session',
      resourceId: sessionId,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });

    return {
      user: toAuthUser(user),
      session: { id: sessionId, csrfToken, createdAt: now, expiresAt },
      token,
    };
  }

  /**
   * Resolves a cookie value into an authenticated context.
   * Order matters: cheap cryptographic checks, then expiry, then account state.
   */
  async authenticate(rawToken: string | null): Promise<AuthenticateResult> {
    if (!rawToken) {
      throw new AuthError(401, 'NOT_AUTHENTICATED', 'Sign in to continue.');
    }

    const session = await this.store.findSessionByTokenHash(hashSessionToken(rawToken));
    const now = this.clock();

    if (!session || session.revokedAt !== null) {
      throw new AuthError(401, 'SESSION_INVALID', 'Your session is no longer valid. Sign in again.');
    }

    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.store.revokeSession(session.id, now);
      throw new AuthError(401, 'SESSION_EXPIRED', 'Your session has expired. Sign in again.');
    }

    const idleMs = now.getTime() - session.lastSeenAt.getTime();
    if (idleMs > this.env.session.idleMinutes * 60_000) {
      await this.store.revokeSession(session.id, now);
      throw new AuthError(401, 'SESSION_IDLE_TIMEOUT', 'Your session timed out. Sign in again.');
    }

    // A password change invalidates every session created before it.
    if (
      session.user.passwordChangedAt !== null &&
      session.createdAt.getTime() < session.user.passwordChangedAt.getTime()
    ) {
      await this.store.revokeSession(session.id, now);
      throw new AuthError(401, 'SESSION_INVALID', 'Your session is no longer valid. Sign in again.');
    }

    // Sessions minted before the CSRF column existed cannot be trusted.
    if (!session.csrfToken) {
      await this.store.revokeSession(session.id, now);
      throw new AuthError(401, 'SESSION_INVALID', 'Your session is no longer valid. Sign in again.');
    }

    // The account is re-checked on EVERY authenticated request, not just at
    // login: a deactivated user loses access immediately.
    if (!session.user.isActive) {
      await this.store.revokeUserSessions(session.user.id, now);
      await this.audit({
        userId: session.user.id,
        action: 'session_denied',
        outcome: 'denied',
        resourceType: 'session',
        resourceId: session.id,
        metadata: { reason: 'inactive' },
      });
      throw new AuthError(403, 'ACCOUNT_DISABLED', 'This account is disabled.');
    }

    if (idleMs > TOUCH_INTERVAL_MS) {
      await this.store.touchSession(session.id, now);
    }

    return {
      token: rawToken,
      user: toAuthUser(session.user),
      session: {
        id: session.id,
        csrfToken: session.csrfToken,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      },
    };
  }

  async logout(context: AuthContext, request: RequestContext = {}): Promise<void> {
    const now = this.clock();
    await this.store.revokeSession(context.session.id, now);
    await this.audit({
      userId: context.user.id,
      action: 'logout',
      outcome: 'success',
      resourceType: 'session',
      resourceId: context.session.id,
      ip: request.ip,
      userAgent: request.userAgent,
      requestId: request.requestId,
    });
  }

  async updateProfile(
    actor: AuthUser,
    input: { displayName: string },
    request: RequestContext = {},
  ): Promise<AuthUser> {
    const trimmed = input.displayName.trim();
    if (trimmed.length < 2 || trimmed.length > 80) {
      throw new AuthError(400, 'INVALID_NAME', 'Name must be between 2 and 80 characters.');
    }
    const updated = await this.store.updateUserProfile(actor.id, { displayName: trimmed });
    if (!updated) {
      throw new AuthError(404, 'USER_NOT_FOUND', 'User not found.');
    }
    await this.audit({
      userId: actor.id,
      companyId: actor.companyId,
      targetUserId: actor.id,
      action: 'user.update_profile',
      outcome: 'success',
      resourceType: 'user',
      resourceId: actor.id,
      requestId: request.requestId,
      ip: request.ip,
      userAgent: request.userAgent,
      metadata: { displayName: trimmed },
    });
    return updated;
  }

  async changePassword(
    actor: AuthUser,
    input: { currentPassword: string; newPassword: string },
    request: RequestContext = {},
    currentSessionId?: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.store.findUserById(actor.id);
    if (!user) {
      throw new AuthError(404, 'USER_NOT_FOUND', 'User not found.');
    }
    const currentValid = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!currentValid) {
      await this.audit({
        userId: actor.id,
        companyId: actor.companyId,
        targetUserId: actor.id,
        action: 'user.change_password',
        outcome: 'failure',
        resourceType: 'user',
        resourceId: actor.id,
        requestId: request.requestId,
        ip: request.ip,
        userAgent: request.userAgent,
        metadata: { reason: 'invalid_current_password' },
      });
      throw new AuthError(401, 'INVALID_PASSWORD', 'Current password is incorrect.');
    }
    if (input.newPassword.length < 12 || input.newPassword.length > 128) {
      throw new AuthError(400, 'PASSWORD_TOO_SHORT', 'New password must be between 12 and 128 characters.');
    }
    if (input.newPassword === input.currentPassword) {
      throw new AuthError(400, 'PASSWORD_UNCHANGED', 'New password must be different from current password.');
    }
    const newHash = await hashPassword(input.newPassword, this.env.security.bcryptCost);
    await this.store.updateUserPassword(actor.id, newHash);

    // Revoke any other sessions for security
    if (currentSessionId) {
      await this.store.revokeUserSessions(actor.id, this.clock(), currentSessionId);
    }

    await this.audit({
      userId: actor.id,
      companyId: actor.companyId,
      targetUserId: actor.id,
      action: 'user.change_password',
      outcome: 'success',
      resourceType: 'user',
      resourceId: actor.id,
      requestId: request.requestId,
      ip: request.ip,
      userAgent: request.userAgent,
      metadata: { revokedOtherSessions: Boolean(currentSessionId) },
    });

    return { success: true, message: 'Password updated successfully.' };
  }

  async setUserStatus(
    adminActor: AuthUser,
    targetUserId: string,
    isActive: boolean,
    context: RequestContext = {},
  ): Promise<void> {
    if (adminActor.role !== 'platform_admin') {
      throw new AppError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Platform administrator access is required.',
      });
    }

    if (adminActor.id === targetUserId && !isActive) {
      throw new AppError({
        statusCode: 422,
        code: 'CANNOT_DEACTIVATE_SELF',
        message: 'Administrators cannot deactivate their own account.',
      });
    }

    const targetUser = await this.store.findUserById(targetUserId);
    if (!targetUser) {
      throw new AppError({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'No TrustVault account found with that ID.',
      });
    }

    const changed = await this.store.setUserActive(targetUserId, isActive);
    if (!changed) {
      throw new AppError({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'Failed to update account status.',
      });
    }

    await this.audit({
      userId: adminActor.id,
      targetUserId,
      action: isActive ? 'user.activated' : 'user.deactivated',
      outcome: 'success',
      resourceType: 'user',
      resourceId: targetUserId,
      ip: context.ip,
      userAgent: context.userAgent,
      requestId: context.requestId,
      metadata: {
        targetEmail: targetUser.email,
        previousStatus: targetUser.isActive ? 'active' : 'disabled',
        newStatus: isActive ? 'active' : 'disabled',
      },
    });
  }

  async listAuditLogs(
    params: AuditFilterParams,
  ): Promise<{ entries: AuditLogEntry[]; total: number }> {
    const [entries, total] = await Promise.all([
      this.store.listAuditLogs(params),
      this.store.countAuditLogs(params),
    ]);
    return { entries, total };
  }

  async verifyAuditIntegrity(): Promise<AuditVerificationResult> {
    return this.store.verifyAuditIntegrity();
  }

  async createCheckpoint(): Promise<CheckpointRecord | null> {
    return this.store.createCheckpoint();
  }

  async listCheckpoints(): Promise<CheckpointRecord[]> {
    return this.store.listCheckpoints();
  }

  async createCompanyWorkspace(
    actor: AuthUser,
    input: { companyName: string },
    context?: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<AuthUser> {
    const name = input.companyName.trim();
    if (name.length < 2) {
      throw new AuthError(422, 'VALIDATION_ERROR', 'Company name must be at least 2 characters.');
    }
    const now = this.clock();
    const company = await this.store.createCompany({
      id: newId(),
      name,
      createdAt: now,
    });

    await this.store.updateUserRoleAndCompany(actor.id, company.id, 'owner');

    await this.audit({
      userId: actor.id,
      companyId: company.id,
      action: 'company.created',
      outcome: 'success',
      resourceType: 'company',
      resourceId: company.id,
      ip: context?.ip,
      userAgent: context?.userAgent,
      requestId: context?.requestId,
      metadata: { companyName: company.name },
    });

    return {
      ...actor,
      companyId: company.id,
      companyName: company.name,
      role: 'owner',
    };
  }

  async getWorkspace(actor: AuthUser): Promise<{ company: Company | null; isPersonal: boolean }> {
    if (!actor.companyId) {
      return { company: null, isPersonal: true };
    }
    const company = await this.store.findCompanyById(actor.companyId);
    return { company, isPersonal: false };
  }

  async getCompanyAdminOverview(actor: AuthUser): Promise<CompanyAdminOverview> {
    if (!actor.companyId) {
      throw new AuthError(400, 'NO_COMPANY_WORKSPACE', 'You do not belong to a company workspace.');
    }
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      throw new AuthError(403, 'FORBIDDEN', 'Only workspace owners and company administrators can access company administration.');
    }
    return this.store.getCompanyAdminOverview(actor.companyId);
  }

  async updateWorkspaceSettings(
    actor: AuthUser,
    patch: { name?: string; domain?: string | null },
    context?: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<Company> {
    if (!actor.companyId) {
      throw new AuthError(400, 'NO_COMPANY_WORKSPACE', 'You do not belong to a company workspace.');
    }
    if (actor.role !== 'owner') {
      throw new AuthError(403, 'FORBIDDEN', 'Only workspace owners can update workspace settings.');
    }
    const updated = await this.store.updateCompany(actor.companyId, patch);
    if (!updated) {
      throw new AuthError(404, 'COMPANY_NOT_FOUND', 'Workspace not found.');
    }
    await this.audit({
      userId: actor.id,
      companyId: actor.companyId,
      action: 'company.settings_updated',
      outcome: 'success',
      resourceType: 'company',
      resourceId: actor.companyId,
      ip: context?.ip,
      userAgent: context?.userAgent,
      requestId: context?.requestId,
      metadata: patch,
    });
    return updated;
  }

  async listWorkspaceMembers(actor: AuthUser): Promise<AuthUser[]> {
    if (!actor.companyId) {
      return [toAuthUser(actor)];
    }
    return this.store.listCompanyUsers(actor.companyId);
  }

  async inviteMember(
    actor: AuthUser,
    input: { email: string; role: 'admin' | 'editor' | 'viewer' },
    context?: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<CompanyInvitation> {
    if (!actor.companyId) {
      throw new AuthError(400, 'NO_COMPANY_WORKSPACE', 'Create or join a company workspace first to invite members.');
    }
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      throw new AuthError(403, 'FORBIDDEN', 'Only owners and admins can invite members.');
    }
    if (actor.role === 'admin' && input.role === 'admin') {
      throw new AuthError(403, 'FORBIDDEN', 'Only the workspace owner can invite new administrators.');
    }

    const email = normalizeEmail(input.email);
    const existingUser = await this.store.findUserByEmail(email);
    if (existingUser?.companyId === actor.companyId) {
      throw new AuthError(409, 'ALREADY_MEMBER', 'That user is already a member of this workspace.');
    }

    const rawToken = generateInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 3600_000); // 7 days

    // Check if an active invitation already exists for this email in this company (safe retry)
    const existingPending = await this.store.findPendingInvitationByEmail(actor.companyId, email);

    let invitation: CompanyInvitation;
    let isRetry = false;

    if (existingPending) {
      invitation = await this.store.updatePendingInvitation(existingPending.id, {
        token: tokenHash,
        role: input.role,
        expiresAt,
      });
      isRetry = true;
    } else {
      invitation = await this.store.createInvitation({
        id: newId(),
        companyId: actor.companyId,
        invitedBy: actor.id,
        email,
        role: input.role,
        token: tokenHash,
        expiresAt,
        createdAt: now,
      });
    }

    await this.audit({
      userId: actor.id,
      companyId: actor.companyId,
      action: isRetry ? 'company.member_reinvited' : 'company.member_invited',
      outcome: 'success',
      resourceType: 'invitation',
      resourceId: invitation.id,
      ip: context?.ip,
      userAgent: context?.userAgent,
      requestId: context?.requestId,
      metadata: { targetEmail: email, role: input.role },
    });

    // Return the unhashed raw token to the inviter so they can share the invite link
    return {
      ...invitation,
      token: rawToken,
    };
  }

  async listWorkspaceInvitations(actor: AuthUser): Promise<CompanyInvitation[]> {
    if (!actor.companyId) return [];
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      throw new AuthError(403, 'FORBIDDEN', 'Only owners and admins can view workspace invitations.');
    }
    return this.store.listCompanyInvitations(actor.companyId);
  }

  async revokeInvitation(
    actor: AuthUser,
    invitationId: string,
    context?: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<void> {
    if (!actor.companyId || (actor.role !== 'owner' && actor.role !== 'admin')) {
      throw new AuthError(403, 'FORBIDDEN', 'Only owners and admins can revoke invitations.');
    }
    const invite = await this.store.findInvitationById(invitationId);
    if (!invite || invite.companyId !== actor.companyId) {
      throw new AuthError(404, 'INVITATION_NOT_FOUND', 'Invitation not found in this workspace.');
    }
    if (invite.status === 'accepted') {
      throw new AuthError(
        400,
        'INVITATION_ALREADY_ACCEPTED',
        'This invitation has already been accepted. To remove this user, remove them from the workspace members list.',
      );
    }
    if (invite.status === 'revoked') {
      return;
    }
    await this.store.updateInvitationStatus(invitationId, 'revoked');
    await this.audit({
      userId: actor.id,
      companyId: actor.companyId,
      action: 'company.invitation_revoked',
      outcome: 'success',
      resourceType: 'invitation',
      resourceId: invitationId,
      ip: context?.ip,
      userAgent: context?.userAgent,
      requestId: context?.requestId,
    });
  }

  async acceptInvitation(
    actor: AuthUser,
    token: string,
    context?: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<AuthUser> {
    const now = this.clock();
    const invite = await this.resolveInvitation(token, now);

    if (normalizeEmail(actor.email) !== normalizeEmail(invite.email)) {
      throw new AuthError(
        403,
        'INVITATION_EMAIL_MISMATCH',
        `This invitation was issued for ${invite.email}, but you are signed in as ${actor.email}.`,
      );
    }

    await this.store.updateUserRoleAndCompany(actor.id, invite.companyId, invite.role);
    await this.store.updateInvitationStatus(invite.id, 'accepted');

    await this.audit({
      userId: actor.id,
      companyId: invite.companyId,
      action: 'company.invitation_accepted',
      outcome: 'success',
      resourceType: 'company',
      resourceId: invite.companyId,
      ip: context?.ip,
      userAgent: context?.userAgent,
      requestId: context?.requestId,
      metadata: { role: invite.role },
    });

    const company = await this.store.findCompanyById(invite.companyId);
    return {
      ...actor,
      companyId: invite.companyId,
      companyName: company?.name ?? null,
      role: invite.role,
    };
  }

  async removeMember(
    actor: AuthUser,
    targetUserId: string,
    context?: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<void> {
    if (!actor.companyId) {
      throw new AuthError(400, 'NO_COMPANY_WORKSPACE', 'You do not belong to a company workspace.');
    }
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      throw new AuthError(403, 'FORBIDDEN', 'Only owners and admins can remove members.');
    }
    if (actor.id === targetUserId) {
      throw new AuthError(422, 'INVALID_OPERATION', 'You cannot remove yourself from the workspace.');
    }

    const targetUser = await this.store.findUserById(targetUserId);
    if (!targetUser || targetUser.companyId !== actor.companyId) {
      throw new AuthError(404, 'MEMBER_NOT_FOUND', 'User is not a member of this workspace.');
    }
    if (targetUser.role === 'owner') {
      throw new AuthError(403, 'FORBIDDEN', 'The workspace owner cannot be removed.');
    }
    if (actor.role === 'admin' && targetUser.role === 'admin') {
      throw new AuthError(403, 'FORBIDDEN', 'Admins cannot remove other administrators.');
    }

    const now = this.clock();
    await this.store.removeCompanyMember(targetUserId, actor.companyId);
    await this.store.revokeUserSessions(targetUserId, now);

    await this.audit({
      userId: actor.id,
      companyId: actor.companyId,
      targetUserId,
      action: 'company.member_removed',
      outcome: 'success',
      resourceType: 'user',
      resourceId: targetUserId,
      ip: context?.ip,
      userAgent: context?.userAgent,
      requestId: context?.requestId,
      metadata: { targetEmail: targetUser.email },
    });
  }

  async updateMemberRole(
    actor: AuthUser,
    targetUserId: string,
    newRole: UserRole,
    context?: { ip?: string; userAgent?: string; requestId?: string },
  ): Promise<void> {
    if (!actor.companyId) {
      throw new AuthError(400, 'NO_COMPANY_WORKSPACE', 'You do not belong to a company workspace.');
    }
    if (actor.role !== 'owner') {
      throw new AuthError(403, 'FORBIDDEN', 'Only workspace owners can change member roles.');
    }
    if (newRole === 'platform_admin') {
      throw new AuthError(403, 'FORBIDDEN', 'Company owners cannot grant Platform Administrator privileges.');
    }
    if (actor.id === targetUserId) {
      throw new AuthError(422, 'INVALID_OPERATION', 'You cannot change your own role.');
    }

    const targetUser = await this.store.findUserById(targetUserId);
    if (!targetUser || targetUser.companyId !== actor.companyId) {
      throw new AuthError(404, 'MEMBER_NOT_FOUND', 'User is not a member of this workspace.');
    }

    const now = this.clock();
    await this.store.updateUserRoleAndCompany(targetUserId, actor.companyId, newRole);
    await this.store.revokeUserSessions(targetUserId, now);

    await this.audit({
      userId: actor.id,
      companyId: actor.companyId,
      targetUserId,
      action: 'company.member_role_changed',
      outcome: 'success',
      resourceType: 'user',
      resourceId: targetUserId,
      ip: context?.ip,
      userAgent: context?.userAgent,
      requestId: context?.requestId,
      metadata: { targetEmail: targetUser.email, previousRole: targetUser.role, newRole },
    });
  }

  /** Constant-time CSRF check, exposed so the middleware stays declarative. */
  verifyCsrfToken(provided: string | undefined, expected: string): boolean {
    if (provided === undefined || provided.length === 0) return false;
    return constantTimeEqual(provided, expected);
  }

  private async audit(input: {
    userId: string | null;
    companyId?: string | null;
    targetUserId?: string | null;
    action: string;
    outcome: 'success' | 'failure' | 'denied';
    resourceType?: string | null;
    resourceId?: string | null;
    ip?: string | undefined;
    userAgent?: string | undefined;
    requestId?: string | undefined;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    const event: AuditEventInput = {
      userId: input.userId,
      companyId: input.companyId ?? null,
      targetUserId: input.targetUserId ?? null,
      action: input.action,
      outcome: input.outcome,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      ipHash: hashIpAddress(input.ip, this.env.session.secret),
      userAgent: truncate(input.userAgent, 255),
      requestId: input.requestId ?? null,
      metadata: input.metadata ?? null,
    };

    try {
      await this.store.recordAudit(event);
    } catch (error) {
      // Audit persistence must never crash user flows, but is logged for operators.
      this.logger?.warn({ err: error, action: event.action }, 'failed to persist audit event');
    }
  }
}
