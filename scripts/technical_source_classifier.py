#!/usr/bin/env python3
"""Historical technical-source document-role and structural-fingerprint
classification (full-corpus discovery, Phase 5).

WHY THIS MODULE EXISTS
scripts/cdc_content_inspector.py's existing decide_content_verification()
answers a narrow, binary question: "is this document, as a whole, a pure
Cahier des Charges?". The real 25-project pilot proved that question is too
narrow for the actual business objective: the historical documents CONCEPT
needs to find are frequently a DAO/Appel d'Offres WRAPPER that CONTAINS a
Termes de Reference or Cahier des Charges SECTION alongside instructions to
bidders, evaluation criteria, etc. Forcing that shape into "CDC or not CDC"
either loses it entirely (wrapper role != CDC) or wrongly promotes an
administrative document.

This module adds a second, independent classification DIMENSION -
"what document role is this, and how much genuine technical-specification
structure does it contain" - without touching or weakening the existing
CDC-specific verification in cdc_content_inspector.py. Both dimensions are
computed side by side; scripts/cdc_discovery.py's build_technical_source_candidate
is what actually decides review priority using this module's output.

SAFETY GUARANTEES (same guarantees as cdc_content_inspector.py)
- Pure, deterministic, local, stdlib-only. No I/O, no subprocess, no
  network call, no filesystem access anywhere in this module.
- Every public function takes already-extracted text and returns only
  short role labels, integer/float scores, and boolean section flags -
  never a matched excerpt, filename, or path.
- No cloud dependency, no mandatory AI. This module does not import or
  invoke Ollama/any AI adapter at all - see cdc_content_inspector.py's
  OllamaAiAdapter for the existing, still-optional, local-only AI stage
  that MAY be layered on top of this module's output for ambiguous cases
  (Task 7 of the full-corpus discovery task) but is never required by it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

# =====================================================================
# Task 2 - document-role taxonomy
# =====================================================================

TECHNICAL_SOURCE_ROLES: tuple[str, ...] = (
    "CDC",
    "TDR",
    "DAO_WITH_TDR",
    "DAO_WITH_CDC",
    "DAO",
    "DCE",
    "RFP",
    "OFFER",
    "REPORT",
    "METHODOLOGY",
    "OTHER",
    "UNKNOWN",
)

# Roles that are ALWAYS a valid historical technical-source candidate,
# regardless of structural score - the wrapper/role signal alone is
# sufficient evidence (Task 5: "Do not reject it because its overall
# wrapper is DAO" - a DAO_WITH_TDR/DAO_WITH_CDC IS the target document).
_ALWAYS_TECHNICAL_SOURCE_ROLES = frozenset({"CDC", "TDR", "DAO_WITH_TDR", "DAO_WITH_CDC", "DCE", "RFP"})

# Roles that are CONCEPT-produced deliverables, not a client technical
# specification - never a technical-source candidate regardless of how
# structurally rich they look (a report can legitimately discuss scope,
# deliverables, methodology, etc. without being a source document).
_NEVER_TECHNICAL_SOURCE_ROLES = frozenset({"OFFER", "REPORT", "METHODOLOGY"})

# Everything else (DAO, OTHER, UNKNOWN) is a candidate only if the
# structural fingerprint independently shows real technical-specification
# content - see classify_technical_source().


# =====================================================================
# Role-detection patterns. Deliberately conservative for the WRAPPER
# signals (DAO/RFP/DCE) - a bare "ao" or "offre" is common French business
# vocabulary and would be far too noisy as a role signal (it is however a
# valid, deliberately noisy Stage A PREFILTER term - see below, which is a
# different, lower-precision purpose by design).
# =====================================================================

_CDC_SECTION_PATTERN = re.compile(r"cahier\s+des\s+charges", re.IGNORECASE)
_TDR_SECTION_PATTERN = re.compile(r"termes?\s+de\s+r[ée]f[ée]rence|\btdr\b", re.IGNORECASE)
_DAO_WRAPPER_PATTERN = re.compile(
    r"dossier\s+d.?appel\s+d.?offres?|appel\s+d.?offres?|\bdao\b", re.IGNORECASE
)
_DCE_PATTERN = re.compile(r"\bdce\b|dossier\s+de\s+consultation", re.IGNORECASE)
_RFP_PATTERN = re.compile(r"\brfp\b|request\s+for\s+proposals?", re.IGNORECASE)
_OFFER_PATTERN = re.compile(
    r"notre\s+offre|offre\s+technique\s+et\s+financi[èe]re|proposition\s+technique", re.IGNORECASE
)
_REPORT_PATTERN = re.compile(
    r"rapport\s+(de\s+mission|d.?avancement|final|provisoire)|compte[\s-]rendu", re.IGNORECASE
)
_METHODOLOGY_PATTERN = re.compile(r"note\s+m[ée]thodologique|m[ée]thodologie\s+propos[ée]e", re.IGNORECASE)
_WEAK_OTHER_SIGNAL_PATTERN = re.compile(
    r"march[ée]|consultation|prestations?|mission|contrat", re.IGNORECASE
)


def classify_technical_source_role(text: str) -> str:
    """Detects the document's role, INCLUDING the mixed-document cases
    (Task 5) - a DAO wrapper containing an embedded TDR or CDC section is
    classified as DAO_WITH_TDR / DAO_WITH_CDC, never forced into a pure
    CDC/TDR/DAO bucket. Checked in priority order: mixed roles first (most
    specific and most business-relevant), then pure roles, from strongest
    signal to weakest. Returns exactly one of TECHNICAL_SOURCE_ROLES."""
    has_cdc = bool(_CDC_SECTION_PATTERN.search(text))
    has_tdr = bool(_TDR_SECTION_PATTERN.search(text))
    has_dao_wrapper = bool(_DAO_WRAPPER_PATTERN.search(text))

    if has_dao_wrapper and has_tdr:
        return "DAO_WITH_TDR"
    if has_dao_wrapper and has_cdc:
        return "DAO_WITH_CDC"
    if has_cdc:
        return "CDC"
    if has_tdr:
        return "TDR"
    if has_dao_wrapper:
        return "DAO"
    if _DCE_PATTERN.search(text):
        return "DCE"
    if _RFP_PATTERN.search(text):
        return "RFP"
    if _OFFER_PATTERN.search(text):
        return "OFFER"
    if _REPORT_PATTERN.search(text):
        return "REPORT"
    if _METHODOLOGY_PATTERN.search(text):
        return "METHODOLOGY"
    if _WEAK_OTHER_SIGNAL_PATTERN.search(text):
        return "OTHER"
    return "UNKNOWN"


# =====================================================================
# Task 3 - weighted structural technical-source fingerprint
# =====================================================================

# Signal name -> (weight, pattern). Weights are constants, not magic
# numbers scattered through the scoring function, so they stay testable
# and tunable without touching classify logic (Task 3: "Do NOT hardcode
# the exact threshold blindly... Thresholds must be constants and
# testable" applies equally to these weights).
STRUCTURAL_SIGNAL_PATTERNS: dict[str, "re.Pattern[str]"] = {
    "context_or_justification": re.compile(
        r"contexte|justification|rappel\s+du\s+contexte|\bbackground\b", re.IGNORECASE
    ),
    "objectives": re.compile(r"objectifs?\b|\bobjectives?\b", re.IGNORECASE),
    "scope_or_prestations": re.compile(
        r"[ée]tendue\s+des\s+prestations|prestations?\s+demand[ée]es?|"
        r"objet\s+de\s+la\s+mission|scope\s+of\s+(work|services)",
        re.IGNORECASE,
    ),
    "technical_requirements": re.compile(
        r"sp[ée]cifications?\s+techniques?|exigences?\s+techniques?|technical\s+requirements?",
        re.IGNORECASE,
    ),
    "mission_phases": re.compile(
        r"phases?\s+de\s+la\s+mission|[ée]tapes?\s+de\s+la\s+mission|\bphase\s+\d", re.IGNORECASE
    ),
    "methodology_requirements": re.compile(
        r"m[ée]thodologie|approche\s+m[ée]thodologique|\bmethodology\b", re.IGNORECASE
    ),
    "required_personnel": re.compile(
        r"personnel\s+requis|experts?\s+requis|[ée]quipe\s+propos[ée]e|"
        r"key\s+personnel|required\s+experts?",
        re.IGNORECASE,
    ),
    "required_experience": re.compile(
        r"exp[ée]rience\s+(requise|similaire|demand[ée]e)|qualifications?\s+requises?", re.IGNORECASE
    ),
    "deliverables": re.compile(r"livrables?|\bdeliverables?\b", re.IGNORECASE),
    "calendar_or_duration": re.compile(
        r"calendrier|dur[ée]e\s+de\s+la\s+mission|\bplanning\b|duration\s+of\s+the\s+(mission|assignment)",
        re.IGNORECASE,
    ),
    "evaluation_criteria": re.compile(
        r"crit[èe]res?\s+d.?[ée]valuation|m[ée]thode\s+d.?[ée]valuation|evaluation\s+criteria",
        re.IGNORECASE,
    ),
    "bidder_obligations": re.compile(
        r"obligations?\s+du\s+(soumissionnaire|consultant|prestataire)|bidder.?s?\s+obligations?",
        re.IGNORECASE,
    ),
    "administrative_requirements": re.compile(
        r"pi[èe]ces?\s+administratives?|documents?\s+administratifs?|administrative\s+requirements?",
        re.IGNORECASE,
    ),
    "payment_or_contract_conditions": re.compile(
        r"conditions?\s+de\s+paiement|modalit[ée]s?\s+de\s+paiement|"
        r"conditions?\s+contractuelles?|payment\s+(terms|conditions)",
        re.IGNORECASE,
    ),
}

# Important technical signals are weighted more heavily than administrative/
# secondary ones (Task 3's explicit example weighting).
STRUCTURAL_SIGNAL_WEIGHTS: dict[str, int] = {
    "context_or_justification": 1,
    "objectives": 1,
    "scope_or_prestations": 2,
    "technical_requirements": 2,
    "mission_phases": 1,
    "methodology_requirements": 1,
    "required_personnel": 1,
    "required_experience": 1,
    "deliverables": 2,
    "calendar_or_duration": 1,
    "evaluation_criteria": 1,
    "bidder_obligations": 1,
    "administrative_requirements": 1,
    "payment_or_contract_conditions": 1,
}

STRUCTURAL_MAX_SCORE = sum(STRUCTURAL_SIGNAL_WEIGHTS.values())

# Band thresholds on structural_ratio (structural_score / STRUCTURAL_MAX_SCORE).
# Named constants, not inlined magic numbers - directly testable/tunable
# (Task 3) without touching compute_structural_fingerprint's logic.
STRUCTURAL_BAND_STRONG_RATIO = 0.6
STRUCTURAL_BAND_POSSIBLE_RATIO = 0.3

STRUCTURAL_BANDS: tuple[str, ...] = (
    "STRONG_TECHNICAL_SOURCE",
    "POSSIBLE_TECHNICAL_SOURCE",
    "WEAK_TECHNICAL_SOURCE",
)


@dataclass(frozen=True)
class StructuralFingerprint:
    signals: dict  # signal name -> bool, never raw matched text
    score: int
    max_score: int
    ratio: float
    band: str


def classify_structural_band(ratio: float) -> str:
    if ratio >= STRUCTURAL_BAND_STRONG_RATIO:
        return "STRONG_TECHNICAL_SOURCE"
    if ratio >= STRUCTURAL_BAND_POSSIBLE_RATIO:
        return "POSSIBLE_TECHNICAL_SOURCE"
    return "WEAK_TECHNICAL_SOURCE"


def compute_structural_fingerprint(text: str) -> StructuralFingerprint:
    """Deterministic, weighted structural scoring over already-extracted
    text (Task 3). Supports accented/unaccented and French/English
    variants via the patterns above - no exact section-title match is
    required (Task 6)."""
    signals = {name: bool(pattern.search(text)) for name, pattern in STRUCTURAL_SIGNAL_PATTERNS.items()}
    score = sum(STRUCTURAL_SIGNAL_WEIGHTS[name] for name, matched in signals.items() if matched)
    ratio = score / STRUCTURAL_MAX_SCORE
    return StructuralFingerprint(
        signals=signals, score=score, max_score=STRUCTURAL_MAX_SCORE, ratio=ratio,
        band=classify_structural_band(ratio),
    )


# =====================================================================
# Task 6 - safe section-level flags. A subset of the structural signals,
# exposed under the exact names Task 6 asks for, plus the two role-derived
# section flags (has_tdr_section/has_cdc_section) that are not scoring
# signals but ARE part of section detection.
# =====================================================================

_SECTION_FLAG_TO_SIGNAL = {
    "has_context_section": "context_or_justification",
    "has_objectives_section": "objectives",
    "has_scope_section": "scope_or_prestations",
    "has_deliverables_section": "deliverables",
    "has_personnel_section": "required_personnel",
    "has_evaluation_section": "evaluation_criteria",
}


def build_section_flags(text: str, fingerprint: StructuralFingerprint) -> dict:
    flags = {name: fingerprint.signals[signal] for name, signal in _SECTION_FLAG_TO_SIGNAL.items()}
    flags["has_tdr_section"] = bool(_TDR_SECTION_PATTERN.search(text))
    flags["has_cdc_section"] = bool(_CDC_SECTION_PATTERN.search(text))
    return flags


# =====================================================================
# Task 10 - review priority bands
# =====================================================================

REVIEW_PRIORITIES: tuple[str, ...] = ("HIGH_PRIORITY", "MEDIUM_PRIORITY", "EXTRACTION_FAILED")

_HIGH_PRIORITY_ROLES = frozenset({"CDC", "TDR", "DAO_WITH_TDR", "DAO_WITH_CDC"})


def _decide_review_priority(detected_role: str, technical_source_candidate: bool, band: str) -> Optional[str]:
    """None means "not queued at all" - ordinary NOT_CDC-equivalent
    documents (Task 10: "Do NOT automatically include ordinary NOT_CDC
    documents"). EXTRACTION_FAILED is never assigned here - only by the
    orchestration layer (scripts/cdc_discovery.py), which is the only
    place that knows extraction itself failed."""
    if not technical_source_candidate:
        return None
    if detected_role in _HIGH_PRIORITY_ROLES:
        return "HIGH_PRIORITY"
    if detected_role in ("DCE", "RFP") and band == "STRONG_TECHNICAL_SOURCE":
        return "HIGH_PRIORITY"
    # Everything else that still qualified as a candidate (DCE/RFP with a
    # weaker band, or a DAO/OTHER/UNKNOWN wrapper whose structural score
    # alone earned candidacy) is a real but less certain lead.
    return "MEDIUM_PRIORITY"


# =====================================================================
# Top-level classification
# =====================================================================


@dataclass(frozen=True)
class TechnicalSourceClassification:
    detected_role: str
    technical_source_candidate: bool
    structural_score: int
    structural_max: int
    structural_ratio: float
    structural_band: str
    section_flags: dict
    review_priority: Optional[str]


def classify_technical_source(text: str) -> TechnicalSourceClassification:
    """Task 2/3/5/6/10 combined. Pure function over already-extracted
    text - never touches a file, never returns raw text. This is the one
    function scripts/cdc_content_inspector.py's LocalContentInspector
    calls for every successfully-extracted document (not gated on the
    separate, narrower CDC-only verification in that module)."""
    detected_role = classify_technical_source_role(text)
    fingerprint = compute_structural_fingerprint(text)

    if detected_role in _ALWAYS_TECHNICAL_SOURCE_ROLES:
        technical_source_candidate = True
    elif detected_role in _NEVER_TECHNICAL_SOURCE_ROLES:
        technical_source_candidate = False
    else:
        # DAO / OTHER / UNKNOWN: only a candidate if the structural
        # fingerprint independently shows real technical-specification
        # content - never rejected purely because the role label itself
        # is not one of the tender-family roles.
        technical_source_candidate = fingerprint.band in (
            "STRONG_TECHNICAL_SOURCE",
            "POSSIBLE_TECHNICAL_SOURCE",
        )

    review_priority = _decide_review_priority(detected_role, technical_source_candidate, fingerprint.band)

    return TechnicalSourceClassification(
        detected_role=detected_role,
        technical_source_candidate=technical_source_candidate,
        structural_score=fingerprint.score,
        structural_max=fingerprint.max_score,
        structural_ratio=fingerprint.ratio,
        structural_band=fingerprint.band,
        section_flags=build_section_flags(text, fingerprint),
        review_priority=review_priority,
    )


# =====================================================================
# Task 4 - Stage A fast metadata prefilter. Deliberately noisy/high-recall:
# metadata alone NEVER produces a final role/validation decision - it only
# decides whether a file is worth Stage B content inspection at all.
# =====================================================================

RELEVANT_TECHNICAL_BUCKETS = ("BUSINESS_DOCUMENT",)
RELEVANT_EXTENSIONS = ("pdf", "doc", "docx", "odt", "rtf")
# Only counted relevant when the filename ALSO matched a strong term -
# spreadsheets are common for budgets/schedules unrelated to CDC/TDR
# content, so extension alone is not justification (Task 4).
CONDITIONALLY_RELEVANT_EXTENSIONS = ("xls", "xlsx")

_PREFILTER_TERM_PATTERN = re.compile(
    r"\bcdc\b|cahier[\s._-]*des[\s._-]*charges|"
    r"termes?[\s._-]*de[\s._-]*r[ée]f[ée]rence|\btdr\b|"
    r"\bdao\b|dossier[\s._-]*d.?appel[\s._-]*d.?offres?|appel[\s._-]*d.?offres?|\bao\b|"
    r"\brfp\b|request[\s._-]*for[\s._-]*proposal|"
    r"\bdce\b|consultation|"
    r"specifications?|technical[\s._-]*specifications?|"
    r"instructions?[\s._-]*(aux[\s._-]*)?soumissionnaires?",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class PrefilterClassification:
    matched_term: bool
    technical_bucket_relevant: bool
    extension_relevant: bool
    is_content_inspection_candidate: bool


def classify_prefilter(
    filename: str,
    relative_path: str,
    extension: Optional[str],
    technical_bucket: Optional[str] = None,
) -> PrefilterClassification:
    """Stage A (Task 4). Filename/path pattern + extension + (optional)
    Phase 2 technical_bucket - never opens or reads the file. A file with
    NO technical_bucket row yet (Phase 2 classification not run for it) is
    treated as relevant-by-default (fail OPEN for recall here - the
    correctness guardrail is Stage B content inspection, not this
    prefilter; missing a real candidate is worse than one extra Stage B
    inspection)."""
    ext = (extension or "").strip().lower()
    matched_term = bool(_PREFILTER_TERM_PATTERN.search(filename) or _PREFILTER_TERM_PATTERN.search(relative_path))
    technical_bucket_relevant = technical_bucket is None or technical_bucket in RELEVANT_TECHNICAL_BUCKETS

    extension_relevant = ext in RELEVANT_EXTENSIONS
    if not extension_relevant and ext in CONDITIONALLY_RELEVANT_EXTENSIONS and matched_term:
        extension_relevant = True

    is_candidate = matched_term and extension_relevant and technical_bucket_relevant
    return PrefilterClassification(
        matched_term=matched_term,
        technical_bucket_relevant=technical_bucket_relevant,
        extension_relevant=extension_relevant,
        is_content_inspection_candidate=is_candidate,
    )


# =====================================================================
# Review-phase support: classifier version stamping + extraction-failure
# categorization (Phase 6 - historical technical-source / CDC review
# workflow). Both are pure, stdlib-only, no I/O - same guarantees as the
# rest of this module.
# =====================================================================

# Bumped whenever classify_technical_source's RULES change in a way that
# could alter results for previously-classified content (a new/changed
# regex pattern, a new role, a changed weight or band threshold - not a
# comment-only or refactor-only change). A checkpoint/candidate row
# recorded under one version must never be silently treated as
# interchangeable with a different version - see
# scripts/cdc_discovery.py's compute_batch_scope_signature.
TECHNICAL_SOURCE_CLASSIFIER_VERSION = "v1"

# Safe, small, stable failure-CATEGORY labels - never the raw reason_code
# string set (which is an internal implementation detail of
# cdc_content_inspector.py's extraction functions) and never a filename/
# path. "for example" list from the review-workflow task, in one place so
# it stays testable/documented rather than inferred ad hoc per caller.
EXTRACTION_FAILURE_CATEGORIES: tuple[str, ...] = (
    "MISSING_SOURCE",
    "PDF_EXTRACTION_FAILURE",
    "DOC_EXTRACTION_FAILURE",
    "DOCX_EXTRACTION_FAILURE",
    "EMPTY_OUTPUT",
    "UNSUPPORTED_FORMAT",
    "OTHER",
    # Added for the .DOC/LibreOffice pipeline repair (review workflow): the
    # old single EMPTY_OUTPUT bucket conflated "LibreOffice never produced
    # a file", "it produced a corrupt/non-DOCX file", "it produced a valid
    # but empty file", and "conversion succeeded but text extraction found
    # nothing" - four genuinely different failure origins that a reviewer
    # needs to be able to tell apart. EMPTY_OUTPUT itself is kept (never
    # removed - the historical_technical_source_candidates CHECK
    # constraint and any already-persisted row still reference it; a
    # migration widening that constraint, never narrowing it, is required
    # before any NEW row can use these) for PDF's existing
    # "ocr_not_available" mapping and as the fallback for any not-yet-
    # migrated caller.
    "CONVERSION_NO_OUTPUT",
    "CONVERSION_FAILED",
    "CONVERSION_TIMEOUT",
    "INVALID_DOCX_OUTPUT",
    "EMPTY_EXTRACTED_TEXT",
    "ENCRYPTED_OR_PROTECTED",
    "SOURCE_FORMAT_MISMATCH",
)

# scripts/cdc_content_inspector.py's ExtractionError reason codes, mapped
# to the safe categories above. Kept in this module (not
# cdc_content_inspector.py) so the category taxonomy lives next to the
# rest of the review-facing vocabulary; a reason code missing from this
# map (e.g. a future new extraction error) falls back to "OTHER" rather
# than raising, so a code addition elsewhere can never break this mapping.
_EXTRACTION_FAILURE_CATEGORY_BY_REASON: dict[str, str] = {
    "no_file_path_available": "MISSING_SOURCE",
    "pdf_path_missing": "MISSING_SOURCE",
    "doc_path_missing": "MISSING_SOURCE",
    "docling_python_missing": "PDF_EXTRACTION_FAILURE",
    "docling_timeout": "PDF_EXTRACTION_FAILURE",
    "docling_process_failed": "PDF_EXTRACTION_FAILURE",
    "docling_output_missing": "PDF_EXTRACTION_FAILURE",
    "ocr_not_available": "EMPTY_OUTPUT",
    "docx_read_failed": "DOCX_EXTRACTION_FAILURE",
    "docx_xml_parse_failed": "DOCX_EXTRACTION_FAILURE",
    "unsupported_extraction_format": "UNSUPPORTED_FORMAT",
    # .DOC/LibreOffice pipeline repair - each reason below now maps to a
    # SPECIFIC category distinguishing where in the pipeline it failed,
    # replacing the old blanket libreoffice_* -> DOC_EXTRACTION_FAILURE /
    # EMPTY_OUTPUT mapping (see EXTRACTION_FAILURE_CATEGORIES above).
    "libreoffice_missing": "CONVERSION_FAILED",
    "libreoffice_process_failed": "CONVERSION_FAILED",
    "libreoffice_timeout": "CONVERSION_TIMEOUT",
    "libreoffice_output_missing": "CONVERSION_NO_OUTPUT",
    "libreoffice_output_zero_bytes": "CONVERSION_NO_OUTPUT",
    "libreoffice_output_not_a_file": "CONVERSION_NO_OUTPUT",
    "libreoffice_output_invalid_docx": "INVALID_DOCX_OUTPUT",
    "extracted_text_empty": "EMPTY_EXTRACTED_TEXT",
    "encrypted_or_protected": "ENCRYPTED_OR_PROTECTED",
    "source_format_mismatch": "SOURCE_FORMAT_MISMATCH",
}


def categorize_extraction_failure_reason(reason_code: Optional[str]) -> str:
    """Maps a short internal reason_code (scripts/cdc_content_inspector.py's
    ExtractionError / ContentInspectionOutcome.reason_code) to one of the
    small, stable EXTRACTION_FAILURE_CATEGORIES - never the raw code
    itself, and never a filename/path. Unknown/None reason codes fail
    closed to "OTHER" rather than raising, so a new extraction failure
    mode elsewhere is never blocking here."""
    if reason_code is None:
        return "OTHER"
    return _EXTRACTION_FAILURE_CATEGORY_BY_REASON.get(reason_code, "OTHER")
