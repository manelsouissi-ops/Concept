BEGIN;

-- Semantic (local-Ollama) AI review layer for historical technical-source
-- candidates. Additive only.
--
-- APPLIED and live-verified against the real database (confirmed live rows
-- present during platform audit work). This file remains in the repo as
-- the source-of-truth migration; CREATE TABLE IF NOT EXISTS / CREATE INDEX
-- IF NOT EXISTS make it safe to rerun.
--
-- WHY A NEW TABLE INSTEAD OF EXTENDING historical_technical_source_candidates
-- (scripts/sql/create_historical_technical_source_candidates_table.sql):
-- that table is the RULE-BASED machine classification of a candidate and
-- the single place a human validation decision (validation_status,
-- reviewed_at, reviewed_by) ever lands. A local-Ollama semantic pass over
-- the same candidate is a DIFFERENT, independently reproducible opinion -
-- tied to a specific model identity, prompt, and schema version - that
-- must never overwrite or be confused with either the rule-based columns
-- or the human-validation columns. Recording it as an AI PROPOSAL in its
-- own table (rather than new columns on the existing row) is what makes
-- "machine classification is not human validation" (see
-- scripts/cdc_review.py) extend cleanly to "an AI proposal is not a
-- validation either" - and lets a re-review under a changed model/prompt/
-- schema ADD a new row instead of silently clobbering a prior one, which
-- is what preserves audit history and reproducibility.
--
-- Does NOT alter knowledge_base.archive_files, archive_scan_runs,
-- archive_source_roots, archive_file_classifications,
-- archive_file_classification_events, historical_cdc_candidates, or
-- historical_technical_source_candidates in any way. This migration
-- creates one new, empty table plus its supporting function/trigger/
-- indexes.
--
-- CONFIDENTIALITY: this table stores classification METADATA only.
-- Deliberately absent from every column below, by design, forever:
-- extracted text, document excerpts, filenames, archive paths, client/
-- project names, complete prompts containing document text, the raw
-- Ollama response, and any chain-of-thought/reasoning content. See
-- scripts/semantic_review.py's AiReviewRecord/PostgresAiReviewRepository
-- for the application-code guarantee that only short role/confidence/
-- flag/status values and aggregate metrics are ever written here.
--
-- IDEMPOTENCY / REPRODUCIBILITY: idempotency_key is a single deterministic
-- hash of (archive_file_id, content_sha256, model_name, model_digest,
-- prompt_hash, schema_version) - see
-- scripts/semantic_review.py:compute_idempotency_key(). It is UNIQUE, not
-- archive_file_id, so a document reviewed again under a changed model,
-- prompt, schema, or content hash always creates a NEW, distinct review
-- row rather than being silently merged into an incompatible prior
-- result. Multiple review rows for the same archive_file_id are expected
-- and normal - that is the audit trail.

CREATE SCHEMA IF NOT EXISTS knowledge_base;

