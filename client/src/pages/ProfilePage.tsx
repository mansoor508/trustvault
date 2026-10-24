import { useState, type FormEvent, type JSX } from 'react';
import { useAuth } from '../context/AuthContext';
import { updateProfile, changePassword, extractErrorMessage } from '../lib/auth';
import { roleLabel, minutesUntil } from '../lib/format';
import { IconCheck, IconKey, IconLock, IconLogout, IconShield, IconUser } from '../components/ui/Icons';

export function ProfilePage(): JSX.Element {
  const { user, session, csrfToken, setUser, logout } = useAuth();

  // Profile Edit State
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Active section tab
  const [activeTab, setActiveTab] = useState<'general' | 'security' | 'workspace'>('general');

  const initials = (user?.displayName ?? user?.email ?? 'U')
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  async function handleProfileSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!csrfToken) {
      setProfileError('Security token missing. Please reload the page.');
      return;
    }

    const trimmed = displayName.trim();
    if (trimmed.length < 2) {
      setProfileError('Full name must be at least 2 characters long.');
      return;
    }

    setProfileSaving(true);
    setProfileError(null);
    setProfileSuccess(null);

    try {
      const res = await updateProfile(trimmed, csrfToken);
      if (res.ok) {
        setUser(res.data.user);
        setProfileSuccess('Profile updated successfully.');
      } else {
        setProfileError(extractErrorMessage(res.data) ?? 'Failed to update profile.');
      }
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Could not reach server.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!csrfToken) {
      setPasswordError('Security token missing. Please reload the page.');
      return;
    }

    if (!currentPassword) {
      setPasswordError('Please enter your current password.');
      return;
    }

    if (newPassword.length < 12) {
      setPasswordError('New password must be at least 12 characters long.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    if (newPassword === currentPassword) {
      setPasswordError('New password must be different from your current password.');
      return;
    }

    setPasswordSaving(true);
    setPasswordError(null);
    setPasswordSuccess(null);

    try {
      const res = await changePassword(currentPassword, newPassword, csrfToken);
      if (res.ok) {
        setPasswordSuccess('Password changed successfully. Other active sessions were signed out.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPasswordError(extractErrorMessage(res.data) ?? 'Failed to update password.');
      }
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Could not reach server.');
    } finally {
      setPasswordSaving(false);
    }
  }

  if (!user) return <div className="page-enter">User not found</div>;

  const minutesLeft = session ? minutesUntil(session.expiresAt) : 0;
  const hoursLeft = Math.floor(minutesLeft / 60);
  const remainingMins = minutesLeft % 60;
  const sessionString = hoursLeft > 0 ? `${hoursLeft}h ${remainingMins}m` : `${remainingMins}m`;

  return (
    <div className="stack page-enter" style={{ maxWidth: 940, margin: '0 auto', gap: '2rem' }}>
      {/* Profile Header Hero Card */}
      <section className="profile-hero-card">
        <div className="profile-hero-content">
          <div className="avatar avatar-xl" aria-hidden="true">
            {initials}
          </div>
          <div className="profile-hero-meta">
            <div className="profile-hero-name-row">
              <h2>{user.displayName ?? user.email}</h2>
              <span className={`badge ${user.role === 'owner' ? 'badge-role-owner' : user.role === 'admin' ? 'badge-info' : 'badge-neutral'}`}>
                {roleLabel(user.role)}
              </span>
            </div>
            <p className="profile-hero-email">{user.email}</p>
            <div className="profile-hero-chips">
              <span className="profile-chip">
                <IconShield width={14} height={14} />
                {user.companyName ? `${user.companyName} Workspace` : 'Personal Workspace'}
              </span>
              <span className="profile-chip">
                <IconLock width={14} height={14} />
                Session: {sessionString} remaining
              </span>
            </div>
          </div>
        </div>

        <div className="profile-hero-actions">
          <button
            type="button"
            className="button button-ghost button-sm"
            onClick={() => void logout()}
            style={{ color: 'var(--status-danger)' }}
          >
            <IconLogout width={15} height={15} />
            Sign out
          </button>
        </div>
      </section>

      {/* Profile Section Tabs */}
      <div className="scope-tabs profile-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'general'}
          className={`scope-tab ${activeTab === 'general' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          <IconUser width={16} height={16} />
          <span>General Profile</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'security'}
          className={`scope-tab ${activeTab === 'security' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          <IconKey width={16} height={16} />
          <span>Security & Password</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'workspace'}
          className={`scope-tab ${activeTab === 'workspace' ? 'is-active' : ''}`}
          onClick={() => setActiveTab('workspace')}
        >
          <IconShield width={16} height={16} />
          <span>Workspace & Membership</span>
        </button>
      </div>

      {/* Tab 1: General Profile */}
      {activeTab === 'general' ? (
        <section className="card card-animated" aria-labelledby="general-profile-title">
          <header className="card-header">
            <div>
              <h3 id="general-profile-title">Profile Information</h3>
              <p className="muted small">
                Manage your public name and view your verified email address.
              </p>
            </div>
          </header>

          {profileSuccess !== null ? (
            <div className="alert alert-success" role="status" style={{ marginTop: '1rem' }}>
              <IconCheck width={16} height={16} />
              <span>{profileSuccess}</span>
            </div>
          ) : null}

          {profileError !== null ? (
            <div className="alert alert-error" role="alert" style={{ marginTop: '1rem' }}>
              <span>{profileError}</span>
            </div>
          ) : null}

          <form className="login-form" onSubmit={(e) => void handleProfileSubmit(e)} style={{ marginTop: '1.5rem' }}>
            <div className="field">
              <label htmlFor="profile-email">Email Address</label>
              <input
                id="profile-email"
                type="email"
                value={user.email}
                disabled
                className="input-disabled"
                aria-describedby="profile-email-hint"
              />
              <span id="profile-email-hint" className="muted small" style={{ marginTop: '0.25rem' }}>
                Your email address is managed through organization membership and cannot be altered here.
              </span>
            </div>

            <div className="field">
              <label htmlFor="profile-name">Full Name / Display Name</label>
              <input
                id="profile-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={80}
                required
                disabled={profileSaving}
                placeholder="e.g. Jane Doe"
              />
            </div>

            <div className="form-actions" style={{ marginTop: '1rem' }}>
              <button
                type="submit"
                className="button button-primary"
                disabled={profileSaving || displayName.trim() === (user.displayName ?? '')}
              >
                {profileSaving ? 'Saving Changes…' : 'Save Profile'}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {/* Tab 2: Security & Password */}
      {activeTab === 'security' ? (
        <section className="card card-animated" aria-labelledby="security-password-title">
          <header className="card-header">
            <div>
              <h3 id="security-password-title">Security & Password</h3>
              <p className="muted small">
                Change your account password. Password updates automatically invalidate other active sessions.
              </p>
            </div>
          </header>

          {passwordSuccess !== null ? (
            <div className="alert alert-success" role="status" style={{ marginTop: '1rem' }}>
              <IconCheck width={16} height={16} />
              <span>{passwordSuccess}</span>
            </div>
          ) : null}

          {passwordError !== null ? (
            <div className="alert alert-error" role="alert" style={{ marginTop: '1rem' }}>
              <span>{passwordError}</span>
            </div>
          ) : null}

          <form className="login-form" onSubmit={(e) => void handlePasswordSubmit(e)} style={{ marginTop: '1.5rem' }}>
            <div className="field">
              <label htmlFor="current-password">Current Password</label>
              <div className="input-with-action">
                <input
                  id="current-password"
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  disabled={passwordSaving}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="input-action"
                  onClick={() => setShowCurrent(!showCurrent)}
                  aria-label={showCurrent ? 'Hide password' : 'Show password'}
                >
                  {showCurrent ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="new-password">New Password</label>
              <div className="input-with-action">
                <input
                  id="new-password"
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={12}
                  maxLength={128}
                  required
                  disabled={passwordSaving}
                  autoComplete="new-password"
                  aria-describedby="password-policy-hint"
                />
                <button
                  type="button"
                  className="input-action"
                  onClick={() => setShowNew(!showNew)}
                  aria-label={showNew ? 'Hide password' : 'Show password'}
                >
                  {showNew ? 'Hide' : 'Show'}
                </button>
              </div>
              <span id="password-policy-hint" className="muted small" style={{ marginTop: '0.25rem' }}>
                Must be at least 12 characters long and different from your current password.
              </span>
            </div>

            <div className="field">
              <label htmlFor="confirm-password">Confirm New Password</label>
              <input
                id="confirm-password"
                type={showNew ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={passwordSaving}
                autoComplete="new-password"
              />
            </div>

            <div className="form-actions" style={{ marginTop: '1rem' }}>
              <button
                type="submit"
                className="button button-primary"
                disabled={passwordSaving || !currentPassword || !newPassword}
              >
                {passwordSaving ? 'Updating Password…' : 'Change Password'}
              </button>
            </div>
          </form>

          <div className="profile-security-callout" style={{ marginTop: '2rem' }}>
            <h4>Security Architecture Notice</h4>
            <ul className="profile-security-list">
              <li>
                <strong>HttpOnly Cookie Authentication:</strong> Session tokens are stored in secure browser cookies and never exposed to JavaScript or localStorage.
              </li>
              <li>
                <strong>Constant-Time Cryptography:</strong> Passwords are evaluated using bcrypt (cost factor 12) with constant-time verification.
              </li>
              <li>
                <strong>Tamper-Evident Audit Ledger:</strong> All password changes and login events are cryptographically hashed into an append-only SHA-256 audit log.
              </li>
            </ul>
          </div>
        </section>
      ) : null}

      {/* Tab 3: Workspace & Membership */}
      {activeTab === 'workspace' ? (
        <section className="card card-animated" aria-labelledby="workspace-membership-title">
          <header className="card-header">
            <div>
              <h3 id="workspace-membership-title">Workspace & Organization</h3>
              <p className="muted small">
                Tenant isolation and role-based permissions assigned to your account.
              </p>
            </div>
          </header>

          <div className="profile-workspace-grid" style={{ marginTop: '1.5rem' }}>
            <div className="profile-info-block">
              <span className="profile-info-label">Organization Name</span>
              <strong className="profile-info-val">
                {user.companyName ?? 'Personal Account (No Organization)'}
              </strong>
            </div>

            <div className="profile-info-block">
              <span className="profile-info-label">Workspace Tenant ID</span>
              <code className="profile-info-val mono small">
                {user.companyId ?? 'personal-sandbox'}
              </code>
            </div>

            <div className="profile-info-block">
              <span className="profile-info-label">Assigned Role</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                <span className={`badge ${user.role === 'owner' ? 'badge-role-owner' : user.role === 'admin' ? 'badge-info' : 'badge-neutral'}`}>
                  {roleLabel(user.role)}
                </span>
              </div>
            </div>

            <div className="profile-info-block">
              <span className="profile-info-label">Account Status</span>
              <span className="badge badge-success" style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}>
                Active & Verified
              </span>
            </div>
          </div>

          <div className="profile-role-summary" style={{ marginTop: '1.75rem' }}>
            <h4>Permissions Overview</h4>
            <p className="muted small">
              {user.role === 'owner'
                ? 'As a Workspace Owner, you possess full administrative governance over workspace documents, company memberships, role assignments, and organization settings.'
                : user.role === 'admin'
                  ? 'As a Platform Administrator, you govern system security, audit hash verification, and user statuses across the platform. Company documents remain private to their respective owners.'
                  : user.role === 'editor'
                    ? 'As an Editor, you can upload documents, view shared materials, and edit document metadata when permitted by document owners.'
                    : 'As a Viewer, you can discover, inspect metadata, and download documents explicitly shared with your account.'}
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
