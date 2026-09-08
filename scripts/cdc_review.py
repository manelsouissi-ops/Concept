#!/usr/bin/env python3
"""Local, confidentiality-safe REVIEW workflow for the historical
technical-source/CDC candidate table (Phase 6).

This is deliberately a SEPARATE CLI/entry point from scripts/cdc_discovery.py:
discovery (finding and classifying candidates across the archive) and
review (a human deciding whether a MACHINE classification is actually
correct) are different lifecycle phases with different safety properties -
discovery may run for hours over the whole corpus, review is always exactly
one deliberate action at a time. Every function here reuses (never
duplicates) scripts/cdc_discovery.py's existing, already-tested primitives:
_connect, resolve_archive_file_path, launch_local_opener,
TechnicalSourceCandidateRepository, TECHNICAL_SOURCE_VALIDATION_STATUSES,
HUMAN_SETTABLE_VALIDATION_STATUSES.

CRITICAL FRAMING: "12 CDC" (or any detected_role/structural_band/
review_priority count) is a MACHINE classification, never a human
validation. Nothing in this module ever upgrades a candidate's
validation_status - --review-open is strictly read-only (it only launches
a local viewer), and --review-mark is the ONLY path that can set a
HUMAN_* status, and only because a human explicitly ran that exact command
with an explicit --archive-file-id and --validation-status.

Three modes, all requiring knowledge_base.historical_technical_source_candidates
to already exist (scripts/sql/create_historical_technical_source_candidates_table.sql)
and be populated (a prior `cdc_discovery.py --full-corpus --persist` run) -
neither is done by this development task:

  --review-summary                                    aggregate-only counts
  --review-open   --archive-file-id N                  open exactly one candidate locally
  --review-mark   --archive-file-id N --validation-status X   record a human decision

SAFETY GUARANTEES
- Never prints a filename, absolute path, client/project/country/agency
  name, or extracted document text. --review-summary is COUNT-only SQL.
  --review-open's only identifying input is a database-generated integer
  (archive_file_id) the developer already has from --review-summary or
  direct DB inspection - never a name typed by this module.
- --review-open opens AT MOST one document, and only when its
  archive_file_id resolves to exactly one existing row - no bulk opening,
  no iteration over multiple candidates.
- No cloud AI, no external HTTP call, anywhere in this module.
- No archive modification: the opener launches a local desktop viewer
  read-only; nothing in this module ever writes to a file under the
  archive mount.
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Optional

from cdc_discovery import (
    HUMAN_SETTABLE_VALIDATION_STATUSES,
    TECHNICAL_SOURCE_ROLES,
    TECHNICAL_SOURCE_VALIDATION_STATUSES,
    PostgresTechnicalSourceCandidateRepository,
    _connect,
    launch_local_opener,
    resolve_archive_file_path,
)
from technical_source_classifier import EXTRACTION_FAILURE_CATEGORIES

# scripts/technical_source_classifier.STRUCTURAL_BANDS mirrored here as a
# plain tuple (not imported) since only its literal values are needed for
# the GROUP BY result-shaping below, avoiding a second import path for one
# tuple already re-exported elsewhere.
_STRUCTURAL_BANDS = ("STRONG_TECHNICAL_SOURCE", "POSSIBLE_TECHNICAL_SOURCE", "WEAK_TECHNICAL_SOURCE")
_REVIEW_PRIORITIES = ("HIGH_PRIORITY", "MEDIUM_PRIORITY", "EXTRACTION_FAILED")
_EXTRACTION_STATUSES = ("NOT_ATTEMPTED", "SUCCESS", "FAILED")
_EXTRACTION_METHODS = ("pdf_text", "docx_text", "doc_text")


def _print_summary(counters_or_counts: dict) -> None:
    # Same aggregate-only-by-construction convention as cdc_discovery.py's
    # _print_summary: every value here is a count/int/bool/short label,
    # never a filename, path, or excerpt.
    print("cdc_review aggregate report:")
    for key, value in counters_or_counts.items():
        print(f"  {key}: {value}")


# =====================================================================
# --review-summary: aggregate-only SQL. Every query below is a GROUP BY
# count - none of them ever selects archive_file_id, project_reference, or
# any other row-level/identifying column.
# =====================================================================


def _grouped_counts(conn, column: str, expected_values: "tuple[str, ...]", where: str = "") -> dict:
    query = (
        f"select {column}, count(*) from knowledge_base.historical_technical_source_candidates"
        f"{(' where ' + where) if where else ''} group by {column}"
    )
    with conn.cursor() as cur:
        cur.execute(query)
        rows = cur.fetchall()
    counts = {value: 0 for value in expected_values}
    for value, count in rows:
        if value is not None:
            counts[value] = count
    return counts


def fetch_review_summary(conn) -> dict:
    """Task 3 (review workflow) aggregate-only report. Never selects a
    row-level column - only COUNT(*)/COUNT(DISTINCT ...) and GROUP BY
    counts, so there is nothing to redact: the SQL itself cannot return an
    identifying value."""
    summary: dict = {}

    with conn.cursor() as cur:
        cur.execute("select count(*) from knowledge_base.historical_technical_source_candidates")
        summary["total_candidates"] = cur.fetchone()[0]

    with conn.cursor() as cur:
        cur.execute(
            "select count(distinct project_reference) from "
            "knowledge_base.historical_technical_source_candidates where project_reference is not null"
        )
        summary["projects_represented"] = cur.fetchone()[0]

    role_counts = _grouped_counts(conn, "detected_role", TECHNICAL_SOURCE_ROLES)
    for role, count in role_counts.items():
        summary[f"role_{role}"] = count
    # Headline categories the review task specifically asked for, pulled
    # from the same role_counts dict (no second query, no duplicated logic).
    summary["cdc_candidates"] = role_counts["CDC"]
    summary["dao_with_cdc_candidates"] = role_counts["DAO_WITH_CDC"]

    band_counts = _grouped_counts(conn, "structural_band", _STRUCTURAL_BANDS)
    for band, count in band_counts.items():
        summary[f"band_{band}"] = count
    summary["strong_technical_candidates"] = band_counts["STRONG_TECHNICAL_SOURCE"]
    summary["possible_technical_candidates"] = band_counts["POSSIBLE_TECHNICAL_SOURCE"]

    priority_counts = _grouped_counts(conn, "review_priority", _REVIEW_PRIORITIES)
    for priority, count in priority_counts.items():
        summary[f"priority_{priority}"] = count

    extraction_status_counts = _grouped_counts(conn, "extraction_status", _EXTRACTION_STATUSES)
    for status, count in extraction_status_counts.items():
        summary[f"extraction_status_{status}"] = count
    summary["extraction_failures"] = extraction_status_counts["FAILED"]

    method_counts = _grouped_counts(conn, "extraction_method", _EXTRACTION_METHODS)
    for method, count in method_counts.items():
        summary[f"extraction_method_{method}"] = count

    failure_category_counts = _grouped_counts(
        conn, "extraction_failure_category", EXTRACTION_FAILURE_CATEGORIES, where="extraction_status = 'FAILED'"
    )
    for category, count in failure_category_counts.items():
        summary[f"failure_category_{category}"] = count

    # Machine vs human validation - the single most important distinction
    # in this whole report (Task 5: "Machine classification is not human
    # validation"). machine_classified_never_reviewed is the count still
    # sitting at the discovery-time default; every HUMAN_* count below
    # only ever grows via --review-mark, never via discovery.
    validation_counts = _grouped_counts(conn, "validation_status", TECHNICAL_SOURCE_VALIDATION_STATUSES)
    summary["machine_classified_never_reviewed"] = validation_counts["MACHINE_CLASSIFIED"]
    for status, count in validation_counts.items():
        if status != "MACHINE_CLASSIFIED":
            summary[f"validation_{status}"] = count

    with conn.cursor() as cur:
        cur.execute(
            "select f.extension, count(*) from knowledge_base.historical_technical_source_candidates c "
            "join knowledge_base.archive_files f on f.id = c.archive_file_id group by f.extension"
        )
        for extension, count in cur.fetchall():
            summary[f"extension_{extension or 'unknown'}"] = count

    return summary


def run_review_summary_mode() -> int:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required.", file=sys.stderr)
        return 1

    conn = _connect(database_url)
    try:
        summary = fetch_review_summary(conn)
    finally:
        conn.close()

    _print_summary(summary)
    return 0


# =====================================================================
# --review-open: controlled, exactly-one-document local review.
# =====================================================================


def fetch_single_candidate_row(conn, archive_file_id: int) -> Optional[dict]:
    """Reads exactly one candidate row PLUS the archive_files columns
    needed to resolve its path - by an explicit, developer-supplied
    integer archive_file_id, never a name/filename/path. Returns None if
    no such row exists (fails closed - --review-open never guesses)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select f.id, f.relative_path, f.filename, f.extension, f.sha256, r.label, r.root_path,
                   c.detected_role, c.validation_status
            from knowledge_base.historical_technical_source_candidates c
            join knowledge_base.archive_files f on f.id = c.archive_file_id
            join knowledge_base.archive_source_roots r on r.id = f.source_root_id
            where c.archive_file_id = %s
            """,
            (archive_file_id,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return {
        "archive_file_row": row[:7],
        "detected_role": row[7],
        "validation_status": row[8],
    }


def open_review_candidate(conn, archive_file_id: int) -> dict:
    """--review-open. Resolves EXACTLY the one candidate named by
    archive_file_id (never a bulk selection, never "the first match") and
    opens it via the same launch_local_opener() the CDC-only pipeline's
    --open-single-confirmed already uses. READ-ONLY: never writes
    validation_status - opening a document is not the same action as
    validating it, and this function has no code path that could conflate
    the two. Never persists anything, never makes an external call."""
    from cdc_discovery import ArchiveFileRow  # local import: keeps this module's top-level import list minimal

    found = fetch_single_candidate_row(conn, archive_file_id)
    if found is None:
        return {
            "document_open_requested": "YES",
            "document_open_process_started": "NO",
            "open_failure_reason": "CANDIDATE_NOT_FOUND",
        }

    (row_id, relative_path, filename, extension, sha256, label, root_path) = found["archive_file_row"]
    row = ArchiveFileRow(
        id=row_id, relative_path=relative_path, filename=filename, extension=extension, sha256=sha256,
        source_root_label=label, source_root_path=root_path,
    )
    file_path = resolve_archive_file_path(row)
    result = launch_local_opener(file_path)
    # Safe, non-identifying context about WHAT was opened (a role label,
    # never a filename) - directly answers "was this opened thing already
    # machine-flagged as a plausible technical source" without leaking
    # anything about which document it was.
    result["opened_candidate_detected_role"] = found["detected_role"]
    result["opened_candidate_validation_status"] = found["validation_status"]
    return result


def run_review_open_mode(archive_file_id: int) -> int:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required.", file=sys.stderr)
        return 1

    conn = _connect(database_url)
    try:
        result = open_review_candidate(conn, archive_file_id)
    finally:
        conn.close()

    _print_summary(result)
    return 0


# =====================================================================
# --review-mark: the ONLY path that can ever set a HUMAN_* validation
# status. Never called by discovery, never called by --review-open.
# =====================================================================


def run_review_mark_mode(archive_file_id: int, validation_status: str, reviewed_by: Optional[int]) -> int:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required.", file=sys.stderr)
        return 1

    conn = _connect(database_url)
    try:
        repository = PostgresTechnicalSourceCandidateRepository(conn)
        try:
            with conn.transaction():
                repository.mark_validation_status(archive_file_id, validation_status, reviewed_by=reviewed_by)
        except ValueError as error:
            print(f"cdc_review: {error}", file=sys.stderr)
            return 1
        # See cdc_discovery.run_full_corpus_mode's identical fix: _connect()
        # never sets autocommit=True, so conn.transaction() alone never
        # durably commits once the connection is already inside an ambient
        # transaction - without this explicit commit, this ONE path that
        # can ever record a human validation decision would silently
        # discard it on conn.close() while still reporting success below.
        try:
            conn.commit()
        except Exception as error:
            print(f"cdc_review: commit failed - validation was not recorded: {error}", file=sys.stderr)
            return 1
    finally:
        conn.close()

    _print_summary({
        "validation_recorded": "YES",
        "new_validation_status": validation_status,
        "database_writes": 1,
    })
    return 0


# =====================================================================
# CLI
# =====================================================================


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cdc_review.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--review-summary", action="store_true",
        help="Aggregate-only counts from knowledge_base.historical_technical_source_candidates. Read-only.",
    )
    mode.add_argument(
        "--review-open", action="store_true",
        help="Open EXACTLY ONE candidate document locally. Requires --archive-file-id. Read-only, never persists.",
    )
    mode.add_argument(
        "--review-mark", action="store_true",
        help=(
            "Record a HUMAN validation decision for exactly one candidate. Requires --archive-file-id "
            "and --validation-status. The ONLY way a HUMAN_*/NEEDS_HUMAN_REVIEW status is ever set."
        ),
    )

    parser.add_argument("--archive-file-id", type=int, default=None, metavar="N")
    parser.add_argument(
        "--validation-status", type=str, default=None, choices=HUMAN_SETTABLE_VALIDATION_STATUSES,
    )
    parser.add_argument(
        "--reviewed-by", type=int, default=None, metavar="USER_ID",
        help="Optional public.app_users(id) to attribute this review decision to.",
    )

    return parser


def _validate_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.review_summary:
        if args.archive_file_id is not None or args.validation_status is not None or args.reviewed_by is not None:
            parser.error("--review-summary does not take --archive-file-id/--validation-status/--reviewed-by.")
        return

    if args.archive_file_id is None:
        parser.error("--archive-file-id is required with --review-open/--review-mark.")
    if args.archive_file_id <= 0:
        parser.error("--archive-file-id must be a positive integer.")

    if args.review_open:
        if args.validation_status is not None:
            parser.error("--review-open does not take --validation-status (it is read-only).")
        return

    assert args.review_mark
    if args.validation_status is None:
        parser.error("--review-mark requires --validation-status.")


def main(argv: Optional["list[str]"] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)  # --help / -h exits here, before any DB access
    _validate_args(parser, args)

    if args.review_summary:
        return run_review_summary_mode()
    if args.review_open:
        return run_review_open_mode(args.archive_file_id)

    assert args.review_mark
    return run_review_mark_mode(args.archive_file_id, args.validation_status, args.reviewed_by)


if __name__ == "__main__":
    raise SystemExit(main())
