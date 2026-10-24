# Architecture

Day 1 establishes the skeleton. Everything here is intentionally small, but the
boundaries are the ones the next four days will build on.

---

## 1. Process view

```
┌──────────────────┐        HTTPS + cookies        ┌───────────────────────┐
│  React SPA       │ ────────────────────────────► │  Express 5 API        │
│  (static host)   │ ◄──────────────────────────── │  (Node 22)            │
└──────────────────┘   JSON + X-Request-Id         └───────────┬───────────┘
                                                               │
                                        ┌──────────────────────┼──────────────────────┐
                                        ▼                      ▼                      ▼
                                 ┌─────────────┐        ┌─────────────┐        ┌─────────────┐
                                 │  MySQL 8    │        │  private    │        │  stdout     │
                                 │  users,     │        │  storage/   │        │  pino JSON  │
                                 │  sessions,  │        │  (0700)     │        │  logs       │
                                 │  schema_    │        └─────────────┘        └─────────────┘
                                 │  migrations │
                                 └─────────────┘
```

Two deployables, one repository. The SPA is static output; the API is a Node
process with no filesystem assumptions beyond `STORAGE_DIR`.

---

## 2. Request lifecycle

Middleware order in `server/src/app.ts` is a security decision, not an accident:

| # | Layer | Why it is here |
|---|-------|----------------|
| 1 | `requestId()` | Before anything logs, so every later line is correlatable |
| 2 | `requestLogger()` | Measures the whole request; logs on `finish`/`close` |
| 3 | `helmet()` | Security headers on every response, including errors |
| 4 | `cors()` | Rejects unlisted browser origins before parsing a body |
| 5 | `express.json()` | 64 kb ceiling, `strict: true` |
| 6 | `express.urlencoded()` | 16 kb ceiling, `extended: false` (no nested-object tricks) |
| 7 | routes | `/`, `/api/health`, … |
| 8 | `notFoundHandler()` | Produces the standard 404 envelope |
| 9 | `createErrorHandler()` | Single exit point for every failure |

Errors thrown synchronously **or** from an async handler land in the error
handler; Express 5 propagates rejected promises automatically, so no
`asyncHandler` wrapper is needed.

### Health endpoints are split on purpose

- `/api/health` — liveness: process only.
- `/api/health/database` — readiness: one `SELECT 1`, 2 s ceiling, 503 on failure.

If both were one endpoint, a 30-second MySQL failover would restart every API
instance and turn a blip into an outage.

---

## 3. Module map (server)

```
src/
├── app.ts                 createApp(deps) — pure composition, no listening
├── index.ts               boot: env → logger → storage → HTTP server → shutdown
├── config/
│   ├── env.ts             Zod schema, origin normalization, env-file loading
│   ├── logger.ts          pino + redaction; silent in tests
│   └── service-info.ts    name/version/prefix constants
├── db/
│   ├── pool.ts            mysql2 pool, singleton, readiness probe
│   ├── migrate.ts         runner: lock, checksums, apply, status
│   └── migration-files.ts pure helpers: discovery, checksum, splitting, planning
├── http/
│   ├── errors.ts          AppError / NotFoundError
│   ├── middleware/        request-id, request-logger, not-found, error-handler
│   └── routes/health.ts   liveness + readiness router
├── storage/
│   └── private-storage.ts directory creation, path containment
├── scripts/migrate.ts     CLI (up | status, --dry-run)
└── types/express.d.ts     req.id typing
```

`createApp()` takes its dependencies (`env`, `logger`, `pingDatabase`) instead of
importing them. That is what lets the test suite exercise real HTTP behaviour
without a MySQL server.

---

## 4. Configuration

Precedence, highest first:

1. Real process environment (host, CI, container).
2. `server/.env`.
3. `.env` at the repository root.

dotenv never overrides an existing variable, so a platform's env vars always win
over a stray local file.

`parseEnv()` is a **pure** function (raw object in, typed `Env` out), which is why
the guardrails are unit-testable: production rejects placeholder secrets, empty
database passwords, wildcard origins and `localhost` origins. All failures are
collected and reported in one message.

