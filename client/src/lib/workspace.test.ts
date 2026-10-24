import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acceptWorkspaceInvitation,
  createWorkspace,
  fetchWorkspace,
  fetchWorkspaceInvitations,
  fetchWorkspaceMembers,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  updateWorkspaceMemberRole,
  updateWorkspaceSettings,
  verifyWorkspaceInvitation,
} from './workspace';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-workspace-1', ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workspace client API', () => {
  const CSRF = 'a'.repeat(64);

  it('fetchWorkspace, fetchWorkspaceMembers, and fetchWorkspaceInvitations make GET requests', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ company: null, isPersonal: true }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchWorkspace();
    const [wsUrl, wsInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(wsUrl).toContain('/api/workspace');
    expect(wsInit.method ?? 'GET').toBe('GET');

    await fetchWorkspaceMembers();
    const [memUrl] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(memUrl).toContain('/api/workspace/members');

    await fetchWorkspaceInvitations();
    const [invUrl] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(invUrl).toContain('/api/workspace/invitations');
  });

  it('createWorkspace sends POST with X-CSRF-Token', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ user: { id: 'u1', companyName: 'Acme Corp' } }, 201),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await createWorkspace('Acme Corp', CSRF);
    expect(res.ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/workspace');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(CSRF);
    expect(init.body).toBe(JSON.stringify({ companyName: 'Acme Corp' }));
  });

  it('updateWorkspaceSettings sends PATCH with X-CSRF-Token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ company: { name: 'Acme New' } }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await updateWorkspaceSettings({ name: 'Acme New' }, CSRF);
    expect(res.ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/workspace');
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(CSRF);
  });

  it('inviteWorkspaceMember sends POST with X-CSRF-Token', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ invitation: { id: 'inv1', email: 'alice@acme.com', role: 'viewer' } }, 201),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await inviteWorkspaceMember(
      { email: 'alice@acme.com', role: 'viewer' },
      CSRF,
    );
    expect(res.ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/workspace/invitations');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(CSRF);
    expect(init.body).toBe(JSON.stringify({ email: 'alice@acme.com', role: 'viewer' }));
  });

  it('revokeWorkspaceInvitation sends DELETE with X-CSRF-Token', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await revokeWorkspaceInvitation('inv-123', CSRF);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/workspace/invitations/inv-123');
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(CSRF);
  });

  it('acceptWorkspaceInvitation sends POST with X-CSRF-Token and token in body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ user: { id: 'u2', role: 'viewer' } }));
    vi.stubGlobal('fetch', fetchMock);

    await acceptWorkspaceInvitation('raw-token-abc', CSRF);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/workspace/invitations/accept');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(CSRF);
    expect(init.body).toBe(JSON.stringify({ token: 'raw-token-abc' }));
  });

  it('removeWorkspaceMember sends DELETE with X-CSRF-Token', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await removeWorkspaceMember('user-456', CSRF);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/workspace/members/user-456');
    expect(init.method).toBe('DELETE');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(CSRF);
  });

  it('updateWorkspaceMemberRole sends PATCH with X-CSRF-Token', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await updateWorkspaceMemberRole('user-456', 'editor', CSRF);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/workspace/members/user-456/role');
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe(CSRF);
    expect(init.body).toBe(JSON.stringify({ role: 'editor' }));
  });

  it('verifyWorkspaceInvitation sends GET to /api/workspace/invitations/verify', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        email: 'alice@acme.com',
        companyName: 'Acme Corp',
        role: 'editor',
        status: 'pending',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await verifyWorkspaceInvitation('raw-token-xyz');
    expect(res.ok).toBe(true);

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('/api/workspace/invitations/verify?token=raw-token-xyz');
  });

  it('correctly partitions invitations into pending vs past/history', () => {
    const now = Date.parse('2026-10-21T12:00:00Z');
    const future = new Date(now + 86400000).toISOString();
    const past = new Date(now - 86400000).toISOString();

    const invitations = [
      { id: '1', email: 'pending@acme.com', role: 'viewer' as const, status: 'pending' as const, expiresAt: future, createdAt: past },
      { id: '2', email: 'revoked@acme.com', role: 'editor' as const, status: 'revoked' as const, expiresAt: future, createdAt: past },
      { id: '3', email: 'accepted@acme.com', role: 'admin' as const, status: 'accepted' as const, expiresAt: future, createdAt: past },
      { id: '4', email: 'expired@acme.com', role: 'viewer' as const, status: 'expired' as const, expiresAt: past, createdAt: past },
      { id: '5', email: 'pending-but-expired@acme.com', role: 'viewer' as const, status: 'pending' as const, expiresAt: past, createdAt: past },
    ];

    const pending = invitations.filter(
      (inv) => inv.status === 'pending' && new Date(inv.expiresAt).getTime() > now,
    );
    const history = invitations.filter(
      (inv) => inv.status !== 'pending' || new Date(inv.expiresAt).getTime() <= now,
    );

    expect(pending).toHaveLength(1);
    expect(pending[0]?.email).toBe('pending@acme.com');

    expect(history).toHaveLength(4);
    expect(history.map((h) => h.email)).toEqual([
      'revoked@acme.com',
      'accepted@acme.com',
      'expired@acme.com',
      'pending-but-expired@acme.com',
    ]);
  });
});
