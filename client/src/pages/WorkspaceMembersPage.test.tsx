import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '../context/AuthContext';
import * as AuthContextModule from '../context/AuthContext';
import { WorkspaceMembersPage } from './WorkspaceMembersPage';

describe('WorkspaceMembersPage layout and styling', () => {
  const mockAuthContext = (overrides: Partial<AuthContextValue> = {}): AuthContextValue => ({
    status: 'authenticated',
    user: {
      id: 'usr-owner-1',
      email: 'owner@trustvault.local',
      displayName: 'Owen Owner',
      role: 'owner',
      isActive: true,
      companyId: 'comp-1',
      companyName: 'Acme Security',
    },
    session: {
      csrfToken: 'csrf-token-123',
      createdAt: '2026-10-21T00:00:00Z',
      expiresAt: '2026-10-22T00:00:00Z',
    },
    csrfToken: 'csrf-token-123',
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

  it('renders semantic table with proper column classes, spacing, and header alignment', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(mockAuthContext());

    const members = [
      {
        id: 'usr-owner-1',
        email: 'owner@trustvault.local',
        displayName: 'Owen Owner',
        role: 'owner' as const,
        isActive: true,
        companyId: 'comp-1',
        companyName: 'Acme Security',
      },
      {
        id: 'usr-editor-2',
        email: 'extremely.long.corporate.team.member.email.address@subdomain.enterprise.com',
        displayName: 'Alexander Bartholomew Montgomery-Smith III',
        role: 'editor' as const,
        isActive: true,
        companyId: 'comp-1',
        companyName: 'Acme Security',
      },
    ];

    const invitations = [
      {
        id: 'inv-1',
        companyId: 'comp-1',
        invitedBy: 'user-1',
        email: 'colleague.pending.invite@external-partner.org',
        role: 'viewer' as const,
        token: 'secure-token-123',
        status: 'pending' as const,
        expiresAt: '2026-10-25T12:00:00Z',
        createdAt: '2026-10-21T12:00:00Z',
        updatedAt: '2026-10-21T12:00:00Z',
      },
    ];

    const html = renderToString(
      <MemoryRouter>
        <WorkspaceMembersPage
          initialLoading={false}
          initialMembers={members}
          initialInvitations={invitations}
        />
      </MemoryRouter>,
    );

    // Verify semantic HTML table structure
    expect(html).toContain('<table');
    expect(html).toContain('class="data-table members-table"');
    expect(html).toContain('col-user');
    expect(html).toContain('col-email');
    expect(html).toContain('col-role');
    expect(html).toContain('col-actions');

    // Verify column headers exist and are aligned
    expect(html).toContain('>User<');
    expect(html).toContain('>Email<');
    expect(html).toContain('>Role<');
    expect(html).toContain('>Actions<');

    // Verify table wrap for responsive horizontal scrolling
    expect(html).toContain('table-wrap members-table-wrap');
    expect(html).toContain('cell-user');
    expect(html).toContain('cell-email');

    // Verify long email and display name handling
    expect(html).toContain('title="extremely.long.corporate.team.member.email.address@subdomain.enterprise.com"');
    expect(html).toContain('Alexander Bartholomew Montgomery-Smith III');

    // Verify select dropdown with dark-mode styling for role editing
    expect(html).toContain('class="input-select-sm"');
    expect(html).toContain('badge');

    // Verify pending invitations table structure
    expect(html).toContain('invitations-table');
    expect(html).toContain('table-actions-group');
  });
});
