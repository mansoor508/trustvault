import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDocumentsQuery,
  canManageDocument,
  formatBytes,
  sanitizeDownloadName,
  updateDocument,
  uploadDocument,
  type DocumentItem,
} from './documents';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-test-1' },
  });
}

function sampleDocument(overrides: Partial<DocumentItem> = {}): DocumentItem {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    owner: { id: 'u1', email: 'owner@trustvault.local', displayName: 'Owen Owner' },
    title: 'Report',
    description: null,
    fileName: 'report.pdf',
    category: 'report',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    checksumSha256: null,
    status: 'active',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    access: { mode: 'owner', permissionRole: null },
    ...overrides,
  };
}

describe('buildDocumentsQuery', () => {
  it('returns an empty string when nothing is set', () => {
    expect(buildDocumentsQuery({})).toBe('');
    expect(buildDocumentsQuery({ search: '   ', category: '' })).toBe('');
  });

  it('includes only the filters that have values', () => {
    const query = buildDocumentsQuery({
      search: 'quarterly report',
      category: 'contract',
      from: '2026-10-01',
      to: '2026-10-20',
      limit: 25,
      offset: 50,
    });

    const params = new URLSearchParams(query);
    expect(query.startsWith('?')).toBe(true);
    expect(params.get('search')).toBe('quarterly report');
    expect(params.get('category')).toBe('contract');
    expect(params.get('from')).toBe('2026-10-01');
    expect(params.get('to')).toBe('2026-10-20');
    expect(params.get('limit')).toBe('25');
    expect(params.get('offset')).toBe('50');
    expect(params.has('owner')).toBe(false);
    expect(params.has('sort')).toBe(false);
  });

  it('trims the search term and keeps the owner filter', () => {
    const params = new URLSearchParams(buildDocumentsQuery({ search: '  tax  ', owner: 'a@b.co' }));
    expect(params.get('search')).toBe('tax');
    expect(params.get('owner')).toBe('a@b.co');
  });
});

describe('formatBytes', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatBytes(15 * 1024 * 1024 * 1024)).toBe('15 GB');
  });

  it('handles invalid input', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});

describe('sanitizeDownloadName', () => {
  it('strips path components and control characters', () => {
    expect(sanitizeDownloadName('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(sanitizeDownloadName('folder\\report.pdf')).toBe('report.pdf');
    expect(sanitizeDownloadName('re\u0000port.pdf')).toBe('report.pdf');
  });

  it('falls back to a safe name', () => {
    expect(sanitizeDownloadName('   ')).toBe('document');
    expect(sanitizeDownloadName('')).toBe('document');
  });
});

describe('permission helpers', () => {
  it('treats non-viewers as managers', () => {
    expect(canManageDocument(sampleDocument())).toBe(true);
    expect(
      canManageDocument(sampleDocument({ access: { mode: 'admin', permissionRole: null } })),
    ).toBe(true);
    expect(
      canManageDocument(sampleDocument({ access: { mode: 'viewer', permissionRole: 'viewer' } })),
    ).toBe(false);
  });
});

describe('uploadDocument', () => {
  it('posts multipart form data with a CSRF header and no manual content type', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ document: sampleDocument() }, 201));
    vi.stubGlobal('fetch', fetchMock);

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'report.pdf', {
      type: 'application/pdf',
    });

    const result = await uploadDocument(
      { file, title: ' Quarterly ', description: ' notes ', category: 'report' },
      'csrf-token-value',
    );

    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('csrf-token-value');
    expect(new Headers(init.headers).get('content-type')).toBeNull();

    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('title')).toBe('Quarterly');
    expect(body.get('category')).toBe('report');
    expect(body.get('file')).toBeInstanceOf(File);
  });
});

describe('updateDocument', () => {
  it('sends a PATCH with the CSRF token and JSON body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ document: sampleDocument({ title: 'New' }) }));
    vi.stubGlobal('fetch', fetchMock);

    await updateDocument('doc-1', { title: 'New', category: 'invoice' }, 'csrf-token-value');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/documents/doc-1');
    expect(init.method).toBe('PATCH');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('csrf-token-value');
    expect(JSON.parse(String(init.body))).toEqual({ title: 'New', category: 'invoice' });
  });
});
