#!/usr/bin/env python3
"""Confidential internal Excel COMPARISON workbook (CONCEPT): Youssef's
human CDC-usability decision versus the refreshed local-AI review, for the
population whose text only became available (or usable) after the 2026-09
targeted extraction recovery.

This is NOT the 21-criteria CDC proximity matrix and does not extract,
propose, or infer any of the 21 criteria - it only compares a document's
HIGH-LEVEL role/verdict (is it a usable CDC, per the same taxonomy
scripts/semantic_review.py already uses) between Youssef's human decision
and the refreshed AI proposal.

One row per candidate, for ALL 750 candidates (not just the refreshed-AI
scope) - a row outside that scope simply has no AI review yet, and is
shown honestly as such (Agreement = NON_COMPARE), never invented.

SAFETY GUARANTEES
- Reads ONLY existing PostgreSQL metadata (knowledge_base.
  historical_technical_source_candidates, archive_files,
  archive_source_roots, historical_technical_source_ai_reviews). Never
  opens, re-extracts, or re-analyzes a real archive document. Never calls
  Ollama, Docling, or LibreOffice. Never writes to PostgreSQL.
- Never prints a filename, project label, archive path, or client name to
  stdout/stderr - identifiers appear ONLY inside the generated .xlsx
  cells (the one place this task explicitly authorizes them), and
  absolute archive paths never appear in ANY sheet, visible or hidden -
  see build_technical_row_cells(), which carries archive_file_id/
  candidate_id/relative_path (never source_root_path/an absolute path).
- Formula-injection hardened via export_cdc_review_workbook.sanitize_cell_value
  (reused, not reimplemented).
- Never invents an AI result: a row with no matching
  historical_technical_source_ai_reviews row under the CURRENT model/
  prompt/schema identity is shown as "PAS ENCORE ANALYSÉ" / Agreement =
  NON_COMPARE, never a fabricated verdict.
- Youssef's own decision (validation_status, and therefore OUI/NON) is
  never recomputed, inferred, or overridden by anything in this script -
  it is read once, verbatim, and displayed unchanged.
"""
from __future__ import annotations

import argparse
import datetime
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_cdc_review_workbook import sanitize_cell_value  # noqa: E402 - reused, not reimplemented

DEFAULT_OUTPUT_DIR = "/home/concept/cdc-ai-review-output/2026-09-28"
DEFAULT_OUTPUT_FILENAME = "cdc_youssef_vs_ai_after_recovery.xlsx"

# The same CDC-bearing-role convention scripts/semantic_review.py's
# ELIGIBLE_DETECTED_ROLES already uses - never reinvented here.
AI_USABLE_CDC_ROLES: "tuple[str, ...]" = ("CDC", "DAO_WITH_CDC")

AGREEMENT_ACCORD = "ACCORD"
AGREEMENT_DESACCORD = "DESACCORD"
AGREEMENT_NON_COMPARE = "NON_COMPARE"
AGREEMENT_ANALYSE_IA_IMPOSSIBLE = "ANALYSE_IA_IMPOSSIBLE"
AGREEMENT_A_REVOIR = "A_REVOIR"
AGREEMENT_VALUES: "tuple[str, ...]" = (
    AGREEMENT_ACCORD, AGREEMENT_DESACCORD, AGREEMENT_NON_COMPARE,
    AGREEMENT_ANALYSE_IA_IMPOSSIBLE, AGREEMENT_A_REVOIR,
)

VISIBLE_HEADERS = [
    "Priorité", "Année", "Projet", "Titre / fichier",
    "Proposition automatique initiale", "Décision de Youssef", "Commentaire humain",
    "Statut d'extraction actuel", "Méthode d'extraction", "Motif précis en cas d'échec",
    "Revue IA après récupération", "Verdict IA", "Confiance IA", "Modèle IA", "Date de revue IA",
    "Accord Youssef / IA", "Action recommandée",
]
TECHNICAL_HEADERS = [
    "candidate_id", "archive_file_id", "relative_path (archive)",
    "is_primary_candidate", "duplicate_of_archive_file_id",
]


# =====================================================================
# Data fetch (metadata only - never opens a document)
# =====================================================================


