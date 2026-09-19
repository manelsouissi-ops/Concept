#!/usr/bin/env python3
"""Historical CDC Discovery (Phase 3/4): metadata-driven candidate
detection over the already-inventoried archive, with a real (but
opt-in) local content-inspection stage.

PROJECT COUNT FACTS (manual filesystem verification, 2026-09)
- 433 physical top-level OFFRES project folders exist on disk.
- 411 of those contain at least one file (document-bearing).
-  22 of those are genuinely empty (zero files).
- Automatic, DB-derived project enumeration (enumerate_project_folders)
  correctly finds 411 - the document-bearing count - NOT 433. A folder
  with zero files is invisible to any file-row-based enumeration by
  definition, and has zero CDC candidates to discover regardless of
  whether it is "detected." 411/411 is the correct, validated result;
  433 is a real, historical, still-true fact about the physical
  filesystem that this script does not and should not try to reproduce.

SAFETY GUARANTEES
- No execution mode (no args) performs zero discovery: argparse's own
  required mutually-exclusive mode group rejects a bare invocation before
  any of this module's code runs.
- `--help` / `-h` performs zero discovery: argparse handles it and exits
  before main()'s body ever executes.
- Output is aggregate-only. No filename, relative path, project name, or
  hash is ever printed to stdout/stderr.
- CONFIRMED_CDC can only ever be produced by content-backed verification
  (see ContentInspector below). The metadata-only classifier can produce
  LIKELY_CDC / NEEDS_REVIEW / NOT_CDC and nothing else. By default this
  script uses NullContentInspector, which never verifies anything - so
  CONFIRMED_CDC is structurally unreachable unless a caller explicitly
  opts into real content inspection (--enable-content-inspection, which
  wires in LocalContentInspector from scripts/cdc_content_inspector.py -
  local PDF/DOCX/DOC extraction + local rule-based evidence analysis +
  an optional local-Ollama-only second stage; never cloud, never opened
  automatically).
- Reads the already-scanned Phase 1 inventory (knowledge_base.archive_files)
  rather than walking the filesystem directly. Content inspection (when
  explicitly enabled) only ever opens files metadata already flagged as
  LIKELY_CDC/NEEDS_REVIEW candidates - never NOT_CDC files, never files
  outside the selected pilot scope.

Usage:
    python3 scripts/cdc_discovery.py --help
    python3 scripts/cdc_discovery.py --pilot-limit 25 --dry-run
    python3 scripts/cdc_discovery.py --pilot-limit 25 --dry-run --enable-content-inspection
    python3 scripts/cdc_discovery.py --pilot-limit 25 --persist --idempotent-run
    python3 scripts/cdc_discovery.py --summary

Reads DATABASE_URL from the environment (same convention as
scripts/archive_cartography/scan_archive.py). Never logged.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional, Protocol, Sequence

# psycopg is imported lazily inside _connect() so that --help, argument
# validation, and every pure function in this module work (and are
# unit-testable) even when psycopg is not installed in the interpreter
# running this file.

# technical_source_classifier is pure stdlib (no Docling/psycopg-style
# heavy/optional dependency) - safe to import at module level, unlike the
# lazy cdc_content_inspector import in run_pilot_mode/run_full_corpus_mode.
from technical_source_classifier import (
    EXTRACTION_FAILURE_CATEGORIES,
    REVIEW_PRIORITIES,
    TECHNICAL_SOURCE_CLASSIFIER_VERSION,
    TECHNICAL_SOURCE_ROLES,
    categorize_extraction_failure_reason,
    classify_prefilter,
)

MIN_YEAR = 2009
MAX_YEAR = 2026

CDC_STATUSES: tuple[str, ...] = ("CONFIRMED_CDC", "LIKELY_CDC", "NEEDS_REVIEW", "NOT_CDC")

DOCUMENT_ROLES: tuple[str, ...] = (
    "CDC",
    "DAO",
    "TDR",
    "DCE",
    "RFP",
    "INVITATION",
    "ANNEX",
    "OTHER_TENDER_DOCUMENT",
    "UNKNOWN",
)

# Tender-related roles that are NOT automatically CDC (rule: "DAO/TDR/DCE
# must never automatically equal CDC").
TENDER_RELATED_NON_CDC_ROLES: tuple[str, ...] = (
    "DAO",
    "TDR",
    "DCE",
    "RFP",
    "INVITATION",
    "ANNEX",
    "OTHER_TENDER_DOCUMENT",
)

DETECTION_METHOD_METADATA = "METADATA_PATTERN_V1"

DEFAULT_CONFIDENCE_BY_STATUS = {
    "LIKELY_CDC": 0.60,
    "NEEDS_REVIEW": 0.30,
    "NOT_CDC": 0.05,
    # CONFIRMED_CDC is never assigned by metadata-only code; a real content
    # inspector would supply its own confidence when it verifies a file.
}

# Role-detection patterns, in priority order. Filename-only; never inspects
# document content.
_ROLE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("CDC", r"cdc|cahier[\s._-]*des[\s._-]*charges"),
    ("DAO", r"\bdao\b|document.*appel.*offre"),
    ("DCE", r"\bdce\b"),
    ("RFP", r"\brfp\b|request.*for.*proposal"),
    ("INVITATION", r"invit(ation)?[\s._-]*offre"),
    ("ANNEX", r"annexe?\b"),
    ("TDR", r"\btdr\b"),
)

_TENDER_KEYWORD_PATTERN = re.compile(r"tender|offre", re.IGNORECASE)

# Broad "this filename could plausibly be tender-related" signal, used only
# to decide LIKELY_CDC vs NEEDS_REVIEW vs NOT_CDC - never CONFIRMED_CDC.
_CANDIDATE_FILENAME_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"cdc",
        r"cahier[\s._-]*des[\s._-]*charges",
        r"dao",
        r"dce",
        r"reference[\s._-]*demande",
        r"demande[\s._-]*ouverture",
        r"rfo",
        r"doc[\s._-]*offre",
        r"offre[\s._-]*technique",
    )
)

_PROJECT_REFERENCE_PATTERN = re.compile(r"^(?:CC|CI|CD|CT|DC)[0-9]+", re.IGNORECASE)
_YEAR_PATTERN = re.compile(r"\b(19|20)\d{2}\b")


# =====================================================================
# Pure metadata classification (no I/O, no DB, no filesystem)
# =====================================================================


def extract_year_from_path(relative_path: str) -> Optional[int]:
    """Extracts a year in [MIN_YEAR, MAX_YEAR] from a relative path string."""
    for match in _YEAR_PATTERN.finditer(relative_path):
        year = int(match.group(0))
        if MIN_YEAR <= year <= MAX_YEAR:
            return year
    return None


def extract_project_reference_from_path(relative_path: str) -> Optional[str]:
    """Extracts a project reference token (e.g. CC2200-shaped) from path
    segments, checked from the deepest segment outward."""
    parts = [p for p in relative_path.split("/") if p.strip()]
    for part in reversed(parts):
        match = _PROJECT_REFERENCE_PATTERN.search(part)
        if match:
            return match.group(0).upper()
    return None


def matches_candidate_pattern(filename: str) -> bool:
    """Broad filename signal only - never decides CONFIRMED_CDC by itself."""
    return any(pattern.search(filename) for pattern in _CANDIDATE_FILENAME_PATTERNS)


def detect_document_role(filename: str) -> str:
    """Filename-only role detection. CDC here means "the filename looks
    like a cahier des charges" - it is a role label, not a confirmation."""
    name_lower = filename.lower()
    for role, pattern in _ROLE_PATTERNS:
        if re.search(pattern, name_lower):
            return role
    if _TENDER_KEYWORD_PATTERN.search(name_lower):
        return "OTHER_TENDER_DOCUMENT"
    return "UNKNOWN"


@dataclass(frozen=True)
class MetadataClassification:
    year: Optional[int]
    project_reference: Optional[str]
    document_role: str
    is_pattern_candidate: bool
    # One of LIKELY_CDC / NEEDS_REVIEW / NOT_CDC. NEVER CONFIRMED_CDC - see
    # classify_metadata()'s assertion below.
    metadata_status: str


def classify_metadata(relative_path: str, filename: str) -> MetadataClassification:
    """Metadata/path/filename-only classification. By construction this can
    never return CONFIRMED_CDC - see the assertion at the end, which makes
    that a hard invariant rather than a convention someone could quietly
    break in a future edit."""
    role = detect_document_role(filename)
    is_candidate = matches_candidate_pattern(filename)

    if role == "CDC":
        # Filename looks like a cahier des charges - a strong metadata
        # signal, but still only a metadata signal.
        status = "LIKELY_CDC"
    elif role in TENDER_RELATED_NON_CDC_ROLES:
        # Clearly tender-related, but role != CDC: must not be treated as
        # CDC just because it is in the same family of documents.
        status = "NEEDS_REVIEW"
    elif is_candidate:
        status = "NEEDS_REVIEW"
    else:
        status = "NOT_CDC"

    assert status != "CONFIRMED_CDC", "metadata-only classification must never produce CONFIRMED_CDC"

    return MetadataClassification(
        year=extract_year_from_path(relative_path),
        project_reference=extract_project_reference_from_path(relative_path),
        document_role=role,
        is_pattern_candidate=is_candidate,
        metadata_status=status,
    )


# =====================================================================
# Content-inspection abstraction (Step 10) - interface only in this phase
# =====================================================================


@dataclass(frozen=True)
class ContentInspectionOutcome:
    attempted: bool
    # Which extraction path actually ran, e.g. "pdf_text"/"docx_text"/
    # "doc_text" - None when extraction never started (unsupported format,
    # no file path, etc.).
    extraction_method: Optional[str] = None
    verified_as_cdc: bool = False
    verified_not_cdc: bool = False
    # Role hint derived from CONTENT (as opposed to metadata.document_role,
    # which comes from the filename). May differ from the metadata role.
    document_role: Optional[str] = None
    confidence: Optional[float] = None
    # SHORT reason/evidence CODE only (e.g. "content_confirmed_cdc_role_and_signals").
    # Never raw extracted text - see the migration's explicit "no full
    # document text" rule and scripts/cdc_content_inspector.py's docstring.
    reason_code: Optional[str] = None
    # True when extraction/inspection itself errored (timeout, unreadable
    # file, malformed AI response, etc.) - distinct from "attempted but
    # inconclusive".
    failed: bool = False
    needs_human_review: bool = False
    # Second-pass, human-style structural evidence (--validate-single-confirmed,
    # scripts/cdc_content_inspector.py's build_structural_cdc_evidence) -
    # only ever populated when verified_as_cdc is True. A flat dict of
    # short YES/NO/UNKNOWN strings only - never raw text, never a
    # filename/path. Kept as an untyped dict (not a dataclass imported
    # from cdc_content_inspector) specifically so this module never needs
    # a module-level import from that one, preserving the existing lazy-
    # import boundary (see run_pilot_mode).
    structural_validation: Optional[dict] = None
    # Full-corpus technical-source-document taxonomy (scripts/
    # technical_source_classifier.py's classify_technical_source) -
    # computed for EVERY successfully-extracted document (unlike
    # structural_validation above, this is not gated on verified_as_cdc:
    # the whole point of this taxonomy is to stop treating "CDC or not
    # CDC" as the only outcome). A flat dict of short role/score/flag
    # values only - never raw text, never a filename/path. Same untyped-
    # dict convention as structural_validation, for the same reason.
    technical_source_classification: Optional[dict] = None


@dataclass
class DiscoveryCounters:
    project_folders_selected: int = 0
    files_metadata_inspected: int = 0
    # Increments only when usable content was actually extracted AND
    # analyzed (i.e. a successful extraction) - NOT merely "attempted".
    files_content_inspected: int = 0

    pdf_extraction_calls: int = 0
    # Invariant: pdf_extraction_calls == pdf_extraction_successes + pdf_extraction_failures.
    pdf_extraction_successes: int = 0
    pdf_extraction_failures: int = 0

    docx_extraction_calls: int = 0

    doc_extraction_calls: int = 0
    # Invariant: doc_extraction_calls == doc_extraction_successes + doc_extraction_failures.
    # DOC is now REAL and supported (LibreOffice headless -> DOCX ->
    # existing DOCX text extraction) - see extract_doc_text. There is no
    # more "doc_unsupported" bucket; individual failure reasons are
    # tracked below, the same way PDF's are.
    doc_extraction_successes: int = 0
    doc_extraction_failures: int = 0

    ocr_calls: int = 0
    local_ai_calls: int = 0
    failed_extractions: int = 0
    # Must remain 0 in this phase. See assert_no_external_calls().
    external_calls: int = 0

    # Granular PDF failure reason breakdown - aggregate counts only, never
    # a filename/path. Each failed PDF extraction increments exactly one
    # of these (see scripts/cdc_content_inspector.py's
    # _PDF_FAILURE_REASON_COUNTERS).
    pdf_path_missing: int = 0
    docling_python_missing: int = 0
    docling_process_failed: int = 0
    docling_timeout: int = 0
    docling_output_missing: int = 0
    docling_output_empty: int = 0

    # Granular DOC (LibreOffice) failure reason breakdown - same pattern
    # as PDF's, see scripts/cdc_content_inspector.py's
    # _DOC_FAILURE_REASON_COUNTERS.
    doc_path_missing: int = 0
    libreoffice_missing: int = 0
    libreoffice_process_failed: int = 0
    libreoffice_timeout: int = 0
    libreoffice_output_missing: int = 0
    libreoffice_output_empty: int = 0

    # Aggregate classification reason counters (Task 5): WHY a
    # successfully-read document ended up with the role/status it did.
    # Content-derived role (from analyze_document_evidence), independent
    # of the metadata-only role:
    content_role_cdc: int = 0
    content_role_dao: int = 0
    content_role_tdr: int = 0
    content_role_dce: int = 0
    content_role_rfp: int = 0
    content_role_unknown: int = 0

    # Final content-verification outcome reason (mutually exclusive per
    # successfully-analyzed file):
    content_confirmed_cdc: int = 0
    content_insufficient_signals: int = 0
    content_ambiguous: int = 0
    content_not_cdc: int = 0
    content_extraction_failed: int = 0

    # Evidence-strength bands (derived from analyze_document_evidence's
    # signal_count, independent of the final AI-adjusted outcome):
    evidence_strong: int = 0
    evidence_medium: int = 0
    evidence_weak: int = 0

    duplicate_groups: int = 0
    duplicate_files: int = 0

    confirmed_cdc: int = 0
    likely_cdc: int = 0
    needs_review: int = 0
    not_cdc: int = 0

    rows_inserted: int = 0
    rows_updated: int = 0
    batches_failed: int = 0

    def tally_status(self, status: str) -> None:
        if status == "CONFIRMED_CDC":
            self.confirmed_cdc += 1
        elif status == "LIKELY_CDC":
            self.likely_cdc += 1
        elif status == "NEEDS_REVIEW":
            self.needs_review += 1
        elif status == "NOT_CDC":
            self.not_cdc += 1
        else:
            raise ValueError(f"Unknown cdc_status: {status!r}")

    def assert_no_external_calls(self) -> None:
        if self.external_calls != 0:
            raise RuntimeError(
                "external_calls must remain 0 in this phase - no cloud/external "
                "service is permitted by this script."
            )

    def as_dict(self) -> dict:
        return {
            "project_folders_selected": self.project_folders_selected,
            "files_metadata_inspected": self.files_metadata_inspected,
            "files_content_inspected": self.files_content_inspected,
            "pdf_extraction_calls": self.pdf_extraction_calls,
            "pdf_extraction_successes": self.pdf_extraction_successes,
            "pdf_extraction_failures": self.pdf_extraction_failures,
            "docx_extraction_calls": self.docx_extraction_calls,
            "doc_extraction_calls": self.doc_extraction_calls,
            "doc_extraction_successes": self.doc_extraction_successes,
            "doc_extraction_failures": self.doc_extraction_failures,
            "ocr_calls": self.ocr_calls,
            "local_ai_calls": self.local_ai_calls,
            "failed_extractions": self.failed_extractions,
            "external_calls": self.external_calls,
            "pdf_path_missing": self.pdf_path_missing,
            "docling_python_missing": self.docling_python_missing,
            "docling_process_failed": self.docling_process_failed,
            "docling_timeout": self.docling_timeout,
            "docling_output_missing": self.docling_output_missing,
            "docling_output_empty": self.docling_output_empty,
            "doc_path_missing": self.doc_path_missing,
            "libreoffice_missing": self.libreoffice_missing,
            "libreoffice_process_failed": self.libreoffice_process_failed,
            "libreoffice_timeout": self.libreoffice_timeout,
            "libreoffice_output_missing": self.libreoffice_output_missing,
            "libreoffice_output_empty": self.libreoffice_output_empty,
            "content_role_cdc": self.content_role_cdc,
            "content_role_dao": self.content_role_dao,
            "content_role_tdr": self.content_role_tdr,
            "content_role_dce": self.content_role_dce,
            "content_role_rfp": self.content_role_rfp,
            "content_role_unknown": self.content_role_unknown,
            "content_confirmed_cdc": self.content_confirmed_cdc,
            "content_insufficient_signals": self.content_insufficient_signals,
            "content_ambiguous": self.content_ambiguous,
            "content_not_cdc": self.content_not_cdc,
            "content_extraction_failed": self.content_extraction_failed,
            "evidence_strong": self.evidence_strong,
            "evidence_medium": self.evidence_medium,
            "evidence_weak": self.evidence_weak,
            "duplicate_groups": self.duplicate_groups,
            "duplicate_files": self.duplicate_files,
            "CONFIRMED_CDC": self.confirmed_cdc,
            "LIKELY_CDC": self.likely_cdc,
            "NEEDS_REVIEW": self.needs_review,
            "NOT_CDC": self.not_cdc,
            "rows_inserted": self.rows_inserted,
            "rows_updated": self.rows_updated,
            "batches_failed": self.batches_failed,
        }


