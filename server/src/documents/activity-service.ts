import type { AuthUser } from '../auth/types.js';
import { normalizeEmail } from '../auth/auth-service.js';
import type { Logger } from '../config/logger.js';
import { AppError } from '../http/errors.js';
import type { ActivityPage, DocumentActivityStore, PageRequest, AdminUserFilters } from './activity-store.js';
import { canManage, type DocumentAuditSink, type DocumentRequestContext } from './document-service.js';
import type { DocumentStore, DocumentViewer } from './document-store.js';
import type {
  AdminCompanyEntry,
  AdminOverview,
  AdminUserEntry,
  DocumentPermissionEntry,
  DocumentStats,
  PermissionRole,
} from './types.js';
import type { DocumentWithStorage } from './types.js';

export interface DocumentActivityServiceOptions {
  documents: DocumentStore;
  activity: DocumentActivityStore;
  clock?: () => Date;
  logger?: Logger;
  audit?: DocumentAuditSink;
}

export interface GrantPermissionInput {
  email: string;
  role: PermissionRole;
}

function viewerOf(actor: AuthUser): DocumentViewer {
  return { id: actor.id, role: actor.role };
}

function documentNotFound(): AppError {
  return new AppError({
    statusCode: 404,
    code: 'DOCUMENT_NOT_FOUND',
    message: 'That document does not exist or you do not have access to it.',
  });
}

function forbidden(): AppError {
  return new AppError({
    statusCode: 403,
    code: 'DOCUMENT_FORBIDDEN',
    message: 'Your access to this document is read-only.',
  });
}

/**
 * Sharing, activity history and admin reporting.
 *
 * Authorization always runs through DocumentStore.findAccessible first, so a
 * permission operation cannot bypass the same predicate that guards reads.
 */
export class DocumentActivityService {
  private readonly documents: DocumentStore;
  private readonly activity: DocumentActivityStore;
  private readonly clock: () => Date;
  private readonly logger: Logger | undefined;
  private readonly auditSink: DocumentAuditSink | undefined;

  constructor(options: DocumentActivityServiceOptions) {
    this.documents = options.documents;
    this.activity = options.activity;
    this.clock = options.clock ?? (() => new Date());
    this.logger = options.logger;
    this.auditSink = options.audit;
  }

  async stats(actor: AuthUser): Promise<DocumentStats> {
    return this.activity.stats(viewerOf(actor));
  }

  async listPermissions(
    documentId: string,
    actor: AuthUser,
    context?: DocumentRequestContext,
  ): Promise<DocumentPermissionEntry[]> {
    try {
      await this.requireManage(documentId, actor);
    } catch (err) {
      await this.auditDenied(actor, 'document.permission_list_denied', documentId, (err as AppError).code, context);
      throw err;
    }
    return this.activity.listPermissions(documentId);
  }

  async grantPermission(
    documentId: string,
    actor: AuthUser,
    input: GrantPermissionInput,
    context?: DocumentRequestContext,
  ): Promise<DocumentPermissionEntry[]> {
    try {
      await this.requireManage(documentId, actor);
    } catch (err) {
      await this.auditDenied(actor, 'document.permission_grant_denied', documentId, (err as AppError).code, context);
      throw err;
    }

    const email = normalizeEmail(input.email);
    const target = await this.activity.findUserByEmail(email);

    if (!target) {
      await this.auditDenied(actor, 'document.permission_grant_denied', documentId, 'USER_NOT_FOUND', context);
      throw new AppError({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'No TrustVault account uses that email address.',
      });
    }
    if (!target.isActive) {
      await this.auditDenied(actor, 'document.permission_grant_denied', documentId, 'USER_INACTIVE', context);
      throw new AppError({
        statusCode: 422,
        code: 'USER_INACTIVE',
        message: 'That account is disabled and cannot be granted access.',
      });
    }
    if (target.id === actor.id) {
      await this.auditDenied(actor, 'document.permission_grant_denied', documentId, 'INVALID_GRANT', context);
      throw new AppError({
        statusCode: 422,
        code: 'INVALID_GRANT',
        message: 'You already have owner access to this document.',
      });
    }

    await this.activity.upsertPermission({
      documentId,
      userId: target.id,
      role: input.role,
      grantedBy: actor.id,
      now: this.clock(),
    });

    await this.audit(
      actor,
      'document.permission_granted',
      documentId,
      {
        targetUserId: target.id,
        targetEmail: target.email,
        role: input.role,
      },
      target.id,
      context,
    );

    return this.activity.listPermissions(documentId);
  }

