import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { LoadingBlock } from '../components/ui/Feedback';
import { IconActivity, IconLock, IconShare, IconShield } from '../components/ui/Icons';
import { useAuth } from '../context/AuthContext';
import { extractErrorMessage, fetchInvitationDetails, type InvitationDetails } from '../lib/auth';
import { roleLabel } from '../lib/format';
import { acceptWorkspaceInvitation } from '../lib/workspace';

const HIGHLIGHTS = [
  {
    icon: <IconShield width={17} height={17} />,
    title: 'Isolated company workspace',
    body: 'Your documents, employee accounts, and audit events are strictly isolated from other organizations.',
  },
  {
    icon: <IconLock width={17} height={17} />,
    title: 'Private by default',
    body: 'Files live in persistent private storage and are only streamed after rigorous database permission checks.',
  },
  {
    icon: <IconShare width={17} height={17} />,
    title: 'Explicit document permissions',
    body: 'Grant viewer or editor access to specific team members, with instant zero-lag revocation.',
  },
  {
    icon: <IconActivity width={17} height={17} />,
    title: 'Tamper-evident audit trail',
    body: 'Every upload, download, permission grant, and login is cryptographically chained with SHA-256.',
  },
];

export function RegisterPage(): JSX.Element {
  const { status, user, setUser, csrfToken, register, logout } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteTokenParam = searchParams.get('invite') ?? '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [workspaceType, setWorkspaceType] = useState<'company' | 'personal'>(
    inviteTokenParam ? 'personal' : 'company',
  );
  const [companyName, setCompanyName] = useState('');
  const [inviteToken, setInviteToken] = useState(inviteTokenParam);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteDetails, setInviteDetails] = useState<InvitationDetails | null>(null);

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

  // If user is already authenticated and has an invite token, allow accepting immediately
  async function handleAcceptWhileLoggedIn(): Promise<void> {
    if (!csrfToken) {
      setError('Security token not ready. Reload the page and try again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await acceptWorkspaceInvitation(inviteTokenParam, csrfToken);
      if (!res.ok) {
        setError(extractErrorMessage(res.data) ?? 'Failed to accept invitation.');
        setBusy(false);
        return;
      }
      setUser(res.data.user);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invitation.');
      setBusy(false);
    }
  }

  if (status === 'checking') {
    return (
      <div className="boot-screen">
        <BrandMark />
        <LoadingBlock label="Checking your session…" />
      </div>
    );
  }

  if (status === 'authenticated') {
    if (inviteTokenParam) {
      const isMismatch = Boolean(
        user?.email &&
          inviteDetails?.email &&
          user.email.toLowerCase() !== inviteDetails.email.toLowerCase(),
      );

      return (
        <div className="login-page">
          <section className="login-panel" style={{ maxWidth: 540, margin: '4rem auto' }}>
            <div className="login-card">
              <header>
                <h2>Join Workspace</h2>
                <p className="muted">You are invited to collaborate on TrustVault.</p>
              </header>

              {inviteDetails ? (
                <div className="alert alert-info" role="status" style={{ margin: '1rem 0' }}>
                  <strong>{inviteDetails.companyName}</strong>
                  <p className="small">
                    Role: <strong>{roleLabel(inviteDetails.role)}</strong>
                  </p>
                  <p className="small muted">
                    Intended recipient: <strong>{inviteDetails.email}</strong>
                  </p>
                </div>
              ) : null}

              {isMismatch ? (
                <div className="alert alert-warning" role="alert" style={{ margin: '1rem 0' }}>
                  <strong>Account Mismatch:</strong>
                  <p className="small" style={{ marginTop: '0.35rem' }}>
                    This invitation was sent to <strong>{inviteDetails?.email}</strong>, but you are currently signed in as <strong>{user?.email}</strong>. Please switch accounts to accept.
                  </p>
                </div>
              ) : (
                <p className="small" style={{ marginBottom: '1.5rem' }}>
                  You are currently signed in as <strong>{user?.email}</strong>.
                </p>
              )}

              {error !== null ? (
                <p className="alert alert-error" role="alert" style={{ marginBottom: '1rem' }}>
                  {error}
                </p>
              ) : null}

              <div style={{ display: 'flex', gap: '1rem', flexDirection: 'column' }}>
                {isMismatch ? (
                  <button
                    type="button"
                    className="button button-primary button-block"
                    onClick={() => {
                      void logout().then(() => {
                        navigate(`/register?invite=${encodeURIComponent(inviteTokenParam)}`, { replace: true });
                      });
                    }}
                    disabled={busy}
                  >
                    Sign Out & Switch Account
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button button-primary button-block"
                    onClick={() => void handleAcceptWhileLoggedIn()}
                    disabled={busy || !inviteDetails}
                  >
                    {busy ? 'Accepting invitation…' : 'Accept Invitation & Enter Workspace'}
                  </button>
                )}
                <button
                  type="button"
                  className="button button-ghost button-block"
                  onClick={() => navigate('/dashboard', { replace: true })}
                  disabled={busy}
                >
                  Return to Dashboard
                </button>
              </div>
            </div>
          </section>
        </div>
      );
    }
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (workspaceType === 'company' && !inviteToken && companyName.trim().length < 2) {
      setError('Please enter a company name (at least 2 characters), or select Personal Workspace.');
      return;
    }

    setBusy(true);
    const outcome = await register({
      name: name.trim(),
      email: email.trim(),
      companyName: workspaceType === 'company' && !inviteToken ? companyName.trim() : undefined,
      inviteToken: inviteToken.trim() || undefined,
      password,
    });

    if (!outcome.ok) {
      setError(outcome.message ?? 'Registration failed. Please check your information.');
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="login-brand">
          <BrandMark />
          <span>TrustVault</span>
        </div>

        <div className="login-hero-copy">
          <p className="eyebrow">Enterprise Workspace Registration</p>
          <h1>
            Secure document vaults,
            <span className="accent-text"> built for real teams.</span>
          </h1>
          <p className="login-lede">
            Create an isolated company workspace with row-level document authorization, instant
            permission revocation, and cryptographic audit accountability.
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
            <h2>Create account</h2>
            <p className="muted">Join TrustVault to store and share sensitive documents securely.</p>
          </header>

          {inviteTokenParam && inviteDetails ? (
            <div className="alert alert-info" role="status" style={{ marginBottom: '1rem' }}>
              <strong>Workspace Invitation</strong>
              <p className="small">
                You&apos;ve been invited to join <strong>{inviteDetails.companyName}</strong> as a{' '}
                <strong>{roleLabel(inviteDetails.role)}</strong>.
              </p>
            </div>
          ) : inviteTokenParam ? (
            <div className="alert alert-info" role="status" style={{ marginBottom: '1rem' }}>
              <strong>Workspace Invitation</strong>
              <p className="small">You are registering with an invitation code to join a workspace.</p>
            </div>
          ) : null}

          {!inviteTokenParam ? (
            <div className="tab-group" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
              <button
                type="button"
                className={`button button-sm ${workspaceType === 'company' ? 'button-primary' : 'button-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => setWorkspaceType('company')}
              >
                Company Workspace
              </button>
              <button
                type="button"
                className={`button button-sm ${workspaceType === 'personal' ? 'button-primary' : 'button-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => setWorkspaceType('personal')}
              >
                Personal Workspace
              </button>
            </div>
          ) : null}

          {error !== null ? (
            <div className="alert alert-error" role="alert" style={{ marginBottom: '1rem' }}>
              <p style={{ margin: 0 }}>{error}</p>
              {inviteTokenParam && !inviteDetails ? (
                <div style={{ marginTop: '0.5rem' }}>
                  <Link
                    to="/register"
                    className="button button-ghost button-sm"
                    onClick={() => {
                      setError(null);
                      setInviteToken('');
                    }}
                  >
                    Register standard account instead
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          <form className="login-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
            <div className="field">
              <label htmlFor="register-name">Full name</label>
              <input
                id="register-name"
                type="text"
                name="name"
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                placeholder="Jane Doe"
              />
            </div>

            <div className="field">
              <label htmlFor="register-email">Email address</label>
              <input
                id="register-email"
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy || Boolean(inviteDetails)}
                placeholder="jane@example.com"
              />
              {inviteDetails ? (
                <span className="small muted">This invitation is assigned to {inviteDetails.email}.</span>
              ) : null}
            </div>

            {workspaceType === 'company' && !inviteToken ? (
              <div className="field">
                <label htmlFor="register-company">Company / Organization name</label>
                <input
                  id="register-company"
                  type="text"
                  name="companyName"
                  autoComplete="organization"
                  required
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  disabled={busy}
                  placeholder="Acme Technologies"
                />
              </div>
            ) : null}

            {workspaceType === 'personal' && !inviteTokenParam ? (
              <div className="field">
                <label htmlFor="register-invite">Invitation code (optional)</label>
                <input
                  id="register-invite"
                  type="text"
                  name="inviteToken"
                  value={inviteToken}
                  onChange={(event) => setInviteToken(event.target.value)}
                  disabled={busy}
                  placeholder="Paste invitation code if you have one"
                />
              </div>
            ) : null}

            <div className="field">
              <label htmlFor="register-password">Password (minimum 12 characters)</label>
              <div className="input-with-action">
                <input
                  id="register-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="new-password"
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

            <div className="field">
              <label htmlFor="register-confirm-password">Confirm password</label>
              <input
                id="register-confirm-password"
                type={showPassword ? 'text' : 'password'}
                name="confirmPassword"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={busy}
              />
            </div>

            <button
              className="button button-primary button-block"
              type="submit"
              disabled={busy || Boolean(inviteTokenParam && error && !inviteDetails)}
            >
              {busy
                ? 'Creating account…'
                : inviteDetails
                  ? `Join ${inviteDetails.companyName}`
                  : workspaceType === 'company'
                    ? 'Create company workspace'
                    : 'Create personal account'}
            </button>
          </form>

          <p className="login-hint" style={{ marginTop: '1.25rem', textAlign: 'center' }}>
            Already have an account?{' '}
            <Link
              to={
                inviteTokenParam
                  ? `/login?invite=${encodeURIComponent(inviteTokenParam)}`
                  : '/login'
              }
              style={{ fontWeight: 600, color: 'var(--color-brand)' }}
            >
              Sign in here
            </Link>
          </p>
        </div>

        <p className="login-footnote">
          {inviteDetails
            ? `Accepting this invitation associates your account with ${inviteDetails.companyName}.`
            : 'Registration provisions you as the workspace owner with full document upload and access control privileges.'}
        </p>
      </section>
    </div>
  );
}
