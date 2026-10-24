import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { Navigate } from 'react-router-dom';
import { AccessDenied, ErrorState, LoadingBlock } from '../components/ui/Feedback';
import { IconActivity, IconBuilding, IconLock, IconShield, IconUsers } from '../components/ui/Icons';
import { useAuth } from '../context/AuthContext';
import { extractErrorMessage } from '../lib/auth';
import {
  createAuditCheckpoint,
  fetchAdminAuditLogs,
  fetchAdminCompanies,
  fetchAdminOverview,
  fetchAdminUsers,
  fetchPermissionHistory,
  setAdminUserStatus,
  verifyAuditIntegrity,
  type AdminAuditEntry,
  type AdminCompanyEntry,
  type AdminOverview,
  type AdminUserEntry,
  type AuditFilterParams,
  type AuditVerificationResult,
} from '../lib/admin';
import { formatBytes } from '../lib/documents';
import { actionLabel, formatDateTime, relativeTime, roleLabel } from '../lib/format';

const PAGE_SIZE = 20;

export function AdminPage(): JSX.Element {
  const { user: currentActor, csrfToken } = useAuth();

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUserEntry[]>([]);
  const [companies, setCompanies] = useState<AdminCompanyEntry[]>([]);
  const [activity, setActivity] = useState<AdminAuditEntry[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [permissionHistory, setPermissionHistory] = useState<AdminAuditEntry[]>([]);
  const [permissionTotal, setPermissionTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Tabs: 'users' | 'companies' | 'audit' | 'permissions'
  const [activeTab, setActiveTab] = useState<'users' | 'companies' | 'audit' | 'permissions'>('users');

  // Employee search & filters
  const [userSearch, setUserSearch] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // Audit Filters
  const [filterActor, setFilterActor] = useState('');
  const [filterDocId, setFilterDocId] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterOutcome, setFilterOutcome] = useState<'success' | 'failure' | 'denied' | ''>('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [auditPage, setAuditPage] = useState(0);

  // Integrity Verification
  const [integrity, setIntegrity] = useState<AuditVerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [creatingCheckpoint, setCreatingCheckpoint] = useState(false);
  const [togglingUser, setTogglingUser] = useState<string | null>(null);

  const loadAuditLogs = useCallback(async (page: number, filters?: Partial<AuditFilterParams>) => {
    try {
      const result = await fetchAdminAuditLogs({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        actor: filters?.actor || undefined,
        documentId: filters?.documentId || undefined,
        action: filters?.action || undefined,
        outcome: filters?.outcome || undefined,
        from: filters?.from || undefined,
        to: filters?.to || undefined,
      });
      if (result.ok) {
        setActivity(result.data.entries);
        setActivityTotal(result.data.pagination.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to query audit logs.');
    }
  }, []);

  const loadPermissionHistory = useCallback(async () => {
    try {
      const result = await fetchPermissionHistory(undefined, undefined, PAGE_SIZE, 0);
      if (result.ok) {
        setPermissionHistory(result.data.entries);
        setPermissionTotal(result.data.pagination.total);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [overviewResult, usersResult, companiesResult, activityResult, permResult] = await Promise.all([
        fetchAdminOverview(),
        fetchAdminUsers(),
        fetchAdminCompanies(),
        fetchAdminAuditLogs(PAGE_SIZE, 0),
        fetchPermissionHistory(undefined, undefined, PAGE_SIZE, 0),
      ]);

      const results = [overviewResult, usersResult, companiesResult, activityResult, permResult];
      if (results.some((result) => result.status === 403)) {
        setDenied(true);
        return;
      }

      const failed = results.find((result) => !result.ok);
      if (failed !== undefined) {
        setError(extractErrorMessage(failed.data) ?? `Could not load administration data (HTTP ${failed.status}).`);
        return;
      }

      if (overviewResult.ok) setOverview(overviewResult.data.overview);
      if (usersResult.ok) setUsers(usersResult.data.users);
      if (companiesResult.ok) setCompanies(companiesResult.data.companies);
      if (activityResult.ok) {
        setActivity(activityResult.data.entries);
        setActivityTotal(activityResult.data.pagination.total);
      }
      if (permResult.ok) {
        setPermissionHistory(permResult.data.entries);
        setPermissionTotal(permResult.data.pagination.total);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load administration data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const handleApplyFilters = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuditPage(0);
    await loadAuditLogs(0, {
      actor: filterActor.trim(),
      documentId: filterDocId.trim(),
      action: filterAction.trim(),
      outcome: filterOutcome || undefined,
      from: filterFrom || undefined,
      to: filterTo || undefined,
    });
  };

  const handleResetFilters = async () => {
    setFilterActor('');
    setFilterDocId('');
    setFilterAction('');
    setFilterOutcome('');
    setFilterFrom('');
    setFilterTo('');
    setAuditPage(0);
    await loadAuditLogs(0);
  };

  const handlePageChange = async (newPage: number) => {
    setAuditPage(newPage);
    await loadAuditLogs(newPage, {
      actor: filterActor.trim(),
      documentId: filterDocId.trim(),
      action: filterAction.trim(),
      outcome: filterOutcome || undefined,
      from: filterFrom || undefined,
      to: filterTo || undefined,
    });
  };

  const handleVerifyIntegrity = async () => {
    setVerifying(true);
    setFeedback(null);
    try {
      const res = await verifyAuditIntegrity();
      if (res.ok) {
        setIntegrity(res.data);
        if (res.data.verified) {
          const incidentMsg = res.data.incidents && res.data.incidents.length > 0
            ? ` (${res.data.incidents.length} legacy cascade anomalies formally attested)`
            : '';
          setFeedback(`Audit integrity verified! SHA-256 chain intact across ${res.data.totalEntries} entries and ${res.data.checkedCheckpoints} checkpoints${incidentMsg}.`);
        } else {
          setError(`Tamper alert! ${res.data.failureReason ?? 'Cryptographic chain verification failed.'}`);
        }
      } else {
        setError(extractErrorMessage(res.data) ?? 'Failed to verify audit ledger integrity.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error checking audit integrity.');
    } finally {
      setVerifying(false);
    }
  };

  const handleCreateCheckpoint = async () => {
    if (!csrfToken) {
      setError('Security token not ready. Reload the page and try again.');
      return;
    }
    setCreatingCheckpoint(true);
    setFeedback(null);
    try {
      const res = await createAuditCheckpoint(csrfToken);
      if (res.ok) {
        setFeedback('Cryptographic checkpoint successfully anchored.');
        await handleVerifyIntegrity();
      } else {
        setError(extractErrorMessage(res.data) ?? 'Failed to anchor checkpoint.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating checkpoint.');
    } finally {
      setCreatingCheckpoint(false);
    }
  };

  const handleToggleUserStatus = async (user: AdminUserEntry) => {
    if (user.id === currentActor?.id) {
      setError('You cannot deactivate your own administrative account.');
      return;
    }
    if (!csrfToken) {
      setError('Security token not ready. Reload the page and try again.');
      return;
    }
    setTogglingUser(user.id);
    setError(null);
    setFeedback(null);

    const nextState = !user.isActive;
    try {
      const res = await setAdminUserStatus(user.id, nextState, csrfToken);
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, isActive: nextState } : u)),
        );
        setFeedback(`Account ${user.email} has been ${nextState ? 'activated' : 'deactivated'}.`);
        await loadAuditLogs(auditPage);
        const overRes = await fetchAdminOverview();
        if (overRes.ok) setOverview(overRes.data.overview);
      } else {
        setError(extractErrorMessage(res.data) ?? 'Failed to change user account status.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error updating user status.');
    } finally {
      setTogglingUser(null);
    }
  };

  const emailById = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) map.set(u.id, u.email);
    return map;
  }, [users]);

  // Client-side filtered employees
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (selectedCompanyId !== 'all') {
        if (selectedCompanyId === 'none') {
          if (u.companyId) return false;
        } else if (u.companyId !== selectedCompanyId) {
          return false;
        }
      }
      if (selectedRole !== 'all' && u.role !== selectedRole) {
        return false;
      }
      if (selectedStatus !== 'all') {
        if (selectedStatus === 'active' && !u.isActive) return false;
        if (selectedStatus === 'disabled' && u.isActive) return false;
      }
      if (userSearch.trim()) {
        const q = userSearch.trim().toLowerCase();
        const matchesEmail = u.email.toLowerCase().includes(q);
        const matchesName = Boolean(u.displayName && u.displayName.toLowerCase().includes(q));
        const matchesCompany = Boolean(u.companyName && u.companyName.toLowerCase().includes(q));
        if (!matchesEmail && !matchesName && !matchesCompany) return false;
      }
      return true;
    });
  }, [users, userSearch, selectedCompanyId, selectedRole, selectedStatus]);

  if (denied || (currentActor && currentActor.role !== 'platform_admin')) {
    return (
      <Navigate
        to="/dashboard"
        replace
        state={{
          notice: 'Platform Administration is restricted to the authorized Platform Administrator account.',
        }}
      />
    );
  }

  if (loading && overview === null) {
    return <LoadingBlock label="Loading platform administration data…" />;
  }

  if (error !== null && overview === null) {
    return <ErrorState message={error} onRetry={() => void loadInitial()} />;
  }

  const totalAuditPages = Math.ceil(activityTotal / PAGE_SIZE) || 1;

  return (
    <div className="stack page-enter">
      <section className="page-intro">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <span
              className="tag"
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                borderColor: 'rgba(56, 189, 248, 0.3)',
                fontWeight: 600,
                fontSize: '0.75rem',
                textTransform: 'uppercase',
              }}
            >
              <IconShield width={13} height={13} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} />
              Platform Administrator Portal
            </span>
          </div>
          <h2>Creator & System Administration</h2>
          <p className="muted">
            Platform-wide governance across all company workspaces, employee directories, and tamper-evident audit logs.
          </p>
        </div>
        <div className="intro-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void loadInitial()}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh Data'}
          </button>
        </div>
      </section>

      {/* Security Invariant Notice */}
      <aside className="alert alert-info" role="status">
        <IconShield width={16} height={16} />
        <div>
          <strong>Administrator Document Separation Invariant Active:</strong> The Platform Administrator has
          platform-wide governance over companies, employee accounts, and audit ledgers, but ZERO automatic access
          to read or download private company documents.
        </div>
      </aside>

      {feedback !== null ? (
        <p className="alert alert-success" role="status">
          {feedback}
        </p>
      ) : null}

      {error !== null ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}

      {/* Overview Counters */}
      <section className="stat-grid" aria-label="Platform counters">
        <article className="stat-card">
          <span className="stat-label">Total Employees</span>
          <strong className="stat-value">{overview?.totalEmployees ?? overview?.users ?? users.length}</strong>
          <span className="stat-hint">Across all companies</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Company Workspaces</span>
          <strong className="stat-value">{overview?.totalCompanies ?? companies.length}</strong>
          <span className="stat-hint">Registered organizations</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Active Accounts</span>
          <strong className="stat-value" style={{ color: '#4ade80' }}>
            {overview?.activeAccounts ?? overview?.activeUsers ?? 0}
          </strong>
          <span className="stat-hint">Authorized accounts</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Disabled Accounts</span>
          <strong className="stat-value" style={{ color: overview?.disabledAccounts ? '#f87171' : undefined }}>
            {overview?.disabledAccounts ?? 0}
          </strong>
          <span className="stat-hint">Revoked / Suspended</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Platform Documents</span>
          <strong className="stat-value">{overview?.documents ?? 0}</strong>
          <span className="stat-hint">{formatBytes(overview?.totalBytes ?? 0)} stored</span>
        </article>
        <article className="stat-card">
          <span className="stat-label">Audit Ledger Events</span>
          <strong className="stat-value">{overview?.auditEvents ?? 0}</strong>
          <span className="stat-hint">Cryptographically chained</span>
        </article>
      </section>

      {/* Navigation Tabs */}
      <div className="toolbar" style={{ marginTop: '0.5rem' }}>
        <button
          type="button"
          className={`button ${activeTab === 'users' ? 'button-primary' : 'button-secondary'}`}
          onClick={() => setActiveTab('users')}
        >
          <IconUsers width={16} height={16} /> All Employees ({users.length})
        </button>
        <button
          type="button"
          className={`button ${activeTab === 'companies' ? 'button-primary' : 'button-secondary'}`}
          onClick={() => setActiveTab('companies')}
        >
          <IconBuilding width={16} height={16} /> Company Workspaces ({companies.length})
        </button>
        <button
          type="button"
          className={`button ${activeTab === 'audit' ? 'button-primary' : 'button-secondary'}`}
          onClick={() => setActiveTab('audit')}
        >
          <IconActivity width={16} height={16} /> Audit Ledger ({activityTotal})
        </button>
        <button
          type="button"
          className={`button ${activeTab === 'permissions' ? 'button-primary' : 'button-secondary'}`}
          onClick={() => {
            setActiveTab('permissions');
            void loadPermissionHistory();
          }}
        >
          <IconShield width={16} height={16} /> Permission History ({permissionTotal})
        </button>
      </div>

      {/* TAB 1: All Employees Across Companies */}
      {activeTab === 'users' ? (
        <section className="panel" aria-labelledby="all-employees">
          <header className="panel-head">
            <div>
              <h3 id="all-employees">
                <IconUsers width={16} height={16} /> Employees Across All Companies
              </h3>
              <p className="muted small">
                Complete directory of registered accounts across every company workspace with real-time status management.
              </p>
            </div>
            <div className="tag tag-neutral">
              Showing {filteredUsers.length} of {users.length} accounts
            </div>
          </header>

          {/* Search & Filters */}
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
            <div style={{ flex: '1 1 240px' }}>
              <input
                type="text"
                placeholder="Search employee name, email, or company..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ minWidth: '160px' }}>
              <select
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="all">All Companies ({companies.length})</option>
                <option value="none">Personal Accounts</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.employeeCount})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ minWidth: '140px' }}>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="all">All Roles</option>
                <option value="platform_admin">Platform Administrator</option>
                <option value="owner">Company Owner</option>
                <option value="admin">Company Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <div style={{ minWidth: '120px' }}>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                style={{ width: '100%' }}
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="disabled">Disabled Only</option>
              </select>
            </div>
            {(userSearch || selectedCompanyId !== 'all' || selectedRole !== 'all' || selectedStatus !== 'all') ? (
              <button
                type="button"
                className="button button-secondary button-sm"
                onClick={() => {
                  setUserSearch('');
                  setSelectedCompanyId('all');
                  setSelectedRole('all');
                  setSelectedStatus('all');
                }}
              >
                Reset Filters
              </button>
            ) : null}
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Employee / User</th>
                  <th scope="col">Company Workspace</th>
                  <th scope="col">Assigned Role</th>
                  <th scope="col">Account Status</th>
                  <th scope="col">Registered</th>
                  <th scope="col">Last Sign-in</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                      No employee accounts match the selected criteria.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="cell-owner">
                          <span style={{ fontWeight: 600 }}>{user.displayName ?? user.email}</span>
                          {user.displayName !== null ? (
                            <span className="muted small mono">{user.email}</span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        {user.companyName ? (
                          <button
                            type="button"
                            className="button button-subtle button-sm"
                            style={{ padding: '0.2rem 0.5rem', textAlign: 'left', fontWeight: 500 }}
                            onClick={() => setSelectedCompanyId(user.companyId ?? 'all')}
                            title="Filter by this company"
                          >
                            <IconBuilding width={13} height={13} style={{ marginRight: '4px', verticalAlign: 'text-bottom' }} />
                            {user.companyName}
                          </button>
                        ) : (
                          <span className="muted small">Personal Workspace</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`tag ${
                            user.role === 'platform_admin'
                              ? 'tag-role-owner'
                              : user.role === 'owner'
                                ? 'tag-active'
                                : user.role === 'admin'
                                  ? 'tag-warning'
                                  : 'tag-neutral'
                          }`}
                        >
                          {roleLabel(user.role)}
                        </span>
                      </td>
                      <td>
                        <span className={`tag ${user.isActive ? 'tag-active' : 'tag-muted'}`}>
                          {user.isActive ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td className="cell-number small" title={user.createdAt}>
                        {formatDateTime(user.createdAt)}
                      </td>
                      <td className="cell-number small">
                        {user.lastLoginAt !== null ? formatDateTime(user.lastLoginAt) : 'Never'}
                      </td>
                      <td>
                        {user.id === currentActor?.id ? (
                          <span className="muted small">(Current account)</span>
                        ) : (
                          <button
                            type="button"
                            className={`button button-sm ${user.isActive ? 'button-danger' : 'button-secondary'}`}
                            onClick={() => void handleToggleUserStatus(user)}
                            disabled={togglingUser === user.id}
                          >
                            {togglingUser === user.id
                              ? 'Updating…'
                              : user.isActive
                                ? 'Deactivate'
                                : 'Activate'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* TAB 2: Company Workspaces View */}
      {activeTab === 'companies' ? (
        <section className="panel" aria-labelledby="all-companies">
          <header className="panel-head">
            <div>
              <h3 id="all-companies">
                <IconBuilding width={16} height={16} /> Company Workspaces Overview
              </h3>
              <p className="muted small">
                All registered organizations on the TrustVault platform with real-time employee counts and document metrics.
              </p>
            </div>
            <div className="tag tag-neutral">
              {companies.length} Registered Companies
            </div>
          </header>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Company Name</th>
                  <th scope="col">Domain</th>
                  <th scope="col">Total Employees</th>
                  <th scope="col">Active Accounts</th>
                  <th scope="col">Documents</th>
                  <th scope="col">Created Date</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {companies.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                      No company workspaces have been registered yet.
                    </td>
                  </tr>
                ) : (
                  companies.map((company) => (
                    <tr key={company.id}>
                      <td>
                        <strong>{company.name}</strong>
                      </td>
                      <td className="small mono">
                        {company.domain ?? <span className="muted">None configured</span>}
                      </td>
                      <td className="cell-number">
                        <span className="tag tag-neutral">{company.employeeCount}</span>
                      </td>
                      <td className="cell-number">
                        <span className="tag tag-active">{company.activeCount}</span>
                      </td>
                      <td className="cell-number">{company.documentCount}</td>
                      <td className="cell-number small">
                        {formatDateTime(company.createdAt)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button button-secondary button-sm"
                          onClick={() => {
                            setSelectedCompanyId(company.id);
                            setActiveTab('users');
                          }}
                        >
                          View Employees ({company.employeeCount}) →
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* TAB 3: Audit Trail & Tamper Evidence */}
      {activeTab === 'audit' ? (
        <section className="stack">
          {/* Tamper-Evidence & Integrity Status */}
          <section className="panel" aria-labelledby="audit-integrity">
            <header className="panel-head">
              <div>
                <h3 id="audit-integrity">
                  <IconLock width={16} height={16} /> Audit Trail Tamper Evidence
                </h3>
                <p className="muted small">
                  Cryptographic SHA-256 hash chain and periodic checkpoints guarantee ledger integrity.
                </p>
              </div>
              <div className="intro-actions">
                <button
                  className="button button-secondary button-sm"
                  type="button"
                  onClick={() => void handleVerifyIntegrity()}
                  disabled={verifying}
                >
                  {verifying ? 'Verifying Chain…' : 'Verify Integrity'}
                </button>
                <button
                  className="button button-secondary button-sm"
                  type="button"
                  onClick={() => void handleCreateCheckpoint()}
                  disabled={creatingCheckpoint}
                >
                  {creatingCheckpoint ? 'Anchoring…' : 'Anchor Checkpoint'}
                </button>
              </div>
            </header>

            <div className={`callout ${integrity?.verified === false ? 'callout-danger' : 'callout-subtle'}`}>
              <div className="split">
                <div>
                  <p className="small">
                    <strong>Status: </strong>
                    {integrity === null ? (
                      <span className="muted">Not checked this session</span>
                    ) : integrity.verified ? (
                      <span className="tag tag-active">Verified Intact ({integrity.totalEntries} entries, {integrity.checkedCheckpoints} checkpoints)</span>
                    ) : (
                      <span className="tag tag-danger">Tamper Detected</span>
                    )}
                  </p>
                  {integrity?.lastVerifiedHash ? (
                    <p className="mono small muted" style={{ marginTop: '0.25rem' }}>
                      Anchor Hash: {integrity.lastVerifiedHash.slice(0, 24)}…
                    </p>
                  ) : null}
                  {integrity?.verified && integrity.incidents && integrity.incidents.length > 0 ? (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                      <p style={{ margin: '0.2rem 0', color: 'var(--color-primary, #38bdf8)' }}>
                        <strong>Attested Recovery: </strong>{integrity.incidents.length} historical events (IDs: {integrity.incidents.map((i) => `#${i.eventId}`).join(', ')}) formally attested in recovery registry. Original audit evidence preserved without data fabrication.
                      </p>
                    </div>
                  ) : null}
                  {integrity?.verified === false ? (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                      {integrity.failedAtId ? (
                        <p style={{ margin: '0.2rem 0', fontWeight: 600 }}>
                          Failed Event ID: <span className="mono">#{integrity.failedAtId}</span>
                        </p>
                      ) : null}
                      {integrity.failureReason ? (
                        <p style={{ margin: '0.2rem 0', color: 'var(--color-danger, #ef4444)' }}>
                          <strong>Failure Reason: </strong>{integrity.failureReason}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <p className="small muted" style={{ maxWidth: '440px' }}>
                  Database triggers enforce append-only immutability by rejecting raw UPDATE and DELETE operations on audit tables.
                </p>
              </div>
            </div>
          </section>

          {/* Audit Trail Panel */}
          <section className="panel" aria-labelledby="admin-audit">
            <header className="panel-head">
              <div>
                <h3 id="admin-audit">Platform Audit Events</h3>
                <p className="muted small">
                  Chronological SHA-256 chained audit records across all document activities and authentication events.
                </p>
              </div>
            </header>

            {/* Filter Controls Form */}
            <form onSubmit={(e) => void handleApplyFilters(e)} className="form-grid" style={{ padding: '1rem', borderBottom: '1px solid var(--color-border, rgba(255, 255, 255, 0.08))' }}>
              <div className="form-field">
                <label htmlFor="filter-actor" className="small">Actor Email</label>
                <input
                  id="filter-actor"
                  type="text"
                  placeholder="e.g. user@example.com"
                  value={filterActor}
                  onChange={(e) => setFilterActor(e.target.value)}
                />
              </div>

              <div className="form-field">
                <label htmlFor="filter-doc" className="small">Document ID</label>
                <input
                  id="filter-doc"
                  type="text"
                  placeholder="UUID prefix or full ID"
                  value={filterDocId}
                  onChange={(e) => setFilterDocId(e.target.value)}
                />
              </div>

              <div className="form-field">
                <label htmlFor="filter-action" className="small">Action</label>
                <input
                  id="filter-action"
                  type="text"
                  placeholder="e.g. document.uploaded"
                  value={filterAction}
                  onChange={(e) => setFilterAction(e.target.value)}
                />
              </div>

              <div className="form-field">
                <label htmlFor="filter-outcome" className="small">Outcome</label>
                <select
                  id="filter-outcome"
                  value={filterOutcome}
                  onChange={(e) => setFilterOutcome(e.target.value as 'success' | 'failure' | 'denied' | '')}
                >
                  <option value="">All Outcomes</option>
                  <option value="success">Success</option>
                  <option value="failure">Failure</option>
                  <option value="denied">Denied</option>
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="filter-from" className="small">From Date</label>
                <input
                  id="filter-from"
                  type="date"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                />
              </div>

              <div className="form-field">
                <label htmlFor="filter-to" className="small">To Date</label>
                <input
                  id="filter-to"
                  type="date"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                <button type="submit" className="button button-primary button-sm">
                  Apply Filters
                </button>
                <button
                  type="button"
                  className="button button-secondary button-sm"
                  onClick={() => void handleResetFilters()}
                >
                  Reset
                </button>
              </div>
            </form>

            {activity.length === 0 ? (
              <p className="muted" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                No audit events matched the filter criteria.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Event ID</th>
                      <th scope="col">When</th>
                      <th scope="col">Actor</th>
                      <th scope="col">Action</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">Resource</th>
                      <th scope="col">IP Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map((entry) => (
                      <tr key={entry.id}>
                        <td className="mono small">#{entry.id}</td>
                        <td className="cell-number" title={entry.createdAt}>
                          {formatDateTime(entry.createdAt)}
                        </td>
                        <td className="mono small">
                          {entry.userId ? (emailById.get(entry.userId) ?? entry.userId) : 'system'}
                        </td>
                        <td>
                          <span className="tag tag-role-owner">{actionLabel(entry.action)}</span>
                        </td>
                        <td>
                          <span
                            className={`tag ${
                              entry.outcome === 'success'
                                ? 'tag-active'
                                : entry.outcome === 'denied'
                                  ? 'tag-warning'
                                  : 'tag-danger'
                            }`}
                          >
                            {entry.outcome}
                          </span>
                        </td>
                        <td className="mono small">
                          {entry.resourceType ? `${entry.resourceType}:${entry.resourceId ?? ''}` : '-'}
                        </td>
                        <td className="mono small muted" title={entry.ipHash ?? undefined}>
                          {entry.ipHash ? `${entry.ipHash.slice(0, 10)}…` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            <div className="split" style={{ padding: '1rem', alignItems: 'center' }}>
              <span className="muted small">
                Page {auditPage + 1} of {totalAuditPages} ({activityTotal} total entries)
              </span>
              <div className="intro-actions">
                <button
                  className="button button-secondary button-sm"
                  type="button"
                  onClick={() => void handlePageChange(auditPage - 1)}
                  disabled={auditPage === 0}
                >
                  Previous
                </button>
                <button
                  className="button button-secondary button-sm"
                  type="button"
                  onClick={() => void handlePageChange(auditPage + 1)}
                  disabled={auditPage >= totalAuditPages - 1}
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        </section>
      ) : null}

      {/* TAB 4: Permission Change History */}
      {activeTab === 'permissions' ? (
        <section className="panel" aria-labelledby="admin-perms">
          <header className="panel-head">
            <div>
              <h3 id="admin-perms">Permission Change History</h3>
              <p className="muted small">
                Full chronological ledger of explicit grants and revocations across all documents.
              </p>
            </div>
          </header>

          {permissionHistory.length === 0 ? (
            <p className="muted" style={{ padding: '2rem 1rem', textAlign: 'center' }}>
              No permission grant or revocation events recorded.
            </p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Action</th>
                    <th scope="col">Grantor / Owner</th>
                    <th scope="col">Target User</th>
                    <th scope="col">Document ID</th>
                    <th scope="col">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {permissionHistory.map((entry) => (
                    <tr key={entry.id}>
                      <td className="cell-number" title={entry.createdAt}>
                        {formatDateTime(entry.createdAt)}
                      </td>
                      <td>
                        <span
                          className={`tag ${
                            entry.action.includes('granted') ? 'tag-active' : 'tag-muted'
                          }`}
                        >
                          {entry.action.includes('granted') ? 'Granted' : 'Revoked'}
                        </span>
                      </td>
                      <td className="mono small">
                        {entry.userId ? (emailById.get(entry.userId) ?? entry.userId) : 'system'}
                      </td>
                      <td className="mono small">
                        {entry.targetUserId
                          ? (emailById.get(entry.targetUserId) ?? entry.targetUserId)
                          : ((entry.metadata as Record<string, unknown>)?.targetEmail as string) ?? 'unknown'}
                      </td>
                      <td className="mono small">
                        {entry.resourceId ? `${entry.resourceId.slice(0, 13)}…` : '-'}
                      </td>
                      <td className="small">
                        {(entry.metadata as Record<string, unknown>)?.role ? (
                          <span className="tag tag-role-owner">
                            Role: {String((entry.metadata as Record<string, unknown>).role)}
                          </span>
                        ) : (
                          <span className="muted">Revoked</span>
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

      <p className="muted small">
        <IconShield width={14} height={14} /> Passwords, session cookies, auth tokens, and document contents are strictly excluded from the audit log. IP addresses are HMAC-hashed with server secrets.
      </p>
    </div>
  );
}