class ContentInspector(Protocol):
    """Interface for a local (never cloud) content inspector. The real
    implementation is LocalContentInspector in scripts/cdc_content_inspector.py
    (local PDF/DOCX/DOC extraction, local rule-based evidence analysis, and
    an optional local-Ollama-only second stage). NullContentInspector below
    is the default/fallback and the only inspector this module wires up on
    its own - a caller must explicitly opt in to real content inspection
    (see run_pilot_discovery's content_inspector parameter and
    --enable-content-inspection)."""

    def inspect(
        self,
        archive_file_id: int,
        extension: Optional[str],
        counters: DiscoveryCounters,
        file_path: Optional[Path] = None,
    ) -> ContentInspectionOutcome:
        ...


class NullContentInspector:
    """The default ContentInspector. Performs zero extraction, zero OCR,
    zero AI calls, zero external calls, and never opens a file. This is
    what makes CONFIRMED_CDC structurally unreachable unless a caller
    explicitly opts into a real inspector: finalize_cdc_status() only ever
    returns CONFIRMED_CDC when outcome.verified_as_cdc is True, and this
    class never sets it to True."""

    def inspect(
        self,
        archive_file_id: int,
        extension: Optional[str],
        counters: DiscoveryCounters,
        file_path: Optional[Path] = None,
    ) -> ContentInspectionOutcome:
        return ContentInspectionOutcome(attempted=False, verified_as_cdc=False, verified_not_cdc=False)


def finalize_cdc_status(metadata_status: str, content_outcome: ContentInspectionOutcome) -> str:
    """The single place cdc_status is ever decided. CONFIRMED_CDC requires
    content_outcome.verified_as_cdc - i.e. an actual content inspection
    result - never metadata alone. If no content inspection occurred
    (content_outcome.attempted is False, always true with
    NullContentInspector), the metadata status passes through unchanged."""
    if content_outcome.verified_as_cdc:
        return "CONFIRMED_CDC"
    if content_outcome.attempted and content_outcome.verified_not_cdc:
        return "NOT_CDC"
    return metadata_status


def default_confidence_for_status(status: str) -> float:
    if status == "CONFIRMED_CDC":
        # Only reachable once a real content inspector supplies its own
        # confidence; this default is a conservative floor, never used by
        # NullContentInspector.
        return 0.90
    return DEFAULT_CONFIDENCE_BY_STATUS[status]


# =====================================================================
# Pilot project-folder selection (Step 4 / Fix 1+2) - pure, deterministic
# =====================================================================


@dataclass(frozen=True)
class ArchiveFileRow:
    id: int
    relative_path: str
    filename: str
    extension: Optional[str]
    sha256: Optional[str]
    # The label (or root_path) of this file's knowledge_base.archive_source_roots
    # row. Needed because the real archive was scanned as MULTIPLE per-year
    # source roots (see _fetch_archive_file_rows) - relative_path alone does
    # not always carry the OFFRES year, so the source root's own label is
    # the fallback signal for it. See derive_project_folder_key.
    source_root_label: Optional[str] = None
    # Absolute filesystem root this file's relative_path is relative to.
    # None for every metadata-only fetch (_fetch_archive_file_rows) - only
    # populated when content inspection is explicitly requested
    # (_fetch_archive_file_rows_with_root_path /
    # --enable-content-inspection), since it is the one field in this
    # dataclass that could resolve to a real absolute path. Never printed;
    # only ever used internally to open a file for local extraction. See
    # resolve_file_path() in scripts/cdc_content_inspector.py.
    source_root_path: Optional[str] = None


_OFFRES_YEAR_SEGMENT_PATTERN = re.compile(r"^OFFRES[\s._-]+((?:19|20)\d{2})$", re.IGNORECASE)


def extract_offres_year_segment(text: Optional[str]) -> Optional[str]:
    """Normalizes a single path segment or source-root label to a canonical
    "OFFRES <year>" string if (and only if) it looks like one. Returns None
    for anything else - this is what keeps CDC discovery scoped to OFFRES
    2009-2026 and out of the rest of the 80 GB archive (Fix 3): a folder
    that isn't recognizably an OFFRES year folder can never seed a project
    key, so no file under it can ever be selected."""
    if not text:
        return None
    match = _OFFRES_YEAR_SEGMENT_PATTERN.match(text.strip().split("/")[-1])
    if not match:
        return None
    year = int(match.group(1))
    if not (MIN_YEAR <= year <= MAX_YEAR):
        return None
    return f"OFFRES {year}"


def _project_after_year(parts: List[str], year_index: int, year_segment: str) -> Optional[str]:
    """Returns "<year_segment>/<project>", where <project> is exactly the
    segment immediately after `year_index` - with NO special-casing when
    that segment's text happens to also look like "OFFRES <year>".

    An earlier version of this function skipped a segment here if it
    matched the OFFRES-year pattern, on the theory that a duplicated
    "OFFRES <year>/OFFRES <year>/..." wrapper meant the real project(s)
    started one level deeper. Manually verified per-year project counts
    (2026-09) DISPROVE that theory: the one real year where this pattern
    occurs has a verified count of exactly 1 project - matching the
    segment-immediately-after-year value directly, with no skip. Skipping
    would have inflated that year's count instead of fixing it. The
    segment simply IS the project name for that year, even though its text
    happens to resemble a year folder.

    Still requires at least one more segment after the project (the
    filename) - "OFFRES 2009/loose-file.pdf" (a file sitting directly in
    the year folder, nothing beneath a would-be project) is excluded
    rather than miscounted as its own pseudo-project."""
    project_index = year_index + 1
    if project_index + 1 >= len(parts):
        return None
    return f"{year_segment}/{parts[project_index]}"


def derive_project_folder_key(relative_path: str, source_root_label: Optional[str] = None) -> Optional[str]:
    """A "project folder" is exactly OFFRES <year> / <immediate child
    directory> - never the year folder itself, never a deeper subfolder,
    never a bare file (Fix 1).

    Three real storage conventions are supported, tried in this order,
    because relative_path alone does not reveal which one applies to a
    given row:

    A. Year is relative_path's own leading segment, e.g.
       "OFFRES 2009/PROJECT 1/Dossier Client/file.pdf" (a single source
       root covering the whole archive with no extra wrapper directory).

    C. Year is relative_path's SECOND segment, with exactly one constant
       prefix segment before it, e.g.
       "<archive-root-name>/OFFRES 2009/PROJECT 1/Dossier Client/file.pdf".
       This is the convention CONFIRMED against the real database
       (2026-09 diagnosis: source_root_id 24, all 40,853 real files carry
       the OFFRES-year token at path segment 2, none at segment 1; the
       single distinct segment-1 value is a constant wrapper directory).

    B. relative_path is relative to a PER-YEAR source root, e.g.
       "PROJECT 1/Dossier Client/file.pdf", with the year only present in
       that source root's own label (e.g. "OFFRES 2009"). Here parts[0] IS
       the project, and the year comes from source_root_label. (Kept for
       robustness/back-compat; not what the real archive currently uses.)

    A path/root that matches none of these is out of scope entirely and
    returns None - it is never counted as a project and never contributes
    to files_metadata_inspected (Fix 3)."""
    parts = [p for p in relative_path.split("/") if p.strip()]
    if not parts:
        return None

    year_at_0 = extract_offres_year_segment(parts[0])
    if year_at_0 is not None:
        return _project_after_year(parts, year_index=0, year_segment=year_at_0)

    if len(parts) >= 2:
        year_at_1 = extract_offres_year_segment(parts[1])
        if year_at_1 is not None:
            return _project_after_year(parts, year_index=1, year_segment=year_at_1)

    root_year = extract_offres_year_segment(source_root_label)
    if root_year is not None:
        if len(parts) < 2:
            return None  # a loose file directly under a per-year source root - not a project
        return f"{root_year}/{parts[0]}"

    return None


def enumerate_project_folders(rows: Sequence[ArchiveFileRow]) -> List[str]:
    """Enumerates every distinct top-level OFFRES project folder present in
    `rows`, sorted for determinism. The 18 OFFRES year folders themselves
    are never counted - only their immediate child directories are (Fix 1).
    Files outside OFFRES 2009-2026 are never counted (Fix 3)."""
    keys = {derive_project_folder_key(row.relative_path, row.source_root_label) for row in rows}
    keys.discard(None)
    return sorted(keys)  # type: ignore[arg-type]


def select_pilot_project_folders(rows: Sequence[ArchiveFileRow], limit: int) -> List[str]:
    """Deterministic, reproducible selection of exactly `limit` project
    folders (or fewer, if fewer than `limit` exist) from
    enumerate_project_folders(). Same input always yields the same output,
    in the same order, across reruns."""
    if limit <= 0:
        return []
    return enumerate_project_folders(rows)[:limit]


# =====================================================================
# Duplicate handling (reuses Phase 1's already-computed sha256 - never
# re-hashes, never re-opens a file)
# =====================================================================


@dataclass(frozen=True)
class DuplicateAssignment:
    is_primary_candidate: bool
    duplicate_of_archive_file_id: Optional[int]


def assign_duplicate_relationships(rows: Sequence[ArchiveFileRow]) -> dict:
    """Groups rows by sha256 (ignoring None - a NULL hash is never treated
    as a duplicate, matching the Phase 1/Phase 2 convention). Within a
    group, the row with the lowest archive_file_id is primary; every other
    member points at it via duplicate_of_archive_file_id. Returns a mapping
    of archive_file_id -> DuplicateAssignment, plus does NOT compute
    counters itself (callers tally duplicate_groups/duplicate_files)."""
    groups: dict[str, list[ArchiveFileRow]] = {}
    for row in rows:
        if row.sha256 is None:
            continue
        groups.setdefault(row.sha256, []).append(row)

    assignments: dict[int, DuplicateAssignment] = {}
    for row in rows:
        assignments[row.id] = DuplicateAssignment(is_primary_candidate=True, duplicate_of_archive_file_id=None)

    for group_rows in groups.values():
        if len(group_rows) < 2:
            continue
        ordered = sorted(group_rows, key=lambda r: r.id)
        primary = ordered[0]
        for row in ordered[1:]:
            assignments[row.id] = DuplicateAssignment(
                is_primary_candidate=False, duplicate_of_archive_file_id=primary.id
            )

    return assignments


def count_duplicate_groups_and_files(rows: Sequence[ArchiveFileRow]) -> tuple[int, int]:
    groups: dict[str, int] = {}
    for row in rows:
        if row.sha256 is None:
            continue
        groups[row.sha256] = groups.get(row.sha256, 0) + 1
    duplicate_groups = sum(1 for count in groups.values() if count > 1)
    duplicate_files = sum(count - 1 for count in groups.values() if count > 1)
    return duplicate_groups, duplicate_files


# =====================================================================
# Candidate model + persistence (idempotent upsert, Step 11)
# =====================================================================


@dataclass(frozen=True)
class CdcCandidate:
    archive_file_id: int
    year: Optional[int]
    project_reference: Optional[str]
    document_role: str
    cdc_status: str
    confidence: float
    detection_method: str
    reason: str  # short evidence label only - never raw document text
    duplicate_of_archive_file_id: Optional[int]
    is_primary_candidate: bool
    needs_human_review: bool
    # In-memory-only, NEVER persisted (PostgresCandidateRepository.upsert()
    # explicitly names every column it writes - this field is deliberately
    # absent from that list, and always will be). Only ever populated for
    # CONFIRMED_CDC candidates - see ContentInspectionOutcome.structural_validation
    # and --validate-single-confirmed.
    structural_validation: Optional[dict] = None

    def __post_init__(self) -> None:
        if self.cdc_status not in CDC_STATUSES:
            raise ValueError(f"Invalid cdc_status: {self.cdc_status!r}")
        if self.document_role not in DOCUMENT_ROLES:
            raise ValueError(f"Invalid document_role: {self.document_role!r}")
        if not (0.0 <= self.confidence <= 1.0):
            raise ValueError(f"confidence must be between 0.00 and 1.00, got {self.confidence!r}")
        if self.cdc_status == "CONFIRMED_CDC" and self.detection_method == DETECTION_METHOD_METADATA:
            raise ValueError("CONFIRMED_CDC must never be produced by metadata-only detection")


def build_candidate(
    row: ArchiveFileRow,
    metadata: MetadataClassification,
    content_outcome: ContentInspectionOutcome,
    duplicate: DuplicateAssignment,
) -> CdcCandidate:
    final_status = finalize_cdc_status(metadata.metadata_status, content_outcome)
    confidence = content_outcome.confidence if content_outcome.verified_as_cdc and content_outcome.confidence is not None else default_confidence_for_status(final_status)
    reason = content_outcome.reason_code if content_outcome.attempted and content_outcome.reason_code else f"role={metadata.document_role}"
    detection_method = "LOCAL_CONTENT_V1" if content_outcome.attempted else DETECTION_METHOD_METADATA
    # Content-derived role is more authoritative than the filename-only
    # metadata role when available (Step 4: document_role and cdc_status
    # are tracked separately - content can refine role without implying
    # CONFIRMED_CDC).
    final_document_role = (
        content_outcome.document_role
        if content_outcome.attempted and content_outcome.document_role
        else metadata.document_role
    )

    return CdcCandidate(
        archive_file_id=row.id,
        year=metadata.year,
        project_reference=metadata.project_reference,
        document_role=final_document_role,
        cdc_status=final_status,
        confidence=confidence,
        detection_method=detection_method,
        reason=reason,
        duplicate_of_archive_file_id=duplicate.duplicate_of_archive_file_id,
        is_primary_candidate=duplicate.is_primary_candidate,
        needs_human_review=(
            content_outcome.needs_human_review
            if content_outcome.attempted
            else final_status in ("NEEDS_REVIEW", "LIKELY_CDC")
        ),
        structural_validation=content_outcome.structural_validation,
    )


class CandidateRepository(Protocol):
    """Persistence interface. PostgresCandidateRepository is the only real
    implementation; tests use a synthetic in-memory double (see
    scripts/cdc_discovery_test.py) so persistence and idempotency are
    provable without a live database."""

    def upsert(self, candidate: CdcCandidate) -> str:
        """Returns 'inserted' or 'updated'."""
        ...

    def begin_batch(self) -> None: ...

    def commit_batch(self) -> None: ...

    def rollback_batch(self) -> None: ...


