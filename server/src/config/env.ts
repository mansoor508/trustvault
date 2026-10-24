import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
// `src/config` during development and `dist/config` after a build are the same
// depth, so these two resolutions hold for both.
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(MODULE_DIR, '..', '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type SameSitePolicy = 'lax' | 'strict' | 'none';

export interface Env {
  readonly nodeEnv: NodeEnv;
  readonly isDevelopment: boolean;
  readonly isTest: boolean;
  readonly isProduction: boolean;
  readonly port: number;
  readonly host: string;
  /** Number of reverse-proxy hops Express should trust. */
  readonly trustProxy: number;
  readonly logLevel: LogLevel;
  /** Exact browser origins allowed to call the API with credentials. */
  readonly clientOrigins: readonly string[];
  readonly session: {
    readonly secret: string;
    readonly cookieName: string;
    readonly ttlHours: number;
    /** A session unused for this long is rejected even if not expired. */
    readonly idleMinutes: number;
    readonly sameSite: SameSitePolicy;
    /** Secure cookies are mandatory in production. */
    readonly secure: boolean;
  };
  readonly security: {
    readonly bcryptCost: number;
    readonly loginRateLimitMax: number;
    readonly loginRateLimitWindowMinutes: number;
    readonly maxFailedLoginAttempts: number;
    readonly lockMinutes: number;
  };
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly name: string;
    readonly connectionLimit: number;
    readonly ssl?: boolean;
    readonly sslRejectUnauthorized?: boolean;
  };
  readonly storage?: {
    readonly driver: 'fs' | 'r2';
    readonly storageDir?: string;
    readonly r2?: {
      readonly accountId: string;
      readonly accessKeyId: string;
      readonly secretAccessKey: string;
      readonly bucketName: string;
      readonly endpoint?: string;
    };
  };
  /** Absolute path to private, git-ignored document storage. */
  readonly storageDir: string;
  readonly maxUploadBytes: number;
  /** Base frontend URL used to format invitation acceptance links. */
  readonly frontendUrl: string;
}

export interface EnvIssue {
  path: string;
  message: string;
}

export class EnvValidationError extends Error {
  readonly issues: EnvIssue[];

  constructor(issues: EnvIssue[]) {
    const detail = issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n');
    super(
      `Invalid environment configuration:\n${detail}\n\n` +
        'Fix the values in your .env file (see .env.example) and try again.',
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

export interface LoadedEnv {
  env: Env;
  warnings: string[];
  /** Absolute paths of the .env files that were actually read. */
  loadedFiles: string[];
}

// ---------------------------------------------------------------------------
// Validation primitives
// ---------------------------------------------------------------------------
const numeric = (min: number, max: number, fallback: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

/**
 * Substrings that signal a copied template value rather than real entropy.
 * These are fatal when NODE_ENV=production and produce a warning otherwise.
 */
const PLACEHOLDER_PATTERN =
  /(change[-_ ]?me|placeholder|replace[-_ ]?me|your[-_ ]?secret|example|dev[-_ ]?only|secret[-_ ]?key|changethis|todo)/i;

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

const REQUIRED_KEYS = ['SESSION_SECRET'] as const;

export function isPlaceholderSecret(secret: string): boolean {
  return PLACEHOLDER_PATTERN.test(secret);
}

export function splitOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * Accepts only an exact http(s) origin: no credentials, path, query or hash.
 * `https://app.example.com/` normalizes to `https://app.example.com`.
 */
export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username !== '' || url.password !== '') return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    if (url.search !== '' || url.hash !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),

    PORT: numeric(1, 65_535, 4000),
    HOST: z.string().min(1).default('0.0.0.0'),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

    CLIENT_ORIGINS: z.string().min(1).default('http://localhost:5173'),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters long'),
    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]{3,64}$/, 'SESSION_COOKIE_NAME must be 3-64 characters of [A-Za-z0-9_-]')
      .default('tv_session'),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
    SESSION_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    BCRYPT_COST: z.coerce.number().int().min(10).max(14).default(12),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(10),
    LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).max(50).default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    DATABASE_HOST: z.string().min(1).default('127.0.0.1'),
    DATABASE_PORT: numeric(1, 65_535, 3306),
    DATABASE_USER: z.string().min(1).default('trustvault'),
    DATABASE_PASSWORD: z.string().default(''),
    DATABASE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_]{1,64}$/, 'DATABASE_NAME must be 1-64 characters of [A-Za-z0-9_]')
      .default('trustvault'),
    DATABASE_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
    DATABASE_SSL: z
      .string()
      .optional()
      .transform((val) => {
        if (val === undefined) return undefined;
        return val === 'true' || val === '1' || val === 'require';
      }),
    DATABASE_SSL_REJECT_UNAUTHORIZED: z
      .string()
      .optional()
      .transform((val) => val !== 'false' && val !== '0'),

    COOKIE_SECURE: z
      .string()
      .optional()
      .transform((val) => {
        if (val === undefined) return undefined;
        return val === 'true' || val === '1';
      }),

    STORAGE_DRIVER: z.enum(['fs', 'r2']).default('fs'),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET_NAME: z.string().optional(),
    R2_ENDPOINT: z.string().optional(),

    STORAGE_DIR: z.string().min(1).default('./storage'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(104_857_600).default(10_485_760),
    FRONTEND_URL: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    const origins = splitOrigins(value.CLIENT_ORIGINS);

    if (origins.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CLIENT_ORIGINS'],
        message: 'CLIENT_ORIGINS must list at least one origin (comma-separated)',
      });
    }

    for (const raw of origins) {
      if (raw.includes('*')) {
        ctx.addIssue({
          code: 'custom',
          path: ['CLIENT_ORIGINS'],
          message: `Wildcard origins are not allowed ("${raw}"). List exact origins instead.`,
        });
        continue;
      }
      if (normalizeOrigin(raw) === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['CLIENT_ORIGINS'],
          message: `"${raw}" is not a bare http(s) origin (expected e.g. https://app.example.com, no path or query)`,
        });
      }
    }

    if (value.NODE_ENV !== 'production') return;

    if (isPlaceholderSecret(value.SESSION_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message:
          'SESSION_SECRET looks like a copied placeholder. Generate one with: ' +
          'node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"',
      });
    }

    if (isBlank(value.DATABASE_PASSWORD)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_PASSWORD'],
        message: 'DATABASE_PASSWORD must be set in production; passwordless database users are not allowed',
      });
    }

    for (const origin of origins) {
      if (isLocalOrigin(origin)) {
        ctx.addIssue({
          code: 'custom',
          path: ['CLIENT_ORIGINS'],
          message: `Local origin "${origin}" is not allowed when NODE_ENV=production`,
        });
      }
    }
  });

