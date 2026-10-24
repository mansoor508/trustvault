import { describe, expect, it } from 'vitest';
import {
  collectWarnings,
  EnvValidationError,
  normalizeOrigin,
  parseEnv,
  splitOrigins,
} from '../src/config/env.js';
import { STRONG_SECRET } from './support/test-env.js';

const MINIMAL = { SESSION_SECRET: STRONG_SECRET };

const PRODUCTION = {
  NODE_ENV: 'production',
  SESSION_SECRET: STRONG_SECRET,
  CLIENT_ORIGINS: 'https://trustvault.app',
  DATABASE_PASSWORD: 'a-real-production-password',
};

function expectEnvError(raw: Record<string, string | undefined>): EnvValidationError {
  try {
    parseEnv(raw);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return error as EnvValidationError;
  }
  throw new Error('Expected parseEnv to throw EnvValidationError');
}

describe('parseEnv', () => {
  it('applies safe development defaults', () => {
    const env = parseEnv(MINIMAL);

    expect(env.nodeEnv).toBe('development');
    expect(env.isDevelopment).toBe(true);
    expect(env.isProduction).toBe(false);
    expect(env.port).toBe(4000);
    expect(env.host).toBe('0.0.0.0');
    expect(env.trustProxy).toBe(0);
    expect(env.logLevel).toBe('info');
    expect(env.clientOrigins).toEqual(['http://localhost:5173']);
    expect(env.session.cookieName).toBe('tv_session');
    expect(env.session.ttlHours).toBe(12);
    expect(env.database).toEqual({
      host: '127.0.0.1',
      port: 3306,
      user: 'trustvault',
      password: '',
      name: 'trustvault',
      connectionLimit: 10,
    });
    expect(env.maxUploadBytes).toBe(10_485_760);
  });

  it('resolves STORAGE_DIR to an absolute path inside the server workspace', () => {
    const env = parseEnv(MINIMAL);

    expect(env.storageDir).toMatch(/storage$/);
    expect(env.storageDir).toMatch(/^([A-Za-z]:\\|\/)/);
  });

  it('coerces numeric strings and accepts an explicit origin list', () => {
    const env = parseEnv({
      ...MINIMAL,
      PORT: '8080',
      TRUST_PROXY: '1',
      DATABASE_PORT: '3307',
      DATABASE_CONNECTION_LIMIT: '4',
      SESSION_TTL_HOURS: '48',
      MAX_UPLOAD_BYTES: '2048',
      CLIENT_ORIGINS: 'https://app.example.com/, https://admin.example.com ',
    });

    expect(env.port).toBe(8080);
    expect(env.trustProxy).toBe(1);
    expect(env.database.port).toBe(3307);
    expect(env.database.connectionLimit).toBe(4);
    expect(env.session.ttlHours).toBe(48);
    expect(env.maxUploadBytes).toBe(2048);
    expect(env.clientOrigins).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  it('accepts CLIENT_ORIGIN or FRONTEND_URL as an alias for CLIENT_ORIGINS', () => {
    const env = parseEnv({
      ...MINIMAL,
      CLIENT_ORIGIN: 'https://trustvault-app.onrender.com',
    });
    expect(env.clientOrigins).toEqual(['https://trustvault-app.onrender.com']);
  });

  it('parses DATABASE_URL connection string and sets SSL for cloud hosts', () => {
    const env = parseEnv({
      ...MINIMAL,
      DATABASE_URL: 'mysql://root_user:myPassword123@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/trustvault',
    });

    expect(env.database.host).toBe('gateway01.us-east-1.prod.aws.tidbcloud.com');
    expect(env.database.port).toBe(4000);
    expect(env.database.user).toBe('root_user');
    expect(env.database.password).toBe('myPassword123');
    expect(env.database.name).toBe('trustvault');
    expect(env.database.ssl).toBe(true);
  });

  it('allows explicit COOKIE_SECURE setting', () => {
    const devSecure = parseEnv({
      ...MINIMAL,
      COOKIE_SECURE: 'true',
    });
    expect(devSecure.session.secure).toBe(true);

    const devInsecure = parseEnv({
      ...MINIMAL,
      COOKIE_SECURE: 'false',
    });
    expect(devInsecure.session.secure).toBe(false);
  });

  it('requires SESSION_SECRET with an actionable message', () => {
    const error = expectEnvError({});

    expect(error.issues).toHaveLength(1);
    expect(error.issues[0]?.path).toBe('SESSION_SECRET');
    expect(error.message).toContain('SESSION_SECRET');
  });

  it('rejects a short SESSION_SECRET', () => {
    const error = expectEnvError({ SESSION_SECRET: 'too-short' });

    expect(error.issues.some((issue) => issue.path === 'SESSION_SECRET')).toBe(true);
  });

  it.each(['abc', '0', '70000'])('rejects an invalid PORT (%s)', (port) => {
    const error = expectEnvError({ ...MINIMAL, PORT: port });

    expect(error.issues.some((issue) => issue.path === 'PORT')).toBe(true);
  });

  it('rejects wildcard and non-origin CLIENT_ORIGINS values', () => {
    const wildcard = expectEnvError({ ...MINIMAL, CLIENT_ORIGINS: '*' });
    expect(wildcard.message).toContain('Wildcard origins are not allowed');

    const withPath = expectEnvError({ ...MINIMAL, CLIENT_ORIGINS: 'https://app.example.com/login' });
    expect(withPath.message).toContain('not a bare http(s) origin');

    const notAUrl = expectEnvError({ ...MINIMAL, CLIENT_ORIGINS: 'localhost:5173' });
    expect(notAUrl.message).toContain('not a bare http(s) origin');
  });

  it('rejects an empty CLIENT_ORIGINS list', () => {
    const error = expectEnvError({ ...MINIMAL, CLIENT_ORIGINS: ' , ' });

    expect(error.message).toContain('at least one origin');
  });

  it('rejects an unsafe DATABASE_NAME', () => {
    const error = expectEnvError({ ...MINIMAL, DATABASE_NAME: 'trustvault; DROP DATABASE mysql' });

    expect(error.issues.some((issue) => issue.path === 'DATABASE_NAME')).toBe(true);
  });

  it('accepts a fully specified production configuration', () => {
    const env = parseEnv(PRODUCTION);

    expect(env.isProduction).toBe(true);
    expect(env.clientOrigins).toEqual(['https://trustvault.app']);
  });

  it('rejects placeholder secrets in production', () => {
    const error = expectEnvError({
      ...PRODUCTION,
      SESSION_SECRET: 'dev-only-placeholder-session-secret-change-me-0001',
    });

    expect(error.message).toContain('looks like a copied placeholder');
  });

  it('rejects an empty database password in production', () => {
    const error = expectEnvError({ ...PRODUCTION, DATABASE_PASSWORD: '' });

    expect(error.message).toContain('DATABASE_PASSWORD must be set in production');
  });

  it('rejects local origins in production', () => {
    const error = expectEnvError({
      ...PRODUCTION,
      CLIENT_ORIGINS: 'https://trustvault.app,http://localhost:5173',
    });

    expect(error.message).toContain('Local origin');
  });

  it('collects every issue at once instead of failing on the first', () => {
    const error = expectEnvError({
      NODE_ENV: 'production',
      SESSION_SECRET: 'change-me',
      CLIENT_ORIGINS: 'http://localhost:5173',
      DATABASE_PASSWORD: '',
    });

    expect(error.issues.length).toBeGreaterThanOrEqual(3);
  });

  it('resolves frontendUrl from FRONTEND_URL or CLIENT_ORIGINS default', () => {
    const defaultEnv = parseEnv(MINIMAL);
    expect(defaultEnv.frontendUrl).toBe('http://localhost:5173');

    const customEnv = parseEnv({
      ...MINIMAL,
      FRONTEND_URL: 'https://vault.company.com',
    });
    expect(customEnv.frontendUrl).toBe('https://vault.company.com');
  });
});

describe('collectWarnings', () => {
  it('warns about development placeholders', () => {
    const env = parseEnv({
      SESSION_SECRET: 'dev-only-placeholder-session-secret-change-me-0001',
    });
    const warnings = collectWarnings(env);

    expect(warnings.some((warning) => warning.includes('development placeholder'))).toBe(true);
    expect(warnings.some((warning) => warning.includes('DATABASE_PASSWORD is empty'))).toBe(true);
  });

  it('stays quiet for a fully configured production environment', () => {
    expect(collectWarnings(parseEnv(PRODUCTION))).toEqual([]);
  });
});

describe('normalizeOrigin', () => {
  it('keeps bare http(s) origins and strips trailing slashes', () => {
    expect(normalizeOrigin('https://app.example.com')).toBe('https://app.example.com');
    expect(normalizeOrigin('https://app.example.com/')).toBe('https://app.example.com');
    expect(normalizeOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('rejects anything that is not a bare origin', () => {
    expect(normalizeOrigin('ftp://app.example.com')).toBeNull();
    expect(normalizeOrigin('https://app.example.com/login')).toBeNull();
    expect(normalizeOrigin('https://app.example.com?x=1')).toBeNull();
    expect(normalizeOrigin('https://user:pass@app.example.com')).toBeNull();
    expect(normalizeOrigin('app.example.com')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
  });
});

describe('splitOrigins', () => {
  it('trims entries and drops blanks', () => {
    expect(splitOrigins(' https://a.example.com , ,https://b.example.com ')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
    expect(splitOrigins('')).toEqual([]);
  });
});
