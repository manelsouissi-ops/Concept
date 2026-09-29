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

EXTRACTION-STATE EXPLANATION NOTE (2026-09-29 audit)
Diagnosis of the 67 NOT_ATTEMPTED and 66 FAILED extraction rows proved:
all 67 NOT_ATTEMPTED rows are HUMAN_REJECTED_CDC (Youssef=NON) - a
deliberate POLICY exclusion (two independent selection queries in
cdc_discovery.py structurally never select a HUMAN_REJECTED_CDC row for
extraction), never a technical failure - and the 66 FAILED rows split
into DOC_EMBEDDED_IMAGES_ONLY=39, PDF_EXTRACTION_FAILURE=25,
EMPTY_EXTRACTED_TEXT=2, each a genuine, controlled extraction attempt
that did not produce usable text. compute_extraction_status_label() and
compute_extraction_explanation() below turn those raw, easily-confused
values into plain-French labels/sentences a non-technical reviewer can
read without cross-referencing code - and, critically, never describe
the policy exclusion (NOT_ATTEMPTED + Youssef=NON) as a technical
failure. The raw extraction_status/extraction_failure_category values
remain visible in "Motif précis en cas d'échec" and in full on the
hidden technical sheet - nothing is hidden, only explained.

SEMANTIC-EQUIVALENCE NOTE (2026-09-29 audit)
Youssef's OUI is a broad USABILITY judgment: "le document est un CDC, OU
CONTIENT un CDC, utilisable dans la base de connaissances historique" (see
export_cdc_review_workbook.py's Instructions sheet, verbatim). The AI's
proposed_role is a narrower single-value DOCUMENT-IDENTITY classification
(exactly one of scripts/semantic_review.py's SEMANTIC_ROLES). These are
related but NOT identical concepts, so a naive OUI-vs-AI_USABLE_CDC_ROLES
comparison would misrepresent some AI-role mismatches as confident human/AI
"disagreements" when they are really unresolved semantic ambiguity. See
AI_ROLES_AMBIGUOUS_VS_YOUSSEF_OUI and compute_agreement() below: those
specific mismatches are reported as A_REVOIR (needs human re-review), never
as a claim that either side is "wrong." The column that used to be labeled
"Accord Youssef / IA" is now "Comparaison décision humaine / verdict IA" to
avoid implying the two sides answer the identical question. Both raw values
("Décision de Youssef", "Verdict IA") are always preserved unmodified in
their own columns regardless of this classification.
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

# AI proposed_role values that are NOT in AI_USABLE_CDC_ROLES but are close
# enough to CDC-adjacent technical-reference content, or reflect the AI's
# own low confidence, that an "AI disagrees with Youssef's OUI" reading
# would overstate what is actually known:
#   - "TDR" (Termes de Référence): a technical-reference/scope-of-work
#     document type closely related to a CDC in French and international
#     procurement usage. A document whose PRIMARY role the AI detects as
#     TDR may still be exactly the kind of document Youssef's broad OUI
#     ("est un CDC, OU CONTIENT un CDC, utilisable...") is meant to catch -
#     the AI's single-role classification does not rule that out.
#   - "UNKNOWN": the AI's own explicit "I could not confidently classify
#     this" outcome. Treating an uncertain AI verdict as a confident
#     disagreement against a confident human OUI is not defensible either
#     way; it is an unresolved case, not a proven mismatch.
# Deliberately excludes RFP, OFFER, DAO, DCE, OTHER, and the remaining
# roles: those represent document genres meaningfully distinct in function
# from a technical specification (a solicitation, a bidder's own response,
# etc.), so a mismatch against Youssef's OUI there remains a real,
# reportable signal - see the SEMANTIC-EQUIVALENCE NOTE above.
AI_ROLES_AMBIGUOUS_VS_YOUSSEF_OUI: "tuple[str, ...]" = ("TDR", "UNKNOWN")

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
    "Explication de l'état d'extraction",
    "Revue IA après récupération", "Verdict IA", "Confiance IA", "Modèle IA", "Date de revue IA",
    "Comparaison décision humaine / verdict IA", "Action recommandée",
]

