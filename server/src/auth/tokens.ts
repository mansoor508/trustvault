import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export const SESSION_TOKEN_BYTES = 32;
export const CSRF_TOKEN_BYTES = 32;
export const INVITATION_TOKEN_BYTES = 32;

export function newId(): string {
  return randomUUID();
}

/**
 * A session token is 256 bits of randomness, base64url encoded. It exists only
 * in the browser's HttpOnly cookie; the database stores its SHA-256 hash, so a
 * database dump cannot be replayed as a live session.
 */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/** Per-session CSRF synchroniser token (hex, 64 chars). */
export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString('hex');
}

/**
 * Workspace invitation token (hex, 64 chars = 256 bits of entropy).
 * Transmitted in URL / invitation email; only its SHA-256 hash is kept in the database.
 */
export function generateInvitationToken(): string {
  return randomBytes(INVITATION_TOKEN_BYTES).toString('hex');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}

export function hashInvitationToken(token: string): string {
  return sha256Hex(token.trim());
}

/**
 * IP addresses are personal data. We only ever store a keyed hash, which keeps
 * "same source" analysis possible without keeping the address itself.
 */
export function hashIpAddress(ip: string | null | undefined, secret: string): string | null {
  if (ip === null || ip === undefined || ip.trim() === '') return null;
  return createHmac('sha256', secret).update(ip, 'utf8').digest('hex');
}

/** Constant-time comparison for tokens. Length differences are not secret. */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function truncate(value: string | undefined, maxLength: number): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}
