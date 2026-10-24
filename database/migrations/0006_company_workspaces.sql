-- ===========================================================================
-- 0006_company_workspaces.sql
-- Multi-tenant company workspaces and public registration.
-- ===========================================================================
-- FORWARD-ONLY. Never edit once applied (the runner stores a checksum).
--
-- Adds:
-- 1. `companies` table for multi-tenant workspace isolation.
-- 2. `company_id` foreign keys on `users`, `documents`, and `audit_logs`.
-- 3. Backfills existing demo accounts and documents into a default demo org
--    so all existing tests and demo data continue functioning without regression.
-- ===========================================================================

-- 1. Companies --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `companies` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `domain` VARCHAR(120) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Company workspaces for multi-tenant isolation.';

-- 2. Backfill default demo organization before setting foreign keys ----------
INSERT IGNORE INTO `companies` (`id`, `name`, `created_at`, `updated_at`)
VALUES ('c0000000-0000-4000-a000-000000000001', 'TrustVault Demo Org', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

-- 3. Add company_id to users ------------------------------------------------
ALTER TABLE `users`
  ADD COLUMN `company_id` CHAR(36) NULL AFTER `display_name`;

ALTER TABLE `users`
  ADD KEY `idx_users_company_id` (`company_id`);

ALTER TABLE `users`
  ADD CONSTRAINT `fk_users_company`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE;

UPDATE `users`
  SET `company_id` = 'c0000000-0000-4000-a000-000000000001'
  WHERE `company_id` IS NULL;

-- 4. Add company_id to documents --------------------------------------------
ALTER TABLE `documents`
  ADD COLUMN `company_id` CHAR(36) NULL AFTER `owner_id`;

ALTER TABLE `documents`
  ADD KEY `idx_documents_company_id` (`company_id`, `deleted_at`, `created_at`);

ALTER TABLE `documents`
  ADD CONSTRAINT `fk_documents_company`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE;

UPDATE `documents`
  SET `company_id` = 'c0000000-0000-4000-a000-000000000001'
  WHERE `company_id` IS NULL;

-- 5. Add company_id to audit_logs -------------------------------------------
-- Note: Past audit log entries are strictly immutable (protected by MySQL triggers
-- trg_audit_logs_no_update). Existing entries retain NULL company_id, and all new
-- entries will record company_id.
ALTER TABLE `audit_logs`
  ADD COLUMN `company_id` CHAR(36) NULL AFTER `user_id`;

ALTER TABLE `audit_logs`
  ADD KEY `idx_audit_logs_company_id` (`company_id`, `created_at`);
