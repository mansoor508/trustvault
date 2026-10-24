# PROMPTS.md — AI usage log

Hackathon rules usually require disclosing AI assistance. More importantly, the
judges will ask *"what did you actually write?"*. This file answers that with a
receipts-style log: what was asked of the assistant, what came back, what a human
changed, and how it was verified.

---

## 1. Rules we committed to before starting

1. **No secrets in prompts.** No `.env` contents, passwords, tokens, database
   dumps, real user data, API keys or private keys. Placeholder values only.
2. **No pasted proprietary code** from an employer or another project.
3. **Every generated line is reviewed** before it is committed. Unreviewed code
   is a liability, not a shortcut.
4. **Tests are the evidence.** A feature is "done" when a test proves the
   behaviour, not when the model says it is done.
5. **The log is written as we go**, not reconstructed at the end.
6. **AI never authors the threat model alone.** `THREATS.md` is reviewed and
   edited by a human who can defend every row.

## 2. Tooling used

| Tool | Role |
|------|------|
| DeepSeek Harness (agentic coding) | Scaffolding, boilerplate, test drafting, documentation drafts, running builds/tests |
| npm / Node 22 / MySQL 8 | Real execution: installs, type checks, test runs, migrations, HTTP probes |

## 3. Log

### Entry 1 — Workspace inspection and toolchain discovery

- **Intent:** start from scratch without clobbering anything.
- **Prompt (summary):** "Inspect the current workspace. Report Node, npm, git and
  MySQL availability. Do not create files yet."
- **Result:** empty workspace confirmed; Node 22.13, npm 10.9.2, git 2.56,
  MySQL 8.0 service running; `npm` writes outside the workspace were blocked by
  the agent sandbox, so a workspace-local npm cache was used.
- **Human review:** confirmed the workspace really was empty before scaffolding.
- **Verification:** `Get-ChildItem -Force`, `node --version`, `npm view`.

### Entry 2 — Server foundation

- **Intent:** Express + TypeScript skeleton with validated config.
- **Prompt (summary):** "Create `server/` with an Express 5 + TypeScript app:
  env validation, mysql2 pool, Helmet, restricted CORS, request ids, central
  error handling, health and database-health endpoints. No auth, no uploads."
- **Result:** `server/src/{config,db,http,storage}` modules plus tests.
- **Human changes:** see "Corrections made to generated output" below.
- **Verification:** `npm run typecheck -w @trustvault/server`,
  `npm test -w @trustvault/server`.

### Entry 3 — Migration system

- **Intent:** a migration runner we could trust in a demo.
- **Prompt (summary):** "Design a forward-only MySQL migration system with
  checksums, an advisory lock, dry-run and status. Do not execute destructive
  SQL. Include one initial migration for users and sessions."
- **Result:** `server/src/db/migrate.ts`, `migration-files.ts`,
  `database/migrations/0001_foundation.sql`, CLI commands.
- **Human decision:** no `down` command at all. A hackathon team under time
  pressure should not have a one-command way to drop production tables.
- **Verification:** `tests/migrations.test.ts` (drift, lock contention, dry run,
  statement splitting) and `npm run migrate:status` against MySQL.

### Entry 4 — Client foundation

- **Intent:** a first screen that proves the API is real.
- **Prompt (summary):** "React + TypeScript + Vite client that calls both health
  endpoints, shows status and the returned request id, and never fakes data."
- **Result:** `client/src/App.tsx`, typed `lib/api.ts`, status cards, CSS theme.
- **Human changes:** copy rewritten to say "Day 1 / foundation" instead of
  implying features exist; removed a placeholder "storage: healthy" card that
  would have displayed a status the client cannot actually verify.
- **Verification:** `npm run build -w @trustvault/client`,
  `npm test -w @trustvault/client`, manual check in the browser.

### Entry 5 — Documentation

- **Intent:** make the repo self-explanatory for the other four team members.
- **Prompt (summary):** "Write README, THREATS, PROMPTS and docs/ from the code
  that actually exists. Mark every unbuilt feature as planned."
