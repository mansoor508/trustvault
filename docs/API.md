# API reference — Day 1 surface

Base URL locally: `http://localhost:4000`
All responses are `application/json; charset=utf-8`.

Only the endpoints below exist today. Anything else returns the standard 404
envelope — there are no hidden or partially wired routes.

---

## Conventions

### Request IDs

Every response includes:

```
X-Request-Id: 6f1c1c2e-1a1f-4a37-9e55-2f6f0f1f9a11
```

- If the caller sends `X-Request-Id` matching `^[A-Za-z0-9._:-]{8,128}$`, it is
  echoed (useful for tracing a checkout flow across services).
- Anything else — too short, spaces, newlines, 500 characters — is discarded and
  replaced with a fresh UUID, so a hostile value cannot forge or split a log line.
- The same id is in the JSON body as `requestId` and in every server log line for
  that request.

### Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "requestId": "…",
    "details": [{ "path": "email", "message": "Invalid email address" }]
  }
}
```

`details` appears only for client-safe 4xx errors (for example Zod validation).
5xx responses in production contain a generic message and no details; the real
cause is logged with the request id.

| Code | Status | Meaning |
|------|--------|---------|
| `VALIDATION_ERROR` | 422 | Request body/params failed schema validation |
| `INVALID_JSON` | 400 | Body was not parseable JSON |
| `PAYLOAD_TOO_LARGE` | 413 | Body exceeded 64 kb |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Unsupported charset/encoding |
| `NOT_FOUND` | 404 | No route matches |
| `ORIGIN_NOT_ALLOWED` | 403 | Browser `Origin` is not in `CLIENT_ORIGINS` |
| `CONFLICT` | 409 | Unique/foreign-key conflict |
| `SERVICE_UNAVAILABLE` | 503 | Database or dependency unavailable |
| `INTERNAL_ERROR` | 500 | Unhandled failure (details are logged, not returned) |

### CORS

Only exact origins from `CLIENT_ORIGINS` are allowed. Allowed origins are echoed
in `Access-Control-Allow-Origin` with `Access-Control-Allow-Credentials: true`.
Requests with no `Origin` header (curl, uptime monitors, server-to-server) are
not cross-origin and pass through.

Preflight (`OPTIONS`) is answered with `204` for allowed origins and a `403`
envelope for everything else.

---

## `GET /`

Small service index, convenient for a platform's first smoke test.

```bash
curl http://localhost:4000/
```

```json
{
  "service": "trustvault-api",
  "version": "0.1.0",
  "health": "/api/health",
  "databaseHealth": "/api/health/database"
}
```

---

## `GET /api/health`

**Liveness.** Proves the Node process is up and serving. It does **not** touch
MySQL — a database blip must not cause a platform restart loop.

| | |
|---|---|
| Success | `200` |
| Cache | `Cache-Control: no-store` |
| Side effects | none |

```bash
curl -i http://localhost:4000/api/health
```

```json
{
  "status": "ok",
  "service": "trustvault-api",
  "version": "0.1.0",
  "environment": "development",
  "uptimeSeconds": 42.13,
  "timestamp": "2026-10-20T05:12:00.000Z",
  "requestId": "6f1c1c2e-1a1f-4a37-9e55-2f6f0f1f9a11"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `status` | `"ok"` | Always `ok` on 200 |
| `service` | string | `trustvault-api` |
| `version` | string | Matches `server/src/config/service-info.ts` |
| `environment` | `development \| test \| production` | From `NODE_ENV` |
| `uptimeSeconds` | number | Process uptime, 2 decimals |
| `timestamp` | ISO-8601 | UTC |
| `requestId` | string | Same as the `X-Request-Id` header |

Use this for the platform's **liveness** probe and as a free uptime check.

---

## `GET /api/health/database`

**Readiness.** Runs `SELECT 1` through the mysql2 pool with a 2 second ceiling.

| | |
|---|---|
| Success | `200` — `status: "ok"`, `database.status: "up"` |
| Failure | `503` — `status: "error"`, `database.status: "down"` |
| Cache | `Cache-Control: no-store` |

Healthy:

```json
{
  "status": "ok",
  "check": "database",
  "database": { "status": "up", "latencyMs": 2.71 },
  "timestamp": "2026-10-20T05:12:00.000Z",
  "requestId": "0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
}
```

Unavailable (HTTP **503**):

```json
{
  "status": "error",
  "check": "database",
  "database": { "status": "down", "latencyMs": 2001.4, "code": "ECONNREFUSED" },
  "timestamp": "2026-10-20T05:12:00.000Z",
  "requestId": "0b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
}
```

`database.code` is a **bounded driver code only** — `ECONNREFUSED`,
`ER_ACCESS_DENIED_ERROR`, `ETIMEDOUT`, `TIMEOUT`, `ER_NO_SUCH_TABLE` — never a raw
driver message, host, user or SQL fragment.

Alias: `GET /api/health/db`.

### Which probe should the platform use?

| Platform setting | Endpoint | Why |
|------------------|----------|-----|
| Liveness / restart | `/api/health` | A DB outage must not restart a healthy process |
| Readiness / traffic | `/api/health/database` | Stop routing traffic to an instance that cannot query |
| Uptime monitor | `/api/health` | Cheapest, no DB load |

---

## Sample session

```powershell
# 1. Is the API alive?
curl.exe -s http://localhost:4000/api/health

# 2. Can it reach MySQL? (expects 200 after `npm run migrate`)
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:4000/api/health/database

# 3. Trace a request end to end
curl.exe -i -H "X-Request-Id: demo-trace-0001" http://localhost:4000/api/health

# 4. See the 404 envelope
curl.exe -i http://localhost:4000/api/nope
```

---

## Not implemented yet

---

# Sharing & Permissions (Day 4)

Document-level authorization. Access is denied by default.
Permission model:
- **Owner**: Full control (upload, read, download, edit metadata, soft delete, grant/revoke permissions).
- **Editor**: Granted by owner. Can view, download, and edit metadata. Cannot delete or manage permissions.
- **Viewer**: Granted by owner. Can view and download. Cannot edit or delete.
- **Admin**: System governance only. **Does NOT have automatic access to read or download document contents.**

## `GET /api/documents/stats`

Returns aggregated document statistics for the authenticated user.

| Property | Value |
|----------|-------|
| Auth | Session (`HttpOnly` cookie) |
| Allowed Roles | `owner`, `viewer`, `admin` |
| Scope | Documents owned by user OR explicitly granted to user |

`200`:
```json
{
  "stats": {
    "totalDocuments": 5,
    "totalBytes": 1048576,
    "ownedCount": 3,
    "sharedCount": 2,
    "byCategory": [
      { "category": "contract", "count": 2 },
      { "category": "report", "count": 3 }
    ]
  }
}
```

## `GET /api/documents/:id/permissions`

Lists all user permission grants on a specific document.

| Property | Value |
|----------|-------|
| Auth | Session (`HttpOnly` cookie) |
| Required Role | Document Owner only (`d.owner_id = user.id`) |
| Non-owner Behavior | `404 DOCUMENT_NOT_FOUND` (stranger) or `403 DOCUMENT_FORBIDDEN` (viewer/editor) |

`200`:
```json
{
  "permissions": [
    {
      "userId": "usr_viewer_01",
      "email": "viewer@trustvault.local",
      "displayName": "Vera Viewer",
      "role": "viewer",
      "grantedBy": { "id": "usr_owner_01", "email": "owner@trustvault.local" },
      "createdAt": "2026-10-20T10:00:00.000Z"
    }
  ]
}
```

## `POST /api/documents/:id/permissions`

Grant or update a user's permission role on a document. Immediately enforced on subsequent requests.

| Property | Value |
|----------|-------|
| Auth | Session (`HttpOnly` cookie) |
| CSRF | Required (`X-CSRF-Token` header) |
| Required Role | Document Owner only |
| Permitted Roles to Grant | `owner` (co-owner), `editor`, `viewer` |

Request Body:
```json
{
  "email": "colleague@trustvault.local",
  "role": "viewer"
}
```

| Status | Code | When |
|--------|------|------|
| 200 | (Success) | Permission granted/updated; returns updated permissions list |
| 403 | `DOCUMENT_FORBIDDEN` | Caller is not the document owner |
| 404 | `USER_NOT_FOUND` | Target email does not exist |
| 422 | `INVALID_GRANT` | Target user is already the document owner |
| 422 | `USER_INACTIVE` | Target user account is deactivated |

## `DELETE /api/documents/:id/permissions/:userId`

Revokes a user's permission on a document. Takes effect immediately—the user's next request to view, edit, or download will fail with `404 DOCUMENT_NOT_FOUND`.

| Property | Value |
|----------|-------|
| Auth | Session (`HttpOnly` cookie) |
| CSRF | Required (`X-CSRF-Token` header) |
| Required Role | Document Owner only |

| Status | Code | When |
|--------|------|------|
| 200 | (Success) | Permission revoked; returns updated permissions list |
| 403 | `DOCUMENT_FORBIDDEN` | Caller is not document owner |
| 404 | `PERMISSION_NOT_FOUND` | Target user had no grant on this document |
| 422 | `INVALID_REVOKE` | Cannot revoke the document owner's access |

## `GET /api/documents/:id/access-history`

Paginated audit history of all access and permission events for a single document.

| Property | Value |
|----------|-------|
| Auth | Session (`HttpOnly` cookie) |
| Required Role | Document Owner only |

Query Parameters: `limit` (default 25), `offset` (default 0).

`200`:
```json
{
  "entries": [
    {
      "id": "104",
      "action": "document.downloaded",
      "outcome": "success",
      "actorId": "usr_viewer_01",
      "actorEmail": "viewer@trustvault.local",
      "documentId": "doc_01",
      "documentTitle": "Confidential NDA",
      "metadata": { "sizeBytes": 1024 },
      "createdAt": "2026-10-20T11:00:00.000Z"
    }
  ],
  "pagination": { "limit": 25, "offset": 0, "total": 1 }
}
```

## `GET /api/access-history`

Cross-document access history for all documents the authenticated user manages or owns.

| Property | Value |
|----------|-------|
| Auth | Session (`HttpOnly` cookie) |
| Required Role | `owner` or `admin` |
| Title Redaction | Non-permitted document titles are masked as `[Restricted]` for `admin` |

---

# Administration & Audit Integrity (Day 5)

Administrative endpoints provide platform governance, tamper-evident audit inspection, and user lifecycle control without granting document content read access.

## `GET /api/admin/overview`

System-wide operational metrics and activity counters.

| Property | Value |
|----------|-------|
| Auth | Session (`HttpOnly` cookie) |
| Required Role | `admin` only (`403 FORBIDDEN` for owner/viewer) |

`200`:
```json
{
  "overview": {
    "users": 12,
    "activeUsers": 11,
    "documents": 48,
    "deletedDocuments": 3,
    "totalBytes": 15420912,
    "activeSessions": 6,
    "auditEvents": 342,
    "grants": 18
  }
}
```

## `GET /api/admin/users`

Directory listing of all user accounts with account status and document ownership counts.

| Property | Value |
|----------|-------|
| Auth | Session (`HttpOnly` cookie) |
| Required Role | `admin` only |

## `PATCH /api/admin/users/:id/status`

Activate or deactivate a user account. Deactivation immediately invalidates all active sessions for that user.

| Property | Value |
|----------|-------|
| Auth | Session (`HttpOnly` cookie) |
| CSRF | Required (`X-CSRF-Token` header) |
| Required Role | `admin` only |

Request Body:
```json
{ "isActive": false }
```

| Status | Code | When |
|--------|------|------|
| 200 | (Success) | Status updated; target sessions revoked |
| 404 | `USER_NOT_FOUND` | Account does not exist |
| 422 | `CANNOT_DEACTIVATE_SELF` | Admin cannot deactivate their own account |

## `GET /api/admin/audit-logs`

Search and filter tamper-evident audit logs.

| Property | Value |
|----------|-------|
| Auth | Session (`HttpOnly` cookie) |
| Required Role | `admin` only |

Query Parameters:
- `actor`: Filter by actor User ID or email address
- `documentId`: Filter by target document UUID
- `action`: Filter by action prefix (e.g., `document.%`, `login%`)
- `outcome`: `success`, `failure`, or `denied`
- `from`, `to`: Date bounds (`YYYY-MM-DD`)
- `limit` (default 25), `offset` (default 0)

`200`:
```json
{
  "entries": [
    {
      "id": "210",
      "userId": "usr_viewer_01",
      "targetUserId": null,
      "action": "document.download_denied",
      "outcome": "denied",
      "resourceType": "document",
      "resourceId": "doc_01",
      "ipHash": "a1b2c3d4...",
      "userAgent": "Mozilla/5.0 ...",
      "requestId": "req_12345678",
      "metadata": { "reason": "DOCUMENT_NOT_FOUND" },
      "prevHash": "3f4e5a...",
      "entryHash": "9b8c7d...",
      "createdAt": "2026-10-20T12:00:00.000Z"
    }
  ],
  "pagination": { "limit": 25, "offset": 0, "total": 1 }
}
```

## `GET /api/admin/audit-logs/verify`

Verifies the cryptographic SHA-256 hash chain and checkpoint integrity from genesis.

| Property | Value |
|----------|-------|
| Auth | Session (`HttpOnly` cookie) |
| Required Role | `admin` only |

`200`:
```json
{
  "verified": true,
  "totalEntries": 210,
  "checkedCheckpoints": 4,
  "lastVerifiedHash": "9b8c7d6e..."
}
```

If tampered or spliced:
```json
{
  "verified": false,
  "totalEntries": 210,
  "checkedCheckpoints": 4,
  "lastVerifiedHash": "3f4e5a...",
  "failureReason": "Hash chain broken at event 185: prevHash does not match previous entryHash",
  "failedAtId": "185"
}
```

## `POST /api/admin/audit-logs/checkpoint`

Anchors a new cryptographic checkpoint committing to `(checkpointSeq, lastLogId, lastEntryHash, entryCount)`.

| Property | Value |
|----------|-------|
| Auth | Session (`HttpOnly` cookie) |
| CSRF | Required (`X-CSRF-Token` header) |
| Required Role | `admin` only |

## `GET /api/admin/audit-logs/checkpoints`

Lists all historical cryptographic checkpoints in reverse chronological order.

| Property | Value |
|----------|-------|
| Auth | Session (`HttpOnly` cookie) |
| Required Role | `admin` only |


---

# Authentication (Day 2)

Cookie-based, server-side sessions. The browser holds an opaque token in an
HttpOnly cookie; MySQL holds only its SHA-256 hash, plus a per-session CSRF
token.

| Cookie attribute | Development | Production |
|------------------|-------------|------------|
| `HttpOnly` | yes | yes |
| `Secure` | no (plain HTTP) | **yes** |
| `SameSite` | `Lax` (configurable) | `Lax` (configurable) |
| `Path` | `/` | `/` |
| `Max-Age` / `Expires` | derived from `SESSION_TTL_HOURS` | same |

## `POST /api/auth/login`

```json
{ "email": "admin@trustvault.local", "password": "…" }
```

Any `role`, `userId` or `isActive` field in the body is **ignored** — identity
and role come from the database row only.

`200`:

```json
{
  "user": { "id": "…", "email": "admin@trustvault.local", "displayName": "Ava Admin", "role": "admin", "isActive": true },
  "session": { "csrfToken": "…64 hex…", "createdAt": "2026-10-20T09:00:00.000Z", "expiresAt": "2026-10-20T21:00:00.000Z" }
}
```

Plus `Set-Cookie: tv_session=…; HttpOnly; SameSite=Lax; Path=/`.

| Status | Code | When |
|--------|------|------|
| 401 | `INVALID_CREDENTIALS` | Unknown email, wrong password or disabled account — identical response |
| 422 | `VALIDATION_ERROR` | Malformed body |
| 429 | `RATE_LIMITED` | Too many attempts for this IP + email |
| 429 | `ACCOUNT_LOCKED` | Account locked after repeated failures (`Retry-After` is set) |

## `GET /api/auth/me`

Requires the session cookie. Returns the same `{ user, session }` shape, which
is how the SPA recovers its CSRF token after a page reload.

| Status | Code | When |
|--------|------|------|
| 401 | `NOT_AUTHENTICATED` | No cookie |
| 401 | `SESSION_INVALID` | Unknown, revoked, or password changed since login |
| 401 | `SESSION_EXPIRED` | Past `SESSION_TTL_HOURS` |
| 401 | `SESSION_IDLE_TIMEOUT` | Unused longer than `SESSION_IDLE_MINUTES` |
| 403 | `ACCOUNT_DISABLED` | Account deactivated after login (all sessions revoked) |

## `POST /api/auth/logout`

Requires the session cookie **and** `X-CSRF-Token`. Revokes the session row, then
clears the cookie.

- `204 No Content` on success.
- `403 CSRF_TOKEN_INVALID` if the header is missing or wrong.
- `401` with an already-invalid session.

## `GET /api/admin/audit-logs?limit=25&offset=0`

Admin only (`role = 'admin'` from the database). `limit` 1–100, `offset` ≥ 0.

```json
{
  "entries": [
    { "id": "42", "userId": "…", "action": "login_success", "outcome": "success", "resourceType": "session", "resourceId": "…", "ipHash": "…", "userAgent": "…", "metadata": null, "createdAt": "2026-10-20T09:00:00.000Z" }
  ],
  "pagination": { "limit": 25, "offset": 0, "total": 1 }
}
```

`403 FORBIDDEN` for any other role, with `details.requiredRoles: ["admin"]`.

## CSRF rules

- Applies to `POST`, `PUT`, `PATCH`, `DELETE` on authenticated routes.
- `X-CSRF-Token` must match this session's token (constant-time compare).
- If an `Origin` header is present it must be in `CLIENT_ORIGINS`.
- `SameSite=Lax` already blocks cross-site POSTs; the token is defence in depth
  for same-site subdomain and legacy-browser cases.

## Additional error codes

| Code | Status |
|------|--------|
| `NOT_AUTHENTICATED` | 401 |
| `INVALID_CREDENTIALS` | 401 |
| `SESSION_INVALID` | 401 |
| `SESSION_EXPIRED` | 401 |
| `SESSION_IDLE_TIMEOUT` | 401 |
| `ACCOUNT_DISABLED` | 403 |
| `FORBIDDEN` | 403 |
| `CSRF_TOKEN_INVALID` | 403 |
| `ACCOUNT_LOCKED` | 429 |
| `RATE_LIMITED` | 429 |

---

# Documents (Day 3)

Every endpoint below requires a session cookie. State-changing requests also
require `X-CSRF-Token`, checked before the request body is even parsed.

**Access rule (applied in every query):**

> `admin` OR `documents.owner_id = session user` OR an active row in
> `document_permissions` for that document and user.

Documents with `deleted_at` set are invisible everywhere. A user with no access
gets `404`, never `403`: the API does not confirm that a document exists.

## `POST /api/documents`

`multipart/form-data`:

| Field | Required | Notes |
|-------|----------|-------|
| `file` | yes | exactly one file |
| `title` | no | defaults to the file name without extension, max 200 |
| `description` | no | max 2000 |
| `category` | no | `general` (default), `contract`, `invoice`, `report`, `identity`, `other` |

Accepted types are decided by **content**, not just the name: PDF (`%PDF-`),
PNG, JPEG, DOCX/XLSX/PPTX (ZIP container with the matching OOXML folder), and
UTF-8 text/Markdown/CSV (no NUL bytes, mostly printable). Extensions outside the
allow-list are rejected even if the bytes look plausible.

Limits: `MAX_UPLOAD_BYTES` (default 10 MiB), one file per request, 4 KB of form
fields.

`201`:

```json
{
  "document": {
    "id": "6e3e793b-a510-4b24-b94f-6bccb8da0c6d",
    "owner": { "id": "…", "email": "owner@trustvault.local", "displayName": "Owen Owner" },
    "title": "Quarterly report",
    "description": null,
    "fileName": "report.pdf",
    "category": "report",
    "mimeType": "application/pdf",
    "sizeBytes": 51,
    "checksumSha256": "…64 hex…",
    "status": "active",
    "createdAt": "2026-10-20T06:41:12.000Z",
    "updatedAt": "2026-10-20T06:41:12.000Z",
    "access": { "mode": "owner", "permissionRole": null }
  }
}
```

`access.mode` is one of `admin`, `owner`, `co-owner`, `viewer`. `storageKey` is
never part of any response.

| Status | Code | When |
|--------|------|------|
| 401 | `NOT_AUTHENTICATED` | no session |
| 403 | `CSRF_TOKEN_INVALID` | missing/wrong CSRF header |
| 413 | `PAYLOAD_TOO_LARGE` | file over the limit |
| 415 | `UNSUPPORTED_FILE_TYPE` | bad extension, MIME mismatch or content mismatch |
| 422 | `VALIDATION_ERROR` | no file, empty file, no extension, bad fields |

## `GET /api/documents`

Query parameters (all optional):

| Parameter | Notes |
|-----------|-------|
| `search` | substring of title or original file name, `%`/`_` escaped |
| `category` | one of the enum values |
| `owner` | substring of the owner's email or display name |
| `from`, `to` | `YYYY-MM-DD`, inclusive, UTC |
| `sort` | `created_at` (default), `title`, `size` |
| `order` | `desc` (default), `asc` |
| `limit` | 1–100, default 25 |
| `offset` | ≥ 0, default 0 |

```json
{
  "documents": [ { "id": "…", "title": "…", "owner": {}, "category": "report", "sizeBytes": 51, "createdAt": "…", "access": {} } ],
  "pagination": { "limit": 25, "offset": 0, "total": 1 }
}
```

## `GET /api/documents/:id`

Metadata only, same shape as one element above. `404` if deleted or not visible.

## `PATCH /api/documents/:id`

Body accepts any of `title`, `description` (string or `null`), `category`; at
least one is required. Allowed for `admin`, `owner` and `co-owner`. A `viewer`
grant gets `403 DOCUMENT_FORBIDDEN`.

## `DELETE /api/documents/:id`

Soft delete: sets `deleted_at`, keeps the row and the stored bytes for recovery.
Returns `204`. Allowed for the same roles as `PATCH`; a `viewer` gets `403`.

## `GET /api/documents/:id/download`

Authorizes first, then streams the bytes. Always:

- `Content-Disposition: attachment` with an ASCII fallback and RFC 5987 name
- `Cache-Control: no-store, private`
- `X-Content-Type-Options: nosniff`
- the exact stored MIME type

There is no public URL, no signed link and no redirect: every download is an
authorized, audited request. A deleted document returns `404`.

| Status | Code | When |
|--------|------|------|
| 401 | `NOT_AUTHENTICATED` | no session |
| 404 | `DOCUMENT_NOT_FOUND` | missing, deleted, or no access |
| 500 | `INTERNAL_ERROR` | metadata exists but the stored file is gone (logged) |

---

## Workspace & In-App Invitations

### `GET /api/workspace`
Returns the current authenticated user's workspace information.
- **Authentication**: Required (`owner`, `admin`, `editor`, `viewer`).
- **Response `200`**: `{ "company": { "id": "...", "name": "..." }, "isPersonal": false }`

### `POST /api/workspace`
Creates a new company workspace for a personal account. Creator becomes `owner`.
- **Authentication**: Required.
- **Headers**: `X-CSRF-Token`
- **Body**: `{ "companyName": "Acme Corp" }`
- **Response `201`**: `{ "user": { ... } }`

### `PATCH /api/workspace`
Updates workspace settings.
- **Authentication**: Required (`owner` only).
- **Headers**: `X-CSRF-Token`
- **Body**: `{ "name": "New Name", "domain": "acme.com" }`
- **Response `200`**: `{ "company": { ... } }`

### `GET /api/workspace/members`
Lists all members in the current workspace.
- **Authentication**: Required.
- **Response `200`**: `{ "members": [ { "id": "...", "email": "...", "role": "editor" } ] }`

### `DELETE /api/workspace/members/:userId`
Removes a member from the company workspace.
- **Authentication**: Required (`owner` or `admin`).
- **Headers**: `X-CSRF-Token`
- **Response `204`**: No content.

### `PATCH /api/workspace/members/:userId/role`
Updates a member's role (`admin`, `editor`, `viewer`).
- **Authentication**: Required (`owner` only).
- **Headers**: `X-CSRF-Token`
- **Body**: `{ "role": "editor" }`
- **Response `204`**: No content.

### `POST /api/workspace/invitations`
Creates an in-app workspace invitation. Generates an unpredictable one-time token whose SHA-256 hash is persisted in the database. Returns the one-time token and copyable URL to the inviter.
- **Authentication**: Required (`owner` or `admin`).
- **Headers**: `X-CSRF-Token`
- **Body**: `{ "email": "colleague@acme.com", "role": "editor" }`
- **Response `201`**:
  ```json
  {
    "invitation": {
      "id": "inv-...",
      "companyId": "cmp-...",
      "email": "colleague@acme.com",
      "role": "editor",
      "status": "pending",
      "token": "raw-secret-token",
      "expiresAt": "..."
    },
    "inviteUrl": "https://frontend/register?invite=raw-secret-token"
  }
  ```

### `GET /api/workspace/invitations`
Lists pending invitations for the caller's workspace. Does not expose the secret token (stored as SHA-256 hash).
- **Authentication**: Required (`owner` or `admin`).
- **Response `200`**: `{ "invitations": [ ... ] }`

### `DELETE /api/workspace/invitations/:id`
Revokes a pending workspace invitation immediately. Persists `status = 'revoked'` in the database.
- **Authentication**: Required (`owner` or `admin`).
- **Headers**: `X-CSRF-Token`
- **Response `204`**: No content.
- **Response `400`**: If invitation has already been accepted (`INVITATION_ALREADY_ACCEPTED`).
- **Response `404`**: If invitation does not exist in caller's workspace.

### `GET /api/workspace/invitations/verify`
Public preview of an invitation token.
- **Authentication**: None (public).
- **Query**: `token=<raw-token>`
- **Response `200`**:
  ```json
  {
    "email": "colleague@acme.com",
    "companyName": "Acme Corp",
    "role": "editor",
    "status": "pending",
    "expiresAt": "..."
  }
  ```

### `POST /api/workspace/invitations/accept`
Accepts a pending invitation and joins the workspace. Enforces that the authenticated user's email matches the invited email.
- **Authentication**: Required.
- **Headers**: `X-CSRF-Token`
- **Body**: `{ "token": "raw-secret-token" }`
- **Response `200`**: `{ "user": { ... } }`

### `DELETE /api/workspace/members/:userId`
Removes a member from the workspace. Resets user role to `owner` with `company_id = NULL`, revokes all active sessions for that user, and immediately deletes any document-level grants in `document_permissions` for that user across the company's documents.
- **Authentication**: Required (`owner` or `admin`). Workspace owner cannot be removed.
- **Headers**: `X-CSRF-Token`
- **Response `204`**: No content.

### `PATCH /api/workspace/members/:userId/role`
Updates a team member's role within the company workspace (`admin`, `editor`, `viewer`).
- **Authentication**: Required (`owner` only).
- **Headers**: `X-CSRF-Token`
- **Body**: `{ "role": "editor" }`
- **Response `204`**: No content.

