import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { LoadingBlock } from '../components/ui/Feedback';
import {
  IconActivity,
  IconBuilding,
  IconLock,
  IconShare,
  IconShield,
  IconUsers,
} from '../components/ui/Icons';
import { useAuth } from '../context/AuthContext';
import { fetchInvitationDetails, type InvitationDetails, extractErrorMessage } from '../lib/auth';
import { roleLabel } from '../lib/format';
import { getPostAuthRedirect } from '../lib/routes';

const HIGHLIGHTS = [
  {
    icon: <IconShield width={17} height={17} />,
    title: 'Server-side sessions',
    body: 'The browser holds an opaque token in an HttpOnly cookie — never a password or a token in storage.',
  },
  {
    icon: <IconLock width={17} height={17} />,
    title: 'Private by default',
    body: 'Documents live outside the web root and are streamed only after an authorization check.',
  },
  {
    icon: <IconShare width={17} height={17} />,
    title: 'Explicit sharing',
    body: 'Every non-owner needs an active grant, and revoking one takes effect on the next request.',
  },
  {
    icon: <IconActivity width={17} height={17} />,
    title: 'Auditable access',
    body: 'Uploads, downloads, edits and permission changes are recorded for owners and administrators.',
  },
];

export function LoginPage(): JSX.Element {
  const { status, user, login, notice, clearNotice } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const inviteTokenParam = searchParams.get('invite') ?? '';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteDetails, setInviteDetails] = useState<InvitationDetails | null>(null);

  const requestedPath = (location.state as { from?: string } | null)?.from;

  useEffect(() => {
    if (!inviteTokenParam) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchInvitationDetails(inviteTokenParam);
        if (cancelled) return;
        if (res.ok) {
          setInviteDetails(res.data);
          setEmail(res.data.email);
        } else {
          setError(extractErrorMessage(res.data) ?? 'Invalid or expired invitation.');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not verify invitation.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteTokenParam]);

  if (status === 'checking') {
    return (
      <div className="boot-screen">
        <BrandMark />
        <LoadingBlock label="Checking your session…" />
      </div>
    );
  }

  if (status === 'authenticated') {
    const destination = getPostAuthRedirect(requestedPath, user);
    return <Navigate to={destination} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    clearNotice();

    const outcome = await login(email.trim(), password, inviteTokenParam || undefined);
    if (!outcome.ok) {
      setError(outcome.message ?? 'Sign-in failed.');
    }
    setBusy(false);
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="login-brand">
          <BrandMark />
          <span>TrustVault</span>
        </div>

        <div className="login-hero-copy">
          <p className="eyebrow">Secure document sharing</p>
          <h1>
            Share documents with people,
            <span className="accent-text"> not with the internet.</span>
          </h1>
          <p className="login-lede">
            Private storage, explicit grants and a complete access history — built for teams that
            need to prove who could see what.
          </p>
        </div>

        <ul className="login-points">
          {HIGHLIGHTS.map((point) => (
            <li key={point.title}>
              <span className="login-point-icon">{point.icon}</span>
              <div>
                <strong>{point.title}</strong>
                <p>{point.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <header>
            <h2>Sign in</h2>
            <p className="muted">Use your TrustVault account to continue.</p>
          </header>

          {inviteTokenParam && inviteDetails ? (
            <div className="alert alert-info" role="status" style={{ marginBottom: '1rem' }}>
              <strong>Workspace Invitation</strong>
              <p className="small">
                Sign in as <strong>{inviteDetails.email}</strong> to accept your invitation to join{' '}
                <strong>{inviteDetails.companyName}</strong> as{' '}
                <strong>{roleLabel(inviteDetails.role)}</strong>.
              </p>
            </div>
          ) : null}

          {notice !== null ? (
            <p className="alert alert-info" role="status">
              {notice}
            </p>
          ) : null}
          {error !== null ? (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          ) : null}

          <form className="login-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
            <div className="field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
            </div>

            <div className="field">
              <label htmlFor="login-password">Password</label>
              <div className="input-with-action">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
                <button
                  className="input-action"
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button className="button button-primary button-block" type="submit" disabled={busy}>
              {busy
                ? 'Signing in…'
                : inviteDetails
                  ? `Sign in & Join ${inviteDetails.companyName}`
                  : 'Sign in'}
            </button>
          </form>

          <div className="login-divider" role="separator" aria-label="or">
            <span>or</span>
          </div>

          <div className="login-register-section">
            <div className="login-register-header">
              <h3>New to TrustVault?</h3>
              <p>
                {inviteTokenParam
                  ? 'Create your employee account to accept this workspace invitation.'
                  : 'Create your company workspace and start sharing documents securely.'}
              </p>
            </div>
            <Link
              to={
                inviteTokenParam
                  ? `/register?invite=${encodeURIComponent(inviteTokenParam)}`
                  : '/register'
              }
              className="button button-register button-block"
            >
              {inviteTokenParam ? (
                <IconUsers width={18} height={18} aria-hidden="true" />
              ) : (
                <IconBuilding width={18} height={18} aria-hidden="true" />
              )}
              <span>
                {inviteTokenParam
                  ? 'Create Account to Join Workspace'
                  : 'Create Company Workspace'}
              </span>
            </Link>
          </div>

          <div className="login-demo-notice">
            <span className="login-demo-badge">Demo Mode</span>
            <p className="small muted">
              Pre-seeded accounts are configured with demo credentials. See{' '}
              <code className="mono">README.md</code> or run <code className="mono">npm run seed</code>.
            </p>
          </div>

          <div
            style={{
              marginTop: '1.25rem',
              padding: '0.875rem 1rem',
              borderRadius: '8px',
              background: 'rgba(56, 189, 248, 0.05)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.75rem',
            }}
          >
            <div>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Creator & Platform Access
              </span>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                Platform Administrator governance portal
              </p>
            </div>
            <Link
              to="/platform-admin/login"
              className="button button-secondary button-sm"
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', whiteSpace: 'nowrap' }}
            >
              Platform Login →
            </Link>
          </div>
        </div>

        <p className="login-footnote">
          Sessions expire automatically. If yours ends, you will be returned here with an
          explanation — your password is never stored in the browser.
        </p>
      </section>
    </div>
  );
}