- **Result:** this file, `README.md`, `THREATS.md`, `docs/`.
- **Human review:** everyone adds their own name to the sections they own before
  submission.

## 4. Corrections made to generated output

Reviewing beats accepting. Things that were wrong, vague or unsafe, and what
changed:

| Area | Generated suggestion | Why it was rejected or changed |
|------|----------------------|--------------------------------|
| CORS | `origin: true` / `*` convenience mode | With `credentials: true` that is an account-takeover vector. Replaced with an exact allow-list; wildcards now fail env validation. |
| Errors | Return `error.message` on every 500 | Leaks SQL, paths and stack details. Production now returns a generic message; details are logged with the request id. |
| Secrets | `SESSION_SECRET` defaulting to a hardcoded string | A default secret is a backdoor. Now required, minimum 32 chars, placeholders rejected in production. |
| Migrations | Auto-apply migrations on server boot | Two instances race, and a bad deploy corrupts the schema during a demo. Now an explicit `npm run migrate` step. |
| Migrations | `down` migrations for convenience | One wrong command drops the demo. Forward-only by design. |
| Health | One endpoint that pings MySQL | A liveness probe failing on a DB blip causes restart loops. Split into liveness and readiness. |
| Tests | Mock the whole Express stack | Tests the mocks, not the app. Tests now run the real app via Supertest and inject only the DB probe. |
| Client | Show a green "storage" tile | The client cannot verify storage from the browser. Removed rather than faked. |

## 5. Review checklist before committing AI-assisted code

- [ ] Does it read like something a teammate can maintain at 2 a.m.?
- [ ] Are secrets, tokens and personal data absent from the diff?
- [ ] Is every new branch covered by a test that would fail without the code?
- [ ] Does a failed request still produce a safe, useful response?
- [ ] Are new environment variables documented in `.env.example` and README?
- [ ] Does `THREATS.md` need a new row?

## 6. Template for later entries

```markdown
### Entry N — <short title>

- **Intent:** <what problem we were solving>
- **Prompt (summary):** "<what we asked for, including constraints>"
- **Result:** <files touched / behaviour added>
- **Human changes:** <what we rewrote and why>
- **Verification:** <command run + output summary>
```

### Entry 6 — Day 2: authentication, sessions and the MySQL schema

- **Intent:** replace the Day-1 placeholder with real accounts: bcrypt hashes,
  server-side sessions, CSRF, lockout, audit trail, and the five product tables.
- **Prompt (summary):** "Implement login/logout, bcrypt, MySQL sessions with
  rotation, HttpOnly/Secure cookies, expiry and rate limiting, CSRF protection,
  active-account checks on every request, no trust in client role/user id, no
  public admin creation, a safe demo seed, and tests for login success, invalid
  passwords, logout, disabled accounts, session expiry and privilege escalation.
  Document the schema and env vars."
- **Result:** `server/src/auth/*`, `server/src/http/routes/{auth,admin}.ts`,
  `server/src/scripts/seed.ts`, `database/migrations/0002_auth_documents.sql`,
  client login/session/audit UI, `docs/DATABASE.md`, 49 new tests.
- **Verification:** 132 server tests + 12 client tests pass; both migrations,
  the seed and the full login/CSRF/logout flow were executed against a
  throwaway MySQL 8.0.46 instance.

#### Real findings (not hypothetical)

1. **Timezone bug that unit tests could not see.** After seeding, login returned
   200 but `/api/auth/me` immediately returned 401 `SESSION_INVALID` and the
   session row already had `revoked_at`. Cause: the seed wrote
   `password_changed_at` with SQL `NOW()` (MySQL session zone +05:30) while the
   pool read timestamps as UTC, so the password change appeared 5.5 hours in the
   future and every session looked stale. Fix: pin `SET time_zone = '+00:00'` on
   every pooled connection and write JS `Date` objects instead of `NOW()`.
   Lesson: an in-memory store cannot catch a clock-frame mismatch; one real
   database run can.
2. **Three Day-1 migration tests failed** because they hard-coded "exactly one
   migration exists". They now discover the migration files and assert against
   that list, so adding a migration no longer breaks the suite.
