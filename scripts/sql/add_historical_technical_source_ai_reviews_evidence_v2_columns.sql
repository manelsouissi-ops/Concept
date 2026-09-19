BEGIN;

-- Additive-only follow-up to
-- scripts/sql/create_historical_technical_source_ai_reviews_table.sql.
--
-- APPLIED and live-verified against the real database on 2026-09-09
-- (confirmed via information_schema.columns inspection). This file
-- remains in the repo as the source-of-truth migration; ADD COLUMN IF NOT
-- EXISTS makes it idempotent, so rerunning it is safe and converges to
-- the same end state rather than erroring or double-applying. Code that
-- reads these columns must still fail closed if it is ever pointed at a
-- database where this migration has not been run.
--
-- WHY: the semantic-classifier v2 hardening (scripts/semantic_review.py,
-- EVIDENCE_FLAG_KEYS) replaced the pilot's ambiguous "client_requirements"
-- evidence flag - every real pilot document that set it also set
-- scope_of_work or technical_specifications, so it carried no independent
-- signal - with three genuinely new, independently useful flags the pilot
-- had no way to express: a mission/task breakdown, REQUIRED consultant/
-- expert profiles (a CDC/TDR signal, distinct from the bidder's OWN
-- proposed team already captured by evidence_proposed_methodology_or_
-- team), and pricing/financial-form annexes. This migration only ADDS the
-- three new nullable boolean columns; it does not touch, rename, or drop
-- evidence_client_requirements or any other existing column - v1 pilot
-- rows are completely unaffected, and old-schema queries against this
-- table continue to work unchanged (new columns are simply NULL on every
-- pre-v2 row).
--
-- Does NOT alter any other table. Does NOT touch
-- knowledge_base.historical_technical_source_candidates or its human-
-- validation columns (validation_status/reviewed_at/reviewed_by) in any
-- way - this migration only ADDs columns to
-- historical_technical_source_ai_reviews.
--
-- CONFIDENTIALITY: identical guarantee as the base table - these are
-- plain booleans, never text/excerpts/filenames/paths.

ALTER TABLE knowledge_base.historical_technical_source_ai_reviews
  ADD COLUMN IF NOT EXISTS evidence_mission_or_tasks BOOLEAN,
  ADD COLUMN IF NOT EXISTS evidence_consultant_profiles BOOLEAN,
  ADD COLUMN IF NOT EXISTS evidence_pricing_or_forms BOOLEAN;

COMMIT;