  async revokePermission(
    documentId: string,
    actor: AuthUser,
    userId: string,
    context?: DocumentRequestContext,
  ): Promise<DocumentPermissionEntry[]> {
    let document: DocumentWithStorage;
    try {
      document = await this.requireManage(documentId, actor);
    } catch (err) {
      await this.auditDenied(actor, 'document.permission_revoke_denied', documentId, (err as AppError).code, context);
      throw err;
    }

    if (document.owner.id === userId) {
      await this.auditDenied(actor, 'document.permission_revoke_denied', documentId, 'INVALID_REVOKE', context);
      throw new AppError({
        statusCode: 422,
        code: 'INVALID_REVOKE',
        message: 'The owner of a document always keeps access.',
      });
    }

    const removed = await this.activity.removePermission(documentId, userId);
    if (!removed) {
      await this.auditDenied(actor, 'document.permission_revoke_denied', documentId, 'PERMISSION_NOT_FOUND', context);
      throw new AppError({
        statusCode: 404,
        code: 'PERMISSION_NOT_FOUND',
        message: 'That account does not have a grant on this document.',
      });
    }

    await this.audit(
      actor,
      'document.permission_revoked',
      documentId,
      { targetUserId: userId },
      userId,
      context,
    );

    return this.activity.listPermissions(documentId);
  }

    async documentHistory(
    documentId: string,
    actor: AuthUser,
    page: PageRequest,
    context?: DocumentRequestContext,
  ): Promise<ActivityPage> {
    try {
      await this.requireManage(documentId, actor);
    } catch (err) {
      await this.auditDenied(
        actor,
        'document.history_denied',
        documentId,
        (err as AppError).code,
        context,
      );
      throw err;
    }

    return this.activity.historyForDocument(documentId, page);
  }

  async managerHistory(actor: AuthUser, page: PageRequest): Promise<ActivityPage> {
    return this.activity.historyForManager(viewerOf(actor), page);
  }

  async adminOverview(actor: AuthUser): Promise<AdminOverview> {
    this.requirePlatformAdmin(actor);
    return this.activity.adminOverview();
  }

  async adminUsers(actor: AuthUser, filters?: AdminUserFilters): Promise<AdminUserEntry[]> {
    this.requirePlatformAdmin(actor);
    return this.activity.adminUsers(filters);
  }

  async adminCompanies(actor: AuthUser): Promise<AdminCompanyEntry[]> {
    this.requirePlatformAdmin(actor);
    return this.activity.adminCompanies();
  }

  private requirePlatformAdmin(actor: AuthUser): void {
    if (actor.role !== 'platform_admin') {
      throw new AppError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Platform administrator access is required.',
      });
    }
  }

  private async requireManage(
    documentId: string,
    actor: AuthUser,
  ): Promise<DocumentWithStorage> {
    const document = await this.documents.findAccessible(documentId, viewerOf(actor));
    if (!document) throw documentNotFound();
    if (document.owner.id !== actor.id) {
      throw new AppError({
        statusCode: 403,
        code: 'DOCUMENT_FORBIDDEN',
        message: 'Only the document owner can manage access permissions.',
      });
    }
    return document;
  }

  private async audit(
    actor: AuthUser,
    action: string,
    resourceId: string,
    metadata?: Record<string, unknown>,
    targetUserId?: string | null,
    context?: DocumentRequestContext,
  ): Promise<void> {
    if (!this.auditSink) return;
    try {
      await this.auditSink({
        actorId: actor.id,
        targetUserId: targetUserId ?? null,
        action,
        resourceId,
        outcome: 'success',
        metadata,
        ip: context?.ip,
        userAgent: context?.userAgent,
        requestId: context?.requestId,
      });
    } catch (error) {
      this.logger?.warn({ err: error, action }, 'failed to persist sharing audit event');
    }
  }

  private async auditDenied(
    actor: AuthUser,
    action: string,
    resourceId: string,
    reason: string,
    context?: DocumentRequestContext,
  ): Promise<void> {
    if (!this.auditSink) return;
    try {
      await this.auditSink({
        actorId: actor.id,
        action,
        resourceId,
        outcome: 'denied',
        metadata: { reason },
        ip: context?.ip,
        userAgent: context?.userAgent,
        requestId: context?.requestId,
      });
    } catch (error) {
      this.logger?.warn({ err: error, action }, 'failed to persist denied sharing audit event');
    }
  }
}
