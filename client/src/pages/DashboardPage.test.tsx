import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '../context/AuthContext';
import * as AuthContextModule from '../context/AuthContext';
import { DashboardPage } from './DashboardPage';

describe('DashboardPage card behavior and navigation links', () => {
  const mockAuthContext = (overrides: Partial<AuthContextValue> = {}): AuthContextValue => ({
    status: 'authenticated',
    user: {
      id: 'usr-1',
      email: 'user@example.com',
      displayName: 'Test User',
      role: 'owner',
      isActive: true,
      companyId: 'comp-1',
      companyName: 'Acme Workspace',
    },
    session: {
      csrfToken: 'csrf-123',
      createdAt: '2026-10-21T00:00:00Z',
      expiresAt: '2026-10-22T00:00:00Z',
    },
    csrfToken: 'csrf-123',
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

  it('renders Company Administration card for Company Admins and Company Owners linking to /company-admin', () => {
    const adminContext = mockAuthContext({
      user: {
        id: 'usr-admin-1',
        email: 'admin@acme.example',
        displayName: 'Company Admin',
        role: 'admin',
        isActive: true,
        companyId: 'comp-1',
        companyName: 'Acme Workspace',
      },
    });
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(adminContext);

    const html = renderToString(
      <MemoryRouter>
        <DashboardPage initialLoading={false} />
      </MemoryRouter>,
    );

    // Must show Company Administration card
    expect(html).toContain('Company Administration');
    expect(html).toContain('Acme Workspace');
    expect(html).toContain('href="/company-admin"');
    expect(html).toContain('Manage organization');

    // Must NOT show the misleading Platform administration link to /admin
    expect(html).not.toContain('href="/admin"');
  });

  it('renders Platform Administration card strictly for Platform Admins linking to /admin', () => {
    const platformAdminContext = mockAuthContext({
      user: {
        id: 'usr-platform-1',
        email: 'platform@trustvault.local',
        displayName: 'Platform Administrator',
        role: 'platform_admin',
        isActive: true,
        companyId: null,
        companyName: null,
      },
    });
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(platformAdminContext);

    const html = renderToString(
      <MemoryRouter>
        <DashboardPage initialLoading={false} />
      </MemoryRouter>,
    );

    // Platform admin sees Platform card linking to /admin
    expect(html).toContain('Administration');
    expect(html).toContain('Platform');
    expect(html).toContain('href="/admin"');
    expect(html).toContain('Open activity dashboard');

    // Does NOT link to /company-admin
    expect(html).not.toContain('href="/company-admin"');
  });

  it('renders Access model card for standard viewers and personal accounts', () => {
    const viewerContext = mockAuthContext({
      user: {
        id: 'usr-viewer-1',
        email: 'viewer@acme.example',
        displayName: 'Viewer',
        role: 'viewer',
        isActive: true,
        companyId: 'comp-1',
        companyName: 'Acme Workspace',
      },
    });
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(viewerContext);

    const html = renderToString(
      <MemoryRouter>
        <DashboardPage initialLoading={false} />
      </MemoryRouter>,
    );

    expect(html).toContain('Access model');
    expect(html).toContain('Owner + grants');
    expect(html).not.toContain('href="/company-admin"');
    expect(html).not.toContain('href="/admin"');
  });
});
