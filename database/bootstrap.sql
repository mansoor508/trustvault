-- ===========================================================================
-- TrustVault - one-time database + application user bootstrap
-- ===========================================================================
-- !! TEMPLATE ONLY !!
-- This file creates two least-privilege users:
--
--   trustvault_deploy  DDL rights only  — used by `npm run migrate`
--   trustvault         DML rights only  — used by the running API
--
-- Replace every CHANGE_ME_* with a locally generated password, run the file,
-- then revert your edit. Do NOT commit a filled-in copy of this file.
--
-- Safer automation: `database/README.md` shows the same steps driven from a
-- PowerShell/Bash variable, so the password never touches disk.
--
-- Run as a MySQL administrator:
--   mysql -u root -p < database/bootstrap.sql
--
-- What this does: creates a database and two least-privilege users, one for
-- schema migrations (DDL) and one for the running API (DML only). Neither user
-- is granted any global privileges. It deletes nothing.
--
-- SECURITY NOTE: Separating the deploy user from the runtime user ensures that
-- a compromised API credential cannot DROP tables, ALTER schema, or DROP the
-- immutability triggers on audit_logs. The runtime user can only INSERT into
-- audit_logs (never UPDATE or DELETE), enforcing append-only semantics at the
-- database privilege layer in addition to the trigger layer.
-- ===========================================================================

CREATE DATABASE IF NOT EXISTS `trustvault`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- ---------------------------------------------------------------------------
-- Deploy user: runs migrations only. Has DDL + DML so migrations can create
-- tables, add columns, create triggers, etc. Never used at runtime.
-- ---------------------------------------------------------------------------
CREATE USER IF NOT EXISTS 'trustvault_deploy'@'localhost'
  IDENTIFIED BY 'CHANGE_ME_deploy_password';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP, TRIGGER
  ON `trustvault`.* TO 'trustvault_deploy'@'localhost';

-- ---------------------------------------------------------------------------
-- Runtime user: used by the Node.js API process. DML only on operational
-- tables; INSERT-only on audit tables (no UPDATE, DELETE, DROP, TRIGGER).
--
-- After applying migrations with trustvault_deploy, set DATABASE_USER and
-- DATABASE_PASSWORD in .env to the runtime user's credentials.
-- ---------------------------------------------------------------------------
CREATE USER IF NOT EXISTS 'trustvault'@'localhost'
  IDENTIFIED BY 'CHANGE_ME_strong_password';

-- Operational tables: full DML
GRANT SELECT, INSERT, UPDATE, DELETE
  ON `trustvault`.`companies`              TO 'trustvault'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON `trustvault`.`users`                  TO 'trustvault'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON `trustvault`.`sessions`               TO 'trustvault'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON `trustvault`.`documents`              TO 'trustvault'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON `trustvault`.`document_permissions`   TO 'trustvault'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON `trustvault`.`schema_migrations`      TO 'trustvault'@'localhost';

-- Audit tables: INSERT only — the runtime process can never UPDATE or DELETE
-- audit records. Combined with the BEFORE UPDATE / BEFORE DELETE triggers,
-- this gives two independent layers of append-only enforcement.
GRANT SELECT, INSERT
  ON `trustvault`.`audit_logs`             TO 'trustvault'@'localhost';
GRANT SELECT, INSERT
  ON `trustvault`.`audit_checkpoints`      TO 'trustvault'@'localhost';

FLUSH PRIVILEGES;
