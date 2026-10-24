import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../config/logger.js';

/** Owner-only permissions for the private document store. */
export const STORAGE_DIR_MODE = 0o700;

/**
 * Creates the private storage directory if needed.
 *
 * Uploaded documents never live under `client/`, are never served by the static
 * host, and are git-ignored. Routes will stream them only after an authorization
 * check (a later step).
 */
export async function ensureStorageDir(directory: string, logger?: Logger): Promise<string> {
  await fs.mkdir(directory, { recursive: true, mode: STORAGE_DIR_MODE });

  if (process.platform !== 'win32') {
    try {
      await fs.chmod(directory, STORAGE_DIR_MODE);
    } catch {
      // Best effort: an existing directory may have a different owner.
    }
  }

  logger?.debug({ storageDir: directory }, 'private storage directory ready');
  return directory;
}

/**
 * Resolves a document path inside the storage root and rejects traversal.
 * Guards future file-serving code against `../` style escapes.
 */
export function resolveWithinStorage(storageDir: string, relativePath: string): string {
  const root = path.resolve(storageDir);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Resolved path escapes the private storage root');
  }
  if (relative === '') {
    throw new Error('Resolved path must point at a file inside the storage root, not the root itself');
  }

  return resolved;
}