3. **One client test asserted the wrong default** (called `fetchAuditLogs()`
   with no arguments but expected `limit=15`). The test was wrong, not the code;
   it now passes explicit arguments.
4. **`bcryptjs` 3.0.3 ships its own types**, so `@types/bcryptjs` was checked and
   deliberately not installed.
5. **Verification harness, not application, failures:** PowerShell mangled
   inline JSON passed to `curl.exe` (empty responses), so request bodies were
   moved to files; and an early run mixed the cookie from one login with the CSRF
   token from another, producing two false 403/200 failures. Both were fixed in
   the harness, and the final run is 100% green.
6. **Sandbox guardrail:** two write attempts used a mistyped workspace path and
   were refused before anything was written outside the workspace. The policy
   also blocked an accidental overwrite of `auth.css` with a fragment; the rule
   was appended instead.

#### Design corrections made during review

| Generated idea | Why it changed |
|---|---|
| Store only a hash of the CSRF token | The SPA must recover the token after a reload via `/me`; a plaintext synchroniser token is useless without the HttpOnly cookie, so it is stored as-is and documented |
| Return 403 for a disabled account at login | Would confirm the account exists; login returns the same generic 401 as a wrong password. A *live session* for a disabled account still gets 403 `ACCOUNT_DISABLED` |
| Add a public `register` endpoint | Removed entirely. The seed script is the only path that creates an admin, which satisfies "no public admin registration" by construction |
| Widen `users.role` directly to the new enum | Existing `'user'` rows would fail the conversion, so the migration widens, relabels `user` → `viewer`, then narrows |
| In-memory rate limiting only | Kept for the demo, but account lockout in MySQL covers multi-instance behaviour; the limitation is recorded as T23 |

### Entry 7 — Day 3: document management

- **Intent:** let users upload, discover, search, inspect, download, edit and
  soft-delete documents, with authorization enforced on every operation and
  bytes kept in private storage.
- **Prompt (summary):** "Implement document upload, listing, search by name /
  owner / category / date, metadata, protected downloads, permitted metadata
  edits and soft delete. Private storage, server-generated keys, content
  validation, no public links, authorization on every call. Owners see their own
  documents; others need an active grant. Add tests for uploads, invalid files,
  unauthorized listings and direct download attempts."
- **Result:** `server/src/documents/{types,file-validation,storage,document-store,document-service}.ts`,
  `server/src/http/routes/documents.ts`, `database/migrations/0003_document_management.sql`,
  `client/src/lib/documents.ts`, `client/src/components/{DocumentsPanel,DocumentUploadForm,DocumentEditDialog}.tsx`,
  `client/src/documents.css`, plus 40 server tests and 10 client tests.
- **Verification:** 172 server tests, 22 client tests, both builds, and a 31-check
  end-to-end run against real MySQL + a real storage directory.

#### Real findings (this was not clean on the first try)

1. **Two TypeScript errors that look unrelated but are not.** `ReadStream` is
   exported by `node:fs`, not `node:stream`; and mysql2's `ExecuteValues` rejects
   `unknown[]`, so the dynamic filter array is typed
   `Array<string | number | Date>`. Both were caught by `tsc` before any test ran.
2. **A test helper silently broke 29 tests.** `uploadPdf` was declared `async`,
   so it returned `Promise<Response>` and supertest's `.expect(...)` no longer
   existed — 34 type errors and 29 runtime failures that had nothing to do with
   the feature. Fixed by returning the supertest `Test` (a thenable) directly.
3. **Adding a field to the root index broke an exact-match test.** The Day-1
   health test compares the whole root JSON; adding `documents` failed it. The
   expectation was updated — a reminder that exact-equality assertions on
   evolving payloads are brittle.
4. **The end-to-end harness failed twice before the app did.** PowerShell
   mangled inline JSON passed to `curl.exe` (`INVALID_JSON`, 400), and a single
   typo — `X-CSRF-Token=` instead of `:` — produced a 403 and an empty document
   id, cascading into four false failures. Both were harness bugs; bodies now go
   through files and headers use the correct separator. Final run: 0 failures.