@dataclass(frozen=True)
class ComparisonRow:
    candidate_id: str
    archive_file_id: int
    year: Optional[int]
    project_key: Optional[str]
    filename: str
    relative_path: str
    original_proposal: str  # rule-based detected_role, pre-recovery signal
    validation_status: str
    extraction_status: str
    extraction_method: Optional[str]
    extraction_failure_category: Optional[str]
    ai_proposed_role: Optional[str]
    ai_confidence: Optional[float]
    ai_model_name: Optional[str]
    ai_created_at: Optional[str]
    ai_processing_status: Optional[str]
    # Duplicate provenance (Issue 1's "duplicates must remain explicitly
    # identified in technical provenance") - visible ONLY on the hidden
    # "Données techniques" sheet, never on the main comparison sheet.
    # Never used to copy or infer an AI result between rows - each row's
    # ai_* fields above come from its OWN archive_file_id-scoped LATERAL
    # join, independent of this provenance metadata.
    is_primary_candidate: bool
    duplicate_of_archive_file_id: Optional[int]

    @property
    def youssef_decision(self) -> str:
        if self.validation_status == "HUMAN_VALIDATED_CDC":
            return "OUI"
        if self.validation_status == "HUMAN_REJECTED_CDC":
            return "NON"
        # Every candidate was reviewed by Youssef (see the import_batches
        # aggregate: usable + excluded + skipped_uncertain == total_count
        # == 750) - a row that is neither HUMAN_VALIDATED_CDC nor
        # HUMAN_REJECTED_CDC can therefore only be one of the small,
        # known "INCERTAIN" set (the importer deliberately leaves
        # validation_status untouched for those - see
        # services/knowledge-base/cdc_review_importer.py's module
        # docstring), never a "not yet reviewed" row.
        return "INCERTAIN"

    @property
    def has_ai_review(self) -> bool:
        return self.ai_processing_status == "SUCCESS" and self.ai_proposed_role is not None


_FETCH_SQL = """
select
    c.id, c.archive_file_id, c.year, c.validation_status,
    c.extraction_status, c.extraction_method, c.extraction_failure_category,
    c.detected_role, c.is_primary_candidate, c.duplicate_of_archive_file_id,
    f.relative_path, f.filename, r.label,
    ai.proposed_role, ai.confidence, ai.model_name, ai.created_at, ai.processing_status
from knowledge_base.historical_technical_source_candidates c
join knowledge_base.archive_files f on f.id = c.archive_file_id
join knowledge_base.archive_source_roots r on r.id = f.source_root_id
left join lateral (
    select ar.*
    from knowledge_base.historical_technical_source_ai_reviews ar
    where ar.archive_file_id = c.archive_file_id
      and ar.model_name = %(model_name)s
      and ar.prompt_hash = %(prompt_hash)s
      and ar.schema_version = %(schema_version)s
      and ar.processing_status = 'SUCCESS'
    order by ar.created_at desc
    limit 1
) ai on true
order by c.id
"""


def fetch_comparison_rows(conn, model_name: str, prompt_hash: str, schema_version: str) -> List[ComparisonRow]:
    """Read-only. relative_path/label are read ONLY to compute the
    existing, authoritative project_key - never printed to a terminal,
    only ever placed into an .xlsx cell."""
    from cdc_discovery import derive_project_folder_key

    with conn.cursor() as cur:
        cur.execute(
            _FETCH_SQL,
            {"model_name": model_name, "prompt_hash": prompt_hash, "schema_version": schema_version},
        )
        cols = [d.name for d in cur.description]
        raw_rows = [dict(zip(cols, row)) for row in cur.fetchall()]

    rows: List[ComparisonRow] = []
    for r in raw_rows:
        project_key = derive_project_folder_key(r["relative_path"], r["label"])
        rows.append(ComparisonRow(
            candidate_id=str(r["id"]), archive_file_id=r["archive_file_id"], year=r["year"],
            project_key=project_key, filename=r["filename"], relative_path=r["relative_path"],
            original_proposal=r["detected_role"], validation_status=r["validation_status"],
            extraction_status=r["extraction_status"], extraction_method=r["extraction_method"],
            extraction_failure_category=r["extraction_failure_category"],
            ai_proposed_role=r["proposed_role"], ai_confidence=float(r["confidence"]) if r["confidence"] is not None else None,
            ai_model_name=r["model_name"], ai_created_at=str(r["created_at"]) if r["created_at"] is not None else None,
            ai_processing_status=r["processing_status"],
            is_primary_candidate=r["is_primary_candidate"],
            duplicate_of_archive_file_id=r["duplicate_of_archive_file_id"],
        ))
    return rows


