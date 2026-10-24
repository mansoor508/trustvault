import { useCallback, useEffect, useState, type JSX } from 'react';
import { ActivityFeed } from '../components/documents/ActivityFeed';
import { AccessDenied, EmptyState, ErrorState, LoadingBlock } from '../components/ui/Feedback';
import { IconActivity } from '../components/ui/Icons';
import { extractErrorMessage } from '../lib/auth';
import { fetchAccessHistory, type ActivityPage } from '../lib/documents';

const PAGE_SIZE = 20;

export function HistoryPage(): JSX.Element {
  const [page, setPage] = useState<ActivityPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchAccessHistory(PAGE_SIZE, offset);
      if (result.status === 403) {
        setDenied(true);
        return;
      }
      if (!result.ok) {
        setError(extractErrorMessage(result.data) ?? `Could not load history (HTTP ${result.status}).`);
        return;
      }
      setPage(result.data);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load access history.');
    } finally {
      setLoading(false);
    }
  }, [offset]);

  useEffect(() => {
    void load();
  }, [load]);

  if (denied) {
    return (
      <AccessDenied
        title="Access history is for owners"
        message="Your account can open shared documents, but only owners and administrators can review activity."
      />
    );
  }

  const total = page?.pagination.total ?? 0;

  return (
    <div className="stack page-enter">
      <section className="page-intro">
        <div>
          <p className="eyebrow">Audit</p>
          <h2>Access history</h2>
          <p className="muted">
            Uploads, downloads, metadata edits and permission changes on documents you manage.
          </p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </section>

      {error !== null ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <section className="panel">
        {loading && page === null ? (
          <LoadingBlock label="Loading activity…" />
        ) : page !== null && page.entries.length === 0 ? (
          <EmptyState
            icon={<IconActivity width={26} height={26} />}
            title="No activity yet"
            description="Actions on your documents will appear here as they happen."
          />
        ) : (
          <ActivityFeed entries={page?.entries ?? []} showDocument />
        )}

        {total > PAGE_SIZE ? (
          <div className="pagination">
            <span className="muted small">
              Showing {offset + 1}–{offset + (page?.entries.length ?? 0)} of {total}
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
        ) : null}
      </section>
    </div>
  );
}