class PostgresCandidateRepository:
    """Real persistence. Idempotent via the UNIQUE constraint on
    archive_file_id in knowledge_base.historical_cdc_candidates (see
    scripts/sql/create_historical_cdc_candidates_table.sql): rerunning the
    same archive_file_id updates the existing row in place instead of
    inserting a duplicate."""

    def __init__(self, conn) -> None:
        self._conn = conn

    def begin_batch(self) -> None:
        pass  # conn.transaction() context manager (used by the caller) owns the transaction boundary

    def commit_batch(self) -> None:
        pass

    def rollback_batch(self) -> None:
        pass

    def upsert(self, candidate: CdcCandidate) -> str:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                insert into knowledge_base.historical_cdc_candidates (
                    archive_file_id, year, project_reference, document_role,
                    cdc_status, confidence, detection_method, reason,
                    duplicate_of_archive_file_id, is_primary_candidate, needs_human_review
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (archive_file_id) do update set
                    year = excluded.year,
                    project_reference = excluded.project_reference,
                    document_role = excluded.document_role,
                    cdc_status = excluded.cdc_status,
                    confidence = excluded.confidence,
                    detection_method = excluded.detection_method,
                    reason = excluded.reason,
                    duplicate_of_archive_file_id = excluded.duplicate_of_archive_file_id,
                    is_primary_candidate = excluded.is_primary_candidate,
                    needs_human_review = excluded.needs_human_review,
                    updated_at = now()
                returning (xmax = 0) as inserted
                """,
                (
                    candidate.archive_file_id,
                    candidate.year,
                    candidate.project_reference,
                    candidate.document_role,
                    candidate.cdc_status,
                    candidate.confidence,
                    candidate.detection_method,
                    candidate.reason,
                    candidate.duplicate_of_archive_file_id,
                    candidate.is_primary_candidate,
                    candidate.needs_human_review,
                ),
            )
            row = cur.fetchone()
        return "inserted" if row[0] else "updated"


@dataclass
class PersistResult:
    inserted: int = 0
    updated: int = 0
    failed_batch: bool = False


def persist_candidates(repository: CandidateRepository, candidates: Sequence[CdcCandidate]) -> PersistResult:
    """All candidates in one batch, one transaction. Any failure rolls back
    the whole batch - no partial writes, nothing silently marked
    successful."""
    repository.begin_batch()
    result = PersistResult()
    try:
        for candidate in candidates:
            outcome = repository.upsert(candidate)
            if outcome == "inserted":
                result.inserted += 1
            elif outcome == "updated":
                result.updated += 1
            else:
                raise ValueError(f"Unexpected upsert outcome: {outcome!r}")
        repository.commit_batch()
        return result
    except Exception:
        repository.rollback_batch()
        return PersistResult(inserted=0, updated=0, failed_batch=True)


# =====================================================================
# Full-corpus technical-source discovery (Phase 5)
#
# A second, parallel discovery pipeline alongside the CDC-only one above -
# it does NOT replace run_pilot_discovery/CdcCandidate/DiscoveryCounters
# (still used unchanged by --pilot-limit), it reuses their proven pieces
# (enumerate_project_folders, derive_project_folder_key, resolve_archive_
# file_path, assign_duplicate_relationships, extract_year_from_path,
# extract_project_reference_from_path) for a taxonomy-aware pipeline that
# stops treating "CDC vs not CDC" as the only outcome (see
# scripts/technical_source_classifier.py for the taxonomy/scoring itself).
# =====================================================================

TECHNICAL_SOURCE_EXTRACTION_STATUSES: tuple[str, ...] = ("NOT_ATTEMPTED", "SUCCESS", "FAILED")

# Task 5/6 (review workflow) - explicit MACHINE_* vs HUMAN_* prefixing is
# deliberate: "Machine classification must never be presented as human
# validation." MACHINE_CLASSIFIED is the only state a fresh discovery run
# ever sets (see PostgresTechnicalSourceCandidateRepository.upsert(),
# which never writes this column at all - a rerun of discovery can never
# move a row away from whatever human state it is already in). Every
# HUMAN_* state (plus NEEDS_HUMAN_REVIEW) can only be set by a human, via
# mark_validation_status() - see scripts/cdc_review.py.
TECHNICAL_SOURCE_VALIDATION_STATUSES: tuple[str, ...] = (
    "MACHINE_CLASSIFIED",
    "NEEDS_HUMAN_REVIEW",
    "HUMAN_VALIDATED_CDC",
    "HUMAN_VALIDATED_TDR",
    "HUMAN_VALIDATED_DAO_WITH_TDR",
    "HUMAN_VALIDATED_DAO_WITH_CDC",
    "HUMAN_REJECTED_CDC",
    # Added for the semantic-review (v3) project queue's human-review
    # workflow design - the v3 semantic taxonomy (scripts/semantic_review.py
    # SEMANTIC_ROLES) is wider than this table's original CDC/DAO-family-
    # only taxonomy. A human confirming a v3 proposal's role of plain DAO,
    # RFP, OFFER, or OTHER (or explicitly marking the document's role as
    # genuinely uncertain, distinct from NEEDS_HUMAN_REVIEW - which means
    # "not yet decided", not "decided that it's ambiguous") had no matching
    # value here before. The DB CHECK constraint was widened to match (see
    # scripts/sql/widen_historical_technical_source_candidates_validation_
    # status.sql - an additive, idempotent migration) and this was
    # live-verified against the real database on 2026-09-09. mark_validation_
    # status() still fails closed (DB CHECK violation) if one of these five
    # is used against a database where that migration has not been run.
    "HUMAN_VALIDATED_DAO",
    "HUMAN_VALIDATED_RFP",
    "HUMAN_VALIDATED_OFFER",
    "HUMAN_VALIDATED_OTHER",
    "HUMAN_UNCERTAIN",
)

# A human can set any of these via mark_validation_status(); MACHINE_CLASSIFIED
# is deliberately excluded - it is only ever the DB column's own DEFAULT,
# never something a caller re-asserts.
HUMAN_SETTABLE_VALIDATION_STATUSES: tuple[str, ...] = tuple(
    status for status in TECHNICAL_SOURCE_VALIDATION_STATUSES if status != "MACHINE_CLASSIFIED"
)

# Task 7 (review workflow): the authoritative mapping between a historical
# tender/project and its official CONCEPT internal code has NOT been
# established. project_reference (derived by extract_project_reference_from_path,
# a filename/path REGEX guess) must never be presented as if it were that
# authoritative code. Deliberately single-valued for now - there is no
# resolution mechanism yet; this constant exists so that gap is explicit
# and testable rather than silently assumed away.
PROJECT_MAPPING_STATUSES: tuple[str, ...] = ("UNRESOLVED",)

CLASSIFICATION_METHODS: tuple[str, ...] = ("PREFILTER_SKIPPED", "RULE", "RULE_AND_LOCAL_AI", "HUMAN")


@dataclass(frozen=True)
class TechnicalSourceCandidate:
    archive_file_id: int
    year: Optional[int]
    project_reference: Optional[str]
    detected_role: str
    technical_source_candidate: bool
    structural_score: int
    structural_max: int
    structural_ratio: float
    structural_band: str
    confidence: Optional[float]
    extraction_status: str
    review_priority: Optional[str]
    classification_method: str
    duplicate_of_archive_file_id: Optional[int]
    is_primary_candidate: bool
    # Which extraction path actually ran ("pdf_text"/"docx_text"/"doc_text") -
    # None whenever extraction_status != "SUCCESS". Review workflow Task 3
    # ("extraction method/result" aggregate breakdown).
    extraction_method: Optional[str] = None
    # Populated only when extraction_status == "FAILED" - see
    # scripts/technical_source_classifier.categorize_extraction_failure_reason.
    # Review workflow Task 6: the 117 EXTRACTION_FAILED candidates are never
    # discarded, and this is what lets a future investigation group them by
    # failure category without ever touching a raw reason_code/path.
    extraction_failure_category: Optional[str] = None
    # Review workflow Task 7: project_reference above is a filename/path
    # REGEX guess, never an authoritative CONCEPT project code - there is
    # no resolution mechanism yet, so this is always "UNRESOLVED" today.
    # Kept as an explicit field (not silently implied) so the gap cannot be
    # accidentally forgotten by a future caller.
    project_mapping_status: str = "UNRESOLVED"
    # scripts/technical_source_classifier.TECHNICAL_SOURCE_CLASSIFIER_VERSION
    # at the time THIS row was machine-classified - re-asserted on every
    # upsert (unlike validation_status) so a rules change is always
    # reflected accurately rather than left stale at whatever version
    # first inserted the row.
    classifier_version: str = TECHNICAL_SOURCE_CLASSIFIER_VERSION

    def __post_init__(self) -> None:
        if self.detected_role not in TECHNICAL_SOURCE_ROLES:
            raise ValueError(f"Unknown detected_role: {self.detected_role!r}")
        if self.extraction_status not in TECHNICAL_SOURCE_EXTRACTION_STATUSES:
            raise ValueError(f"Unknown extraction_status: {self.extraction_status!r}")
        if self.review_priority is not None and self.review_priority not in REVIEW_PRIORITIES:
            raise ValueError(f"Unknown review_priority: {self.review_priority!r}")
        if self.classification_method not in CLASSIFICATION_METHODS:
            raise ValueError(f"Unknown classification_method: {self.classification_method!r}")
        if self.extraction_failure_category is not None and self.extraction_failure_category not in EXTRACTION_FAILURE_CATEGORIES:
            raise ValueError(f"Unknown extraction_failure_category: {self.extraction_failure_category!r}")
        if self.project_mapping_status not in PROJECT_MAPPING_STATUSES:
            raise ValueError(f"Unknown project_mapping_status: {self.project_mapping_status!r}")


def build_technical_source_candidate(
    row: ArchiveFileRow,
    content_outcome: ContentInspectionOutcome,
    duplicate: DuplicateAssignment,
) -> TechnicalSourceCandidate:
    """Assembles a TechnicalSourceCandidate purely from already-computed
    inputs - never invents a role/score itself. Mirrors build_candidate()'s
    shape/spirit for the taxonomy-aware pipeline. Task 16: a document whose
    metadata looked relevant but whose content could not be extracted
    fails closed to extraction_status=FAILED, review_priority=
    EXTRACTION_FAILED - it never blocks the rest of the corpus run."""
    year = extract_year_from_path(row.relative_path)
    project_reference = extract_project_reference_from_path(row.relative_path)
    common = dict(
        archive_file_id=row.id, year=year, project_reference=project_reference,
        duplicate_of_archive_file_id=duplicate.duplicate_of_archive_file_id,
        is_primary_candidate=duplicate.is_primary_candidate,
        # No authoritative CONCEPT project-code mapping mechanism exists yet
        # (review workflow Task 7) - always UNRESOLVED, never inferred.
        project_mapping_status="UNRESOLVED",
    )

    if not content_outcome.attempted:
        return TechnicalSourceCandidate(
            detected_role="UNKNOWN", technical_source_candidate=False,
            structural_score=0, structural_max=0, structural_ratio=0.0,
            structural_band="WEAK_TECHNICAL_SOURCE", confidence=None,
            extraction_status="NOT_ATTEMPTED", review_priority=None,
            classification_method="PREFILTER_SKIPPED", **common,
        )

    classification = content_outcome.technical_source_classification
    if classification is None:
        # attempted=True but extraction itself failed, or the format is
        # unsupported - never guessed at, always EXTRACTION_FAILED. The
        # 117-candidate real-run bucket this represents is never discarded
        # (Task 6) - it is categorized here so a future investigation can
        # group failures without ever touching a raw reason_code/path.
        return TechnicalSourceCandidate(
            detected_role="UNKNOWN", technical_source_candidate=False,
            structural_score=0, structural_max=0, structural_ratio=0.0,
            structural_band="WEAK_TECHNICAL_SOURCE", confidence=None,
            extraction_status="FAILED", review_priority="EXTRACTION_FAILED",
            classification_method="RULE",
            extraction_failure_category=categorize_extraction_failure_reason(content_outcome.reason_code),
            **common,
        )

    return TechnicalSourceCandidate(
        detected_role=classification["detected_role"],
        technical_source_candidate=classification["technical_source_candidate"],
        structural_score=classification["structural_score"],
        structural_max=classification["structural_max"],
        structural_ratio=classification["structural_ratio"],
        structural_band=classification["structural_band"],
        confidence=content_outcome.confidence,
        extraction_status="SUCCESS",
        review_priority=classification["review_priority"],
        classification_method="RULE",
        extraction_method=content_outcome.extraction_method,
        **common,
    )


@dataclass
class FullCorpusCounters:
    # Extraction bookkeeping is delegated to (not duplicated from) the
    # existing DiscoveryCounters - it is what ContentInspector.inspect()'s
    # interface already requires as its `counters` argument, and
    # duplicating ~20 pdf_*/doc_*/ocr_*/local_ai_* fields here would be
    # pure repetition of scripts/cdc_content_inspector.py's tallying.
    extraction: DiscoveryCounters = field(default_factory=DiscoveryCounters)

    project_folders_selected: int = 0
    files_metadata_inspected: int = 0
    prefilter_candidates: int = 0

    # DOCX has no success/failure split in DiscoveryCounters (DOCX
    # failures fold into its generic failed_extractions bucket) - Task 13
    # asks for it explicitly for this report, so it is derived here from
    # each ContentInspectionOutcome instead of touching the shared,
    # already-tested low-level counter class.
    docx_extraction_successes: int = 0
    docx_extraction_failures: int = 0

    role_cdc: int = 0
    role_tdr: int = 0
    role_dao_with_tdr: int = 0
    role_dao_with_cdc: int = 0
    role_dao: int = 0
    role_dce: int = 0
    role_rfp: int = 0
    role_offer: int = 0
    role_report: int = 0
    role_methodology: int = 0
    role_other: int = 0
    role_unknown: int = 0

    strong_technical_source: int = 0
    possible_technical_source: int = 0
    weak_technical_source: int = 0

    high_priority: int = 0
    medium_priority: int = 0
    extraction_failed_priority: int = 0

    duplicate_groups: int = 0
    duplicate_files: int = 0
    # Task 9 (review workflow) performance: a prefilter candidate whose
    # sha256 was already Stage-B-inspected earlier in this same run reuses
    # that outcome instead of re-extracting/re-classifying identical bytes
    # (see run_technical_source_discovery_for_projects). Never a
    # correctness compromise - same content hash guarantees same extracted
    # text guarantees same classification, deterministically.
    duplicate_extractions_avoided: int = 0

    rows_inserted: int = 0
    rows_updated: int = 0
    batches_completed: int = 0
    batches_failed: int = 0

    _ROLE_FIELD_BY_ROLE = {
        "CDC": "role_cdc", "TDR": "role_tdr", "DAO_WITH_TDR": "role_dao_with_tdr",
        "DAO_WITH_CDC": "role_dao_with_cdc", "DAO": "role_dao", "DCE": "role_dce",
        "RFP": "role_rfp", "OFFER": "role_offer", "REPORT": "role_report",
        "METHODOLOGY": "role_methodology", "OTHER": "role_other", "UNKNOWN": "role_unknown",
    }
    _BAND_FIELD_BY_BAND = {
        "STRONG_TECHNICAL_SOURCE": "strong_technical_source",
        "POSSIBLE_TECHNICAL_SOURCE": "possible_technical_source",
        "WEAK_TECHNICAL_SOURCE": "weak_technical_source",
    }
    _PRIORITY_FIELD_BY_PRIORITY = {
        "HIGH_PRIORITY": "high_priority", "MEDIUM_PRIORITY": "medium_priority",
        "EXTRACTION_FAILED": "extraction_failed_priority",
    }

    def tally_role(self, role: str) -> None:
        field_name = self._ROLE_FIELD_BY_ROLE.get(role)
        if field_name is None:
            raise ValueError(f"Unknown detected_role: {role!r}")
        setattr(self, field_name, getattr(self, field_name) + 1)

    def tally_band(self, band: str) -> None:
        field_name = self._BAND_FIELD_BY_BAND.get(band)
        if field_name is None:
            raise ValueError(f"Unknown structural_band: {band!r}")
        setattr(self, field_name, getattr(self, field_name) + 1)

    def tally_priority(self, priority: Optional[str]) -> None:
        if priority is None:
            return
        field_name = self._PRIORITY_FIELD_BY_PRIORITY.get(priority)
        if field_name is None:
            raise ValueError(f"Unknown review_priority: {priority!r}")
        setattr(self, field_name, getattr(self, field_name) + 1)

    def as_dict(self) -> dict:
        return {
            "projects_selected": self.project_folders_selected,
            "files_metadata_inspected": self.files_metadata_inspected,
            "prefilter_candidates": self.prefilter_candidates,
            "files_content_inspected": self.extraction.files_content_inspected,
            "pdf_extraction_calls": self.extraction.pdf_extraction_calls,
            "pdf_extraction_successes": self.extraction.pdf_extraction_successes,
            "pdf_extraction_failures": self.extraction.pdf_extraction_failures,
            "docx_extraction_calls": self.extraction.docx_extraction_calls,
            "docx_extraction_successes": self.docx_extraction_successes,
            "docx_extraction_failures": self.docx_extraction_failures,
            "doc_extraction_calls": self.extraction.doc_extraction_calls,
            "doc_extraction_successes": self.extraction.doc_extraction_successes,
            "doc_extraction_failures": self.extraction.doc_extraction_failures,
            "ocr_calls": self.extraction.ocr_calls,
            "local_ai_calls": self.extraction.local_ai_calls,
            "failed_extractions": self.extraction.failed_extractions,
            "external_calls": self.extraction.external_calls,
            "duplicate_groups": self.duplicate_groups,
            "duplicate_files": self.duplicate_files,
            "duplicate_extractions_avoided": self.duplicate_extractions_avoided,
            "CDC": self.role_cdc,
            "TDR": self.role_tdr,
            "DAO_WITH_TDR": self.role_dao_with_tdr,
            "DAO_WITH_CDC": self.role_dao_with_cdc,
            "DAO": self.role_dao,
            "DCE": self.role_dce,
            "RFP": self.role_rfp,
            "OFFER": self.role_offer,
            "REPORT": self.role_report,
            "METHODOLOGY": self.role_methodology,
            "OTHER": self.role_other,
            "UNKNOWN": self.role_unknown,
            "STRONG_TECHNICAL_SOURCE": self.strong_technical_source,
            "POSSIBLE_TECHNICAL_SOURCE": self.possible_technical_source,
            "WEAK_TECHNICAL_SOURCE": self.weak_technical_source,
            "HIGH_PRIORITY": self.high_priority,
            "MEDIUM_PRIORITY": self.medium_priority,
            "EXTRACTION_FAILED": self.extraction_failed_priority,
            "rows_inserted": self.rows_inserted,
            "rows_updated": self.rows_updated,
            "batches_completed": self.batches_completed,
            "batches_failed": self.batches_failed,
        }


_NULL_CONTENT_INSPECTOR_FULL_CORPUS = NullContentInspector()


def run_technical_source_discovery_for_projects(
    rows: Sequence[ArchiveFileRow],
    project_folders: Sequence[str],
    content_inspector: Optional[ContentInspector] = None,
    technical_categories: Optional[dict] = None,
) -> tuple[List[TechnicalSourceCandidate], FullCorpusCounters]:
    """Pure orchestration (no DB/filesystem access itself) over an
    EXPLICIT, already-selected set of project folders - this function has
    no opinion about batch boundaries, full-corpus-vs-pilot scope, or
    resume state; that is entirely the caller's job (run_full_corpus_mode
    below), matching run_pilot_discovery's existing "orchestration is
    pure, selection is the caller's job" split. Stage A (metadata
    prefilter, scripts/technical_source_classifier.classify_prefilter) can
    only ever create a Stage B (content-inspection) candidate - it never by
    itself produces a final role/score (Task 4)."""
    counters = FullCorpusCounters()
    inspector = content_inspector if content_inspector is not None else _NULL_CONTENT_INSPECTOR_FULL_CORPUS
    technical_categories = technical_categories or {}

    selected_folders = set(project_folders)
    counters.project_folders_selected = len(selected_folders)

    selected_rows = [
        row for row in rows
        if derive_project_folder_key(row.relative_path, row.source_root_label) in selected_folders
    ]

    duplicate_groups, duplicate_files = count_duplicate_groups_and_files(selected_rows)
    counters.duplicate_groups = duplicate_groups
    counters.duplicate_files = duplicate_files
    duplicate_assignments = assign_duplicate_relationships(selected_rows)

    candidates: List[TechnicalSourceCandidate] = []
    # Task 9 (review workflow) performance optimization: identical content
    # (same sha256, already computed by Phase 1's scanner) always produces
    # an identical extraction/classification outcome - reusing it here
    # never changes the result, it only avoids a redundant Docling/
    # LibreOffice invocation. Never populated from a None sha256 (a NULL
    # hash is never treated as a duplicate anywhere in this pipeline).
    outcome_cache_by_sha256: dict = {}

    for row in selected_rows:
        counters.files_metadata_inspected += 1
        technical_bucket = technical_categories.get(row.id)
        prefilter = classify_prefilter(row.filename, row.relative_path, row.extension, technical_bucket)

        if not prefilter.is_content_inspection_candidate:
            content_outcome = ContentInspectionOutcome(attempted=False)
        else:
            counters.prefilter_candidates += 1
            cached_outcome = outcome_cache_by_sha256.get(row.sha256) if row.sha256 else None
            if cached_outcome is not None:
                content_outcome = cached_outcome
                counters.duplicate_extractions_avoided += 1
            else:
                file_path = resolve_archive_file_path(row)
                content_outcome = inspector.inspect(row.id, row.extension, counters.extraction, file_path=file_path)
                if row.sha256:
                    outcome_cache_by_sha256[row.sha256] = content_outcome
                if (row.extension or "").strip().lower() == "docx" and content_outcome.attempted:
                    if content_outcome.failed:
                        counters.docx_extraction_failures += 1
                    else:
                        counters.docx_extraction_successes += 1

        candidate = build_technical_source_candidate(row, content_outcome, duplicate_assignments[row.id])
        counters.tally_role(candidate.detected_role)
        counters.tally_band(candidate.structural_band)
        counters.tally_priority(candidate.review_priority)
        candidates.append(candidate)

    counters.extraction.assert_no_external_calls()
    return candidates, counters


def run_prefilter_only_discovery_for_projects(
    rows: Sequence[ArchiveFileRow],
    project_folders: Sequence[str],
    technical_categories: Optional[dict] = None,
) -> tuple[List[TechnicalSourceCandidate], FullCorpusCounters]:
    """Safe, fast, METADATA-ONLY candidate recreation - recreates the Stage
    A prefilter queue without a multi-hour Stage B content-extraction
    rerun. Reuses the exact same Stage A rule
    (technical_source_classifier.classify_prefilter) as
    run_technical_source_discovery_for_projects above, but unlike that
    function a row that does not match the prefilter is never turned into
    a TechnicalSourceCandidate at all - it is skipped outright, not
    appended with a PREFILTER_SKIPPED placeholder. That is what makes the
    returned (and therefore ever-persisted) list bounded to the prefilter
    candidates themselves rather than growing to "every file in the
    corpus": persisting run_technical_source_discovery_for_projects's own
    output under a null content inspector cannot be used for this,
    because that function still returns one candidate per input row
    (prefilter match or not) so that its own aggregate counters stay
    complete. Never constructs a ContentInspector, never resolves a file
    path (resolve_archive_file_path is never called here), never touches
    the archive filesystem - every input already lives in
    knowledge_base.archive_files."""
    counters = FullCorpusCounters()
    technical_categories = technical_categories or {}

    selected_folders = set(project_folders)
    counters.project_folders_selected = len(selected_folders)
    selected_rows = [
        row for row in rows
        if derive_project_folder_key(row.relative_path, row.source_root_label) in selected_folders
    ]

    duplicate_groups, duplicate_files = count_duplicate_groups_and_files(selected_rows)
    counters.duplicate_groups = duplicate_groups
    counters.duplicate_files = duplicate_files
    duplicate_assignments = assign_duplicate_relationships(selected_rows)

    candidates: List[TechnicalSourceCandidate] = []
    for row in selected_rows:
        counters.files_metadata_inspected += 1
        technical_bucket = technical_categories.get(row.id)
        prefilter = classify_prefilter(row.filename, row.relative_path, row.extension, technical_bucket)
        if not prefilter.is_content_inspection_candidate:
            continue  # never constructed, never persisted - this bounds the result to real prefilter candidates

        counters.prefilter_candidates += 1
        content_outcome = ContentInspectionOutcome(attempted=False)
        candidate = build_technical_source_candidate(row, content_outcome, duplicate_assignments[row.id])
        counters.tally_role(candidate.detected_role)
        counters.tally_band(candidate.structural_band)
        counters.tally_priority(candidate.review_priority)
        candidates.append(candidate)

    counters.extraction.assert_no_external_calls()
    return candidates, counters


def build_review_queue(candidates: Sequence[TechnicalSourceCandidate]) -> dict:
    """Task 10. Safe, AGGREGATE-ONLY counts per review priority - never a
    list of archive_file_ids/paths/filenames. Ordinary non-candidate
    documents (review_priority is None) are never counted here."""
    queue = {"HIGH_PRIORITY": 0, "MEDIUM_PRIORITY": 0, "EXTRACTION_FAILED": 0}
    for candidate in candidates:
        if candidate.review_priority in queue:
            queue[candidate.review_priority] += 1
    return queue


# =====================================================================
# Review-workflow Task 2 - a second, presentation-layer categorization on
# top of the SAME fields build_review_queue already reads (detected_role,
# structural_band, extraction_status) - no new/invented scoring, no
# second source of truth. review_priority (HIGH_PRIORITY/MEDIUM_PRIORITY/
# EXTRACTION_FAILED, above) remains the one field actually persisted and
# used for triage; REVIEW_CATEGORY_ORDER below is a documented VIEW used
# only by the aggregate review-summary report and single-document
# ordering (scripts/cdc_review.py), answering the specific dimensions the
# review workflow asked to distinguish: CDC / DAO_WITH_CDC /
# STRONG_TECHNICAL_SOURCE / POSSIBLE_TECHNICAL_SOURCE / EXTRACTION_FAILED.
#
# Order is exactly the reviewer's own suggested conceptual order, chosen
# deliberately over inventing a numeric score: EXTRACTION_FAILED and
# STRONG_TECHNICAL_SOURCE first (a strong-but-unlabelled candidate, or one
# whose content could not even be read, is the least-understood and most
# valuable to look at first), then POSSIBLE_TECHNICAL_SOURCE, then the
# already-role-confirmed CDC/DAO_WITH_CDC (already carry a strong content
# signal on their own), then everything else. A candidate can belong to
# more than one category (e.g. CDC role AND STRONG band) - these are
# overlapping lenses on the same candidate, not a partition.
# =====================================================================

REVIEW_CATEGORY_ORDER: tuple[str, ...] = (
    "EXTRACTION_FAILED",
    "STRONG_TECHNICAL_SOURCE",
    "POSSIBLE_TECHNICAL_SOURCE",
    "CDC",
    "DAO_WITH_CDC",
)


def review_categories_for_candidate(candidate: TechnicalSourceCandidate) -> set:
    """Every REVIEW_CATEGORY_ORDER category this one candidate belongs to
    (zero, one, or several) - derived purely from already-computed fields,
    never a new judgement call."""
    categories = set()
    if candidate.extraction_status == "FAILED":
        categories.add("EXTRACTION_FAILED")
    if candidate.structural_band == "STRONG_TECHNICAL_SOURCE":
        categories.add("STRONG_TECHNICAL_SOURCE")
    if candidate.structural_band == "POSSIBLE_TECHNICAL_SOURCE":
        categories.add("POSSIBLE_TECHNICAL_SOURCE")
    if candidate.detected_role == "CDC":
        categories.add("CDC")
    if candidate.detected_role == "DAO_WITH_CDC":
        categories.add("DAO_WITH_CDC")
    return categories


def build_review_categories(candidates: Sequence[TechnicalSourceCandidate]) -> dict:
    """Safe, AGGREGATE-ONLY counts per REVIEW_CATEGORY_ORDER category -
    never a list of archive_file_ids/paths/filenames. Counts overlap by
    design (see module note above) - the sum of these counts is not, and
    is not meant to be, the total candidate count."""
    counts = {name: 0 for name in REVIEW_CATEGORY_ORDER}
    for candidate in candidates:
        for category in review_categories_for_candidate(candidate):
            counts[category] += 1
    return counts


def order_candidates_for_review(candidates: Sequence[TechnicalSourceCandidate]) -> List[TechnicalSourceCandidate]:
    """Deterministic priority ordering (Task 2: "must support deterministic
    priority ordering") - a candidate's rank is the EARLIEST position in
    REVIEW_CATEGORY_ORDER among all categories it belongs to; a candidate
    matching no category ranks last. Ties are broken by archive_file_id
    (a database-generated integer, never a filename/path), so the result
    is fully reproducible across repeated calls on the same input."""
    def rank(candidate: TechnicalSourceCandidate) -> int:
        categories = review_categories_for_candidate(candidate)
        if not categories:
            return len(REVIEW_CATEGORY_ORDER)
        return min(REVIEW_CATEGORY_ORDER.index(category) for category in categories)

    return sorted(candidates, key=lambda candidate: (rank(candidate), candidate.archive_file_id))


# =====================================================================
# Task 9 - batching + resume. A local, JSON checkpoint file (no new DB
# table needed for this - the checkpoint only tracks BATCH INDICES and
# CUMULATIVE SAFE COUNTS, never a project/file identifier, so it carries
# nothing confidential even though it lives on disk outside the database).
# =====================================================================

DEFAULT_CHECKPOINT_PATH = "scripts/.cdc_full_corpus_checkpoint.json"

# --process-persisted-candidates: bumped whenever the LOCAL extraction
# configuration changes (extraction char limit, PDF/DOC/DOCX extraction
# method, timeout, etc.) independently of TECHNICAL_SOURCE_CLASSIFIER_VERSION
# (which only versions the classification RULES) - a checkpoint recorded
# under an older extraction configuration must never be silently treated
# as compatible with a newer one.
PROCESS_PERSISTED_EXTRACTION_CONFIG_VERSION = "v1"


def build_full_corpus_scope_config(
    project_folders: Sequence[str],
    batch_size: int,
    enable_content_inspection: bool,
    persist_prefilter_only: bool = False,
) -> dict:
    """The full set of configuration DIMENSIONS a --full-corpus checkpoint
    must be scoped to (Task 8, review workflow). Deliberately includes
    enable_content_inspection and the classifier version, not just the
    project set + batch size: a metadata-only checkpoint (
    enable_content_inspection=False) must never be silently resumed as a
    content-inspection run, and a checkpoint recorded under an older
    classifier version's rules must never be silently treated as
    interchangeable with a newer one. persist_prefilter_only is a further,
    independent dimension: a --persist-prefilter-only run (
    run_prefilter_only_discovery_for_projects, which never returns a
    candidate for a non-prefilter-matching row) must never be silently
    resumed as, or treated as compatible with, an ordinary full-discovery
    run (run_technical_source_discovery_for_projects, which returns one
    candidate per row) even though both can share enable_content_inspection
    =False - the two produce structurally different candidate sets. "mode"
    is included defensively in case a future second checkpoint-using
    command ever shares this checkpoint file's default path. project_count
    (not the folder names themselves) stands in for "the project set" -
    see compute_batch_scope_signature for why the names are never hashed
    directly either."""
    return {
        "mode": "full_corpus",
        "project_count": len(project_folders),
        "batch_size": batch_size,
        "enable_content_inspection": enable_content_inspection,
        "persist_prefilter_only": persist_prefilter_only,
        "classifier_version": TECHNICAL_SOURCE_CLASSIFIER_VERSION,
    }


def compute_batch_scope_signature(project_folders: Sequence[str], config: dict) -> str:
    """A hash fingerprint of (the full sorted project-folder set, the scope
    config dict from build_full_corpus_scope_config) - deliberately never
    the folder names themselves, even in the signature's input, since the
    signature itself is persisted to the checkpoint file. Changing the
    underlying project set (e.g. the archive was rescanned) OR ANY
    configuration dimension (batch size, content-inspection on/off,
    classifier version, ...) invalidates any existing checkpoint rather
    than silently resuming against a mismatched scope."""
    payload = "|".join(project_folders) + "::" + json.dumps(config, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def describe_scope_mismatch(old_config: dict, new_config: dict) -> str:
    """A clear, specific diagnostic (Task 8: "fail closed with a clear
    message") listing exactly which configuration dimension(s) differ
    between an existing checkpoint and the current run - never guesses,
    never silently picks a side."""
    all_keys = sorted(set(old_config) | set(new_config))
    differences = [
        f"{key}: checkpoint={old_config.get(key)!r} vs current={new_config.get(key)!r}"
        for key in all_keys
        if old_config.get(key) != new_config.get(key)
    ]
    return "; ".join(differences) if differences else "project set changed (folder count or contents differ)"


def split_into_batches(project_folders: Sequence[str], batch_size: int) -> List[List[str]]:
    if batch_size <= 0:
        raise ValueError("batch_size must be a positive integer")
    ordered = list(project_folders)  # project_folders is already sorted/deterministic (enumerate_project_folders)
    return [ordered[i:i + batch_size] for i in range(0, len(ordered), batch_size)]


@dataclass
class Checkpoint:
    scope_signature: str
    batch_size: int
    total_batches: int
    completed_batches: List[int] = field(default_factory=list)
    failed_batches: List[int] = field(default_factory=list)
    aggregate: dict = field(default_factory=dict)
    # Human-readable snapshot of build_full_corpus_scope_config() at the
    # time this checkpoint was created - never used for the compatibility
    # decision itself (scope_signature is authoritative for that), only to
    # build a specific describe_scope_mismatch() message on a mismatch.
    config: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "scope_signature": self.scope_signature,
            "batch_size": self.batch_size,
            "total_batches": self.total_batches,
            "completed_batches": sorted(set(self.completed_batches)),
            "failed_batches": sorted(set(self.failed_batches)),
            "aggregate": self.aggregate,
            "config": self.config,
        }

    @staticmethod
    def from_dict(data: dict) -> "Checkpoint":
        return Checkpoint(
            scope_signature=data["scope_signature"],
            batch_size=data["batch_size"],
            total_batches=data["total_batches"],
            completed_batches=list(data.get("completed_batches", [])),
            failed_batches=list(data.get("failed_batches", [])),
            aggregate=dict(data.get("aggregate", {})),
            config=dict(data.get("config", {})),
        )


def load_checkpoint(path: Path) -> Optional[Checkpoint]:
    """Fails closed to None (treated as "no checkpoint") on any malformed/
    unreadable file - a corrupt checkpoint must never crash a resume, it
    must simply be treated as absent (the caller then either starts fresh
    or, with --resume, reports NOT_READY-style guidance)."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return Checkpoint.from_dict(data)
    except (json.JSONDecodeError, OSError, KeyError, TypeError):
        return None


def save_checkpoint(path: Path, checkpoint: Checkpoint) -> None:
    path.write_text(json.dumps(checkpoint.as_dict(), indent=2), encoding="utf-8")


def merge_counters_into_aggregate(aggregate: dict, counters: FullCorpusCounters) -> dict:
    """Adds one batch's counters into the running cumulative aggregate
    dict (int fields summed). Pure - returns a new dict, never mutates
    `aggregate` in place."""
    merged = dict(aggregate)
    for key, value in counters.as_dict().items():
        if isinstance(value, bool):
            merged[key] = value
        elif isinstance(value, (int, float)):
            merged[key] = merged.get(key, 0) + value
        else:
            merged[key] = value
    return merged


# =====================================================================
# Task 11 - local storage model for the taxonomy-aware pipeline. Separate
# table/repository from historical_cdc_candidates (see scripts/sql/
# create_historical_technical_source_candidates_table.sql, NOT applied by
# this task) - the shape genuinely differs (role taxonomy, structural
# score, review priority, a different human-validation status enum), so
# extending the old CDC-only table would overload it rather than reuse it
# cleanly. Never stores extracted document text.
# =====================================================================


class TechnicalSourceCandidateRepository(Protocol):
    def upsert(self, candidate: TechnicalSourceCandidate) -> str:
        """Returns 'inserted' or 'updated'. MACHINE-classification columns
        only - must never write validation_status/reviewed_at/reviewed_by,
        so a re-run of discovery can never clobber a human's prior review
        decision (see mark_validation_status)."""
        ...

    def begin_batch(self) -> None: ...

    def commit_batch(self) -> None: ...

    def rollback_batch(self) -> None: ...

    def mark_validation_status(
        self, archive_file_id: int, validation_status: str, reviewed_by: Optional[int] = None
    ) -> None:
        """The ONLY way a HUMAN_*/NEEDS_HUMAN_REVIEW validation_status is
        ever set - never called by discovery/upsert. Auditable (always
        stamps reviewed_at) and idempotent (setting the same status twice
        is a no-op change in effect, not an error)."""
        ...


class PostgresTechnicalSourceCandidateRepository:
    """Real persistence, targeting knowledge_base.historical_technical_source_candidates
    (scripts/sql/create_historical_technical_source_candidates_table.sql -
    NOT applied by this development task). Idempotent via that table's
    UNIQUE constraint on archive_file_id, same pattern as
    PostgresCandidateRepository."""

    def __init__(self, conn) -> None:
        self._conn = conn

    def begin_batch(self) -> None:
        pass

    def commit_batch(self) -> None:
        pass

    def rollback_batch(self) -> None:
        pass

    def upsert(self, candidate: TechnicalSourceCandidate) -> str:
        # MACHINE-classification columns only - deliberately does not
        # reference validation_status/reviewed_at/reviewed_by anywhere in
        # this statement, so re-running discovery for the same
        # archive_file_id can never clobber a human's prior review
        # decision (validation_status keeps its existing DB value on
        # conflict, exactly because it is absent from this column list).
        with self._conn.cursor() as cur:
            cur.execute(
                """
                insert into knowledge_base.historical_technical_source_candidates (
                    archive_file_id, year, project_reference, detected_role,
                    technical_source_candidate, structural_score, structural_max,
                    structural_ratio, structural_band, confidence, review_priority, extraction_status,
                    classification_method, duplicate_of_archive_file_id, is_primary_candidate,
                    extraction_method, extraction_failure_category, project_mapping_status,
                    classifier_version
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (archive_file_id) do update set
                    year = excluded.year,
                    project_reference = excluded.project_reference,
                    detected_role = excluded.detected_role,
                    technical_source_candidate = excluded.technical_source_candidate,
                    structural_score = excluded.structural_score,
                    structural_max = excluded.structural_max,
                    structural_ratio = excluded.structural_ratio,
                    structural_band = excluded.structural_band,
                    confidence = excluded.confidence,
                    review_priority = excluded.review_priority,
                    extraction_status = excluded.extraction_status,
                    classification_method = excluded.classification_method,
                    duplicate_of_archive_file_id = excluded.duplicate_of_archive_file_id,
                    is_primary_candidate = excluded.is_primary_candidate,
                    extraction_method = excluded.extraction_method,
                    extraction_failure_category = excluded.extraction_failure_category,
                    project_mapping_status = excluded.project_mapping_status,
                    classifier_version = excluded.classifier_version,
                    updated_at = now()
                returning (xmax = 0) as inserted
                """,
                (
                    candidate.archive_file_id,
                    candidate.year,
                    candidate.project_reference,
                    candidate.detected_role,
                    candidate.technical_source_candidate,
                    candidate.structural_score,
                    candidate.structural_max,
                    candidate.structural_ratio,
                    candidate.structural_band,
                    candidate.confidence,
                    candidate.review_priority,
                    candidate.extraction_status,
                    candidate.classification_method,
                    candidate.duplicate_of_archive_file_id,
                    candidate.is_primary_candidate,
                    candidate.extraction_method,
                    candidate.extraction_failure_category,
                    candidate.project_mapping_status,
                    candidate.classifier_version,
                ),
            )
            row = cur.fetchone()
        return "inserted" if row[0] else "updated"

    def mark_validation_status(
        self, archive_file_id: int, validation_status: str, reviewed_by: Optional[int] = None
    ) -> None:
        if validation_status not in HUMAN_SETTABLE_VALIDATION_STATUSES:
            raise ValueError(
                f"validation_status must be human-settable (not MACHINE_CLASSIFIED): {validation_status!r}"
            )
        # Touches ONLY validation_status/reviewed_at/reviewed_by - never
        # detected_role/structural_score/etc, so this can never be used to
        # smuggle a machine-classification change through the review path.
        with self._conn.cursor() as cur:
            cur.execute(
                """
                update knowledge_base.historical_technical_source_candidates
                set validation_status = %s, reviewed_at = now(), reviewed_by = %s, updated_at = now()
                where archive_file_id = %s
                """,
                (validation_status, reviewed_by, archive_file_id),
            )
            if cur.rowcount == 0:
                raise ValueError(f"No candidate row found for archive_file_id={archive_file_id!r}")


def persist_technical_source_candidates(
    repository: TechnicalSourceCandidateRepository, candidates: Sequence[TechnicalSourceCandidate]
) -> PersistResult:
    """Same one-batch-one-transaction, no-partial-writes contract as
    persist_candidates() above."""
    repository.begin_batch()
    result = PersistResult()
    try:
        for candidate in candidates:
            outcome = repository.upsert(candidate)
            if outcome == "inserted":
                result.inserted += 1
            elif outcome == "updated":
                result.updated += 1
            else:
                raise ValueError(f"Unexpected upsert outcome: {outcome!r}")
        repository.commit_batch()
        return result
    except Exception:
        repository.rollback_batch()
        return PersistResult(inserted=0, updated=0, failed_batch=True)


# =====================================================================
# DB access (thin - only reads knowledge_base.archive_files; only writes
# knowledge_base.historical_cdc_candidates)
# =====================================================================


def _connect(database_url: str):
    import psycopg  # lazy import - see module docstring

    return psycopg.connect(database_url)


def _fetch_archive_file_rows(conn) -> List[ArchiveFileRow]:
    """Metadata-only read: id, relative_path, filename, extension, sha256,
    plus the owning source root's label (joined in - see
    ArchiveFileRow.source_root_label / derive_project_folder_key for why
    this is needed). Never reads file content. sha256 here is the value
    Phase 1's scanner already computed - this function does not hash
    anything itself."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select f.id, f.relative_path, f.filename, f.extension, f.sha256, r.label
            from knowledge_base.archive_files f
            join knowledge_base.archive_source_roots r on r.id = f.source_root_id
            order by f.id asc
            """
        )
        rows = cur.fetchall()
    return [
        ArchiveFileRow(id=r[0], relative_path=r[1], filename=r[2], extension=r[3], sha256=r[4], source_root_label=r[5])
        for r in rows
    ]


def _fetch_archive_file_rows_with_root_path(conn) -> List[ArchiveFileRow]:
    """Same as _fetch_archive_file_rows, but also selects the source
    root's root_path so ArchiveFileRow.source_root_path can be populated -
    the one piece of information a real ContentInspector needs to open a
    file for local extraction. Only ever called when
    --enable-content-inspection is explicitly passed; every other mode
    uses the metadata-only fetch above, which never selects root_path at
    all."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select f.id, f.relative_path, f.filename, f.extension, f.sha256, r.label, r.root_path
            from knowledge_base.archive_files f
            join knowledge_base.archive_source_roots r on r.id = f.source_root_id
            order by f.id asc
            """
        )
        rows = cur.fetchall()
    return [
        ArchiveFileRow(
            id=r[0], relative_path=r[1], filename=r[2], extension=r[3], sha256=r[4],
            source_root_label=r[5], source_root_path=r[6],
        )
        for r in rows
    ]


