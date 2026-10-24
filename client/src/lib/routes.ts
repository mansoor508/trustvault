import type { AuthUser, UserRole } from './auth';

/**
 * Normalizes a URL path by removing search queries, hashes, and trailing slashes.
 */
export function normalizePath(path: string): string {
  const withoutQuery = path.split('?')[0] ?? '';
  const withoutHash = withoutQuery.split('#')[0] ?? '';
  const clean = withoutHash.trim();
  if (!clean || clean === '/') return '/';
  const stripped = clean.replace(/\/+$/, '');
  return stripped === '' ? '/' : stripped;
}

/**
 * Checks whether an authenticated user is authorized to access a given path.
 * Enforces the application's role and tenant isolation model:
 * - Admin (/admin): platform administrators only ('admin').
 * - Document upload (/documents/new): 'owner', 'admin', 'editor'.
 * - Access history (/history): 'owner', 'admin'.
 * - Workspace members (/workspace/members): 'owner', 'admin' with a company.
 * - Workspace settings (/workspace/settings): 'owner' with a company.
 * - Dashboard & document listing: all authenticated roles ('owner', 'admin', 'editor', 'viewer').
 */
export function isPathAuthorized(
  path: string,
  user: AuthUser,
): boolean {
  const normalized = normalizePath(path);

  // Auth pages are not authorized application destinations post-auth
  if (
    normalized === '/login' ||
    normalized === '/register' ||
    normalized === '/accept-invite'
  ) {
    return false;
  }

  // Dashboard / home: all authenticated users
  if (normalized === '/' || normalized === '/dashboard') {
    return true;
  }

  // Document upload: owner, admin, editor (viewers cannot upload)
  if (normalized === '/documents/new') {
    return user.role === 'owner' || user.role === 'admin' || user.role === 'editor';
  }

  // Documents listing and individual document details: all authenticated users
  // (Individual document access is authorized by the backend API and document detail guard)
  if (normalized === '/documents' || normalized.startsWith('/documents/')) {
    return true;
  }

  // Workspace creation: all authenticated users (typically personal users)
  if (normalized === '/workspace/create') {
    return true;
  }

  // Access history: workspace owners, company admins, and platform administrators
  if (normalized === '/history') {
    return user.role === 'owner' || user.role === 'admin' || user.role === 'platform_admin';
  }

  // Company administration: workspace owners and administrators of a company
  if (normalized === '/company-admin' || normalized.startsWith('/company-admin/')) {
    return (user.role === 'owner' || user.role === 'admin') && Boolean(user.companyId);
  }

  // Workspace members: workspace owners and administrators of a company
  if (normalized === '/workspace/members') {
    return (user.role === 'owner' || user.role === 'admin') && Boolean(user.companyId);
  }

  // Workspace settings: workspace owners of a company only
  if (normalized === '/workspace/settings') {
    return user.role === 'owner' && Boolean(user.companyId);
  }

  // Platform administration: platform administrators only
  if (
    normalized === '/admin' ||
    normalized.startsWith('/admin/') ||
    normalized === '/platform-admin' ||
    normalized.startsWith('/platform-admin/')
  ) {
    return user.role === 'platform_admin';
  }

  // Profile and settings: all authenticated users
  if (normalized === '/profile') {
    return true;
  }

  // Any unrecognized route is not authorized
  return false;
}

/**
 * Returns the default post-auth landing destination for an authenticated user.
 */
export function getDefaultDestination(user?: AuthUser | null): string {
  if (user?.role === 'platform_admin') {
    return '/admin';
  }
  return '/dashboard';
}

/**
 * Determines the safe post-authentication redirect destination.
 * If the user originally requested an authorized path, redirects to that path.
 * If the requested path is missing, unauthorized (e.g. an owner attempting /admin),
 * or points to an auth route (/login, /register), falls back to the user's default dashboard.
 */
export function getPostAuthRedirect(
  requestedPath: string | null | undefined,
  user: AuthUser | null,
): string {
  if (!user) {
    return '/dashboard';
  }

  if (
    typeof requestedPath === 'string' &&
    requestedPath.startsWith('/') &&
    !requestedPath.startsWith('//') &&
    !requestedPath.startsWith('/\\')
  ) {
    if (isPathAuthorized(requestedPath, user)) {
      return requestedPath;
    }
  }

  return getDefaultDestination(user);
}
