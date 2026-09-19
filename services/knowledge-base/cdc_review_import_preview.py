#!/usr/bin/env python3
"""Offline, read-only dry-run preview for a completed CDC review workbook.

Validates a human-reviewed CDC candidate workbook (the shape produced by
scripts/export_cdc_review_workbook.py and completed by a human reviewer in
the "CDC utilisable ?" column) and computes a sanitized, aggregate-only
processing-classification preview. This module NEVER connects to
PostgreSQL, NEVER reads DATABASE_URL, and NEVER writes anywhere - it is a
read-only inspection/preview tool only. A future, separate importer would
read this preview's PASS result before ever touching the database.

CONFIDENTIALITY: this module never prints a row identifier, filename, path,
or any cell content. Every value it prints is either a fixed PASS/FAIL
label or an aggregate count.

Known workbook template shape (established by prior read-only forensic
inspection of a real completed workbook, never hardcoded from row content):
  - 5 sheets: Sheet 1 (visible, the human-reviewed candidate table), Sheet 2
    (hidden, small - a data-validation dropdown list), Sheet 3 (hidden, the
    full technical/backing data - this is where the stable row identifiers
    live), Sheet 4 and Sheet 5 (visible, summary/instructions sheets, not
    used by this preview).
  - Sheet 1's row 1 is a merged banner/title, NOT the header row; the real
    header row is row 2; data starts on row 3.
  - Sheet 1 has 7 columns. Column 1 is "Priorité" (pre-existing, predates
    any human review round and is never read for classification here -
    Youssef confirmed the recency rule; the workbook's existing Priorité
    column does not implement it). Column 2 is "Année". Column 6 is
    "CDC utilisable ?" - the human decision this preview validates.
  - Sheet 3 has 24 columns; columns 1 and 2 are both fully unique and fully
    populated across all candidate rows - the stable row identifiers.
"""
from __future__ import annotations

import argparse
import hashlib
import sys
import warnings
from pathlib import Path
from typing import NamedTuple, Optional

import openpyxl

# openpyxl warns about a handful of XLSX extensions it doesn't render (e.g.
# data-validation dropdown UI hints) - cosmetic only, never a data leak, and
# irrelevant to a read-only structural/value preview. Silenced so stdout
# stays exactly the documented aggregate output.
warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")

EXPECTED_SHEET_COUNT = 5
MAIN_SHEET_INDEX = 0
TECHNICAL_SHEET_INDEX = 2
EXPECTED_MAIN_SHEET_COLUMN_COUNT = 7
EXPECTED_TECHNICAL_SHEET_COLUMN_COUNT = 24

BANNER_ROW = 1
HEADER_ROW = 2
DATA_START_ROW = 3

PRIORITE_COLUMN = 1
ANNEE_COLUMN = 2
CDC_UTILISABLE_COLUMN = 6
TECHNICAL_IDENTIFIER_COLUMNS = (1, 2)

DECISION_VOCABULARY = {"oui": "OUI", "non": "NON", "incertain": "INCERTAIN"}
YEAR_MIN, YEAR_MAX = 1900, 2100
RECENT_YEAR_MIN, RECENT_YEAR_MAX = 2020, 2026

PROCESSING_CATEGORIES = ("HIGH", "MEDIUM", "EXCLUDED", "SKIPPED_UNCERTAIN")


class WorkbookValidationError(RuntimeError):
    """Raised whenever the workbook fails a structural or content check."""


class CandidateRow(NamedTuple):
    identifier: str
    decision: str  # normalized: "OUI" | "NON" | "INCERTAIN"
    year: int
    category: str  # one of PROCESSING_CATEGORIES


# ---------------------------------------------------------------------
# Hashing (same streaming pattern as cdc_candidate_extractor.sha256_file,
# duplicated locally to keep this module dependency-free and self-contained)
# ---------------------------------------------------------------------

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_source_hash(path: Path, expected_sha256: str) -> str:
    actual = sha256_file(path)
    if actual.lower() != expected_sha256.strip().lower():
        raise WorkbookValidationError("source workbook SHA-256 does not match the expected hash.")
    return actual