def _fetch_technical_categories(conn) -> dict:
    """archive_file_id -> technical_bucket (BUSINESS_DOCUMENT/TECHNICAL_FILE/
    IMAGE/ARCHIVE/SOFTWARE_SYSTEM/UNKNOWN, or absent entirely if Phase 2
    classification never ran for that file). Reads Phase 2's already-
    computed knowledge_base.archive_file_classifications label only -
    never document content. Only ever called by --full-corpus (Task 4's
    Stage A prefilter)."""
    with conn.cursor() as cur:
        cur.execute("select archive_file_id, technical_bucket from knowledge_base.archive_file_classifications")
        rows = cur.fetchall()
    return {archive_file_id: technical_bucket for archive_file_id, technical_bucket in rows}


def _fetch_summary_counts(conn) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            """
            select cdc_status, count(*)
            from knowledge_base.historical_cdc_candidates
            group by cdc_status
            """
        )
        rows = cur.fetchall()
    counts = {status: 0 for status in CDC_STATUSES}
    for status, count in rows:
        counts[status] = count
    return counts


# =====================================================================
# Discovery orchestration
# =====================================================================


_NULL_CONTENT_INSPECTOR = NullContentInspector()


def run_pilot_discovery(
    rows: Sequence[ArchiveFileRow],
    pilot_limit: int,
    content_inspector: Optional[ContentInspector] = None,
) -> tuple[List[CdcCandidate], DiscoveryCounters]:
    """Pure orchestration over already-fetched rows - no DB/filesystem
    access happens in this function itself, which is what makes it fully
    unit-testable with synthetic ArchiveFileRow values.

    content_inspector defaults to NullContentInspector (unchanged
    behavior: CONFIRMED_CDC stays structurally unreachable). Passing a real
    inspector (e.g. LocalContentInspector) is how a caller opts into actual
    local content extraction - see run_pilot_mode's
    --enable-content-inspection flag. Content inspection is only ever
    attempted for files metadata already flagged as LIKELY_CDC or
    NEEDS_REVIEW ("metadata candidate -> LOCAL content extraction", Step
    Objective) - a file metadata already confidently ruled out (NOT_CDC)
    is never opened."""
    counters = DiscoveryCounters()
    inspector = content_inspector if content_inspector is not None else _NULL_CONTENT_INSPECTOR

    selected_folders = set(select_pilot_project_folders(rows, pilot_limit))
    counters.project_folders_selected = len(selected_folders)

    # Fix 2: metadata processing below only ever iterates selected_rows -
    # never the full `rows` - so files_metadata_inspected reflects only the
    # selected project folders, never the whole archive.
    selected_rows = [
        row for row in rows
        if derive_project_folder_key(row.relative_path, row.source_root_label) in selected_folders
    ]

    duplicate_groups, duplicate_files = count_duplicate_groups_and_files(selected_rows)
    counters.duplicate_groups = duplicate_groups
    counters.duplicate_files = duplicate_files
    duplicate_assignments = assign_duplicate_relationships(selected_rows)

    candidates: List[CdcCandidate] = []

    for row in selected_rows:
        counters.files_metadata_inspected += 1
        metadata = classify_metadata(row.relative_path, row.filename)

        if metadata.metadata_status == "NOT_CDC":
            content_outcome = ContentInspectionOutcome(attempted=False)
        else:
            file_path = resolve_archive_file_path(row)
            content_outcome = inspector.inspect(row.id, row.extension, counters, file_path=file_path)

        candidate = build_candidate(row, metadata, content_outcome, duplicate_assignments[row.id])
        counters.tally_status(candidate.cdc_status)
        candidates.append(candidate)

    counters.assert_no_external_calls()
    return candidates, counters


