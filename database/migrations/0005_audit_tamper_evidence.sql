-- ===========================================================================
-- 0005_audit_tamper_evidence.sql
-- Audit trail: outcome expansion, request correlation, tamper-evident hash
-- chaining, protected checkpoints, and database-level immutability triggers.
-- ===========================================================================
-- FORWARD-ONLY. Never edit once applied.
-- ===========================================================================

-- 1. Expand outcome enum to include 'denied' for authorization failures.
ALTER TABLE `audit_logs`
  MODIFY COLUMN `outcome` ENUM('success', 'failure', 'denied') NOT NULL DEFAULT 'success';

-- 2. Add target_user_id for permission changes and account administration.
ALTER TABLE `audit_logs`
  ADD COLUMN `target_user_id` CHAR(36) NULL AFTER `user_id`;

ALTER TABLE `audit_logs`
  ADD CONSTRAINT `fk_audit_target_user`
    FOREIGN KEY (`target_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- 3. Add request_id for end-to-end request tracing.
ALTER TABLE `audit_logs`
  ADD COLUMN `request_id` VARCHAR(128) NULL AFTER `created_at`;

-- 4. Add cryptographic hash-chain columns for tamper-evidence.
ALTER TABLE `audit_logs`
  ADD COLUMN `prev_hash` CHAR(64) NULL AFTER `metadata`;

ALTER TABLE `audit_logs`
  ADD COLUMN `entry_hash` CHAR(64) NULL AFTER `prev_hash`;

-- 5. Additional indexing for administrative audit filtering.
ALTER TABLE `audit_logs`
  ADD KEY `idx_audit_outcome` (`outcome`, `created_at`);

ALTER TABLE `audit_logs`
  ADD KEY `idx_audit_target_user` (`target_user_id`, `created_at`);

ALTER TABLE `audit_logs`
  ADD KEY `idx_audit_request_id` (`request_id`);

-- 6. Checkpoints table to anchor periodic hash-chain snapshots.
CREATE TABLE IF NOT EXISTS `audit_checkpoints` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `checkpoint_seq` BIGINT UNSIGNED NOT NULL,
  `last_log_id` BIGINT UNSIGNED NOT NULL,
  `checkpoint_hash` CHAR(64) NOT NULL,
  `entry_count` INT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_checkpoint_seq` (`checkpoint_seq`),
  KEY `idx_checkpoint_last_log` (`last_log_id`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Periodic tamper-evident checkpoints anchoring the audit hash chain.';

-- 7. Database-level immutability triggers.
-- Audit records and checkpoints cannot be modified or deleted via SQL DML.
DROP TRIGGER IF EXISTS `trg_audit_logs_no_update`;
CREATE TRIGGER `trg_audit_logs_no_update`
  BEFORE UPDATE ON `audit_logs`
  FOR EACH ROW
  SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Audit log records are immutable and cannot be updated';

DROP TRIGGER IF EXISTS `trg_audit_logs_no_delete`;
CREATE TRIGGER `trg_audit_logs_no_delete`
  BEFORE DELETE ON `audit_logs`
  FOR EACH ROW
  SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Audit log records are immutable and cannot be deleted';

DROP TRIGGER IF EXISTS `trg_audit_checkpoints_no_update`;
CREATE TRIGGER `trg_audit_checkpoints_no_update`
  BEFORE UPDATE ON `audit_checkpoints`
  FOR EACH ROW
  SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Audit checkpoints are immutable and cannot be updated';

DROP TRIGGER IF EXISTS `trg_audit_checkpoints_no_delete`;
CREATE TRIGGER `trg_audit_checkpoints_no_delete`
  BEFORE DELETE ON `audit_checkpoints`
  FOR EACH ROW
  SIGNAL SQLSTATE '45000'
  SET MESSAGE_TEXT = 'Audit checkpoints are immutable and cannot be deleted';
