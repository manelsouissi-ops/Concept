-- Transaction boundaries are managed by the migration runner. Apply this
-- migration inside an explicit transaction.

-- Additive-only: links each candidate row to the human-review import batch
-- (knowledge_base.historical_technical_source_import_batches - see the
-- companion create_historical_technical_source_import_batches_table.sql,
-- which must be applied first, since this migration's FK references it)
-- that most recently updated it.
--
-- APPLIED AND LIVE-VERIFIED on GONOGO on 2026-09-18. This file remains the
-- source-of-truth migration; ADD COLUMN IF NOT EXISTS / CREATE INDEX IF
-- NOT EXISTS make it safe to rerun.
--
-- WHY A NULLABLE FK COLUMN, NOT A JUNCTION/HISTORY TABLE: a candidate's
-- relationship to "the import batch that touched it" is 1:0-or-1 in this
-- workflow, not many-to-many - a given candidate is updated by at most one
-- completed import (the idempotency check in the importer refuses to
-- silently re-apply a second workbook on top of an existing human
-- decision; see historical_technical_source_import_batches' conflicting-
-- decision rejection). A junction table exists in this schema precisely
-- where a genuine one-to-many append-only AUDIT TRAIL is the actual need
-- (knowledge_base.archive_file_classification_events, for a DIFFERENT
-- table's DIFFERENT classification model) - that is not this case. The
-- established convention for "which single upstream record touched this
-- row" throughout this schema is a direct nullable FK column on the row
-- itself (historical_technical_source_candidates.reviewed_by already does
-- exactly this for the reviewing user; duplicate_of_archive_file_id does
-- it for duplicate-of relationships; knowledge_documents.current_version_id
-- does it for "current version"). A nullable FK column matches that
-- convention exactly and is the smallest correct design; a junction table
-- here would be unjustified complexity for a relationship that can never
-- be many-to-many under this workflow's own idempotency rules.
--
-- NULL means "never touched by this human-review import workflow" - every
-- pre-existing row, and the 2 INCERTAIN rows from any run of this workbook
-- (explicitly never linked - they receive no update and no batch
-- reference, exactly like their validation_status stays untouched).
--
-- ADD COLUMN ... DEFAULT NULL is a metadata-only change in PostgreSQL (no
-- NOT NULL, no non-null DEFAULT) - it does not rewrite
-- historical_technical_source_candidates' existing rows/pages.
--
-- Does NOT alter any column's existing constraints, does NOT touch
-- validation_status/reviewed_by/reviewed_at/review_priority or any
-- machine-classification column in any way, and does NOT alter any other
-- table.

ALTER TABLE knowledge_base.historical_technical_source_candidates
  ADD COLUMN IF NOT EXISTS human_review_import_batch_id BIGINT
    REFERENCES knowledge_base.historical_technical_source_import_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS historical_technical_source_candidates_import_batch_idx
  ON knowledge_base.historical_technical_source_candidates(human_review_import_batch_id);

-- Reversal (documented, not applied automatically - a human runs this only
-- if the migration above needs to be undone):
--   BEGIN;
--   DROP INDEX IF EXISTS knowledge_base.historical_technical_source_candidates_import_batch_idx;
--   ALTER TABLE knowledge_base.historical_technical_source_candidates
--     DROP COLUMN IF EXISTS human_review_import_batch_id;
--   COMMIT;
