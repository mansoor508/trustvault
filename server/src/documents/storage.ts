import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadStream } from 'node:fs';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Private document storage.
 *
 * Rules enforced here, not in the routes:
 * - The storage key is generated from a server-side UUID + a validated
 *   extension. A user's filename never becomes a path.
 * - Keys are validated against a strict pattern before touching the filesystem,
 *   on top of path containment, so traversal is rejected twice.
 * - Files are created with `wx` (exclusive) and mode 0600: an existing file can
 *   never be overwritten, accidentally or otherwise.
 * - Nothing here is reachable over HTTP; the API streams bytes after an
 *   authorization check.
 */

export const STORAGE_KEY_PATTERN =
  /^\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$/;

const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const EXTENSION_PATTERN = /^[a-z0-9]{1,8}$/;

export class StorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageKeyError';
  }
}

export class StorageConflictError extends Error {
  constructor(storageKey: string) {
    super(`A file already exists at ${storageKey}`);
    this.name = 'StorageConflictError';
  }
}

export interface StoredFile {
  storageKey: string;
  sizeBytes: number;
}

export interface StoredDocument {
  stream: Readable;
  sizeBytes: number;
}

export interface DocumentStorage {
  save(input: { documentId: string; extension: string; buffer: Buffer }): Promise<StoredFile>;
  /** Resolves null when the key is valid but the file is gone. */
  open(storageKey: string): Promise<StoredDocument | null>;
  remove(storageKey: string): Promise<void>;
}

/** Builds `<yyyy>/<mm>/<uuid>.<ext>` from server-controlled inputs only. */
export function buildStorageKey(input: {
  documentId: string;
  extension: string;
  now: Date;
}): string {
  if (!DOCUMENT_ID_PATTERN.test(input.documentId)) {
    throw new StorageKeyError('Document id is not a UUID');
  }
  if (!EXTENSION_PATTERN.test(input.extension)) {
    throw new StorageKeyError('Extension contains unsupported characters');
  }
  const year = String(input.now.getUTCFullYear()).padStart(4, '0');
  const month = String(input.now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}/${month}/${input.documentId}.${input.extension}`;
}

/** Rejects anything that is not a key this service could have generated. */
export function assertSafeStorageKey(storageKey: string): string {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) {
    throw new StorageKeyError('Storage key does not match the generated format');
  }
  if (storageKey.includes('..') || path.isAbsolute(storageKey)) {
    throw new StorageKeyError('Storage key must be a relative generated path');
  }
  return storageKey;
}

export class FsDocumentStorage implements DocumentStorage {
  private readonly root: string;

  constructor(storageDir: string) {
    this.root = path.resolve(storageDir);
  }

  private resolve(storageKey: string): string {
    const safeKey = assertSafeStorageKey(storageKey);
    const absolute = path.resolve(this.root, safeKey);
    const relative = path.relative(this.root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new StorageKeyError('Resolved path escapes the storage root');
    }
    return absolute;
  }

  async save(input: {
    documentId: string;
    extension: string;
    buffer: Buffer;
  }): Promise<StoredFile> {
    const storageKey = buildStorageKey({
      documentId: input.documentId,
      extension: input.extension,
      now: new Date(),
    });
    const absolute = this.resolve(storageKey);

    await fsp.mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });

    try {
      // `wx` fails if the path exists: no silent overwrite, ever.
      await fsp.writeFile(absolute, input.buffer, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new StorageConflictError(storageKey);
      }
      throw error;
    }

    return { storageKey, sizeBytes: input.buffer.length };
  }

  async open(storageKey: string): Promise<StoredDocument | null> {
    const absolute = this.resolve(storageKey);

    let stats: fs.Stats;
    try {
      // lstat: refuse symlinks and anything that is not a regular file.
      stats = await fsp.lstat(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }

    if (!stats.isFile()) return null;

    const stream: ReadStream = fs.createReadStream(absolute);
    return { stream, sizeBytes: stats.size };
  }

  async remove(storageKey: string): Promise<void> {
    const absolute = this.resolve(storageKey);
    try {
      await fsp.unlink(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export interface R2DocumentStorageOptions {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint?: string;
}

/**
 * Cloudflare R2 / S3-compatible private document storage.
 *
 * Security properties preserved:
 * - Storage keys remain server-generated UUIDs + validated extensions.
 * - Files are private and never accessible via public HTTP URLs.
 * - Downloads are streamed through the API only after row-level DB authorization.
 */
export class R2DocumentStorage implements DocumentStorage {
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor(options: R2DocumentStorageOptions) {
    this.bucketName = options.bucketName;
    const endpoint =
      options.endpoint || `https://${options.accountId}.r2.cloudflarestorage.com`;
    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async save(input: {
    documentId: string;
    extension: string;
    buffer: Buffer;
  }): Promise<StoredFile> {
    const storageKey = buildStorageKey({
      documentId: input.documentId,
      extension: input.extension,
      now: new Date(),
    });
    const safeKey = assertSafeStorageKey(storageKey);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: safeKey,
        Body: input.buffer,
        ContentType: 'application/octet-stream',
      }),
    );

    return { storageKey: safeKey, sizeBytes: input.buffer.length };
  }

  async open(storageKey: string): Promise<StoredDocument | null> {
    const safeKey = assertSafeStorageKey(storageKey);
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: safeKey,
        }),
      );

      if (!response.Body) return null;
      return {
        stream: response.Body as Readable,
        sizeBytes: response.ContentLength ?? 0,
      };
    } catch (error: unknown) {
      const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async remove(storageKey: string): Promise<void> {
    const safeKey = assertSafeStorageKey(storageKey);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: safeKey,
      }),
    );
  }
}

/** Test double with the same semantics, including the overwrite refusal. */
export class InMemoryDocumentStorage implements DocumentStorage {
  readonly files = new Map<string, Buffer>();

  async save(input: {
    documentId: string;
    extension: string;
    buffer: Buffer;
  }): Promise<StoredFile> {
    const storageKey = buildStorageKey({
      documentId: input.documentId,
      extension: input.extension,
      now: new Date(),
    });
    if (this.files.has(storageKey)) throw new StorageConflictError(storageKey);
    this.files.set(storageKey, Buffer.from(input.buffer));
    return { storageKey, sizeBytes: input.buffer.length };
  }

  async open(storageKey: string): Promise<StoredDocument | null> {
    assertSafeStorageKey(storageKey);
    const buffer = this.files.get(storageKey);
    if (!buffer) return null;
    return { stream: Readable.from(buffer), sizeBytes: buffer.length };
  }

  async remove(storageKey: string): Promise<void> {
    assertSafeStorageKey(storageKey);
    this.files.delete(storageKey);
  }
}