def _offres_year_path_prefix_length(relative_path: str) -> Optional[int]:
    """Returns how many LEADING path segments to drop from relative_path
    before the OFFRES-year segment (itself kept), using the exact same
    year-detection logic as derive_project_folder_key - so the two can
    never disagree about where a project "starts". Returns 0 when the year
    is already the first segment (convention A - nothing to drop), None
    when no OFFRES-year segment is found in the path at all (convention B,
    source_root_label-derived year - relative_path already starts at the
    project level and needs no stripping - or a row outside OFFRES scope
    entirely, which never reaches path resolution in practice)."""
    parts = [p for p in relative_path.split("/") if p.strip()]
    if not parts:
        return None
    if extract_offres_year_segment(parts[0]) is not None:
        return 0
    if len(parts) >= 2 and extract_offres_year_segment(parts[1]) is not None:
        return 1
    return None


def resolve_archive_file_path(row: ArchiveFileRow) -> Optional[Path]:
    """Maps a DB archive_files row to its real, current filesystem
    location.

    2026-09 diagnosis: archive_source_roots.root_path for the real archive
    already equals the current read-only mount exactly - but the STORED
    relative_path values carry a leading "wrapper" segment (from how the
    archive was originally organized at scan time) that the CURRENT mount
    does not have as a top-level directory. Joining root_path directly
    onto relative_path therefore produced a path that never exists on disk
    (confirmed: 0/93 real PDF candidates existed with naive joining; 93/93
    existed once that leading segment - up to and including the OFFRES-year
    segment - was dropped). This function drops exactly that prefix,
    using the same detection logic as derive_project_folder_key.

    Returns None when no root path is available (the default for every
    metadata-only fetch - what makes NullContentInspector/any inspector
    receive file_path=None unless a caller explicitly opted into
    --enable-content-inspection), or when the resolved path would escape
    the configured root (defense in depth against a malformed/traversal
    relative_path - e.g. containing "..")."""
    if not row.source_root_path:
        return None

    parts = [p for p in row.relative_path.split("/") if p.strip()]
    drop = _offres_year_path_prefix_length(row.relative_path)
    remainder = "/".join(parts[drop:]) if drop is not None else row.relative_path

    root = Path(row.source_root_path).resolve()
    candidate = (root / remainder).resolve()

    try:
        candidate.relative_to(root)
    except ValueError:
        return None

    return candidate


# =====================================================================
# CLI
# =====================================================================


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cdc_discovery.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--pilot-limit",
        type=int,
        metavar="N",
        help="Run discovery over exactly N deterministically-selected top-level OFFRES project folders.",
    )
    mode.add_argument(
        "--summary",
        action="store_true",
        help="Print aggregate status counts already persisted in historical_cdc_candidates. Read-only, no discovery.",
    )
    mode.add_argument(
        "--full-corpus",
        action="store_true",
        help=(
            "Run taxonomy-aware technical-source discovery (scripts/technical_source_classifier.py: "
            "CDC/TDR/DAO_WITH_TDR/DAO_WITH_CDC/DAO/DCE/RFP/OFFER/REPORT/METHODOLOGY/OTHER/UNKNOWN, "
            "plus a weighted structural fingerprint) over EVERY document-bearing project folder "
            "derived from the archive cartography (enumerate_project_folders) - never a hardcoded "
            "count. Requires --batch-size and exactly one of --dry-run/--persist; --resume continues "
            "a previously interrupted run from its checkpoint."
        ),
    )
    mode.add_argument(
        "--process-persisted-candidates",
        action="store_true",
        help=(
            "Content-process an exact, bounded number of ALREADY-PERSISTED metadata prefilter "
            "candidates from knowledge_base.historical_technical_source_candidates (never a fresh "
            "filesystem/project scan): selects up to --limit rows where extraction_status="
            "NOT_ATTEMPTED and validation_status=MACHINE_CLASSIFIED, ordered by archive_file_id ASC. "
            "Requires --limit and --batch-size and exactly one of --dry-run/--persist; --dry-run "
            "verifies selection and configuration only and never opens a document; --persist runs "
            "real local content extraction (Docling/DOCX-XML/LibreOffice, never Ollama) and the "
            "deterministic structural classifier. --resume continues a previously interrupted "
            "--persist run from its checkpoint."
        ),
    )
    mode.add_argument(
        "--retry-failed",
        action="store_true",
        help=(
            "Retry an exact, bounded number of previously-FAILED persisted candidates from "
            "knowledge_base.historical_technical_source_candidates, filtered to one specific "
            "--failure-category: selects up to --limit rows where extraction_status=FAILED and "
            "extraction_failure_category=<category>, ordered by archive_file_id ASC - never "
            "NOT_ATTEMPTED, never SUCCESS. Requires --failure-category, --limit and --batch-size and "
            "exactly one of --dry-run/--persist; --dry-run verifies selection and configuration only "
            "and never opens a document; --persist runs the same real local content extraction and "
            "deterministic structural classifier as --process-persisted-candidates, using a SEPARATE "
            "checkpoint scope. --resume continues a previously interrupted --persist run from its "
            "checkpoint."
        ),
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="With --pilot-limit: compute candidates and print aggregate counts, but write nothing to the database.",
    )
    parser.add_argument(
        "--persist",
        action="store_true",
        help="With --pilot-limit: explicit intent to write candidate rows to the database (idempotent upsert).",
    )
    parser.add_argument(
        "--idempotent-run",
        action="store_true",
        help="Optional with --persist: documents that this run must be safe to repeat (always true by design; this flag only annotates the run's aggregate output).",
    )
    parser.add_argument(
        "--enable-content-inspection",
        action="store_true",
        help=(
            "With --pilot-limit: opt into real local content extraction/evidence analysis "
            "(scripts/cdc_content_inspector.py's LocalContentInspector) for metadata "
            "candidates (LIKELY_CDC/NEEDS_REVIEW), instead of the default NullContentInspector. "
            "Local only (Docling subprocess + stdlib DOCX parsing); no local AI stage is "
            "enabled by this flag alone. Without it, CONFIRMED_CDC remains structurally "
            "unreachable, exactly as before."
        ),
    )
    parser.add_argument(
        "--validate-single-confirmed",
        action="store_true",
        help=(
            "With --pilot-limit --dry-run --enable-content-inspection: after computing "
            "candidates in memory, if exactly one CONFIRMED_CDC candidate was found, run "
            "a second conservative structural validation pass over its already-extracted "
            "content and append only safe aggregate YES/NO/UNKNOWN flags plus a final "
            "validation_result to the printed report. Never persists the candidate's "
            "identity anywhere, never prints a filename/path/document content. Requires "
            "--dry-run and --enable-content-inspection; incompatible with --persist and "
            "--idempotent-run."
        ),
    )
    parser.add_argument(
        "--open-single-confirmed",
        action="store_true",
        help=(
            "With --pilot-limit --dry-run --enable-content-inspection --validate-single-confirmed: "
            "after computing candidates in memory, if exactly one CONFIRMED_CDC candidate was found, "
            "open the original document in a local desktop viewer. Never persists anything. "
            "Requires all other flags specified above; incompatible with --persist and "
            "--idempotent-run."
        ),
    )
    parser.add_argument(
        "--persist-prefilter-only",
        action="store_true",
        help=(
            "With --full-corpus: recreate/persist ONLY the Stage A metadata-prefilter "
            "candidate rows (technical_source_classifier.classify_prefilter) - never a row "
            "for a non-candidate file, and never any Stage B content extraction/local AI/ "
            "external call. Use this to safely rebuild the prefilter queue without a "
            "multi-hour content-inspection rerun. Mutually exclusive with "
            "--enable-content-inspection."
        ),
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help=(
            "With --process-persisted-candidates or --retry-failed: the EXACT maximum number of "
            "persisted candidate documents to select and process - never a project/folder count "
            "(unlike --pilot-limit). Required with either mode."
        ),
    )
    parser.add_argument(
        "--failure-category",
        type=str,
        default=None,
        choices=EXTRACTION_FAILURE_CATEGORIES,
        metavar="CATEGORY",
        help=(
            "With --retry-failed: retry only rows whose extraction_failure_category is exactly "
            "this value (e.g. EMPTY_EXTRACTED_TEXT). Required with --retry-failed; not accepted by "
            "any other mode."
        ),
    )
    parser.add_argument(
        "--extensions",
        type=str,
        default=None,
        metavar="ext1,ext2",
        help=(
            "With --process-persisted-candidates: restrict selection to a comma-separated, "
            "case-insensitive allowlist of file extensions (e.g. pdf,docx) - a legacy .doc row is "
            "never selected when --extensions pdf,docx is given. Optional; not accepted by any "
            "other mode."
        ),
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        metavar="N",
        help=(
            "With --full-corpus: process exactly N project folders per batch. With "
            "--process-persisted-candidates or --retry-failed: process exactly N selected "
            "candidate documents per batch. Either way, checkpointing progress after every batch "
            "so a long-running --persist run can be safely interrupted and resumed rather than "
            "restarted from scratch. Required with --full-corpus, --process-persisted-candidates, "
            "or --retry-failed."
        ),
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help=(
            "With --full-corpus, --process-persisted-candidates, or --retry-failed: continue a "
            "previous --persist run from its last completed batch, using the checkpoint file "
            "(--checkpoint-file). Without --resume, an existing incomplete checkpoint for the same "
            "scope is left untouched and the run refuses to start."
        ),
    )
    parser.add_argument(
        "--checkpoint-file",
        type=str,
        default=None,
        metavar="PATH",
        help=(
            f"Local JSON checkpoint file path. Default: {DEFAULT_CHECKPOINT_PATH} for --full-corpus, "
            f"{DEFAULT_PROCESS_PERSISTED_CHECKPOINT_PATH} for --process-persisted-candidates, "
            f"{DEFAULT_RETRY_FAILED_CHECKPOINT_PATH} for --retry-failed. Contains only batch indices "
            "and aggregate counts - never a filename, path, or project name."
        ),
    )

    return parser


