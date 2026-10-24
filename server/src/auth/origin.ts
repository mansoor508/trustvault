import type { Request } from 'express';

/**
 * Extracts the effective request origin.
 * Checks the standard `Origin` header first, falling back to `Referer` if present.
 */
export function extractRequestOrigin(req: Request): string | undefined {
  const origin = req.get('origin');
  if (origin && origin.trim().length > 0) {
    return origin.trim();
  }

  const referer = req.get('referer');
  if (referer && referer.trim().length > 0) {
    try {
      return new URL(referer).origin;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Validates whether an origin is allowed to interact with the API and modify data.
 *
 * Rules:
 * 1. Explicitly configured origins in `clientOrigins` (exact match).
 * 2. Normalized origins in `clientOrigins` (protocol + host + port).
 * 3. Localhost / loopback in development / test environments.
 * 4. Render deployments matching configured Render static site services (e.g. `trustvault-app` or PR subdomains).
 * 5. Official deployed TrustVault frontend on Render (e.g. `trustvault-app-1i2l.onrender.com`).
 * 6. GitHub Pages deployment (`*.github.io`).
 *
 * Rejects untrusted / arbitrary third-party origins.
 */
export function isAllowedOrigin(origin: string | undefined, clientOrigins: readonly string[]): boolean {
  if (!origin || origin.trim().length === 0) return false;

  // 1. Direct exact match in allow-list
  if (clientOrigins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();

    // 2. Localhost / 127.0.0.1
    if (host === 'localhost' || host === '127.0.0.1') return true;

    // 3. Normalized comparison against allowed origins
    for (const allowed of clientOrigins) {
      try {
        const allowedParsed = new URL(allowed);
        if (allowedParsed.origin === parsed.origin) return true;

        // Render subdomains: If allowed is e.g. https://trustvault-app.onrender.com,
        // allow Render generated PR/deploy subdomains (e.g. trustvault-app-1i2l.onrender.com)
        if (
          allowedParsed.hostname.endsWith('.onrender.com') &&
          host.endsWith('.onrender.com')
        ) {
          const allowedBase = allowedParsed.hostname.replace(/\.onrender\.com$/, '');
          const currentBase = host.replace(/\.onrender\.com$/, '');
          if (currentBase === allowedBase || currentBase.startsWith(`${allowedBase}-`)) {
            return true;
          }
        }
      } catch {
        // ignore malformed allowed entries
      }
    }

    // 4. Deployed TrustVault frontend service on Render (e.g. trustvault-app-1i2l.onrender.com)
    if (
      (host.startsWith('trustvault-app') || host.startsWith('trustvault')) &&
      host.endsWith('.onrender.com')
    ) {
      return true;
    }

    // 5. GitHub Pages for TrustVault
    if (host.endsWith('.github.io')) return true;
  } catch {
    return false;
  }

  return false;
}
