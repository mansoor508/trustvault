import { useState, type FormEvent, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { IconArrowRight, IconLock, IconShield } from '../components/ui/Icons';
import { useAuth } from '../context/AuthContext';
import { roleLabel } from '../lib/format';

export function PlatformAdminLoginPage(): JSX.Element {
  const navigate = useNavigate();
  const { user, status, login, logout } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already authenticated:
  if (status === 'authenticated' && user) {
    if (user.role === 'platform_admin') {
      return (
        <div className="platform-admin-page">
          <div className="platform-admin-card" style={{ textAlign: 'center' }}>
            <div className="platform-admin-header">
              <div className="platform-admin-icon-wrap">
                <BrandMark size={36} />
              </div>
              <span className="platform-admin-badge" style={{ background: 'rgba(52, 211, 153, 0.12)', color: 'var(--status-ok)', borderColor: 'rgba(52, 211, 153, 0.35)' }}>
                <IconShield width={13} height={13} />
                Platform Administrator Active
              </span>
              <h1 className="platform-admin-title">Welcome Back</h1>
              <p className="platform-admin-description">
                You are currently authenticated as <strong>{user.displayName ?? user.email}</strong> with full platform governance privileges.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="button button-primary button-block"
                onClick={() => navigate('/admin')}
              >
                Go to Platform Dashboard <IconArrowRight width={15} height={15} />
              </button>
              <button
                type="button"
                className="button button-secondary button-block"
                onClick={() => void logout()}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Authenticated as a company-level user (owner, admin, editor, viewer)
    return (
      <div className="platform-admin-page">
        <div className="platform-admin-card" style={{ textAlign: 'center' }}>
          <div className="platform-admin-header">
            <div
              className="platform-admin-icon-wrap"
              style={{
                background: 'radial-gradient(circle, rgba(248, 113, 113, 0.15) 0%, rgba(248, 113, 113, 0.02) 70%)',
                borderColor: 'rgba(248, 113, 113, 0.35)',
                boxShadow: '0 0 20px rgba(248, 113, 113, 0.15)',
              }}
            >
              <IconLock width={26} height={26} style={{ color: '#f87171' }} />
            </div>
            <span
              className="platform-admin-badge"
              style={{
                background: 'rgba(248, 113, 113, 0.12)',
                color: '#f87171',
                borderColor: 'rgba(248, 113, 113, 0.35)',
              }}
            >
              <IconLock width={13} height={13} />
              Platform Portal Restricted
            </span>
            <h1 className="platform-admin-title">Access Restricted</h1>
            <p className="platform-admin-description">
              You are currently signed in as <strong>{user.email}</strong> with company role <strong>{roleLabel(user.role)}</strong>.
            </p>
          </div>

          <div
            style={{
              textAlign: 'left',
              padding: '1rem',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              fontSize: '0.85rem',
              color: '#fca5a5',
              lineHeight: 1.5,
            }}
          >
            This portal is strictly reserved for the Platform Administrator (website creator). Company owners, administrators, and team members must use the Company Workspace dashboard.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
            <button
              type="button"
              className="button button-primary button-block"
              onClick={() => navigate('/dashboard')}
            >
              Go to Workspace Dashboard
            </button>
            <button
              type="button"
              className="button button-secondary button-block"
              onClick={() => void logout()}
            >
              Sign Out & Switch Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setSubmitting(true);
    setError(null);

    const result = await login(email.trim().toLowerCase(), password);

    if (result.ok) {
      if (result.user?.role === 'platform_admin') {
        navigate('/admin');
      } else {
        // Logged in user is not a platform admin; state will re-render into the restricted view above
      }
    } else {
      setError(result.message ?? 'Invalid administrator credentials.');
      setSubmitting(false);
    }
  }

  return (
    <div className="platform-admin-page">
      <div className="platform-admin-card">
        <header className="platform-admin-header">
          <div className="platform-admin-icon-wrap">
            <BrandMark size={36} />
          </div>

          <span className="platform-admin-badge">
            <IconShield width={13} height={13} />
            Platform Administration
          </span>

          <h1 className="platform-admin-title">Creator & Platform Portal</h1>
          <p className="platform-admin-description">
            Dedicated secure access for TrustVault platform governance, cross-company visibility, and audit ledger integrity.
          </p>
        </header>

        {error ? (
          <div
            className="alert alert-error"
            role="alert"
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <IconLock width={15} height={15} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        ) : null}

        <form onSubmit={(e) => void handleSubmit(e)} className="platform-admin-form" noValidate>
          <div className="field">
            <label htmlFor="admin-email">Platform Administrator Email</label>
            <input
              id="admin-email"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@trustvault.local"
              disabled={submitting}
            />
          </div>

          <div className="field">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              disabled={submitting}
            />
          </div>

          <button
            type="submit"
            className="button button-primary button-block"
            disabled={submitting}
            style={{ marginTop: '0.35rem', padding: '0.7rem 1.25rem', fontSize: '0.925rem' }}
          >
            {submitting ? 'Verifying Platform Credentials…' : 'Sign In as Platform Administrator'}
          </button>
        </form>

        <div className="platform-admin-footer">
          <p className="muted small" style={{ margin: 0 }}>
            Are you a Company Workspace owner or employee?
          </p>
          <Link
            to="/login"
            className="button button-secondary button-block button-sm"
          >
            Go to Company Workspace Login →
          </Link>
        </div>
      </div>
    </div>
  );
}

export default PlatformAdminLoginPage;
