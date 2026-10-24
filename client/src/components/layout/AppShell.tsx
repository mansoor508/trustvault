import { useEffect, useRef, useState, type JSX } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { minutesUntil, roleLabel } from '../../lib/format';
import type { UserRole } from '../../lib/auth';
import { BrandMark } from '../BrandMark';
import {
  IconActivity,
  IconBuilding,
  IconClose,
  IconDashboard,
  IconFile,
  IconLogout,
  IconMenu,
  IconSettings,
  IconShield,
  IconUpload,
  IconUser,
  IconUsers,
} from '../ui/Icons';

interface NavItem {
  to: string;
  label: string;
  icon: JSX.Element;
  end?: boolean;
  roles?: UserRole[];
  requireCompany?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: <IconDashboard />, end: true },
  { to: '/documents', label: 'Documents', icon: <IconFile /> },
  { to: '/documents/new', label: 'Upload', icon: <IconUpload />, roles: ['admin', 'owner', 'editor'] },
  { to: '/history', label: 'Access history', icon: <IconActivity />, roles: ['platform_admin', 'admin', 'owner'] },
  {
    to: '/company-admin',
    label: 'Company Administration',
    icon: <IconBuilding />,
    roles: ['admin', 'owner'],
    requireCompany: true,
  },
  {
    to: '/workspace/members',
    label: 'Members & Invites',
    icon: <IconUsers />,
    roles: ['admin', 'owner'],
    requireCompany: true,
  },
  {
    to: '/workspace/settings',
    label: 'Workspace Settings',
    icon: <IconSettings />,
    roles: ['owner'],
    requireCompany: true,
  },
  { to: '/admin', label: 'Platform Administration', icon: <IconShield />, roles: ['platform_admin'] },
  { to: '/profile', label: 'Profile & Settings', icon: <IconUser /> },
];

function pageTitle(pathname: string, userRole?: string): string {
  if (pathname === '/' || pathname === '/dashboard') return 'Dashboard';
  if (pathname === '/documents') return 'Documents';
  if (pathname === '/documents/new') return 'Upload document';
  if (pathname.startsWith('/documents/')) return 'Document details';
  if (pathname === '/history') return 'Access history';
  if (pathname === '/workspace/create') return 'Create company workspace';
  if (pathname === '/company-admin') return 'Company Administration';
  if (pathname === '/workspace/members') return 'Members & invitations';
  if (pathname === '/workspace/settings') return 'Workspace settings';
  if (pathname === '/admin' || pathname === '/platform-admin') {
    return userRole === 'platform_admin' ? 'Platform Administration' : 'Dashboard';
  }
  if (pathname === '/profile') return 'Profile & settings';
  return 'TrustVault';
}

