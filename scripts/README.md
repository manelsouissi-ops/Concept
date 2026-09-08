# CDC Discovery and Classification System (Phase 3/4)

This system discovers and classifies Cahier des Charges (CDC) candidate documents
from the already-inventoried archive (`knowledge_base.archive_files`, populated by
`scripts/archive_cartography/scan_archive.py`). It never walks the filesystem
directly to enumerate projects, and never opens a file unless content inspection
is explicitly enabled (`--enable-content-inspection`) for a metadata candidate.

## Project count facts (manually verified, 2026-09)

- **433** physical top-level OFFRES project folders exist on disk.
- **411** of those contain at least one file (document-bearing).
- **22** of those are genuinely empty (zero files - and therefore zero possible
  CDC candidates, regardless of whether they can be "detected").
- Automatic, database-derived project enumeration correctly reports **411**, not
  433. This is validated, correct behavior, not a bug: a folder with zero files
  is invisible to any enumeration built from file rows, by definition. The 433
  figure remains true and documented here, but is a physical-filesystem fact,
  not the automatic discovery target.

## Safety-by-design

- **No default full-archive scan.** There is no execution mode that runs without
  an explicit flag. Running the script with no arguments performs zero discovery.
- **`--help` is side-effect free.** It never touches the database or the archive.
- **Aggregate-only output.** The CLI never prints a filename, path, project name,
  or document excerpt - only counts.
- **`CONFIRMED_CDC` requires content-backed verification.** Metadata/filename
  heuristics alone can only ever produce `LIKELY_CDC`, `NEEDS_REVIEW`, or
  `NOT_CDC`. By default this script uses a `NullContentInspector`, so
  `CONFIRMED_CDC` stays structurally unreachable unless `--enable-content-inspection`
  is explicitly passed, which wires in `LocalContentInspector`
  (`scripts/cdc_content_inspector.py`) - local PDF/DOCX/DOC extraction, local
  rule-based evidence analysis, and an optional local-Ollama-only second stage.
  Never cloud, never automatic.
- **`--pilot-limit N` selects exactly N top-level OFFRES project folders**
  (deterministic, reproducible - not N files, not N candidates).
- **Content inspection is scoped to metadata candidates only.** A file metadata
  already ruled out (`NOT_CDC`) is never opened, even with
  `--enable-content-inspection` set.

## Usage

```bash
# Help only - zero discovery, zero DB access.
python3 scripts/cdc_discovery.py --help

# Compute candidates for 25 project folders, write nothing to the database.
python3 scripts/cdc_discovery.py --pilot-limit 25 --dry-run

# Same, but also run real local content extraction/verification for metadata
# candidates (never persists; CONFIRMED_CDC becomes reachable here).
python3 scripts/cdc_discovery.py --pilot-limit 25 --dry-run --enable-content-inspection

# Persist results (idempotent upsert keyed by archive_file_id).
python3 scripts/cdc_discovery.py --pilot-limit 25 --persist --idempotent-run

# Read-only aggregate summary of whatever is already persisted.
python3 scripts/cdc_discovery.py --summary

# Safe local validation of a single already-confirmed CDC candidate,
# without persisting its identity anywhere (see below).
python3 scripts/cdc_discovery.py --pilot-limit 25 --dry-run --enable-content-inspection --validate-single-confirmed

# Full-corpus, taxonomy-aware technical-source discovery (see "Full-corpus
# technical-source discovery" below) - metadata-only prefilter dry run.
python3 scripts/cdc_discovery.py --full-corpus --dry-run --batch-size 25

# Same, with real local content extraction/classification.
python3 scripts/cdc_discovery.py --full-corpus --dry-run --batch-size 25 --enable-content-inspection

# Resume a previously interrupted --full-corpus run from its checkpoint.
python3 scripts/cdc_discovery.py --full-corpus --dry-run --batch-size 25 --enable-content-inspection --resume
```

## `--validate-single-confirmed` (safe local validation mode)

**Purpose.** A `--dry-run --enable-content-inspection` run computes `CdcCandidate`
objects entirely in memory and never writes them anywhere - so once the process
exits, even a `CONFIRMED_CDC` result's identity is gone. `--validate-single-confirmed`
lets you run a second, stricter, human-style validation pass over that one
in-memory candidate (if there is exactly one) and see a conservative yes/no
verdict, without ever persisting *which* document it was.

