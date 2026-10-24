import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '../../context/AuthContext';
import * as AuthContextModule from '../../context/AuthContext';
import { RequireAuth, RequireRole } from './ProtectedRoute';

describe('ProtectedRoute components', () => {
  const mockAuthContext = (overrides: Partial<AuthContextValue>): AuthContextValue => ({
    status: 'authenticated',
    user: {
      id: 'usr-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      role: 'owner',
      isActive: true,
      companyId: 'comp-1',
      companyName: 'Acme',
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

  describe('RequireAuth', () => {
    it('renders session loading block during checking phase to prevent race conditions', () => {
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
        mockAuthContext({ status: 'checking', user: null, session: null }),
      );

      const html = renderToString(
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route element={<RequireAuth />}>
              <Route path="/dashboard" element={<div>Dashboard content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      );

      expect(html).toContain('Checking your session…');
      expect(html).not.toContain('Dashboard content');
    });
  });

  describe('RequireRole', () => {
    it('redirects company admin away from platform admin route to dashboard without 403 error', () => {
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
        mockAuthContext({
          status: 'authenticated',
          user: {
            id: 'usr-comp-admin',
            email: 'admin@acme.example',
            displayName: 'Company Admin',
            role: 'admin',
            isActive: true,
            companyId: 'comp-1',
            companyName: 'Acme',
          },
        }),
      );

      const html = renderToString(
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route element={<RequireRole roles={['platform_admin']} />}>
              <Route path="/admin" element={<div>Platform Admin Dashboard</div>} />
            </Route>
            <Route path="/dashboard" element={<div>Company Dashboard Page</div>} />
          </Routes>
        </MemoryRouter>,
      );

      expect(html).not.toContain('Platform Admin Dashboard');
      expect(html).not.toContain('403');
      expect(html).toBe('');
    });

    it('redirects company owner away from platform admin route to dashboard without 403 error', () => {
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
        mockAuthContext({
          status: 'authenticated',
          user: {
            id: 'usr-owner',
            email: 'owner@example.com',
            displayName: 'Company Owner',
            role: 'owner',
            isActive: true,
            companyId: 'comp-1',
            companyName: 'Acme',
          },
        }),
      );

      const html = renderToString(
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route element={<RequireRole roles={['platform_admin']} />}>
              <Route path="/admin" element={<div>Platform Admin Dashboard</div>} />
            </Route>
            <Route path="/dashboard" element={<div>Company Dashboard Page</div>} />
          </Routes>
        </MemoryRouter>,
      );

      expect(html).not.toContain('Platform Admin Dashboard');
      expect(html).not.toContain('403');
      expect(html).toBe('');
    });

    it('redirects normal employees (editor/viewer) away from platform admin route to dashboard', () => {
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
        mockAuthContext({
          status: 'authenticated',
          user: {
            id: 'usr-viewer',
            email: 'viewer@acme.example',
            displayName: 'Viewer',
            role: 'viewer',
            isActive: true,
            companyId: 'comp-1',
            companyName: 'Acme',
          },
        }),
      );

      const html = renderToString(
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route element={<RequireRole roles={['platform_admin']} />}>
              <Route path="/admin" element={<div>Platform Admin Dashboard</div>} />
            </Route>
            <Route path="/dashboard" element={<div>Company Dashboard Page</div>} />
          </Routes>
        </MemoryRouter>,
      );

      expect(html).not.toContain('Platform Admin Dashboard');
      expect(html).not.toContain('403');
      expect(html).toBe('');
    });

    it('allows platform_admin role to access platform admin route', () => {
      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
        mockAuthContext({
          status: 'authenticated',
          user: {
            id: 'usr-platform-admin',
            email: 'admin@trustvault.local',
            displayName: 'System Creator',
            role: 'platform_admin',
            isActive: true,
            companyId: null,
            companyName: null,
          },
        }),
      );

      const html = renderToString(
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route element={<RequireRole roles={['platform_admin']} />}>
              <Route path="/admin" element={<div>Platform Admin Dashboard</div>} />
            </Route>
            <Route path="/dashboard" element={<div>Company Dashboard Page</div>} />
          </Routes>
        </MemoryRouter>,
      );

      expect(html).toContain('Platform Admin Dashboard');
      expect(html).not.toContain('403');
    });
  });
});