5. **Incidental dependency bump.** Installing `multer` moved `vitest` from 3.2.7
   to 5.0.5 in both workspaces. The whole suite was re-run on 5.0.5 (172 + 22
   passing) rather than assuming compatibility.

#### Design decisions worth defending

| Decision | Why |
|---|---|
| `multer.memoryStorage()` for a single file | Bounded by `MAX_UPLOAD_BYTES`; avoids temp-file cleanup bugs. Streaming to disk is the next step if the ceiling grows |
| Content before extension | The extension is a hint a user controls; magic bytes and UTF-8 validation are the actual gate |
| Storage key `yyyy/mm/<uuid>.<ext>` | No user input, no collisions, `wx` writes make overwrites impossible, `ymm` keeps directories small |
| `404` for "no access" | Distinguishing 403 from 404 would confirm a document exists to a stranger |
| Soft delete keeps bytes | Recovery beats reclamation for a demo; a purge job is explicit future work |
| No share endpoint yet | Scope discipline: the authorization path is implemented and tested, and a grant can be inserted by SQL until Day 4 builds sharing |

---

### Entry 8 — Day 4: document-level authorization and immediate revocation

- **Intent:** deliver document-level permissions with instantaneous revocation and admin separation.
- **Prompt (summary):** "Implement document authorization: owners have full control; readers may view/download; editors may view/download/edit; only owner can grant/revoke; admins do not automatically have permission to read document contents; access is denied by default. Check DB permission on every request, prevent IDOR, ensure immediate revocation blocking the viewer's next request, and add integration tests covering IDOR, direct API downloads, read-only edit attempts, unauthorized deletion, permission escalation, revocation, and admin isolation."
- **Result:** `database/migrations/0004_document_permission_roles.sql`, updated `server/src/documents/{document-service,activity-service,document-store}.ts`, `server/tests/document-authorization.test.ts`, client share dialog & UI.
- **Verification:** `server/tests/document-authorization.test.ts` (7 integration tests passing), total 192 server tests passing.

#### Design decisions worth defending

| Decision | Why |
|---|---|
| Strip admin from document access predicate | In security-first products, administrators manage infrastructure and governance, but have zero business reading confidential user document contents without explicit grants |
| Dynamic DB-checked permissions on every call | Never cache permission decisions in memory or JWT claims; immediate revocation guarantees the recipient is blocked on their very next request |
| Distinguish 404 vs 403 on edit/delete | Strangers get 404 (preventing document existence discovery); authenticated viewers attempting edit/delete get 403 `DOCUMENT_FORBIDDEN` |

---

### Entry 9 — Day 5: tamper-evident audit trail and administrator dashboard

- **Intent:** implement a tamper-evident append-only security audit trail, cryptographic hash chaining, periodic checkpoints, and an administrator dashboard for governance, filtering, and cross-tenant permission history.
- **Prompt (summary):** "Record: login success/failure, document uploads, views, downloads, edits, deletions, permission grants/revocations, denied document-access attempts, account activation/deactivation, and administrative actions. Each event records event ID, actor ID, action, document ID, target user ID, outcome (success/denied/failure), timestamp, request ID, safe metadata. No passwords, tokens, cookies, or contents. Prevent ordinary users from updating/deleting logs (triggers). Implement tamper-evidence (hash chain, checkpoints). Explain limitations if privileged attacker rewrites DB. Ensure denied requests are logged without leaking document metadata. Admin dashboard with search/filter, permission history, and no automatic document-reading access. Add tests for audit creation, denied attempts, and log modification attempts. Update THREATS.md and PROMPTS.md."
- **Result:**
  - Database: `database/migrations/0005_audit_tamper_evidence.sql` (expanded outcome enum, `target_user_id`, `request_id`, `prev_hash`, `entry_hash`, `audit_checkpoints` table, `BEFORE UPDATE` and `BEFORE DELETE` triggers).
  - Cryptography: `server/src/auth/audit-crypto.ts` (`canonicalJson`, `computeEntryHash`, `computeCheckpointHash`, `GENESIS_HASH`).
  - Auth & Stores: `server/src/auth/auth-store.ts`, `server/tests/support/in-memory-auth-store.ts`, `server/src/auth/auth-service.ts` (account activation/deactivation, hash chaining, integrity verification, checkpoint anchoring, filter clauses).
  - Activity & Documents: `server/src/documents/document-service.ts`, `activity-service.ts`, `server/src/app.ts`, `server/src/http/routes/{documents,document-insights,admin,auth}.ts` (denial logging, lifecycle event auditing, `requestId` correlation).
  - Frontend: `client/src/lib/admin.ts`, `client/src/pages/AdminPage.tsx` (multi-field filter toolbar, tamper-evidence status badge, checkpoint anchoring, permission history tab, user activation/deactivation actions).
  - Tests: `server/tests/audit-trail.test.ts`.