def _validate_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.summary:
        if (
            args.dry_run
            or args.persist
            or args.idempotent_run
            or args.enable_content_inspection
            or args.validate_single_confirmed
            or args.open_single_confirmed
            or args.persist_prefilter_only
            or args.process_persisted_candidates
            or args.retry_failed
        ):
            parser.error(
                "--summary cannot be combined with --dry-run/--persist/--idempotent-run/"
                "--enable-content-inspection/--validate-single-confirmed/--open-single-confirmed/"
                "--persist-prefilter-only/--process-persisted-candidates/--retry-failed."
            )
        if (
            args.batch_size is not None or args.resume or args.limit is not None
            or args.failure_category is not None or args.extensions is not None
        ):
            parser.error(
                "--summary cannot be combined with --batch-size/--resume/--limit/--failure-category/"
                "--extensions."
            )
        return

    if args.full_corpus:
        # Fail safely BEFORE any archive processing/DB connection starts -
        # same "reject before archive processing" contract as every other
        # mode's gating in this function.
        if args.validate_single_confirmed or args.open_single_confirmed:
            parser.error(
                "--full-corpus cannot be combined with --validate-single-confirmed/"
                "--open-single-confirmed (those apply only to --pilot-limit)."
            )
        if args.limit is not None:
            parser.error("--limit only applies to --process-persisted-candidates/--retry-failed.")
        if args.failure_category is not None:
            parser.error("--failure-category only applies to --retry-failed.")
        if args.extensions is not None:
            parser.error("--extensions only applies to --process-persisted-candidates.")
        if args.dry_run and args.persist:
            parser.error("--dry-run and --persist are mutually exclusive.")
        if not args.dry_run and not args.persist:
            parser.error("--full-corpus requires exactly one of --dry-run or --persist (explicit write intent required).")
        if args.idempotent_run and not args.persist:
            parser.error("--idempotent-run only makes sense together with --persist.")
        if args.batch_size is None:
            parser.error("--full-corpus requires --batch-size.")
        if args.batch_size <= 0:
            parser.error("--batch-size must be a positive integer.")
        if args.persist_prefilter_only and args.enable_content_inspection:
            parser.error(
                "--persist-prefilter-only cannot be combined with --enable-content-inspection "
                "(prefilter-only mode never performs content inspection)."
            )
        return

    if args.process_persisted_candidates:
        # Fail safely BEFORE any archive processing/DB connection starts -
        # same "reject before archive processing" contract as every other
        # mode's gating in this function.
        if (
            args.validate_single_confirmed
            or args.open_single_confirmed
            or args.enable_content_inspection
            or args.persist_prefilter_only
        ):
            parser.error(
                "--process-persisted-candidates cannot be combined with --validate-single-confirmed/"
                "--open-single-confirmed/--enable-content-inspection/--persist-prefilter-only "
                "(this mode always uses local content inspection under --persist, and never under "
                "--dry-run, on its own terms)."
            )
        if args.failure_category is not None:
            parser.error("--failure-category only applies to --retry-failed.")
        if args.extensions is not None and not [ext for ext in args.extensions.split(",") if ext.strip()]:
            parser.error("--extensions must contain at least one non-empty extension, e.g. pdf,docx.")
        if args.dry_run and args.persist:
            parser.error("--dry-run and --persist are mutually exclusive.")
        if not args.dry_run and not args.persist:
            parser.error(
                "--process-persisted-candidates requires exactly one of --dry-run or --persist "
                "(explicit write intent required)."
            )
        if args.idempotent_run and not args.persist:
            parser.error("--idempotent-run only makes sense together with --persist.")
        if args.limit is None:
            parser.error("--process-persisted-candidates requires --limit.")
        if args.limit <= 0:
            parser.error("--limit must be a positive integer.")
        if args.batch_size is None:
            parser.error("--process-persisted-candidates requires --batch-size.")
        if args.batch_size <= 0:
            parser.error("--batch-size must be a positive integer.")
        return

    if args.retry_failed:
        # Fail safely BEFORE any archive processing/DB connection starts -
        # same "reject before archive processing" contract as every other
        # mode's gating in this function.
        if (
            args.validate_single_confirmed
            or args.open_single_confirmed
            or args.enable_content_inspection
            or args.persist_prefilter_only
        ):
            parser.error(
                "--retry-failed cannot be combined with --validate-single-confirmed/"
                "--open-single-confirmed/--enable-content-inspection/--persist-prefilter-only "
                "(this mode always uses local content inspection under --persist, and never under "
                "--dry-run, on its own terms)."
            )
        if args.extensions is not None:
            parser.error("--extensions only applies to --process-persisted-candidates.")
        if args.failure_category is None:
            parser.error("--retry-failed requires --failure-category.")
        if args.dry_run and args.persist:
            parser.error("--dry-run and --persist are mutually exclusive.")
        if not args.dry_run and not args.persist:
            parser.error(
                "--retry-failed requires exactly one of --dry-run or --persist "
                "(explicit write intent required)."
            )
        if args.idempotent_run and not args.persist:
            parser.error("--idempotent-run only makes sense together with --persist.")
        if args.limit is None:
            parser.error("--retry-failed requires --limit.")
        if args.limit <= 0:
            parser.error("--limit must be a positive integer.")
        if args.batch_size is None:
            parser.error("--retry-failed requires --batch-size.")
        if args.batch_size <= 0:
            parser.error("--batch-size must be a positive integer.")
        return

    assert args.pilot_limit is not None  # guaranteed by the required mutually-exclusive group

    if args.batch_size is not None or args.resume:
        parser.error(
            "--batch-size/--resume only apply to --full-corpus/--process-persisted-candidates/"
            "--retry-failed."
        )
    if args.persist_prefilter_only:
        parser.error("--persist-prefilter-only only applies to --full-corpus.")
    if args.limit is not None:
        parser.error("--limit only applies to --process-persisted-candidates/--retry-failed.")
    if args.failure_category is not None:
        parser.error("--failure-category only applies to --retry-failed.")
    if args.extensions is not None:
        parser.error("--extensions only applies to --process-persisted-candidates.")
    if args.pilot_limit <= 0:
        parser.error("--pilot-limit must be a positive integer.")
    if args.dry_run and args.persist:
        parser.error("--dry-run and --persist are mutually exclusive.")
    if not args.dry_run and not args.persist:
        parser.error("--pilot-limit requires exactly one of --dry-run or --persist (explicit write intent required).")
    if args.idempotent_run and not args.persist:
        parser.error("--idempotent-run only makes sense together with --persist.")

    if args.validate_single_confirmed:
        # Fail safely BEFORE any archive processing starts - never partially
        # run discovery then reject.
        if args.persist:
            parser.error("--validate-single-confirmed cannot be combined with --persist.")
        if args.idempotent_run:
            parser.error("--validate-single-confirmed cannot be combined with --idempotent-run.")
        if not args.dry_run:
            parser.error("--validate-single-confirmed requires --dry-run.")
        if not args.enable_content_inspection:
            parser.error("--validate-single-confirmed requires --enable-content-inspection.")

    if args.open_single_confirmed:
        # Fail safely BEFORE any archive processing starts - never partially
        # run discovery then reject.
        if args.persist:
            parser.error("--open-single-confirmed cannot be combined with --persist.")
        if args.idempotent_run:
            parser.error("--open-single-confirmed cannot be combined with --idempotent-run.")
        if not args.dry_run:
            parser.error("--open-single-confirmed requires --dry-run.")
        if not args.enable_content_inspection:
            parser.error("--open-single-confirmed requires --enable-content-inspection.")
        if not args.validate_single_confirmed:
            parser.error("--open-single-confirmed requires --validate-single-confirmed.")


def _print_summary(counters_or_counts: dict) -> None:
    # Aggregate-only by construction: every value here is a count/int/bool,
    # never a filename, path, or hash.
    print("cdc_discovery aggregate report:")
    for key, value in counters_or_counts.items():
        print(f"  {key}: {value}")


def run_summary_mode() -> int:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required.", file=sys.stderr)
        return 1

    conn = _connect(database_url)
    try:
        counts = _fetch_summary_counts(conn)
    finally:
        conn.close()

    _print_summary(counts)
    return 0


def run_single_confirmed_validation(candidates: Sequence["CdcCandidate"]) -> dict:
    """Tasks 3/4/6/8 (--validate-single-confirmed). Operates ONLY on the
    already-computed, in-memory candidates list - never re-reads the
    archive, never queries the database, never persists anything. Returns a
    flat, confidentiality-safe dict of aggregate fields only: no
    archive_file_id, no path, no filename, no project/client/country name,
    no raw extracted text. See scripts/README.md for the field shape.
    """
    confirmed = [candidate for candidate in candidates if candidate.cdc_status == "CONFIRMED_CDC"]

    if len(confirmed) == 0:
        return {"confirmed_candidates_found": 0, "validation_result": "NO_CONFIRMED_CANDIDATE"}

    if len(confirmed) > 1:
        # Never arbitrarily choose one - only the count is safe to report.
        return {"confirmed_candidates_found": len(confirmed), "validation_result": "MULTIPLE_CONFIRMED_CANDIDATES"}

    # Exactly one CONFIRMED_CDC candidate. structural_validation was
    # computed by LocalContentInspector.inspect() at the moment this
    # candidate was verified, over content already held in memory - this
    # never re-opens the file. Absent evidence (e.g. a candidate built
    # directly by a test/legacy call path) fails closed to NEEDS_HUMAN_REVIEW
    # with all flags UNKNOWN, never guessed.
    evidence = confirmed[0].structural_validation or {}
    result: dict = {
        "confirmed_candidates_found": 1,
        "validation_result": evidence.get("validation_result", "NEEDS_HUMAN_REVIEW"),
    }
    for key in (
        "explicit_cdc_role",
        "scope_requirements",
        "technical_requirements",
        "deliverables",
        "bidder_obligations",
        "evaluation_requirements",
        "administrative_requirements",
        "possible_dao",
        "possible_tdr",
        "possible_dce",
        "possible_rfp",
        "possible_offer",
    ):
        result[key] = evidence.get(key, "UNKNOWN")

    result["archive_modified"] = "NO"
    result["database_writes"] = 0
    result["confidential_text_printed"] = "NO"
    result["filename_or_path_printed"] = "NO"
    return result


# Desktop openers tried in order, fire-and-forget. Only ever reached with
# --validate-single-confirmed already having found exactly one CONFIRMED_CDC
# candidate (see run_pilot_mode) - this function never chooses a candidate
# itself and never re-validates cardinality.
_OPENER_COMMANDS: tuple[tuple[str, ...], ...] = (("xdg-open",), ("gio", "open"))


