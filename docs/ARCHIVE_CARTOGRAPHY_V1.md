# Archive Cartography V1

Date: 2026-08-28
Scope: build and locally test a read-only filesystem cataloging pipeline
for CONCEPT's historical archive. No AI, no embeddings, no Docling, no
document-content analysis, no classification. The real ~80 GB archive was
**not** scanned in this task — only a small synthetic test directory was
used.

```text
SCANNER IMPLEMENTED       = YES
READ-ONLY GUARANTEE       = VERIFIED (tested)
POSTGRES CATALOG          = YES (additive migration, applied locally)
FULL 80 GB ARCHIVE SCANNED = NO
AI / EMBEDDINGS / DOCLING USED = NO
DOCUMENT CLASSIFICATION   = NOT PERFORMED (Phase 2)
```

## 1. Purpose

Before any AI extraction or RAG ingestion touches the historical archive,
we need a factual, deterministic inventory of what is actually on disk:
how many files, how large, what types, how many are exact duplicates, and
which ones fail to read. Archive Cartography V1 builds that inventory
without opening or interpreting a single document's content — it only
looks at filesystem facts (name, path, size, timestamp) and a content
hash used purely for duplicate detection.

## 2. Why inventory precedes AI

Extraction, classification, and embedding are expensive (compute, review
time) and irreversible in the sense that a bad early decision compounds
across ~49,000 files. Knowing the real shape of the archive first —
extension mix, duplicate rate, unreadable-file rate, folder structure —
lets Phase 2 (classification) and later ingestion be scoped and budgeted
accurately instead of discovered file-by-file during an expensive AI pass.
This mirrors the project's own precedent: the historical-project RAG
pilot (`docs/HISTORICAL_PROJECT_INGESTION_PILOT.md`) explicitly refused to
guess at real data and instead built infrastructure first.

## 3. Read-only guarantee

The scanner (`scripts/archive_cartography/scan_archive.py`) only ever
calls `Path.stat()` and opens files in binary **read** mode (`"rb"`) to
stream-hash them. It contains no `rename`, `move`, `unlink`, `write`,
`chmod`, or `utime` call anywhere against the scanned tree — confirmed by
a dedicated test (`test_scanning_never_modifies_the_source_files`) that
snapshots a file's mode, mtime, and byte content before scanning and
asserts they are bit-for-bit identical afterward. All scanner-generated
state (the Postgres catalog) lives entirely outside the archive.

## 4. Existing infrastructure reviewed first (Step 1)

- `services/knowledge-base/list_pdfs.py`: a good style reference (env-var
  root, `Path.rglob`, shell-safe JSONL, no shell parsing of filenames) but
  PDF-only and does no hashing/stat — not directly reusable as a general
  scanner.
- `services/knowledge-base/service.py`: single-file ingestion only (one
  `source_path` per `/ingest` call); its `sha256_file()` streaming pattern
  (1 MiB chunks) is the direct model for this scanner's own hashing.
- `knowledge_base.knowledge_documents` / `knowledge_document_versions`:
  deliberately **not** reused. Their `sha256` column is globally UNIQUE
  (models one document identity), and their `status` lifecycle assumes the
  full CDC pipeline (Docling → metadata → chunks → embeddings → Qdrant) ran
  to completion. A bare "file seen on disk" fact does not fit those
  invariants, and duplicate detection specifically *requires* multiple
  rows to share a hash — the opposite of that table's UNIQUE constraint.
  This mirrors the explicit design rationale already recorded in
  `scripts/sql/20260827_historical_project_records.sql`'s own comment
  block and `docs/FCI_TARGETED_RAG_ANALYSIS.md`'s statement that the KB
  schema "must not be generalized... without a catalog/ACL design step."
- No generic archive/filesystem-catalog table or script existed anywhere
  in the repository before this task (confirmed by exhaustive search).

**Decision**: a new, fully independent set of tables
(`knowledge_base.archive_source_roots`, `archive_scan_runs`,
`archive_files`), not an extension of the CDC tables. See §5.

## 5. Postgres strategy

Migration: `scripts/sql/20260828_archive_cartography.sql`, purely additive
(`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` only, no
`DROP`/`ALTER`/`TRUNCATE`). Applied to the local database this session;
verified before and after that every existing `knowledge_base` table's row
count was unchanged (all still 0) and no existing column/constraint was
touched.

Three new tables:

- **`archive_source_roots`**: one row per scanned root directory. Stores
  the raw absolute path internally (`root_path`, UNIQUE) plus an optional
  human `label`. Everything else references this by `id`, not by
  re-embedding the raw path (Step 5).
