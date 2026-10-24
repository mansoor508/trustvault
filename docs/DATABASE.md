# Database schema

MySQL 8, InnoDB, `utf8mb4_0900_ai_ci`. Five product tables plus the migration
ledger. All timestamps are UTC `DATETIME(3)`; the pool sets `timezone: 'Z'`.

Managed by **forward-only migrations** in [`database/migrations/`](../database/migrations):

| Migration | Adds |
|-----------|------|
| `0001_foundation.sql` | `users`, `sessions` |
| `0002_auth_documents.sql` | auth columns, `documents`, `document_permissions`, `audit_logs` |

```
users 1 ──── n sessions             (ON DELETE CASCADE)
users 1 ──── n documents            (ON DELETE RESTRICT)
users 1 ──── n document_permissions (ON DELETE CASCADE)
documents 1 ─ n document_permissions(ON DELETE CASCADE)
users 1 ──── n audit_logs           (ON DELETE SET NULL)
```

---

## `users`

One row per account. The only place a password hash exists.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `CHAR(36)` PK | UUID from `crypto.randomUUID()` |
| `email` | `VARCHAR(320)` UNIQUE | Stored lowercase; the collation is case-insensitive anyway |
| `password_hash` | `VARCHAR(255)` | bcrypt (`$2b$12$…`); never plaintext, never returned |
| `password_changed_at` | `DATETIME(3)` NULL | Sessions created before this timestamp are rejected |
| `display_name` | `VARCHAR(80)` NULL | Optional label |
| `role` | `ENUM('admin','owner','viewer')` | Default `viewer` |
| `is_active` | `TINYINT(1)` | Checked on **every** authenticated request |
| `failed_login_count` | `INT UNSIGNED` | Reset on success; drives lockout |
| `locked_until` | `DATETIME(3)` NULL | Set when the failure threshold is reached |
| `last_login_at` | `DATETIME(3)` NULL | Last successful sign-in |
| `created_at`, `updated_at` | `DATETIME(3)` | `updated_at` maintains itself |

Indexes: `PRIMARY (id)`, `UNIQUE uq_users_email (email)`.

**Role semantics**

| Role | Meaning |
|------|---------|
| `admin` | Full system access, including the audit trail. Created only by the seed script, never by an API call. |
| `owner` | May create and manage documents they own or co-own. |
| `viewer` | Read-only access to documents explicitly shared with them. |

`role` is **never** accepted from a request body, header or query. Login reads it
from this table, and every authorization decision uses that database value.

---

## `sessions`

Server-side sessions. The browser holds an opaque token in an HttpOnly cookie;
this table holds only its SHA-256 hash, so a database dump cannot be replayed.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `CHAR(36)` PK | Session id (internal) |
| `user_id` | `CHAR(36)` FK → `users.id` | `ON DELETE CASCADE` |
| `token_hash` | `CHAR(64)` UNIQUE | SHA-256 of the cookie token |
| `csrf_token` | `CHAR(64)` NULL | Per-session synchroniser token (hex). NULL = legacy row, forced re-login |
| `ip_hash` | `CHAR(64)` NULL | HMAC-SHA256 of the client IP with `SESSION_SECRET` |
| `user_agent` | `VARCHAR(255)` NULL | Truncated at write time |
| `created_at` | `DATETIME(3)` | Session start |
| `last_seen_at` | `DATETIME(3)` | Updated at most once a minute |
| `expires_at` | `DATETIME(3)` | Absolute expiry (`SESSION_TTL_HOURS`) |
| `revoked_at` | `DATETIME(3)` NULL | Set on logout, expiry, disablement or password change |

Indexes: `PRIMARY (id)`, `UNIQUE uq_sessions_token_hash (token_hash)`,
`idx_sessions_user_id (user_id)`, `idx_sessions_expires_at (expires_at)`,
`idx_sessions_user_revoked (user_id, revoked_at)`.

**Lifecycle**

| Event | Effect |
|-------|--------|
| Login | New row, new id, new token, new CSRF token. Any session presented on the login request is revoked first (fixation defence). |
| Request | Token → SHA-256 → row lookup → revoked? → absolute expiry? → idle timeout? → password changed after creation? → account active? |
| Idle | `now - last_seen_at > SESSION_IDLE_MINUTES` revokes and rejects |
| Absolute | `now ≥ expires_at` revokes and rejects (`SESSION_TTL_HOURS`) |
| Logout | `revoked_at` set; cookie cleared |
| Account disabled | All of that user's sessions revoked on the next request |
| Password change | Sessions created before `password_changed_at` rejected |

