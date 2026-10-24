import { parseEnv, type Env } from '../../src/config/env.js';
import { createLogger } from '../../src/config/logger.js';

/**
 * Baseline env for tests. Uses NODE_ENV=test so the logger is silent and the
 * production-only guards stay off unless a test opts in.
 */
const BASE_TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  CLIENT_ORIGINS: 'http://localhost:5173',
  SESSION_SECRET: 'test-session-secret-value-0123456789abcdef',
  DATABASE_PASSWORD: 'test-password',
};

export function testEnv(overrides: Record<string, string | undefined> = {}): Env {
  return parseEnv({ ...BASE_TEST_ENV, ...overrides });
}

export function testLogger(env: Env = testEnv()): ReturnType<typeof createLogger> {
  return createLogger(env);
}

/** A 32-byte hex secret that cannot trip the placeholder heuristic. */
export const STRONG_SECRET = '9f4c1e7a2b8d3f5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e';