def launch_local_opener(file_path: Optional[Path]) -> dict:
    """Shared fire-and-forget local desktop opener launch (extracted so
    open_single_confirmed_document below AND scripts/cdc_review.py's
    controlled single-document review mode share one implementation).
    Never a network call, never a synchronous wait, never a filename/path
    anywhere in the return value. file_path=None (unresolvable/outside-
    root/no DB row) fails closed to INVALID_FILE_PATH without ever
    touching subprocess."""
    if file_path is None or not file_path.exists():
        return {
            "document_open_requested": "YES",
            "document_open_process_started": "NO",
            "open_failure_reason": "INVALID_FILE_PATH",
        }

    for command in _OPENER_COMMANDS:
        try:
            subprocess.Popen(
                [*command, str(file_path)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                preexec_fn=os.setsid,
            )
            return {"document_open_requested": "YES", "document_open_process_started": "YES"}
        except (FileNotFoundError, OSError):
            continue

    return {
        "document_open_requested": "YES",
        "document_open_process_started": "NO",
        "open_failure_reason": "NO_GRAPHICAL_SESSION",
    }


def open_single_confirmed_document(
    candidates: Sequence["CdcCandidate"], rows: Sequence["ArchiveFileRow"]
) -> dict:
    """--open-single-confirmed. Resolves the sole CONFIRMED_CDC candidate's
    path via the same resolve_archive_file_path() used everywhere else in
    this module (traversal-safe, root-scoped - an outside-root or
    unresolvable path comes back as None here exactly as it does anywhere
    else), then opens it via launch_local_opener(). Only ever opens a
    document when exactly one CONFIRMED_CDC candidate exists - never an
    arbitrary pick among several (mirrors run_single_confirmed_validation's
    own cardinality rule). run_pilot_mode already gates this call on
    confirmed_candidates_found == 1; this defensive re-check ensures the
    function itself can never open an arbitrary document if that invariant
    is ever violated by a future caller.
    """
    confirmed = [c for c in candidates if c.cdc_status == "CONFIRMED_CDC"]
    if len(confirmed) != 1:
        return {}

    row = next((r for r in rows if r.id == confirmed[0].archive_file_id), None)
    file_path = resolve_archive_file_path(row) if row is not None else None
    return launch_local_opener(file_path)


def run_pilot_mode(
    pilot_limit: int,
    dry_run: bool,
    persist: bool,
    idempotent_run: bool,
    enable_content_inspection: bool = False,
    validate_single_confirmed: bool = False,
    open_single_confirmed: bool = False,
) -> int:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required.", file=sys.stderr)
        return 1

    conn = _connect(database_url)
    try:
        if enable_content_inspection:
            # Lazy import: cdc_content_inspector is only required when this
            # flag is explicitly passed, so cdc_discovery.py stays fully
            # importable/usable (including --help and metadata-only runs)
            # even if that module or its runtime dependencies ever changed.
            from cdc_content_inspector import LocalContentInspector

            rows = _fetch_archive_file_rows_with_root_path(conn)
            content_inspector: Optional[ContentInspector] = LocalContentInspector()
        else:
            rows = _fetch_archive_file_rows(conn)
            content_inspector = None

        candidates, counters = run_pilot_discovery(rows, pilot_limit, content_inspector=content_inspector)

        if persist:
            repository = PostgresCandidateRepository(conn)
            with conn.transaction():
                result = persist_candidates(repository, candidates)
            if result.failed_batch:
                counters.batches_failed = 1
                print("cdc_discovery: persistence batch failed and was rolled back.", file=sys.stderr)
            else:
                # See run_full_corpus_mode's identical fix: _connect() never
                # sets autocommit=True, and the read queries earlier in this
                # function already leave the connection inside an ambient
                # transaction, so conn.transaction() above only opens a
                # SAVEPOINT - it never durably commits on its own. Without
                # this explicit commit (and without treating ITS failure as
                # a failed batch too), rows could be reported as
                # successfully persisted while conn.close() silently
                # discards them.
                try:
                    conn.commit()
                except Exception:
                    counters.batches_failed = 1
                    print(
                        "cdc_discovery: commit failed after persistence - rows were not durably written.",
                        file=sys.stderr,
                    )
                else:
                    counters.rows_inserted = result.inserted
                    counters.rows_updated = result.updated
        # dry_run: zero writes, candidates were only computed in memory.
    finally:
        conn.close()

    summary = counters.as_dict()
    summary["dry_run"] = dry_run
    summary["persist"] = persist
    summary["idempotent_run"] = idempotent_run
    summary["enable_content_inspection"] = enable_content_inspection
    if validate_single_confirmed:
        # Existing counters/keys above are untouched - this only appends
        # new, additional safe fields (Task 9: non-validation-mode behavior
        # is unaffected since this whole block is skipped when the flag is
        # off).
        validation_summary = run_single_confirmed_validation(candidates)
        summary.update(validation_summary)

        if open_single_confirmed and validation_summary.get("confirmed_candidates_found") == 1:
            summary.update(open_single_confirmed_document(candidates, rows))

    _print_summary(summary)

    return 1 if counters.batches_failed else 0


def run_full_corpus_mode(
    dry_run: bool,
    persist: bool,
    idempotent_run: bool,
    batch_size: int,
    resume: bool,
    checkpoint_file: str,
    enable_content_inspection: bool = False,
    persist_prefilter_only: bool = False,
) -> int:
    """Task 8/9. Derives the FULL document-bearing project set from the
    archive cartography itself (enumerate_project_folders over every
    fetched row) - never a hardcoded 411 - splits it into deterministic
    batches, and processes one batch at a time, checkpointing safe
    aggregate progress (never a filename/path/project name) to a local
    JSON file after every batch so a multi-hour run can be safely
    interrupted and resumed rather than restarted from scratch (Task 9).

    persist_prefilter_only (--persist-prefilter-only) swaps the per-batch
    discovery call for run_prefilter_only_discovery_for_projects, which
    never returns a candidate for a row that does not match the Stage A
    metadata prefilter - so --persist under this mode can only ever insert
    or update prefilter-candidate rows, never all archive_files rows.
    Mutually exclusive with enable_content_inspection (enforced by
    _validate_args before this function is ever called)."""
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required.", file=sys.stderr)
        return 1

    checkpoint_path = Path(checkpoint_file)

    conn = _connect(database_url)
    try:
        if enable_content_inspection:
            # Lazy import - see run_pilot_mode's identical comment.
            from cdc_content_inspector import LocalContentInspector

            rows = _fetch_archive_file_rows_with_root_path(conn)
            content_inspector: Optional[ContentInspector] = LocalContentInspector()
        else:
            rows = _fetch_archive_file_rows(conn)
            content_inspector = None

        technical_categories = _fetch_technical_categories(conn)

        project_folders = enumerate_project_folders(rows)
        batches = split_into_batches(project_folders, batch_size)
        scope_config = build_full_corpus_scope_config(
            project_folders, batch_size, enable_content_inspection,
            persist_prefilter_only=persist_prefilter_only,
        )
        scope_signature = compute_batch_scope_signature(project_folders, scope_config)

        existing_checkpoint = load_checkpoint(checkpoint_path)

        if existing_checkpoint is not None and existing_checkpoint.scope_signature == scope_signature:
            if not resume:
                print(
                    "cdc_discovery: an incomplete checkpoint already exists for this exact scope "
                    "(same document-bearing project set, --batch-size, --enable-content-inspection, "
                    "and classifier version). Pass --resume to continue it, or remove "
                    f"{checkpoint_path} explicitly to start a fresh run.",
                    file=sys.stderr,
                )
                return 1
            checkpoint = existing_checkpoint
        elif existing_checkpoint is not None and resume:
            # A checkpoint exists but for a DIFFERENT scope (project set,
            # --batch-size, --enable-content-inspection, or classifier
            # version changed) - never silently discard/overwrite it under
            # --resume, and never silently treat a metadata-only checkpoint
            # as a completed content-inspection run (Task 8). That could
            # throw away real completed work or, worse, make an incomplete
            # content-inspection run look finished.
            print(
                "cdc_discovery: --resume was passed but the existing checkpoint does not match "
                "the current scope. Refusing to overwrite it - remove "
                f"{checkpoint_path} explicitly to start fresh. Mismatch: "
                f"{describe_scope_mismatch(existing_checkpoint.config, scope_config)}",
                file=sys.stderr,
            )
            return 1
        else:
            checkpoint = Checkpoint(
                scope_signature=scope_signature, batch_size=batch_size, total_batches=len(batches),
                config=scope_config,
            )

        repository = PostgresTechnicalSourceCandidateRepository(conn) if persist else None

        for batch_index, batch_folders in enumerate(batches):
            if batch_index in checkpoint.completed_batches:
                continue  # Task 9: never redo an already-completed batch on resume.

            try:
                if persist_prefilter_only:
                    candidates, batch_counters = run_prefilter_only_discovery_for_projects(
                        rows, batch_folders, technical_categories=technical_categories,
                    )
                else:
                    candidates, batch_counters = run_technical_source_discovery_for_projects(
                        rows, batch_folders, content_inspector=content_inspector,
                        technical_categories=technical_categories,
                    )
                if persist:
                    with conn.transaction():
                        result = persist_technical_source_candidates(repository, candidates)
                    if result.failed_batch:
                        raise RuntimeError("persistence batch failed and was rolled back")
                    # _connect() never sets autocommit=True, and the read
                    # queries earlier in this function already leave the
                    # connection inside an ambient transaction - conn.transaction()
                    # above therefore only opens a SAVEPOINT, not a true
                    # top-level transaction, and never durably commits on its
                    # own. Without this explicit commit, every batch's writes
                    # are silently discarded when conn.close() runs in the
                    # finally block below, while still reporting a successful
                    # rows_inserted/rows_updated count - verified empirically
                    # against a real database, not assumed.
                    conn.commit()
                    batch_counters.rows_inserted = result.inserted
                    batch_counters.rows_updated = result.updated
                batch_counters.batches_completed = 1
                checkpoint.completed_batches.append(batch_index)
                checkpoint.failed_batches = [b for b in checkpoint.failed_batches if b != batch_index]
            except Exception:
                # Batch-level isolation (Task 9: "failed batches recorded
                # safely") - one bad batch never aborts the whole run or
                # loses progress already checkpointed for prior batches.
                batch_counters = FullCorpusCounters()
                batch_counters.batches_failed = 1
                if batch_index not in checkpoint.failed_batches:
                    checkpoint.failed_batches.append(batch_index)

            checkpoint.aggregate = merge_counters_into_aggregate(checkpoint.aggregate, batch_counters)
            save_checkpoint(checkpoint_path, checkpoint)
    finally:
        conn.close()

    summary = dict(checkpoint.aggregate)
    summary["dry_run"] = dry_run
    summary["persist"] = persist
    summary["idempotent_run"] = idempotent_run
    summary["enable_content_inspection"] = enable_content_inspection
    summary["persist_prefilter_only"] = persist_prefilter_only
    summary["batches_total"] = len(batches)
    _print_summary(summary)

    return 1 if checkpoint.failed_batches else 0


# =====================================================================
# --process-persisted-candidates: the controlled content-processing pilot
# over the ALREADY-PERSISTED metadata prefilter queue
# (knowledge_base.historical_technical_source_candidates) - never a fresh
# filesystem/project-folder scan, never the old experimental
# 433-project/2187-document corpus, never the obsolete aggregate-only
# full-corpus checkpoint used as a document queue.
# =====================================================================

PROCESS_PERSISTED_EXTRACTION_STATUS_FILTER = "NOT_ATTEMPTED"
PROCESS_PERSISTED_VALIDATION_STATUS_FILTER = "MACHINE_CLASSIFIED"
PROCESS_PERSISTED_ORDER_BY = "archive_file_id ASC"
DEFAULT_PROCESS_PERSISTED_CHECKPOINT_PATH = "scripts/.cdc_process_persisted_checkpoint.json"


def normalize_extensions_filter(extensions: Optional[Sequence[str]]) -> Optional[tuple[str, ...]]:
    """Normalizes an --extensions filter to a sorted, deduplicated tuple of
    lowercase extensions (never case-sensitive - "PDF"/"Pdf"/"pdf" must all
    mean the same thing, both at the SQL level and in the checkpoint scope
    signature). None/empty means "no extension filter" (every extension is
    eligible), preserving --process-persisted-candidates' original,
    unfiltered behavior exactly when --extensions is not passed."""
    if not extensions:
        return None
    normalized = sorted({ext.strip().lower() for ext in extensions if ext.strip()})
    return tuple(normalized) if normalized else None


def _count_persisted_prefilter_candidates(conn, extensions: Optional[Sequence[str]] = None) -> int:
    """Aggregate-only: how many persisted rows currently match the exact
    Phase 2 selection filter (plus the optional --extensions filter),
    before --limit is applied."""
    normalized = normalize_extensions_filter(extensions)
    with conn.cursor() as cur:
        if normalized:
            cur.execute(
                """
                select count(*)
                from knowledge_base.historical_technical_source_candidates c
                join knowledge_base.archive_files f on f.id = c.archive_file_id
                where c.extraction_status = %s and c.validation_status = %s
                  and lower(f.extension) = any(%s)
                """,
                (PROCESS_PERSISTED_EXTRACTION_STATUS_FILTER, PROCESS_PERSISTED_VALIDATION_STATUS_FILTER, list(normalized)),
            )
        else:
            cur.execute(
                """
                select count(*)
                from knowledge_base.historical_technical_source_candidates
                where extraction_status = %s and validation_status = %s
                """,
                (PROCESS_PERSISTED_EXTRACTION_STATUS_FILTER, PROCESS_PERSISTED_VALIDATION_STATUS_FILTER),
            )
        return cur.fetchone()[0]


def _fetch_persisted_prefilter_candidate_rows(
    conn, limit: int, extensions: Optional[Sequence[str]] = None
) -> List["ArchiveFileRow"]:
    """Selects up to `limit` rows from the persisted metadata prefilter
    queue only: extraction_status=NOT_ATTEMPTED (content inspection not
    yet run) and validation_status=MACHINE_CLASSIFIED (never a
    human-reviewed row - a human decision is never silently reprocessed),
    optionally further restricted to a case-insensitive --extensions
    allowlist (e.g. pdf,docx never selects a legacy .doc row). Joins to
    archive_files/archive_source_roots via archive_file_id only. Ordered
    deterministically by archive_file_id ASC so the same --limit/
    --extensions always selects the same documents (Phase 3
    reproducibility)."""
    normalized = normalize_extensions_filter(extensions)
    with conn.cursor() as cur:
        if normalized:
            cur.execute(
                """
                select f.id, f.relative_path, f.filename, f.extension, f.sha256, r.label, r.root_path
                from knowledge_base.historical_technical_source_candidates c
                join knowledge_base.archive_files f on f.id = c.archive_file_id
                join knowledge_base.archive_source_roots r on r.id = f.source_root_id
                where c.extraction_status = %s and c.validation_status = %s
                  and lower(f.extension) = any(%s)
                order by c.archive_file_id asc
                limit %s
                """,
                (
                    PROCESS_PERSISTED_EXTRACTION_STATUS_FILTER, PROCESS_PERSISTED_VALIDATION_STATUS_FILTER,
                    list(normalized), limit,
                ),
            )
        else:
            cur.execute(
                """
                select f.id, f.relative_path, f.filename, f.extension, f.sha256, r.label, r.root_path
                from knowledge_base.historical_technical_source_candidates c
                join knowledge_base.archive_files f on f.id = c.archive_file_id
                join knowledge_base.archive_source_roots r on r.id = f.source_root_id
                where c.extraction_status = %s and c.validation_status = %s
                order by c.archive_file_id asc
                limit %s
                """,
                (PROCESS_PERSISTED_EXTRACTION_STATUS_FILTER, PROCESS_PERSISTED_VALIDATION_STATUS_FILTER, limit),
            )
        return [
            ArchiveFileRow(
                id=r[0], relative_path=r[1], filename=r[2], extension=r[3], sha256=r[4],
                source_root_label=r[5], source_root_path=r[6],
            )
            for r in cur.fetchall()
        ]


def _archive_source_root_identity(rows: Sequence["ArchiveFileRow"]) -> str:
    """A non-confidential fingerprint of which archive source root(s) this
    run is scoped to - the root LABEL only, never the raw mount path."""
    labels = sorted({row.source_root_label or "" for row in rows})
    return hashlib.sha256("|".join(labels).encode("utf-8")).hexdigest()[:16]


def build_process_persisted_scope_config(
    limit: int,
    batch_size: int,
    archive_source_root_identity: str,
    extensions: Optional[Sequence[str]] = None,
) -> dict:
    """The full set of configuration DIMENSIONS a --process-persisted-candidates
    checkpoint must be scoped to (Phase 3): selection filters, ordering,
    limit, batch size, classifier version, extraction configuration
    version, archive source-root identity, extensions filter, and
    content-inspection/local-AI enablement. content_inspection_enabled is
    always True and local_ai_enabled is always False for this mode today -
    both are still recorded explicitly so a future change that enables
    local AI can never be silently treated as compatible with an existing
    checkpoint. extensions_filter is None (never an empty list/tuple) when
    --extensions was not passed, so "no filter" and "filtered to an empty
    set" can never collide into the same recorded value; a checkpoint
    created with a different --extensions value (including no filter at
    all) always changes this dict, and therefore always changes the scope
    signature computed from it - the same fail-closed guarantee every
    other dimension here already has."""
    return {
        "mode": "process_persisted_candidates",
        "selection_mode": "persisted_prefilter_queue",
        "extraction_status_filter": PROCESS_PERSISTED_EXTRACTION_STATUS_FILTER,
        "validation_status_filter": PROCESS_PERSISTED_VALIDATION_STATUS_FILTER,
        "extensions_filter": list(normalize_extensions_filter(extensions) or ()) or None,
        "order_by": PROCESS_PERSISTED_ORDER_BY,
        "limit": limit,
        "batch_size": batch_size,
        "classifier_version": TECHNICAL_SOURCE_CLASSIFIER_VERSION,
        "extraction_config_version": PROCESS_PERSISTED_EXTRACTION_CONFIG_VERSION,
        "archive_source_root_identity": archive_source_root_identity,
        "content_inspection_enabled": True,
        "local_ai_enabled": False,
    }


def compute_process_persisted_scope_signature(selected_archive_file_ids: Sequence[int], config: dict) -> str:
    """Same "never hash identifying values directly, only IDs" pattern as
    compute_batch_scope_signature - archive_file_id is a safe, opaque
    integer, never a filename/path."""
    payload = ",".join(str(i) for i in sorted(selected_archive_file_ids)) + "::" + json.dumps(config, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def run_persisted_candidate_content_processing(
    rows: Sequence["ArchiveFileRow"],
    content_inspector: "ContentInspector",
) -> tuple[List[TechnicalSourceCandidate], FullCorpusCounters]:
    """Phase 4 controlled pilot: Stage B content inspection + deterministic
    structural classification over an EXPLICIT, already-selected list of
    persisted prefilter candidates. No Stage A prefilter is re-applied
    here - every row passed in already matched it when first persisted -
    so every row is inspected. Reuses build_technical_source_candidate
    unchanged - never invents a role/score itself, and never calls Ollama
    (content_inspector is expected to be a LocalContentInspector()
    constructed with no ai_adapter)."""
    counters = FullCorpusCounters()
    counters.files_metadata_inspected = len(rows)
    counters.prefilter_candidates = len(rows)  # already-confirmed prefilter candidates by construction

    duplicate_groups, duplicate_files = count_duplicate_groups_and_files(rows)
    counters.duplicate_groups = duplicate_groups
    counters.duplicate_files = duplicate_files
    duplicate_assignments = assign_duplicate_relationships(rows)

    candidates: List[TechnicalSourceCandidate] = []
    outcome_cache_by_sha256: dict = {}
    for row in rows:
        cached_outcome = outcome_cache_by_sha256.get(row.sha256) if row.sha256 else None
        if cached_outcome is not None:
            content_outcome = cached_outcome
            counters.duplicate_extractions_avoided += 1
        else:
            file_path = resolve_archive_file_path(row)
            content_outcome = content_inspector.inspect(row.id, row.extension, counters.extraction, file_path=file_path)
            if row.sha256:
                outcome_cache_by_sha256[row.sha256] = content_outcome
            if (row.extension or "").strip().lower() == "docx" and content_outcome.attempted:
                if content_outcome.failed:
                    counters.docx_extraction_failures += 1
                else:
                    counters.docx_extraction_successes += 1

        candidate = build_technical_source_candidate(row, content_outcome, duplicate_assignments[row.id])
        counters.tally_role(candidate.detected_role)
        counters.tally_band(candidate.structural_band)
        counters.tally_priority(candidate.review_priority)
        candidates.append(candidate)

    counters.extraction.assert_no_external_calls()
    return candidates, counters


def run_process_persisted_candidates_mode(
    limit: int,
    batch_size: int,
    dry_run: bool,
    persist: bool,
    resume: bool,
    checkpoint_file: str,
    extensions: Optional[Sequence[str]] = None,
) -> int:
    """Phase 2/4/5/6 controlled pilot. --dry-run performs SELECTION AND
    CONFIGURATION VALIDATION ONLY: it never calls resolve_archive_file_path,
    never constructs a ContentInspector, and never touches the checkpoint
    file - it cannot open a document even if content inspection code
    changes later, because this function's dry-run branch never reaches
    that code path at all. --persist is the only branch that performs real
    local content extraction (Docling for PDF, stdlib XML for DOCX,
    LibreOffice for DOC - never Ollama, never any external call) and the
    only branch that ever writes to the database, batched and checkpointed
    exactly like run_full_corpus_mode, including the same explicit
    conn.commit() per batch (a batch is never reported as persisted before
    its commit succeeds, and a commit failure is a failed batch).

    extensions (--extensions pdf,docx) restricts BOTH the aggregate
    "available" count and the actual selection to a case-insensitive
    extension allowlist, applied directly in the SQL WHERE clause (never
    filtered in Python after a full fetch) - e.g. --extensions pdf,docx
    can never select a legacy .doc row. None (the default) means no
    filter, preserving the original unfiltered behavior exactly."""
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required.", file=sys.stderr)
        return 1

    checkpoint_path = Path(checkpoint_file)
    normalized_extensions = normalize_extensions_filter(extensions)

    conn = _connect(database_url)
    try:
        available = _count_persisted_prefilter_candidates(conn, extensions=normalized_extensions)
        rows = _fetch_persisted_prefilter_candidate_rows(conn, limit, extensions=normalized_extensions)
        selected = len(rows)

        selection_filters = (
            f"extraction_status={PROCESS_PERSISTED_EXTRACTION_STATUS_FILTER},"
            f"validation_status={PROCESS_PERSISTED_VALIDATION_STATUS_FILTER}"
            + (f",extensions={','.join(normalized_extensions)}" if normalized_extensions else "")
        )

        if dry_run:
            # Deliberately stops here - no checkpoint file is read or
            # written, no file path is ever resolved, no ContentInspector
            # of any kind is ever constructed.
            summary = {
                "persisted_candidates_available": available,
                "candidates_selected": selected,
                "selection_filters": selection_filters,
                "ordering_rule": PROCESS_PERSISTED_ORDER_BY,
                "content_extraction_calls": 0,
                "docling_calls": 0,
                "libreoffice_calls": 0,
                "ocr_calls": 0,
                "ollama_calls": 0,
                "external_calls": 0,
                "database_inserts": 0,
                "database_updates": 0,
                "human_decisions_modified": 0,
                "limit": limit,
                "batch_size": batch_size,
                "batches_total": len(range(0, selected, batch_size)) if selected else 0,
                "dry_run": True,
                "persist": False,
            }
            _print_summary(summary)
            return 0

        root_identity = _archive_source_root_identity(rows)
        scope_config = build_process_persisted_scope_config(
            limit, batch_size, root_identity, extensions=normalized_extensions
        )
        scope_signature = compute_process_persisted_scope_signature([row.id for row in rows], scope_config)
        batches = [rows[i:i + batch_size] for i in range(0, len(rows), batch_size)]

        existing_checkpoint = load_checkpoint(checkpoint_path)
        if existing_checkpoint is not None and existing_checkpoint.scope_signature == scope_signature:
            if not resume:
                print(
                    "cdc_discovery: an incomplete checkpoint already exists for this exact scope "
                    "(same selected candidate set, --limit, --batch-size, and classifier/extraction "
                    "config version). Pass --resume to continue it, or remove "
                    f"{checkpoint_path} explicitly to start a fresh run.",
                    file=sys.stderr,
                )
                return 1
            checkpoint = existing_checkpoint
        elif existing_checkpoint is not None and resume:
            print(
                "cdc_discovery: --resume was passed but the existing checkpoint does not match "
                "the current scope. Refusing to overwrite it - remove "
                f"{checkpoint_path} explicitly to start fresh. Mismatch: "
                f"{describe_scope_mismatch(existing_checkpoint.config, scope_config)}",
                file=sys.stderr,
            )
            return 1
        else:
            checkpoint = Checkpoint(
                scope_signature=scope_signature, batch_size=batch_size, total_batches=len(batches),
                config=scope_config,
            )

        # LocalContentInspector() with no ai_adapter - deterministic
        # structural classification only, Ollama is never invoked in this
        # pilot (Phase 4: "Do not enable Ollama yet").
        from cdc_content_inspector import LocalContentInspector

        content_inspector: ContentInspector = LocalContentInspector()
        repository = PostgresTechnicalSourceCandidateRepository(conn)

        for batch_index, batch_rows in enumerate(batches):
            if batch_index in checkpoint.completed_batches:
                continue

            try:
                candidates, batch_counters = run_persisted_candidate_content_processing(
                    batch_rows, content_inspector,
                )
                with conn.transaction():
                    result = persist_technical_source_candidates(repository, candidates)
                if result.failed_batch:
                    raise RuntimeError("persistence batch failed and was rolled back")
                # See run_full_corpus_mode's identical fix - conn.transaction()
                # alone never durably commits here; an explicit commit (and
                # treating its failure as a failed batch) is required.
                conn.commit()
                batch_counters.rows_inserted = result.inserted
                batch_counters.rows_updated = result.updated
                batch_counters.batches_completed = 1
                checkpoint.completed_batches.append(batch_index)
                checkpoint.failed_batches = [b for b in checkpoint.failed_batches if b != batch_index]
            except Exception:
                batch_counters = FullCorpusCounters()
                batch_counters.batches_failed = 1
                if batch_index not in checkpoint.failed_batches:
                    checkpoint.failed_batches.append(batch_index)

            checkpoint.aggregate = merge_counters_into_aggregate(checkpoint.aggregate, batch_counters)
            save_checkpoint(checkpoint_path, checkpoint)
    finally:
        conn.close()

    summary = dict(checkpoint.aggregate)
    summary["persisted_candidates_available"] = available
    summary["candidates_selected"] = selected
    summary["selection_filters"] = selection_filters
    summary["ordering_rule"] = PROCESS_PERSISTED_ORDER_BY
    summary["docling_calls"] = summary.get("pdf_extraction_calls", 0)
    summary["libreoffice_calls"] = summary.get("doc_extraction_calls", 0)
    summary["ollama_calls"] = summary.get("local_ai_calls", 0)
    summary["content_extraction_calls"] = (
        summary.get("pdf_extraction_calls", 0)
        + summary.get("docx_extraction_calls", 0)
        + summary.get("doc_extraction_calls", 0)
    )
    summary["database_inserts"] = summary.get("rows_inserted", 0)
    summary["database_updates"] = summary.get("rows_updated", 0)
    summary["human_decisions_modified"] = 0  # structurally impossible: upsert() never touches validation_status/reviewed_at/reviewed_by
    summary["limit"] = limit
    summary["batch_size"] = batch_size
    summary["batches_total"] = len(batches)
    summary["dry_run"] = dry_run
    summary["persist"] = persist
    _print_summary(summary)

    return 1 if checkpoint.failed_batches else 0


# =====================================================================
# --retry-failed: a SEPARATE, explicit retry mode over previously-FAILED
# persisted candidates only - never NOT_ATTEMPTED, never SUCCESS. Exists
# because --process-persisted-candidates' selection filter
# (extraction_status=NOT_ATTEMPTED) structurally cannot select a FAILED
# row at all; this is a deliberately distinct mode/checkpoint scope, not a
# flag bolted onto that one, so the two can never be silently confused.
# =====================================================================

DEFAULT_RETRY_FAILED_CHECKPOINT_PATH = "scripts/.cdc_retry_failed_checkpoint.json"


def _count_failed_candidates_by_category(conn, failure_category: str) -> int:
    """Aggregate-only: how many persisted rows currently match FAILED +
    the given extraction_failure_category, before --limit is applied."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select count(*)
            from knowledge_base.historical_technical_source_candidates
            where extraction_status = 'FAILED' and extraction_failure_category = %s
            """,
            (failure_category,),
        )
        return cur.fetchone()[0]


def _fetch_failed_candidate_rows(conn, failure_category: str, limit: int) -> List["ArchiveFileRow"]:
    """Selects up to `limit` rows that are currently FAILED with exactly
    the given extraction_failure_category - never NOT_ATTEMPTED (nothing
    unattempted is ever pulled into a retry), never SUCCESS (a successful
    candidate is never reprocessed by this mode). Ordered deterministically
    by archive_file_id ASC, same reproducibility guarantee as
    --process-persisted-candidates."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select f.id, f.relative_path, f.filename, f.extension, f.sha256, r.label, r.root_path
            from knowledge_base.historical_technical_source_candidates c
            join knowledge_base.archive_files f on f.id = c.archive_file_id
            join knowledge_base.archive_source_roots r on r.id = f.source_root_id
            where c.extraction_status = 'FAILED' and c.extraction_failure_category = %s
            order by c.archive_file_id asc
            limit %s
            """,
            (failure_category, limit),
        )
        return [
            ArchiveFileRow(
                id=r[0], relative_path=r[1], filename=r[2], extension=r[3], sha256=r[4],
                source_root_label=r[5], source_root_path=r[6],
            )
            for r in cur.fetchall()
        ]


