import { describe, expect, it } from 'vitest';
import { ApiError, buildUrl, DEFAULT_API_BASE_URL, normalizeBaseUrl } from './api';

describe('normalizeBaseUrl', () => {
  it('falls back to the local API when unset or blank', () => {
    expect(normalizeBaseUrl(undefined)).toBe(DEFAULT_API_BASE_URL);
    expect(normalizeBaseUrl('')).toBe(DEFAULT_API_BASE_URL);
    expect(normalizeBaseUrl('   ')).toBe(DEFAULT_API_BASE_URL);
  });

  it('trims whitespace and strips trailing slashes', () => {
    expect(normalizeBaseUrl('  https://api.example.com/  ')).toBe('https://api.example.com');
    expect(normalizeBaseUrl('https://api.example.com///')).toBe('https://api.example.com');
  });

  it('keeps a path prefix intact', () => {
    expect(normalizeBaseUrl('https://example.com/vault/')).toBe('https://example.com/vault');
  });
});

describe('buildUrl', () => {
  it('joins base and path without doubling slashes', () => {
    expect(buildUrl('http://localhost:4000', '/api/health')).toBe('http://localhost:4000/api/health');
    expect(buildUrl('http://localhost:4000/', 'api/health')).toBe('http://localhost:4000/api/health');
    expect(buildUrl('https://api.example.com///', '/api/health/database')).toBe(
      'https://api.example.com/api/health/database',
    );
  });
});

describe('ApiError', () => {
  it('keeps the status, code and request id for support hand-offs', () => {
    const error = new ApiError('nope', { status: 503, code: 'SERVICE_UNAVAILABLE', requestId: 'req-123' });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.status).toBe(503);
    expect(error.code).toBe('SERVICE_UNAVAILABLE');
    expect(error.requestId).toBe('req-123');
  });

  it('defaults the request id to null', () => {
    expect(new ApiError('nope').requestId).toBeNull();
  });
});