# =====================================================================
# Pure comparison logic (no I/O - fully unit-testable)
# =====================================================================


def compute_ai_verdict_label(row: ComparisonRow) -> str:
    if row.extraction_status == "FAILED":
        return "ANALYSE IMPOSSIBLE (échec d'extraction)"
    if not row.has_ai_review:
        return "PAS ENCORE ANALYSÉ"
    return row.ai_proposed_role


def compute_agreement(row: ComparisonRow) -> str:
    """Never invents a result: ANALYSE_IA_IMPOSSIBLE for a controlled
    extraction failure (no text was ever available to review), NON_COMPARE
    for a row with no current AI review at all, A_REVOIR for Youssef's own
    INCERTAIN rows (there is no "agreement" question until a human
    resolves the uncertainty first), otherwise ACCORD/DESACCORD by
    comparing Youssef's OUI/NON against the AI's usable-CDC-role verdict
    (the same CDC-bearing-role set semantic_review.ELIGIBLE_DETECTED_ROLES
    already uses)."""
    if row.extraction_status == "FAILED":
        return AGREEMENT_ANALYSE_IA_IMPOSSIBLE
    if not row.has_ai_review:
        return AGREEMENT_NON_COMPARE
    if row.youssef_decision == "INCERTAIN":
        return AGREEMENT_A_REVOIR
    youssef_says_usable = row.youssef_decision == "OUI"
    ai_says_usable = row.ai_proposed_role in AI_USABLE_CDC_ROLES
    return AGREEMENT_ACCORD if youssef_says_usable == ai_says_usable else AGREEMENT_DESACCORD


def compute_recommended_action(row: ComparisonRow, agreement: str) -> str:
    if agreement == AGREEMENT_ANALYSE_IA_IMPOSSIBLE:
        return "Aucune action IA possible - échec d'extraction contrôlé"
    if agreement == AGREEMENT_NON_COMPARE:
        return "Lancer la revue IA ciblée pour ce document"
    if agreement == AGREEMENT_A_REVOIR:
        return "Décision Youssef incertaine - revue humaine à compléter"
    if agreement == AGREEMENT_DESACCORD:
        return "Désaccord Youssef / IA - revue humaine prioritaire"
    return "Aucune action - décision et IA concordent"


def priority_for_row(agreement: str) -> int:
    """Lower number = higher priority for a human reviewer's attention -
    used only to ORDER rows, never persisted."""
    return {
        AGREEMENT_DESACCORD: 1,
        AGREEMENT_A_REVOIR: 2,
        AGREEMENT_NON_COMPARE: 3,
        AGREEMENT_ANALYSE_IA_IMPOSSIBLE: 4,
        AGREEMENT_ACCORD: 5,
    }.get(agreement, 6)


def build_row_cells(row: ComparisonRow) -> list:
    agreement = compute_agreement(row)
    priority = priority_for_row(agreement)
    return [
        priority,
        row.year,
        row.project_key,
        row.filename,
        row.original_proposal,
        row.youssef_decision,
        "",  # Commentaire humain - not captured by the current import schema; left honestly blank
        row.extraction_status,
        row.extraction_method or "",
        row.extraction_failure_category or "",
        "OUI" if row.has_ai_review else ("N/A" if row.extraction_status == "FAILED" else "NON"),
        compute_ai_verdict_label(row),
        row.ai_confidence if row.has_ai_review else None,
        row.ai_model_name if row.has_ai_review else "",
        row.ai_created_at if row.has_ai_review else "",
        agreement,
        compute_recommended_action(row, agreement),
    ]


def build_technical_row_cells(row: ComparisonRow) -> list:
    return [
        row.candidate_id, row.archive_file_id, row.relative_path,
        "OUI" if row.is_primary_candidate else "NON",
        row.duplicate_of_archive_file_id if row.duplicate_of_archive_file_id is not None else "",
    ]


