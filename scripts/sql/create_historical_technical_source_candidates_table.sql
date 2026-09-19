BEGIN;

-- Historical technical-source discovery (Phase 5). Additive only.
--
-- APPLIED and live-verified against the real database (confirmed via
-- information_schema/pg_constraint inspection during CDC-import preflight
-- work). This file remains in the repo as the source-of-truth migration;
-- CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / CREATE OR
-- REPLACE FUNCTION make it safe to rerun.
--
-- WHY A NEW TABLE INSTEAD OF EXTENDING historical_cdc_candidates
-- (scripts/sql/create_historical_cdc_candidates_table.sql):
-- the 25-project pilot proved the CDC-only model ("CONFIRMED_CDC vs not")
-- is too narrow for the real business objective - the historical documents
-- CONCEPT actually needs are frequently a DAO/Appel d'Offres WRAPPER that
-- CONTAINS a Termes de Reference or Cahier des Charges SECTION. Capturing
-- that requires a genuinely different shape: a 12-value role taxonomy
-- (CDC/TDR/DAO_WITH_TDR/DAO_WITH_CDC/DAO/DCE/RFP/OFFER/REPORT/METHODOLOGY/
-- OTHER/UNKNOWN) instead of a 9-value document_role, a weighted structural
-- score/ratio/band the old table has no columns for at all, a review-
-- priority queue concept, and a DIFFERENT human-validation status enum
-- (VALIDATED_CDC/VALIDATED_TDR/VALIDATED_DAO_WITH_TDR/VALIDATED_DAO_WITH_CDC/
-- REJECTED/NEEDS_REVIEW/PENDING, vs. the old table's CONFIRMED_CDC/
-- LIKELY_CDC/NEEDS_REVIEW/NOT_CDC). Bolting all of that onto the existing
-- table would either break its existing CHECK constraints and the
-- --pilot-limit pipeline that still targets it unchanged, or require
-- making every new column nullable and unconstrained - overloading one
-- table with two different classification models. A new, separate table
-- keeps both pipelines (the still-supported --pilot-limit CDC-only mode
-- and the new --full-corpus taxonomy-aware mode) independently correct;
-- historical_cdc_candidates is untouched by this migration.
--
-- REVIEW WORKFLOW (Phase 6) ADDITIONS: extraction_method,
-- extraction_failure_category, project_mapping_status, classifier_version.
-- validation_status's enum was renamed from a PENDING/VALIDATED_*/REJECTED
-- shape to an explicit MACHINE_CLASSIFIED/NEEDS_HUMAN_REVIEW/HUMAN_VALIDATED_*/
-- HUMAN_REJECTED_CDC shape - "machine classification is not human
-- validation" (see scripts/cdc_review.py) is meant to be unmistakable from
-- the value itself, not just from a comment. This rename is baked directly
-- into this CREATE TABLE (a plain edit to the migration file made before it
-- was ever applied), not expressed as a follow-up ALTER against a live
-- table.
--
-- Does NOT alter knowledge_base.archive_files, archive_scan_runs,
-- archive_source_roots, archive_file_classifications,
-- archive_file_classification_events, or historical_cdc_candidates in any
-- way. This migration creates one new, empty table plus its supporting
-- function/trigger/indexes.
--
-- CONFIDENTIALITY: this table stores classification METADATA only - no
-- filenames, no paths, no raw extracted document text, ever. See
-- scripts/cdc_discovery.py's TechnicalSourceCandidate/
-- PostgresTechnicalSourceCandidateRepository for the application-code
-- guarantee that only short role/score/status values are ever written
-- here.

CREATE SCHEMA IF NOT EXISTS knowledge_base;