**Required flags.** Only valid together with `--dry-run` and
`--enable-content-inspection`. Used without either, or combined with
`--persist`/`--idempotent-run`, it is rejected by argument validation before
any archive processing starts.

**What is stored.** Nothing. No candidate identity (`archive_file_id`, path,
filename, project/client/country name) is ever persisted to the database, ever
written to a temporary file, or ever printed. The one in-memory reference to a
`CONFIRMED_CDC` candidate exists only for the lifetime of the process.

**What is printed.** Only safe aggregate fields appended to the normal report:
`confirmed_candidates_found`, a final `validation_result`
(`NO_CONFIRMED_CANDIDATE` / `VALIDATED_CDC` / `REJECTED_NOT_CDC` /
`NEEDS_HUMAN_REVIEW` / `MULTIPLE_CONFIRMED_CANDIDATES`), and - only when
exactly one candidate was found - a set of `YES`/`NO`/`UNKNOWN` structural
evidence flags (`explicit_cdc_role`, `scope_requirements`,
`technical_requirements`, `deliverables`, `bidder_obligations`,
`evaluation_requirements`, `administrative_requirements`, `possible_dao`,
`possible_tdr`, `possible_dce`, `possible_rfp`, `possible_offer`) plus
`archive_modified: NO`, `database_writes: 0`, `confidential_text_printed: NO`,
`filename_or_path_printed: NO`. If more than one `CONFIRMED_CDC` candidate is
found, no candidate is arbitrarily chosen - only the count is reported.

**How the verdict is decided.** The structural evidence is computed
deterministically (`scripts/cdc_content_inspector.py`'s
`build_structural_cdc_evidence`/`decide_structural_validation`) over content
already extracted for the primary rule engine - never a second file read.
`VALIDATED_CDC` requires explicit CDC-role language, at least 3 of the 6
structural-requirement signals, and zero conflicting-role signals (DAO/TDR/
DCE/RFP/offer language). `REJECTED_NOT_CDC` requires the opposite: no CDC-role
language, a conflicting role signal, and zero structural signals. Anything
ambiguous - including too little extracted text to be confident - is
`NEEDS_HUMAN_REVIEW`. This never weakens the existing `CONFIRMED_CDC`
threshold in `decide_content_verification`; it only adds a stricter,
independent check on top of a document that already passed it.

Intended for local, human-style verification of a single candidate before
ever deciding whether to persist it.

## Full-corpus technical-source discovery (`--full-corpus`)

**Why this exists.** The 25-project pilot proved the pipeline works
technically, but also proved the original "CONFIRMED_CDC vs not" model is
too narrow for the real business objective. The historical documents
CONCEPT actually needs to find are frequently a **DAO/Appel d'Offres
wrapper that contains an embedded Termes de Reference or Cahier des
Charges section**, alongside instructions to bidders, evaluation criteria,
required experts, methodology, and deliverables. Forcing that shape into
"CDC or not CDC" either loses it entirely or wrongly promotes an
administrative document. `--full-corpus` replaces that binary outcome with
a document-role taxonomy plus a weighted structural fingerprint, computed
by the new `scripts/technical_source_classifier.py` module, layered
**on top of**, never replacing, the existing CDC-only pipeline above (both
share the same duplicate handling, path resolution, and PDF/DOCX/DOC
extraction).

**Production sequence:**
```
Existing archive cartography
        v
Full metadata prefilter (Stage A - filename/path/extension/technical_bucket)
        v
Local content extraction + classification (Stage B - candidates only)
        v
Candidate review queue (HIGH_PRIORITY / MEDIUM_PRIORITY / EXTRACTION_FAILED)
        v
Human validation (local review UI - see "Review UI" below)
        v
Validated historical technical-source corpus
        v
Later: extract 21 technical characteristics -> Excel matrix -> coverage /
minimum CDC combination / proximity / recency (NOT implemented by this
pipeline - see "Future work" below)
```