def order_rows(rows: Sequence[ComparisonRow]) -> List[ComparisonRow]:
    return sorted(
        rows,
        key=lambda r: (priority_for_row(compute_agreement(r)), r.year or 0, r.project_key or "", r.filename),
    )


# =====================================================================
# Workbook construction (pure w.r.t. I/O - returns an in-memory Workbook)
# =====================================================================


@dataclass
class ComparisonSummary:
    output_path: str
    total_rows: int
    agreement_counts: dict
    youssef_decision_counts: dict
    extraction_failure_count: int
    ai_reviewed_count: int


def build_workbook(rows: Sequence[ComparisonRow], model_name: str, schema_version: str, generated_at: str):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    ordered = order_rows(rows)
    n = len(VISIBLE_HEADERS)

    wb = Workbook()
    ws = wb.active
    ws.title = "Comparaison Youssef vs IA"

    header_fill = PatternFill(start_color="FF2F5496", end_color="FF2F5496", fill_type="solid")
    header_font = Font(color="FFFFFFFF", bold=True, size=11)
    header_alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
    band_fill = PatternFill(start_color="FFF2F2F2", end_color="FFF2F2F2", fill_type="solid")
    disagree_fill = PatternFill(start_color="FFFFC7CE", end_color="FFFFC7CE", fill_type="solid")
    agree_fill = PatternFill(start_color="FFC6EFCE", end_color="FFC6EFCE", fill_type="solid")
    impossible_fill = PatternFill(start_color="FFD9D9D9", end_color="FFD9D9D9", fill_type="solid")

    for col_index, header in enumerate(VISIBLE_HEADERS, start=1):
        cell = ws.cell(row=1, column=col_index, value=sanitize_cell_value(header))
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_alignment
    ws.row_dimensions[1].height = 30

    agreement_col = VISIBLE_HEADERS.index("Accord Youssef / IA") + 1
    first_data_row = 2
    for offset, row in enumerate(ordered):
        row_index = first_data_row + offset
        values = build_row_cells(row)
        is_band_row = (offset % 2 == 1)
        for col_index, raw_value in enumerate(values, start=1):
            cell = ws.cell(row=row_index, column=col_index, value=sanitize_cell_value(raw_value))
            if is_band_row:
                cell.fill = band_fill
        agreement_value = values[agreement_col - 1]
        agreement_cell = ws.cell(row=row_index, column=agreement_col)
        if agreement_value == AGREEMENT_DESACCORD:
            agreement_cell.fill = disagree_fill
        elif agreement_value == AGREEMENT_ACCORD:
            agreement_cell.fill = agree_fill
        elif agreement_value == AGREEMENT_ANALYSE_IA_IMPOSSIBLE:
            agreement_cell.fill = impossible_fill

    last_row = first_data_row + len(ordered) - 1 if ordered else first_data_row - 1
    last_col_letter = get_column_letter(n)
    ws.freeze_panes = "A2"
    if ordered:
        ws.auto_filter.ref = f"A1:{last_col_letter}{last_row}"

    column_widths = {3: 30, 4: 40, 5: 24, 7: 24, 12: 20}
    for col_index, width in column_widths.items():
        ws.column_dimensions[get_column_letter(col_index)].width = width

    # Hidden technical sheet - archive_file_id/candidate_id/relative_path
    # only (never an absolute archive path, never on the visible sheet).
    technical = wb.create_sheet("Données techniques")
    technical.sheet_state = "hidden"
    for col_index, header in enumerate(TECHNICAL_HEADERS, start=1):
        technical.cell(row=1, column=col_index, value=sanitize_cell_value(header)).font = Font(bold=True)
    for offset, row in enumerate(ordered):
        row_index = 2 + offset
        for col_index, raw_value in enumerate(build_technical_row_cells(row), start=1):
            technical.cell(row=row_index, column=col_index, value=sanitize_cell_value(raw_value))

    summary = wb.create_sheet("Résumé")
    _build_summary_sheet(summary, rows, model_name, schema_version, generated_at)

    wb.move_sheet("Comparaison Youssef vs IA", offset=-len(wb.sheetnames))
    return wb