# ---------------------------------------------------------------------
# Workbook loading and structural validation
# ---------------------------------------------------------------------

def load_workbook_readonly(path: Path):
    # read_only=True: openpyxl's streaming reader. This module never calls
    # .save() anywhere, on this or any workbook object.
    return openpyxl.load_workbook(str(path), data_only=True, read_only=True)


def _non_blank(value) -> bool:
    return value is not None and str(value).strip() != ""


def _normalize_header(value) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip().lower()
    return text if text else None


def validate_structure(wb):
    """Returns (main_worksheet, technical_worksheet). Raises WorkbookValidationError."""
    if len(wb.sheetnames) != EXPECTED_SHEET_COUNT:
        raise WorkbookValidationError(
            f"expected {EXPECTED_SHEET_COUNT} sheets, found {len(wb.sheetnames)}."
        )

    main_ws = wb[wb.sheetnames[MAIN_SHEET_INDEX]]
    technical_ws = wb[wb.sheetnames[TECHNICAL_SHEET_INDEX]]

    if main_ws.sheet_state != "visible":
        raise WorkbookValidationError("main candidate sheet is not visible.")
    if technical_ws.sheet_state == "visible":
        raise WorkbookValidationError("technical backing sheet is unexpectedly visible.")

    row1 = list(next(main_ws.iter_rows(min_row=BANNER_ROW, max_row=BANNER_ROW)))
    row2 = list(next(main_ws.iter_rows(min_row=HEADER_ROW, max_row=HEADER_ROW)))
    non_blank_row1 = sum(1 for cell in row1 if _non_blank(cell.value))
    non_blank_row2 = sum(1 for cell in row2 if _non_blank(cell.value))
    if not (non_blank_row1 <= 1 and non_blank_row2 > non_blank_row1):
        raise WorkbookValidationError(
            "expected banner-row-then-header-row layout not found on the main sheet."
        )

    headers = [cell.value for cell in row2]
    if len(headers) != EXPECTED_MAIN_SHEET_COLUMN_COUNT:
        raise WorkbookValidationError(
            f"expected {EXPECTED_MAIN_SHEET_COLUMN_COUNT} header columns on the main sheet, "
            f"found {len(headers)}."
        )

    priorite_header = _normalize_header(headers[PRIORITE_COLUMN - 1])
    annee_header = _normalize_header(headers[ANNEE_COLUMN - 1])
    decision_header = _normalize_header(headers[CDC_UTILISABLE_COLUMN - 1])

    if priorite_header not in ("priorité", "priorite"):
        raise WorkbookValidationError("'Priorité' column not found at its expected position.")
    if annee_header not in ("année", "annee"):
        raise WorkbookValidationError("'Année' column not found at its expected position.")
    if decision_header != "cdc utilisable ?":
        raise WorkbookValidationError("'CDC utilisable ?' column not found at its expected position.")

    if technical_ws.max_column != EXPECTED_TECHNICAL_SHEET_COLUMN_COUNT:
        raise WorkbookValidationError(
            f"expected {EXPECTED_TECHNICAL_SHEET_COLUMN_COUNT} columns on the technical sheet, "
            f"found {technical_ws.max_column}."
        )

    return main_ws, technical_ws


# ---------------------------------------------------------------------
# Identifiers and row alignment
# ---------------------------------------------------------------------

def _iter_data_row_values(ws, max_col):
    if ws.max_row < DATA_START_ROW:
        return
    for row_cells in ws.iter_rows(min_row=DATA_START_ROW, max_row=ws.max_row, max_col=max_col):
        yield [cell.value for cell in row_cells]


