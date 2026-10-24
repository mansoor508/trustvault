import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { UploadForm } from '../components/documents/UploadForm';
import { ErrorState } from '../components/ui/Feedback';
import { IconArrowRight, IconFile, IconShield } from '../components/ui/Icons';
import { useAuth } from '../context/AuthContext';
import { CATEGORY_LABELS, formatBytes, type DocumentItem } from '../lib/documents';

export function UploadPage(): JSX.Element {
  const { csrfToken } = useAuth();
  const [uploaded, setUploaded] = useState<DocumentItem | null>(null);

  if (csrfToken === null) {
    return <ErrorState message="Your session is not ready yet. Reload the page and try again." />;
  }

  return (
    <div className="stack page-enter">
      <section className="page-intro">
        <div>
          <p className="eyebrow">New document</p>
          <h2>Upload a document</h2>
          <p className="muted">
            Files are stored privately. The server validates the extension, the declared type and
            the actual bytes before accepting a document.
          </p>
        </div>
      </section>

      {uploaded === null ? (
        <section className="panel">
          <UploadForm csrfToken={csrfToken} onUploaded={(document) => setUploaded(document)} />
        </section>
      ) : (
        <section className="panel success-panel" aria-live="polite">
          <span className="success-icon">
            <IconShield width={26} height={26} />
          </span>
          <h3>“{uploaded.title}” was uploaded</h3>
          <p className="muted">
            {CATEGORY_LABELS[uploaded.category]} · {formatBytes(uploaded.sizeBytes)} · stored under a
            server-generated key and visible only to you until you share it.
          </p>

          <dl className="detail-grid">
            <div>
              <dt>File name</dt>
              <dd className="mono">{uploaded.fileName}</dd>
            </div>
            <div>
              <dt>Checksum</dt>
              <dd className="mono">{uploaded.checksumSha256?.slice(0, 24) ?? '—'}…</dd>
            </div>
          </dl>

          <div className="form-actions">
            <Link className="button button-primary" to={`/documents/${uploaded.id}`}>
              Open document <IconArrowRight width={15} height={15} />
            </Link>
            <button className="button button-secondary" type="button" onClick={() => setUploaded(null)}>
              Upload another
            </button>
            <Link className="button button-ghost" to="/documents">
              <IconFile width={15} height={15} /> View library
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
