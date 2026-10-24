# TrustVault — Architecture & Design Decisions Write-up

This document outlines the core authorization model, architectural decisions, mistakes identified during AI-assisted development, and residual unfinished work for the TrustVault hackathon project.

---

## 1. The TrustVault Permission Model

TrustVault enforces a strict, zero-knowledge, document-level authorization architecture:

- **Access is Denied by Default**: Any request lacking an authenticated session or an explicit database grant is rejected immediately.
- **Ownership Sovereignty**: 
  - The user who uploads a document becomes its exclusive `owner`.
  - Owners possess full control: viewing, downloading, modifying metadata, soft-deleting, and granting or revoking collaborator access.
  - Only the owner (and explicitly designated co-owners) can grant or revoke permissions.
- **Granular Roles**:
  - `viewer`: Authorized to view document metadata and stream downloads. Cannot modify metadata, delete, or manage access.
  - `editor`: Authorized to view metadata, stream downloads, and update permitted metadata fields (`title`, `description`, `category`). Cannot delete or manage permissions.
  - `owner` (co-owner grant): Holds full administrative control over the document alongside the primary owner.
- **Administrative Isolation Invariant**:
  - Platform administrators (`role: 'admin'`) manage user accounts, monitor system health, inspect governance audit events, and enforce platform security.
  - **Administrators do NOT have automatic access to read, view, or download private document contents.**
  - If an administrator attempts to access a document without an explicit owner grant, the API returns `404 Not Found`, preserving complete confidentiality of tenant documents.
- **Immediate Revocation Guarantee**:
  - Authorization is verified against live database state on **every single request**.
  - Permission grants are never cached in memory or embedded in client-side JWT claims.
  - When an owner revokes access, the deletion takes effect atomically within a database transaction; the revoked user's next HTTP request is blocked with `404 Not Found`.

---

## 2. Key Design Decisions & Trade-offs

### 2.1 Server-Side Database Sessions vs. Stateless JWTs
- **Decision:** TrustVault uses stateful MySQL sessions with 32-byte cryptographically secure random tokens stored in `HttpOnly; SameSite=Lax; Secure` cookies.
- **Rationale:** Stateless JWTs cannot be revoked instantly without maintaining a distributed denylist, which defeats the primary purpose of statelessness. A stolen JWT remains valid until its expiration timestamp. With MySQL-backed sessions, deactivating an account or logging out revokes the session in real time across all nodes.
- **Trade-off:** Requires a database query per authenticated request. For the target scale, this is optimized via indexes on `token_hash` and UTC timestamp comparisons.

### 2.2 Streaming File Downloads vs. Pre-Signed S3 URLs
- **Decision:** Files are streamed through authenticated Express endpoints (`GET /api/documents/:id/download`) rather than generating pre-signed cloud URLs.
- **Rationale:** Once a pre-signed URL is issued, it cannot be revoked until its TTL expires. An adversary holding a pre-signed URL can download files even after an owner revokes access. Routing downloads through the API guarantees authorization is evaluated immediately before the first byte leaves disk.

### 2.3 Pure JavaScript `bcryptjs` vs. Native C++ Bindings
- **Decision:** Chosen `bcryptjs` with configurable work factor (`BCRYPT_COST = 12`).
- **Rationale:** Native packages (`bcrypt`, `argon2`) require `node-gyp`, Python, and C++ compilers, introducing build flakiness across Windows, Linux, and container environments. `bcryptjs` provides identical cryptographic compatibility, zero native build dependencies, and predictable compilation.

### 2.4 Forward-Only Additive Migrations Without Rollbacks
- **Decision:** The custom migration runner (`server/src/db/migrate.ts`) supports `migrate up`, `migrate status`, and `migrate dry-run`, but deliberately omits a `migrate down` or rollback command.
- **Rationale:** In fast-paced hackathons and production deployments, destructive rollback commands (`DROP TABLE`) introduce massive human-error risk. Schema changes are forward-only; any fix is implemented as an explicit, additive subsequent migration.

