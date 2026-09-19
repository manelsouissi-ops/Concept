#!/usr/bin/env python3
"""Confidential internal Excel candidate-validation workbook (CONCEPT).

persisted candidate (rules + v3 AI proposal, read-only PostgreSQL metadata)
-> one row per candidate in a local .xlsx -> human review by Youssef.

This is the CANDIDATE-VALIDATION workbook, not the 21-criteria CDC
proximity matrix - that matrix is built later, only after Youssef
validates which documents are genuinely CDCs. This script does not
extract, propose, or infer the 21 criteria in any way.

v2 SIMPLIFICATION: the visible "Validation CDC" sheet was deliberately cut
down to 7 columns (Priorité/Année/Projet/Titre-fichier/Proposition
automatique/CDC utilisable ?/Commentaire facultatif) and a single yes/no/
uncertain human question - Youssef is never asked to classify TDR/DAO/RFP/
OFFER, only whether a document is a usable CDC. All the technical detail
the previous version showed on the main sheet (structural scores, v3
evidence flags, JSON status, duplicate/mapping metadata, candidate IDs)
moved to a HIDDEN "Données techniques" sheet that keeps exact row-by-row
correspondence with the visible sheet, so nothing needed for a later
database import is lost.

Explicitly NOT authoritative: services/knowledge-base/cdc_candidate_extractor.py
and its output (services/knowledge-base/output/cdc_candidates_review.xlsx,
a different, older, unrelated file this script never reads or writes) -
see scripts/semantic_review.py's own module docstring for why that
experimental tool was never reused.

SAFETY GUARANTEES
- Reads ONLY existing PostgreSQL metadata (knowledge_base.
  historical_technical_source_candidates, archive_files,
  archive_source_roots, historical_technical_source_ai_reviews). Never
  opens, re-extracts, or re-analyzes a real archive document. Never calls
  Ollama, Docling, or LibreOffice. Never sends anything over a non-local
  connection.
- Writes ONLY the local .xlsx file at the given output path. Never writes
  to PostgreSQL - the "Validation humaine"/"Commentaire du
  validateur"/"Validé par"/"Date de validation" columns are a review
  DELIVERABLE, not a write-back path; importing a human's completed
  decisions back into PostgreSQL is a distinct, later, explicitly separate
  step (scripts/cdc_review.py's existing --review-mark command), never
  performed by this script.
- Never prints a filename, project label, archive path, or client name to
  stdout/stderr - project/file identifiers appear ONLY inside the
  generated .xlsx cells, which is the one place this task explicitly
  authorizes them (an internal, human-review-only deliverable). See
  print_export_summary()/print_verification_summary() for the aggregate-
  only terminal output this script ever produces.
- Never writes extracted document text, excerpts, prompts, raw Ollama
  responses, or chain-of-thought anywhere - only short role/confidence/
  evidence-flag/status values already computed and persisted by
  scripts/cdc_discovery.py (rules) and scripts/semantic_review.py (v3 AI
  proposals).
- Formula-injection hardened: any database-derived string cell beginning
  with "=", "+", "-", or "@" is stored with a leading "'" so it can never
  be interpreted as a spreadsheet formula - see sanitize_cell_value().
- Uses only v3 (schema_version='v3', processing_status='SUCCESS') AI
  reviews for every Ollama-related column - v1/v2 rows are never read by
  this script at all (see fetch_workbook_rows()'s SQL, which filters on
  schema_version = 'v3' inside the LATERAL join).
"""
from __future__ import annotations

import argparse
import datetime
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence

# openpyxl/psycopg are imported lazily where first needed, matching
# scripts/semantic_review.py's convention, so --help and every pure
# function here work without either installed.

DEFAULT_OUTPUT_PATH = "services/knowledge-base/output/cdc_candidates_human_review.xlsx"

WARNING_TEXT = (
    "Les classifications automatiques sont des propositions. "
    "Seule la validation humaine fait foi."
)

# The ONLY human question this workbook asks: is this a usable CDC?
# Deliberately excludes any TDR/DAO/RFP/OFFER classification choice - see
# the module docstring's v2 SIMPLIFICATION note.
HUMAN_VALIDATION_CHOICES: tuple[str, ...] = (
    "À VÉRIFIER",
    "OUI",
    "NON",
    "INCERTAIN",
)
DEFAULT_HUMAN_VALIDATION = "À VÉRIFIER"

