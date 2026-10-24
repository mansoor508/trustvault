import type { JSX } from 'react';
import { Link } from 'react-router-dom';

export function NotFoundPage(): JSX.Element {
  return (
    <div className="not-found">
      <span className="not-found-code">404</span>
      <h1>Page not found</h1>
      <p className="muted">The page you requested does not exist or has moved.</p>
      <Link className="button button-primary" to="/dashboard">
        Return to Dashboard
      </Link>
    </div>
  );
}