def validate_identifiers(technical_ws) -> "list[str]":
    """Validates both stable-identifier columns on the technical sheet
    (fully populated, fully unique) and returns the row-ordered primary
    identifier list. Never returns/logs the identifiers to the caller for
    printing - callers must only use this list's length and internal
    equality, never print its contents."""
    primary_col, secondary_col = TECHNICAL_IDENTIFIER_COLUMNS
    primary_ids: "list[str]" = []
    secondary_ids: "list[str]" = []

    for row in _iter_data_row_values(technical_ws, technical_ws.max_column):
        primary_value = row[primary_col - 1]
        secondary_value = row[secondary_col - 1]
        if not _non_blank(primary_value):
            raise WorkbookValidationError("a technical-sheet row is missing its primary identifier.")
        if not _non_blank(secondary_value):
            raise WorkbookValidationError("a technical-sheet row is missing its secondary identifier.")
        primary_ids.append(str(primary_value).strip())
        secondary_ids.append(str(secondary_value).strip())

    if len(set(primary_ids)) != len(primary_ids):
        raise WorkbookValidationError("duplicate primary identifiers found on the technical sheet.")
    if len(set(secondary_ids)) != len(secondary_ids):
        raise WorkbookValidationError("duplicate secondary identifiers found on the technical sheet.")

    return primary_ids


def validate_row_alignment(main_ws, technical_ws, expected_candidate_count: Optional[int]) -> int:
    main_row_count = max(main_ws.max_row - DATA_START_ROW + 1, 0)
    technical_row_count = max(technical_ws.max_row - DATA_START_ROW + 1, 0)
    if main_row_count != technical_row_count:
        raise WorkbookValidationError(
            "main sheet and technical sheet data row counts do not match "
            f"({main_row_count} vs {technical_row_count})."
        )
    if expected_candidate_count is not None and main_row_count != expected_candidate_count:
        raise WorkbookValidationError(
            f"expected {expected_candidate_count} candidate rows, found {main_row_count}."
        )
    return main_row_count


# ---------------------------------------------------------------------
# Decision / year normalization and classification
# ---------------------------------------------------------------------

def normalize_decision(raw_value) -> str:
    if not _non_blank(raw_value):
        raise WorkbookValidationError("a row is missing its 'CDC utilisable ?' decision.")
    key = str(raw_value).strip().lower()
    if key not in DECISION_VOCABULARY:
        raise WorkbookValidationError("a row contains an unrecognized 'CDC utilisable ?' value.")
    return DECISION_VOCABULARY[key]


def normalize_year(raw_value) -> int:
    if not _non_blank(raw_value):
        raise WorkbookValidationError("a row is missing its 'Année' value.")
    try:
        if isinstance(raw_value, bool):
            raise ValueError("boolean is not a year")
        if isinstance(raw_value, float):
            if not raw_value.is_integer():
                raise ValueError("non-integer float is not a year")
            year = int(raw_value)
        elif isinstance(raw_value, int):
            year = raw_value
        else:
            text = str(raw_value).strip()
            if not text.isdigit() or len(text) != 4:
                raise ValueError("not a clean four-digit year")
            year = int(text)
    except (TypeError, ValueError) as error:
        raise WorkbookValidationError("a row has a malformed 'Année' value.") from error

    if not (YEAR_MIN <= year <= YEAR_MAX):
        raise WorkbookValidationError("a row has an out-of-range 'Année' value.")
    return year


def classify(decision: str, year: int) -> str:
    if decision == "NON":
        return "EXCLUDED"
    if decision == "INCERTAIN":
        # Per the approved processing decision: INCERTAIN rows are neither
        # usable nor rejected. They are preserved unchanged and reported
        # separately for a later, dedicated human-review pass.
        return "SKIPPED_UNCERTAIN"
    # decision == "OUI"
    return "HIGH" if RECENT_YEAR_MIN <= year <= RECENT_YEAR_MAX else "MEDIUM"


