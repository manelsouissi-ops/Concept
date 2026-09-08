BEGIN;

-- .DOC/LibreOffice pipeline repair (review workflow) - widens the
-- extraction_failure_category CHECK constraint on
-- knowledge_base.historical_technical_source_candidates to allow the new,
-- more specific failure categories introduced by the review-workflow .DOC
-- pipeline repair (scripts/cdc_content_inspector.py /
-- scripts/technical_source_classifier.py). ADDITIVE ONLY: every existing
-- allowed value (including EMPTY_OUTPUT, which the 17 already-persisted
-- FAILED rows from the first 25-document pilot use, and which stays
-- reachable going forward via PDF's ocr_not_available reason) is kept -
-- nothing already stored is invalidated, and no row is modified by this
-- migration. NOT YET APPLIED to the real database as of this commit -
-- proposed schema only, for review before it is ever run. Required before
-- a real retry of any FAILED/EMPTY_OUTPUT candidate can persist a machine
-- result using one of the new categories.
--
-- New categories (see technical_source_classifier.EXTRACTION_FAILURE_CATEGORIES):
--   CONVERSION_NO_OUTPUT   - LibreOffice exited 0 but produced no/zero-byte output
--   CONVERSION_FAILED      - LibreOffice missing, crashed, or exited non-zero
--   CONVERSION_TIMEOUT     - LibreOffice conversion exceeded the bounded timeout
--   INVALID_DOCX_OUTPUT    - LibreOffice produced a file that is not a valid ZIP/OOXML DOCX
--   EMPTY_EXTRACTED_TEXT   - conversion/extraction succeeded but yielded no text
--                            (replaces the old, ambiguous EMPTY_OUTPUT meaning for
--                            this specific case going forward)
--   ENCRYPTED_OR_PROTECTED - a standard CFBF encryption wrapper was detected
--   SOURCE_FORMAT_MISMATCH - the file's real format (RTF/HTML/XML/...) does not
--                            match its .doc extension, and no safe dedicated
--                            extractor exists for the detected format

ALTER TABLE knowledge_base.historical_technical_source_candidates
  DROP CONSTRAINT IF EXISTS historical_technical_source_c_extraction_failure_category_check;

ALTER TABLE knowledge_base.historical_technical_source_candidates
  ADD CONSTRAINT historical_technical_source_c_extraction_failure_category_check
  CHECK (extraction_failure_category IS NULL OR (extraction_failure_category = ANY (ARRAY[
    'MISSING_SOURCE', 'PDF_EXTRACTION_FAILURE', 'DOC_EXTRACTION_FAILURE',
    'DOCX_EXTRACTION_FAILURE', 'EMPTY_OUTPUT', 'UNSUPPORTED_FORMAT', 'OTHER',
    'CONVERSION_NO_OUTPUT', 'CONVERSION_FAILED', 'CONVERSION_TIMEOUT',
    'INVALID_DOCX_OUTPUT', 'EMPTY_EXTRACTED_TEXT', 'ENCRYPTED_OR_PROTECTED',
    'SOURCE_FORMAT_MISMATCH'
  ]::text[])));

COMMIT;