- **Verification:** All 11 server test files (197 tests) passing; all 3 client test files (22 tests) passing; `tsc --noEmit` passing with 0 errors across workspaces; `npm run build` passing for client and server.

#### Real findings

1. **Category validation in tests:** The initial upload test in `audit-trail.test.ts` passed `category: 'financial'`, which returned 422 because the domain schema restricts categories to `['general', 'contract', 'invoice', 'report', 'identity', 'other']`. Correcting to `'contract'` satisfied validation and verified that domain constraints remain strictly enforced.
2. **Account deactivation revocation semantics:** Calling `setUserStatus(id, false)` in the admin service proactively revokes all live sessions for that user. Consequently, the user's existing cookie returns 401 `SESSION_INVALID` immediately (or 403 `ACCOUNT_DISABLED` if an unrevoked token were used), terminating all active browser sessions instantly.
3. **Trigger syntax in migration files:** MySQL `CREATE TRIGGER` statements without `BEGIN ... END` do not require custom `DELIMITER` blocks and are split cleanly by our zero-dependency SQL statement parser into atomic DDL statements.

#### Design decisions worth defending

| Decision | Why |
|---|---|
| Database triggers for immutability | Defense-in-depth: Even if application logic has a vulnerability or developer error, the MySQL engine raises `SQLSTATE '45000'` on any raw UPDATE or DELETE targeting audit records |
| Canonical JSON recursive key sorting | JavaScript object key order is non-deterministic across engines/runtimes; `canonicalJson` recursively sorts keys so identical payloads always produce identical SHA-256 hashes |
| Checkpoints table anchoring | A continuous hash chain alone can be recomputed from any point forward; periodic checkpoints record `(checkpoint_seq, last_log_id, last_entry_hash, entry_count)` so past history cannot be spliced without checkpoint mismatch |
| Zero sensitive metadata in audit | Passwords, session secrets, CSRF tokens, and document byte streams are strictly excluded; IP addresses are stored as HMAC digests; denied requests record error codes only |
| Admin isolation invariant | Administrators can view metrics, audit records, accounts, and cross-tenant permission history, but cannot download or inspect private document contents |

---

### Entry 10 — Day 5: Independent application-security review (read-only)
- **Date:** 2026-10-20
- **Intent:** Conduct a rigorous, independent application-security assessment across source code, schema, storage architecture, routes, middleware, and tests without modifying the codebase.
- **Prompt (summary):** "Act as an independent application-security reviewer for TrustVault. Inspect the actual source code, MySQL schema, API routes, storage configuration and automated tests. Search for 13 threat areas: IDOR, missing authorization middleware, permission escalation, revocation failures, public file URLs, unsafe uploads/path traversal, SQL injection, session/CSRF/cookie weaknesses, audit tampering, revocation race conditions, metadata leakage, disabled accounts, and insecure deployment configuration. For every finding provide file/function, attack scenario, CVSS severity, evidence, recommended fix, and regression test. Separate verified vulnerabilities from unverified suspicions. Do not modify files."
- **Result:** Formal application-security review report delivered. 4 verified findings identified (2 Medium, 2 Low). 9 categories verified fully mitigated. Zero files modified.
- **Human review:** Confirmed all 4 findings directly against the codebase before scheduling fixes.
- **Verification:** Inspection of all routes, middleware, stores, schema migrations 0001–0005, and bootstrap scripts against the 197 server + 22 client test baseline.

