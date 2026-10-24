import pino from 'pino';
import type { Env } from './env.js';

export type Logger = ReturnType<typeof pino>;

/**
 * Structured JSON logger.
 *
 * - `test` is silent so suites stay readable, and no transport worker is
 *   spawned (transports rely on worker threads, which tests do not need).
 * - `development` gets human-readable output via pino-pretty.
 * - Everywhere else emits newline-delimited JSON for log collectors.
 */
export function createLogger(env: Env): Logger {
  const options: Parameters<typeof pino>[0] = {
    level: env.isTest ? 'silent' : env.logLevel,
    base: { service: 'trustvault-api', env: env.nodeEnv },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Defence in depth: secrets must not appear in logs even if an object is
    // logged wholesale (e.g. a request or a config bag).
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'headers.authorization',
        'headers.cookie',
        'password',
        '*.password',
        'passwordHash',
        '*.passwordHash',
        'secret',
        '*.secret',
        'token',
        '*.token',
        'session',
        '*.session',
      ],
      censor: '[redacted]',
    },
  };

  if (env.isDevelopment) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname,service,env',
        singleLine: true,
      },
    };
  }

  return pino(options);
}