CREATE TABLE IF NOT EXISTS knowledge_base.historical_technical_source_ai_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which archive file and which (rule-based) candidate row this semantic
  -- review is about. candidate_id is carried alongside archive_file_id
  -- (rather than derived by joining at read time) so a review row remains
  -- self-describing even if the candidate row is ever deleted (ON DELETE
  -- SET NULL, not CASCADE - the review is independent evidence and must
  -- survive that).
  archive_file_id BIGINT NOT NULL
    REFERENCES knowledge_base.archive_files(id) ON DELETE CASCADE,
  candidate_id UUID
    REFERENCES knowledge_base.historical_technical_source_candidates(id) ON DELETE SET NULL,

  -- Phase 1's already-computed archive_files.sha256 (see
  -- scripts/cdc_discovery.py's ArchiveFileRow.sha256) - never recomputed
  -- from raw bytes by this table's writer. Part of the idempotency key:
  -- a changed file content (re-scanned under a new sha256) is a distinct
  -- review subject, not a reuse.
  content_sha256 TEXT NOT NULL,

  model_name TEXT NOT NULL,
  -- Ollama's own model digest (GET /api/show), when the local instance
  -- returns one. Nullable because a digest is not guaranteed available
  -- from every Ollama version/build - absence must never block a review
  -- from being recorded, but IS reflected in idempotency_key so a later
  -- run where the digest becomes available is correctly treated as a
  -- distinct identity from an earlier NULL-digest run.
  model_digest TEXT,

  prompt_hash TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  semantic_classifier_version TEXT NOT NULL,

  idempotency_key TEXT NOT NULL UNIQUE,

  proposed_role TEXT
    CHECK (proposed_role IS NULL OR proposed_role IN (
      'CDC', 'TDR', 'DAO_WITH_TDR', 'DAO_WITH_CDC', 'DAO', 'DCE', 'RFP',
      'OFFER', 'REPORT', 'METHODOLOGY', 'OTHER', 'UNKNOWN'
    )),

  confidence NUMERIC(3, 2)
    CHECK (confidence IS NULL OR (confidence BETWEEN 0.00 AND 1.00)),

  needs_human_review BOOLEAN,

  uncertainty_category TEXT
    CHECK (uncertainty_category IS NULL OR uncertainty_category IN (
      'NONE', 'AMBIGUOUS_ROLE', 'CONFLICTING_SIGNALS', 'INSUFFICIENT_CONTENT',
      'LOW_CONFIDENCE', 'OTHER'
    )),

  -- Structured Boolean evidence flags (Phase 3). Never a text excerpt -
  -- the model is asked for these as booleans and nothing else backs them.
  evidence_explicit_role_title BOOLEAN,
  evidence_client_requirements BOOLEAN,
  evidence_scope_of_work BOOLEAN,
  evidence_technical_specifications BOOLEAN,
  evidence_required_deliverables BOOLEAN,
  evidence_bidder_obligations BOOLEAN,
  evidence_evaluation_criteria BOOLEAN,
  evidence_administrative_tender_package BOOLEAN,
  evidence_terms_of_reference_structure BOOLEAN,
  evidence_bidder_response_language BOOLEAN,
  evidence_proposed_methodology_or_team BOOLEAN,
  evidence_insufficient_evidence BOOLEAN,

  -- The semantic-review-specific outcome of THIS AI proposal - distinct
  -- from, and never written back into, historical_technical_source_
  -- candidates.validation_status (the human-CDC-validation lifecycle).
  review_outcome TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (review_outcome IN (
      'PENDING', 'PROPOSED', 'LOW_CONFIDENCE', 'NEEDS_HUMAN_REVIEW', 'FAILED'
    )),

  -- Pipeline execution status for this row, independent of review_outcome
  -- (a row can be processing_status = SUCCESS with review_outcome =
  -- NEEDS_HUMAN_REVIEW - the call worked, the model just wasn't confident).
  processing_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (processing_status IN ('PENDING', 'SUCCESS', 'FAILED', 'SKIPPED_DUPLICATE')),

  failure_category TEXT
    CHECK (failure_category IS NULL OR failure_category IN (
      'CONNECTION_ERROR', 'TIMEOUT', 'MALFORMED_JSON', 'SCHEMA_VIOLATION',
      'ENDPOINT_REJECTED', 'OTHER'
    )),

  -- Whether the first Ollama response parsed/validated cleanly, needed one
  -- controlled JSON-repair attempt that then succeeded, or failed even
  -- after that one repair attempt (fail closed - see Phase 4/5).
  json_outcome TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED'
    CHECK (json_outcome IN ('FIRST_ATTEMPT_VALID', 'REPAIRED_VALID', 'REPAIR_FAILED', 'NOT_ATTEMPTED')),

  -- Aggregate duration/token metrics ONLY, when Ollama returns them -
  -- never content. See Phase 5.
  response_duration_ms INTEGER CHECK (response_duration_ms IS NULL OR response_duration_ms >= 0),
  prompt_eval_count INTEGER CHECK (prompt_eval_count IS NULL OR prompt_eval_count >= 0),
  eval_count INTEGER CHECK (eval_count IS NULL OR eval_count >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS historical_technical_source_ai_reviews_archive_file_id_idx
  ON knowledge_base.historical_technical_source_ai_reviews(archive_file_id);
CREATE INDEX IF NOT EXISTS historical_technical_source_ai_reviews_candidate_id_idx
  ON knowledge_base.historical_technical_source_ai_reviews(candidate_id);
CREATE INDEX IF NOT EXISTS historical_technical_source_ai_reviews_content_sha256_idx
  ON knowledge_base.historical_technical_source_ai_reviews(content_sha256);
CREATE INDEX IF NOT EXISTS historical_technical_source_ai_reviews_model_name_idx
  ON knowledge_base.historical_technical_source_ai_reviews(model_name);
CREATE INDEX IF NOT EXISTS historical_technical_source_ai_reviews_proposed_role_idx
  ON knowledge_base.historical_technical_source_ai_reviews(proposed_role);
CREATE INDEX IF NOT EXISTS historical_technical_source_ai_reviews_review_outcome_idx
  ON knowledge_base.historical_technical_source_ai_reviews(review_outcome);
CREATE INDEX IF NOT EXISTS historical_technical_source_ai_reviews_processing_status_idx
  ON knowledge_base.historical_technical_source_ai_reviews(processing_status);
CREATE INDEX IF NOT EXISTS historical_technical_source_ai_reviews_created_at_idx
  ON knowledge_base.historical_technical_source_ai_reviews(created_at);

CREATE OR REPLACE FUNCTION knowledge_base.set_historical_technical_source_ai_reviews_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS historical_technical_source_ai_reviews_set_updated_at
  ON knowledge_base.historical_technical_source_ai_reviews;

CREATE TRIGGER historical_technical_source_ai_reviews_set_updated_at
  BEFORE UPDATE ON knowledge_base.historical_technical_source_ai_reviews
  FOR EACH ROW
  EXECUTE FUNCTION knowledge_base.set_historical_technical_source_ai_reviews_updated_at();

COMMIT;