---

### Entry 11 — Day 5: Vulnerability remediation, regression testing, and submission hardening
- **Date:** 2026-10-20
- **Intent:** Fix confirmed vulnerabilities identified during the security review, add automated regression tests for each finding, update documentation, and prepare the final production release.
- **Prompt (summary):** "Finish the TrustVault five-day hackathon submission. Verify each security finding against the code. Fix confirmed vulnerabilities. Add regression tests for every confirmed finding. Run the full test suite and production builds. Deploy and configure environment variables, TLS, cookies, CORS, and CSRF protection. Create demo accounts using a safe seed procedure. Complete README, THREATS, PROMPTS, API documentation, deployment instructions, demo script, and write-up. Make meaningful Git commits."
- **Result:**
  - **F1 (Monolithic DB Privileges):** Updated `database/bootstrap.sql` to separate the migration user (`trustvault_deploy` with DDL) from the runtime user (`trustvault` with DML on operational tables and strictly `SELECT, INSERT` on audit tables).
  - **F2 (Password Spraying):** Implemented dual-tier rate limiting in `server/src/app.ts` and `server/src/http/routes/auth.ts`: Tier-1 global per-IP ceiling (`max = LOGIN_RATE_LIMIT_MAX * 3 = 30`) and Tier-2 per-(IP+email) limit (`max = 10`).
  - **F3 (Cross-Tenant Title Leakage):** Updated `server/src/documents/activity-store.ts` (`historyForManager`) and `server/tests/support/in-memory-activity-store.ts` with conditional `CASE` expression masking non-permitted titles to `[Restricted]` for admins.
  - **F4 (Revocation Stream Boundary):** Documented the residual limitation in `THREATS.md` and added regression assertion proving that revocation blocks the next request immediately.
  - **Regression Test Suite:** Added `server/tests/security-regression.test.ts` with 5 automated integration tests.
  - **Full Suite Passing:** 12 server test files (202 tests) + 3 client test files (22 tests) green.
  - **Artifacts Completed:** `DEMO_SCRIPT.md`, `docs/DESIGN_DECISIONS.md`, updated `docs/API.md`, updated `THREATS.md`, updated `README.md`.
- **Verification:** `npm test` passing with 224 total tests; `npm run typecheck` passing with 0 errors; `npm run build` passing with clean production artifacts.

#### Real findings during remediation
1. **Accidental variable scope error in test double:** When modifying `InMemoryDocumentActivityStore` for Finding 3, an edit referenced `viewer` inside `historyForDocument` where `viewer` was out of scope. The Vitest suite immediately caught this with an HTTP 500 error in `tests/sharing.test.ts`, preventing broken test infrastructure.
2. **TypeScript typing on in-memory audit double:** `AuditLogEntry.id` is typed as `string`, while internal `toActivity` expected `number | string`. `tsc --noEmit` caught this before runtime.
3. **Execution time of rate-limit regression tests:** Exercising the Tier-1 rate limiter requires sequentially issuing 31 HTTP requests to trigger the 30-request ceiling. The test takes ~11–13 seconds, which is a necessary and justified cost for testing rate limit enforcement without mocking.

#### Design decisions worth defending
| Decision | Why |
|---|---|
| Tier-1 IP rate limit threshold at 3× per-email max | Setting the IP ceiling equal to the per-account ceiling would cause false positives on corporate NATs with multiple legitimate users; 3× provides headroom while stopping bulk horizontal spraying |
| Explicit '[Restricted]' title token | Distinguishes intentional metadata privacy protection from missing data or database errors |
| Privilege-level immutability | Database triggers provide row-level logic, but restricting DDL and UPDATE/DELETE at the MySQL user privilege level prevents dropping triggers |

---