# --- Human-readable extraction-state labels (2026-09-29 audit) -------
# Maps extraction_failure_category (the DB's narrow, CHECK-constrained
# vocabulary) to a plain-French label/explanation. DOC_EMBEDDED_IMAGES_ONLY,
# PDF_EXTRACTION_FAILURE, and EMPTY_EXTRACTED_TEXT are the only three
# values currently observed among the 66 FAILED rows; the fallback exists
# only for a category this table has not been extended to cover yet - it
# is never reached by the current 750-row population, but must still
# behave honestly (never silently blank, never a fabricated technical
# claim) if the failure-category vocabulary is widened later.
EXTRACTION_FAILURE_CATEGORY_LABELS: "dict[str, str]" = {
    "DOC_EMBEDDED_IMAGES_ONLY": "Échec — document composé d'images, OCR nécessaire",
    "PDF_EXTRACTION_FAILURE": "Échec d'extraction PDF — diagnostic complémentaire nécessaire",
    "EMPTY_EXTRACTED_TEXT": "Échec — aucun texte exploitable obtenu",
}
EXTRACTION_FAILURE_CATEGORY_LABEL_FALLBACK = "Échec d'extraction — catégorie non détaillée"

EXTRACTION_FAILURE_CATEGORY_EXPLANATIONS: "dict[str, str]" = {
    "DOC_EMBEDDED_IMAGES_ONLY": (
        "Le document est composé uniquement d'images scannées ; l'extraction de texte "
        "nécessiterait une reconnaissance optique de caractères (OCR)."
    ),
    "PDF_EXTRACTION_FAILURE": (
        "L'extraction du texte de ce PDF a échoué pour une raison qui nécessite un "
        "diagnostic technique complémentaire."
    ),
    "EMPTY_EXTRACTED_TEXT": "L'extraction a été tentée mais n'a produit aucun texte exploitable.",
}
EXTRACTION_FAILURE_CATEGORY_EXPLANATION_FALLBACK = (
    "L'extraction a échoué pour une catégorie de motif non détaillée davantage dans la base de données."
)


def compute_extraction_status_label(row: ComparisonRow) -> str:
    """Never describes a policy exclusion (NOT_ATTEMPTED + Youssef=NON) as
    a technical failure, and never infers a technical failure for a
    NOT_ATTEMPTED row without evidence - see the module's EXTRACTION-STATE
    EXPLANATION NOTE."""
    if row.extraction_status == "SUCCESS":
        return "Texte extrait avec succès"
    if row.extraction_status == "NOT_ATTEMPTED":
        if row.youssef_decision == "NON":
            return "Extraction non planifiée — document rejeté lors de la revue humaine"
        return "Extraction non réalisée — motif à vérifier"
    if row.extraction_status == "FAILED":
        return EXTRACTION_FAILURE_CATEGORY_LABELS.get(
            row.extraction_failure_category, EXTRACTION_FAILURE_CATEGORY_LABEL_FALLBACK
        )
    return "Statut d'extraction inconnu"  # unreachable given the DB's own CHECK constraint - never silently blank


def compute_extraction_explanation(row: ComparisonRow) -> str:
    """One short sentence: why extraction was deliberately not scheduled,
    or what technical failure occurred, or that it succeeded. Companion
    to compute_extraction_status_label() - same underlying facts, fuller
    sentence form for the dedicated explanation column."""
    if row.extraction_status == "SUCCESS":
        return "Le texte du document a été extrait avec succès et est disponible pour analyse."
    if row.extraction_status == "NOT_ATTEMPTED":
        if row.youssef_decision == "NON":
            return (
                "L'extraction n'a pas été lancée car Youssef a rejeté ce document lors de la "
                "revue humaine ; ce n'est pas un échec technique."
            )
        return "L'extraction n'a pas été réalisée pour ce document et le motif exact reste à vérifier."
    if row.extraction_status == "FAILED":
        return EXTRACTION_FAILURE_CATEGORY_EXPLANATIONS.get(
            row.extraction_failure_category, EXTRACTION_FAILURE_CATEGORY_EXPLANATION_FALLBACK
        )
    return "État d'extraction inconnu."
