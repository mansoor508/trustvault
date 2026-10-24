-- ===========================================================================
-- 0007_company_invitations_and_roles.sql
-- Workspace member invitations and editor role support.
-- ===========================================================================
-- FORWARD-ONLY. Never edit once applied (the runner stores a checksum).
--
-- Adds:
-- 1. Support for 'editor' role on users table.
-- 2. `company_invitations` table for self-service workspace invitations.
-- ===========================================================================

-- 1. Widen users.role enum to support 'editor' --------------------------------
ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM('owner', 'admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer';

-- 2. Workspace invitations table ---------------------------------------------
CREATE TABLE IF NOT EXISTS `company_invitations` (
  `id` CHAR(36) NOT NULL,
  `company_id` CHAR(36) NOT NULL,
  `invited_by` CHAR(36) NOT NULL,
  `email` VARCHAR(320) NOT NULL,
  `role` ENUM('admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer',
  `token` VARCHAR(64) NOT NULL,
  `status` ENUM('pending', 'accepted', 'revoked', 'expired') NOT NULL DEFAULT 'pending',
  `expires_at` DATETIME(3) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_invitations_token` (`token`),
  KEY `idx_invitations_company_status` (`company_id`, `status`),
  KEY `idx_invitations_email` (`email`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Invitations to join company workspaces.';