BANNER_TEXT = "Lisez le document correspondant, puis indiquez simplement s'il s'agit d'un CDC utilisable."

# The 7 visible columns - nothing else appears on "Validation CDC". All
# other data (structural scores, v3 evidence, IDs, mapping status, ...)
# lives only in the hidden "Données techniques" sheet.
VISIBLE_HEADERS: tuple[str, ...] = (
    "Priorité",
    "Année",
    "Projet",
    "Titre / fichier",
    "Proposition automatique",
    "CDC utilisable ?",
    "Commentaire facultatif",
)
PRIORITY_COL = 1
YEAR_COL = 2
PROJECT_COL = 3
TITLE_COL = 4
PROPOSAL_COL = 5
CDC_COL = 6
COMMENT_COL = 7

# Hidden sheet - full technical detail, one row per visible row, same
# position (row N here == row N on "Validation CDC"). Never includes
# extracted text, excerpts, raw Ollama responses, prompts, chain-of-
# thought, or archive paths (filenames are shown on the VISIBLE sheet
# already - this sheet deliberately does not repeat them, to keep this
# sheet strictly about non-identifying analysis metadata plus the opaque
# IDs a later import needs).
TECHNICAL_HEADERS: tuple[str, ...] = (
    "ID candidat",
    "ID fichier archive",
    "Statut extraction",
    "Erreur extraction",
    "Rôle proposé par les règles",
    "Score structurel",
    "Bande structurelle",
    "Priorité structurelle",
    "Analyse v3 réussie",
    "Rôle proposé par Ollama v3",
    "Confiance Ollama v3",
    "Statut JSON Ollama v3",
    "Portée / périmètre détecté",
    "Exigences techniques détectées",
    "Livrables détectés",
    "Obligations du soumissionnaire détectées",
    "Critères d'évaluation détectés",
    "Mission / tâches détectées",
    "Profils consultants détectés",
    "Instructions d'appel d'offres détectées",
    "Prix / formulaires détectés",
    "Langage d'offre détecté",
    "Doublon",
    "Statut mapping code CONCEPT",
)

NON_ANALYSE = "Non analysé"

_FORMULA_TRIGGER_CHARS = ("=", "+", "-", "@")


def sanitize_cell_value(value):
    """Formula-injection guard: any string beginning with =, +, -, or @ is
    prefixed with a literal apostrophe so it is stored as inert text and
    can never be interpreted as a spreadsheet formula - by openpyxl (which
    only auto-promotes a leading "=" to a formula) or by any spreadsheet
    application that re-opens this file. Non-string values pass through
    unchanged."""
    if isinstance(value, str) and value and value[0] in _FORMULA_TRIGGER_CHARS:
        return "'" + value
    return value


def _oui_non(value: Optional[bool]) -> str:
    if value is None:
        return NON_ANALYSE
    return "OUI" if value else "NON"


# =====================================================================
# Data fetch (metadata only - never opens a document)
# =====================================================================


@dataclass(frozen=True)
class CandidateExportRow:
    candidate_id: str
    archive_file_id: int
    year: Optional[int]
    project_key: Optional[str]
    filename: str
    extension: Optional[str]
    is_primary_candidate: bool
    extraction_status: str
    extraction_failure_category: Optional[str]
    detected_role: str
    structural_score: int
    structural_max: int
    structural_band: str
    review_priority: Optional[str]
    project_mapping_status: str
    v3_proposed_role: Optional[str]
    v3_confidence: Optional[float]
    v3_json_outcome: Optional[str]
    v3_evidence_scope_of_work: Optional[bool]
    v3_evidence_technical_specifications: Optional[bool]
    v3_evidence_required_deliverables: Optional[bool]
    v3_evidence_bidder_obligations: Optional[bool]
    v3_evidence_evaluation_criteria: Optional[bool]
    v3_evidence_mission_or_tasks: Optional[bool]
    v3_evidence_consultant_profiles: Optional[bool]
    v3_evidence_administrative_tender_package: Optional[bool]
    v3_evidence_pricing_or_forms: Optional[bool]
    v3_evidence_bidder_response_language: Optional[bool]

    @property
    def has_v3_review(self) -> bool:
        return self.v3_proposed_role is not None


