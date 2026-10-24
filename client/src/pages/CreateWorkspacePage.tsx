import { useState, type FormEvent, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { createWorkspace } from '../lib/workspace';
import { extractErrorMessage } from '../lib/auth';
import { IconShield } from '../components/ui/Icons';

export function CreateWorkspacePage(): JSX.Element {
  const { user, setUser, csrfToken } = useAuth();
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (companyName.trim().length < 2) {
      setError('Company name must be at least 2 characters.');
      return;
    }
    if (!csrfToken) {
      setError('Security token not ready. Reload the page and try again.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await createWorkspace(companyName.trim(), csrfToken);
      if (!result.ok) {
        setError(extractErrorMessage(result.data) ?? 'Failed to create workspace.');
        setBusy(false);
        return;
      }
      setUser(result.data.user);
      navigate('/workspace/members');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create workspace.');
      setBusy(false);
    }
  }

  return (
    <div className="stack page-enter" style={{ maxWidth: 540, margin: '2rem auto' }}>
      <div className="card">
        <header className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <IconShield width={24} height={24} />
            <div>
              <h2 style={{ margin: 0 }}>Create Company Workspace</h2>
              <p className="muted small" style={{ margin: 0 }}>
                Upgrade your personal account to an isolated multi-tenant company workspace.
              </p>
            </div>
          </div>
        </header>

        {error !== null ? (
          <p className="alert alert-error" role="alert" style={{ marginTop: '1rem' }}>
            {error}
          </p>
        ) : null}

        <form onSubmit={(e) => void handleSubmit(e)} style={{ marginTop: '1.5rem' }}>
          <div className="field">
            <label htmlFor="company-name">Company / Organization name</label>
            <input
              id="company-name"
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Acme Corporation"
              disabled={busy}
            />
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="button button-ghost"
              onClick={() => navigate('/')}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Creating...' : 'Create Workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
