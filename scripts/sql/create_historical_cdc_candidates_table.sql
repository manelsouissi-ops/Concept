BEGIN;

-- Historical CDC discovery (Phase 3). Additive only.
--
-- Does NOT alter knowledge_base.archive_files, archive_scan_runs,
-- archive_source_roots, archive_file_classifications, or
-- archive_file_classification_events in any way. This migration creates
-- one new, empty table plus its supporting function/trigger/indexes.
--
-- This is deliberately a SEPARATE table from
-- knowledge_base.archive_file_classifications (Phase 2's generic technical/
-- knowledge classification): historical_cdc_candidates is CDC-discovery-
-- specific (year, project_reference, duplicate-of-candidate linkage,
-- human-review provenance) and does not fit that table's shape without
-- overloading it. See scripts/cdc_discovery.py for the discovery logic
-- that populates this table.
--
-- CONFIDENTIALITY: this table stores classification METADATA only - no
-- filenames, no paths, no raw extracted document text. `reason` is a short
-- evidence label (e.g. "role=CDC"), never a document excerpt.

CREATE SCHEMA IF NOT EXISTS knowledge_base;

CREATE TABLE IF NOT EXISTS knowledge_base.historical_cdc_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One candidate row per archive file. UNIQUE (not just indexed) is what
  -- makes scripts/cdc_discovery.py's upsert idempotent: rerunning discovery
  -- for the same archive_file_id updates the existing row in place instead
  -- of inserting a duplicate (see PostgresCandidateRepository.upsert).
  archive_file_id BIGINT NOT NULL UNIQUE
    REFERENCES knowledge_base.archive_files(id) ON DELETE CASCADE,

  year INTEGER
    CHECK (year IS NULL OR (year BETWEEN 1900 AND 2100)),

  project_reference TEXT,

  document_role TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (document_role IN (
      'CDC',
      'DAO',
      'TDR',
      'DCE',
      'RFP',
      'INVITATION',
      'ANNEX',
      'OTHER_TENDER_DOCUMENT',
      'UNKNOWN'
    )),

  -- CONFIRMED_CDC must only ever be set by content-backed verification -
  -- enforced in application code (scripts/cdc_discovery.py:
  -- finalize_cdc_status / CdcCandidate.__post_init__), not by this
  -- constraint (SQL cannot know whether content inspection occurred).
  cdc_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW'
    CHECK (cdc_status IN (
      'CONFIRMED_CDC',
      'LIKELY_CDC',
      'NEEDS_REVIEW',
      'NOT_CDC'
    )),

  confidence NUMERIC(3, 2)
    CHECK (confidence IS NULL OR (confidence BETWEEN 0.00 AND 1.00)),

  detection_method TEXT NOT NULL,

  -- Short evidence label only - see CONFIDENTIALITY note above. No length
  -- constraint is added here because enforcing "short" is an application
  -- responsibility (scripts/cdc_discovery.py never puts raw document text
  -- in this field); a hard DB-level cap would be arbitrary and brittle.
  reason TEXT,

  duplicate_of_archive_file_id BIGINT
    REFERENCES knowledge_base.archive_files(id) ON DELETE SET NULL,
  is_primary_candidate BOOLEAN NOT NULL DEFAULT TRUE,

  needs_human_review BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  reviewed_at TIMESTAMPTZ,
  -- Same reviewer FK pattern as
  -- knowledge_base.archive_file_classifications.reviewed_by_user_id.
  reviewed_by BIGINT REFERENCES public.app_users(id) ON DELETE SET NULL,

  CHECK (
    (is_primary_candidate AND duplicate_of_archive_file_id IS NULL)
    OR (NOT is_primary_candidate AND duplicate_of_archive_file_id IS NOT NULL)
  ),
  CHECK (duplicate_of_archive_file_id IS DISTINCT FROM archive_file_id)
);

CREATE INDEX IF NOT EXISTS historical_cdc_candidates_year_idx
  ON knowledge_base.historical_cdc_candidates(year);
CREATE INDEX IF NOT EXISTS historical_cdc_candidates_project_reference_idx
  ON knowledge_base.historical_cdc_candidates(project_reference);
CREATE INDEX IF NOT EXISTS historical_cdc_candidates_document_role_idx
  ON knowledge_base.historical_cdc_candidates(document_role);
CREATE INDEX IF NOT EXISTS historical_cdc_candidates_cdc_status_idx
  ON knowledge_base.historical_cdc_candidates(cdc_status);
CREATE INDEX IF NOT EXISTS historical_cdc_candidates_confidence_idx
  ON knowledge_base.historical_cdc_candidates(confidence);
CREATE INDEX IF NOT EXISTS historical_cdc_candidates_detection_method_idx
  ON knowledge_base.historical_cdc_candidates(detection_method);
CREATE INDEX IF NOT EXISTS historical_cdc_candidates_duplicate_of_idx
  ON knowledge_base.historical_cdc_candidates(duplicate_of_archive_file_id);
CREATE INDEX IF NOT EXISTS historical_cdc_candidates_needs_human_review_idx
  ON knowledge_base.historical_cdc_candidates(needs_human_review);
CREATE INDEX IF NOT EXISTS historical_cdc_candidates_reviewed_by_idx
  ON knowledge_base.historical_cdc_candidates(reviewed_by);
CREATE INDEX IF NOT EXISTS historical_cdc_candidates_created_at_idx
  ON knowledge_base.historical_cdc_candidates(created_at);

-- updated_at trigger. Function name is entity-scoped (not a generic
-- update_updated_at_column() that could collide with an identically named
-- function used by an unrelated table elsewhere in the database).
CREATE OR REPLACE FUNCTION knowledge_base.set_historical_cdc_candidates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Postgres has no "CREATE TRIGGER IF NOT EXISTS" - DROP + CREATE is the
-- correct, safe way to make trigger creation re-runnable.
DROP TRIGGER IF EXISTS historical_cdc_candidates_set_updated_at
  ON knowledge_base.historical_cdc_candidates;

CREATE TRIGGER historical_cdc_candidates_set_updated_at
  BEFORE UPDATE ON knowledge_base.historical_cdc_candidates
  FOR EACH ROW
  EXECUTE FUNCTION knowledge_base.set_historical_cdc_candidates_updated_at();

COMMIT;
