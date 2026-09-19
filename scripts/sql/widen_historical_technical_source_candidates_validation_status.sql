BEGIN;

-- Additive-only widening of historical_technical_source_candidates.
-- validation_status's CHECK constraint, to support the v3 semantic-review
-- taxonomy's human-review workflow.
--
-- APPLIED and live-verified against the real database on 2026-09-09
-- (confirmed via pg_constraint / information_schema inspection). This file
-- remains in the repo as the source-of-truth migration and is safe to
-- rerun: see "Rerun safety" below - every statement is idempotent, so
-- rerunning it converges to the same end state rather than erroring or
-- double-applying. Code that depends on this constraint (e.g.
-- mark_validation_status() in scripts/cdc_discovery.py) must still fail
-- closed - via the ordinary DB CHECK violation - if it is ever pointed at
-- a database where this migration has not been run.
--
-- WHY: historical_technical_source_candidates' original validation_status
-- enum (scripts/sql/create_historical_technical_source_candidates_table.sql)
-- only covers the CDC/DAO-family subset of the taxonomy
-- (HUMAN_VALIDATED_CDC/TDR/DAO_WITH_TDR/DAO_WITH_CDC, HUMAN_REJECTED_CDC).
-- The semantic-review v3 pilot (scripts/semantic_review.py, SEMANTIC_ROLES)
-- proposes across a wider 12-role taxonomy (CDC, TDR, DAO_WITH_TDR,
-- DAO_WITH_CDC, DAO, DCE, RFP, OFFER, REPORT, METHODOLOGY, OTHER, UNKNOWN).
-- A human reviewer confirming a v3 proposal's plain DAO/RFP/OFFER/OTHER
-- role, or explicitly recording that a document's role is genuinely
-- uncertain (distinct from NEEDS_HUMAN_REVIEW, which means "not yet
-- decided" rather than "decided that it is ambiguous"), had no matching
-- value to write. This migration ONLY widens the CHECK constraint (adds
-- five new allowed values) - it does not add, rename, or drop any column,
-- does not touch any existing row's value, and does not change
-- reviewed_at/reviewed_by/any other column's constraint in any way.
--
-- Does NOT touch historical_technical_source_ai_reviews or any other
-- table. Purely additive: every value a real row could hold before this
-- migration remains valid after it; the only change is that five more
-- values also become valid.
--
-- Uses PostgreSQL's default auto-generated constraint name
-- (<table>_<column>_check) for the first DROP, which is what
-- CREATE TABLE ... CHECK(...) with no explicit constraint name produces -
-- confirmed against scripts/sql/create_historical_technical_source_
-- candidates_table.sql's unnamed inline CHECK. The replacement constraint
-- is given an explicit name so a future further widening has an
-- unambiguous target.
--
-- Rerun safety: PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS for CHECK
-- constraints, so the explicitly-named replacement constraint is ALSO
-- dropped-if-exists immediately before being (re)added - without this,
-- a second run of this file would fail on "constraint already exists"
-- even though nothing had actually changed. Both DROPs are no-ops on a
-- second run; the ADD is byte-for-byte identical every time, so rerunning
-- this migration any number of times converges to the same end state.

ALTER TABLE knowledge_base.historical_technical_source_candidates
  DROP CONSTRAINT IF EXISTS historical_technical_source_candidates_validation_status_check;

ALTER TABLE knowledge_base.historical_technical_source_candidates
  DROP CONSTRAINT IF EXISTS historical_technical_source_candidates_validation_status_valid_values;

ALTER TABLE knowledge_base.historical_technical_source_candidates
  ADD CONSTRAINT historical_technical_source_candidates_validation_status_valid_values
  CHECK (validation_status IN (
    'MACHINE_CLASSIFIED', 'NEEDS_HUMAN_REVIEW', 'HUMAN_VALIDATED_CDC',
    'HUMAN_VALIDATED_TDR', 'HUMAN_VALIDATED_DAO_WITH_TDR',
    'HUMAN_VALIDATED_DAO_WITH_CDC', 'HUMAN_REJECTED_CDC',
    'HUMAN_VALIDATED_DAO', 'HUMAN_VALIDATED_RFP', 'HUMAN_VALIDATED_OFFER',
    'HUMAN_VALIDATED_OTHER', 'HUMAN_UNCERTAIN'
  ));

COMMIT;