**Document-role taxonomy** (`scripts/technical_source_classifier.py`'s
`TECHNICAL_SOURCE_ROLES`): `CDC`, `TDR`, `DAO_WITH_TDR`, `DAO_WITH_CDC`,
`DAO`, `DCE`, `RFP`, `OFFER`, `REPORT`, `METHODOLOGY`, `OTHER`, `UNKNOWN`.
A DAO wrapper containing an embedded TDR or CDC section is classified as
`DAO_WITH_TDR`/`DAO_WITH_CDC` and **is** a valid technical-source
candidate - it is never rejected just because its overall wrapper role is
DAO. `OFFER`/`REPORT`/`METHODOLOGY` (CONCEPT-produced deliverables, not a
client specification) are never technical-source candidates, regardless of
how structurally rich they look.

**Weighted structural fingerprint.** 14 signals (`context_or_justification`,
`objectives`, `scope_or_prestations`, `technical_requirements`,
`mission_phases`, `methodology_requirements`, `required_personnel`,
`required_experience`, `deliverables`, `calendar_or_duration`,
`evaluation_criteria`, `bidder_obligations`, `administrative_requirements`,
`payment_or_contract_conditions`), each detected via French/English/accent-
tolerant patterns - no exact section title is required. `scope_or_prestations`,
`technical_requirements`, and `deliverables` are weighted 2; every other
signal is weighted 1 (`STRUCTURAL_SIGNAL_WEIGHTS`, `STRUCTURAL_MAX_SCORE`).
`structural_ratio = structural_score / structural_max` is banded into
`STRONG_TECHNICAL_SOURCE` (ratio ≥ `STRUCTURAL_BAND_STRONG_RATIO`, 0.6),
`POSSIBLE_TECHNICAL_SOURCE` (≥ `STRUCTURAL_BAND_POSSIBLE_RATIO`, 0.3), or
`WEAK_TECHNICAL_SOURCE` - all named constants, directly testable and
tunable without touching the scoring logic itself.

**Stage A (fast metadata prefilter).** Filename/path pattern match against
an intentionally broad term list (cdc, cahier des charges, tdr, termes de
référence, dao, appel d'offres, rfp, dce, consultation, specifications,
instructions aux soumissionnaires, ...) plus the existing Phase 2
`archive_file_classifications.technical_bucket` (prefers `BUSINESS_DOCUMENT`;
a file with no classification row yet is treated as relevant, fail-open for
recall) plus extension (`pdf`/`doc`/`docx`/`odt`/`rtf`; `xls`/`xlsx` only
when the filename itself also matched a strong term). **Metadata alone can
only ever create a Stage B candidate - it never produces a final role or
validation decision.**

**Stage B (local content inspection).** Reuses the exact same local
PDF/DOCX/DOC extraction as the CDC-only pipeline
(`scripts/cdc_content_inspector.py`). Every successfully-extracted document
(not just ones that would separately verify as CONFIRMED_CDC) gets a
`technical_source_classification` computed and attached to the extraction
outcome - a flat dict of role/score/section-flag values, never raw text, a
filename, or a path.

**Full-corpus project enumeration.** `--full-corpus` never hardcodes a
project count. It derives the complete document-bearing project set from
the same `enumerate_project_folders()` the pilot mode already uses, applied
to *every* fetched row instead of a `--pilot-limit`-truncated selection -
currently 411 document-bearing projects by verified filesystem fact, but
the code computes that number, it never assumes it.

**Batching + resume (`--batch-size`, `--resume`, `--checkpoint-file`).** A
full run can take hours, so it is never a single fragile pass:
`--full-corpus` requires `--batch-size N` and processes exactly N project
folders per batch, writing a local JSON checkpoint
(`scripts/.cdc_full_corpus_checkpoint.json` by default) after every batch -
never a filename/path/project name, only batch indices and aggregate
counts. A batch that raises is recorded in `failed_batches` and the run
continues with the next batch (one bad batch never aborts the rest of the
corpus). Without `--resume`, rerunning against an existing incomplete
checkpoint for the *same* scope (same project set + `--batch-size`) refuses
to start, rather than silently reprocessing or discarding it; `--resume`
continues from the last completed batch, skipping everything already done.
A checkpoint whose scope no longer matches (project set rescanned, or
`--batch-size` changed) is never silently overwritten under `--resume` -
remove the checkpoint file explicitly to start fresh in that case.