- **`archive_scan_runs`**: one row per scan invocation. Tallies
  (`files_seen/new/unchanged/changed/failed`, `total_bytes`,
  `duplicate_files`), `status` (running/completed/failed), timestamps.
- **`archive_files`**: one row per filesystem file, `UNIQUE(source_root_id,
  relative_path)`. See §6 for the exact field list.

## 6. Catalog schema (filesystem facts only)

| Column | Purpose |
| --- | --- |
| `source_root_id` | FK, never a raw path on this row |
| `relative_path` | path under the root — the stable identity, together with `source_root_id` |
| `filename`, `extension`, `parent_folder` | derived, convenient for reporting |
| `size_bytes`, `modified_at` | filesystem stat facts |
| `sha256` | content hash, nullable until hashed, **not unique** (duplicates are expected and wanted) |
| `discovery_status` | `discovered` / `hashed` / `failed` |
| `processing_status` | single default `not_classified` today, no CHECK constraint yet — Phase 2 defines and constrains its own value set additively |
| `error_message` | populated only when `discovery_status = 'failed'` |
| `first_seen_at`, `last_seen_at`, `updated_at` | resumability/staleness bookkeeping |

No AI-derived or classification field exists anywhere in this migration —
no `document_type`, no `project`/`CDC`/`CV` label, no client/sector/country.
Those are explicitly Phase 2's responsibility, in a separate additive
migration.

## 7. Stable identity

**File identity** = `(source_root_id, relative_path)`, enforced by a real
`UNIQUE` constraint — not scan order, not array position. Two files with
the same basename in different folders (e.g. `dossier-a/notes.txt` and
`dossier-b/notes.txt`) get two distinct rows (tested).

**Content duplicate identity** = `sha256`, deliberately kept separate and
deliberately *not* unique: two files legitimately sharing one hash is
exactly what "duplicate" means. Duplicate groups are computed on demand
via `GROUP BY sha256 HAVING count(*) > 1` (`count_duplicate_files` /
`build_report`), never precomputed into a redundant stored column that
could drift out of sync.

## 8. SHA256 duplicates

Hashing is fully streaming (`sha256_file()`, 1 MiB chunks, matching the
existing `service.py` convention) — a multi-gigabyte file is never loaded
into memory at once (tested with a >2 MiB file forcing three read
iterations). `duplicate_files` counts **every** file that belongs to a
hash group with more than one member (i.e. all copies, not just the
"extra" ones beyond the first) — this definition is stated explicitly in
code and here to avoid ambiguity later. No decision about which copy is
"authoritative" is made or stored anywhere in V1.

## 9. Resumability

Because every write is an `INSERT ... ON CONFLICT (source_root_id,
relative_path) DO UPDATE`, re-running the scanner against an unchanged
tree can never create a duplicate row — it updates `last_seen_at` and
reports the file as `unchanged` (tested, including verifying the row `id`
stays identical across two scans). Changed content on an already-known
path updates the same row in place and increments `files_changed`
(tested). If a run is interrupted, files already processed keep their
correct state; re-running simply continues upserting — there is no
partial/duplicate state possible given the constraint-backed identity.

## 10. Scan-run audit

Every invocation gets an `archive_scan_runs` row: `status`, `started_at`/
`completed_at`, and the tallies listed in §5. A fatal, non-per-file error
(e.g. the root itself becomes unreadable mid-scan) marks the run `failed`
with `error_message` set — this is distinct from a per-file failure, which
never aborts the batch (see §12). No secret or credential is ever stored
in a scan-run row.

## 11. Reporting

`build_report()` computes, on demand from `archive_files` (never from a
duplicated/cached summary): `total_files`, `total_bytes`, `unique_hashes`,
`duplicate_files`, `failed_files`, `files_by_extension`, and
`top_level_folder_counts` (first path segment under the root). No AI
classification counts exist yet — that is explicitly Phase 2's addition,
layered onto `processing_status` once its value set is defined.

## 12. Per-file failure isolation

`os.walk(..., onerror=...)` catches directory-level errors (e.g.
permission denied on one subfolder) without aborting the walk. Each
file's `stat()` and hash read are wrapped individually — a stat failure or
a read/permission failure on one file is caught, recorded
(`discovery_status='failed'`, `error_message` populated), and the scan
continues to the next file (tested: one `chmod 000`'d file among two does
not prevent the other from being cataloged correctly, and the failed row's
`size_bytes`/`modified_at` are preserved from a prior successful stat when
only the hash step fails).

## 13. Path safety

Raw absolute paths are never returned by any function's public output
(`build_report`, `finish_scan_run`, or the CLI summary) — only
`relative_path` plus the internal `source_root_id`. The one place the raw
`root_path` is stored at all is the small `archive_source_roots` lookup
table, matching the task's explicit preference (Step 5) over repeating the
absolute path on every one of tens of thousands of file rows.