**Why hash the token?** A leaked backup or SQL injection that reads `sessions`
yields hashes, not usable cookies. The CSRF token is stored in plaintext on
purpose: the client must read it back from `/api/auth/me` after a reload, and it
is useless without the HttpOnly cookie.

---

## `documents`

Metadata only — bytes live in private storage, never in MySQL.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `CHAR(36)` PK | |
| `owner_id` | `CHAR(36)` FK → `users.id` | `ON DELETE RESTRICT` so deleting a user cannot silently destroy their documents |
| `title` | `VARCHAR(200)` | |
| `description` | `VARCHAR(2000)` NULL | |
| `file_name` | `VARCHAR(255)` | Original name, display only |
| `storage_key` | `VARCHAR(255)` UNIQUE | Server-generated opaque path; a client can never propose one |
| `mime_type` | `VARCHAR(127)` | Validated on upload (Day 3) |
| `size_bytes` | `BIGINT UNSIGNED` | |
| `checksum_sha256` | `CHAR(64)` NULL | Integrity check |
| `status` | `ENUM('active','archived')` | |
| `created_at`, `updated_at`, `deleted_at` | `DATETIME(3)` | Soft delete via `deleted_at` |

Indexes: `PRIMARY (id)`, `UNIQUE uq_documents_storage_key (storage_key)`,
`idx_documents_owner_status (owner_id, status, created_at)`,
`idx_documents_deleted_at (deleted_at)`.

---

## `document_permissions`

Explicit grants. Ownership is implied by `documents.owner_id`; this table adds
co-owners and viewers.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `CHAR(36)` PK | |
| `document_id` | `CHAR(36)` FK → `documents.id` | `ON DELETE CASCADE` |
| `user_id` | `CHAR(36)` FK → `users.id` | `ON DELETE CASCADE` |
| `role` | `ENUM('owner','viewer')` | `owner` can manage shares; `viewer` is read-only |
| `granted_by` | `CHAR(36)` NULL FK → `users.id` | `ON DELETE SET NULL` keeps the grant |
| `created_at`, `updated_at` | `DATETIME(3)` | |

Indexes: `PRIMARY (id)`, `UNIQUE uq_document_permissions_document_user
(document_id, user_id)`, `idx_document_permissions_user_role (user_id, role)`,
`idx_document_permissions_granted_by (granted_by)`.

The unique key makes duplicate grants impossible and gives Day 3 a clean
`INSERT … ON DUPLICATE KEY UPDATE` upsert.

**Effective access rule (Day 3 will implement it in SQL)**

```sql
SELECT d.*
  FROM documents d
  LEFT JOIN document_permissions p
         ON p.document_id = d.id AND p.user_id = ?
 WHERE d.deleted_at IS NULL
   AND (d.owner_id = ? OR p.user_id IS NOT NULL);
```

Admins bypass the predicate; everyone else gets owner-or-grant. The user id in
that query always comes from the session row, never from the request.

---

## `audit_logs`

Append-only security trail. No `UPDATE` or `DELETE` path exists in the codebase.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `BIGINT UNSIGNED` PK AUTO_INCREMENT | Ordering is insertion order |
| `user_id` | `CHAR(36)` NULL FK → `users.id` | `ON DELETE SET NULL` keeps the event after the account is gone |
| `action` | `VARCHAR(64)` | `login_success`, `login_failed`, `login_locked`, `login_denied`, `logout`, `session_denied`, `demo_seed` |
| `outcome` | `ENUM('success','failure')` | |
| `resource_type` | `VARCHAR(32)` NULL | e.g. `session`, `user`, `document` |
| `resource_id` | `VARCHAR(64)` NULL | Not a FK: ids may be deleted or non-user resources |
| `ip_hash` | `CHAR(64)` NULL | HMAC of the address, never the address |
| `user_agent` | `VARCHAR(255)` NULL | |
| `metadata` | `JSON` NULL | Small, non-sensitive context (e.g. failure reason) |
| `created_at` | `DATETIME(3)` | |

Indexes: `PRIMARY (id)`, `idx_audit_user_created (user_id, created_at)`,
`idx_audit_action_created (action, created_at)`,
`idx_audit_resource (resource_type, resource_id)`.

Audit writes never fail the request: a database error is logged, not surfaced,
so an audit outage cannot lock everyone out. That trade-off is deliberate and
noted in `THREATS.md`.

---

## `schema_migrations`

Owned by the migration runner, not by application code.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `VARCHAR(128)` PK | e.g. `0002_auth_documents` |
| `checksum` | `CHAR(64)` | SHA-256 of the normalized SQL; drift is a hard error |
| `applied_at` | `DATETIME(3)` | |
| `execution_ms` | `INT UNSIGNED` | |

---

## Constraints and why they exist

