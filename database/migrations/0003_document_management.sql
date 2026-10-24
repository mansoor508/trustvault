-- ===========================================================================
-- 0003_document_management.sql
-- Category and search support for documents.
-- ===========================================================================
-- FORWARD-ONLY. Additive only: no column is dropped, no row is deleted.
-- ===========================================================================

-- Category is a closed set, because free-text categories turn into a taxonomy
-- nobody can search. Adding a category later is a new migration.
ALTER TABLE `documents`
  ADD COLUMN `category` ENUM('general', 'contract', 'invoice', 'report', 'identity', 'other')
    NOT NULL DEFAULT 'general' AFTER `description`;

-- The list view filters by category and orders by creation time.
ALTER TABLE `documents`
  ADD KEY `idx_documents_category_created` (`category`, `created_at`);

-- "Documents I can see" is always scoped to an owner or a grant, so an index on
-- (owner_id, deleted_at) keeps the owner branch off a full scan.
ALTER TABLE `documents`
  ADD KEY `idx_documents_owner_deleted` (`owner_id`, `deleted_at`);

-- Metadata edits are audited by time; this supports recent-changes queries.
ALTER TABLE `documents`
  ADD KEY `idx_documents_created_at` (`created_at`);
