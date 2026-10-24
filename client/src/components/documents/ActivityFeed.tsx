import type { JSX } from 'react';
import type { ActivityEntry } from '../../lib/documents';
import { actionLabel, describeMetadata, relativeTime } from '../../lib/format';

export interface ActivityFeedProps {
  entries: ActivityEntry[];
  emptyLabel?: string;
  showDocument?: boolean;
}

/** Shared activity list used by the document page, history page and admin page. */
export function ActivityFeed({
  entries,
  emptyLabel = 'No activity yet.',
  showDocument = false,
}: ActivityFeedProps): JSX.Element {
  if (entries.length === 0) {
    return <p className="muted activity-empty">{emptyLabel}</p>;
  }

  return (
    <ul className="activity-feed">
      {entries.map((entry) => {
        const detail = describeMetadata(entry.metadata);
        return (
          <li className="activity-item" key={entry.id}>
            <span
              className={`activity-dot ${entry.outcome === 'failure' ? 'is-failure' : 'is-success'}`}
              aria-hidden="true"
            />
            <div className="activity-main">
              <div className="activity-line">
                <strong>{actionLabel(entry.action)}</strong>
                {showDocument && entry.documentTitle !== null ? (
                  <span className="activity-document">{entry.documentTitle}</span>
                ) : null}
              </div>
              <div className="activity-meta">
                <span>{entry.actorEmail ?? 'system'}</span>
                {detail !== null ? <span>{detail}</span> : null}
              </div>
            </div>
            <time className="activity-time" dateTime={entry.createdAt} title={entry.createdAt}>
              {relativeTime(entry.createdAt)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