## 14. Safety hardening

### 14.1 Confidential output protection  
All normal terminal output and report data now contains only aggregate statistics, such as:
- total_files
- total_bytes  
- unique_hashes
- duplicate_files
- failed_files
- files_by_extension (with only extension keys, no path details)
- top_level_folder_counts (hidden to prevent revelation of directory structure)

Individual file paths/filenames are not visible in regular CLI output or reports.

### 14.2 Root containment / symlink safety
The scanner now enforces:
- Directory symlinks pointing outside the root path are skipped safely 
- File symlinks pointing outside the root path are skipped safely
- Broken symlinks are detected and skipped without crashing the scan
- All filesystem traversal remains confined to the explicitly provided --source-root

## 15. Small-test status (this session)

No real archive path was read, listed, or referenced. A synthetic
directory was built in the local scratchpad (outside the repository, never
committed) covering every required case: a normal file, an exact-content
duplicate pair, two same-named files in different folders, a Unicode
filename (`résumé été - it's a test.pdf`), spaces and apostrophes, an
empty file, a `chmod 000`'d unreadable file, and a 4-level-deep nested
path. The CLI was run three times against it (initial scan, idempotent
rescan, `--report-only`), producing exactly the expected tallies each
time, and the source directory's mtimes/permissions/content were verified
unchanged before and after. All rows created by this manual CLI smoke test
were deleted afterward — the `archive_files`/`archive_scan_runs`/
`archive_source_roots` tables are back to 0 rows, matching the automated
test suite's own per-test cleanup.

## 15. n8n orchestration — deliberately not built in this task

Step 12 asked to "prepare an n8n workflow only if consistent with existing
project conventions" and explicitly allows keeping DB writes inside the
script for V1. The existing precedent (`concept-knowledge-base-batch-cdc-
ingestion.json`) wraps `list_pdfs.py` with an `executeCommand` node,
because that pipeline genuinely needs n8n's orchestration: per-file HTTP
calls to a separate ingestion service, `continueOnFail` tallying, and a
child-workflow call per document. Archive Cartography V1 has no such
multi-service fan-out — one Python process already does discovery, hashing,
and the Postgres upsert in a single pass. Building a speculative n8n
workflow around it now would add an untested artifact without a concrete
need. The chosen design keeps the door open cheaply: a future n8n
`executeCommand` node running
`.venv-archive-cartography/bin/python scan_archive.py --source-root
"$ARCHIVE_ROOT"` would wrap this script exactly as `Discover PDFs Safely`
wraps `list_pdfs.py` today — no code change required, only a workflow
definition, when that becomes useful (e.g. for scheduling or a UI trigger).

## 16. What Phase 2 will add

Document classification (CDC / PROJECT / OFFER / METHODOLOGY / CV / OTHER
/ UNKNOWN) into `archive_files.processing_status`, via its own additive
migration that defines and constrains that value set — deliberately left
open (no CHECK constraint) in this migration so Phase 2 does not need to
alter this one. Phase 2 will also decide the real archive root's env-var
name (none is recorded anywhere in this repository today — confirmed by
this task's own inspection; the closest precedent, `KB_SOURCE_DIR`, is
scoped to the existing CDC pilot and was deliberately not reused/repointed
at the full archive here) and how classification results feed into any
future ingestion decision — none of that is implemented or assumed by V1.

## 17. Explicit statement: the full ~80 GB archive has NOT been scanned

No environment variable pointing at the real archive was read, set, or
referenced beyond confirming (read-only) that none currently exists in
tracked config. No directory under the real archive was listed. Every
row ever inserted into the new tables during this session came from a
synthetic scratchpad directory and has since been deleted. `archive_files`,
`archive_scan_runs`, and `archive_source_roots` are all at 0 rows as of
the end of this task.

## 18. Tests

11 tests in `scripts/archive_cartography/test_scan_archive.py` (real local
Postgres, `unittest`, skipped automatically if `DATABASE_URL` is unset), all
passing: streaming SHA256 across multiple chunks, the well-known
empty-file hash, idempotent rescan with stable row identity, changed-file
detection updating the same row, duplicate detection with distinct file
identities, same-filename-different-folder separation, Unicode/space/
apostrophe filename handling, deep nested-folder traversal, one-file
failure isolation (skipped automatically when running as root, since
`chmod 000` would not actually block root's reads), no-source-modification,
and scan-run/report tally accuracy. A separate manual CLI run (§14)
additionally exercised the full `main()` entry point end to end, including
`--report-only`.
