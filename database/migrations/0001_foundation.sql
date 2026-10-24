-- ===========================================================================
-- 0001_foundation.sql
-- Identity and session storage for TrustVault.
-- ===========================================================================
-- FORWARD-ONLY. Once this file has been applied, never edit it: the runner
-- stores a checksum and refuses to run when history changes. Schema changes
-- always arrive as a new migration file.
--
-- Only additive statements belong here (CREATE TABLE IF NOT EXISTS).
-- Destructive statements (DROP/TRUNCATE/DELETE) must never be committed.
-- ===========================================================================

-- Users ---------------------------------------------------------------------
-- `email` is stored lowercase by the application and compared with the
-- case-insensitive utf8mb4_0900_ai_ci collation, so uniqueness is enforced
-- regardless of casing.
CREATE TABLE IF NOT EXISTS `users` (
  `id` CHAR(36) NOT NULL,
  `email` VARCHAR(320) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(80) NULL,
  `role` ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `failed_login_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until` DATETIME(3) NULL,
  `last_login_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Application accounts. Password hashes are bcrypt, never plaintext.';

-- Sessions ------------------------------------------------------------------
-- Server-side sessions. The browser only ever holds an opaque random token in
-- an HttpOnly cookie; `token_hash` is the SHA-256 of that token, so a database
-- leak cannot be replayed as a live session.
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` CHAR(36) NOT NULL,
  `user_id` CHAR(36) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `ip_hash` CHAR(64) NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` DATETIME(3) NOT NULL,
  `revoked_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sessions_token_hash` (`token_hash`),
  KEY `idx_sessions_user_id` (`user_id`),
  KEY `idx_sessions_expires_at` (`expires_at`),
  CONSTRAINT `fk_sessions_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Server-side session records; revoked_at enables instant logout.';