_FETCH_SQL = """
select
    c.id, c.archive_file_id, c.year, c.detected_role, c.structural_score, c.structural_max,
    c.structural_band, c.review_priority, c.extraction_status, c.extraction_failure_category,
    c.is_primary_candidate, c.project_mapping_status,
    f.relative_path, f.filename, f.extension, r.label,
    v3.proposed_role, v3.confidence, v3.json_outcome,
    v3.evidence_scope_of_work, v3.evidence_technical_specifications, v3.evidence_required_deliverables,
    v3.evidence_bidder_obligations, v3.evidence_evaluation_criteria, v3.evidence_mission_or_tasks,
    v3.evidence_consultant_profiles, v3.evidence_administrative_tender_package,
    v3.evidence_pricing_or_forms, v3.evidence_bidder_response_language
from knowledge_base.historical_technical_source_candidates c
join knowledge_base.archive_files f on f.id = c.archive_file_id
join knowledge_base.archive_source_roots r on r.id = f.source_root_id
left join lateral (
    select ar.*
    from knowledge_base.historical_technical_source_ai_reviews ar
    where ar.archive_file_id = c.archive_file_id
      and ar.schema_version = 'v3'
      and ar.processing_status = 'SUCCESS'
    order by ar.created_at desc
    limit 1
) v3 on true
order by c.id
"""


def fetch_workbook_rows(conn) -> List[CandidateExportRow]:
    """Read-only. relative_path/label are read ONLY to compute the
    existing, authoritative project_key (derive_project_folder_key,
    imported - never reimplemented); they are never printed to a
    terminal, only ever placed into an .xlsx cell by build_workbook()."""
    from cdc_discovery import derive_project_folder_key

    with conn.cursor() as cur:
        cur.execute(_FETCH_SQL)
        rows = cur.fetchall()

    result: List[CandidateExportRow] = []
    for r in rows:
        (
            candidate_id, archive_file_id, year, detected_role, structural_score, structural_max,
            structural_band, review_priority, extraction_status, extraction_failure_category,
            is_primary_candidate, project_mapping_status,
            relative_path, filename, extension, label,
            v3_proposed_role, v3_confidence, v3_json_outcome,
            v3_scope, v3_tech, v3_deliverables, v3_obligations, v3_eval_criteria,
            v3_mission, v3_consultant, v3_admin, v3_pricing, v3_bidder_lang,
        ) = r
        project_key = derive_project_folder_key(relative_path, label)
        result.append(
            CandidateExportRow(
                candidate_id=str(candidate_id), archive_file_id=archive_file_id, year=year,
                project_key=project_key, filename=filename or "", extension=extension,
                is_primary_candidate=bool(is_primary_candidate), extraction_status=extraction_status,
                extraction_failure_category=extraction_failure_category, detected_role=detected_role,
                structural_score=structural_score, structural_max=structural_max,
                structural_band=structural_band, review_priority=review_priority,
                project_mapping_status=project_mapping_status,
                v3_proposed_role=v3_proposed_role, v3_confidence=float(v3_confidence) if v3_confidence is not None else None,
                v3_json_outcome=v3_json_outcome,
                v3_evidence_scope_of_work=v3_scope, v3_evidence_technical_specifications=v3_tech,
                v3_evidence_required_deliverables=v3_deliverables, v3_evidence_bidder_obligations=v3_obligations,
                v3_evidence_evaluation_criteria=v3_eval_criteria, v3_evidence_mission_or_tasks=v3_mission,
                v3_evidence_consultant_profiles=v3_consultant,
                v3_evidence_administrative_tender_package=v3_admin,
                v3_evidence_pricing_or_forms=v3_pricing, v3_evidence_bidder_response_language=v3_bidder_lang,
            )
        )
    return result


# =====================================================================
# Review-priority ordering (pure - no DB/filesystem access)
# =====================================================================

_TDR_FAMILY = ("TDR", "DAO_WITH_TDR", "DAO", "RFP")

# Automatic-proposal French labels (task's exact required vocabulary).
# Never claims certainty - see BANNER_TEXT/Instructions sheet for the
# "assistance only" disclaimer shown near the table.
_ROLE_TO_PROPOSAL_LABEL = {
    "CDC": "CDC probable",
    "DAO_WITH_CDC": "DAO contenant un CDC probable",
    "TDR": "TDR probable",
    "DAO_WITH_TDR": "DAO/TDR probable",
    "DAO": "DAO probable",
    "RFP": "RFP probable",
    "OFFER": "Offre probable",
    "OTHER": "Autre document",
    "UNKNOWN": NON_ANALYSE,
    "DCE": "Autre document",
    "REPORT": "Autre document",
    "METHODOLOGY": "Autre document",
}


