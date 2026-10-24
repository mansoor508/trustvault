import { useCallback, useEffect, useState, type JSX } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ActivityFeed } from '../components/documents/ActivityFeed';
import { EditDocumentModal } from '../components/documents/EditDocumentModal';
import { ShareModal } from '../components/documents/ShareModal';
import { AccessDenied, ErrorState, Skeleton } from '../components/ui/Feedback';
import { IconArrowLeft, IconDownload, IconEdit, IconShare, IconTrash } from '../components/ui/Icons';
import { Modal } from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';
import { extractErrorMessage } from '../lib/auth';
import {
  CATEGORY_LABELS,
  canManageDocument,
  deleteDocument,
  downloadDocument,
  fetchDocument,
  fetchDocumentHistory,
  fetchPermissions,
  formatBytes,
  saveBlob,
  type ActivityEntry,
  type DocumentItem,
  type DocumentPermissionEntry,
} from '../lib/documents';
import { formatDateTime } from '../lib/format';

function accessLabel(mode: DocumentItem['access']['mode']): string {
  if (mode === 'admin') return 'Administrator access';
  if (mode === 'owner') return 'Owner';
  if (mode === 'co-owner') return 'Co-owner';
  return 'Shared with you';
}

export function DocumentDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { csrfToken } = useAuth();

  const [document, setDocument] = useState<DocumentItem | null>(null);
  const [permissions, setPermissions] = useState<DocumentPermissionEntry[]>([]);
  const [history, setHistory] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (id === undefined) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const result = await fetchDocument(id);

      if (result.status === 404) {
        setNotFound(true);
        return;
      }
      if (!result.ok) {
        setError(extractErrorMessage(result.data) ?? `Could not load the document (HTTP ${result.status}).`);
        return;
      }

      const loaded = result.data.document;
      setDocument(loaded);

      if (canManageDocument(loaded)) {
        const [permissionResult, historyResult] = await Promise.all([
          fetchPermissions(id),
          fetchDocumentHistory(id, 10),
        ]);
        if (permissionResult.ok) setPermissions(permissionResult.data.permissions);
        if (historyResult.ok) setHistory(historyResult.data.entries);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the document.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDownload(): Promise<void> {
    if (document === null) return;
    setDownloading(true);
    setError(null);
    try {
      const blob = await downloadDocument(document.id);
      saveBlob(blob, document.fileName);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Download failed.');
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (document === null) return;
    setDeleting(true);
    try {
      const result = await deleteDocument(document.id, csrfToken ?? '');
      if (result.ok) {
        navigate('/documents', {
          replace: true,
          state: { notice: `Deleted “${document.title}”. The owner can no longer see it.` },
        });
        return;
      }
      setError(extractErrorMessage(result.data) ?? `Delete failed (HTTP ${result.status}).`);
      setShowDelete(false);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Delete failed.');
      setShowDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  if (notFound) {
    return (
      <div className="stack">
        <Link className="link-inline" to="/documents">
          <IconArrowLeft width={15} height={15} /> Back to documents
        </Link>
        <AccessDenied
          title="Document not available"
          message="It may have been deleted, or your access may have been revoked."
        />
      </div>
    );
  }

  if (loading && document === null) {
    return (
      <div className="stack">
        <Skeleton lines={2} />
        <Skeleton lines={5} />
      </div>
    );
  }

  if (document === null) {
    return <ErrorState message={error ?? 'Could not load the document.'} onRetry={() => void load()} />;
  }

  const manageable = canManageDocument(document);

  return (
    <div className="stack page-enter">
      <Link className="link-inline" to="/documents">
        <IconArrowLeft width={15} height={15} /> Back to documents
      </Link>

      <section className="detail-head">
        <div>
          <div className="detail-tags">
            <span className={`tag tag-${document.category}`}>
              {CATEGORY_LABELS[document.category]}
            </span>
            <span className={`access-badge access-${document.access.mode}`}>
              {accessLabel(document.access.mode)}
            </span>
            <span className={`tag ${document.status === 'active' ? 'tag-active' : ''}`}>
              {document.status}
            </span>
          </div>
          <h2>{document.title}</h2>
          <p className="muted">{document.description ?? 'No description provided.'}</p>
        </div>

        <div className="detail-actions">
          <button
            className="button button-primary"
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
          >
            <IconDownload width={16} height={16} />
            {downloading ? 'Preparing…' : 'Download'}
          </button>

          {manageable ? (
            <>
              <button className="button button-secondary" type="button" onClick={() => setShowEdit(true)}>
                <IconEdit width={16} height={16} /> Edit
              </button>
              <button className="button button-secondary" type="button" onClick={() => setShowShare(true)}>
                <IconShare width={16} height={16} /> Share
              </button>
              <button className="button button-danger" type="button" onClick={() => setShowDelete(true)}>
                <IconTrash width={16} height={16} /> Delete
              </button>
            </>
          ) : null}
        </div>
      </section>

      {error !== null ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}

      {!manageable ? (
        <p className="alert alert-info" role="status">
          You have read-only access to this document. Only the owner or a co-owner can edit it,
          share it or delete it.
        </p>
      ) : null}

      <section className="panel" aria-labelledby="metadata-title">
        <header className="panel-head">
          <h3 id="metadata-title">Metadata</h3>
        </header>
        <dl className="detail-grid">
          <div>
            <dt>Owner</dt>
            <dd>
              {document.owner.displayName ?? document.owner.email}
              <span className="muted small block">{document.owner.email}</span>
            </dd>
          </div>
          <div>
            <dt>Original file</dt>
            <dd className="mono">{document.fileName}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{formatBytes(document.sizeBytes)}</dd>
          </div>
          <div>
            <dt>Content type</dt>
            <dd className="mono">{document.mimeType}</dd>
          </div>
          <div>
            <dt>Uploaded</dt>
            <dd>{formatDateTime(document.createdAt)}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{formatDateTime(document.updatedAt)}</dd>
          </div>
          <div className="detail-grid-wide">
            <dt>SHA-256 checksum</dt>
            <dd className="mono">{document.checksumSha256 ?? '—'}</dd>
          </div>
        </dl>
        <p className="muted small">
          The storage path is never exposed. Downloads always go through an authorized API request.
        </p>
      </section>

      {manageable ? (
        <>
          <section className="panel" aria-labelledby="access-title">
            <header className="panel-head">
              <div>
                <h3 id="access-title">People with access</h3>
                <p className="muted small">
                  The owner always has access. Everyone else needs an explicit grant.
                </p>
              </div>
              <button
                className="button button-secondary button-sm"
                type="button"
                onClick={() => setShowShare(true)}
              >
                <IconShare width={15} height={15} /> Manage access
              </button>
            </header>

            {permissions.length === 0 ? (
              <p className="muted">No grants yet — this document is visible to you alone.</p>
            ) : (
              <ul className="access-list">
                {permissions.map((permission) => (
                  <li key={permission.userId}>
                    <div>
                      <strong>{permission.displayName ?? permission.email}</strong>
                      <span className="muted small block">{permission.email}</span>
                    </div>
                    <span className={`tag tag-role-${permission.role}`}>
                      {permission.role === 'owner' ? 'Co-owner' : 'Viewer'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel" aria-labelledby="history-title">
            <header className="panel-head">
              <h3 id="history-title">Access history</h3>
              <Link className="link-inline" to="/history">
                Full history
              </Link>
            </header>
            <ActivityFeed entries={history} emptyLabel="No recorded activity for this document yet." />
          </section>
        </>
      ) : null}

      {showShare ? (
        <ShareModal
          document={document}
          csrfToken={csrfToken ?? ''}
          onClose={() => setShowShare(false)}
          onChanged={() => void load()}
        />
      ) : null}

      {showEdit ? (
        <EditDocumentModal
          document={document}
          csrfToken={csrfToken ?? ''}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => {
            setDocument(updated);
            void load();
          }}
        />
      ) : null}

      {showDelete ? (
        <Modal
          title="Delete this document?"
          description="The document stops being visible and downloadable immediately."
          onClose={() => setShowDelete(false)}
          size="sm"
          footer={
            <div className="modal-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setShowDelete(false)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="button button-danger"
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete document'}
              </button>
            </div>
          }
        >
          <p className="muted">
            Software deletion is a soft delete: the record is hidden and the bytes are retained for
            recovery until a purge job runs.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
