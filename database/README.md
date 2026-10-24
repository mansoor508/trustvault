# Database

Everything schema-related lives here. The API never creates tables on the fly;
it only reads and writes rows.

```
database/
├── bootstrap.sql          one-time database + least-privilege user (template)
├── migrations/            forward-only schema history (source of truth)
│   └── 0001_foundation.sql
└── seeds/                 optional local sample data (not required to boot)
```

## 1. Create the database and user

Pick a strong password and export it in your shell for the duration of the
command, so it never lands in a file or in your shell history:

**PowerShell (VS Code terminal)**

```powershell
$env:TV_DB_PASSWORD = -join ((1..32) | ForEach-Object { [char](Get-Random -InputObject (48..57 + 65..90 + 97..122)) })
$sql = @"
CREATE DATABASE IF NOT EXISTS ``trustvault`` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'trustvault'@'localhost' IDENTIFIED BY '$env:TV_DB_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON ``trustvault``.* TO 'trustvault'@'localhost';
FLUSH PRIVILEGES;
"@
$sql | & "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p
```

`mysql` prompts for the **root** password interactively; nothing is echoed into
the command line. Then put the generated password into `.env` as
`DATABASE_PASSWORD`.

**Bash (macOS/Linux/WSL)**

```bash
TV_DB_PASSWORD="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
mysql -u root -p -e "
CREATE DATABASE IF NOT EXISTS \`trustvault\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'trustvault'@'localhost' IDENTIFIED BY '${TV_DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON \`trustvault\`.* TO 'trustvault'@'localhost';
FLUSH PRIVILEGES;"
echo "DATABASE_PASSWORD=${TV_DB_PASSWORD}"
```

`database/bootstrap.sql` is the same bootstrap as a template, if you prefer a
file. It contains a placeholder password only — never commit a filled-in copy.

## 2. Run the migrations

From the repository root:

```powershell
npm run migrate:status   # what is applied, pending or drifted
npm run migrate:dry      # print the plan, change nothing
npm run migrate          # apply pending migrations
```

## How the migration system works

- **Files**: `NNNN_snake_case_name.sql`, applied in filename order.
- **Bookkeeping**: the runner creates `schema_migrations`
  (`id`, `checksum`, `applied_at`, `execution_ms`) on first use.
- **Checksums**: a SHA-256 of the normalized SQL is stored on apply. If a file
  changes afterwards, the runner aborts with a drift error instead of silently
  diverging from production.
- **Locking**: `GET_LOCK('trustvault_schema_migrations', 15)` is held on one
  dedicated connection, so two deploys cannot apply the same migration twice.
- **Forward-only**: there is no `down`/`reset` command. Fixes are new migration
  files. This is why the CLI cannot drop your data by accident.
- **No destructive SQL**: migrations are additive (`CREATE TABLE IF NOT
  EXISTS`). `DROP`, `TRUNCATE` and unscoped `DELETE` are not part of the
  workflow and must not be committed.
- **Statement splitting**: MySQL DDL is not transactional, so each statement is
  executed on its own. `;` inside strings/backticks is handled; stored
  procedures (which need `DELIMITER`) are intentionally unsupported.

## Rules for new migrations

1. Never edit an applied file — add `0002_documents.sql` instead.
2. One logical change per file.
3. Prefer `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN` so re-runs on a fresh
   local database stay predictable.
4. Timestamps are `DATETIME(3)` in UTC; the pool sets `timezone: 'Z'`.
5. Add indexes in the same migration that introduces the query pattern.
6. Test locally first: `npm run migrate:dry`, then `npm run migrate`.

## Seeds

`database/seeds/` is for optional local-only fixtures. Do not commit real user
records, password hashes or documents. The app boots and the health endpoints
pass with an empty database.

## Migrations included

| File | Adds |
|------|------|
| `0001_foundation.sql` | `users`, `sessions` |
| `0002_auth_documents.sql` | `users.password_changed_at`, `sessions.csrf_token`, `documents`, `document_permissions`, `audit_logs` |

`0002` is the first migration that changes an existing definition: Day 1 shipped
`ENUM('user','admin')` and the product needs `ENUM('admin','owner','viewer')`.
It widens the enum, relabels `user` → `viewer` (least privilege), then narrows
it again. It deletes no rows.

Full schema reference: [docs/DATABASE.md](../docs/DATABASE.md).

## Demo seed

```powershell
npm run seed                      # create missing demo accounts
npm run seed -- --rotate-passwords  # also issue new passwords
```

- Creates `admin@trustvault.local`, `owner@trustvault.local`,
  `viewer@trustvault.local`.
- Generates a strong password per account and prints it **once**; passwords are
  stored only as bcrypt hashes.
- Idempotent: existing accounts are updated, never duplicated.
- Refuses to run with `NODE_ENV=production` unless `SEED_ALLOW_PRODUCTION=true`.
- This script is the **only** way an administrator account is created. There is
  no public registration endpoint.

## Document storage layout (Day 3)

Bytes never live in MySQL and never under `client/`. The server generates the
key:

```
<STORAGE_DIR>/<yyyy>/<mm>/<document-uuid>.<extension>
example: server/storage/2026/10/6e3e793b-a510-4b24-b94f-6bccb8da0c6d.pdf
```

- The original filename is stored in `documents.file_name` for display only and
  is never used as a path.
- Keys match a strict pattern (`^\d{4}/\d{2}/<uuid>\.[a-z0-9]{1,8}$`) and are
  re-checked for containment before any filesystem call.
- Files are written with `flag: 'wx'` and mode `0600`, so a key can never be
  overwritten and only the service account can read it.
- `documents.storage_key` is unique; a duplicate key is a database error.
- Soft delete keeps the file. A purge job (Day 4/5) is what actually removes
  bytes.