def compute_automatic_proposal_label(row: CandidateExportRow) -> str:
    """Prefers the successful v3 AI proposal; falls back to the
    deterministic rule-based role when no v3 review exists. Extraction
    failure/absence always wins over any role (a role can never be
    meaningfully proposed for a document that was never read) - matches
    fetch_year_candidate_rows'/select_eligible_candidates' own convention
    of only ever attempting a v3 review when extraction_status='SUCCESS',
    so this ordering never actually conflicts with a real v3 result in
    practice, only defends the display logic itself."""
    if row.extraction_status == "FAILED":
        return "Extraction impossible"
    if row.extraction_status == "NOT_ATTEMPTED":
        return NON_ANALYSE
    role = row.v3_proposed_role if row.has_v3_review else row.detected_role
    return _ROLE_TO_PROPOSAL_LABEL.get(role, NON_ANALYSE)


def compute_review_priority_group(row: CandidateExportRow) -> int:
    """1=Ollama OR rules propose CDC, 2=Ollama OR rules propose
    DAO_WITH_CDC, 3=TDR family (TDR/DAO_WITH_TDR/DAO/RFP, Ollama or
    rules), 4=OFFER/OTHER/UNKNOWN/other roles, 5=extraction FAILED,
    6=NOT_ATTEMPTED. Checked in this exact order - a row matching an
    earlier condition never falls through to a later one."""
    if row.v3_proposed_role == "CDC" or row.detected_role == "CDC":
        return 1
    if row.v3_proposed_role == "DAO_WITH_CDC" or row.detected_role == "DAO_WITH_CDC":
        return 2
    if row.v3_proposed_role in _TDR_FAMILY or row.detected_role in _TDR_FAMILY:
        return 3
    if row.extraction_status == "FAILED":
        return 5
    if row.extraction_status == "NOT_ATTEMPTED":
        return 6
    return 4


def sort_key(row: CandidateExportRow) -> tuple:
    return (
        compute_review_priority_group(row),
        row.year if row.year is not None else 9999,
        row.project_key or "",
        row.filename or "",
    )


def order_rows_for_review(rows: Sequence[CandidateExportRow]) -> List[CandidateExportRow]:
    return sorted(rows, key=sort_key)


# =====================================================================
# Workbook construction (pure w.r.t. DB/filesystem - takes already-fetched
# rows; the only I/O is the final .xlsx save, done by run_export())
# =====================================================================


@dataclass
class WorkbookMetadata:
    generated_at: str
    model_name: str
    schema_version: str
    semantic_classifier_version: str
    prompt_hash: str


def build_row_cells(row: CandidateExportRow) -> list:
    """One list of 7 raw (unsanitized) values, in VISIBLE_HEADERS order.
    Formula-injection sanitization is applied by the caller
    (build_workbook), not here, so this stays trivially testable against
    raw expected values."""
    return [
        compute_review_priority_group(row),
        row.year if row.year is not None else "",
        row.project_key or "",
        row.filename,
        compute_automatic_proposal_label(row),
        DEFAULT_HUMAN_VALIDATION,
        "",  # Commentaire facultatif
    ]


def build_technical_row_cells(row: CandidateExportRow) -> list:
    """One list of TECHNICAL_HEADERS-shaped values for the hidden
    "Données techniques" sheet - never document text/excerpts/raw
    responses/prompts/chain-of-thought/archive paths, only short codes
    and IDs. Written at the SAME row position as build_row_cells' output
    for the same candidate, which is what gives the two sheets their
    required one-to-one correspondence (see build_workbook)."""
    structural_score = f"{row.structural_score}/{row.structural_max}" if row.structural_max else str(row.structural_score)
    if row.has_v3_review:
        v3_confidence = f"{row.v3_confidence:.2f}" if row.v3_confidence is not None else ""
        evidence = (
            _oui_non(row.v3_evidence_scope_of_work), _oui_non(row.v3_evidence_technical_specifications),
            _oui_non(row.v3_evidence_required_deliverables), _oui_non(row.v3_evidence_bidder_obligations),
            _oui_non(row.v3_evidence_evaluation_criteria), _oui_non(row.v3_evidence_mission_or_tasks),
            _oui_non(row.v3_evidence_consultant_profiles), _oui_non(row.v3_evidence_administrative_tender_package),
            _oui_non(row.v3_evidence_pricing_or_forms), _oui_non(row.v3_evidence_bidder_response_language),
        )
    else:
        v3_confidence = ""
        evidence = ("",) * 10

    return [
        row.candidate_id,
        row.archive_file_id,
        row.extraction_status,
        row.extraction_failure_category or "",
        row.detected_role,
        structural_score,
        row.structural_band,
        row.review_priority or "",
        "OUI" if row.has_v3_review else "NON",
        row.v3_proposed_role or "",
        v3_confidence,
        row.v3_json_outcome or "",
        *evidence,
        "NON" if row.is_primary_candidate else "OUI",
        row.project_mapping_status,
    ]