def _build_summary_sheet(ws, rows: Sequence[ComparisonRow], model_name: str, schema_version: str, generated_at: str) -> None:
    from openpyxl.styles import Font

    bold = Font(bold=True)
    line_index = 1

    def line(label, value=""):
        nonlocal line_index
        ws.cell(row=line_index, column=1, value=sanitize_cell_value(label)).font = bold
        if value != "":
            ws.cell(row=line_index, column=2, value=sanitize_cell_value(value))
        line_index += 1

    agreement_counts = {value: 0 for value in AGREEMENT_VALUES}
    youssef_counts = {"OUI": 0, "NON": 0, "INCERTAIN": 0}
    for row in rows:
        agreement_counts[compute_agreement(row)] += 1
        youssef_counts[row.youssef_decision] += 1

    line("Généré le", generated_at)
    line("Modèle IA", model_name)
    line("Version de schéma", schema_version)
    line("Total candidats", len(rows))
    line("")
    line("Décisions de Youssef")
    line("  OUI", youssef_counts["OUI"])
    line("  NON", youssef_counts["NON"])
    line("  INCERTAIN", youssef_counts["INCERTAIN"])
    line("")
    line("Accord Youssef / IA")
    for value in AGREEMENT_VALUES:
        line(f"  {value}", agreement_counts[value])
    line("")
    line("Total désaccords", agreement_counts[AGREEMENT_DESACCORD])


def summarize(rows: Sequence[ComparisonRow], output_path: str) -> ComparisonSummary:
    agreement_counts = {value: 0 for value in AGREEMENT_VALUES}
    youssef_counts = {"OUI": 0, "NON": 0, "INCERTAIN": 0}
    extraction_failure_count = 0
    ai_reviewed_count = 0
    for row in rows:
        agreement_counts[compute_agreement(row)] += 1
        youssef_counts[row.youssef_decision] += 1
        if row.extraction_status == "FAILED":
            extraction_failure_count += 1
        if row.has_ai_review:
            ai_reviewed_count += 1
    return ComparisonSummary(
        output_path=output_path, total_rows=len(rows), agreement_counts=agreement_counts,
        youssef_decision_counts=youssef_counts, extraction_failure_count=extraction_failure_count,
        ai_reviewed_count=ai_reviewed_count,
    )


def print_comparison_summary(summary: ComparisonSummary) -> None:
    print("=== export_cdc_ai_review_comparison.py (aggregate only) ===")
    print(f"output path: {summary.output_path}")
    print(f"total candidate rows: {summary.total_rows}")
    for key, value in summary.youssef_decision_counts.items():
        print(f"youssef decision {key}: {value}")
    for key, value in summary.agreement_counts.items():
        print(f"agreement {key}: {value}")
    print(f"extraction-failure rows: {summary.extraction_failure_count}")
    print(f"rows with a current AI review: {summary.ai_reviewed_count}")
    print("document/Ollama/external calls: 0")
    print("database writes: 0")


def run_export(conn, output_path: str, model_name: str, schema_version: str, prompt_hash: str) -> ComparisonSummary:
    rows = fetch_comparison_rows(conn, model_name, prompt_hash, schema_version)
    generated_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    wb = build_workbook(rows, model_name, schema_version, generated_at)

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(out.parent, 0o700)
    wb.save(str(out))
    os.chmod(out, 0o600)

    return summarize(rows, str(out))


def _connect(database_url: str):
    import psycopg  # lazy import

    return psycopg.connect(database_url)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="export_cdc_ai_review_comparison.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--output", default=str(Path(DEFAULT_OUTPUT_DIR) / DEFAULT_OUTPUT_FILENAME),
        help="Output .xlsx path (default: the 2026-09-28 private output directory).",
    )
    parser.add_argument("--model", default="qwen3:14b", help="AI model name to compare against (default: qwen3:14b).")
    parser.add_argument("--schema-version", default="v3", help="AI schema_version to compare against (default: v3).")
    return parser


def main(argv: Optional[list] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 2

    from semantic_review import compute_prompt_hash

    conn = _connect(database_url)
    try:
        summary = run_export(conn, args.output, args.model, args.schema_version, compute_prompt_hash())
    finally:
        conn.close()

    print_comparison_summary(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