**Review queue (`review_priority`).** `HIGH_PRIORITY`: `CDC`/`TDR`/
`DAO_WITH_TDR`/`DAO_WITH_CDC`, or `DCE`/`RFP` with a `STRONG_TECHNICAL_SOURCE`
band. `MEDIUM_PRIORITY`: every other candidate that still qualified (a
weaker-banded `DCE`/`RFP`, or a `DAO`/`OTHER`/`UNKNOWN` wrapper whose
structural score alone earned candidacy). `EXTRACTION_FAILED`: metadata
looked relevant but content could not be read (Task 16: legacy `.doc`
conversion failures - already ~50% in the pilot - never block the rest of
the corpus; they are simply queued for a future fallback strategy). An
ordinary non-candidate document is never added to the queue at all.

**Local storage model.** A new, separate table is proposed -
`scripts/sql/create_historical_technical_source_candidates_table.sql`
(**not applied**) - rather than extending
`create_historical_cdc_candidates_table.sql`, because the shape genuinely
differs (12-value role taxonomy, structural score/ratio, review priority, a
different human-validation status enum: `PENDING`/`VALIDATED_CDC`/
`VALIDATED_TDR`/`VALIDATED_DAO_WITH_TDR`/`VALIDATED_DAO_WITH_CDC`/
`REJECTED`/`NEEDS_REVIEW`). Never stores extracted document text, exactly
like the existing CDC-only table.

