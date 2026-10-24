import bcrypt from 'bcryptjs';

export const MIN_PASSWORD_LENGTH = 12;
/** bcrypt silently truncates beyond 72 bytes; reject rather than surprise. */
export const MAX_PASSWORD_BYTES = 72;

/**
 * A valid bcrypt hash of a throwaway value. Verifying against it when an email
 * does not exist keeps the unknown-email path roughly as slow as the
 * wrong-password path, which makes account enumeration by timing harder.
 *
 * This is NOT a credential: it is a fixed public constant used only to burn CPU.
 */
const DUMMY_HASH = '$2b$12$0A1ia5URNBEFBF5YAuchE.lxz.DAlTDF1W7ql8hOJhfzmDFgOjJJ.';

export function assertPasswordAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new Error(`Password must be at most ${MAX_PASSWORD_BYTES} bytes (bcrypt limit)`);
  }
}

/** Hashes a new password. Cost comes from the validated environment. */
export async function hashPassword(password: string, cost: number): Promise<string> {
  assertPasswordAcceptable(password);
  return bcrypt.hash(password, cost);
}

/**
 * Verifies a login attempt. Deliberately does NOT enforce the password policy:
 * an old or short password must simply fail authentication, not produce a
 * validation error that reveals policy details.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (password.length === 0 || hash.length === 0) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    // A malformed hash in the database must look like a failed login.
    return false;
  }
}

/** Burns comparable CPU time for an email that does not exist. */
export async function verifyAgainstDummyHash(password: string): Promise<void> {
  try {
    await bcrypt.compare(password, DUMMY_HASH);
  } catch {
    // Never let the dummy comparison throw.
  }
}
