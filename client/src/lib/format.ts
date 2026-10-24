/** Presentation helpers shared by the dashboard pages. */

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const DATE_ONLY = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
});

export function formatDateTime(iso: string | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return typeof iso === 'string' ? iso : '';
  return DATE_TIME.format(date);
}

export function formatDate(iso: string | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return typeof iso === 'string' ? iso : '';
  return DATE_ONLY.format(date);
}

/** "just now", "12 min ago", "3 h ago", then a date. */
export function relativeTime(iso: string | Date): string {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.round((Date.now() - date.getTime()) / 1_000);

  if (seconds < 45) return 'just now';
  if (seconds < 90) return '1 min ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatDate(date);
}

export function minutesUntil(iso: string): number {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.round((date.getTime() - Date.now()) / 60_000));
}

export const ACTION_LABELS: Record<string, string> = {
  'document.uploaded': 'Uploaded document',
  'document.downloaded': 'Downloaded document',
  'document.updated': 'Edited metadata',
  'document.deleted': 'Deleted document',
  'document.permission_granted': 'Granted access',
  'document.permission_revoked': 'Revoked access',
  login_success: 'Signed in',
  login_failed: 'Failed sign-in',
  login_locked: 'Sign-in blocked',
  login_denied: 'Sign-in denied',
  logout: 'Signed out',
  session_denied: 'Session rejected',
  demo_seed: 'Demo accounts seeded',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, ' ');
}

export function roleLabel(role: 'platform_admin' | 'admin' | 'owner' | 'editor' | 'viewer' | string): string {
  if (role === 'platform_admin') return 'Platform Administrator';
  if (role === 'admin') return 'Company Admin';
  if (role === 'owner') return 'Company Owner';
  if (role === 'editor') return 'Editor';
  return 'Viewer';
}

/** Short, human-readable summary of an audit event's metadata. */
export function describeMetadata(metadata: unknown): string | null {
  if (metadata === null || metadata === undefined) return null;
  if (typeof metadata !== 'object') return String(metadata);

  const record = metadata as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof record['targetEmail'] === 'string') parts.push(record['targetEmail']);
  if (typeof record['role'] === 'string') parts.push(`role: ${record['role']}`);
  if (typeof record['reason'] === 'string') parts.push(String(record['reason']));
  if (typeof record['sizeBytes'] === 'number') parts.push(`${record['sizeBytes']} bytes`);
  if (Array.isArray(record['fields'])) parts.push(`fields: ${record['fields'].join(', ')}`);

  return parts.length > 0 ? parts.join(' · ') : null;
}
