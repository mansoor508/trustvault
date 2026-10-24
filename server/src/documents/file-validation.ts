import { createHash } from 'node:crypto';

/**
 * Upload validation.
 *
 * Three independent gates, because each one is bypassable on its own:
 * 1. Extension allow-list (the user controls it, so it is only a hint).
 * 2. Client MIME type (also user-controlled, but a mismatch is a strong signal).
 * 3. Magic bytes / structural checks on the actual buffer (the part that counts).
 *
 * The stored filename is never derived from the uploaded name. The original
 * name is kept for display only, sanitized, and is never used as a path.
 */

export const MAX_DISPLAY_NAME_LENGTH = 255;
export const MAX_TITLE_LENGTH = 200;

export interface AllowedType {
  readonly extension: string;
  readonly mimeType: string;
  /** Additional client MIME values that are plausible for this extension. */
  readonly mimeAliases: readonly string[];
  readonly sniff: (buffer: Buffer) => boolean;
}

const OOXML_MARKER = Buffer.from('[Content_Types].xml', 'utf8');

function startsWithBytes(buffer: Buffer, bytes: readonly number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function isPdf(buffer: Buffer): boolean {
  return startsWithBytes(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
}

function isPng(buffer: Buffer): boolean {
  return startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function isJpeg(buffer: Buffer): boolean {
  return startsWithBytes(buffer, [0xff, 0xd8, 0xff]);
}

function isZipContainer(buffer: Buffer): boolean {
  return startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04]);
}

/** A heuristic structural check for Office Open XML packages. */
function isOoxml(buffer: Buffer, folder: string): boolean {
  if (!isZipContainer(buffer)) return false;
  if (!buffer.includes(OOXML_MARKER)) return false;
  return buffer.includes(Buffer.from(folder, 'utf8'));
}

/**
 * Plain text: valid UTF-8, no NUL bytes, mostly printable. This rejects binary
 * payloads renamed to `.txt` while still allowing CSV, Markdown and logs.
 */
function isPlainText(buffer: Buffer): boolean {
  if (buffer.includes(0x00)) return false;

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let decoded: string;
  try {
    decoded = decoder.decode(buffer);
  } catch {
    return false;
  }
  if (decoded.length === 0) return false;

  let printable = 0;
  for (const char of decoded) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20) printable += 1;
  }
  return printable / decoded.length >= 0.9;
}

export const ALLOWED_TYPES: readonly AllowedType[] = [
  {
    extension: 'pdf',
    mimeType: 'application/pdf',
    mimeAliases: [],
    sniff: isPdf,
  },
  {
    extension: 'png',
    mimeType: 'image/png',
    mimeAliases: [],
    sniff: isPng,
  },
  {
    extension: 'jpg',
    mimeType: 'image/jpeg',
    mimeAliases: [],
    sniff: isJpeg,
  },
  {
    extension: 'jpeg',
    mimeType: 'image/jpeg',
    mimeAliases: [],
    sniff: isJpeg,
  },
  {
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    mimeAliases: ['application/zip', 'application/octet-stream'],
    sniff: (buffer) => isOoxml(buffer, 'word/'),
  },
  {
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    mimeAliases: ['application/zip', 'application/octet-stream'],
    sniff: (buffer) => isOoxml(buffer, 'xl/'),
  },
  {
    extension: 'pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    mimeAliases: ['application/zip', 'application/octet-stream'],
    sniff: (buffer) => isOoxml(buffer, 'ppt/'),
  },
  {
    extension: 'txt',
    mimeType: 'text/plain',
    mimeAliases: ['application/octet-stream'],
    sniff: isPlainText,
  },
  {
    extension: 'md',
    mimeType: 'text/markdown',
    mimeAliases: ['text/plain', 'application/octet-stream'],
    sniff: isPlainText,
  },
  {
    extension: 'csv',
    mimeType: 'text/csv',
    mimeAliases: ['text/plain', 'application/vnd.ms-excel', 'application/octet-stream'],
    sniff: isPlainText,
  },
];

export const ALLOWED_EXTENSIONS: readonly string[] = ALLOWED_TYPES.map((type) => type.extension);

export type UploadRejectionCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_FILE_NAME'
  | 'UNSUPPORTED_EXTENSION'
  | 'UNSUPPORTED_MIME_TYPE'
  | 'CONTENT_MISMATCH';

export type UploadValidation =
  | {
      ok: true;
      extension: string;
      mimeType: string;
      checksumSha256: string;
      displayFileName: string;
    }
  | { ok: false; code: UploadRejectionCode; message: string };

/**
 * Produces a display-only filename: no directory components, no control
 * characters, bounded length. This value never touches the filesystem.
 */
export function sanitizeDisplayFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : 'document';
}

export function extensionOf(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

export function findAllowedType(extension: string): AllowedType | null {
  return ALLOWED_TYPES.find((type) => type.extension === extension) ?? null;
}

export function validateUpload(input: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  maxBytes: number;
}): UploadValidation {
  const displayFileName = sanitizeDisplayFileName(input.fileName);

  if (input.buffer.length === 0) {
    return { ok: false, code: 'EMPTY_FILE', message: 'The uploaded file is empty.' };
  }

  if (input.buffer.length > input.maxBytes) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `Files must be ${Math.floor(input.maxBytes / (1024 * 1024))} MB or smaller.`,
    };
  }

  const extension = extensionOf(displayFileName);
  if (extension === null) {
    return {
      ok: false,
      code: 'INVALID_FILE_NAME',
      message: 'The file needs an extension, for example report.pdf.',
    };
  }

  const allowed = findAllowedType(extension);
  if (!allowed) {
    return {
      ok: false,
      code: 'UNSUPPORTED_EXTENSION',
      message: `Unsupported file type ".${extension}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`,
    };
  }

  const declaredMime = input.mimeType.trim().toLowerCase();
  const mimeAcceptable =
    declaredMime === '' ||
    declaredMime === 'application/octet-stream' ||
    declaredMime === allowed.mimeType ||
    allowed.mimeAliases.includes(declaredMime);

  if (!mimeAcceptable) {
    return {
      ok: false,
      code: 'UNSUPPORTED_MIME_TYPE',
      message: `The declared content type "${input.mimeType}" does not match a .${extension} file.`,
    };
  }

  // The decisive check: what the bytes actually are.
  if (!allowed.sniff(input.buffer)) {
    return {
      ok: false,
      code: 'CONTENT_MISMATCH',
      message: `The file content does not look like a valid .${extension} file.`,
    };
  }

  return {
    ok: true,
    extension,
    mimeType: allowed.mimeType,
    checksumSha256: createHash('sha256').update(input.buffer).digest('hex'),
    displayFileName,
  };
}