def build_retry_failed_scope_config(
    limit: int, batch_size: int, failure_category: str, archive_source_root_identity: str
) -> dict:
    """A SEPARATE scope-config shape from build_process_persisted_scope_config
    (different "mode" value, plus failure_category_filter instead of
    extraction_status_filter/validation_status_filter) - even selecting the
    exact same archive_file_id set, a retry-failed checkpoint and a
    process-persisted-candidates checkpoint must never be treated as
    compatible with each other (Phase 3/6's "separate checkpoint
    signature" requirement)."""
    return {
        "mode": "retry_failed",
        "selection_mode": "failed_candidate_retry_queue",
        "extraction_status_filter": "FAILED",
        "failure_category_filter": failure_category,
        "order_by": PROCESS_PERSISTED_ORDER_BY,
        "limit": limit,
        "batch_size": batch_size,
        "classifier_version": TECHNICAL_SOURCE_CLASSIFIER_VERSION,
        "extraction_config_version": PROCESS_PERSISTED_EXTRACTION_CONFIG_VERSION,
        "archive_source_root_identity": archive_source_root_identity,
        "content_inspection_enabled": True,
        "local_ai_enabled": False,
    }


def run_retry_failed_candidates_mode(
    failure_category: str,
    limit: int,
    batch_size: int,
    dry_run: bool,
    persist: bool,
    resume: bool,
    checkpoint_file: str,
) -> int:
    """Phase 6/7 safe retry mode. Reuses
    run_persisted_candidate_content_processing (the same Stage B content-
    inspection + deterministic-classification step
    --process-persisted-candidates uses) and the same
    PostgresTechnicalSourceCandidateRepository.upsert() - which never
    references validation_status/reviewed_at/reviewed_by, so a retry can
    never overwrite a human decision. A row's PREVIOUS failure record is
    only ever replaced by a FRESH outcome (a new SUCCESS, or a new FAILED
    with its own extraction_failure_category) - it is never blanked
    without one, because upsert() always writes a complete, freshly
    computed set of machine columns together. --dry-run performs selection
    and configuration validation ONLY: it never resolves a file path,
    never constructs a ContentInspector, and never touches the checkpoint
    file, exactly like --process-persisted-candidates' --dry-run."""
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required.", file=sys.stderr)
        return 1

    checkpoint_path = Path(checkpoint_file)

    conn = _connect(database_url)
    try:
        available = _count_failed_candidates_by_category(conn, failure_category)
        rows = _fetch_failed_candidate_rows(conn, failure_category, limit)
        selected = len(rows)

        selection_filter = f"FAILED + {failure_category}"

        if dry_run:
            summary = {
                "failed_candidates_available": available,
                "candidates_selected": selected,
                "selection_filter": selection_filter,
                "ordering_rule": PROCESS_PERSISTED_ORDER_BY,
                "content_extraction_calls": 0,
                "docling_calls": 0,
                "libreoffice_calls": 0,
                "ocr_calls": 0,
                "ollama_calls": 0,
                "external_calls": 0,
                "database_inserts": 0,
                "database_updates": 0,
                "human_decisions_modified": 0,
                "limit": limit,
                "batch_size": batch_size,
                "batches_total": len(range(0, selected, batch_size)) if selected else 0,
                "dry_run": True,
                "persist": False,
            }
            _print_summary(summary)
            return 0

        root_identity = _archive_source_root_identity(rows)
        scope_config = build_retry_failed_scope_config(limit, batch_size, failure_category, root_identity)
        scope_signature = compute_process_persisted_scope_signature([row.id for row in rows], scope_config)
        batches = [rows[i:i + batch_size] for i in range(0, len(rows), batch_size)]

        existing_checkpoint = load_checkpoint(checkpoint_path)
        if existing_checkpoint is not None and existing_checkpoint.scope_signature == scope_signature:
            if not resume:
                print(
                    "cdc_discovery: an incomplete checkpoint already exists for this exact retry scope "
                    "(same selected candidate set, --failure-category, --limit, --batch-size, and "
                    "classifier/extraction config version). Pass --resume to continue it, or remove "
                    f"{checkpoint_path} explicitly to start a fresh run.",
                    file=sys.stderr,
                )
                return 1
            checkpoint = existing_checkpoint
        elif existing_checkpoint is not None and resume:
            print(
                "cdc_discovery: --resume was passed but the existing checkpoint does not match "
                "the current retry scope. Refusing to overwrite it - remove "
                f"{checkpoint_path} explicitly to start fresh. Mismatch: "
                f"{describe_scope_mismatch(existing_checkpoint.config, scope_config)}",
                file=sys.stderr,
            )
            return 1
        else:
            checkpoint = Checkpoint(
                scope_signature=scope_signature, batch_size=batch_size, total_batches=len(batches),
                config=scope_config,
            )

        from cdc_content_inspector import LocalContentInspector

        content_inspector: ContentInspector = LocalContentInspector()
        repository = PostgresTechnicalSourceCandidateRepository(conn)

        for batch_index, batch_rows in enumerate(batches):
            if batch_index in checkpoint.completed_batches:
                continue

            try:
                candidates, batch_counters = run_persisted_candidate_content_processing(
                    batch_rows, content_inspector,
                )
                with conn.transaction():
                    result = persist_technical_source_candidates(repository, candidates)
                if result.failed_batch:
                    raise RuntimeError("persistence batch failed and was rolled back")
                conn.commit()
                batch_counters.rows_inserted = result.inserted
                batch_counters.rows_updated = result.updated
                batch_counters.batches_completed = 1
                checkpoint.completed_batches.append(batch_index)
                checkpoint.failed_batches = [b for b in checkpoint.failed_batches if b != batch_index]
            except Exception:
                batch_counters = FullCorpusCounters()
                batch_counters.batches_failed = 1
                if batch_index not in checkpoint.failed_batches:
                    checkpoint.failed_batches.append(batch_index)

            checkpoint.aggregate = merge_counters_into_aggregate(checkpoint.aggregate, batch_counters)
            save_checkpoint(checkpoint_path, checkpoint)
    finally:
        conn.close()

    summary = dict(checkpoint.aggregate)
    summary["failed_candidates_available"] = available
    summary["candidates_selected"] = selected
    summary["selection_filter"] = selection_filter
    summary["ordering_rule"] = PROCESS_PERSISTED_ORDER_BY
    summary["docling_calls"] = summary.get("pdf_extraction_calls", 0)
    summary["libreoffice_calls"] = summary.get("doc_extraction_calls", 0)
    summary["ollama_calls"] = summary.get("local_ai_calls", 0)
    summary["content_extraction_calls"] = (
        summary.get("pdf_extraction_calls", 0)
        + summary.get("docx_extraction_calls", 0)
        + summary.get("doc_extraction_calls", 0)
    )
    summary["database_inserts"] = summary.get("rows_inserted", 0)
    summary["database_updates"] = summary.get("rows_updated", 0)
    summary["human_decisions_modified"] = 0  # structurally impossible: upsert() never touches validation_status/reviewed_at/reviewed_by
    summary["limit"] = limit
    summary["batch_size"] = batch_size
    summary["batches_total"] = len(batches)
    summary["dry_run"] = dry_run
    summary["persist"] = persist
    _print_summary(summary)

    return 1 if checkpoint.failed_batches else 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)  # --help / -h exits here, before any discovery code runs
    _validate_args(parser, args)

    if args.summary:
        return run_summary_mode()

    if args.full_corpus:
        return run_full_corpus_mode(
            dry_run=args.dry_run,
            persist=args.persist,
            idempotent_run=args.idempotent_run,
            batch_size=args.batch_size,
            resume=args.resume,
            checkpoint_file=args.checkpoint_file or DEFAULT_CHECKPOINT_PATH,
            enable_content_inspection=args.enable_content_inspection,
            persist_prefilter_only=args.persist_prefilter_only,
        )

    if args.process_persisted_candidates:
        return run_process_persisted_candidates_mode(
            limit=args.limit,
            batch_size=args.batch_size,
            dry_run=args.dry_run,
            persist=args.persist,
            resume=args.resume,
            checkpoint_file=args.checkpoint_file or DEFAULT_PROCESS_PERSISTED_CHECKPOINT_PATH,
            extensions=args.extensions.split(",") if args.extensions else None,
        )

    if args.retry_failed:
        return run_retry_failed_candidates_mode(
            failure_category=args.failure_category,
            limit=args.limit,
            batch_size=args.batch_size,
            dry_run=args.dry_run,
            persist=args.persist,
            resume=args.resume,
            checkpoint_file=args.checkpoint_file or DEFAULT_RETRY_FAILED_CHECKPOINT_PATH,
        )

    return run_pilot_mode(
        pilot_limit=args.pilot_limit,
        dry_run=args.dry_run,
        persist=args.persist,
        idempotent_run=args.idempotent_run,
        enable_content_inspection=args.enable_content_inspection,
        validate_single_confirmed=args.validate_single_confirmed,
        open_single_confirmed=args.open_single_confirmed,
    )


if __name__ == "__main__":
    raise SystemExit(main())
