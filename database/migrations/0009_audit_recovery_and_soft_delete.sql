-- ===========================================================================
-- 0009_audit_recovery_and_soft_delete.sql
-- 1. Create audit_recovery_incidents registry to document and attest
--    historical cascade anomalies without modifying immutable audit evidence.
-- 2. Add deleted_at to users table for deletion-safe soft deletion and privacy.
-- ===========================================================================
-- FORWARD-ONLY. Never edit once applied.
-- ===========================================================================

-- 1. Deletion-safe user column for future privacy-preserving soft-deletes
ALTER TABLE `users`
  ADD COLUMN `deleted_at` DATETIME(3) NULL AFTER `is_active`;

-- 2. Audit recovery incident registry
CREATE TABLE IF NOT EXISTS `audit_recovery_incidents` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id` BIGINT UNSIGNED NOT NULL,
  `incident_type` VARCHAR(64) NOT NULL DEFAULT 'legacy_fk_cascade_null',
  `original_entry_hash` CHAR(64) NOT NULL,
  `prev_hash` CHAR(64) NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `corrupted_field` VARCHAR(64) NOT NULL DEFAULT 'user_id',
  `remediation_status` ENUM('explained_legacy_cascade', 'forensic_attested', 'unresolved') NOT NULL DEFAULT 'explained_legacy_cascade',
  `forensic_note` TEXT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_recovery_event` (`event_id`),
  KEY `idx_recovery_status` (`remediation_status`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Cryptographic audit incident registry documenting explained historical anomalies.';

-- 3. Attest the two irrecoverable legacy cascade events (917384 and 917385)
-- where user_id was cleared to NULL by legacy fk_audit_user prior to migration 0008.
-- Their cryptographic prev_hash chain is 100% intact, but original user_id was wiped on delete.
-- Per cryptographic audit standards, the user_id is not fabricated or invented.
INSERT INTO `audit_recovery_incidents`
  (`event_id`, `incident_type`, `original_entry_hash`, `prev_hash`, `action`, `corrupted_field`, `remediation_status`, `forensic_note`)
VALUES
  (
    917384,
    'legacy_fk_cascade_null',
    '0c8f70d4e6c72080877bd000ff7a9d97a367430262b09afb25dd6a0a11fb0ec2',
    '9febabd4248c0ecc1f3e4a6f3b8ccc698a7e081c7e087dd97537a466ec86653e',
    'user_registered',
    'user_id',
    'explained_legacy_cascade',
    'Payload user_id was set to NULL by legacy relational foreign-key cascade (fk_audit_user ON DELETE SET NULL) prior to migration 0008. The cryptographic prev_hash chain remains 100% intact. Original user UUID is irretrievable from surviving database records and is not fabricated.'
  ),
  (
    917385,
    'legacy_fk_cascade_null',
    '6c5db3ed03177666827c8f72416680feee6448fa65de2a11408afe4391f6e8f6',
    '0c8f70d4e6c72080877bd000ff7a9d97a367430262b09afb25dd6a0a11fb0ec2',
    'logout',
    'user_id',
    'explained_legacy_cascade',
    'Payload user_id was set to NULL by legacy relational foreign-key cascade (fk_audit_user ON DELETE SET NULL) prior to migration 0008. The cryptographic prev_hash chain remains 100% intact. Original user UUID is irretrievable from surviving database records and is not fabricated.'
  )
ON DUPLICATE KEY UPDATE `remediation_status` = VALUES(`remediation_status`);