**Review UI - not yet implemented.** `/administration/knowledge` currently
has a single archive-inventory table with no tab/section structure. Adding
a technical-source review tab (year, project, role, structural score,
confidence, review status, extraction status, and a locally-scoped "open
original" action - never printing a path in the page itself) is the
immediate next task once this backend/schema is reviewed and the migration
above is applied.

**Future work (explicitly out of scope for this pipeline).** Once
candidates are human-validated, a separate future pipeline extracts 21
technical characteristics per validated document, builds the historical
Excel matrix, and computes coverage / minimum-CDC-combination / proximity /
recency. None of that - including any proximity calculation - is
implemented or started here.

## Review workflow (`scripts/cdc_review.py`, Phase 6)

**"Machine classification is not human validation."** A real full-corpus
content-inspection run found `CDC: 12`, `STRONG_TECHNICAL_SOURCE: 2`,
`POSSIBLE_TECHNICAL_SOURCE: 82`, `HIGH_PRIORITY: 337`. None of those numbers
mean "12/2/82/337 documents have been confirmed by a human as historical
CDCs." They mean the deterministic rules in
`scripts/technical_source_classifier.py` assigned that role/band/priority.
`scripts/cdc_review.py` is the separate, dedicated tool for turning a
machine classification into an actual human decision - it never blurs the
two, in either its code or its output.

It is a **separate CLI/entry point** from `cdc_discovery.py` on purpose:
discovery finds and classifies candidates across the whole corpus (can run
for hours); review is always exactly one deliberate, human-initiated action
at a time. It reuses (never duplicates) `cdc_discovery.py`'s existing,
already-tested primitives - `_connect`, `resolve_archive_file_path`,
`launch_local_opener`, `PostgresTechnicalSourceCandidateRepository`.

**Requires `knowledge_base.historical_technical_source_candidates` to
already exist and be populated** (`scripts/sql/create_historical_technical_source_candidates_table.sql`
applied, then a `cdc_discovery.py --full-corpus --persist` run) - neither
was done by this development task; every command below is built and tested
against synthetic/mocked data only.

### `--review-summary` (aggregate-only mode)

```bash
python3 scripts/cdc_review.py --review-summary
```

Every value returned is the result of a `COUNT(*)`/`COUNT(DISTINCT ...)`/
`GROUP BY ... COUNT(*)` SQL query - never a row-level `SELECT` of
`archive_file_id`, `project_reference`, or any archive_files column beyond
an aggregated `extension` breakdown. Reports: `cdc_candidates`,
`dao_with_cdc_candidates`, `strong_technical_candidates`,
`possible_technical_candidates`, `extraction_failures`,
`projects_represented` (a count, never the reference values themselves),
per-role counts (all 12 roles, even at 0), per-band counts, per-priority
counts, per-extraction-status counts, per-extraction-method counts,
per-extraction-failure-category counts (Task 6: the 117-candidate
`EXTRACTION_FAILED` bucket from the real run is never discarded - this is
how it stays investigable), per-file-extension counts, and critically
`machine_classified_never_reviewed` alongside a `validation_<STATUS>` count
for every `HUMAN_*`/`NEEDS_HUMAN_REVIEW` status - the one field that makes
"how many of these were actually looked at by a human" visible at a
glance.

### `--review-open --archive-file-id N` (controlled single-document review)

```bash
python3 scripts/cdc_review.py --review-open --archive-file-id 4821
```

Opens **exactly one** document locally - `archive_file_id` is a database-
generated integer the developer already has (from direct SQL inspection or
a future review UI), never a name typed into this tool. No bulk opening,
no iteration over multiple candidates - the query is `WHERE archive_file_id
= %s`, not a list. Resolves the path via the same traversal-safe
`resolve_archive_file_path()` every other mode uses, then launches a local
desktop opener (`xdg-open`, falling back to `gio`) exactly like the
CDC-only pipeline's `--open-single-confirmed` - fire-and-forget subprocess,
stdout/stderr suppressed, never a network call. **Strictly read-only**:
opening a candidate has no code path that writes `validation_status` -
looking at a document is not the same action as validating it, and a
candidate that is not structurally confirmed is never silently upgraded to
confirmed just because someone opened it. Output includes the candidate's
already-known `detected_role`/`validation_status` (safe labels) but never a
filename or path. An unresolvable/out-of-scope path, or an unknown
`archive_file_id`, fails closed (`CANDIDATE_NOT_FOUND` /
`INVALID_FILE_PATH`) - it is never guessed at.

### `--review-mark --archive-file-id N --validation-status X` (recording a human decision)

```bash
python3 scripts/cdc_review.py --review-mark --archive-file-id 4821 \
  --validation-status HUMAN_VALIDATED_CDC --reviewed-by 3
```

The **only** code path anywhere in this project that can ever set a
`HUMAN_*`/`NEEDS_HUMAN_REVIEW` `validation_status` -
`MACHINE_CLASSIFIED` (the discovery-time default) is rejected as a target
status, since it is only ever the column's own default, never something a
caller re-asserts. Auditable: always stamps `reviewed_at`/`reviewed_by`.
Idempotent: setting the same status again is a normal, repeatable update,
not an error. **Never clobbered by a later discovery re-run**: `upsert()`
(machine classification) and `mark_validation_status()` (human decision)
write disjoint column sets by construction -
`PostgresTechnicalSourceCandidateRepository.upsert()`'s SQL never
references `validation_status`/`reviewed_at`/`reviewed_by` at all, so
re-running `--full-corpus --persist` for a candidate a human already
reviewed leaves that human decision exactly as it was.

### Human validation states

```
MACHINE_CLASSIFIED           -- default; no human has looked at it (upsert() only ever leaves this alone or untouched)
NEEDS_HUMAN_REVIEW           -- explicitly queued, ambiguous
HUMAN_VALIDATED_CDC
HUMAN_VALIDATED_TDR
HUMAN_VALIDATED_DAO_WITH_TDR
HUMAN_VALIDATED_DAO_WITH_CDC
HUMAN_REJECTED_CDC
```

`TECHNICAL_SOURCE_VALIDATION_STATUSES` (full enum) and
`HUMAN_SETTABLE_VALIDATION_STATUSES` (every value `--review-mark` accepts,
i.e. everything except `MACHINE_CLASSIFIED`) are both in
`scripts/cdc_discovery.py`.

### Review-category view (`REVIEW_CATEGORY_ORDER`)

A presentation-layer view over the SAME fields already computed by
discovery (`detected_role`, `structural_band`, `extraction_status`) - no
new/invented scoring, no second source of truth. Distinguishes `CDC`,
`DAO_WITH_CDC`, `STRONG_TECHNICAL_SOURCE`, `POSSIBLE_TECHNICAL_SOURCE`,
`EXTRACTION_FAILED` (a candidate can belong to more than one - these are
overlapping lenses, not a partition). `order_candidates_for_review()`
gives a fully deterministic ordering (tiebreak by `archive_file_id`, never
by filename): `EXTRACTION_FAILED`/`STRONG_TECHNICAL_SOURCE` first (the
least-understood, most valuable to look at), then
`POSSIBLE_TECHNICAL_SOURCE`, then the already-role-confirmed
`CDC`/`DAO_WITH_CDC`, then everything else - the reviewer's own suggested
conceptual order, not an invented numeric score.

### Extraction-failure categories (Task 6)

`scripts/technical_source_classifier.EXTRACTION_FAILURE_CATEGORIES`:
`MISSING_SOURCE`, `PDF_EXTRACTION_FAILURE`, `DOC_EXTRACTION_FAILURE`,
`DOCX_EXTRACTION_FAILURE`, `EMPTY_OUTPUT`, `UNSUPPORTED_FORMAT`, `OTHER` -
a stable, small mapping from `cdc_content_inspector.py`'s internal
`ExtractionError` reason codes, never the raw codes or a path/filename.
Stored per-candidate as `extraction_failure_category`
(`TechnicalSourceCandidate`/the SQL table) so the real run's 117
`EXTRACTION_FAILED` candidates can be triaged by failure type without ever
touching a raw reason code.

### Checkpoint compatibility (Task 8)

`compute_batch_scope_signature()` fingerprints the FULL configuration, not
just the project set and `--batch-size`:
`build_full_corpus_scope_config()` also includes `enable_content_inspection`
and `classifier_version`
(`scripts/technical_source_classifier.TECHNICAL_SOURCE_CLASSIFIER_VERSION`,
bumped whenever the classification rules change in a way that could alter
results). **A metadata-only checkpoint can never be silently resumed as a
content-inspection run**, and a checkpoint recorded under an older
classifier version is never silently treated as interchangeable with a
newer one - either mismatch fails closed with a specific message
(`describe_scope_mismatch()` names exactly which dimension changed), never
a silent restart or silent reuse of incompatible state.

### Extraction performance (Task 9)

`run_technical_source_discovery_for_projects()` caches each Stage-B
outcome by `sha256` within a run: a prefilter candidate whose content hash
was already inspected earlier in that same run reuses the cached
classification instead of re-invoking Docling/LibreOffice
(`duplicate_extractions_avoided` counter). This is never a correctness
compromise - identical bytes (the same hash Phase 1's scanner already
computed) always produce identical extracted text and therefore identical
classification, deterministically; a `NULL` hash is never used as a cache
key, matching the existing "a NULL sha256 is never treated as a duplicate"
convention everywhere else in this pipeline.

### Confidentiality (Task 11 - review workflow)

Same guarantees as the rest of this pipeline, applied to the review layer
specifically: `--review-summary` is aggregate SQL only (nothing to redact -
the query itself cannot return an identifying value); `--review-open`'s
only identifying input is an integer the developer already has; neither
mode, nor `--review-mark`, ever prints a filename, absolute path, or
extracted document text. No cloud AI, no external HTTP call, anywhere in
`cdc_review.py`. No archive modification - the opener launches a local
desktop viewer read-only.

### Project/CONCEPT-code mapping (Task 7)

`project_reference` (on both `TechnicalSourceCandidate` and the
`historical_technical_source_candidates` table) is a filename/path REGEX
guess (`extract_project_reference_from_path`) - **not** an authoritative
CONCEPT internal project code. No resolution mechanism between a
historical tender/project and its official code exists yet. Every
candidate's `project_mapping_status` is explicitly `"UNRESOLVED"`
(`PROJECT_MAPPING_STATUSES`, currently single-valued) so this gap is
visible in the data model rather than silently assumed away - nothing in
this codebase infers or invents an internal code.

## Features

1. **Path/filename metadata analysis** for a candidate signal (cdc, cahier des charges, dao, dce, etc.) - never content-based.
2. **Year extraction** from folder names.
3. **Project reference identification** from parent folder names.
4. **Document role detection** from filenames (CDC, DAO, TDR, DCE, RFP, INVITATION, ANNEX, OTHER_TENDER_DOCUMENT, UNKNOWN) - `DAO`/`TDR`/`DCE` are never automatically treated as `CDC`.
5. **Duplicate detection** by reusing the SHA-256 already computed by Phase 1's scanner (never re-hashes, never reopens a file).
6. **Local content extraction** (`scripts/cdc_content_inspector.py`, opt-in via `--enable-content-inspection`) - all formats stay strictly local, no cloud fallback ever:
   - **PDF** → the existing local Docling service (subprocess, its own isolated `.venv-docling` interpreter).
   - **DOCX** → the standard library (zip + XML), no new dependency.
   - **DOC** (legacy binary) → local LibreOffice headless conversion to DOCX (subprocess, PATH-resolved, isolated per-call temp directory/profile, source file never modified), then the same DOCX text-reading core.
   - **OCR** → still not implemented (a reserved, counted fallback trigger point for scanned/image-only PDFs; always fails closed to `NEEDS_REVIEW` for now).

   Extracted text is length-limited and never logged/persisted in full - only short reason codes and aggregate counts ever leave this module.
7. **Local rule-based evidence analysis**: recognizes tender-document signal phrases (cahier des charges, termes de référence, dossier d'appel d'offres, etc.) and distinguishes `document_role` from `cdc_status` - a document whose content signals DAO/TDR/DCE/RFP keeps that role and is never auto-promoted to CDC.
8. **Optional local AI second stage**: Ollama only (loopback-enforced, `qwen3:14b`), strict JSON schema validation, fails closed on any timeout/malformed response/schema violation. Off by default; can only add friction to a rule-based confirmation, never bypass it.
9. **Staged classification lifecycle** (`CONFIRMED_CDC`, `LIKELY_CDC`, `NEEDS_REVIEW`, `NOT_CDC`) with metadata vs. content-verified candidates kept strictly separate.
10. **Idempotent persistence** into `knowledge_base.historical_cdc_candidates` (see `scripts/sql/create_historical_cdc_candidates_table.sql`), unique per `archive_file_id`.

## System Output

The script prints an aggregate-only JSON-shaped report: project folders selected,
files metadata-inspected, files content-inspected, per-format extraction call/
success/failure counts (PDF, DOCX, DOC), granular failure reason counters
(`pdf_path_missing`, `docling_*`, `doc_path_missing`, `libreoffice_*`), OCR calls,
local AI calls, aggregate classification-reason counters (`content_role_*`,
`content_confirmed_cdc`/`content_not_cdc`/`content_ambiguous`/
`content_insufficient_signals`/`content_extraction_failed`, `evidence_strong`/
`evidence_medium`/`evidence_weak`), failed extractions, external calls (always 0),
duplicate groups/files, status counts (`CONFIRMED_CDC`/`LIKELY_CDC`/
`NEEDS_REVIEW`/`NOT_CDC`), and persistence counts (rows inserted/updated). Every
value is a plain count or boolean - never a filename, path, or excerpt of
document content.

`--full-corpus` prints a separate, equally aggregate-only report:
`projects_selected`, `files_metadata_inspected`, `prefilter_candidates`,
`files_content_inspected`, PDF/DOCX/DOC success/failure counts, per-role
counts (`CDC`/`TDR`/`DAO_WITH_TDR`/`DAO_WITH_CDC`/`DAO`/`DCE`/`RFP`/`OFFER`/
`REPORT`/`METHODOLOGY`/`OTHER`/`UNKNOWN`), per-band counts
(`STRONG_TECHNICAL_SOURCE`/`POSSIBLE_TECHNICAL_SOURCE`/`WEAK_TECHNICAL_SOURCE`),
per-priority counts (`HIGH_PRIORITY`/`MEDIUM_PRIORITY`/`EXTRACTION_FAILED`),
`external_calls` (always 0), `rows_inserted`/`rows_updated`, and
`batches_completed`/`batches_failed`/`batches_total`.

See `scripts/cdc_discovery_test.py`, `scripts/cdc_content_inspector_test.py`,
and `scripts/technical_source_classifier_test.py` for the synthetic test
suites.

**All archive content processing remains entirely local. There is no cloud
fallback anywhere in this pipeline** (PDF/DOCX/DOC extraction, evidence
analysis, and the optional AI stage are all local-only; the AI adapter
refuses at construction time if given a non-loopback URL).