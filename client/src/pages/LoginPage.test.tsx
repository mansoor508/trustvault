import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '../context/AuthContext';
import * as AuthContextModule from '../context/AuthContext';
import { LoginPage } from './LoginPage';

const navigateSpy = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    Navigate: (props: { to: string; replace?: boolean }) => {
      navigateSpy(props);
      return <div data-testid="navigate-mock" data-to={props.to} />;
    },
  };
});

describe('LoginPage redirect and session behavior', () => {
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
    navigateSpy.mockClear();
    vi.restoreAllMocks();
  });

  it('renders checking indicator while session is being verified to avoid race conditions', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      mockAuthContext({ status: 'checking' }),
    );

    const html = renderToString(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(html).toContain('Checking your session…');
    expect(html).not.toContain('Sign in to your vault');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('safely redirects authenticated owners to /dashboard when /admin was requested', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      mockAuthContext({
        status: 'authenticated',
        user: {
          id: 'usr-owner',
          email: '23jr1a0534@gmail.com',
          displayName: 'Workspace Owner',
          role: 'owner',
          isActive: true,
          companyId: 'comp-1',
          companyName: 'Acme Corp',
        },
      }),
    );

    const html = renderToString(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/login',
            state: { from: '/admin' },
          },
        ]}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(navigateSpy).toHaveBeenCalledWith({ to: '/dashboard', replace: true });
    expect(html).toContain('data-to="/dashboard"');
  });

  it('redirects platform administrators to /admin when /admin was requested', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      mockAuthContext({
        status: 'authenticated',
        user: {
          id: 'usr-admin',
          email: 'admin@trustvault.local',
          displayName: 'Platform Admin',
          role: 'platform_admin',
          isActive: true,
          companyId: null,
          companyName: null,
        },
      }),
    );

    const html = renderToString(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/login',
            state: { from: '/admin' },
          },
        ]}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(navigateSpy).toHaveBeenCalledWith({ to: '/admin', replace: true });
    expect(html).toContain('data-to="/admin"');
  });

  it('redirects to /dashboard by default after fresh login with no state', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      mockAuthContext({
        status: 'authenticated',
        user: {
          id: 'usr-owner',
          email: 'owner@trustvault.local',
          displayName: 'Owner',
          role: 'owner',
          isActive: true,
          companyId: 'comp-1',
          companyName: 'Acme Corp',
        },
      }),
    );

    const html = renderToString(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(navigateSpy).toHaveBeenCalledWith({ to: '/dashboard', replace: true });
    expect(html).toContain('data-to="/dashboard"');
  });

  it('renders a visually distinct company registration section linking to /register', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      mockAuthContext({ status: 'anonymous' }),
    );

    const html = renderToString(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Primary action
    expect(html).toContain('Sign in');
    expect(html).toContain('button button-primary button-block');

    // Visual divider
    expect(html).toContain('class="login-divider"');

    // Visually distinct secondary registration callout
    expect(html).toContain('class="login-register-section"');
    expect(html).toContain('New to TrustVault?');
    expect(html).toContain('Create your company workspace and start sharing documents securely.');
    expect(html).toContain('Create Company Workspace');
    expect(html).toContain('href="/register"');
    expect(html).toContain('button button-register button-block');

    // Demo notice is separate and secondary
    expect(html).toContain('class="login-demo-notice"');
  });

  it('renders an invite onboarding button linking to /register with invite token when present', () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue(
      mockAuthContext({ status: 'anonymous' }),
    );

    const html = renderToString(
      <MemoryRouter initialEntries={['/login?invite=token-abc-123']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('href="/register?invite=token-abc-123"');
    expect(html).toContain('Create Account to Join Workspace');
    expect(html).toContain('Create your employee account to accept this workspace invitation.');
  });
});
