-- APPLIED AND LIVE-VERIFIED on GONOGO on 2026-09-28. Applied via psql with
-- ON_ERROR_STOP, using this file's own BEGIN/COMMIT (no outer transaction,
-- no manual substitutions). Verified afterward from a FRESH connection/
-- transaction: both CHECK constraints now contain every previously-allowed
-- value plus exactly the documented new ones; candidate_total unchanged at
-- 750; total constraint count on the table unchanged at 37; the
-- extraction_status/extraction_method/extraction_failure_category
-- aggregate distributions are byte-for-byte identical before and after;
-- max(updated_at) and a 0-row "updated in the last 10 minutes" count
-- confirm no candidate row was touched by this migration.
--
-- Targeted CDC recovery infrastructure - widens the two CHECK constraints
-- on knowledge_base.historical_technical_source_candidates that currently
-- reject values the ODT/RTF/XLSX/DOC-embedded-images recovery code
-- (scripts/cdc_content_inspector.py, scripts/technical_source_classifier.py)
-- is now capable of producing. Confirmed against the live constraint
-- definitions (via pg_get_constraintdef) before writing this file:
--
--   extraction_failure_category currently allows exactly:
--     MISSING_SOURCE, PDF_EXTRACTION_FAILURE, DOC_EXTRACTION_FAILURE,
--     DOCX_EXTRACTION_FAILURE, EMPTY_OUTPUT, UNSUPPORTED_FORMAT, OTHER,
--     CONVERSION_NO_OUTPUT, CONVERSION_FAILED, CONVERSION_TIMEOUT,
--     INVALID_DOCX_OUTPUT, EMPTY_EXTRACTED_TEXT, ENCRYPTED_OR_PROTECTED,
--     SOURCE_FORMAT_MISMATCH
--     (matches scripts/sql/20260907_extraction_failure_category_widen.sql
--     exactly - repository and live database agree, confirmed read-only.)
--
--   extraction_method currently allows exactly:
--     pdf_text, docx_text, doc_text
--
-- Neither list has ever included the five new failure categories or three
-- new extraction methods the recovery code now emits. Without this
-- migration, ANY future persistence attempt for an ODT/RTF/XLSX success or
-- a DOC_EMBEDDED_IMAGES_ONLY failure would be rejected by the database at
-- INSERT/UPDATE time - this is a hard blocker for the recovery
-- orchestrator's persistence path, independent of and in addition to the
-- orchestrator itself not being authorized to execute in this task.
--
-- ADDITIVE ONLY: every existing allowed value in both constraints is
-- preserved verbatim. No row is modified. No column type, nullability, or
-- other constraint changes. Two ALTER TABLE / DROP+ADD CONSTRAINT pairs
-- only, each wrapped so the old constraint is dropped and an equivalent,
-- strictly wider one is added in its place - the standard pattern already
-- used by 20260907_extraction_failure_category_widen.sql.
--
-- New extraction_failure_category values
-- (see technical_source_classifier.EXTRACTION_FAILURE_CATEGORIES):
--   ODT_EXTRACTION_FAILURE  - the ODT zip/XML container could not be read
--                             or parsed
--   RTF_EXTRACTION_FAILURE  - the RTF file could not be read
--   XLSX_EXTRACTION_FAILURE - the XLSX workbook could not be opened or is
--                             malformed
--   XLSX_DIMENSIONS_EXCEEDED - the workbook exceeds the bounded sheet/row/
--                             column/cell-count safety limits and was
--                             deliberately not read in full
--   DOC_EMBEDDED_IMAGES_ONLY - a DOC->DOCX conversion succeeded but
--                             produced no extractable text, and the
--                             converted DOCX is confirmed to contain
--                             embedded image parts (e.g. a scanned page)
--
-- New extraction_method values (see cdc_content_inspector.py's
-- LocalContentInspector.inspect dispatch):
--   odt_text  - ODT text extraction path
--   rtf_text  - standalone RTF text extraction path (RTF as a first-class
--               top-level extension, not only as a DOC source-format
--               mismatch case)
--   xlsx_text - bounded, macro-safe XLSX cell-text extraction path
--
-- Required before any real persistence of a recovered ODT/RTF/XLSX
-- candidate, or of a DOC_EMBEDDED_IMAGES_ONLY diagnosis, can succeed.
--
-- VERIFICATION (read-only, run before applying):
--   Confirm current constraint definitions and that no row already
--   violates the constraints being replaced (should always be true for an
--   additive widen, but cheap to confirm):
--
--     SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--     WHERE conrelid = 'knowledge_base.historical_technical_source_candidates'::regclass
--       AND conname IN (
--         'historical_technical_source_c_extraction_failure_category_check',
--         'historical_technical_source_candidates_extraction_method_check'
--       );
--
-- VERIFICATION (after applying, still read-only):
--   1. Re-run the SELECT above and confirm both constraint definitions now
--      include the five new failure-category values and three new
--      extraction-method values, with every previously-allowed value still
--      present.
--   2. Confirm zero rows were touched:
--        SELECT count(*) FROM knowledge_base.historical_technical_source_candidates;
--      (compare the before/after count - an additive CHECK-constraint
--      widen never changes it, and neither statement below does an UPDATE).
--   3. Confirm the five/three new values are individually accepted and the
--      old ones remain accepted, e.g. in a throwaway ROLLBACK'd
--      transaction:
--        BEGIN;
--        UPDATE knowledge_base.historical_technical_source_candidates
--          SET extraction_failure_category = 'DOC_EMBEDDED_IMAGES_ONLY'
--          WHERE false; -- touches zero rows, only proves the CHECK passes
--        ROLLBACK;
--
-- REVERSAL (if this migration needs to be undone before any row uses a new
-- value - once a row uses a new value, reversal requires first migrating
-- that row's value or deleting/updating it, which is out of scope for a
-- schema-only rollback):
--
--   BEGIN;
--
--   ALTER TABLE knowledge_base.historical_technical_source_candidates
--     DROP CONSTRAINT IF EXISTS historical_technical_source_c_extraction_failure_category_check;
--   ALTER TABLE knowledge_base.historical_technical_source_candidates
--     ADD CONSTRAINT historical_technical_source_c_extraction_failure_category_check
--     CHECK (extraction_failure_category IS NULL OR (extraction_failure_category = ANY (ARRAY[
--       'MISSING_SOURCE', 'PDF_EXTRACTION_FAILURE', 'DOC_EXTRACTION_FAILURE',
--       'DOCX_EXTRACTION_FAILURE', 'EMPTY_OUTPUT', 'UNSUPPORTED_FORMAT', 'OTHER',
--       'CONVERSION_NO_OUTPUT', 'CONVERSION_FAILED', 'CONVERSION_TIMEOUT',
--       'INVALID_DOCX_OUTPUT', 'EMPTY_EXTRACTED_TEXT', 'ENCRYPTED_OR_PROTECTED',
--       'SOURCE_FORMAT_MISMATCH'
--     ]::text[])));
--
--   ALTER TABLE knowledge_base.historical_technical_source_candidates
--     DROP CONSTRAINT IF EXISTS historical_technical_source_candidates_extraction_method_check;
--   ALTER TABLE knowledge_base.historical_technical_source_candidates
--     ADD CONSTRAINT historical_technical_source_candidates_extraction_method_check
--     CHECK (extraction_method IS NULL OR (extraction_method = ANY (ARRAY[
--       'pdf_text', 'docx_text', 'doc_text'
--     ]::text[])));
--
--   COMMIT;

