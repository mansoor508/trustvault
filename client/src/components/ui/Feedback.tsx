import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty-state">
      {icon !== undefined ? <div className="empty-icon">{icon}</div> : null}
      <h3>{title}</h3>
      {description !== undefined ? <p>{description}</p> : null}
      {action !== undefined ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: ErrorStateProps): JSX.Element {
  return (
    <div className="error-state" role="alert">
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
      {onRetry !== undefined ? (
        <button className="button button-secondary" type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function AccessDenied({
  title = 'Access denied',
  message = 'Your account does not have permission to view this page.',
  dashboardLink = '/dashboard',
}: {
  title?: string;
  message?: string;
  dashboardLink?: string;
}): JSX.Element {
  return (
    <div className="access-denied" role="alert">
      <span className="access-denied-code">403</span>
      <h2>{title}</h2>
      <p>{message}</p>
      <p className="muted" style={{ marginBottom: '1.5rem' }}>
        This decision is enforced by the API, not by the interface. If you believe it is wrong,
        ask the document owner or an administrator.
      </p>
      <div>
        <Link to={dashboardLink} className="button button-primary">
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }): JSX.Element {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <div className="skeleton-line" key={index} style={{ width: `${100 - index * 12}%` }} />
      ))}
    </div>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