TECHNICAL_HEADERS = [
    "candidate_id", "archive_file_id", "relative_path (archive)",
    "is_primary_candidate", "duplicate_of_archive_file_id",
    "extraction_status (raw)", "extraction_failure_category (raw)",
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
    already uses). A would-be DESACCORD is instead reported as A_REVOIR
    when the AI's role is in AI_ROLES_AMBIGUOUS_VS_YOUSSEF_OUI - see the
    module's SEMANTIC-EQUIVALENCE NOTE: Youssef's OUI and the AI's
    proposed_role do not ask exactly the same question, so those specific
    mismatches are unresolved ambiguity, not a proven disagreement. This
    only ever relaxes DESACCORD -> A_REVOIR; it never manufactures ACCORD,
    and never touches a row that already agrees."""
    if row.extraction_status == "FAILED":
        return AGREEMENT_ANALYSE_IA_IMPOSSIBLE
    if not row.has_ai_review:
        return AGREEMENT_NON_COMPARE
    if row.youssef_decision == "INCERTAIN":
        return AGREEMENT_A_REVOIR
    youssef_says_usable = row.youssef_decision == "OUI"
    ai_says_usable = row.ai_proposed_role in AI_USABLE_CDC_ROLES
    if youssef_says_usable == ai_says_usable:
        return AGREEMENT_ACCORD
    if row.ai_proposed_role in AI_ROLES_AMBIGUOUS_VS_YOUSSEF_OUI:
        return AGREEMENT_A_REVOIR
    return AGREEMENT_DESACCORD


EXTRACTION_FAILURE_CATEGORY_ACTIONS: "dict[str, str]" = {
    "DOC_EMBEDDED_IMAGES_ONLY": "Préparer un pilote OCR local",
    "PDF_EXTRACTION_FAILURE": "Diagnostiquer le PDF localement avant nouvelle tentative",
    "EMPTY_EXTRACTED_TEXT": "Vérifier si le document est scanné ou endommagé",
}
EXTRACTION_FAILURE_CATEGORY_ACTION_FALLBACK = "Diagnostiquer localement avant nouvelle tentative"


def compute_recommended_action(row: ComparisonRow, agreement: str) -> str:
    """SUCCESS-with-a-current-AI-review rows (ACCORD/DESACCORD/A_REVOIR
    from an actual comparison, i.e. row.has_ai_review is True) keep their
    existing action message unchanged - only the extraction-state-driven
    branches (ANALYSE_IA_IMPOSSIBLE, and NON_COMPARE's two distinct
    causes) were updated for the 2026-09-29 human-readable-explanation
    audit; see Part 3 of that task."""
    if agreement == AGREEMENT_ANALYSE_IA_IMPOSSIBLE:
        return EXTRACTION_FAILURE_CATEGORY_ACTIONS.get(
            row.extraction_failure_category, EXTRACTION_FAILURE_CATEGORY_ACTION_FALLBACK
        )
    if agreement == AGREEMENT_NON_COMPARE:
        if row.extraction_status == "NOT_ATTEMPTED":
            if row.youssef_decision == "NON":
                return "Aucune extraction requise sauf nouvelle décision humaine"
            return "Vérifier le motif avant de planifier une extraction"
        # extraction_status == "SUCCESS" here (FAILED is handled above,
        # under ANALYSE_IA_IMPOSSIBLE) - text exists, no current-model
        # semantic review has run yet.
        return "Lancer la revue IA seulement si le document est dans le périmètre autorisé"
    if agreement == AGREEMENT_A_REVOIR:
        if row.youssef_decision == "INCERTAIN":
            return "Décision Youssef incertaine - revue humaine à compléter"
        return "Rôle IA proche du CDC ou incertain - vérification humaine nécessaire"
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
        compute_extraction_status_label(row),
        row.extraction_method or "",
        row.extraction_failure_category or "",
        compute_extraction_explanation(row),
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
        row.extraction_status, row.extraction_failure_category or "",
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

    agreement_col = VISIBLE_HEADERS.index("Comparaison décision humaine / verdict IA") + 1
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

    # Named by header text (not a hardcoded position) so inserting a new
    # column never silently mis-widens an unrelated one.
    column_widths_by_header = {
        "Projet": 30, "Titre / fichier": 40, "Proposition automatique initiale": 24,
        "Commentaire humain": 24, "Verdict IA": 20, "Explication de l'état d'extraction": 45,
    }
    column_widths = {
        VISIBLE_HEADERS.index(header) + 1: width for header, width in column_widths_by_header.items()
    }
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
    extraction_status_counts: dict = {}
    for row in rows:
        agreement_counts[compute_agreement(row)] += 1
        youssef_counts[row.youssef_decision] += 1
        extraction_status_counts[row.extraction_status] = extraction_status_counts.get(row.extraction_status, 0) + 1

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
    line("État d'extraction (voir la colonne 'Explication de l'état d'extraction')")
    for key in sorted(extraction_status_counts):
        line(f"  {key}", extraction_status_counts[key])
    line("")
    line("Note sur l'état d'extraction (audit du 2026-09-29)")
    line("  NOT_ATTEMPTED signifie que l'extraction n'a jamais été lancée pour ce")
    line("  document. Quand Youssef a répondu NON, il s'agit d'une exclusion de")
    line("  politique volontaire (le document rejeté n'est jamais sélectionné pour")
    line("  extraction) - ce n'est jamais un échec technique. FAILED signifie qu'une")
    line("  extraction a été tentée localement et n'a pas produit de texte exploitable ;")
    line("  la colonne 'Explication de l'état d'extraction' précise la cause pour")
    line("  chaque ligne, sans jamais présenter une exclusion de politique comme un")
    line("  échec technique, ni l'inverse.")
    line("")
    line("Comparaison décision humaine / verdict IA")
    for value in AGREEMENT_VALUES:
        line(f"  {value}", agreement_counts[value])
    line("")
    line("Total désaccords", agreement_counts[AGREEMENT_DESACCORD])
    line("")
    line("Note de méthode (audit sémantique du 2026-09-29)")
    line("  Le OUI de Youssef signifie : le document EST un CDC, OU EN CONTIENT un,")
    line("  utilisable dans la base de connaissances (jugement d'usage large).")
    line("  Le rôle proposé par l'IA est une classification d'identité stricte,")
    line("  une seule valeur parmi le référentiel complet de semantic_review.py.")
    line("  Ces deux notions sont proches mais non identiques : un DESACCORD")
    line("  n'est donc affiché que lorsque le rôle IA est clairement distinct")
    line("  d'un document de référence technique (RFP, OFFER, DAO, DCE, OTHER, ...).")
    line("  Quand le rôle IA est TDR (proche d'un CDC) ou UNKNOWN (l'IA elle-même")
    line("  n'est pas sûre), le cas est classé A_REVOIR : ni la décision de")
    line("  Youssef ni le verdict IA n'est présumé correct ou erroné.")
    line("  Les valeurs brutes (Décision de Youssef, Verdict IA) restent toujours")
    line("  visibles, inchangées, dans leurs propres colonnes sur la feuille principale.")


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


def _ensure_private_output_directory(path: Path) -> None:
    """Creates every path component of `path` that does not yet exist,
    explicitly forcing mode 0o700 on each one this call creates.

    Path.mkdir(parents=True, mode=0o700) only ever applies `mode` to the
    LEAF directory - any intermediate parent it has to create along the
    way gets the process's default/umask-derived mode instead, which can
    leave a private output tree with a lax-permission ancestor. This walks
    the chain one component at a time and os.chmod()s each newly created
    one itself, so `mode=` is never relied on alone.

    Refuses to use ANY existing or newly created path component that is a
    symlink (checked component-by-component, before that component is
    dereferenced) - a symlinked component could otherwise make the
    "private" output tree resolve outside its intended location. Does not
    touch the permissions of a component that already existed."""
    if not path.is_absolute():
        raise ValueError(f"output directory must be an absolute path: {path}")

    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        if current.is_symlink():
            raise PermissionError(f"refusing to use a symlinked path component: {current}")
        if current.exists():
            if not current.is_dir():
                raise NotADirectoryError(f"path component exists and is not a directory: {current}")
            continue
        os.mkdir(current)
        if current.is_symlink():
            raise PermissionError(f"path component became a symlink immediately after creation: {current}")
        os.chmod(current, 0o700)

    final_mode = os.stat(path).st_mode & 0o777
    if final_mode != 0o700:
        raise PermissionError(f"output directory is not mode 700 after creation (found {oct(final_mode)}): {path}")


def run_export(conn, output_path: str, model_name: str, schema_version: str, prompt_hash: str) -> ComparisonSummary:
    rows = fetch_comparison_rows(conn, model_name, prompt_hash, schema_version)
    generated_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    wb = build_workbook(rows, model_name, schema_version, generated_at)

    out = Path(output_path)
    _ensure_private_output_directory(out.parent)
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
