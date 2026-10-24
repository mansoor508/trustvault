import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '../context/AuthContext';
import * as AuthContextModule from '../context/AuthContext';
import { PlatformAdminLoginPage } from './PlatformAdminLoginPage';

describe('PlatformAdminLoginPage UI and behavior', () => {
  const mockAuthContext = (overrides: Partial<AuthContextValue>): AuthContextValue => ({
    status: 'anonymous',
    user: null,
    session: null,
    csrfToken: null,
    notice: null,
    login: vi.fn(),
    register: vi.fn(),
    registerCompany: vi.fn(),
    setUser: vi.fn(),
    logout: vi.fn(),
    expireSession: vi.fn(),
    clearNotice: vi.fn(),
    ...overrides,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the centered professional login card with badge, title, and description', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(mockAuthContext({ status: 'anonymous' }));

    const html = renderToString(
      <MemoryRouter initialEntries={['/platform-admin/login']}>
        <PlatformAdminLoginPage />
      </MemoryRouter>,
    );

    // Centered layout and card
    expect(html).toContain('platform-admin-page');
    expect(html).toContain('platform-admin-card');
    expect(html).toContain('platform-admin-header');

    // Badge and title
    expect(html).toContain('Platform Administration');
    expect(html).toContain('Creator &amp; Platform Portal');
    expect(html).toContain('Dedicated secure access for TrustVault platform governance');

    // Form fields and accessible labels
    expect(html).toContain('for="admin-email"');
    expect(html).toContain('id="admin-email"');
    expect(html).toContain('Platform Administrator Email');
    expect(html).toContain('for="admin-password"');
    expect(html).toContain('id="admin-password"');

    // Full-width button and company login link
    expect(html).toContain('Sign In as Platform Administrator');
    expect(html).toContain('button-primary button-block');
    expect(html).toContain('Go to Company Workspace Login');
    expect(html).toContain('href="/login"');
  });

  it('renders welcome back state when authenticated as platform_admin', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      mockAuthContext({
        status: 'authenticated',
        user: {
          id: 'adm-1',
          email: 'admin@trustvault.local',
          displayName: 'Ava Admin',
          role: 'platform_admin',
          isActive: true,
          companyId: null,
          companyName: null,
        },
      }),
    );

    const html = renderToString(
      <MemoryRouter initialEntries={['/platform-admin/login']}>
        <PlatformAdminLoginPage />
      </MemoryRouter>,
    );

    expect(html).toContain('Welcome Back');
    expect(html).toContain('Platform Administrator Active');
    expect(html).toContain('Go to Platform Dashboard');
    expect(html).toContain('Sign Out');
    expect(html).not.toContain('Sign In as Platform Administrator');
  });

  it('renders access restricted warning when authenticated as a company user', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      mockAuthContext({
        status: 'authenticated',
        user: {
          id: 'usr-ca',
          email: 'hemanth@company.example',
          displayName: 'Hemanth',
          role: 'admin',
          isActive: true,
          companyId: 'comp-1',
          companyName: 'Acme technologies',
        },
      }),
    );

    const html = renderToString(
      <MemoryRouter initialEntries={['/platform-admin/login']}>
        <PlatformAdminLoginPage />
      </MemoryRouter>,
    );

    expect(html).toContain('Access Restricted');
    expect(html).toContain('Platform Portal Restricted');
    expect(html).toContain('hemanth@company.example');
    expect(html).toContain('Company Admin');
    expect(html).toContain('This portal is strictly reserved for the Platform Administrator');
    expect(html).toContain('Go to Workspace Dashboard');
    expect(html).toContain('Sign Out &amp; Switch Account');
  });
});