def build_workbook(rows: Sequence[CandidateExportRow], metadata: WorkbookMetadata):
    """Pure w.r.t. I/O - returns an in-memory openpyxl Workbook, never
    saves it (run_export() does that, to the one authorized output path).
    Fully unit-testable with synthetic CandidateExportRow values."""
    from openpyxl import Workbook
    from openpyxl.formatting.rule import CellIsRule
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation

    ordered = order_rows_for_review(rows)
    n = len(VISIBLE_HEADERS)

    wb = Workbook()
    ws = wb.active
    ws.title = "Validation CDC"

    banner_fill = PatternFill(start_color="FFDDEBF7", end_color="FFDDEBF7", fill_type="solid")
    header_fill = PatternFill(start_color="FF2F5496", end_color="FF2F5496", fill_type="solid")
    header_font = Font(color="FFFFFFFF", bold=True, size=13)
    header_alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
    band_fill = PatternFill(start_color="FFF2F2F2", end_color="FFF2F2F2", fill_type="solid")
    green_fill = PatternFill(start_color="FFC6EFCE", end_color="FFC6EFCE", fill_type="solid")
    red_fill = PatternFill(start_color="FFFFC7CE", end_color="FFFFC7CE", fill_type="solid")
    orange_fill = PatternFill(start_color="FFFCE4D6", end_color="FFFCE4D6", fill_type="solid")
    grey_fill = PatternFill(start_color="FFD9D9D9", end_color="FFD9D9D9", fill_type="solid")
    yellow_fill = PatternFill(start_color="FFFFF2CC", end_color="FFFFF2CC", fill_type="solid")

    # Row 1: visible instruction banner, merged across all 7 columns.
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=n)
    banner_cell = ws.cell(row=1, column=1, value=sanitize_cell_value(BANNER_TEXT))
    banner_cell.font = Font(bold=True, size=12, color="FF1F4E78")
    banner_cell.fill = banner_fill
    banner_cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 30

    # Row 2: headers.
    for col_index, header in enumerate(VISIBLE_HEADERS, start=1):
        cell = ws.cell(row=2, column=col_index, value=sanitize_cell_value(header))
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_alignment
    ws.row_dimensions[2].height = 34
    ws.cell(row=2, column=CDC_COL).fill = PatternFill(start_color="FF7F6000", end_color="FF7F6000", fill_type="solid")

    # Data starts row 3.
    first_data_row = 3
    for offset, row in enumerate(ordered):
        row_index = first_data_row + offset
        values = build_row_cells(row)
        is_band_row = (offset % 2 == 1)
        for col_index, raw_value in enumerate(values, start=1):
            cell = ws.cell(row=row_index, column=col_index, value=sanitize_cell_value(raw_value))
            if is_band_row:
                cell.fill = band_fill

    last_row = first_data_row + len(ordered) - 1 if ordered else first_data_row - 1
    last_col_letter = get_column_letter(n)
    ws.freeze_panes = "A3"
    if ordered:
        ws.auto_filter.ref = f"A2:{last_col_letter}{last_row}"

    column_widths = {1: 10, 2: 10, 3: 32, 4: 42, 5: 26, 6: 18, 7: 42}
    for col_index, width in column_widths.items():
        ws.column_dimensions[get_column_letter(col_index)].width = width

    # CDC utilisable ? dropdown + live colour-coding by selected value
    # (conditional formatting - never a cell formula, never derived from
    # database values; it only reacts to the human's OWN choice in this
    # same column).
    if ordered:
        cdc_letter = get_column_letter(CDC_COL)
        data_range = f"{cdc_letter}{first_data_row}:{cdc_letter}{last_row}"
        dv = DataValidation(
            type="list", formula1=f"Listes!$A$1:$A${len(HUMAN_VALIDATION_CHOICES)}",
            allow_blank=False, showDropDown=False,
        )
        dv.error = "Veuillez choisir une valeur dans la liste."
        dv.errorTitle = "Valeur invalide"
        ws.add_data_validation(dv)
        dv.add(data_range)

        ws.conditional_formatting.add(data_range, CellIsRule(operator="equal", formula=['"OUI"'], fill=green_fill))
        ws.conditional_formatting.add(data_range, CellIsRule(operator="equal", formula=['"NON"'], fill=red_fill))
        ws.conditional_formatting.add(data_range, CellIsRule(operator="equal", formula=['"INCERTAIN"'], fill=orange_fill))
        ws.conditional_formatting.add(data_range, CellIsRule(operator="equal", formula=['"À VÉRIFIER"'], fill=grey_fill))

    # Hidden dropdown-source sheet.
    listes = wb.create_sheet("Listes")
    listes.sheet_state = "hidden"
    for i, choice in enumerate(HUMAN_VALIDATION_CHOICES, start=1):
        listes.cell(row=i, column=1, value=sanitize_cell_value(choice))

    # Hidden technical sheet - same row positions as "Validation CDC".
    technical = wb.create_sheet("Données techniques")
    technical.sheet_state = "hidden"
    _build_technical_sheet(technical, ordered)

    resume = wb.create_sheet("Résumé")
    _build_resume_sheet(resume, rows)

    instructions = wb.create_sheet("Instructions")
    _build_instructions_sheet(instructions)

    wb.move_sheet("Validation CDC", offset=-len(wb.sheetnames))
    return wb


