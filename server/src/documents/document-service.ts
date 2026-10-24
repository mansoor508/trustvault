import type { Readable } from 'node:stream';
import type { Logger } from '../config/logger.js';
import type { AuthUser } from '../auth/types.js';
import { AppError } from '../http/errors.js';
import { newId } from '../auth/tokens.js';
import type {
  CreateDocumentInput,
  DocumentStore,
  DocumentViewer,
  ListDocumentsQuery,
} from './document-store.js';
import type { DocumentStorage } from './storage.js';
import { MAX_TITLE_LENGTH, validateUpload } from './file-validation.js';
import type {
  DocumentCategory,
  DocumentRecord,
  DocumentSortField,
  DocumentWithStorage,
} from './types.js';

export interface DocumentAuditEvent {
  actorId: string | null;
  targetUserId?: string | null;
  action: string;
  resourceId: string;
  outcome?: 'success' | 'failure' | 'denied';
  metadata?: Record<string, unknown>;
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export interface DocumentRequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export type DocumentAuditSink = (event: DocumentAuditEvent) => Promise<void>;

export interface DocumentServiceOptions {
  store: DocumentStore;
  storage: DocumentStorage;
  maxUploadBytes: number;
  clock?: () => Date;
  logger?: Logger;
  audit?: DocumentAuditSink;
}

export interface UploadDocumentInput {
  actor: AuthUser;
  file: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
  };
  title?: string | undefined;
  description?: string | undefined;
  category?: DocumentCategory | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export interface ListDocumentsRequest {
  search?: string | undefined;
  category?: DocumentCategory | undefined;
  owner?: string | undefined;
  /** YYYY-MM-DD, inclusive, interpreted in UTC. */
  from?: string | undefined;
  to?: string | undefined;
  sort: DocumentSortField['field'];
  order: DocumentSortField['order'];
  limit: number;
  offset: number;
  scope?: 'all' | 'mine' | 'shared' | 'company' | undefined;
}

export interface UpdateDocumentPatch {
  title?: string | undefined;
  description?: string | null | undefined;
  category?: DocumentCategory | undefined;
}

export interface DownloadHandle {
  document: DocumentRecord;
  stream: Readable;
  sizeBytes: number;
}

export interface DocumentListPage {
  documents: DocumentRecord[];
  total: number;
}

function viewerOf(actor: AuthUser): DocumentViewer {
  return { id: actor.id, role: actor.role, companyId: actor.companyId ?? null };
}

/** Drops the internal storage key so it can never be serialised to a client. */
export function toPublicDocument(document: DocumentWithStorage): DocumentRecord {
  const { storageKey: _storageKey, ...rest } = document;
  return rest;
}

export function canManage(document: DocumentWithStorage): boolean {
  return document.access.mode === 'owner';
}
export function canEdit(document: DocumentWithStorage): boolean {
  const { mode, permissionRole } = document.access;

  if (mode === 'owner' || mode === 'editor' || mode === 'co-owner') {
    return true;
  }

  return permissionRole === 'owner' || permissionRole === 'editor';
}

export function isOwner(document: DocumentWithStorage, actorId: string): boolean {
  return document.owner.id === actorId || document.access.mode === 'owner';
}

function documentNotFound(): AppError {
  return new AppError({
    statusCode: 404,
    code: 'DOCUMENT_NOT_FOUND',
    message: 'That document does not exist or you do not have access to it.',
  });
}

function documentForbidden(): AppError {
  return new AppError({
    statusCode: 403,
    code: 'DOCUMENT_FORBIDDEN',
    message: 'Your access to this document is read-only.',
  });
}

function startOfDayUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfDayUtc(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

function defaultTitle(displayFileName: string): string {
  const withoutExtension = displayFileName.replace(/\.[^.]+$/, '');
  const trimmed = withoutExtension.trim();
  if (trimmed.length === 0) return 'Untitled document';
  return trimmed.slice(0, MAX_TITLE_LENGTH);
}

export class DocumentService {
  private readonly store: DocumentStore;
  private readonly storage: DocumentStorage;
  private readonly maxUploadBytes: number;
  private readonly clock: () => Date;
  private readonly logger: Logger | undefined;
  private readonly auditSink: DocumentAuditSink | undefined;

  constructor(options: DocumentServiceOptions) {
    this.store = options.store;
    this.storage = options.storage;
    this.maxUploadBytes = options.maxUploadBytes;
    this.clock = options.clock ?? (() => new Date());
    this.logger = options.logger;
    this.auditSink = options.audit;
  }

  async upload(input: UploadDocumentInput): Promise<DocumentRecord> {
    const validation = validateUpload({
      fileName: input.file.originalName,
      mimeType: input.file.mimeType,
      buffer: input.file.buffer,
      maxBytes: this.maxUploadBytes,
    });

    if (!validation.ok) {
      const statusCode =
        validation.code === 'FILE_TOO_LARGE'
          ? 413
          : validation.code === 'EMPTY_FILE' || validation.code === 'INVALID_FILE_NAME'
            ? 422
            : 415;
      const code =
        validation.code === 'FILE_TOO_LARGE'
          ? 'PAYLOAD_TOO_LARGE'
          : validation.code === 'EMPTY_FILE' || validation.code === 'INVALID_FILE_NAME'
            ? 'VALIDATION_ERROR'
            : 'UNSUPPORTED_FILE_TYPE';
      throw new AppError({ statusCode, code, message: validation.message });
    }

    const documentId = newId();
    const now = this.clock();

    // The key is generated here; the uploaded filename is never part of it.
    const stored = await this.storage.save({
      documentId,
      extension: validation.extension,
      buffer: input.file.buffer,
    });

    const title =
      input.title !== undefined && input.title.trim().length > 0
        ? input.title.trim().slice(0, MAX_TITLE_LENGTH)
        : defaultTitle(validation.displayFileName);

    const description =
      input.description !== undefined && input.description.trim().length > 0
        ? input.description.trim()
        : null;

    const createInput: CreateDocumentInput = {
      id: documentId,
      ownerId: input.actor.id,
      companyId: input.actor.companyId ?? null,
      title,
      description,
      fileName: validation.displayFileName,
      storageKey: stored.storageKey,
      mimeType: validation.mimeType,
      sizeBytes: stored.sizeBytes,
      checksumSha256: validation.checksumSha256,
      category: input.category ?? 'general',
      createdAt: now,
    };

    try {
      const created = await this.store.create(createInput, viewerOf(input.actor));
      await this.audit('document.uploaded', input, created.id, {
        category: createInput.category,
        mimeType: createInput.mimeType,
        sizeBytes: createInput.sizeBytes,
      });
      return toPublicDocument(created);
    } catch (error) {
      // Metadata insert failed: do not leave an orphan file behind.
      try {
        await this.storage.remove(stored.storageKey);
      } catch (cleanupError) {
        this.logger?.error({ err: cleanupError, documentId }, 'failed to clean up orphaned file');
      }
      throw error;
    }
  }

  async list(actor: AuthUser, request: ListDocumentsRequest): Promise<DocumentListPage> {
    const query: ListDocumentsQuery = {
      search: request.search,
      category: request.category,
      owner: request.owner,
      createdFrom: request.from === undefined ? undefined : startOfDayUtc(request.from),
      createdTo: request.to === undefined ? undefined : endOfDayUtc(request.to),
      sort: { field: request.sort, order: request.order },
      limit: request.limit,
      offset: request.offset,
      scope: request.scope,
    };

    const result = await this.store.list(viewerOf(actor), query);
    return {
      documents: result.documents.map(toPublicDocument),
      total: result.total,
    };
  }

  async get(id: string, actor: AuthUser, context?: DocumentRequestContext): Promise<DocumentRecord> {
    const document = await this.store.findAccessible(id, viewerOf(actor));
    if (!document) {
      await this.auditDenied('document.view_denied', actor, id, 'DOCUMENT_NOT_FOUND', context);
      throw documentNotFound();
    }
    await this.audit('document.viewed', actor, id, { category: document.category }, context);
    return toPublicDocument(document);
  }

  async update(
    id: string,
    actor: AuthUser,
    patch: UpdateDocumentPatch,
    context?: DocumentRequestContext,
  ): Promise<DocumentRecord> {
    const document = await this.store.findAccessible(id, viewerOf(actor));
    if (!document) {
      await this.auditDenied('document.edit_denied', actor, id, 'DOCUMENT_NOT_FOUND', context);
      throw documentNotFound();
    }
    if (!canEdit(document)) {
      await this.auditDenied('document.edit_denied', actor, id, 'DOCUMENT_FORBIDDEN', context);
      throw documentForbidden();
    }

    const title = patch.title?.trim().slice(0, MAX_TITLE_LENGTH) ?? document.title;
    const description =
      patch.description === undefined
        ? document.description
        : patch.description === null || patch.description.trim().length === 0
          ? null
          : patch.description.trim();
    const category = patch.category ?? document.category;

    await this.store.update(id, {
      title,
      description,
      category,
      updatedAt: this.clock(),
    });

    await this.audit(
      'document.updated',
      actor,
      id,
      {
        fields: Object.keys(patch).filter((key) => patch[key as keyof UpdateDocumentPatch] !== undefined),
      },
      context,
    );

    const updated = await this.store.findAccessible(id, viewerOf(actor));
    if (!updated) throw documentNotFound();
    return toPublicDocument(updated);
  }

  async softDelete(id: string, actor: AuthUser, context?: DocumentRequestContext): Promise<void> {
    const document = await this.store.findAccessible(id, viewerOf(actor));
    if (!document) {
      await this.auditDenied('document.delete_denied', actor, id, 'DOCUMENT_NOT_FOUND', context);
      throw documentNotFound();
    }
    if (!isOwner(document, actor.id)) {
      await this.auditDenied('document.delete_denied', actor, id, 'DOCUMENT_FORBIDDEN', context);
      throw new AppError({
        statusCode: 403,
        code: 'DOCUMENT_FORBIDDEN',
        message: 'Only the document owner can delete this document.',
      });
    }

    const deleted = await this.store.softDelete(id, this.clock());
    if (!deleted) throw documentNotFound();

    await this.audit('document.deleted', actor, id, { fileName: document.fileName }, context);
  }

  /** Authorization first, then the file. Bytes never leave private storage unchecked. */
  async openDownload(id: string, actor: AuthUser, context?: DocumentRequestContext): Promise<DownloadHandle> {
    const document = await this.store.findAccessible(id, viewerOf(actor));
    if (!document) {
      await this.auditDenied('document.download_denied', actor, id, 'DOCUMENT_NOT_FOUND', context);
      throw documentNotFound();
    }

    const stored = await this.storage.open(document.storageKey);
    if (!stored) {
      this.logger?.error({ documentId: id }, 'document metadata exists but the stored file is missing');
      throw documentNotFound();
    }

    await this.audit('document.downloaded', actor, id, { sizeBytes: stored.sizeBytes }, context);

    return {
      document: toPublicDocument(document),
      stream: stored.stream,
      sizeBytes: stored.sizeBytes,
    };
  }

  private async audit(
    action: string,
    actor: AuthUser | UploadDocumentInput,
    resourceId: string,
    metadata?: Record<string, unknown>,
    context?: DocumentRequestContext,
  ): Promise<void> {
    if (!this.auditSink) return;

    const user = 'actor' in actor ? actor.actor : actor;
    const reqCtx: DocumentRequestContext =
      'actor' in actor
        ? { ip: actor.ip, userAgent: actor.userAgent, requestId: actor.requestId }
        : (context ?? {});

    try {
      await this.auditSink({
        actorId: user.id,
        action,
        resourceId,
        outcome: 'success',
        metadata,
        ip: reqCtx.ip,
        userAgent: reqCtx.userAgent,
        requestId: reqCtx.requestId,
      });
    } catch (error) {
      this.logger?.warn({ err: error, action }, 'failed to persist document audit event');
    }
  }

  private async auditDenied(
    action: string,
    actor: AuthUser,
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
      this.logger?.warn({ err: error, action }, 'failed to persist denied document audit event');
    }
  }
}
