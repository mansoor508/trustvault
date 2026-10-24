-- ===========================================================================
-- 0010_platform_admin_role.sql
-- 1. Widen users.role ENUM to include 'platform_admin'
-- 2. Promote the platform administrator account to 'platform_admin'
-- ===========================================================================
-- FORWARD-ONLY. Never edit once applied.
-- ===========================================================================

-- 1. Widen role ENUM on users table to support 'platform_admin'
ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM('platform_admin', 'owner', 'admin', 'editor', 'viewer') NOT NULL DEFAULT 'viewer';

-- 2. Promote existing platform administration seed account to platform_admin
UPDATE `users`
   SET `role` = 'platform_admin'
 WHERE `email` = 'admin@trustvault.local';