def _build_technical_sheet(ws, ordered_rows: Sequence[CandidateExportRow]) -> None:
    from openpyxl.styles import Font

    ws.cell(
        row=1, column=1,
        value=sanitize_cell_value(
            "Feuille technique - ne pas modifier. Correspondance exacte ligne à ligne avec 'Validation CDC' "
            "(la ligne N ici correspond toujours à la ligne N de 'Validation CDC')."
        ),
    ).font = Font(bold=True)
    for col_index, header in enumerate(TECHNICAL_HEADERS, start=1):
        ws.cell(row=2, column=col_index, value=sanitize_cell_value(header)).font = Font(bold=True)

    for offset, row in enumerate(ordered_rows):
        row_index = 3 + offset
        values = build_technical_row_cells(row)
        for col_index, raw_value in enumerate(values, start=1):
            ws.cell(row=row_index, column=col_index, value=sanitize_cell_value(raw_value))


def _build_resume_sheet(ws, rows: Sequence[CandidateExportRow]) -> None:
    from openpyxl.styles import Font

    bold = Font(bold=True)
    r = 1
    ws.cell(row=r, column=1, value=sanitize_cell_value(WARNING_TEXT)).font = Font(bold=True, color="FFC00000")
    r += 2

    def line(label, value=""):
        nonlocal r
        ws.cell(row=r, column=1, value=sanitize_cell_value(label)).font = bold
        ws.cell(row=r, column=2, value=sanitize_cell_value(value))
        r += 1

    total = len(rows)
    counts = {choice: 0 for choice in HUMAN_VALIDATION_CHOICES}
    for row in rows:
        counts[DEFAULT_HUMAN_VALIDATION] += 1  # every row starts at the default - no human decision exists yet
    extraction_impossible = sum(1 for row in rows if row.extraction_status == "FAILED")
    analysed_v3 = sum(1 for row in rows if row.has_v3_review)

    line("Total documents", total)
    line("À vérifier", counts["À VÉRIFIER"])
    line("Oui", counts["OUI"])
    line("Non", counts["NON"])
    line("Incertain", counts["INCERTAIN"])
    line("Extraction impossible", extraction_impossible)
    line("Analysés par Ollama v3", analysed_v3)

    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 16