CREATE TABLE IF NOT EXISTS knowledge_base.historical_technical_source_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One candidate row per archive file, same idempotency pattern as
  -- historical_cdc_candidates: rerunning discovery for the same
  -- archive_file_id upserts in place rather than duplicating.
  archive_file_id BIGINT NOT NULL UNIQUE
    REFERENCES knowledge_base.archive_files(id) ON DELETE CASCADE,

  year INTEGER
    CHECK (year IS NULL OR (year BETWEEN 1900 AND 2100)),

  project_reference TEXT,

  detected_role TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (detected_role IN (
      'CDC', 'TDR', 'DAO_WITH_TDR', 'DAO_WITH_CDC', 'DAO', 'DCE', 'RFP',
      'OFFER', 'REPORT', 'METHODOLOGY', 'OTHER', 'UNKNOWN'
    )),

  -- The single boolean the review queue and future Excel-matrix pipeline
  -- (Task 14) actually filter on - kept separate from detected_role
  -- because "which role" and "is this a technical source at all" are
  -- deliberately independent decisions (application code: see
  -- scripts/technical_source_classifier.classify_technical_source).
  technical_source_candidate BOOLEAN NOT NULL DEFAULT FALSE,

  structural_score INTEGER NOT NULL DEFAULT 0 CHECK (structural_score >= 0),
  structural_max INTEGER NOT NULL DEFAULT 0 CHECK (structural_max >= 0),
  structural_ratio NUMERIC(4, 3)
    CHECK (structural_ratio IS NULL OR (structural_ratio BETWEEN 0 AND 1)),

  -- scripts/technical_source_classifier.STRUCTURAL_BANDS - the banded view
  -- of structural_ratio (STRONG/POSSIBLE/WEAK). Was missing from this
  -- migration and from PostgresTechnicalSourceCandidateRepository.upsert()'s
  -- column list entirely (found in code-only safety audit, Phase 6 follow-
  -- up) - without this column, structural_band was silently discarded on
  -- every persist and scripts/cdc_review.py --review-summary's
  -- band_STRONG_TECHNICAL_SOURCE/band_POSSIBLE_TECHNICAL_SOURCE/
  -- band_WEAK_TECHNICAL_SOURCE/strong_technical_candidates/
  -- possible_technical_candidates fields would have failed at runtime with
  -- "column structural_band does not exist" against a real, populated
  -- table. Never applied to any real database, so this is a plain
  -- addition, not a follow-up ALTER.
  structural_band TEXT NOT NULL DEFAULT 'WEAK_TECHNICAL_SOURCE'
    CHECK (structural_band IN ('STRONG_TECHNICAL_SOURCE', 'POSSIBLE_TECHNICAL_SOURCE', 'WEAK_TECHNICAL_SOURCE')),

  confidence NUMERIC(3, 2)
    CHECK (confidence IS NULL OR (confidence BETWEEN 0.00 AND 1.00)),

  review_priority TEXT
    CHECK (review_priority IS NULL OR review_priority IN (
      'HIGH_PRIORITY', 'MEDIUM_PRIORITY', 'EXTRACTION_FAILED'
    )),

  extraction_status TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED'
    CHECK (extraction_status IN ('NOT_ATTEMPTED', 'SUCCESS', 'FAILED')),

  -- Which extraction path actually ran - NULL whenever extraction_status
  -- != 'SUCCESS'. Review workflow: aggregate "extraction method/result"
  -- breakdown, never a filename/path.
  extraction_method TEXT
    CHECK (extraction_method IS NULL OR extraction_method IN ('pdf_text', 'docx_text', 'doc_text')),

  -- Populated only when extraction_status = 'FAILED'. Review workflow
  -- Task 6: the 117-candidate real-run EXTRACTION_FAILED bucket is never
  -- discarded - this is what lets it be grouped by failure category
  -- without ever storing a raw reason_code/path. See
  -- scripts/technical_source_classifier.EXTRACTION_FAILURE_CATEGORIES.
  extraction_failure_category TEXT
    CHECK (extraction_failure_category IS NULL OR extraction_failure_category IN (
      'MISSING_SOURCE', 'PDF_EXTRACTION_FAILURE', 'DOC_EXTRACTION_FAILURE',
      'DOCX_EXTRACTION_FAILURE', 'EMPTY_OUTPUT', 'UNSUPPORTED_FORMAT', 'OTHER'
    )),

  -- Human validation lifecycle. Every row starts MACHINE_CLASSIFIED - only
  -- a human moving it elsewhere (mark_validation_status(), never upsert())
  -- confirms anything, exactly like archive_file_classifications'
  -- classification_state rule ("AI_PROPOSED must never be treated as
  -- validated"). "Machine classification is not human validation" is
  -- meant to be readable directly off the enum value.
  validation_status TEXT NOT NULL DEFAULT 'MACHINE_CLASSIFIED'
    CHECK (validation_status IN (
      'MACHINE_CLASSIFIED', 'NEEDS_HUMAN_REVIEW', 'HUMAN_VALIDATED_CDC',
      'HUMAN_VALIDATED_TDR', 'HUMAN_VALIDATED_DAO_WITH_TDR',
      'HUMAN_VALIDATED_DAO_WITH_CDC', 'HUMAN_REJECTED_CDC'
    )),

  classification_method TEXT NOT NULL DEFAULT 'RULE'
    CHECK (classification_method IN ('PREFILTER_SKIPPED', 'RULE', 'RULE_AND_LOCAL_AI', 'HUMAN')),

  -- scripts/technical_source_classifier.TECHNICAL_SOURCE_CLASSIFIER_VERSION
  -- at the time this row's machine classification was computed - lets a
  -- future rules change be distinguished from stale results without
  -- guessing from created_at/updated_at alone.
  classifier_version TEXT NOT NULL DEFAULT 'v1',

  -- The authoritative mapping between this historical document/project and
  -- an official CONCEPT internal code has NOT been established (review
  -- workflow Task 7) - project_reference above is a filename/path REGEX
  -- guess, never that authoritative code. Deliberately single-valued
  -- today; a real resolution mechanism would extend this enum, not repurpose
  -- project_reference.
  project_mapping_status TEXT NOT NULL DEFAULT 'UNRESOLVED'
    CHECK (project_mapping_status IN ('UNRESOLVED')),

  duplicate_of_archive_file_id BIGINT
    REFERENCES knowledge_base.archive_files(id) ON DELETE SET NULL,
  is_primary_candidate BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  reviewed_at TIMESTAMPTZ,
  reviewed_by BIGINT REFERENCES public.app_users(id) ON DELETE SET NULL,

  CHECK (
    (is_primary_candidate AND duplicate_of_archive_file_id IS NULL)
    OR (NOT is_primary_candidate AND duplicate_of_archive_file_id IS NOT NULL)
  ),
  CHECK (duplicate_of_archive_file_id IS DISTINCT FROM archive_file_id)
);