type RawEnv = z.infer<typeof envSchema>;

function toEnv(parsed: RawEnv): Env {
  const nodeEnv = parsed.NODE_ENV;
  const isCloudHost =
    parsed.DATABASE_HOST.includes('tidbcloud.com') ||
    parsed.DATABASE_HOST.includes('aivencloud.com') ||
    parsed.DATABASE_HOST.includes('neon.tech') ||
    parsed.DATABASE_PORT === 4000;
  const useSsl =
    parsed.DATABASE_SSL !== undefined
      ? parsed.DATABASE_SSL
      : isCloudHost;

  return {
    nodeEnv,
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test',
    isProduction: nodeEnv === 'production',
    port: parsed.PORT,
    host: parsed.HOST,
    trustProxy: parsed.TRUST_PROXY,
    logLevel: parsed.LOG_LEVEL,
    clientOrigins: splitOrigins(parsed.CLIENT_ORIGINS)
      .map((origin) => normalizeOrigin(origin))
      .filter((origin): origin is string => origin !== null),
    session: {
      secret: parsed.SESSION_SECRET,
      cookieName: parsed.SESSION_COOKIE_NAME,
      ttlHours: parsed.SESSION_TTL_HOURS,
      idleMinutes: parsed.SESSION_IDLE_MINUTES,
      sameSite: parsed.SESSION_COOKIE_SAME_SITE,
      // `Secure` over plain HTTP would make the cookie unusable, so it defaults
      // to true in production, while respecting explicit COOKIE_SECURE if provided.
      secure: parsed.COOKIE_SECURE !== undefined ? parsed.COOKIE_SECURE : nodeEnv === 'production',
    },
    security: {
      bcryptCost: parsed.BCRYPT_COST,
      loginRateLimitMax: parsed.LOGIN_RATE_LIMIT_MAX,
      loginRateLimitWindowMinutes: parsed.LOGIN_RATE_LIMIT_WINDOW_MINUTES,
      maxFailedLoginAttempts: parsed.LOGIN_MAX_FAILED_ATTEMPTS,
      lockMinutes: parsed.LOGIN_LOCK_MINUTES,
    },
    database: {
      host: parsed.DATABASE_HOST,
      port: parsed.DATABASE_PORT,
      user: parsed.DATABASE_USER,
      password: parsed.DATABASE_PASSWORD,
      name: parsed.DATABASE_NAME,
      connectionLimit: parsed.DATABASE_CONNECTION_LIMIT,
      ...(useSsl ? { ssl: true, sslRejectUnauthorized: parsed.DATABASE_SSL_REJECT_UNAUTHORIZED !== false } : {}),
    },
    storage: {
      driver: parsed.STORAGE_DRIVER,
      storageDir: path.isAbsolute(parsed.STORAGE_DIR)
        ? path.normalize(parsed.STORAGE_DIR)
        : path.resolve(SERVER_ROOT, parsed.STORAGE_DIR),
      r2:
        parsed.R2_ACCOUNT_ID &&
        parsed.R2_ACCESS_KEY_ID &&
        parsed.R2_SECRET_ACCESS_KEY &&
        parsed.R2_BUCKET_NAME
          ? {
              accountId: parsed.R2_ACCOUNT_ID,
              accessKeyId: parsed.R2_ACCESS_KEY_ID,
              secretAccessKey: parsed.R2_SECRET_ACCESS_KEY,
              bucketName: parsed.R2_BUCKET_NAME,
              endpoint: parsed.R2_ENDPOINT,
            }
          : undefined,
    },
    storageDir: path.isAbsolute(parsed.STORAGE_DIR)
      ? path.normalize(parsed.STORAGE_DIR)
      : path.resolve(SERVER_ROOT, parsed.STORAGE_DIR),
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    frontendUrl:
      parsed.FRONTEND_URL ||
      splitOrigins(parsed.CLIENT_ORIGINS).map(normalizeOrigin).find(Boolean) ||
      'http://localhost:5173',
  };
}

