import { describe, expect, it } from 'vitest';
import type { AuthUser } from './auth';
import {
  getDefaultDestination,
  getPostAuthRedirect,
  isPathAuthorized,
  normalizePath,
} from './routes';

const makeUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: 'usr-1',
  email: 'test@example.com',
  displayName: 'Test User',
  role: 'owner',
  isActive: true,
  companyId: 'comp-1',
  companyName: 'Acme Corp',
  ...overrides,
});

describe('routes utility', () => {
  describe('normalizePath', () => {
    it('normalizes paths by stripping queries, hashes, and trailing slashes', () => {
      expect(normalizePath('/')).toBe('/');
      expect(normalizePath('///')).toBe('/');
      expect(normalizePath('/dashboard/')).toBe('/dashboard');
      expect(normalizePath('/admin?tab=users#header')).toBe('/admin');
      expect(normalizePath('/documents/new/')).toBe('/documents/new');
      expect(normalizePath('')).toBe('/');
    });
  });

  describe('isPathAuthorized', () => {
    it('allows owners to access workspace resources but strictly forbids /admin', () => {
      const owner = makeUser({ role: 'owner', companyId: 'comp-1' });

      expect(isPathAuthorized('/', owner)).toBe(true);
      expect(isPathAuthorized('/dashboard', owner)).toBe(true);
      expect(isPathAuthorized('/documents', owner)).toBe(true);
      expect(isPathAuthorized('/documents/doc-123', owner)).toBe(true);
      expect(isPathAuthorized('/documents/new', owner)).toBe(true);
      expect(isPathAuthorized('/history', owner)).toBe(true);
      expect(isPathAuthorized('/company-admin', owner)).toBe(true);
      expect(isPathAuthorized('/workspace/members', owner)).toBe(true);
      expect(isPathAuthorized('/workspace/settings', owner)).toBe(true);

      // Must be forbidden for owners
      expect(isPathAuthorized('/admin', owner)).toBe(false);
      expect(isPathAuthorized('/admin/audit-logs', owner)).toBe(false);

      // Auth pages should not be authorized post-auth destinations
      expect(isPathAuthorized('/login', owner)).toBe(false);
      expect(isPathAuthorized('/register', owner)).toBe(false);
      expect(isPathAuthorized('/accept-invite', owner)).toBe(false);
    });

    it('requires companyId for company workspace management routes', () => {
      const personalOwner = makeUser({ role: 'owner', companyId: null });

      expect(isPathAuthorized('/company-admin', personalOwner)).toBe(false);
      expect(isPathAuthorized('/workspace/members', personalOwner)).toBe(false);
      expect(isPathAuthorized('/workspace/settings', personalOwner)).toBe(false);
      expect(isPathAuthorized('/workspace/create', personalOwner)).toBe(true);
    });

    it('allows platform administrators to access /admin and general areas but forbids owner-only settings', () => {
      const platformAdmin = makeUser({ role: 'platform_admin' });

      expect(isPathAuthorized('/admin', platformAdmin)).toBe(true);
      expect(isPathAuthorized('/admin/users', platformAdmin)).toBe(true);
      expect(isPathAuthorized('/platform-admin', platformAdmin)).toBe(true);
      expect(isPathAuthorized('/dashboard', platformAdmin)).toBe(true);
      expect(isPathAuthorized('/documents', platformAdmin)).toBe(true);
      expect(isPathAuthorized('/history', platformAdmin)).toBe(true);

      // Workspace settings is owner-only
      expect(isPathAuthorized('/workspace/settings', platformAdmin)).toBe(false);
    });

    it('allows company admins to access company management but strictly forbids /admin', () => {
      const companyAdmin = makeUser({ role: 'admin', companyId: 'comp-1' });

      expect(isPathAuthorized('/company-admin', companyAdmin)).toBe(true);
      expect(isPathAuthorized('/workspace/members', companyAdmin)).toBe(true);
      expect(isPathAuthorized('/dashboard', companyAdmin)).toBe(true);
      expect(isPathAuthorized('/documents', companyAdmin)).toBe(true);
      expect(isPathAuthorized('/documents/new', companyAdmin)).toBe(true);
      expect(isPathAuthorized('/history', companyAdmin)).toBe(true);

      // Platform admin portal must be strictly forbidden for company admins
      expect(isPathAuthorized('/admin', companyAdmin)).toBe(false);
      expect(isPathAuthorized('/admin/users', companyAdmin)).toBe(false);
      expect(isPathAuthorized('/platform-admin', companyAdmin)).toBe(false);
    });

    it('enforces editor and viewer permission boundaries', () => {
      const editor = makeUser({ role: 'editor', companyId: 'comp-1' });
      const viewer = makeUser({ role: 'viewer', companyId: 'comp-1' });

      expect(isPathAuthorized('/documents/new', editor)).toBe(true);
      expect(isPathAuthorized('/documents/new', viewer)).toBe(false);

      expect(isPathAuthorized('/history', editor)).toBe(false);
      expect(isPathAuthorized('/history', viewer)).toBe(false);

      expect(isPathAuthorized('/admin', editor)).toBe(false);
      expect(isPathAuthorized('/admin', viewer)).toBe(false);
    });
  });

  describe('getPostAuthRedirect', () => {
    it('redirects owners to /dashboard when /admin was requested (bug fix)', () => {
      const owner = makeUser({ role: 'owner' });

      // If an owner bounced from /admin or had /admin in location.state,
      // redirect them safely to /dashboard instead of landing on a 403 page!
      const destination = getPostAuthRedirect('/admin', owner);
      expect(destination).toBe('/dashboard');
    });

    it('allows platform administrators to continue to /admin when requested', () => {
      const platformAdmin = makeUser({ role: 'platform_admin' });
      const destination = getPostAuthRedirect('/admin', platformAdmin);
      expect(destination).toBe('/admin');
    });

    it('redirects company admins to /dashboard when /admin was requested', () => {
      const companyAdmin = makeUser({ role: 'admin' });
      const destination = getPostAuthRedirect('/admin', companyAdmin);
      expect(destination).toBe('/dashboard');
    });

    it('redirects to the authorized requested path for permitted pages', () => {
      const owner = makeUser({ role: 'owner' });
      expect(getPostAuthRedirect('/documents', owner)).toBe('/documents');
      expect(getPostAuthRedirect('/documents/new', owner)).toBe('/documents/new');
      expect(getPostAuthRedirect('/workspace/members', owner)).toBe('/workspace/members');
      expect(getPostAuthRedirect('/company-admin', owner)).toBe('/company-admin');
    });

    it('redirects unauthorized users back to /dashboard when requesting /company-admin', () => {
      const viewer = makeUser({ role: 'viewer', companyId: 'comp-1' });
      expect(getPostAuthRedirect('/company-admin', viewer)).toBe('/dashboard');

      const personalOwner = makeUser({ role: 'owner', companyId: null });
      expect(getPostAuthRedirect('/company-admin', personalOwner)).toBe('/dashboard');
    });

    it('defaults to /dashboard when no valid path was requested or user is null', () => {
      const owner = makeUser({ role: 'owner' });
      expect(getPostAuthRedirect(undefined, owner)).toBe('/dashboard');
      expect(getPostAuthRedirect('', owner)).toBe('/dashboard');
      expect(getPostAuthRedirect(null, owner)).toBe('/dashboard');
      expect(getPostAuthRedirect('/login', owner)).toBe('/dashboard');
      expect(getPostAuthRedirect('/admin', null)).toBe('/dashboard');
    });

    it('prevents open redirect attacks', () => {
      const owner = makeUser({ role: 'owner' });
      expect(getPostAuthRedirect('//evil.com', owner)).toBe('/dashboard');
      expect(getPostAuthRedirect('/\\evil.com', owner)).toBe('/dashboard');
      expect(getPostAuthRedirect('https://evil.com', owner)).toBe('/dashboard');
      expect(getPostAuthRedirect('javascript:alert(1)', owner)).toBe('/dashboard');
    });
  });

  describe('getDefaultDestination', () => {
    it('returns /dashboard for company accounts and /admin for platform admins', () => {
      expect(getDefaultDestination()).toBe('/dashboard');
      expect(getDefaultDestination(makeUser({ role: 'owner' }))).toBe('/dashboard');
      expect(getDefaultDestination(makeUser({ role: 'admin' }))).toBe('/dashboard');
      expect(getDefaultDestination(makeUser({ role: 'platform_admin' }))).toBe('/admin');
    });
  });
});
