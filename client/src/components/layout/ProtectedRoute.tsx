import type { JSX } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import type { UserRole } from '../../lib/auth';
import { BrandMark } from '../BrandMark';
import { AccessDenied, LoadingBlock } from '../ui/Feedback';

/** Blocks the workspace until the session is restored from the HttpOnly cookie. */
export function RequireAuth(): JSX.Element {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return (
      <div className="boot-screen">
        <BrandMark />
        <LoadingBlock label="Checking your session…" />
      </div>
    );
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

/**
 * Frontend role gate. This is purely for a clear experience: the API enforces
 * the same rule on every request, and the 403 it returns is still handled.
 */
export function RequireRole({
  role,
  roles,
}: {
  role?: UserRole;
  roles?: UserRole[];
}): JSX.Element {
  const { user } = useAuth();

  if (user === null) {
    return <Navigate to="/login" replace />;
  }

  // If a route requires platform_admin and the user is not a platform_admin
  // (e.g. company owner, company admin, editor, viewer), redirect them to their
  // company dashboard with a friendly notification instead of showing an error page.
  if (roles?.includes('platform_admin') && user.role !== 'platform_admin') {
    return (
      <Navigate
        to="/dashboard"
        replace
        state={{
          notice: 'Platform Administration is restricted to the authorized Platform Administrator account.',
        }}
      />
    );
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <Navigate
        to="/dashboard"
        replace
        state={{
          notice: 'You do not have the required permissions to access that section.',
        }}
      />
    );
  }

  if (role && role !== user.role) {
    if (role === 'platform_admin') {
      return (
        <Navigate
          to="/dashboard"
          replace
          state={{
            notice: 'Platform Administration is restricted to the authorized Platform Administrator account.',
          }}
        />
      );
    }
    return (
      <Navigate
        to="/dashboard"
        replace
        state={{
          notice: 'You do not have the required permissions to access that section.',
        }}
      />
    );
  }

  return <Outlet />;
}
