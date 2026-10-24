import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '../context/AuthContext';
import * as AuthContextModule from '../context/AuthContext';
import { CompanyAdminPage } from './CompanyAdminPage';
import type { CompanyAdminOverview } from '../lib/workspace';

describe('CompanyAdminPage layout, metrics, and security behavior', () => {
  const mockAuthContext = (overrides: Partial<AuthContextValue> = {}): AuthContextValue => ({
    status: 'authenticated',
    user: {
      id: 'usr-admin-1',
      email: 'admin@acme.example',
      displayName: 'Alex Admin',
      role: 'admin',
      isActive: true,
      companyId: 'c0000000-0000-4000-a000-000000000001',
      companyName: 'Acme Corporation',
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

  const sampleOverview: CompanyAdminOverview = {
    company: {
      id: 'c0000000-0000-4000-a000-000000000001',
      name: 'Acme Corporation',
      domain: 'acme.example',
      createdAt: '2026-10-20T10:00:00Z',
    },
    metrics: {
      totalEmployees: 4,
      ownerCount: 1,
      adminCount: 1,
      activeEmployees: 3,
      pendingInvitationsCount: 2,
    },
    employees: [
      {
        id: 'usr-owner-1',
        email: 'alice.owner@acme.example',
        displayName: 'Alice Owner',
        role: 'owner',
        isActive: true,
        createdAt: '2026-10-20T10:00:00Z',
        lastLoginAt: '2026-10-24T08:00:00Z',
      },
      {
        id: 'usr-admin-1',
        email: 'admin@acme.example',
        displayName: 'Alex Admin',
        role: 'admin',
        isActive: true,
        createdAt: '2026-10-21T11:00:00Z',
        lastLoginAt: '2026-10-24T09:30:00Z',
      },
      {
        id: 'usr-editor-1',
        email: 'ed.editor@acme.example',
        displayName: 'Ed Editor',
        role: 'editor',
        isActive: true,
        createdAt: '2026-10-22T14:00:00Z',
        lastLoginAt: null,
      },
      {
        id: 'usr-viewer-1',
        email: 'vicky.disabled@acme.example',
        displayName: 'Vicky Viewer',
        role: 'viewer',
        isActive: false,
        createdAt: '2026-10-23T09:00:00Z',
        lastLoginAt: null,
      },
    ],
    recentActivity: [
      {
        id: 'act-1',
        action: 'company.member_invited',
        outcome: 'success',
        actorId: 'usr-admin-1',
        actorEmail: 'admin@acme.example',
        actorName: 'Alex Admin',
        resourceType: 'invitation',
        resourceId: 'inv-123',
        metadata: { targetEmail: 'pending.colleague@acme.example', role: 'viewer' },
        createdAt: '2026-10-24T10:00:00Z',
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders company details, key metrics cards, and employee directory table', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(mockAuthContext());

    const html = renderToString(
      <MemoryRouter>
        <CompanyAdminPage initialOverview={sampleOverview} initialLoading={false} />
      </MemoryRouter>,
    );

    // Company Header Details
    expect(html).toContain('Company Administration');
    expect(html).toContain('Acme Corporation');
    expect(html).toContain('c0000000-0000-4000-a000-000000000001');
    expect(html).toContain('acme.example');

    // Key Metrics Cards
    expect(html).toContain('Total Employees');
    expect(html).toContain('>4<'); // 4 total employees
    expect(html).toContain('Active Accounts');
    expect(html).toContain('>3<'); // 3 active
    expect(html).toContain('Company Leadership');
    expect(html).toContain('>2<'); // 1 owner + 1 admin
    expect(html).toContain('Pending Invitations');
    expect(html).toContain('Manage Members &amp; Invites');

    // Employee Directory Table
    expect(html).toContain('Employee Directory');
    expect(html).toContain('Alice Owner');
    expect(html).toContain('alice.owner@acme.example');
    expect(html).toContain('Company Owner');

    expect(html).toContain('Alex Admin');
    expect(html).toContain('admin@acme.example');
    expect(html).toContain('Company Admin');

    expect(html).toContain('Ed Editor');
    expect(html).toContain('Editor');

    expect(html).toContain('Vicky Viewer');
    expect(html).toContain('Disabled');

    // Search and filter inputs exist
    expect(html).toContain('Search by employee name or email...');
    expect(html).toContain('All Roles');
    expect(html).toContain('All Statuses');
  });

  it('redirects unauthorized users (e.g. viewers or users without company) to /dashboard', () => {
    const viewerContext = mockAuthContext({
      user: {
        id: 'usr-viewer-1',
        email: 'viewer@acme.example',
        displayName: 'Vicky Viewer',
        role: 'viewer',
        isActive: true,
        companyId: 'comp-1',
        companyName: 'Acme',
      },
    });
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(viewerContext);

    const html = renderToString(
      <MemoryRouter>
        <CompanyAdminPage initialOverview={sampleOverview} initialLoading={false} />
      </MemoryRouter>,
    );

    // Should redirect and not render the administration dashboard content
    expect(html).not.toContain('Company Employees');
    expect(html).not.toContain('Employee Directory');
  });
});