/**
 * Pure validator: turns a raw key/value bag into a typed, immutable Env object.
 * Throws EnvValidationError with every problem it can find at once.
 */
export function parseEnv(raw: Record<string, string | undefined> = process.env): Env {
  const normalizedRaw: Record<string, string | undefined> = {
    ...raw,
    CLIENT_ORIGINS: raw.CLIENT_ORIGINS ?? raw.CLIENT_ORIGIN ?? raw.FRONTEND_URL ?? raw.CLIENT_URL,
    COOKIE_SECURE: raw.COOKIE_SECURE ?? raw.SESSION_COOKIE_SECURE,
    FRONTEND_URL: raw.FRONTEND_URL ?? raw.CLIENT_URL,
  };

  const dbUrl = raw.DATABASE_URL ?? raw.DATABASE_URI ?? raw.TIDB_URL;
  if (dbUrl && isBlank(raw.DATABASE_HOST)) {
    try {
      const parsedUrl = new URL(dbUrl);
      if (parsedUrl.hostname) normalizedRaw.DATABASE_HOST = parsedUrl.hostname;
      if (parsedUrl.port) normalizedRaw.DATABASE_PORT = parsedUrl.port;
      if (parsedUrl.username) normalizedRaw.DATABASE_USER = decodeURIComponent(parsedUrl.username);
      if (parsedUrl.password) normalizedRaw.DATABASE_PASSWORD = decodeURIComponent(parsedUrl.password);
      const dbPath = parsedUrl.pathname.replace(/^\//, '');
      if (dbPath) normalizedRaw.DATABASE_NAME = dbPath;
      if (
        parsedUrl.searchParams.has('ssl') ||
        parsedUrl.protocol === 'mysqls:' ||
        parsedUrl.hostname.includes('tidbcloud.com') ||
        parsedUrl.port === '4000'
      ) {
        normalizedRaw.DATABASE_SSL = 'true';
      }
    } catch {
      // Keep individual vars if URL parsing fails
    }
  }

  const missing = REQUIRED_KEYS.filter((key) => isBlank(normalizedRaw[key]));
  if (missing.length > 0) {
    throw new EnvValidationError(
      missing.map((key) => ({
        path: key,
        message: `${key} is required. Copy .env.example to .env and set a value.`,
      })),
    );
  }

  const result = envSchema.safeParse(normalizedRaw);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join('.') || '(root)',
        message: issue.message,
      })),
    );
  }

  return toEnv(result.data);
}

/** Non-fatal configuration smells, surfaced once at startup. */
export function collectWarnings(env: Env): string[] {
  const warnings: string[] = [];

  if (!env.isProduction && isPlaceholderSecret(env.session.secret)) {
    warnings.push(
      'SESSION_SECRET is still the development placeholder. Generate a real secret before deploying.',
    );
  }
  if (!env.isProduction && env.database.password === '') {
    warnings.push(
      'DATABASE_PASSWORD is empty. This only works for a local passwordless MySQL user; set one for shared or deployed environments.',
    );
  }
  if (!env.isProduction && env.session.sameSite === 'none') {
    warnings.push(
      'SESSION_COOKIE_SAME_SITE=none requires HTTPS and a Secure cookie; browsers drop it on plain-HTTP local development.',
    );
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
/** Candidate .env files, highest precedence first. Real env vars always win. */
export function getEnvFileCandidates(): string[] {
  return [path.join(SERVER_ROOT, '.env'), path.join(REPO_ROOT, '.env')];
}

function loadDotenvFiles(): string[] {
  const loaded: string[] = [];
  for (const candidate of getEnvFileCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    // `override: false` keeps real process env vars authoritative.
    dotenv.config({ path: candidate, override: false, quiet: true });
    loaded.push(candidate);
  }
  return loaded;
}

let cached: LoadedEnv | null = null;

/** Loads .env files (once), validates, and caches the result. */
export function loadEnv(): LoadedEnv {
  if (cached) return cached;
  const loadedFiles = loadDotenvFiles();
  const env = parseEnv(process.env);
  cached = { env, warnings: collectWarnings(env), loadedFiles };
  return cached;
}

/** Test helper: forget the cached environment. */
export function resetEnvCache(): void {
  cached = null;
}