BEGIN;

ALTER TABLE knowledge_base.historical_technical_source_candidates
  DROP CONSTRAINT IF EXISTS historical_technical_source_c_extraction_failure_category_check;

ALTER TABLE knowledge_base.historical_technical_source_candidates
  ADD CONSTRAINT historical_technical_source_c_extraction_failure_category_check
  CHECK (extraction_failure_category IS NULL OR (extraction_failure_category = ANY (ARRAY[
    'MISSING_SOURCE', 'PDF_EXTRACTION_FAILURE', 'DOC_EXTRACTION_FAILURE',
    'DOCX_EXTRACTION_FAILURE', 'EMPTY_OUTPUT', 'UNSUPPORTED_FORMAT', 'OTHER',
    'CONVERSION_NO_OUTPUT', 'CONVERSION_FAILED', 'CONVERSION_TIMEOUT',
    'INVALID_DOCX_OUTPUT', 'EMPTY_EXTRACTED_TEXT', 'ENCRYPTED_OR_PROTECTED',
    'SOURCE_FORMAT_MISMATCH',
    'ODT_EXTRACTION_FAILURE', 'RTF_EXTRACTION_FAILURE', 'XLSX_EXTRACTION_FAILURE',
    'XLSX_DIMENSIONS_EXCEEDED', 'DOC_EMBEDDED_IMAGES_ONLY'
  ]::text[])));

ALTER TABLE knowledge_base.historical_technical_source_candidates
  DROP CONSTRAINT IF EXISTS historical_technical_source_candidates_extraction_method_check;

ALTER TABLE knowledge_base.historical_technical_source_candidates
  ADD CONSTRAINT historical_technical_source_candidates_extraction_method_check
  CHECK (extraction_method IS NULL OR (extraction_method = ANY (ARRAY[
    'pdf_text', 'docx_text', 'doc_text', 'odt_text', 'rtf_text', 'xlsx_text'
  ]::text[])));

COMMIT;
