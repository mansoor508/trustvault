import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { AuthService } from '../../auth/auth-service.js';
import { requireAuth, requireAuthContext, requireRole } from '../../auth/middleware.js';
import type { Env } from '../../config/env.js';
import type { Logger } from '../../config/logger.js';
import type { DocumentService } from '../../documents/document-service.js';
import { DOCUMENT_CATEGORIES } from '../../documents/types.js';
import { AppError } from '../errors.js';

const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const uploadFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
});

const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  owner: z.string().trim().max(120).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional(),
  sort: z.enum(['created_at', 'title', 'size']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  scope: z.enum(['all', 'mine', 'shared', 'company']).optional(),
});

const updateBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    category: z.enum(DOCUMENT_CATEGORIES).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update.',
  });

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function requireDocumentId(raw: string): string {
  if (!DOCUMENT_ID_PATTERN.test(raw)) {
    throw new AppError({
      statusCode: 404,
      code: 'DOCUMENT_NOT_FOUND',
      message: 'That document does not exist or you do not have access to it.',
    });
  }
  return raw;
}

/**
 * Content-Disposition with an ASCII fallback plus RFC 5987 encoding, so names
 * with non-ASCII characters survive without breaking the header.
 */
export function contentDispositionAttachment(fileName: string): string {
  const ascii =
    fileName
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '_')
      .slice(0, 150) || 'document';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export interface DocumentsRouterOptions {
  env: Env;
  service: DocumentService;
  authService: AuthService;
  logger: Logger;
}

export function createDocumentsRouter(options: DocumentsRouterOptions): Router {
  const { env, service, authService, logger } = options;
  const guard = requireAuth({ service: authService, env });
  const router = Router();

  const maxUploadMb = Math.floor(env.maxUploadBytes / (1024 * 1024));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: env.maxUploadBytes,
      files: 1,
      fields: 8,
      fieldSize: 4_096,
      parts: 12,
    },
  });

  // Multer errors are transport-level; translate them into the API envelope.
  const receiveSingleFile: RequestHandler = (req, res, next) => {
    upload.single('file')(req, res, (error: unknown) => {
      if (!error) {
        next();
        return;
      }

      const isMulterError =
        error instanceof Error && (error as { name?: string }).name === 'MulterError';
      const multerCode = (error as { code?: string }).code;

      if (isMulterError && multerCode === 'LIMIT_FILE_SIZE') {
        next(
          new AppError({
            statusCode: 413,
            code: 'PAYLOAD_TOO_LARGE',
            message: `Files must be ${maxUploadMb} MB or smaller.`,
          }),
        );
        return;
      }
      if (isMulterError) {
        next(
          new AppError({
            statusCode: 400,
            code: 'UPLOAD_INVALID',
            message: 'The upload could not be processed. Send exactly one file in the "file" field.',
          }),
        );
        return;
      }

      next(error);
    });
  };

  /** POST /api/documents — upload one file plus optional metadata. */
  router.post('/', guard, requireRole('owner', 'admin', 'editor'), receiveSingleFile, async (req, res) => {
    const actor = requireAuthContext(req).user;

    if (!req.file) {
      throw new AppError({
        statusCode: 422,
        code: 'VALIDATION_ERROR',
        message: 'Attach a file in the "file" field.',
      });
    }

    const body = req.body as Record<string, unknown> | undefined;
    const fields = uploadFieldsSchema.safeParse({
      title: optionalText(body?.title),
      description: optionalText(body?.description),
      category: optionalText(body?.category),
    });
    if (!fields.success) throw fields.error;

    const document = await service.upload({
      actor,
      file: {
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
      },
      title: fields.data.title,
      description: fields.data.description,
      category: fields.data.category,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.id,
    });

    res.status(201).json({ document });
  });

  /** GET /api/documents — discoverable documents, with search and filters. */
  router.get('/', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw parsed.error;

    const page = await service.list(actor, {
      search: parsed.data.search,
      category: parsed.data.category,
      owner: parsed.data.owner,
      from: parsed.data.from,
      to: parsed.data.to,
      sort: parsed.data.sort,
      order: parsed.data.order,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      scope: parsed.data.scope,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      documents: page.documents,
      pagination: {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
        total: page.total,
      },
    });
  });

  /** GET /api/documents/:id — metadata only. */
  router.get('/:id', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const id = requireDocumentId(String(req.params.id ?? ''));
    const reqCtx = { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id };

    const document = await service.get(id, actor, reqCtx);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ document });
  });

  /** PATCH /api/documents/:id — owner/co-owner/admin metadata edits. */
  router.patch('/:id', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const id = requireDocumentId(String(req.params.id ?? ''));
    const reqCtx = { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id };

    const parsed = updateBodySchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;

    const document = await service.update(id, actor, {
      title: parsed.data.title,
      description: parsed.data.description,
      category: parsed.data.category,
    }, reqCtx);

    res.status(200).json({ document });
  });

  /** DELETE /api/documents/:id — soft delete; bytes stay until a purge job. */
  router.delete('/:id', guard, async (req, res) => {
    const actor = requireAuthContext(req).user;
    const id = requireDocumentId(String(req.params.id ?? ''));
    const reqCtx = { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id };

    await service.softDelete(id, actor, reqCtx);
    res.status(204).end();
  });

  /**
   * GET /api/documents/:id/download
   *
   * Authorization happens before a byte is read. The response is always an
   * attachment with `no-store`, so it cannot become a browsable or cacheable
   * public link.
   */
  router.get('/:id/download', guard, async (req, res, next) => {
    const actor = requireAuthContext(req).user;
    const id = requireDocumentId(String(req.params.id ?? ''));
    const reqCtx = { ip: req.ip, userAgent: req.get('user-agent'), requestId: req.id };

    const download = await service.openDownload(id, actor, reqCtx);

    res.setHeader('Content-Type', download.document.mimeType);
    res.setHeader('Content-Length', String(download.sizeBytes));
    res.setHeader(
      'Content-Disposition',
      contentDispositionAttachment(download.document.fileName),
    );
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    download.stream.on('error', (error: unknown) => {
      logger.error({ err: error, documentId: id }, 'document stream failed');
      if (!res.headersSent) {
        next(error);
      } else {
        res.destroy();
      }
    });

    res.on('close', () => {
      download.stream.destroy();
    });

    download.stream.pipe(res);
  });

  return router;
}
