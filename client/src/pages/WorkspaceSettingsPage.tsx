import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchWorkspace, updateWorkspaceSettings, type Company } from '../lib/workspace';
import { extractErrorMessage } from '../lib/auth';
import { formatDate } from '../lib/format';
import { IconShield } from '../components/ui/Icons';
import { Skeleton } from '../components/ui/Feedback';

export function WorkspaceSettingsPage(): JSX.Element {
  const { user, setUser, csrfToken } = useAuth();
  const [company, setCompany] = useState<Company | null>(null);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isOwner = user?.role === 'owner';

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWorkspace();
      if (!res.ok) {
        setError(extractErrorMessage(res.data) ?? 'Failed to load workspace.');
        return;
      }
      if (res.data.company) {
        setCompany(res.data.company);
        setName(res.data.company.name);
        setDomain(res.data.company.domain ?? '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSave(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    if (!csrfToken) {
      setError('Security token not ready. Reload the page and try again.');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const res = await updateWorkspaceSettings(
        {
          name: name.trim(),
          domain: domain.trim() || null,
        },
        csrfToken,
      );

      if (!res.ok) {
        setError(extractErrorMessage(res.data) ?? 'Failed to update workspace.');
        setSaving(false);
        return;
      }

      setCompany(res.data.company);
      if (user) {
        setUser({ ...user, companyName: res.data.company.name });
      }
      setNotice('Workspace settings updated successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack page-enter" style={{ maxWidth: 680, margin: '0 auto', gap: '2rem' }}>
      <div className="card">
        <header className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <IconShield width={24} height={24} />
            <div>
              <h2 style={{ margin: 0 }}>Workspace Settings</h2>
              <p className="muted small" style={{ margin: 0 }}>
                Configure organization details and tenant isolation settings.
              </p>
            </div>
          </div>
        </header>

        {notice !== null ? (
          <p className="alert alert-success" role="status" style={{ marginTop: '1rem' }}>
            {notice}
          </p>
        ) : null}

        {error !== null ? (
          <p className="alert alert-error" role="alert" style={{ marginTop: '1rem' }}>
            {error}
          </p>
        ) : null}

        {loading ? (
          <div style={{ marginTop: '1.5rem' }}>
            <Skeleton lines={4} />
          </div>
        ) : company ? (
          <form onSubmit={(e) => void handleSave(e)} style={{ marginTop: '1.5rem' }}>
            <div className="field">
              <label htmlFor="workspace-id">Workspace Tenant ID</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  id="workspace-id"
                  type="text"
                  readOnly
                  value={company.id}
                  style={{ fontFamily: 'monospace', backgroundColor: 'var(--color-bg-subtle)' }}
                />
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(company.id);
                    setNotice('Workspace ID copied to clipboard.');
                  }}
                >
                  Copy
                </button>
              </div>
              <p className="field-hint">Unique cryptographic identifier for multi-tenant isolation.</p>
            </div>

            <div className="field">
              <label htmlFor="workspace-name">Organization Name</label>
              <input
                id="workspace-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isOwner || saving}
              />
            </div>

            <div className="field">
              <label htmlFor="workspace-domain">Company Domain (optional)</label>
              <input
                id="workspace-domain"
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="acme.com"
                disabled={!isOwner || saving}
              />
            </div>

            <div className="field">
              <label>Created Date</label>
              <p className="muted" style={{ margin: '0.25rem 0' }}>{formatDate(company.createdAt)}</p>
            </div>

            {isOwner ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button type="submit" className="button button-primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            ) : (
              <p className="muted small" style={{ marginTop: '1rem' }}>
                Only the workspace owner can modify these settings.
              </p>
            )}
          </form>
        ) : (
          <p className="muted" style={{ marginTop: '1.5rem' }}>No company workspace found.</p>
        )}
      </div>
    </div>
  );
}