### Entry 12 — Production database connection crash in `mysql2/promise` pool connection event
- **Date:** 2026-10-21
- **Intent:** Fix the Render production crash where the API started, verified the database, and immediately threw `"You have tried to call .then(), .catch(), or invoked await on the result of query that is not a promise"`.
- **Prompt (summary):** "URGENT: Fix the Render production crash in TrustVault. The Render log shows: 'You have tried to call .then(), .catch(), or invoked await on the result of query that is not a promise.' Inspect the database pool and connection modules, standardize on mysql2/promise, preserve TiDB compatibility, add a regression test for startup database initialization, and run all checks."
- **Root Cause:** In `server/src/db/pool.ts`, `createMysqlPool` from `mysql2/promise` forwards events from the core pool using `inheritEvents`. In core `mysql2`, `connection` passed to `pool.on('connection')` is the core callback connection. Calling `connection.query("SET time_zone = '+00:00'").catch(() => {})` invoked `Query.prototype.catch()`, which is a stub getter in core `mysql2` that intentionally throws the error.
- **Result:**
  - Updated `server/src/db/pool.ts` to call `connection.promise().query("SET time_zone = '+00:00'").catch(() => {})` with a safe callback fallback and try/catch error wrapper.
  - Added regression tests in `server/tests/db-and-storage.test.ts` verifying event handling on core callback connection objects.
  - Confirmed 0 TypeScript errors and all tests green.
- **Commit:** `50b0f8a fix(db): resolve non-promise query crash on pool connection event`

---

### Entry 13 — Remove email delivery completely and transition to secure in-app invitations
- **Date:** 2026-10-21
- **Intent:** Eliminate all external email provider dependencies (Resend, Gmail SMTP/Nodemailer) and unverified domain errors to keep operating costs at zero, while preserving the complete, secure workspace invitation workflow using in-app invitation links.
- **Prompt (summary):** "Remove email functionality completely while preserving the secure document-sharing and invitation workflow as much as possible. Remove Resend and Gmail SMTP/Nodemailer dependencies, packages, and env vars. Replace email invitations with in-app invitations: generate unpredictable one-way hashed tokens, display the invitation link to the inviter with a 'Copy Invitation Link' button, enforce token expiry, one-time use, recipient email verification, and revocation. Update tests, docs, and the production build."
- **Result:**
  - **Removed email packages:** Uninstalled `nodemailer`, `resend`, `@types/nodemailer`; updated `server/package.json` and lockfile.
  - **Removed dead code:** Deleted `server/src/email/`, `server/scripts/test-smtp.ts`, and `server/tests/email-service.test.ts`.
  - **Environment clean-up:** Removed `SMTP_*`, `RESEND_API_KEY`, `MAIL_FROM` from `server/src/config/env.ts`; retained `frontendUrl` for formatting invitation links.
  - **In-App invitation delivery:** Updated `AuthService.inviteMember` to return the unhashed raw token to the inviter once, while the database records only `SHA-256(rawToken)`.
  - **UI enhancements:** Updated `WorkspaceMembersPage.tsx` with a "Create Invitation" form and a prominent "Invitation Link Created" card featuring an instant "Copy Invitation Link" button.
  - **Recipient verification intact:** Existing `/register?invite=...` and `/login?invite=...` flows continue to enforce strict recipient email matching, 7-day expiration, and one-time acceptance.
  - **Automated test suite:** Replaced mock email tests with comprehensive in-app invitation tests in `server/tests/workspace-and-invitations.test.ts`. 283 tests passing across client and server.
- **Verification:** `npm run typecheck` (0 errors), `npm test` (15 server suites / 252 tests + 4 client suites / 31 tests = 283 passed), `npm run build` (clean Vite + tsc bundle).

---

