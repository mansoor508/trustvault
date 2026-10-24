import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { extractRequestOrigin, isAllowedOrigin } from '../src/auth/origin.js';

describe('isAllowedOrigin', () => {
  const clientOrigins = ['https://trustvault-app.onrender.com', 'https://trustvault.example.com'];

  it('allows exact matches from configured clientOrigins', () => {
    expect(isAllowedOrigin('https://trustvault.example.com', clientOrigins)).toBe(true);
    expect(isAllowedOrigin('https://trustvault-app.onrender.com', clientOrigins)).toBe(true);
  });

  it('allows deployed Render frontend instance (trustvault-app-1i2l.onrender.com)', () => {
    expect(isAllowedOrigin('https://trustvault-app-1i2l.onrender.com', clientOrigins)).toBe(true);
    expect(isAllowedOrigin('https://trustvault-app-preview-xyz.onrender.com', clientOrigins)).toBe(true);
  });

  it('allows localhost and 127.0.0.1 for development', () => {
    expect(isAllowedOrigin('http://localhost:5173', clientOrigins)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173', clientOrigins)).toBe(true);
  });

  it('allows GitHub Pages deployments for TrustVault', () => {
    expect(isAllowedOrigin('https://hemanth23534.github.io', clientOrigins)).toBe(true);
  });

  it('rejects arbitrary untrusted origins', () => {
    expect(isAllowedOrigin('https://attacker.example.com', clientOrigins)).toBe(false);
    expect(isAllowedOrigin('https://phishing.site', clientOrigins)).toBe(false);
    expect(isAllowedOrigin('http://insecure-http.example.com', clientOrigins)).toBe(false);
  });

  it('rejects foreign, unrelated services hosted on Render', () => {
    expect(isAllowedOrigin('https://evil-hacker.onrender.com', clientOrigins)).toBe(false);
    expect(isAllowedOrigin('https://some-other-service.onrender.com', clientOrigins)).toBe(false);
    expect(isAllowedOrigin('https://crypto-stealer.onrender.com', clientOrigins)).toBe(false);
  });

  it('rejects subdomain spoofing attempts', () => {
    expect(isAllowedOrigin('https://trustvault-app.onrender.com.attacker.com', clientOrigins)).toBe(false);
    expect(isAllowedOrigin('https://trustvault.attacker.example', clientOrigins)).toBe(false);
  });

  it('handles null, empty, and invalid URLs safely without throwing', () => {
    expect(isAllowedOrigin(undefined, clientOrigins)).toBe(false);
    expect(isAllowedOrigin('', clientOrigins)).toBe(false);
    expect(isAllowedOrigin('not-a-valid-url', clientOrigins)).toBe(false);
    expect(isAllowedOrigin('javascript:alert(1)', clientOrigins)).toBe(false);
  });
});

describe('extractRequestOrigin', () => {
  it('extracts origin from Origin header', () => {
    const req = {
      get: (header: string) => (header.toLowerCase() === 'origin' ? 'https://trustvault-app-1i2l.onrender.com' : undefined),
    } as unknown as Request;

    expect(extractRequestOrigin(req)).toBe('https://trustvault-app-1i2l.onrender.com');
  });

  it('extracts origin from Referer header when Origin is absent', () => {
    const req = {
      get: (header: string) =>
        header.toLowerCase() === 'referer' ? 'https://trustvault-app-1i2l.onrender.com/documents/new?query=1' : undefined,
    } as unknown as Request;

    expect(extractRequestOrigin(req)).toBe('https://trustvault-app-1i2l.onrender.com');
  });

  it('prefers Origin over Referer if both are present', () => {
    const req = {
      get: (header: string) => {
        if (header.toLowerCase() === 'origin') return 'https://trustvault-app-1i2l.onrender.com';
        if (header.toLowerCase() === 'referer') return 'https://other-referer.com/page';
        return undefined;
      },
    } as unknown as Request;

    expect(extractRequestOrigin(req)).toBe('https://trustvault-app-1i2l.onrender.com');
  });

  it('returns undefined when neither Origin nor Referer is present', () => {
    const req = {
      get: () => undefined,
    } as unknown as Request;

    expect(extractRequestOrigin(req)).toBeUndefined();
  });
});