def _build_instructions_sheet(ws) -> None:
    from openpyxl.styles import Font

    bold = Font(bold=True)
    rows_content = [
        (WARNING_TEXT, True),
        ("", False),
        ("Comment utiliser ce classeur", True),
        ("1. Ouvrez la feuille \"Validation CDC\".", False),
        ("2. Pour chaque ligne, retrouvez et lisez le document correspondant (Année / Projet / Titre-fichier).", False),
        ("3. Choisissez une valeur dans la liste déroulante de la colonne \"CDC utilisable ?\".", False),
        ("4. Ajoutez un commentaire si nécessaire (facultatif).", False),
        ("", False),
        ("Les 4 choix possibles", True),
        ("OUI : le document est un CDC, ou contient un CDC, utilisable dans la base de connaissances historique.", False),
        ("NON : ce n'est pas un CDC utilisable.", False),
        ("INCERTAIN : vous ne pouvez pas décider sans vérification supplémentaire.", False),
        ("À VÉRIFIER : aucune décision n'a encore été prise (valeur de départ de toutes les lignes).", False),
        ("", False),
        ("La colonne \"Proposition automatique\"", True),
        ("C'est une aide, jamais la réponse finale - seule votre validation humaine fait foi. Vous n'avez PAS besoin "
         "de classer le document par type (TDR/DAO/RFP/OFFRE) : seule la question \"CDC utilisable ?\" compte.", False),
        ("", False),
        ("Ce classeur n'écrit jamais automatiquement dans la base de données - vos réponses seront importées "
         "séparément, plus tard, via un outil dédié.", False),
    ]
    r = 1
    for text, is_bold in rows_content:
        cell = ws.cell(row=r, column=1, value=sanitize_cell_value(text))
        if is_bold:
            cell.font = Font(bold=True, color="FFC00000" if r == 1 else "FF000000")
        r += 1
    ws.column_dimensions["A"].width = 120


# =====================================================================
# Export orchestration
# =====================================================================


@dataclass
class ExportSummary:
    output_path: str
    total_rows: int
    by_extraction_status: dict
    v3_success_count: int
    awaiting_review_count: int


def run_export(conn, output_path: str, model_name: str, schema_version: str,
                semantic_classifier_version: str, prompt_hash: str) -> ExportSummary:
    rows = fetch_workbook_rows(conn)
    metadata = WorkbookMetadata(
        generated_at=datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
        model_name=model_name, schema_version=schema_version,
        semantic_classifier_version=semantic_classifier_version, prompt_hash=prompt_hash,
    )
    wb = build_workbook(rows, metadata)

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(out))

    by_extraction: dict = {"SUCCESS": 0, "FAILED": 0, "NOT_ATTEMPTED": 0}
    v3_success = 0
    for row in rows:
        by_extraction[row.extraction_status] = by_extraction.get(row.extraction_status, 0) + 1
        if row.has_v3_review:
            v3_success += 1

    return ExportSummary(
        output_path=str(out), total_rows=len(rows), by_extraction_status=by_extraction,
        v3_success_count=v3_success, awaiting_review_count=len(rows),
    )


def print_export_summary(summary: ExportSummary) -> None:
    print("=== export_cdc_review_workbook.py (aggregate only) ===")
    print(f"output path: {summary.output_path}")
    print(f"total candidate rows: {summary.total_rows}")
    for status in ("SUCCESS", "FAILED", "NOT_ATTEMPTED"):
        print(f"extraction {status}: {summary.by_extraction_status.get(status, 0)}")
    print(f"rows with a successful v3 proposal: {summary.v3_success_count}")
    print(f"rows awaiting review (all rows, default {DEFAULT_HUMAN_VALIDATION}): {summary.awaiting_review_count}")
    print("document/Ollama/external calls: 0")
    print("database writes: 0")


def _connect(database_url: str):
    import psycopg  # lazy import

    return psycopg.connect(database_url)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="export_cdc_review_workbook.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--output", default=DEFAULT_OUTPUT_PATH, help=f"Output .xlsx path (default: {DEFAULT_OUTPUT_PATH}).")
    parser.add_argument("--model", default="qwen3:14b", help="Model name to record in Résumé (default: qwen3:14b).")
    parser.add_argument("--schema-version", default="v3", help="Schema version to record and filter v3 reviews by (default: v3).")
    parser.add_argument("--semantic-classifier-version", default="v3", help="Classifier version to record in Résumé (default: v3).")
    return parser


def main(argv: Optional[list] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 2

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from semantic_review import compute_prompt_hash

    conn = _connect(database_url)
    try:
        summary = run_export(
            conn, args.output, args.model, args.schema_version,
            args.semantic_classifier_version, compute_prompt_hash(),
        )
        print_export_summary(summary)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