### Entry 14 — Fix SPA deep-linking 404 on `/register?invite=...`, database-backed revocation persistence, and member removal permissions cleanup
- **Date:** 2026-10-21
- **Intent:** Fix deep-link 404 on invitation URLs opened directly in new browser tabs/refresh on Render Static Sites, resolve reappearing revoked invitations/members on reload, clean up document permissions upon member removal, and provide an account-switching UX for mismatched invitations.
- **Prompt (summary):** "Fix Bug 1: When I create an invitation, copy the invitation link, and open it using another account, the URL looks like `/register?invite=<token>`, but the browser displays a plain 'Not Found' page. Bug 2: When I revoke an invitation or access, the UI reports success, but after refreshing or reopening Members & Invitations, old users or invitations appear again. Bug 3: Invitation acceptance, workspace membership, invitation status, and revocation may not be consistently connected to persistent database state. Implement a dedicated invitation acceptance screen that reads the token safely, handle wrong recipients, partition active vs past invitations in the UI, ensure revocation and removal are backed by authoritative database queries, and add comprehensive regression tests."
- **Root Causes:**
  1. **Static Host SPA 404:** Render Static Site serves raw files; direct navigation to `/register?invite=...` returned 404 because no `register/index.html` static file existed and no rewrite route rule was active on the host.
  2. **Revocation Re-Appearance:** `listCompanyInvitations(companyId)` in MySQL returns all workspace invitations regardless of status (`pending`, `revoked`, `accepted`, `expired`). The UI mapped over all returned rows under "Pending Invitations" with a Revoke button without filtering by status. Furthermore, mutation handlers in `WorkspaceMembersPage.tsx` did not check `res.ok`, performed optimistic state removal, and failed to refetch authoritative data with `await loadData()`.
  3. **Document Access Retention:** Removing a member from a workspace (`company_id = NULL`) did not delete grants in `document_permissions` for that user on company documents.
  4. **Seeding Member Resurrection:** `seed.ts` executed `company_id = COALESCE(company_id, DEMO_COMPANY_ID)` for existing accounts, re-attaching removed members upon deployment reboot.
- **Result:**
  - **SPA Fallback & Static Routes:**
    - Created `render.yaml` with rewrite rule `source: /*, destination: /index.html`.
    - Added `client/public/_redirects` (`/* /index.html 200`).
    - Added `client/scripts/postbuild.js` to pre-generate physical directory entrypoints (`dist/register/index.html`, `dist/login/index.html`, `dist/accept-invite/index.html`, `dist/workspace/members/index.html`, etc.) along with `dist/404.html` and `dist/200.html`.
  - **UI Partitioning & Mutation Handlers:**
    - Filtered `invitations` in `WorkspaceMembersPage.tsx` into active `pendingInvitations` (`status === 'pending' && expiresAt > now`) and `pastInvitations` ("Invitation History" with clear badges: Accepted, Revoked, Expired, and no Revoke button).
    - Added "Copy Link" action on every pending invitation row.
    - Updated `handleRevokeInvite`, `handleRemoveMember`, and `handleChangeRole` to verify `res.ok`, display server error envelopes, and invoke `await loadData()`.
  - **Backend Persistence & Immediate Enforcement:**
    - Updated `AuthService.revokeInvitation` to reject revoking already-accepted invitations with 400 `INVITATION_ALREADY_ACCEPTED`.
    - Added `removeCompanyMember(userId, companyId)` in `MySqlAuthStore` to set `company_id = NULL` and purge rows in `document_permissions` for that user on that company's documents.
    - Updated `seed.ts` to preserve existing accounts' cleared `company_id`.
  - **Account Mismatch Screen:**
    - When an authenticated user visits `/register?invite=...` with a mismatched email, `RegisterPage.tsx` displays an account mismatch warning with a "Sign Out & Switch Account" button.
  - **Automated Tests:**
    - Added 3 new integration tests in `server/tests/workspace-and-invitations.test.ts` (17 tests total):
      - Verifying revocation persistence across fresh database reads and rejecting revoke of accepted invitations.
      - Confirming removed members lose session and access to company documents and downloads (404).
      - Enforcing that unauthorized users (unauthenticated or viewers) cannot revoke invitations or remove members.
    - Added client test in `client/src/lib/workspace.test.ts` testing state partitioning.
- **Verification:**
  - `npm run typecheck`: 0 errors.
  - `npm test`: 19 test files, 287 tests passed (15 server suites / 255 tests + 4 client suites / 32 tests = 287 passing).
  - `npm run build`: Clean production bundle (tsc + Vite + postbuild fallbacks).




