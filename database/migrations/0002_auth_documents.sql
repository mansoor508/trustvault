-- ===========================================================================
-- 0002_auth_documents.sql
-- Authentication, authorisation, documents and the audit trail.
-- ===========================================================================
-- FORWARD-ONLY. Never edit once applied (the runner stores a checksum).
--
-- The only change to existing data is a role relabel: Day 1 shipped
-- ENUM('user','admin'); the product needs ('admin','owner','viewer').
-- 'user' is relabelled to 'viewer', which is the least-privileged role.
-- No rows are deleted and no tables are dropped.
-- ===========================================================================

-- Users ---------------------------------------------------------------------
-- Widen the enum first so the relabel cannot fail on an existing 'user' row,
-- then narrow it again. Running this on an empty table is a no-op apart from
-- the definition change.
ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM('user', 'admin', 'owner', 'viewer') NOT NULL DEFAULT 'viewer';

UPDATE `users` SET `role` = 'viewer' WHERE `role` = 'user';

ALTER TABLE `users`
  MODIFY COLUMN `role` ENUM('admin', 'owner', 'viewer') NOT NULL DEFAULT 'viewer';

-- Lets us invalidate sessions that predate a password change.
ALTER TABLE `users`
  ADD COLUMN `password_changed_at` DATETIME(3) NULL AFTER `password_hash`;

-- Sessions ------------------------------------------------------------------
-- CSRF synchroniser token for this session. Stored as plaintext hex because the
-- client must be able to read it back from /api/auth/me after a page reload.
-- It is NOT an authentication credential: it is useless without the HttpOnly
-- session cookie. Rows created before this migration have NULL and are
-- rejected by the middleware, forcing a fresh login.
ALTER TABLE `sessions`
  ADD COLUMN `csrf_token` CHAR(64) NULL AFTER `token_hash`;

-- Supports "revoke every session for this user" without a table scan.
ALTER TABLE `sessions`
  ADD KEY `idx_sessions_user_revoked` (`user_id`, `revoked_at`);

-- Documents -----------------------------------------------------------------
-- File bytes live in private storage, never in MySQL. `storage_key` is a
-- server-generated opaque path (unique) so a client can never propose one.
CREATE TABLE IF NOT EXISTS `documents` (
  `id` CHAR(36) NOT NULL,
  `owner_id` CHAR(36) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` VARCHAR(2000) NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `storage_key` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(127) NOT NULL,
  `size_bytes` BIGINT UNSIGNED NOT NULL,
  `checksum_sha256` CHAR(64) NULL,
  `status` ENUM('active', 'archived') NOT NULL DEFAULT 'active',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `deleted_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_documents_storage_key` (`storage_key`),
  KEY `idx_documents_owner_status` (`owner_id`, `status`, `created_at`),
  KEY `idx_documents_deleted_at` (`deleted_at`),
  CONSTRAINT `fk_documents_owner`
    FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT
    ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Document metadata. Bytes live in private storage, addressed by storage_key.';

-- Document permissions ------------------------------------------------------
-- Explicit grants only. The owner's implicit access comes from
-- documents.owner_id; this table adds co-owners and viewers.
CREATE TABLE IF NOT EXISTS `document_permissions` (
  `id` CHAR(36) NOT NULL,
  `document_id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `role` ENUM('owner', 'viewer') NOT NULL DEFAULT 'viewer',
  `granted_by` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_document_permissions_document_user` (`document_id`, `user_id`),
  KEY `idx_document_permissions_user_role` (`user_id`, `role`),
  KEY `idx_document_permissions_granted_by` (`granted_by`),
  CONSTRAINT `fk_document_permissions_document`
    FOREIGN KEY (`document_id`) REFERENCES `documents` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_document_permissions_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `fk_document_permissions_granted_by`
    FOREIGN KEY (`granted_by`) REFERENCES `users` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Per-document grants. One row per (document, user).';

-- Audit trail ---------------------------------------------------------------
-- Append-only. user_id is nullable and ON DELETE SET NULL so the record of an
-- action survives deletion of the account that performed it.
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` CHAR(36) NULL,
  `action` VARCHAR(64) NOT NULL,
  `outcome` ENUM('success', 'failure') NOT NULL DEFAULT 'success',
  `resource_type` VARCHAR(32) NULL,
  `resource_id` VARCHAR(64) NULL,
  `ip_hash` CHAR(64) NULL,
  `user_agent` VARCHAR(255) NULL,
  `metadata` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_audit_user_created` (`user_id`, `created_at`),
  KEY `idx_audit_action_created` (`action`, `created_at`),
  KEY `idx_audit_resource` (`resource_type`, `resource_id`),
  CONSTRAINT `fk_audit_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Append-only security events. IP addresses are HMAC-hashed, never stored raw.';
