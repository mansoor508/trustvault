-- ===========================================================================
-- 0004_document_permission_roles.sql
-- Document-level authorization: support for read and edit permissions.
-- ===========================================================================
-- FORWARD-ONLY. Never edit once applied.
--
-- Widen the role enum in document_permissions to support 'editor' in addition
-- to 'viewer' and 'owner'.
-- ===========================================================================

ALTER TABLE `document_permissions`
  MODIFY COLUMN `role` ENUM('owner', 'editor', 'viewer') NOT NULL DEFAULT 'viewer';
