import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { DocumentTable } from '../components/documents/DocumentTable';
import { EditDocumentModal } from '../components/documents/EditDocumentModal';
import { EmptyState, ErrorState } from '../components/ui/Feedback';
import { IconFile, IconSearch, IconUpload } from '../components/ui/Icons';
import { useAuth } from '../context/AuthContext';
import { extractErrorMessage } from '../lib/auth';
import {
  CATEGORY_LABELS,
  DOCUMENT_CATEGORIES,
  downloadDocument,
  fetchDocuments,
  saveBlob,
  type DocumentCategory,
  type DocumentFilters,
  type DocumentItem,
  type DocumentPage,
} from '../lib/documents';

const PAGE_SIZE = 10;

export function DocumentsPage(): JSX.Element {
  const { user, csrfToken } = useAuth();
  const location = useLocation();
  const initialNotice = (location.state as { notice?: string } | null)?.notice ?? null;

  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [ownerInput, setOwnerInput] = useState('');
  const [owner, setOwner] = useState('');
  const [category, setCategory] = useState<DocumentCategory | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scope, setScope] = useState<'all' | 'mine' | 'shared' | 'company'>('all');
  const [offset, setOffset] = useState(0);

  const [page, setPage] = useState<DocumentPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<DocumentItem | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setOwner(ownerInput.trim());
      setOffset(0);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput, ownerInput]);

  const filters = useMemo<DocumentFilters>(
    () => ({
      search: search.length > 0 ? search : undefined,
      category: category === '' ? undefined : category,
      owner: owner.length > 0 ? owner : undefined,
      from: from.length > 0 ? from : undefined,
      to: to.length > 0 ? to : undefined,
      sort: 'created_at',
      order: 'desc',
      limit: PAGE_SIZE,
      offset,
      scope: scope !== 'all' ? scope : undefined,
    }),
    [search, category, owner, from, to, offset, scope],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchDocuments(filters);
      if (result.ok) {
        setPage(result.data);
        setError(null);
      } else {
        setError(extractErrorMessage(result.data) ?? `Could not load documents (HTTP ${result.status}).`);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load documents.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  function clearFilters(): void {
    setSearchInput('');
    setOwnerInput('');
    setCategory('');
    setFrom('');
    setTo('');
    setOffset(0);
    setScope('all');
  }

  async function handleDownload(document: DocumentItem): Promise<void> {
    setDownloadingId(document.id);
    setError(null);
    setNotice(null);
    try {
      const blob = await downloadDocument(document.id);
      saveBlob(blob, document.fileName);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Download failed.');
    } finally {
      setDownloadingId(null);
    }
  }

  const documents = page?.documents ?? [];
  const total = page?.pagination.total ?? 0;
  const canUpload = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'editor';
  const offlineSearchActive =
    search.length > 0 ||
    owner.length > 0 ||
    category !== '' ||
    from.length > 0 ||
    to.length > 0 ||
    scope !== 'all';

  return (
    <div className="stack page-enter">
      <section className="page-intro">
        <div>
          <p className="eyebrow">Library</p>
          <h2>Documents</h2>
          <p className="muted">
            {total} document{total === 1 ? '' : 's'} visible to you. Search covers the title and the
            original file name.
          </p>
        </div>
        {canUpload ? (
          <Link className="button button-primary" to="/documents/new">
            <IconUpload width={16} height={16} />
            Upload document
          </Link>
        ) : null}
      </section>

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

      <div className="scope-tabs" role="tablist" aria-label="Document scopes">
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'all'}
          className={`scope-tab ${scope === 'all' ? 'is-active' : ''}`}
          onClick={() => {
            setScope('all');
            setOffset(0);
          }}
        >
          All documents
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'mine'}
          className={`scope-tab ${scope === 'mine' ? 'is-active' : ''}`}
          onClick={() => {
            setScope('mine');
            setOffset(0);
          }}
        >
          My documents
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'shared'}
          className={`scope-tab ${scope === 'shared' ? 'is-active' : ''}`}
          onClick={() => {
            setScope('shared');
            setOffset(0);
          }}
        >
          Shared with me
        </button>
        {user?.companyId ? (
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'company'}
            className={`scope-tab ${scope === 'company' ? 'is-active' : ''}`}
            onClick={() => {
              setScope('company');
              setOffset(0);
            }}
          >
            Company library
          </button>
        ) : null}
      </div>

      <section className="toolbar" aria-label="Document filters">
        <div className="field toolbar-search">
          <label className="sr-only" htmlFor="documents-search">
            Search documents
          </label>
          <span className="input-icon">
            <IconSearch width={16} height={16} />
            <input
              id="documents-search"
              type="search"
              placeholder="Search by name or file name"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </span>
        </div>

        <div className="field">
          <label htmlFor="documents-owner">Owner</label>
          <input
            id="documents-owner"
            placeholder="Email or name"
            value={ownerInput}
            onChange={(event) => setOwnerInput(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="documents-category">Category</label>
          <select
            id="documents-category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as DocumentCategory | '');
              setOffset(0);
            }}
          >
            <option value="">All categories</option>
            {DOCUMENT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="documents-from">From</label>
          <input
            id="documents-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setOffset(0);
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="documents-to">To</label>
          <input
            id="documents-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setOffset(0);
            }}
          />
        </div>

        {offlineSearchActive ? (
          <button className="button button-ghost button-sm" type="button" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
      </section>

      {loading && page === null ? (
        <p className="muted">Loading documents…</p>
      ) : documents.length === 0 ? (
        <EmptyState
          icon={<IconFile width={26} height={26} />}
          title={offlineSearchActive ? 'No documents match those filters' : 'No documents yet'}
          description={
            offlineSearchActive
              ? 'Try a different search term, category or date range.'
              : user?.role === 'viewer'
                ? 'When an owner shares a document with you, it will appear here.'
                : 'Upload a document to start building the library.'
          }
          action={
            !offlineSearchActive && canUpload ? (
              <Link className="button button-primary" to="/documents/new">
                Upload a document
              </Link>
            ) : offlineSearchActive ? (
              <button className="button button-secondary" type="button" onClick={clearFilters}>
                Clear filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <DocumentTable
          documents={documents}
          downloadingId={downloadingId}
          onDownload={(document) => void handleDownload(document)}
          onEdit={(document) => setEditing(document)}
        />
      )}

      <div className="pagination">
        <span className="muted small">
          {total === 0
            ? 'Nothing to show'
            : `Showing ${offset + 1}–${offset + documents.length} of ${total}`}
        </span>
        <div className="pagination-actions">
          <button
            className="button button-secondary button-sm"
            type="button"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </button>
          <button
            className="button button-secondary button-sm"
            type="button"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      </div>

      {editing !== null ? (
        <EditDocumentModal
          document={editing}
          csrfToken={csrfToken ?? ''}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setEditing(null);
            setNotice(`Saved changes to “${updated.title}”.`);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

