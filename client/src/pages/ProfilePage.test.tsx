import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '../context/AuthContext';
import * as AuthContextModule from '../context/AuthContext';
import { ProfilePage } from './ProfilePage';

describe('ProfilePage', () => {
  const mockAuthContext = (overrides: Partial<AuthContextValue>): AuthContextValue => ({
    status: 'authenticated',
    user: {
      id: 'usr-123',
      email: 'alex.smith@cybervault.io',
      displayName: 'Alex Smith',
      companyId: 'comp-999',
      companyName: 'CyberVault Systems',
      role: 'owner',
      isActive: true,
    },
    session: {
      csrfToken: 'csrf-test-token',
      createdAt: '2026-10-22T10:00:00Z',
      expiresAt: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
    },
    csrfToken: 'csrf-test-token',
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

  it('renders user details, initials avatar, email, and role badge', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(mockAuthContext({}));

    const html = renderToString(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );

    expect(html).toContain('Alex Smith');
    expect(html).toContain('alex.smith@cybervault.io');
    expect(html).toContain('AS'); // Initials
    expect(html).toContain('Owner');
    expect(html).toContain('CyberVault Systems Workspace');
    expect(html).toContain('General Profile');
    expect(html).toContain('Security &amp; Password');
    expect(html).toContain('Workspace &amp; Membership');
  });

  it('renders profile edit form with email disabled and display name field', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(mockAuthContext({}));

    const html = renderToString(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );

    expect(html).toContain('Profile Information');
    expect(html).toContain('input-disabled');
    expect(html).toContain('value="alex.smith@cybervault.io"');
    expect(html).toContain('value="Alex Smith"');
    expect(html).toContain('Save Profile');
  });

  it('renders fallback when no user is authenticated', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      mockAuthContext({ user: null, status: 'anonymous' }),
    );

    const html = renderToString(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>,
    );

    expect(html).toContain('User not found');
  });
});
