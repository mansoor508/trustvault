# TrustVault

**Secure document sharing for teams.** Private document storage, real
server-side sessions, and share links that expire — built in five days for the
Snovasys hackathon.

> **Day 5 of 5 — production-ready submission complete.** All five phases are delivered:
> React 19 SPA, Express 5 API, TiDB Cloud Serverless database with 7 forward-only migrations,
> document-level permissions with instant revocation, tamper-evident hash-chained
> audit logs, administrative governance, and an independent application security review
> with confirmed fixes and regression tests.

![stack](https://img.shields.io/badge/stack-Node%2022%20%C2%B7%20Express%205%20%C2%B7%20React%2019%20%C2%B7%20TiDB%20Cloud%20%C2%B7%20Render-0b1220)
![tests](https://img.shields.io/badge/tests-307%20passed%20(23%20suites)-0b1220)
![license](https://img.shields.io/badge/license-MIT-green)

🌐 **Live Deployment**:
- **Frontend App**: [https://trustvault-app-1i2l.onrender.com](https://trustvault-app-1i2l.onrender.com) (Render Static Site)
- **Backend API**: `https://trustvault-api-0dl0.onrender.com` (Render Web Service `trustvault-api`)
- **Database**: TiDB Cloud Serverless (MySQL-compatible distributed SQL with TLS/SSL)
- **GitHub Repository**: [https://github.com/Hemanth23534/trustvault](https://github.com/Hemanth23534/trustvault)

---

## Demo Login Credentials

For testing and evaluating TrustVault's role-based access control, document sharing, and administrative governance, pre-configured demo accounts are provided:

| Role | Email Address | Password | Permissions & Intended Use |
|------|---------------|----------|----------------------------|
| **Workspace Owner** | `owner@trustvault.local` | `TrustVault2026!` | Full workspace control: upload documents, manage company members, invite users, update member roles, and configure workspace settings. |
| **Platform Administrator** | `admin@trustvault.local` | `TrustVault2026!` | System governance: access tamper-evident audit logs (`/admin`), verify SHA-256 hash chains, create checkpoints, and manage user statuses. *(Zero access to company documents)* |
| **Viewer** | `viewer@trustvault.local` | `TrustVault2026!` | Read-only access: view metadata and download only documents explicitly shared with this account. |

> [!IMPORTANT]
> **Testing and Demo Purposes Only**:
> - These credentials are provided strictly for testing, local evaluation, and demonstration.
> - Passwords in the database are hashed with bcrypt (cost factor 12) and are never stored in plaintext.
> - Real users should never use these credentials. Production organizations self-register securely at `/register` or join via workspace invitations (`?invite=<token>`).
> - To provision or update demo accounts locally, run: `npm run seed --workspace @trustvault/server`.

---

## What exists today

| Area | Status |
|------|--------|
| React 19 + TypeScript + Vite client | ✅ 12 pages (login, register, workspace management, dashboards, detail, share, audit, history) |
| Express 5 + TypeScript API | ✅ health, auth, workspace, documents, permissions, insights, admin |
| Validated environment (Zod, fail-fast) | ✅ rejects placeholder secrets in production, supports cloud SSL |
| MySQL 8 / TiDB Cloud connection pool (`mysql2`) | ✅ UTC, named placeholders, SSL/TLS, no stacked queries |
| Forward-only migration runner | ✅ 7 migrations, checksums, advisory lock, dry-run |
| Helmet, CORS allow-list, request IDs | ✅ tested across all endpoints, strict origin matching |
| Centralised error handling | ✅ sanitized JSON envelope, zero stack/SQL leakage |
| Private storage directory | ✅ outside web root, mode `0700`/`0600`, magic byte check |
| Auth (bcrypt + MySQL sessions) | ✅ HttpOnly/SameSite/Secure, CSRF, dual-tier rate limiting |
| Document permissions & sharing | ✅ owner/admin/editor/viewer, immediate revocation, admin isolation |
| Tamper-evident audit trail & admin | ✅ SHA-256 hash chaining, DB triggers, admin dashboard |
| Independent security review & fixes | ✅ 13 categories evaluated, 3 fixed, 1 documented residual |
| Public self-registration | ✅ Personal accounts or Company Workspaces with unique tenant IDs |
| Multi-tenant company workspaces | ✅ Complete isolation on docs, members & audit logs (Migration 0006 & 0007) |
| Team invitations & role management | ✅ Token-based invites (`?invite=...`), member removal, role updates |
| Password reset & email verification | ℹ️ Planned roadmap (documented token spec; requires external SMTP) |

### Account Model & Production Readiness Status

| Feature | Status | Implementation Details |
|---|---|---|
| Operator-seeded Demo Accounts | ✅ Implemented | `admin`, `owner`, `viewer` provisioned via `npm run seed`; refused in production unless `SEED_ALLOW_PRODUCTION=true` |
| Password Hashing & Salt | ✅ Implemented | bcrypt (cost factor 12), constant-time comparisons, dummy-hash timing attack protection |
| Server-side Sessions & CSRF | ✅ Implemented | HttpOnly, SameSite=Lax, Secure in production; per-session synchronizer CSRF tokens on mutating requests |
| Dual-tier Rate Limiting | ✅ Implemented | Tier-1 global per-IP ceiling (spray prevention) + Tier-2 per-(IP+email) account brute-force protection |
| Document Permissions & Revocation | ✅ Implemented | Row-level checks on every request; zero caching latency; immediate 404 on revocation; admin file isolation |
| Public Registration & Workspaces | ✅ Implemented | Public self-service registration; choose Personal Workspace or create a Company Workspace; accept invitation links |
| Multi-tenant Data Isolation | ✅ Implemented | Unique tenant IDs; server checks user company membership; uninvited cross-tenant access blocked (404) |
| Explicit Cross-Tenant Sharing | ✅ Implemented | Explicit grants in `document_permissions` allow sharing across tenants with instant revocation |
| Team Invitations & RBAC | ✅ Implemented | `owner` (manage workspace/members/settings), `admin` (manage members/docs), `editor` (edit own and granted docs), `viewer` (read/download only) |
| Password Reset & Email Verification | ℹ️ Documented Spec | Token-based recovery spec documented in THREATS.md; requires external mail service (SendGrid/AWS SES) |

See **[THREATS.md](THREATS.md)** for the threat model,
**[PROMPTS.md](PROMPTS.md)** for the AI-assistance log, and
**[DEMO_SCRIPT.md](DEMO_SCRIPT.md)** for the 5-minute hackathon presentation.

---

## Verified on this machine

Everything below was executed and verified locally
(Node 22.13.0, npm 10.9.2, MySQL 8 / TiDB Cloud, Windows 11).

| Check | Command | Result |
|-------|---------|--------|
| Server type check | `npm run typecheck --workspace @trustvault/server` | ✅ 0 errors |
| Client type check | `npm run typecheck --workspace @trustvault/client` | ✅ 0 errors |
| Server tests | `npm run test:server` | ✅ 15 files, **255 tests passed** |
| Client tests | `npm run test:client` | ✅ 8 files, **52 tests passed** |
| Total automated test count | `npm test` | ✅ 23 files, **307 tests passed** |
| Production build | `npm run build` | ✅ `server/dist` (tsc) + `client/dist` (Vite + postbuild SPA routes) |
| Workspace & invites suite | `npx vitest run server/tests/workspace-and-invitations.test.ts` | ✅ 17 tests passed (invitations, revocation persistence, member doc revocation, RBAC) |
| Company registration suite | `npx vitest run server/tests/company-registration.test.ts` | ✅ 5 tests passed (registration, duplicate 409, escalation block, tenant isolation) |
| Security regression suite | `npx vitest run server/tests/security-regression.test.ts` | ✅ 5 tests passed (spray throttling, title redaction, revocation) |
| Client routes suite | `npx vitest run client/src/lib/routes.test.ts` | ✅ 11 tests passed (RBAC matrices, /admin redirect safety, open redirect prevention) |
| Client login & session suite | `npx vitest run client/src/pages/LoginPage.test.tsx` | ✅ 4 tests passed (owner redirect to /dashboard, admin to /admin, session check block) |
| Client role gate suite | `npx vitest run client/src/components/layout/ProtectedRoute.test.tsx` | ✅ 3 tests passed (role-based 403, Return to Dashboard link) |
| Client feedback suite | `npx vitest run client/src/components/ui/Feedback.test.tsx` | ✅ 2 tests passed (403 AccessDenied rendering with working dashboard link) |
| Liveness | `GET /api/health` | ✅ 200 + Helmet headers, `X-Request-Id`, `no-store` |
| Readiness (DB probe) | `GET /api/health/database` | ✅ 200 / 503 sanitized driver codes |
| CORS allow/deny | `Origin: http://localhost:5173` vs untrusted | ✅ allow-list echoed vs 403 `ORIGIN_NOT_ALLOWED` |
| Error envelope | `GET /api/nope` | ✅ 404 JSON envelope with correlation `requestId` |
| Secret audit | `git ls-files` + staged grep | ✅ `.env` untracked, zero secrets in commits |
| Migration on real MySQL | `migrate up` against MySQL 8.0.46 | ✅ `Applied 0001_foundation (2 statement(s), 122 ms)` |
| Migration idempotency | second `migrate up` | ✅ `No pending migrations.` |
| Migration status | `migrate status` | ✅ `1 applied, 0 pending, 0 drifted, 0 missing` |
| Schema inspection | `SHOW TABLES` | ✅ `schema_migrations`, `sessions`, `users` |
| Liveness | `GET /api/health` | ✅ 200 + all Helmet headers, `X-Request-Id`, `no-store` |
| Readiness (DB up) | `GET /api/health/database` | ✅ 200 `{"status":"ok","database":{"status":"up","latencyMs":33.12}}` |
| Readiness (DB down) | API running, MySQL credentials unset | ✅ 503 `{"code":"ER_ACCESS_DENIED_ERROR"}` — sanitized, no host/SQL leak |
| Request-ID echo | `X-Request-Id: demo-trace-0001` | ✅ echoed in header and body |
| Request-ID sanitising | `X-Request-Id: short` | ✅ replaced with a UUID |
| CORS allow | `Origin: http://localhost:5173` | ✅ origin echoed, `Allow-Credentials: true`, `Vary: Origin` |
| CORS deny | `Origin: https://attacker.example` | ✅ 403 `ORIGIN_NOT_ALLOWED` |
| Error envelope | `GET /api/nope` | ✅ 404 JSON envelope with `requestId` |
| Secret audit | `git ls-files` + staged-content grep | ✅ `.env` untracked, no secret-shaped strings in the staged files |

The migration run used a **throwaway MySQL 8 instance** (temporary data
directory on port 3307, removed afterwards) so your local database was never
touched and no credentials were needed.

**One step is still yours on this machine:** create the `trustvault` database and
user (step 4 of the quickstart). Until then, `/api/health/database` correctly
returns 503 and `npm run migrate` reports `Access denied for user
'trustvault'@'localhost'` — the API itself stays healthy, which is exactly the
liveness/readiness split working as designed.

A local `.env` was generated for the smoke test with a random 64-character
`SESSION_SECRET` and an empty `DATABASE_PASSWORD`. Set the real password after
creating the database user.

---

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Client | React 19, TypeScript 5.9, Vite 7 | Fast dev loop, static hosting on Render Static Sites with SPA rewrites |
| API | Node 22, Express 5, TypeScript | Async errors propagate natively in Express 5, deployed on Render Web Service |
| Database | TiDB Cloud / MySQL 8 (`mysql2/promise`) | Serverless distributed MySQL-compatible database, TLS 1.2+ encryption, row-level session & permission revocation |
| Hosting | Render (`render.yaml`) | Unified monorepo deployment: Render Static Site + Render Web Service |
| Config | Zod | One place to fail fast on bad env; supports discrete variables or unified `DATABASE_URL` |
| Logging | pino | Structured JSON, redaction, request tracing via `X-Request-Id` |
| Tests | Vitest + Supertest | Real HTTP assertions against the real app (307 automated tests) |
| Storage | Private filesystem / cloud directory | Never inside `client/`, never web-served, magic byte content inspection |

## Repository layout

```
trustvault/
├── client/                     React + TypeScript + Vite
│   ├── src/
│   │   ├── lib/api.ts          typed fetch client (credentials: include)
│   │   ├── components/         BrandMark, StatusCard
│   │   ├── App.tsx             live health dashboard
│   │   └── styles.css          self-contained theme
│   └── vite.config.ts          Vite + Vitest config
├── server/                     Express + TypeScript API
│   ├── src/
│   │   ├── app.ts              createApp() — middleware order lives here
│   │   ├── index.ts            boot, graceful shutdown, storage init
│   │   ├── config/             env validation, logger, service metadata
│   │   ├── db/                 pool, migration runner, migration helpers
│   │   ├── http/               errors, middleware, routes
│   │   ├── storage/            private storage helpers
│   │   ├── scripts/migrate.ts  migration CLI
│   │   └── types/express.d.ts  req.id augmentation
│   └── tests/                  Vitest + Supertest suites
├── database/
│   ├── bootstrap.sql           database + least-privilege user (template)
│   ├── migrations/             forward-only schema history
│   └── seeds/                  optional local fixtures
├── docs/                       architecture, API reference, VS Code commands
├── .env.example                safe template — copy to .env
├── THREATS.md                  threat model
└── PROMPTS.md                  AI usage log
```

---

## Quickstart (VS Code)

**Prerequisites:** Node.js ≥ 22.12, npm ≥ 10, a TiDB Cloud Serverless cluster (or local MySQL 8 instance), and the
repository open in VS Code (`Ctrl+~` opens the integrated terminal).

### 1. Install dependencies

```powershell
npm install
```

This is an npm workspace: one install covers `client/` and `server/`.

### 2. Create your environment file

```powershell
Copy-Item .env.example .env
```

`.env` is git-ignored. Never commit it, paste it in chat, or screenshot it.

### 3. Generate a session secret

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the 64-character result into `.env` as `SESSION_SECRET=...`. The server
refuses to start production with a placeholder secret.

### 4. Configure the database (TiDB Cloud or Local MySQL)

- **TiDB Cloud (Recommended / Production)**: In `.env`, set:
  ```ini
  DATABASE_HOST=gateway01.us-east-1.prod.aws.tidbcloud.com
  DATABASE_PORT=4000
  DATABASE_USER=<cluster_prefix>.root
  DATABASE_PASSWORD=<your_tidb_password>
  DATABASE_NAME=trustvault
  DATABASE_SSL=true
  ```
  *(Or provide `DATABASE_URL=mysql://<user>:<password>@gateway01...:4000/trustvault?ssl=true`)*
- **Local MySQL**: Follow **[database/README.md](database/README.md#1-create-the-database-and-user)** to create the local `trustvault` database and user.

### 5. Apply the migrations

```powershell
npm run migrate:status   # looks at the schema, changes nothing
npm run migrate:dry      # prints the plan, executes nothing
npm run migrate          # applies all pending migrations
```

Expected: `Applied 0001_foundation ...` then `Database is up to date.` on a
second run.

### 6. Seed demo accounts (development only)

```powershell
npm run seed --workspace @trustvault/server
```

Generates or updates the 3 demo accounts (`owner@trustvault.local`, `viewer@trustvault.local`, `admin@trustvault.local`). Refuses to run against production unless `SEED_ALLOW_PRODUCTION=true`.

### 7. Run both apps

```powershell
npm run dev
```

- client → <http://localhost:5173>
- API → <http://localhost:4000>

Or run them in two terminals if you prefer separate logs:

```powershell
npm run dev:server
npm run dev:client
```

### 8. Prove the API works

```powershell
curl.exe http://localhost:4000/api/health
curl.exe http://localhost:4000/api/health/database
```

Both return JSON. The database endpoint returns **503** with
`database.status: "down"` when MySQL is unreachable — that is the correct
readiness signal, not a crash.

---

## Environment variables

Copy `.env.example` → `.env`. The server loads, in order: real process env,
`server/.env`, then `.env` (first value wins).

| Variable | Default | Required | Notes |
|----------|---------|----------|-------|
| `NODE_ENV` | `development` | no | `production` enables HSTS + strict checks |
| `PORT` | `4000` | no | API port |
| `HOST` | `0.0.0.0` | no | Bind address |
| `TRUST_PROXY` | `0` | no | Set to `1` behind one proxy (Render/nginx) |
| `CLIENT_ORIGINS` | `http://localhost:5173` | no | Comma-separated exact origins; e.g. `https://trustvault-app-1i2l.onrender.com` |
| `SESSION_SECRET` | — | **yes** | ≥ 32 chars; placeholders rejected in production |
| `SESSION_COOKIE_NAME` | `tv_session` | no | `[A-Za-z0-9_-]{3,64}` |
| `SESSION_TTL_HOURS` | `12` | no | 1–720 |
| `COOKIE_SECURE` | auto (`true` in prod) | no | Explicitly forces `Secure` cookies for cross-origin HTTPS |
| `DATABASE_HOST` | `127.0.0.1` | no | `127.0.0.1` for local, or `<gateway>.prod.aws.tidbcloud.com` for TiDB Cloud |
| `DATABASE_PORT` | `3306` | no | `3306` for local MySQL, `4000` for TiDB Cloud |
| `DATABASE_USER` | `trustvault` | no | Database username (e.g. `<user>.<cluster_prefix>` on TiDB Cloud) |
| `DATABASE_PASSWORD` | *(empty)* | **yes in production** | Password for database user |
| `DATABASE_NAME` | `trustvault` | no | Database schema name |
| `DATABASE_SSL` | auto | no | Set to `true` (auto-enabled when host is `tidbcloud.com` or port is 4000) |
| `DATABASE_URL` / `TIDB_URL` | — | no | Unified connection URI alternative (e.g. `mysql://user:pass@host:4000/trustvault?ssl=true`) |
| `DATABASE_CONNECTION_LIMIT` | `10` | no | 1–50 |
| `STORAGE_DIR` | `./storage` | no | Resolved from `server/`; git-ignored |
| `MAX_UPLOAD_BYTES` | `10485760` | no | 10 MiB ceiling |
| `LOG_LEVEL` | `info` | no | `fatal…trace` or `silent` |
| `FRONTEND_URL` | *(first client origin)* | no | Base URL for invitation links (e.g. `https://trustvault-app-1i2l.onrender.com`) |
| `VITE_API_BASE_URL` | `http://localhost:4000` | client `.env` | Baked in at build time (`https://trustvault-api-0dl0.onrender.com`) |

Environment problems are reported **all at once**, at boot, with actionable
messages — the process exits instead of running half-configured.

---

## npm scripts

Run from the repository root.

| Command | What it does |
|---------|--------------|
| `npm run dev` | API + client together (concurrently, kill-on-exit) |
| `npm run dev:server` | API with `tsx watch` on :4000 |
| `npm run dev:client` | Vite dev server on :5173 |
| `npm run build` | Type-check + build both packages |
| `npm run build:server` | `tsc` → `server/dist` |
| `npm run build:client` | `tsc --noEmit && vite build` → `client/dist` |
| `npm run typecheck` | `tsc --noEmit` in both packages |
| `npm test` | Server suite, then client suite |
| `npm run test:server` | Vitest + Supertest |
| `npm run test:client` | Vitest |
| `npm start` | Run the built API (`server/dist/index.js`) |
| `npm run migrate` | Apply pending migrations |
| `npm run migrate:status` | Applied / pending / drift, changes nothing |
| `npm run migrate:dry` | Print the migration plan, execute nothing |

---

## API reference

Full details in **[docs/API.md](docs/API.md)**.

### `GET /api/health` — liveness

Never touches the database, so a transient MySQL outage cannot restart-loop the
API.

```json
{
  "status": "ok",
  "service": "trustvault-api",
  "version": "0.1.0",
  "environment": "development",
  "uptimeSeconds": 12.34,
  "timestamp": "2026-10-20T05:12:00.000Z",
  "requestId": "6f1c1c2e-1a1f-4a37-9e55-2f6f0f1f9a11"
}
```

### `GET /api/health/database` — readiness

`200` when MySQL answers `SELECT 1`, `503` when it does not.

```json
{
  "status": "ok",
  "check": "database",
  "database": { "status": "up", "latencyMs": 2.71 },
  "timestamp": "2026-10-20T05:12:00.000Z",
  "requestId": "0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
}
```

### Error envelope

Every failure — validation, CORS, 404, 500 — uses one shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "No route matches GET /api/nope",
    "requestId": "…"
  }
}
```

Every response also carries an `X-Request-Id` header (a generated UUID, or a
validated inbound value), and that id appears in the server logs.

---

## Migrations

```powershell
npm run migrate:status
npm run migrate:dry
npm run migrate
```

- Files: `database/migrations/NNNN_snake_case.sql`, applied in filename order.
- A SHA-256 checksum is stored per migration; editing applied history is a hard
  error, so the fix is always a **new** migration.
- A MySQL advisory lock prevents two deploys from running the same migration.
- Forward-only: there is deliberately no `down`/`reset` command, so the CLI
  cannot drop your data.
- Migrations are never auto-run at boot — applying schema changes is an explicit
  step.

Details: **[database/README.md](database/README.md)**.

---

## Tests

```powershell
npm test
```

| Suite | Covers |
|-------|--------|
| `server/tests/env.test.ts` | defaults, coercion, production guardrails, origin normalization, warnings |
| `server/tests/health.test.ts` | liveness/readiness shapes, request-id echo and sanitising, 503 behaviour |
| `server/tests/middleware.test.ts` | 404 envelope, Helmet headers, CORS allow/deny/preflight, body limits, error mapping, no leakage in production |
| `server/tests/migrations.test.ts` | naming, checksums, statement splitting, drift, lock contention, dry run |
| `server/tests/db-and-storage.test.ts` | probe timeout/sanitising, path traversal containment |
| `client/src/lib/api.test.ts` | URL normalization/joining, error typing |

Tests need **no database**: the readiness probe is injected, so the suite runs
on any machine and in CI.

---

## Deployment

TrustVault is configured for zero-friction monorepo deployment on **Render** paired with **TiDB Cloud**:

### 1. Client → Render Static Site (`trustvault-app`)

| Setting | Value |
|---------|-------|
| Repository | `https://github.com/Hemanth23534/trustvault` |
| Service Name | `trustvault-app` |
| Build Command | `npm run build --workspace @trustvault/client` |
| Publish Directory | `client/dist` |
| Routing Rules | Rewrite `/*` → `/index.html` (handled via `render.yaml` & `client/public/_redirects`) |
| Environment Variable | `VITE_API_BASE_URL=https://trustvault-api-0dl0.onrender.com` |
| Live URL | `https://trustvault-app-1i2l.onrender.com` |

### 2. API → Render Web Service (`trustvault-api`)

| Setting | Value |
|---------|-------|
| Repository | `https://github.com/Hemanth23534/trustvault` |
| Service Name | `trustvault-api` |
| Runtime | Node 22 |
| Build Command | `npm run build --workspace @trustvault/server` |
| Start Command | `npm start --workspace @trustvault/server` |
| Health Check Path | `/api/health` |
| Live URL | `https://trustvault-api-0dl0.onrender.com` |

Key Environment Variables on Render:
- `NODE_ENV=production`
- `PORT=4000`
- `TRUST_PROXY=1`
- `SESSION_SECRET=<random-64-char-hex-secret>`
- `CLIENT_ORIGINS=https://trustvault-app-1i2l.onrender.com`
- `FRONTEND_URL=https://trustvault-app-1i2l.onrender.com`
- `COOKIE_SECURE=true`
- `DATABASE_HOST`, `DATABASE_PORT=4000`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME=trustvault`, `DATABASE_SSL=true` (or `DATABASE_URL`)

### 3. Database → TiDB Cloud Serverless

- **Connection**: Connects over standard MySQL wire protocol on port `4000` with required TLS v1.2+ encryption (`DATABASE_SSL=true`).
- **Migrations**: Automated forward-only migrations applied via `npm run migrate` create tables, indexes, and tamper-resistant audit triggers.
- **Connection Pool**: Powered by `mysql2/promise` with UTC time pinning, parameterized queries, and connection keep-alive.

**Cross-site cookies:** With the frontend on `https://trustvault-app-1i2l.onrender.com` and backend on `https://trustvault-api-0dl0.onrender.com`, cookies automatically adapt to `SameSite=None; Secure; Partitioned` with synchronizer CSRF tokens protecting all state-changing endpoints.

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `ECONNREFUSED 127.0.0.1:3306` | MySQL not running, or wrong `DATABASE_HOST`/`PORT` |
| `ER_ACCESS_DENIED_ERROR` | Wrong `DATABASE_USER`/`PASSWORD`; re-run the bootstrap SQL |
| `Invalid environment configuration` | Boot-time validation; the message lists every bad variable |
| `ER_NO_SUCH_TABLE` / readiness 503 | Run `npm run migrate` |
| Client shows "Could not reach the API" | Start the API (`npm run dev:server`) and check `VITE_API_BASE_URL` |
| Browser blocks the request (CORS) | Add the exact origin to `CLIENT_ORIGINS` and restart the API |
| `EADDRINUSE :4000` | Another process owns the port: `Get-NetTCPConnection -LocalPort 4000` |
| `npm error code EPERM` on cache writes | A restricted sandbox is blocking npm's global cache. Set `npm_config_cache` to a folder you own, e.g. `$env:npm_config_cache = "$PWD\.npm-cache"` |
| `utf8mb4_0900_ai_ci` unknown collation | You are on MySQL 5.7; this project targets MySQL 8 |

---

## Five-day plan

| Day | Theme | Deliverable |
|-----|-------|-------------|
| 1 | Foundation | ✅ monorepo, config, pool, migrations, health checks, tests |
| 2 | Identity | ✅ bcrypt login, MySQL sessions, CSRF, throttling, audit trail |
| 3 | Documents | ✅ private uploads, ownership checks, search, streaming downloads |
| 4 | Trust | ✅ per-document permissions, immediate revocation, admin isolation |
| 5 | Ship | ✅ audit tamper evidence, admin dashboard, security audit & fixes |

---

## Ground rules

1. **Never commit secrets.** `.env` stays local; `.env.example` holds placeholders.
2. **Migrations are forward-only.** Edit history = red CI.
3. **No feature without a test** and a row in `THREATS.md` if it changes risk.
4. **Small steps.** Each day adds one capability with its guardrails, never a
   half-built pile of features.

Built by the TrustVault team for the Snovasys hackathon.

---

## Day 2 — Authentication (current state)

Sign-in is live: bcrypt hashes, MySQL-backed sessions, rotation on login,
CSRF-protected writes, login throttling and an append-only audit trail.

### Requirements → implementation

| Requirement | Implementation |
|-------------|----------------|
| Login and logout | `POST /api/auth/login`, `POST /api/auth/logout` |
| Password hashing | bcrypt via `bcryptjs` 3.x (pure JS, no native build), cost from `BCRYPT_COST` |
| Persistent server-side sessions | `sessions` table; cookie holds an opaque 256-bit token, MySQL stores only its SHA-256 |
| Session ID regeneration | Every login creates a new session row, token and CSRF token; any session presented on the login request is revoked first |
| HttpOnly / Secure cookies | `HttpOnly` always; `Secure` whenever `NODE_ENV=production` |
| Session expiry + rate limiting | Absolute TTL, idle timeout, per-IP+email limiter, and per-account lockout with `Retry-After` |
| CSRF protection | Per-session token echoed in `X-CSRF-Token`, constant-time compare, plus an `Origin` allow-list check |
| Active account on every request | `users.is_active` (and password-change time) re-read from the session join on every authenticated call |
| Never trust client role/user id | Login strips `role`/`userId`; guards read the role off the session's database row |
| No public admin registration | There is no registration endpoint at all; `npm run seed` is the only way an admin exists |
| No hashes/cookies/secrets in responses | Queries select explicit columns; a test serialises auth responses and asserts no hash, token or `tokenHash` appears |
| Demo seed | `server/src/scripts/seed.ts` — generated passwords printed once, idempotent, refuses production |

### New environment variables

Added on top of the Day-1 table:

| Variable | Default | Notes |
|----------|---------|-------|
| `SESSION_IDLE_MINUTES` | `60` | Inactivity timeout (5–1440) |
| `SESSION_COOKIE_SAME_SITE` | `lax` | `lax` \| `strict` \| `none`; `none` requires HTTPS |
| `BCRYPT_COST` | `12` | Work factor, 10–14 |
| `LOGIN_MAX_FAILED_ATTEMPTS` | `5` | Failures before a lock |
| `LOGIN_LOCK_MINUTES` | `15` | Lock duration |
| `LOGIN_RATE_LIMIT_MAX` | `10` | Attempts per (IP + email) |
| `LOGIN_RATE_LIMIT_WINDOW_MINUTES` | `15` | Window for the limiter |
| `SEED_ADMIN_PASSWORD`, `SEED_OWNER_PASSWORD`, `SEED_VIEWER_PASSWORD` | unset | Optional fixed seed passwords; if unset, strong ones are generated |

### Run it

```powershell
npm run migrate:status   # expect 2 migrations available
npm run migrate          # applies 0002_auth_documents
npm run seed             # creates admin/owner/viewer demo accounts
npm run dev              # API + client, then sign in at http://localhost:5173
```

The seed prints generated passwords exactly once:

```
email                        role     status            password
admin@trustvault.local       admin    created           <generated>
owner@trustvault.local       owner    created           <generated>
viewer@trustvault.local      viewer   created           <generated>
```

### Auth endpoints

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/auth/login` | none (rate limited) | Sets the HttpOnly session cookie |
| GET | `/api/auth/me` | session | Returns user + fresh CSRF token after reload |
| POST | `/api/auth/logout` | session + CSRF | Revokes the row, clears the cookie |
| GET | `/api/admin/audit-logs` | admin | Newest-first audit trail |

Full request/response reference: [docs/API.md](docs/API.md#authentication-day-2).

### Schema

Five product tables plus the migration ledger:
`users`, `sessions`, `documents`, `document_permissions`, `audit_logs`.
Columns, indexes, foreign keys, role semantics and the session lifecycle are
documented in **[docs/DATABASE.md](docs/DATABASE.md)**.

### Test coverage added

| Area | Where |
|------|-------|
| Login success, cookie flags, hash-at-rest, rotation | `server/tests/auth.test.ts` |
| Invalid password, unknown email, disabled account | `server/tests/auth.test.ts` |
| Logout, CSRF missing/foreign token | `server/tests/auth.test.ts` |
| Absolute expiry, idle timeout, password-change invalidation | `server/tests/auth.test.ts` |
| Privilege escalation (role in body, viewer/owner on admin route, forged cookie) | `server/tests/auth.test.ts` |
| Rate limiting and lockout | `server/tests/auth.test.ts` |
| Cookie parsing, token hashing, IP hashing, bcrypt policy, limiter windows | `server/tests/auth-units.test.ts` |
| Client auth wiring (credentials, CSRF header, 204 handling) | `client/src/lib/auth.test.ts` |

### Notes and deliberate trade-offs

- `bcryptjs` is used instead of native `bcrypt`/`argon2`: identical bcrypt
  algorithm, no node-gyp build step on Windows, no binary supply-chain risk.
- Session tokens are hashed at rest; the CSRF token is stored in plaintext
  because the browser must read it back after a reload, and it is useless
  without the HttpOnly cookie.
- The login rate limiter is in-memory and therefore per-process. Fine for one
  instance; a multi-instance deployment needs a shared store (documented in
  `THREATS.md`).
- `documents` and `document_permissions` exist as schema only — upload and
  sharing endpoints arrive on Day 3.

### Verified on this machine (Day 2)

Executed against a throwaway MySQL 8.0.46 instance (port 3307, removed
afterwards), so no local credentials were needed and nothing was left behind.

| Check | Result |
|-------|--------|
| Server type check | ✅ clean |
| Client type check | ✅ clean |
| Server tests | ✅ **132 passed** (7 files) |
| Client tests | ✅ **12 passed** (2 files) |
| Production build | ✅ `server/dist` + `client/dist` (238 kB JS / 13.3 kB CSS) |
| Migrations on real MySQL | ✅ `0001_foundation` (113 ms), `0002_auth_documents` (581 ms) |
| Seed | ✅ 3 accounts, bcrypt `$2b$12$` hashes only |
| Login | ✅ 200, `HttpOnly`, `SameSite=Lax`, no `Secure` on local HTTP |
| `/api/auth/me` | ✅ 200 with the session cookie |
| Admin audit | ✅ 200, entries include `login_success` |
| Logout without CSRF | ✅ 403 `CSRF_TOKEN_INVALID` (session survives) |
| Logout with another session's CSRF | ✅ 403 `CSRF_TOKEN_INVALID` |
| Logout with own CSRF | ✅ 204, session row revoked |
| Reuse after logout | ✅ 401 `SESSION_INVALID` |
| Wrong password | ✅ 401 `INVALID_CREDENTIALS`, no enumeration wording |
| `role: "admin"` in login body | ✅ ignored; stored role stayed `viewer` |
| Viewer on `/api/admin/audit-logs` | ✅ 403 `FORBIDDEN` |
| Database state | ✅ 2 sessions (1 revoked), audit rows for login/logout |

Two real bugs were caught by this end-to-end run rather than by unit tests, both
now fixed and documented in [PROMPTS.md](PROMPTS.md) and
[docs/DATABASE.md](docs/DATABASE.md#timezone-invariant-learned-the-hard-way):

1. SQL `NOW()` (server time zone) disagreed with the driver's UTC frame, so fresh
   sessions looked older than `password_changed_at` and were revoked instantly.
2. The migration suite assumed exactly one migration file existed.

---

## Day 3 — Document management (current state)

Uploads, search, metadata, protected downloads, metadata edits and soft delete
are live. Bytes live outside the repo in private storage; MySQL holds metadata
only.

### Requirements → implementation

| Requirement | Implementation |
|-------------|----------------|
| Upload documents | `POST /api/documents` (multipart, one file, optional title/category/description) |
| List discoverable documents | `GET /api/documents`, scoped by the access predicate |
| Search by name, owner, category, date | `search`, `owner`, `category`, `from`/`to` query parameters, all parameterized |
| View metadata | `GET /api/documents/:id` |
| Protected download | `GET /api/documents/:id/download`, authorized then streamed as an attachment |
| Edit permitted metadata | `PATCH /api/documents/:id` — owner, co-owner or admin only |
| Soft delete | `DELETE /api/documents/:id` sets `deleted_at`, hides every read path, keeps the bytes |
| Display fields | Name/title, owner, category, size and creation date in the client table |

### Security properties

| Property | How |
|----------|-----|
| Private storage | `STORAGE_DIR` outside `client/`, mode `0700`/`0600`, never web-served |
| Server-generated keys | `yyyy/mm/<uuid>.<ext>`; the upload name never becomes a path |
| No overwrites | Keys are UUIDs and files are written with `flag: 'wx'` |
| Content validation | Extension allow-list + MIME consistency + magic bytes (PDF/PNG/JPEG), OOXML structure, UTF-8 text check |
| Size/type rejection | `MAX_UPLOAD_BYTES`, 415 for unsupported or mismatched content, 413 for oversize |
| Path traversal | Strict key pattern + containment check before any filesystem call |
| No public links | Only authorized, audited streaming; `no-store`, `attachment`, no redirects |
| Authorization everywhere | The same predicate is applied to list, count, fetch, update, delete and download |

### Endpoints

| Method | Path | Who |
|--------|------|-----|
| POST | `/api/documents` | any signed-in user (becomes owner) |
| GET | `/api/documents` | any signed-in user (own + granted) |
| GET | `/api/documents/:id` | admin, owner, co-owner, granted viewer |
| PATCH | `/api/documents/:id` | admin, owner, co-owner |
| DELETE | `/api/documents/:id` | admin, owner, co-owner |
| GET | `/api/documents/:id/download` | admin, owner, co-owner, granted viewer |

Full reference: [docs/API.md](docs/API.md#documents-day-3).

### Run it

```powershell
npm run migrate        # applies 0003_document_management
npm run seed           # demo admin/owner/viewer
npm run dev            # http://localhost:5173, sign in and use the Documents panel
```

Upload flow: pick a file, optionally set a title/category, press **Upload**. The
table shows name, owner, category, size and created date; **Download**, **Edit**
and **Delete** appear according to your access.

### Storage layout

```
server/storage/2026/10/6e3e793b-a510-4b24-b94f-6bccb8da0c6d.pdf
                 └ date ┘ └──────── server-generated uuid ────────┘
```

`server/storage/` is git-ignored. Nothing under it is reachable over HTTP.

### Test coverage added

| Area | Tests |
|------|-------|
| Upload success, generated key, checksum, no `storageKey` in responses | `server/tests/documents.test.ts` |
| Unauthenticated upload, CSRF, unsupported extension, content mismatch, empty, no extension, oversize | same file |
| Filename traversal and same-name overwrite avoidance | same file |
| Listing isolation, grants, admin visibility | same file |
| Search (title/file name), category, owner, date range, LIKE escaping, pagination | same file |
| Metadata edits: owner, co-owner, admin, viewer 403, stranger 404, validation | same file |
| Download: bytes, headers, stranger 404, grant 200, deleted 404, no public link | same file |
| Storage key traversal and UUID-only keys | same file |
| Client query building, formatting, upload/PATCH wiring | `client/src/lib/documents.test.ts` |

### Verified on this machine (Day 3)

Executed against a throwaway MySQL 8.0.46 instance and a temporary storage
directory (both removed afterwards):

| Check | Result |
|-------|--------|
| Migrations | ✅ 0001 (160 ms), 0002 (762 ms), **0003 (251 ms)** — 3 applied, 0 drifted |
| Seed | ✅ 3 demo accounts |
| Upload valid PDF | ✅ 201, `access.mode: owner`, checksum present, no storage key in the response |
| List / search | ✅ owner sees 1, `search=quarterly` matches, a miss returns 0 |
| Metadata | ✅ 200 |
| Download | ✅ 200, SHA-256 of the downloaded file matches the source |
| Metadata edit | ✅ 200, title updated |
| Stranger | ✅ 0 documents, download 404, edit 404 |
| Granted viewer (direct SQL grant) | ✅ list sees 1 (`viewer`), download 200, edit 403 `DOCUMENT_FORBIDDEN` |
| Admin | ✅ can edit any document |
| Invalid uploads | ✅ content mismatch 415, `.exe` 415, oversize 413, unauthenticated 401 |
| Storage | ✅ exactly one file, `2026/10/<uuid>.pdf`, name unrelated to the upload |
| Soft delete | ✅ 204, list 0, metadata 404, download 404, bytes retained |
| Audit | ✅ `document.uploaded`, `document.downloaded` (×2), `document.updated`, `document.deleted` |

### Notes and deliberate limits

- `vitest` was bumped from 3.2.7 to 5.0.5 by the dependency install; the full
  suite was re-run on 5.0.5 and passes.
- Uploads are parsed in memory for exactly one file per request, bounded by
  `MAX_UPLOAD_BYTES`. Streaming to a temp file is the next step if the limit grows.
- There is **no share endpoint yet** (Day 4). Grants are enforced by the API and
  tested; inserting one requires SQL for now:
  `INSERT INTO document_permissions (id, document_id, user_id, role, granted_by) VALUES (UUID(), ?, ?, 'viewer', ?);`
- The OOXML check is structural (ZIP signature + `[Content_Types].xml` + the
  `word/`, `xl/` or `ppt/` folder). It is not a full archive parser and no
  antivirus scanning happens.
- Soft delete deliberately keeps bytes; purging is a scheduled job, not a user
  action.

---

## Day 4 — Document-Level Permissions & Immediate Revocation

Per-document access control, owner-governed sharing, instant revocation, and complete administrative isolation.

### Permission Model
- **Owner**: Full control. Only owners may grant or revoke permissions.
- **Viewer**: Read metadata and download permitted document contents.
- **Editor**: Read metadata, download contents, and edit permitted metadata.
- **Admin**: System governance only. **Does NOT have automatic permission to read or download document contents.**

### Endpoints Added
- `GET /api/documents/stats`: Aggregated dashboard metrics for current viewer.
- `GET /api/documents/:id/permissions`: List current grants (owner only).
- `POST /api/documents/:id/permissions`: Grant or update permission role.
- `DELETE /api/documents/:id/permissions/:userId`: Revoke access immediately.
- `GET /api/documents/:id/access-history`: Audit history for a specific document.
- `GET /api/access-history`: Cross-document access history for manageable documents.

---

## Day 5 — Tamper-Evident Audit Trail, Security Review & Production Hardening

The final submission delivers full administrative governance, cryptographic tamper evidence, an independent security review, and vulnerability remediation.

### Audit Security & Tamper Resistance
- **Database Engine Immutability**: MySQL `BEFORE UPDATE` and `BEFORE DELETE` triggers reject any raw SQL modification or deletion of `audit_logs` or `audit_checkpoints` with `SQLSTATE '45000'`.
- **SHA-256 Hash Chaining**: Every audit entry commits to the canonical JSON digest of the current record plus the preceding record's `entry_hash`.
- **Periodic Checkpoints**: Cryptographic checkpoints anchor chain state, detecting retroactive tampering or entry splicing.
- **Admin Dashboard**: Search and filter events across actors, documents, outcomes, and dates. Includes full user lifecycle activation/deactivation controls.

### Security Review Findings & Resolutions
An independent review evaluated the codebase across 13 threat categories:
1. **Finding 1 (Medium - DB Privileges):** Resolved by splitting `database/bootstrap.sql` into deployment user (`trustvault_deploy` with DDL) and runtime user (`trustvault` with DML on operational tables and strictly `SELECT, INSERT` on audit tables).
2. **Finding 2 (Medium - Password Spraying):** Resolved by implementing dual-tier rate limiting in `server/src/app.ts`: Tier-1 global per-IP ceiling (30 req / 15 min) + Tier-2 per-(IP+email) limit (10 req / 15 min).
3. **Finding 3 (Low-Medium - Title Leakage):** Resolved by conditionally projecting document titles with `CASE WHEN d.owner_id = ? OR p.user_id IS NOT NULL THEN d.title ELSE '[Restricted]' END` in manager history queries.
4. **Finding 4 (Low - Stream Revocation):** Documented architectural boundary: revocation immediately denies all new HTTP requests; active in-flight streams cannot recall already-sent bytes.

Automated regression coverage: `server/tests/security-regression.test.ts` (5 tests passing).

---

## Clean Clone Deployment Instructions

Follow these steps to deploy and run TrustVault on a fresh machine:

### 1. Prerequisites
- **Node.js**: v22.x LTS (tested on v22.13.0)
- **npm**: v10.x or higher
- **MySQL Server**: v8.0 or higher running on port 3306

### 2. Clone and Install
```powershell
git clone <repository-url> trustvault
cd trustvault
npm install
```

### 3. Environment Configuration
```powershell
Copy-Item .env.example .env
```
Generate a strong 64-character session secret:
```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```
Edit `.env` and set:
```ini
NODE_ENV=production
PORT=4000
SESSION_SECRET=<generated-64-char-hex-secret>
DATABASE_HOST=127.0.0.1
DATABASE_PORT=3306
DATABASE_USER=trustvault
DATABASE_PASSWORD=<your-runtime-db-password>
DATABASE_NAME=trustvault
CLIENT_ORIGINS=http://localhost:5173
STORAGE_DIR=./storage
```

For the client:
```powershell
Copy-Item client/.env.example client/.env
```
Ensure `VITE_API_BASE_URL=http://localhost:4000` is configured in `client/.env`.

### 4. Database Bootstrap & Migrations
Log in to MySQL as root and execute `database/bootstrap.sql` (replacing the placeholder passwords):
```powershell
mysql -u root -p < database/bootstrap.sql
```
Run the forward-only migration runner to create tables and triggers:
```powershell
npm run migrate
```
Verify status:
```powershell
npm run migrate:status
# Expected: 7 applied, 0 pending, 0 drifted, 0 missing
```

### 5. Seed Demo Accounts (Development Only)
Safely seed demo accounts (admin, owner, viewer) for local testing:
```powershell
# For production mode, pass SEED_ALLOW_PRODUCTION=true
$env:SEED_ALLOW_PRODUCTION="true"
npm run seed
```
Save the printed generated passwords. Passwords are shown once and stored solely as bcrypt hashes. In production, public registration (`/register`) allows organizations to self-onboard securely without needing demo seeds.

### 6. Build and Run Production Services
Build both client and server:
```powershell
npm run build
```

Run tests to verify deployment integrity:
```powershell
npm test
# Expected: 215 server tests + 22 client tests passing (237 total)
```

Start the API and Client:
```powershell
# Terminal 1: API
npm start

# Terminal 2: Client
cd client
npx vite preview --port 5173
```
Access the application at `http://localhost:5173`.

---

## Multi-Tenant Architecture & Workspace Management

TrustVault operates as a multi-tenant platform designed for open-source self-hosting and public deployment:

### 1. Self-Service Public Registration & Onboarding
- **Personal Workspaces:** Individuals can register with their own email and password without a company name. Personal users have `company_id = NULL` and full ownership of their library. They can share documents with any registered user or upgrade to a Company Workspace at any time via `/workspace/create`.
- **Company Workspaces:** Teams and businesses can register a company workspace directly at `/register` by specifying their company name. The creator becomes the workspace `owner` with a cryptographically generated tenant UUID.
- **Invitation Acceptance:** Team members join an existing company workspace by following an invite link (`/register?invite=<token>`) or accepting an invitation while logged in.

### 2. Multi-Tenant Data Isolation & Cross-Company Sharing
- **Tenant Isolation:** Every company-owned document, membership, and audit entry is bound to its `company_id`. The backend enforces tenant boundaries on all document listings, uploads, downloads, updates, and deletions.
- **Explicit Cross-Tenant Sharing:** Documents can only cross tenant boundaries through explicit, authorized grants in `document_permissions`. Uninvited users receive an immediate `404 Not Found`. Revoking an access grant instantly cuts off access with zero caching latency.

### 3. Role-Based Access Control (RBAC)
- **`owner`:** Complete workspace control, workspace settings (name, domain), member invitation and removal, role promotion/demotion, and document management.
- **`admin`:** Workspace administration, member invites, user management, and governance logs.
- **`editor`:** Document creation and upload, editing owned documents and shared documents granted with edit permissions.
- **`viewer`:** Read-only access and secure streaming downloads for granted documents.

### 4. Database Migration 0007
Migration `0007_company_invitations_and_roles.sql` applies forward-only schema updates:
- Extends the `users.role` enum to include `editor`.
- Creates the `company_invitations` table with secure random tokens, role assignment, status tracking (`pending`, `accepted`, `revoked`, `expired`), expiration timestamps, and indexed foreign keys to `companies` and `users`.

---

## License

This project is licensed under the [MIT License](LICENSE) - see the LICENSE file for details.

---

## GitHub Repository & Version Control

- **Repository**: [https://github.com/Hemanth23534/trustvault](https://github.com/Hemanth23534/trustvault)
- **Primary Branch**: `main`
- **Monorepo Structure**: Contains both `@trustvault/client` (React 19 SPA) and `@trustvault/server` (Express 5 API), with unified npm workspace scripts, shared database migrations, and automated test suites.

To clone and work on this repository:

```powershell
git clone https://github.com/Hemanth23534/trustvault.git
cd trustvault
npm install
```

When pushing commits to `main`, Render automatically triggers builds for both the backend Web Service (`trustvault-api`) and the frontend Static Site (`trustvault-app`).

---

## Live Production Deployment on Render & TiDB Cloud

TrustVault is deployed in production using **Render** for application compute and **TiDB Cloud** for managed serverless distributed SQL:

| Component | Service | URL / Endpoint |
|-----------|---------|----------------|
| **Frontend Client** | Render Static Site (`trustvault-app`) | [https://trustvault-app-1i2l.onrender.com](https://trustvault-app-1i2l.onrender.com) |
| **Backend API** | Render Web Service (`trustvault-api`) | `https://trustvault-api-0dl0.onrender.com` |
| **Database** | TiDB Cloud Serverless (MySQL 8 compatible) | `gateway01.us-east-1.prod.aws.tidbcloud.com:4000` |
| **Source Code** | GitHub Monorepo | [https://github.com/Hemanth23534/trustvault](https://github.com/Hemanth23534/trustvault) |

---

### 1. Database Architecture — TiDB Cloud Serverless

TrustVault uses **TiDB Cloud**, an elastic, serverless, MySQL-compatible distributed SQL database:
- **Port & Protocol**: Connects over standard MySQL wire protocol on port `4000`.
- **Security & TLS**: Requires encrypted connections with TLS v1.2+ (`DATABASE_SSL=true` or SSL parameters in `DATABASE_URL`).
- **Connection Pooling**: Configured via `mysql2/promise` with UTC timezone pinning (`timezone: 'Z'`), named placeholders, no stacked queries (`multipleStatements: false`), and keep-alive probes to maintain active pooled connections.
- **Forward-Only Migrations**: All 7 database migrations (`0001_foundation` through `0007_company_invitations_and_roles`) run seamlessly against TiDB Cloud:
  ```powershell
  npm run migrate
  ```
  Schema integrity is verified using SHA-256 checksums and connection advisory locks.

#### Connecting to TiDB Cloud
Set the following environment variables in your server environment:
```ini
DATABASE_HOST=gateway01.us-east-1.prod.aws.tidbcloud.com
DATABASE_PORT=4000
DATABASE_USER=<your_cluster_prefix>.root
DATABASE_PASSWORD=<your_tidb_password>
DATABASE_NAME=trustvault
DATABASE_SSL=true
```
Alternatively, provide a single unified connection string:
```ini
DATABASE_URL=mysql://<user>:<password>@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/trustvault?ssl=true
```

---

### 2. Backend API Service on Render (`trustvault-api`)

The backend is deployed as a Render Web Service running Node.js 22:
- **Service Name**: `trustvault-api`
- **Root Directory**: repository root (`/`)
- **Build Command**: `npm run build --workspace @trustvault/server`
- **Start Command**: `npm start --workspace @trustvault/server`
- **Health Check Path**: `/api/health`
- **Live Endpoint**: `https://trustvault-api-0dl0.onrender.com`

#### Required Backend Environment Variables on Render:
| Variable | Value / Description |
|----------|---------------------|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `TRUST_PROXY` | `1` (required for correct client IP detection behind Render's load balancer) |
| `SESSION_SECRET` | 64-character cryptographic random hex string |
| `CLIENT_ORIGINS` | `https://trustvault-app-1i2l.onrender.com` |
| `FRONTEND_URL` | `https://trustvault-app-1i2l.onrender.com` |
| `COOKIE_SECURE` | `true` |
| `DATABASE_HOST` | TiDB Cloud gateway host |
| `DATABASE_PORT` | `4000` |
| `DATABASE_USER` | TiDB Cloud user |
| `DATABASE_PASSWORD` | TiDB Cloud password |
| `DATABASE_NAME` | `trustvault` |
| `DATABASE_SSL` | `true` |

---

### 3. Frontend Static Site on Render (`trustvault-app`)

The frontend is deployed as a Render Static Site:
- **Service Name**: `trustvault-app`
- **Root Directory**: `client` (or root with workspace build)
- **Build Command**: `npm run build --workspace @trustvault/client`
- **Publish Directory**: `client/dist`
- **Live URL**: `https://trustvault-app-1i2l.onrender.com`

#### Build Process & SPA Routing:
1. `tsc --noEmit`: Strict TypeScript compilation check.
2. `vite build`: Production minification and asset bundling.
3. `node scripts/postbuild.js`: Generates static entrypoints for all 11 client-side routes (`/dashboard`, `/admin`, `/workspace/members`, `/workspace/settings`, `/workspace/create`, `/documents`, `/history`, `/register`, `/login`, `/accept-invite`), along with `404.html`, `200.html`, and `_redirects` (`/* /index.html 200`).
4. **Infrastructure Rewrite Rule**: Configured in `render.yaml`:
   ```yaml
   routes:
     - type: rewrite
       source: /*
       destination: /index.html
   ```

#### Required Frontend Environment Variable on Render:
| Variable | Value |
|----------|-------|
| `VITE_API_BASE_URL` | `https://trustvault-api-0dl0.onrender.com` |

---

### 4. Cross-Origin Sessions & CSRF Protection

When the frontend (`https://trustvault-app-1i2l.onrender.com`) and API (`https://trustvault-api-0dl0.onrender.com`) communicate across origins on Render:
- **Session Cookie**: Issued with `HttpOnly; SameSite=None; Secure; Partitioned` so modern browsers allow authenticated credentials across distinct Render subdomains.
- **CSRF Defense**: Every state-changing request requires a per-session cryptographic synchronizer token passed in the `X-CSRF-Token` header, validated in constant time alongside strict Origin allow-list matching.
- **Zero Token in LocalStorage**: The browser never writes session tokens to `localStorage` or `sessionStorage`, protecting against XSS credential harvesting.

---

### 5. Role-Based Navigation & Safe Redirection

TrustVault enforces strict role boundaries:
- **Workspace Owner (`owner`)**: Manages the company workspace, invites and removes team members, assigns roles, and owns documents. Non-admins landing on or bouncing from `/admin` are safely redirected to `/dashboard`.
- **Platform Administrator (`admin`)**: Governs tamper-evident audit logs and checkpoints. Platform administrators have zero automatic document access (Administrator Separation Invariant).
- **Editor (`editor`)**: Uploads new documents and edits authorized document metadata.
- **Viewer (`viewer`)**: Read and download access for explicitly granted documents.
- **403 Access Denied Screen**: When a non-admin directly accesses `/admin`, the application retains the backend 403 status code and displays an actionable page with a working **Return to Dashboard** button.

---

## Workspace Invitations, SPA Deep-Linking, and Revocation Persistence

### 1. SPA Deep-Link Routing and Direct Refresh Fallback (Bug 1 Fix)
- **Problem**: When navigating to `/register?invite=<token>` directly in a new tab or refreshing on Render Static Sites, the static file server returned plain HTTP 404 `Not Found` because client-side routes were not mapped to physical static files or an SPA fallback.
- **Multi-Layered Solution**:
  1. **Infrastructure Rewrite Rule**: Added root `render.yaml` defining a static site route rewrite (`source: /*`, `destination: /index.html`).
  2. **Static Rewrite File**: Added `client/public/_redirects` (`/* /index.html 200`) automatically copied to build output.
  3. **Build Fallback Generator (`client/scripts/postbuild.js`)**: Runs automatically after `vite build` to generate static entrypoints for common routes (`dist/register/index.html`, `dist/login/index.html`, `dist/accept-invite/index.html`, `dist/workspace/members/index.html`, etc.) along with `dist/404.html` and `dist/200.html`. Even without server-side rewrite rules, hosts serving directory indexes load the React application directly with zero 404 errors.
  4. **Account Mismatch Detection**: On `/register?invite=...`, if an authenticated user opens an invite intended for a different email address, the UI renders an account mismatch alert with an explicit **Sign Out & Switch Account** button instead of letting an invalid acceptance fail silently.

### 2. Revocation & Database State Persistence (Bug 2 & Bug 3 Fix)
- **Problem**: When revoking an invitation or removing a member on `/workspace/members`, the item reappeared upon page refresh.
- **Root Cause**:
  1. `listCompanyInvitations(companyId)` in the database store returns all invitation rows for the company regardless of status (`pending`, `revoked`, `accepted`, `expired`).
  2. The frontend rendered all records under `<h4>Pending Invitations</h4>` with a "Revoke" button, without checking `inv.status`.
  3. Frontend action handlers failed to inspect `res.ok`, updating local React state optimistically without refetching authoritative server state.
  4. Demo account seeding on startup re-assigned `company_id = COALESCE(company_id, DEMO_COMPANY_ID)`, re-attaching removed members to the demo company.
- **Solution**:
  1. **Partitioned Frontend State**: `WorkspaceMembersPage.tsx` splits invitations into active `pendingInvitations` (`status === 'pending' && expiresAt > now`) and historical `pastInvitations` (`status !== 'pending' || expiresAt <= now`).
  2. **Separated UI Tables**: Pending invitations have "Copy Link" and "Revoke" actions; past invitations are displayed in an "Invitation History" table with status badges (`Accepted`, `Revoked`, `Expired`) and no Revoke button.
  3. **Authoritative Server Sync**: Action handlers (`handleRevokeInvite`, `handleRemoveMember`, `handleChangeRole`) verify `res.ok`, extract server error envelopes upon failure, and call `await loadData()` upon success to synchronize with MySQL/TiDB.
  4. **Document Permission Cleanup**: `removeCompanyMember` clears `company_id = NULL` and executes `DELETE FROM document_permissions` for that user on that company's documents, revoking active sessions.
  5. **Idempotent Seeding**: `seed.ts` preserves existing users' company associations when seeding runs.

### 3. Role-Based Navigation & Safe Initial Landing (Bug 4 Fix)
- **Problem**: After signing in with valid credentials, Workspace Owners were redirected to `/admin` and met with `403 Access restricted`.
- **Root Cause**:
  1. `RequireAuth` passed `location.pathname` via `state: { from: '/admin' }` when unauthenticated users or expired sessions touched `/admin`.
  2. `LoginPage.tsx` blindly redirected newly authenticated users to `location.state.from` without checking whether `user.role` was authorized for that path.
  3. `<Route path="dashboard" />` was not explicitly mapped in `App.tsx` (only root index `/` existed).
- **Solution**:
  1. **Route Permission Validator (`client/src/lib/routes.ts`)**: Implemented `isPathAuthorized(path, user)` and `getPostAuthRedirect(requestedPath, user)`. Non-admin users (such as Workspace Owners) with `from: '/admin'` are safely redirected to `/dashboard`.
  2. **Actionable 403 Page (`client/src/components/ui/Feedback.tsx`)**: Direct intentional visits to `/admin` by non-admins retain the backend 403 status and display an `AccessDenied` component with a prominent **Return to Dashboard** button.
  3. **Explicit `/dashboard` Route & Postbuild Fallback**: Mounted `<Route path="dashboard" element={<DashboardPage />} />` in `App.tsx` and pre-rendered `dist/dashboard/index.html` via `client/scripts/postbuild.js`.
  4. **Session Check Screen**: Handled `status === 'checking'` in `LoginPage.tsx` and `RegisterPage.tsx` to display a clean loading block, eliminating race conditions during session restoration.

---

## Platform Administrator Separation & Creator Governance

### 1. Dedicated Platform Administrator (`platform_admin`) Role
- **Strict Role Separation**: A new top-level `platform_admin` role was established in `users.role` (`ENUM('platform_admin', 'owner', 'admin', 'editor', 'viewer')`), cleanly distinguishing Platform Administrators (the system creators/operators) from company-level administrators (`role: 'admin'`).
- **Cross-Company Visibility**: The Platform Administrator dashboard provides complete cross-company oversight:
  - **Overview Counters**: Total registered employees across all companies, total company workspaces, active accounts, and disabled accounts.
  - **Search & Filtering**: Search and filter employees across all companies by company, name, email, role, and account status (`active` vs `disabled`).
  - **Company Workspace Directory**: View all registered company workspaces, their domains, employee counts, and active account counts (`GET /api/admin/companies`).
  - **Company Employee Drill-down**: Inspect all employees belonging to any specific company (`GET /api/admin/companies/:id/employees`).
  - **Account Status Management**: Disable or reactivate user accounts across any company with immediate session revocation (`PATCH /api/admin/users/:id/status`).

### 2. Tenant Isolation & Privilege Escalation Defenses
- **Company Owner & Admin Isolation**: Company owners (`role: 'owner'`) and company admins (`role: 'admin'`) are strictly confined to their company workspace (`actor.companyId`).
- **Access Denial**: All Platform Administration routes (`/api/admin/*`) strictly enforce `requireRole('platform_admin')`. Any request from a company owner, company admin, editor, or viewer yields `403 Forbidden`.
- **Promotion Prevention**: Public registration as a Platform Administrator is strictly forbidden. Furthermore, company owners and company admins cannot invite or promote anyone to `platform_admin` via workspace APIs (`PATCH /api/workspace/members/:id/role` and `POST /api/workspace/invitations` reject `platform_admin` with HTTP 422/403).
- **Controlled Promotion CLI**: Initial promotion to Platform Administrator is restricted to controlled database migrations (`0010_platform_admin_role.sql`) or the secure server CLI tool:
  ```bash
  npm run promote:platform-admin <email>
  ```
- **Administrator Separation Invariant**: Platform Administrators govern accounts, companies, and audit ledgers, but have zero access to company document contents.

### 3. Dedicated Platform Access Portal
- **Dedicated Route**: Platform Administrators access governance tools through `/platform-admin/login`.
- **Creator & Platform Banner**: Standard login (`/login`) includes a distinct "Creator & Platform Access" banner directing administrators to the portal.
- **Unauthorized Handling**: If an authenticated company user visits `/platform-admin/login` or `/admin`, a clear, branded Access Restricted screen guides them back to their company workspace.

### 4. Comprehensive Test Verification
- **Automated Server Test Suite**: 16 test files, 270 tests PASS (`npm run test:server`).
  - Includes dedicated suite `server/tests/platform-admin.test.ts` covering cross-company visibility, tenant isolation, access denial, promotion prevention, cross-tenant IDOR protection, and document lifecycle continuity.
- **Automated Client Test Suite**: 10 test files, 60 tests PASS (`npm run test:client`).
- **Type Safety**: 0 TypeScript errors across client and server (`npm run typecheck`).
- **Production Build**: Clean production build with SPA fallbacks (`npm run build`).






