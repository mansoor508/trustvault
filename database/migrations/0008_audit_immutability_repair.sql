-- ===========================================================================
-- 0008_audit_immutability_repair.sql
-- Drop relational cascades on immutable audit logs and restore authentic
-- historical ledger UUIDs.
-- ===========================================================================
-- FORWARD-ONLY. Never edit once applied.
-- ===========================================================================

-- 1. Drop foreign keys on audit_logs that mutate historical records upon user deletion.
-- An audit log is an immutable append-only ledger of historical facts.
-- Relational ON DELETE SET NULL cascades corrupt cryptographic hash chains
-- by clearing user_id and target_user_id when accounts are removed.
ALTER TABLE `audit_logs`
  DROP FOREIGN KEY `fk_audit_user`;

ALTER TABLE `audit_logs`
  DROP FOREIGN KEY `fk_audit_target_user`;

-- 2. Temporarily drop the immutability trigger so the forensic repair can restore
-- the authentic historical UUIDs.
DROP TRIGGER IF EXISTS `trg_audit_logs_no_update`;

-- 3. Restore verified authentic historical user IDs that were nulled by legacy cascades.
-- User 1: 905a0727-cd6d-4e56-be93-b75a3b0556f6 (Acme technologies registered 2026-10-21)
UPDATE `audit_logs`
  SET `user_id` = '905a0727-cd6d-4e56-be93-b75a3b0556f6'
  WHERE `id` IN ('609682', '609688', '609697', '609699', '609702');

UPDATE `audit_logs`
  SET `target_user_id` = '905a0727-cd6d-4e56-be93-b75a3b0556f6'
  WHERE `id` IN ('609686', '609689', '609696', '609698', '609701', '609703');

-- User 2: 4249f82d-b48c-4239-a6f8-ad1e4485a3fd (King registered 2026-10-21)
UPDATE `audit_logs`
  SET `user_id` = '4249f82d-b48c-4239-a6f8-ad1e4485a3fd'
  WHERE `id` IN ('699695', '699696');

UPDATE `audit_logs`
  SET `target_user_id` = '4249f82d-b48c-4239-a6f8-ad1e4485a3fd'
  WHERE `id` IN ('699701', '699702', '699703', '699704');

-- User 3: 85117855-aa17-4faf-948f-c96109bd8469 (Personal workspace registered 2026-10-22)
UPDATE `audit_logs`
  SET `user_id` = '85117855-aa17-4faf-948f-c96109bd8469'
  WHERE `id` IN ('917366', '917367', '917368', '917369', '917372', '917377', '917379', '917380', '917381');

UPDATE `audit_logs`
  SET `target_user_id` = '85117855-aa17-4faf-948f-c96109bd8469'
  WHERE `id` IN ('917370', '917371', '917373', '917374', '917375', '917376');

-- 4. Re-create the immutability trigger to block any future UPDATE attempts.
CREATE TRIGGER `trg_audit_logs_no_update`
  BEFORE UPDATE ON `audit_logs`
  FOR EACH ROW
  SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Audit log records are immutable and cannot be updated';