### 2.5 Dual-Tier Login Rate Limiting
- **Decision:** A two-tier rate limiter in `server/src/app.ts`:
  1. *Tier 1 (Global IP Ceiling):* Throttles overall requests from a single IP address (30 requests / 15 min).
  2. *Tier 2 (Per IP + Email):* Enforces tight account-level throttling (10 requests / 15 min).
- **Rationale:** A single-dimension composite key (`${req.ip}|${email}`) is vulnerable to horizontal password spraying, where an attacker tests one password across thousands of accounts without exceeding per-account limits. The dual-tier architecture neutralizes both spray attacks and targeted brute forcing.

---

## 3. AI Mistakes Caught During Development

During the AI-assisted pair programming sessions across the five days, rigorous manual code review and automated test suites identified several subtle AI-generated bugs:

1. **Clock Frame Mismatch (SQL `NOW()` vs. Node.js UTC):**
   - *What happened:* The AI drafted seed and session logic using SQL `NOW()`. MySQL evaluated `NOW()` in the server's local timezone (+05:30), while the Node.js connection pool interpreted timestamps in UTC (`Z`).
   - *Consequence:* Newly issued sessions appeared 5.5 hours in the past relative to `password_changed_at`, resulting in immediate revocation and `401 SESSION_INVALID` loops.
   - *Fix:* Pinned `SET time_zone = '+00:00'` across all pooled connections and mandated writing JavaScript UTC `Date` objects.

2. **Hardcoded Test Invariant Assumptions:**
   - *What happened:* The Day-1 migration test suite hardcoded the assertion that "exactly 1 migration file exists."
   - *Consequence:* Adding Day-2 and Day-3 migrations broke the test suite, not because the migration runner failed, but because the test assumption was rigid.
   - *Fix:* Refactored migration tests to dynamically discover and assert against migration files in disk order.

3. **Cross-Tenant Document Title Leakage via Admin Join:**
   - *What happened:* In `historyForManager`, the AI drafted a SQL query joining `documents` without conditional title masking for administrator roles.
   - *Consequence:* While admins could not read document contents, they could see sensitive document titles across all tenants.
   - *Fix:* Replaced direct projection with `CASE WHEN d.owner_id = ? OR p.user_id IS NOT NULL THEN d.title ELSE '[Restricted]' END AS document_title`.

4. **Composite-Only Rate Limiting Key:**
   - *What happened:* The login rate limiter generated keys combining `${req.ip}|${email}`.
   - *Consequence:* Allowed horizontal password spraying from a single IP against many distinct email targets.
   - *Fix:* Implemented dual-tier rate limiting with an independent global IP ceiling.

5. **Test Double Scope Bug in In-Memory Store:**
   - *What happened:* During test refactoring, an AI edit referenced an out-of-scope `viewer` parameter inside `historyForDocument`.
   - *Consequence:* Vitest caught an immediate 500 runtime error in `sharing.test.ts`.
   - *Fix:* Restored separate signatures for document history vs. manager history.

---

## 4. Unfinished Work & Honest Residual Limitations

To adhere to the principle of reporting all incomplete work honestly:

1. **In-Flight Download Stream Revocation Boundary:**
   - Revocation guarantees that any new HTTP request is blocked with `404 Not Found`. However, if a user has already initiated a download of a large file (e.g., 500 MB) and permission is revoked while the stream is actively piping, the active socket completes. Revocation cannot recall bytes already transmitted.
2. **In-Memory Rate Limiting:**
   - The current rate limiter tracks buckets in Node.js process memory. In a multi-instance horizontally scaled deployment, an external shared cache (Redis) is required to synchronize rate limit counters across instances. Account lockout in MySQL compensates for this across instances.
3. **Storage Quotas:**
   - Global file size ceilings (`MAX_UPLOAD_BYTES = 10MB`) are enforced, but per-user or per-organization storage quotas are not yet implemented.
4. **Single Database Instance:**
   - The hackathon architecture connects to a single MySQL master. Read replication, automated failover, and point-in-time recovery tooling remain planned production enhancements.
5. **Client-Side End-to-End Encryption:**
   - Files are stored with access-control isolation on the server filesystem. True client-side zero-knowledge encryption (where the server cannot decrypt document bytes under any circumstances) was deliberately omitted to support server-side search, format validation, and collaborative sharing.
