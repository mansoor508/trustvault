/**
 * Minimal cookie header reader.
 *
 * Only one cookie matters to this API (the session), and writing cookies is
 * handled by Express itself, so a small audited parser beats another dependency
 * in the trust boundary.
 *
 * Behaviour: first occurrence wins (browsers send the most specific path
 * first), surrounding quotes are stripped, malformed percent-encoding falls
 * back to the raw value instead of throwing.
 */
export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader || cookieHeader.length === 0) return null;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const rawValue = part.slice(separator + 1).trim();
    if (rawValue.length === 0) return null;

    const unquoted =
      rawValue.length >= 2 && rawValue.startsWith('"') && rawValue.endsWith('"')
        ? rawValue.slice(1, -1)
        : rawValue;

    try {
      return decodeURIComponent(unquoted);
    } catch {
      return unquoted;
    }
  }

  return null;
}

/** Parses a Cookie header into a plain object (used by tests and debug tools). */
export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key === '' || key in cookies) continue;
    cookies[key] = part.slice(separator + 1).trim();
  }

  return cookies;
}
