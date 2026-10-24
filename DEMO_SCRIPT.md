# TrustVault — Five-Minute Hackathon Demo Script

**Product:** TrustVault — Secure, zero-knowledge administrative document vault  
**Target Audience:** Hackathon judges & security evaluation panel  
**Total Target Time:** 5:00 minutes  

---

## Pre-Demo Checklist (0:00 Setup)

Before presenting, ensure:
1. Production builds exist: `npm run build`
2. Local or staging MySQL instance is running with all migrations applied (`0001` through `0005`)
3. Seed accounts created: `npm run seed`
4. Server and Client running: `npm run dev` (API on `:4000`, Client on `:5173`)
5. Two browser profiles or incognito sessions ready (one for Owner, one for Viewer/Admin)

---

## Timeline & Talking Points

### Minute 0:00 – 0:45: Context, Threat Model & Architecture
- **Action:** Open `http://localhost:5173` on the login screen.
- **Talking Points:**
  - "Welcome to TrustVault. In five days, we built a security-first document vault for sensitive organizational files."
  - "Most document systems suffer from three common architectural flaws: IDOR vulnerabilities, administrators who can silently read private files, and cached permissions that fail to revoke access in real time."
  - "TrustVault solves these with a zero-knowledge admin architecture, database-checked permissions on every request, tamper-evident hash-chained audit trails, and isolated private storage."

---

### Minute 0:45 – 1:30: Owner Flow & Secure Upload
- **Action:**
  1. Sign in as `owner@trustvault.local` with the seeded password.
  2. Point out session cookie flags in DevTools (`HttpOnly`, `SameSite=Lax`, `Secure` in production).
  3. Navigate to **Upload Document**.
  4. Upload `board_minutes_q3.pdf`, select category **Report**, title "Confidential Board Minutes Q3".
  5. Click **Upload**.
- **Talking Points:**
  - "Notice the file upload: the original filename is never stored on disk. The server validates structural magic bytes, assigns a cryptographic UUID key, writes with `0o600` permissions outside the web root, and records a SHA-256 integrity checksum."
  - "The owner dashboard immediately reflects updated storage metrics and document counts."

---

### Minute 1:30 – 2:30: Document Sharing & Zero-Trust Grants
- **Action:**
  1. Click **View** on the uploaded document.
  2. Click **Share** to open the permission modal.
  3. Enter `viewer@trustvault.local`, select role **Viewer**, click **Grant Access**.
  4. Open an incognito browser window.
  5. Log in as `viewer@trustvault.local`.
  6. Show that the document appears in the viewer's dashboard under **Shared with Me**.
  7. Click **Download** as the viewer. The file streams directly.
- **Talking Points:**
  - "Access is denied by default. Only the document owner can grant or revoke permissions."
  - "When the viewer downloads, there is no public URL or pre-signed link. The request passes through server-side authorization middleware, verifies live database permission, audits the download, and streams the bytes with `Cache-Control: no-store`."

---

### Minute 2:30 – 3:30: Immediate Revocation Proof (The Hackathon Test)
- **Action:**
  1. Return to the Owner window.
  2. Open the **Share** modal on the document and click **Revoke** next to `viewer@trustvault.local`.
  3. Switch back to the Viewer window immediately.
  4. Refresh the page or click **Download** again.
  5. The UI shows **Access Denied / 404 Not Found**.
- **Talking Points:**
  - "Notice that revocation is instantaneous. We do not use cached permissions, JWT authorization claims, or long-lived signed links."
  - "On the very next HTTP request, the viewer's access is blocked with a 404, preventing unauthorized download and leaking zero document existence metadata."

---

### Minute 3:30 – 4:15: Administrator Isolation & Tamper-Evident Audit Trail
- **Action:**
  1. Log out or open a third window and sign in as `admin@trustvault.local`.
  2. Navigate to the **Admin Dashboard**.
  3. Show the audit event feed: `document.uploaded`, `document.permission_granted`, `document.downloaded`, `document.permission_revoked`, and `document.download_denied`.
  4. Show the **Audit Verification** badge indicating the SHA-256 hash chain is intact.
  5. Try to download or view the owner's private document as the administrator.
  6. The system returns **404 Not Found**.
- **Talking Points:**
  - "Notice our administrative isolation principle: administrators manage accounts, monitor system health, and inspect governance logs, but **cannot view or download private document contents**."
  - "Every single event—including denied attempts—is written to an append-only audit log protected by MySQL `BEFORE UPDATE` and `BEFORE DELETE` triggers and chained with SHA-256 hashes."

---

### Minute 4:15 – 5:00: Security Review & Engineering Rigor
- **Action:** Switch to terminal and show the test and build status:
  - `npm test` (224 automated tests passing: 202 server + 22 client)
  - `npm run typecheck` (0 errors)
  - `npm run build` (clean production build)
- **Talking Points:**
  - "During Day 5, we performed an independent application security review against 13 threat categories. We identified and remediated 3 findings: implementing dual-tier rate limiting against password spraying, separating database DDL/DML deployment users, and redacting cross-tenant document titles in manager history."
  - "All findings have automated regression tests in `server/tests/security-regression.test.ts`."
  - "TrustVault is documented in `README.md`, `THREATS.md`, `PROMPTS.md`, and `docs/API.md`."

---

## Backup FAQs for Judges

- **Q: Why don't you use signed S3 URLs?**  
  *A:* Pre-signed URLs remain valid until expiration, even if permission is revoked in the database. TrustVault streams bytes through authorized Express endpoints so revocation is immediate.
- **Q: Can an admin read documents if they access MySQL directly?**  
  *A:* Files are stored encrypted/isolated on disk; metadata only is in MySQL. Furthermore, the runtime DB user cannot modify audit logs, and in production, files can be encrypted with owner-derived keys.
- **Q: What happens if an attacker attacks login from multiple IPs?**  
  *A:* The Tier-2 per-(IP+email) limiter combined with account lockout (`failed_login_count >= 5` locks the account for 15 minutes) halts brute-force attacks across distributed IPs.