| Constraint | Threat it closes |
|------------|------------------|
| `UNIQUE users.email` | Duplicate accounts / ambiguous login |
| `UNIQUE sessions.token_hash` | Token collision or replay of two rows |
| `UNIQUE document_permissions(document_id, user_id)` | Duplicate grants that confuse revocation |
| `UNIQUE documents.storage_key` | Two documents overwriting the same file |
| `FK sessions.user_id … CASCADE` | Orphan sessions that still authenticate |
| `FK documents.owner_id … RESTRICT` | Accidental mass deletion of documents with a user |
| `FK audit_logs.user_id … SET NULL` | Losing history when a user is deleted |
| `ENUM role` values | Unknown roles cannot be stored, so `requireRole` can be exact |

## Schema verification

- `npm run migrate` applies both migrations; `npm run migrate:status` reports
  `2 applied, 0 pending, 0 drifted, 0 missing`.
- Verified against MySQL **8.0.46** on Windows: both migrations applied, tables
  and indexes created, foreign keys accepted.
- The migration runner tests cover drift, lock contention, dry-run and statement
  splitting; auth flows are covered by 27 HTTP-level tests against an in-memory
  store with identical semantics.

## Timezone invariant (learned the hard way)

`DATETIME` has no timezone, so the application must impose one:

1. The pool tells mysql2 that every `DATETIME` it reads is UTC (`timezone: 'Z'`).
2. Every pooled connection runs `SET time_zone = '+00:00'`, so server-side
   expressions such as `NOW()` and `CURRENT_TIMESTAMP` also produce UTC.
3. Application code writes JavaScript `Date` objects rather than SQL `NOW()` for
   any timestamp that is later compared (`password_changed_at`, session times).

All three are required. Before the fix, the demo seed wrote
`password_changed_at` with `NOW()` on a MySQL server whose session time zone was
+05:30 while the driver read it back as UTC. The value appeared 5.5 hours in the
future, so every session created after seeding was rejected as "older than the
password change" — login succeeded and `/me` returned 401 one second later.
Unit tests with an in-memory store could not catch it; the end-to-end run against
a real MySQL 8 instance did.

---

# Day 3 additions — documents

Migration [`0003_document_management.sql`](../database/migrations/0003_document_management.sql)
is additive:

| Change | Why |
|--------|-----|
| `documents.category ENUM('general','contract','invoice','report','identity','other') NOT NULL DEFAULT 'general'` | A closed category set keeps filtering and search predictable |
| `idx_documents_category_created (category, created_at)` | Category filters are always ordered by date |
| `idx_documents_owner_deleted (owner_id, deleted_at)` | The owner branch of the access predicate stays off a full scan |
| `idx_documents_created_at (created_at)` | Date-range filters and newest-first listing |

## How a document row is used

| Column | Role in the product |
|--------|---------------------|
| `owner_id` | Implicit full access for that user; `ON DELETE RESTRICT` protects files |
| `storage_key` | Server-generated path, unique; never returned by the API |
| `file_name` | Display only; sanitized, never used as a path |
| `checksum_sha256` | Integrity check computed from the bytes actually stored |
| `category` | Filter and search facet |
| `deleted_at` | Soft delete; every query adds `deleted_at IS NULL` |
| `status` | `active`/`archived` reserved for a later archive feature |

## The access predicate, in one place

```sql
-- used by list, count and find, with the viewer id and role coming from the
-- authenticated session (never from the request)
WHERE d.deleted_at IS NULL
  AND (? = 'admin' OR d.owner_id = ? OR p.user_id IS NOT NULL)
```

`p` is `LEFT JOIN document_permissions p ON p.document_id = d.id AND p.user_id = ?`.
The `CASE` expression in the same query derives `access_mode`:
`admin` → `owner` → `co-owner` → `viewer`, so the API can tell a read-only grant
from a managing one without a second query.

## Soft delete semantics

- `DELETE` sets `deleted_at` and `updated_at`; the row and the file remain.
- Every read path filters `deleted_at IS NULL`, so the document disappears from
  lists, metadata and downloads immediately.
- File bytes are retained for recovery; purging is a scheduled job, not a
  user-triggered action.
- `document_permissions` rows are left in place, so a restore would restore
  sharing too.

## Share grants

`document_permissions` is the authorization source for non-owners:

```sql
INSERT INTO document_permissions (id, document_id, user_id, role, granted_by)
VALUES (UUID(), ?, ?, 'viewer', ?);
```

`role` is `viewer` (read/download) or `owner` (co-owner: edit/delete as well).
The unique key `(document_id, user_id)` prevents duplicate grants. A sharing
endpoint is Day 4 work; the authorization path is already enforced and tested,
and grants can be inserted by an operator for a demo.
