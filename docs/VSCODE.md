# Running TrustVault in VS Code

Everything you need, in the order you need it. Commands are PowerShell, which is
the default terminal in VS Code on Windows. macOS/Linux equivalents are noted
where they differ.

Open the repository folder in VS Code, then press <kbd>Ctrl</kbd>+<kbd>`</kbd> to
open the integrated terminal. All commands below run from the repository root.

---

## 0. One-time check

```powershell
node --version    # v22.12.0 or newer
npm --version     # 10.x or newer
```

If `node` is missing, install the LTS build from nodejs.org and reopen VS Code
(so the terminal picks up the new PATH).

---

## 1. Install dependencies

```powershell
npm install
```

Expected: `added N packages` with no `ERR!` lines. One install covers both
workspaces (`client/`, `server/`).

> **If npm fails with `EPERM` while writing its cache**, your machine is
> restricting npm's global cache directory. Point the cache at a folder you own:
>
> ```powershell
> $env:npm_config_cache = "$PWD\.npm-cache"
> npm install
> ```
>
> `.npm-cache/` is git-ignored. This is an environment workaround, not a project
> requirement.

---

## 2. Create your `.env`

```powershell
Copy-Item .env.example .env
```

Then generate a real session secret and paste it in:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Edit `.env` (VS Code: <kbd>Ctrl</kbd>+<kbd>P</kbd> → `.env`) and set:

```ini
SESSION_SECRET=<the 64-character value you just generated>
DATABASE_PASSWORD=<your MySQL app password>
```

`.env` is git-ignored. Do not commit it, and do not paste its contents into
chat tools.

---

## 3. Create the database and user

Follow [database/README.md](../database/README.md#1-create-the-database-and-user).
Short version (the README has the password-generating one-liner):

```powershell
$sql = @"
CREATE DATABASE IF NOT EXISTS ``trustvault`` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'trustvault'@'localhost' IDENTIFIED BY 'YOUR_PASSWORD_HERE';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON ``trustvault``.* TO 'trustvault'@'localhost';
FLUSH PRIVILEGES;
"@
$sql | mysql -u root -p
```

`mysql` asks for the **root** password interactively. Then put the app password
in `.env` as `DATABASE_PASSWORD`.

Verify MySQL is reachable:

```powershell
mysql -u trustvault -p -e "SELECT 1 AS ok;" trustvault
```

---

## 4. Apply the migrations

```powershell
npm run migrate:status
```

Expected:

```
TrustVault migrations
  command   : status
  directory : ...\database\migrations
  database  : trustvault@127.0.0.1:3306/trustvault

  0001_foundation                    pending   -                          9a1c...
  0 applied, 1 pending, 0 drifted, 0 missing.
```

Then:

```powershell
npm run migrate:dry     # optional: print the plan, change nothing
npm run migrate
```

Expected: `Applied 0001_foundation (2 statement(s), N ms)` followed by
`Applied 1 migration(s).`

Run `npm run migrate:status` again — `0001_foundation` should now say `applied`,
and exit code 0.

> If this says `ER_ACCESS_DENIED_ERROR`, the `DATABASE_USER`/`DATABASE_PASSWORD`
> in `.env` do not match the MySQL user. If it says `ECONNREFUSED`, MySQL is not
> running (`Get-Service MySQL80`).

---

## 5. Start the app

### Option A — one command, both servers

```powershell
npm run dev
```

```
[api] TrustVault API listening on http://0.0.0.0:4000
[web] VITE v7.x  ready in 320 ms
[web] ➜  Local:   http://localhost:5173/
```

### Option B — two terminals (easier to read logs)

Terminal 1:

```powershell
npm run dev:server
```

Terminal 2 (click the `+` in the terminal panel):

```powershell
npm run dev:client
```

Open <http://localhost:5173>. Both status cards should say **Operational**, and
the Request ID rows show the id each response returned.

---

## 6. Verify the API directly

```powershell
curl.exe http://localhost:4000/api/health
```

```powershell
curl.exe http://localhost:4000/api/health/database
```

Check the status code of the readiness probe:

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:4000/api/health/database
```

`200` = database reachable. `503` = reachable API, unreachable database (see the
`.env` and migration steps above).

---

## 7. Run the checks a reviewer will run

```powershell
npm run typecheck     # both packages, no emit
npm test              # server suite (Vitest + Supertest), then client
npm run build         # server tsc + client vite build
```

To run a single suite:

```powershell
npm run test:server -- tests/health.test.ts
```

---

## 8. Debug with breakpoints

Press <kbd>F5</kbd> and choose **API: debug (tsx)**. The API starts under the
debugger with `.env` loaded; breakpoints in `server/src/**` bind directly to the
TypeScript source (no build step).

To debug the client, start `npm run dev` first, then run **Client: Chrome**.

---

## 9. Useful VS Code tasks

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> runs the default build task
(`dev: all`). All tasks:

| Task | Equivalent command |
|------|--------------------|
| `dev: all` | `npm run dev` |
| `test: all` | `npm test` |
| `typecheck` | `npm run typecheck` |
| `migrate` | `npm run migrate` |
| `migrate:status` | `npm run migrate:status` |

---

## 10. Stop and clean up

- Stop the servers with <kbd>Ctrl</kbd>+<kbd>C</kbd> in the terminal running them.
- Before committing: `git status` — `.env`, `node_modules/`, `dist/` and
  `server/storage/` must **not** appear as staged files.

```powershell
git status --short
git add .
git commit -m "feat: day 1 foundation (api, db, client, tests, docs)"
```

---

## Command cheat sheet

| Goal | Command |
|------|---------|
| Install | `npm install` |
| Both dev servers | `npm run dev` |
| API only | `npm run dev:server` |
| Client only | `npm run dev:client` |
| Type check | `npm run typecheck` |
| Test | `npm test` |
| Build | `npm run build` |
| Run built API | `npm start` |
| Migration status | `npm run migrate:status` |
| Migration dry run | `npm run migrate:dry` |
| Apply migrations | `npm run migrate` |
| New secret | `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` |
| Port in use? | `Get-NetTCPConnection -LocalPort 4000` |
| MySQL running? | `Get-Service MySQL80` |