def extract_candidate_rows(main_ws, identifiers: "list[str]") -> "list[CandidateRow]":
    rows = list(_iter_data_row_values(main_ws, EXPECTED_MAIN_SHEET_COLUMN_COUNT))
    if len(rows) != len(identifiers):
        raise WorkbookValidationError(
            "main sheet row count does not match the technical sheet identifier count."
        )

    candidates = []
    for identifier, row in zip(identifiers, rows):
        # Priorité (row[PRIORITE_COLUMN - 1]) is intentionally never read
        # here - it predates this review round and must not influence the
        # processing classification (Youssef's confirmed recency rule only).
        decision = normalize_decision(row[CDC_UTILISABLE_COLUMN - 1])
        year = normalize_year(row[ANNEE_COLUMN - 1])
        category = classify(decision, year)
        candidates.append(CandidateRow(identifier=identifier, decision=decision, year=year, category=category))
    return candidates


# ---------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------

class ExpectedCounts(NamedTuple):
    total: Optional[int] = None
    high: Optional[int] = None
    medium: Optional[int] = None
    excluded: Optional[int] = None
    skipped_uncertain: Optional[int] = None


def run_dry_run(source_path: Path, expected_sha256: str, expected_counts: ExpectedCounts = ExpectedCounts()):
    """Returns an ordered list of (key, value) pairs, exactly matching the
    documented CLI output shape. Raises nothing - every failure is captured
    as a FAIL entry and execution stops at the first failing check, with
    DATABASE_ACCESSED/SOURCE_MODIFIED/DRY_RUN_RESULT always appended last."""
    results: "list[tuple[str, object]]" = []

    def step(key, fn):
        if any(k == "DRY_RUN_RESULT" for k, _ in results):
            return None  # already terminated
        try:
            value = fn()
        except WorkbookValidationError:
            results.append((key, "FAIL"))
            return None
        results.append((key, "PASS"))
        return value

    verify_source_hash(source_path, expected_sha256)  # raises immediately if wrong; see main()
    results.append(("FILE_HASH_MATCH", "PASS"))

    wb = load_workbook_readonly(source_path)
    structure = step("WORKBOOK_STRUCTURE", lambda: validate_structure(wb))
    if structure is None:
        results.append(("DATABASE_ACCESSED", "NO"))
        results.append(("SOURCE_MODIFIED", "NO"))
        results.append(("DRY_RUN_RESULT", "FAIL"))
        return results
    main_ws, technical_ws = structure

    identifiers = step("IDENTIFIERS_UNIQUE", lambda: validate_identifiers(technical_ws))
    if identifiers is None:
        results.append(("DATABASE_ACCESSED", "NO"))
        results.append(("SOURCE_MODIFIED", "NO"))
        results.append(("DRY_RUN_RESULT", "FAIL"))
        return results

    row_count = step(
        "ROW_ALIGNMENT",
        lambda: validate_row_alignment(main_ws, technical_ws, expected_counts.total),
    )
    if row_count is None:
        results.append(("DATABASE_ACCESSED", "NO"))
        results.append(("SOURCE_MODIFIED", "NO"))
        results.append(("DRY_RUN_RESULT", "FAIL"))
        return results

    def parse_all_rows():
        return extract_candidate_rows(main_ws, identifiers)

    try:
        candidates = parse_all_rows()
        results.append(("DECISION_VOCABULARY", "PASS"))
        results.append(("YEAR_VALIDATION", "PASS"))
    except WorkbookValidationError as error:
        # Both decision and year are normalized in the same per-row pass;
        # report whichever failed first under its own key, the other as FAIL
        # too since neither could be fully validated for every row.
        message = str(error)
        if "utilisable" in message or "decision" in message:
            results.append(("DECISION_VOCABULARY", "FAIL"))
            results.append(("YEAR_VALIDATION", "FAIL"))
        else:
            results.append(("DECISION_VOCABULARY", "PASS"))
            results.append(("YEAR_VALIDATION", "FAIL"))
        results.append(("DATABASE_ACCESSED", "NO"))
        results.append(("SOURCE_MODIFIED", "NO"))
        results.append(("DRY_RUN_RESULT", "FAIL"))
        return results

    counts = {category: 0 for category in PROCESSING_CATEGORIES}
    for candidate in candidates:
        counts[candidate.category] += 1

    total = len(candidates)
    usable_total = counts["HIGH"] + counts["MEDIUM"]
    invariant_ok = (counts["HIGH"] + counts["MEDIUM"] + counts["EXCLUDED"] + counts["SKIPPED_UNCERTAIN"]) == total

    if expected_counts.total is not None:
        invariant_ok = invariant_ok and total == expected_counts.total
    if expected_counts.high is not None:
        invariant_ok = invariant_ok and counts["HIGH"] == expected_counts.high
    if expected_counts.medium is not None:
        invariant_ok = invariant_ok and counts["MEDIUM"] == expected_counts.medium
    if expected_counts.excluded is not None:
        invariant_ok = invariant_ok and counts["EXCLUDED"] == expected_counts.excluded
    if expected_counts.skipped_uncertain is not None:
        invariant_ok = invariant_ok and counts["SKIPPED_UNCERTAIN"] == expected_counts.skipped_uncertain

    results.append(("TOTAL", total))
    results.append(("USABLE_TOTAL", usable_total))
    results.append(("HIGH", counts["HIGH"]))
    results.append(("MEDIUM", counts["MEDIUM"]))
    results.append(("EXCLUDED", counts["EXCLUDED"]))
    results.append(("SKIPPED_UNCERTAIN", counts["SKIPPED_UNCERTAIN"]))
    results.append(("COUNT_INVARIANT", "PASS" if invariant_ok else "FAIL"))
    results.append(("DATABASE_ACCESSED", "NO"))

    source_modified = sha256_file(source_path).lower() != expected_sha256.strip().lower()
    results.append(("SOURCE_MODIFIED", "YES" if source_modified else "NO"))

    all_pass = all(
        value == "PASS"
        for key, value in results
        if key not in ("TOTAL", "USABLE_TOTAL", "HIGH", "MEDIUM", "EXCLUDED", "SKIPPED_UNCERTAIN", "DATABASE_ACCESSED", "SOURCE_MODIFIED")
    ) and not source_modified
    results.append(("DRY_RUN_RESULT", "PASS" if all_pass else "FAIL"))
    return results


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cdc_review_import_preview.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--source", required=True, metavar="PATH", help="Path to the completed CDC review workbook.")
    parser.add_argument("--expected-sha256", required=True, metavar="HEX", help="Required SHA-256 of the source workbook.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="This tool only ever runs as a dry run - no database-writing mode exists in this version.",
    )
    parser.add_argument("--expected-total", type=int, default=None, metavar="N")
    parser.add_argument("--expected-high", type=int, default=None, metavar="N")
    parser.add_argument("--expected-medium", type=int, default=None, metavar="N")
    parser.add_argument("--expected-excluded", type=int, default=None, metavar="N")
    parser.add_argument("--expected-skipped-uncertain", type=int, default=None, metavar="N")
    return parser


def _print_results(results) -> None:
    # Aggregate-only by construction: every value is a fixed PASS/FAIL label
    # or a count - never a row identifier, filename, or cell value.
    for key, value in results:
        print(f"{key}={value}")


def main(argv: Optional["list[str]"] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    source_path = Path(args.source).expanduser()
    if not source_path.is_file():
        print("cdc_review_import_preview: source workbook not found.", file=sys.stderr)
        return 2

    expected_counts = ExpectedCounts(
        total=args.expected_total,
        high=args.expected_high,
        medium=args.expected_medium,
        excluded=args.expected_excluded,
        skipped_uncertain=args.expected_skipped_uncertain,
    )

    try:
        verify_source_hash(source_path, args.expected_sha256)
    except WorkbookValidationError:
        print("FILE_HASH_MATCH=FAIL", file=sys.stdout)
        print("DATABASE_ACCESSED=NO")
        print("SOURCE_MODIFIED=UNKNOWN")
        print("DRY_RUN_RESULT=FAIL")
        return 1

    results = run_dry_run(source_path, args.expected_sha256, expected_counts)
    _print_results(results)

    dry_run_result = dict(results).get("DRY_RUN_RESULT")
    return 0 if dry_run_result == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