`Env` is a nested, readonly domain object (`env.database.host`,
`env.session.ttlHours`) rather than a bag of strings, so call sites cannot drift.

---

## 5. Database and migrations

- One pool per process (`getPool`), closed on `SIGINT`/`SIGTERM`.
- `multipleStatements: false`, named placeholders, UTC (`timezone: 'Z'`).
- Forward-only migrations with SHA-256 checksums.
- Advisory lock (`GET_LOCK`) held on a dedicated connection for the whole run.
- No `down` command. Fixes are new files.
- Statement splitting is a small state machine that understands quotes,
  backticks and comments; MySQL DDL cannot be transactional, so the runner
  reports which statement failed and refuses to record a checksum for it.

Migrations are **not** run at boot. A release step runs them; this keeps two
instances from racing and keeps a bad deploy from mutating the schema.

---

## 6. Error taxonomy

```
                     ┌──────────────────────────────┐
   thrown anywhere → │ createErrorHandler(normalize) │ → response
                     └──────────────────────────────┘
        AppError ──────────────► status + safe message + details
        ZodError ──────────────► 422 + field list
        body-parser ───────────► 400 / 413 / 415 + fixed message
        mysql2 codes ──────────► 409 / 503 + fixed message
        everything else ───────► 500 (generic in prod, described in dev)
```

Rules:

- A message is returned only when `expose` is true (4xx app errors).
- 5xx bodies never contain stack traces, SQL, paths or driver messages.
- The request id ties the response to the log entry with the full error.

---

## 7. Client architecture

- `lib/api.ts` is the only place that knows the API exists: base-URL
  normalization, timeouts (`AbortController`), `credentials: 'include'`,
  `X-Request-Id` extraction, typed errors.
- `App.tsx` holds three UI states per check: `loading`, `ready`, `failed`. A 503
  readiness response is `ready` + `ok: false` — an expected answer, not an
  exception.
- No global state library, no router yet: two endpoints do not justify them. A
  router arrives with auth on Day 2.
- Styling is one self-contained CSS file with no external fonts or assets, so the
  static build has no third-party runtime dependency.

---

## 8. Decisions and trade-offs

| Decision | Alternative | Why |
|----------|-------------|-----|
| Express 5 | Fastify / Hono | Team familiarity; native async error propagation |
| Raw mysql2 + SQL | Prisma / Drizzle | Transparent SQL for a security demo; no codegen step under time pressure |
| Forward-only migrations | Full up/down | Removes the "one command drops prod" failure mode |
| Env-var secrets | Vault/KMS | Hackathon scope; redaction + production guards compensate |
| Files on disk | S3 | Zero cost and clearly private; abstracted behind `STORAGE_DIR` for later |
| MySQL sessions | Signed JWT | Instant revocation and server-side expiry are worth a row lookup |
| Vitest + Supertest | Jest | Single toolchain across client and server; real HTTP tests |
| No ORM | ORM | Every query in the demo is small and explicit |

---

## 9. Extension points (days 2–5)

| Feature | Where it plugs in |
|---------|-------------------|
| Auth | `src/http/routes/auth.ts`, `src/services/auth.ts`, `cookie-parser`, bcrypt cost 12 |
| Session lookup | `sessions` table (already migrated) + `requireSession` middleware |
| CSRF | Per-session token column + `X-CSRF-Token` on state-changing routes |
| Uploads | `multer`/busboy → `STORAGE_DIR` with generated names, MIME sniffing, size cap |
| Authorization | Ownership predicates on every document/share query |
| Audit | Append-only `audit_events` table + one helper called from services |
| Rate limiting | `express-rate-limit` keyed by IP and account, mounted before auth routes |
| Background cleanup | Scheduled job deleting expired sessions and orphaned files |

---

## 10. Scaling notes (not needed for the demo, documented anyway)

- The API is stateless except for MySQL and storage → horizontal scaling is easy.
- Session lookups need an index on `token_hash` (unique, exists).
- Health probes must stay cheap; if the pool saturates, readiness fails before
  latency does.
- Migrations take the advisory lock, so rolling deploys serialize schema changes.
