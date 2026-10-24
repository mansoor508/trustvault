import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';
import { extractErrorMessage } from '../../lib/auth';
import {
  fetchPermissions,
  grantPermission,
  revokePermission,
  type DocumentItem,
  type DocumentPermissionEntry,
  type PermissionRole,
} from '../../lib/documents';
import { formatDate } from '../../lib/format';
import { IconShare, IconTrash, IconUsers } from '../ui/Icons';
import { Modal } from '../ui/Modal';

export interface ShareModalProps {
  document: DocumentItem;
  csrfToken: string;
  onClose: () => void;
  /** Called after any grant or revocation so the page can refresh. */
  onChanged: () => void;
}

export function ShareModal({
  document,
  csrfToken,
  onClose,
  onChanged,
}: ShareModalProps): JSX.Element {
  const [permissions, setPermissions] = useState<DocumentPermissionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PermissionRole>('viewer');
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchPermissions(document.id);
      if (result.ok) {
        setPermissions(result.data.permissions);
        setError(null);
      } else {
        setError(extractErrorMessage(result.data) ?? `Could not load access (HTTP ${result.status}).`);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load access.');
    } finally {
      setLoading(false);
    }
  }, [document.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleGrant(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const result = await grantPermission(document.id, { email, role }, csrfToken);
      if (result.ok) {
        setPermissions(result.data.permissions);
        setEmail('');
        setNotice(`Access granted to ${email.trim().toLowerCase()}.`);
        onChanged();
      } else {
        setError(extractErrorMessage(result.data) ?? `Could not grant access (HTTP ${result.status}).`);
      }
    } catch (grantError) {
      setError(grantError instanceof Error ? grantError.message : 'Could not grant access.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(permission: DocumentPermissionEntry): Promise<void> {
    setRevokingId(permission.userId);
    setError(null);
    setNotice(null);

    try {
      const result = await revokePermission(document.id, permission.userId, csrfToken);
      if (result.ok) {
        setPermissions(result.data.permissions);
        setNotice(`Access revoked for ${permission.email}.`);
        onChanged();
      } else {
        setError(extractErrorMessage(result.data) ?? `Could not revoke access (HTTP ${result.status}).`);
      }
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke access.');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <Modal
      title="Share document"
      description={`${document.title} · only the API decides who can open it.`}
      onClose={onClose}
      size="lg"
    >
      <form className="share-form" onSubmit={(event) => void handleGrant(event)}>
        <div className="field">
          <label htmlFor="share-email">Account email</label>
          <input
            id="share-email"
            type="email"
            autoComplete="off"
            placeholder="teammate@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={submitting}
          />
        </div>

        <div className="field">
          <label htmlFor="share-role">Access level</label>
          <select
            id="share-role"
            value={role}
            onChange={(event) => setRole(event.target.value as PermissionRole)}
            disabled={submitting}
          >
            <option value="viewer">Viewer — open and download</option>
            <option value="editor">Editor — view, download and edit</option>
          </select>
        </div>

        <button className="button button-primary" type="submit" disabled={submitting}>
          <IconShare width={16} height={16} />
          {submitting ? 'Granting…' : 'Grant access'}
        </button>
      </form>

      {error !== null ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice !== null ? (
        <p className="alert alert-success" role="status">
          {notice}
        </p>
      ) : null}

      <section className="share-list" aria-labelledby="share-list-title">
        <h3 id="share-list-title">
          <IconUsers width={16} height={16} /> People with access
        </h3>

        {loading ? (
          <p className="muted">Loading access list…</p>
        ) : permissions.length === 0 ? (
          <p className="muted">
            No explicit grants yet. The owner always has access; everyone else must be listed here.
          </p>
        ) : (
          <ul>
            {permissions.map((permission) => (
              <li key={permission.userId}>
                <div className="share-person">
                  <strong>{permission.displayName ?? permission.email}</strong>
                  <span className="muted small">{permission.email}</span>
                </div>
                <span className={`tag tag-role-${permission.role}`}>
                  {permission.role === 'owner' ? 'Co-owner' : 'Viewer'}
                </span>
                <span className="muted small">since {formatDate(permission.createdAt)}</span>
                <button
                  className="button button-danger button-sm"
                  type="button"
                  onClick={() => void handleRevoke(permission)}
                  disabled={revokingId === permission.userId}
                >
                  <IconTrash width={15} height={15} />
                  {revokingId === permission.userId ? 'Revoking…' : 'Revoke'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="muted small">
        Revoking refreshes this list and the document view. The backend enforces access on every
        request, so a stale browser tab cannot keep reading the file.
      </p>
    </Modal>
  );
}