function sessionLabel(expiresAt: string, now: number): string {
  void now;
  const minutes = minutesUntil(expiresAt);
  if (minutes <= 0) return 'Session expired';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m left` : `${rest}m left`;
}

/** Persistent application frame: sidebar navigation, top bar and page outlet. */
export function AppShell(): JSX.Element {
  const { user, session, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) {
      window.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.roles && (!user || !item.roles.includes(user.role))) return false;
    if (item.requireCompany && (!user || !user.companyId)) return false;
    return true;
  });

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <BrandMark />
          <div>
            <span className="sidebar-name">TrustVault</span>
            <span className="sidebar-tagline">Secure document sharing</span>
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <IconClose />
          </button>
        </div>

        <nav className="sidebar-nav">
          {visibleItems.map((item) => {
            const isDashboardItem = item.to === '/dashboard';
            const isDashboardActive = isDashboardItem && (location.pathname === '/' || location.pathname === '/dashboard');
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-item ${isActive || isDashboardActive ? 'is-active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {user !== null && !user.companyId ? (
          <div style={{ margin: '0.75rem 1rem', padding: '0.75rem', background: 'rgba(56, 189, 248, 0.08)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              Personal Account
            </div>
            <p className="muted small" style={{ marginBottom: '0.5rem', lineHeight: 1.3 }}>
              Collaborate with a team by upgrading to a company workspace.
            </p>
            <NavLink to="/workspace/create" className="button button-secondary button-sm" style={{ width: '100%', justifyContent: 'center' }}>
              <IconBuilding width={14} height={14} />
              Create Company
            </NavLink>
          </div>
        ) : null}

        <div className="sidebar-foot">
          <div className="session-chip">
            <IconShield width={14} height={14} />
            <span>{session !== null ? sessionLabel(session.expiresAt, now) : 'No session'}</span>
          </div>

          {user !== null ? (
            <div className="sidebar-user-wrap">
              <Link to="/profile" className="sidebar-user" title="View Profile & Settings">
                <div className="avatar" aria-hidden="true">
                  {(user.displayName ?? user.email).slice(0, 1).toUpperCase()}
                </div>
                <div className="sidebar-user-info">
                  <strong>{user.displayName ?? user.email}</strong>
                  <span className="muted small">
                    {roleLabel(user.role)}
                    {user.companyName ? ` • ${user.companyName}` : ' • Personal'}
                  </span>
                </div>
              </Link>
              <button
                className="icon-button"
                type="button"
                onClick={() => void logout()}
                aria-label="Sign out"
                title="Sign out"
              >
                <IconLogout />
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      {mobileOpen ? (
        <button
          className="sidebar-scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="shell-main">
        <header className="topbar">
          <button
            className="icon-button topbar-menu"
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <IconMenu />
          </button>
          <div className="topbar-heading">
            <span className="topbar-eyebrow">
              {user?.companyName ? `${user.companyName} workspace` : 'Personal workspace'}
            </span>
            <h1>{pageTitle(location.pathname, user?.role)}</h1>
          </div>
          <div className="topbar-account" ref={userMenuRef}>
            <button
              type="button"
              className="topbar-user-btn"
              onClick={() => setUserMenuOpen((prev) => !prev)}
              aria-expanded={userMenuOpen}
              aria-label="User account menu"
            >
              <div className="avatar avatar-sm" aria-hidden="true">
                {(user?.displayName ?? user?.email ?? 'U').slice(0, 1).toUpperCase()}
              </div>
              <div className="topbar-user-text">
                <span className="topbar-user-name">{user?.displayName ?? user?.email}</span>
                <span className="topbar-user-role muted small">{roleLabel(user?.role ?? 'viewer')}</span>
              </div>
            </button>

            {userMenuOpen ? (
              <div className="user-dropdown-menu" role="menu">
                <div className="user-dropdown-header">
                  <strong>{user?.displayName ?? 'My Account'}</strong>
                  <span className="muted small">{user?.email}</span>
                  <span
                    className={`badge ${user?.role === 'owner' ? 'badge-role-owner' : user?.role === 'admin' ? 'badge-info' : 'badge-neutral'}`}
                    style={{ marginTop: '0.4rem', alignSelf: 'flex-start' }}
                  >
                    {roleLabel(user?.role ?? 'viewer')}
                  </span>
                </div>
                <div className="user-dropdown-divider" />
                <Link
                  to="/profile"
                  className="user-dropdown-item"
                  role="menuitem"
                  onClick={() => setUserMenuOpen(false)}
                >
                  <IconUser width={16} height={16} />
                  <span>Profile & Settings</span>
                </Link>
                {user?.role === 'owner' && user.companyId ? (
                  <Link
                    to="/workspace/settings"
                    className="user-dropdown-item"
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    <IconSettings width={16} height={16} />
                    <span>Workspace Settings</span>
                  </Link>
                ) : null}
                <div className="user-dropdown-divider" />
                <button
                  type="button"
                  className="user-dropdown-item user-dropdown-item-danger"
                  role="menuitem"
                  onClick={() => {
                    setUserMenuOpen(false);
                    void logout();
                  }}
                >
                  <IconLogout width={16} height={16} />
                  <span>Sign Out</span>
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
