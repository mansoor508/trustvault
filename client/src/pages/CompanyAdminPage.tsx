import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingBlock } from '../components/ui/Feedback';
import {
  IconActivity,
  IconArrowRight,
  IconBuilding,
  IconCheck,
  IconClose,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShield,
  IconUsers,
} from '../components/ui/Icons';
import { useAuth } from '../context/AuthContext';
import { extractErrorMessage } from '../lib/auth';
import { actionLabel, describeMetadata, formatDate, formatDateTime, relativeTime, roleLabel } from '../lib/format';
import {
  fetchCompanyAdminOverview,
  type CompanyAdminActivityEntry,
  type CompanyAdminEmployee,
  type CompanyAdminOverview,
} from '../lib/workspace';

export interface CompanyAdminPageProps {
  initialOverview?: CompanyAdminOverview | null;
  initialLoading?: boolean;
}

export function CompanyAdminPage({
  initialOverview,
  initialLoading,
}: CompanyAdminPageProps = {}): JSX.Element {
  const { user: currentActor } = useAuth();

  const [overview, setOverview] = useState<CompanyAdminOverview | null>(initialOverview ?? null);
  const [loading, setLoading] = useState(initialLoading ?? (initialOverview !== undefined ? false : true));
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  // Tab: 'directory' | 'activity'
  const [activeTab, setActiveTab] = useState<'directory' | 'activity'>('directory');

  // Employee Directory Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchCompanyAdminOverview();
      if (res.status === 403 || res.status === 401) {
        setDenied(true);
        return;
      }
      if (!res.ok) {
        setError(extractErrorMessage(res.data) ?? 'Failed to load company administration data.');
        return;
      }
      setOverview(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading company administration data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialOverview !== undefined) return;
    void loadData();
  }, [loadData, initialOverview]);

  // Filtered employees
  const filteredEmployees = useMemo(() => {
    if (!overview) return [];
    return overview.employees.filter((emp) => {
      if (selectedRole !== 'all' && emp.role !== selectedRole) {
        return false;
      }
      if (selectedStatus !== 'all') {
        if (selectedStatus === 'active' && !emp.isActive) return false;
        if (selectedStatus === 'disabled' && emp.isActive) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesEmail = emp.email.toLowerCase().includes(q);
        const matchesName = Boolean(emp.displayName && emp.displayName.toLowerCase().includes(q));
        if (!matchesEmail && !matchesName) return false;
      }
      return true;
    });
  }, [overview, searchQuery, selectedRole, selectedStatus]);

  const hasActiveFilters = searchQuery.trim() !== '' || selectedRole !== 'all' || selectedStatus !== 'all';

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedRole('all');
    setSelectedStatus('all');
  };

  // Authorization check
  const isAuthorizedRole = currentActor?.role === 'admin' || currentActor?.role === 'owner';
  if (denied || (currentActor && (!isAuthorizedRole || !currentActor.companyId))) {
    return (
      <Navigate
        to="/dashboard"
        replace
        state={{
          notice: 'Company Administration is reserved for company administrators and owners.',
        }}
      />
    );
  }

  if (loading && overview === null) {
    return <LoadingBlock label="Loading company administration data…" />;
  }

  if (error !== null && overview === null) {
    return <ErrorState message={error} onRetry={() => void loadData()} />;
  }

  const { company, metrics, recentActivity } = overview ?? {
    company: { id: '', name: 'Workspace', domain: null, createdAt: '' },
    metrics: { totalEmployees: 0, ownerCount: 0, adminCount: 0, activeEmployees: 0, pendingInvitationsCount: 0 },
    recentActivity: [],
  };

  return (
    <div className="stack page-enter">
      {/* Page Header / Organization Overview */}
      <section className="page-intro">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
            <span
              className="tag"
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
              }}
            >
              <IconBuilding width={13} height={13} /> Company Administration
            </span>
            {company.domain ? (
              <span className="tag tag-neutral" style={{ opacity: 0.85 }}>
                {company.domain}
              </span>
            ) : null}
          </div>
          <h2>{company.name}</h2>
          <p className="muted" style={{ fontSize: '0.875rem' }}>
            Organization ID: <code style={{ fontSize: '0.8rem', background: 'rgba(255, 255, 255, 0.06)', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>{company.id}</code>
            {' '}• Workspace Registered: <strong>{formatDate(company.createdAt)}</strong>
          </p>
        </div>

        <div className="intro-actions" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            className="button button-secondary button-sm"
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            title="Refresh company metrics and activity"
          >
            <IconRefresh width={14} height={14} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <Link to="/workspace/members" className="button button-primary button-sm">
            <IconUsers width={14} height={14} /> Manage Members & Invites
          </Link>
          {currentActor?.role === 'owner' ? (
            <Link to="/workspace/settings" className="button button-secondary button-sm" title="Edit company workspace name and settings">
              <IconSettings width={14} height={14} /> Settings
            </Link>
          ) : null}
        </div>
      </section>

      {error !== null ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}

      {/* Key Metrics Cards */}
      <section className="stat-grid" aria-label="Company Key Metrics">
        <article className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="stat-label">Total Employees</span>
            <IconUsers width={16} height={16} style={{ color: 'var(--accent-cyan)' }} />
          </div>
          <strong className="stat-value">{metrics.totalEmployees}</strong>
          <span className="stat-hint">Registered workspace members</span>
        </article>

        <article className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="stat-label">Active Accounts</span>
            <IconCheck width={16} height={16} style={{ color: '#34d399' }} />
          </div>
          <strong className="stat-value">{metrics.activeEmployees}</strong>
          <span className="stat-hint">
            {metrics.totalEmployees - metrics.activeEmployees > 0
              ? `${metrics.totalEmployees - metrics.activeEmployees} disabled`
              : 'All accounts active'}
          </span>
        </article>

        <article className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="stat-label">Company Leadership</span>
            <IconShield width={16} height={16} style={{ color: '#a78bfa' }} />
          </div>
          <strong className="stat-value">{metrics.ownerCount + metrics.adminCount}</strong>
          <span className="stat-hint">
            {metrics.ownerCount} {metrics.ownerCount === 1 ? 'Owner' : 'Owners'} · {metrics.adminCount} {metrics.adminCount === 1 ? 'Admin' : 'Admins'}
          </span>
        </article>

        <article className="stat-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="stat-label">Pending Invitations</span>
            <IconActivity width={16} height={16} style={{ color: '#fbbf24' }} />
          </div>
          <strong className="stat-value">{metrics.pendingInvitationsCount}</strong>
          <Link className="stat-link" to="/workspace/members">
            View invitations <IconArrowRight width={14} height={14} />
          </Link>
        </article>
      </section>

      {/* Tabs: Employee Directory vs Recent Activity */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--color-border, rgba(255, 255, 255, 0.08))', paddingBottom: '0.5rem' }}>
        <button
          type="button"
          className={`button ${activeTab === 'directory' ? 'button-primary' : 'button-secondary'}`}
          onClick={() => setActiveTab('directory')}
        >
          <IconUsers width={16} height={16} /> Employee Directory ({overview?.employees.length ?? 0})
        </button>
        <button
          type="button"
          className={`button ${activeTab === 'activity' ? 'button-primary' : 'button-secondary'}`}
          onClick={() => setActiveTab('activity')}
        >
          <IconActivity width={16} height={16} /> Recent Company Activity ({recentActivity.length})
        </button>
      </div>

      {/* TAB 1: Employee Directory */}
      {activeTab === 'directory' ? (
        <section className="panel" aria-labelledby="company-employees-heading">
          <header className="panel-head">
            <div>
              <h3 id="company-employees-heading">
                <IconUsers width={16} height={16} /> Company Employees
              </h3>
              <p className="muted small">
                Complete directory of registered employees and their assigned roles for {company.name}.
              </p>
            </div>
            <div className="tag tag-neutral">
              Showing {filteredEmployees.length} of {overview?.employees.length ?? 0}
            </div>
          </header>

          {/* Search & Filter Controls */}
          <div
            style={{
              padding: '1rem',
              borderBottom: '1px solid var(--color-border, rgba(255, 255, 255, 0.08))',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              alignItems: 'center',
            }}
          >
            <div style={{ flex: '1 1 240px', position: 'relative' }}>
              <input
                type="text"
                placeholder="Search by employee name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%' }}
                aria-label="Search employees"
              />
            </div>

            <div style={{ minWidth: '150px' }}>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                style={{ width: '100%' }}
                aria-label="Filter by role"
              >
                <option value="all">All Roles</option>
                <option value="owner">Company Owner</option>
                <option value="admin">Company Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>

            <div style={{ minWidth: '150px' }}>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                style={{ width: '100%' }}
                aria-label="Filter by account status"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="disabled">Disabled Only</option>
              </select>
            </div>

            {hasActiveFilters ? (
              <button
                type="button"
                className="button button-secondary button-sm"
                onClick={resetFilters}
              >
                <IconClose width={14} height={14} /> Clear filters
              </button>
            ) : null}
          </div>

          {/* Employee Directory Table */}
          {filteredEmployees.length === 0 ? (
            <EmptyState
              icon={<IconSearch width={24} height={24} />}
              title="No employees found"
              description={
                hasActiveFilters
                  ? 'No employees match your active search or filter criteria.'
                  : 'No employees are registered in this workspace.'
              }
              action={
                hasActiveFilters ? (
                  <button type="button" className="button button-secondary" onClick={resetFilters}>
                    Clear filters
                  </button>
                ) : (
                  <Link to="/workspace/members" className="button button-primary">
                    Invite Employees
                  </Link>
                )
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Employee Name</th>
                    <th>Email Address</th>
                    <th>Assigned Role</th>
                    <th>Account Status</th>
                    <th>Registration Date</th>
                    <th>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((emp) => (
                    <tr key={emp.id}>
                      <td>
                        <strong>{emp.displayName || '—'}</strong>
                        {emp.id === currentActor?.id ? (
                          <span
                            className="tag tag-neutral"
                            style={{ marginLeft: '0.5rem', fontSize: '0.72rem' }}
                          >
                            You
                          </span>
                        ) : null}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{emp.email}</td>
                      <td>
                        <span
                          className="tag"
                          style={{
                            background:
                              emp.role === 'owner'
                                ? 'rgba(167, 139, 250, 0.2)'
                                : emp.role === 'admin'
                                  ? 'rgba(56, 189, 248, 0.2)'
                                  : emp.role === 'editor'
                                    ? 'rgba(96, 165, 250, 0.15)'
                                    : 'rgba(255, 255, 255, 0.08)',
                            color:
                              emp.role === 'owner'
                                ? '#c4b5fd'
                                : emp.role === 'admin'
                                  ? '#7dd3fc'
                                  : emp.role === 'editor'
                                    ? '#93c5fd'
                                    : '#94a3b8',
                            border: `1px solid ${
                              emp.role === 'owner'
                                ? 'rgba(167, 139, 250, 0.3)'
                                : emp.role === 'admin'
                                  ? 'rgba(56, 189, 248, 0.3)'
                                  : 'rgba(255, 255, 255, 0.1)'
                            }`,
                          }}
                        >
                          {roleLabel(emp.role)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`tag ${emp.isActive ? 'tag-success' : 'tag-error'}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          {emp.isActive ? <IconCheck width={12} height={12} /> : <IconClose width={12} height={12} />}
                          {emp.isActive ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td className="muted small">
                        <span title={formatDateTime(emp.createdAt)}>{formatDate(emp.createdAt)}</span>
                      </td>
                      <td className="muted small">
                        {emp.lastLoginAt ? (
                          <span title={formatDateTime(emp.lastLoginAt)}>{relativeTime(emp.lastLoginAt)}</span>
                        ) : (
                          <span style={{ opacity: 0.6 }}>Never</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* TAB 2: Recent Company Activity */}
      {activeTab === 'activity' ? (
        <section className="panel" aria-labelledby="company-activity-heading">
          <header className="panel-head">
            <div>
              <h3 id="company-activity-heading">
                <IconActivity width={16} height={16} /> Recent Company Activity
              </h3>
              <p className="muted small">
                Audit trail events specific to {company.name} workspace operations and member lifecycle.
              </p>
            </div>
            <div className="tag tag-neutral">
              {recentActivity.length} events recorded
            </div>
          </header>

          {recentActivity.length === 0 ? (
            <EmptyState
              icon={<IconActivity width={24} height={24} />}
              title="No recent company activity"
              description="No audit events have been logged for this company workspace yet."
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>Outcome</th>
                    <th>Actor</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {recentActivity.map((event) => {
                    const metaDetail = describeMetadata(event.metadata);
                    return (
                      <tr key={event.id}>
                        <td className="muted small" style={{ whiteSpace: 'nowrap' }}>
                          <span title={formatDateTime(event.createdAt)}>{relativeTime(event.createdAt)}</span>
                        </td>
                        <td>
                          <strong>{actionLabel(event.action)}</strong>
                        </td>
                        <td>
                          <span
                            className={`tag ${
                              event.outcome === 'success'
                                ? 'tag-success'
                                : event.outcome === 'denied'
                                  ? 'tag-error'
                                  : 'tag-error'
                            }`}
                          >
                            {event.outcome}
                          </span>
                        </td>
                        <td>
                          {event.actorEmail ? (
                            <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                              {event.actorName ? `${event.actorName} (${event.actorEmail})` : event.actorEmail}
                            </span>
                          ) : (
                            <span className="muted small">System</span>
                          )}
                        </td>
                        <td className="muted small">
                          {metaDetail ? (
                            <span>{metaDetail}</span>
                          ) : event.resourceType ? (
                            <span>
                              {event.resourceType}
                              {event.resourceId ? ` · ${event.resourceId.slice(0, 8)}…` : ''}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
export default CompanyAdminPage;