CREATE INDEX IF NOT EXISTS historical_technical_source_candidates_year_idx
  ON knowledge_base.historical_technical_source_candidates(year);
CREATE INDEX IF NOT EXISTS historical_technical_source_candidates_project_reference_idx
  ON knowledge_base.historical_technical_source_candidates(project_reference);
CREATE INDEX IF NOT EXISTS historical_technical_source_candidates_detected_role_idx
  ON knowledge_base.historical_technical_source_candidates(detected_role);
CREATE INDEX IF NOT EXISTS historical_technical_source_candidates_structural_band_idx
  ON knowledge_base.historical_technical_source_candidates(structural_band);
CREATE INDEX IF NOT EXISTS historical_technical_source_candidates_candidate_idx
  ON knowledge_base.historical_technical_source_candidates(technical_source_candidate);
CREATE INDEX IF NOT EXISTS historical_technical_source_candidates_review_priority_idx
  ON knowledge_base.historical_technical_source_candidates(review_priority);
CREATE INDEX IF NOT EXISTS historical_technical_source_candidates_validation_status_idx
  ON knowledge_base.historical_technical_source_candidates(validation_status);
CREATE INDEX IF NOT EXISTS historical_technical_source_candidates_extraction_status_idx
  ON knowledge_base.historical_technical_source_candidates(extraction_status);
CREATE INDEX IF NOT EXISTS historical_technical_source_candidates_duplicate_of_idx
  ON knowledge_base.historical_technical_source_candidates(duplicate_of_archive_file_id);
CREATE INDEX IF NOT EXISTS historical_technical_source_candidates_reviewed_by_idx
  ON knowledge_base.historical_technical_source_candidates(reviewed_by);
CREATE INDEX IF NOT EXISTS historical_technical_source_candidates_created_at_idx
  ON knowledge_base.historical_technical_source_candidates(created_at);

CREATE OR REPLACE FUNCTION knowledge_base.set_historical_technical_source_candidates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS historical_technical_source_candidates_set_updated_at
  ON knowledge_base.historical_technical_source_candidates;

CREATE TRIGGER historical_technical_source_candidates_set_updated_at
  BEFORE UPDATE ON knowledge_base.historical_technical_source_candidates
  FOR EACH ROW
  EXECUTE FUNCTION knowledge_base.set_historical_technical_source_candidates_updated_at();

COMMIT;
