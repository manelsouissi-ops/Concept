#!/usr/bin/env python3
"""Local CDC-candidate review-sheet builder (CONCEPT Knowledge Base).

Finds the likely historical Cahier des Charges in each OFFRES project by
reading ONLY the documents inside "client" folders, classifying each with
local AI (Ollama, qwen3:14b), and producing one Excel review sheet for a
human supervisor to confirm. This tool never decides anything on its own -
"Verdict IA" and every criterion status are machine output; the sheet's
last column ("CDC ? (à valider)") is deliberately left empty for the
supervisor.

SAFETY GUARANTEES
- Archive root is read-only: this module never opens a source file for
  writing, never deletes, never renames. All conversions
  (LibreOffice/antiword/catdoc) write ONLY to a fresh temporary directory,
  never back into the archive.
- 100% local: Docling (KB_DOCLING_ENDPOINT, default http://127.0.0.1:8010)
  for PDF, the standard library for DOCX, LibreOffice + antiword/catdoc
  fallback for legacy DOC, and Ollama (KB_OLLAMA_ENDPOINT, default
  http://127.0.0.1:11434, model KB_GEN_MODEL default qwen3:14b) for
  classification. No cloud API, no other outbound host, anywhere in this
  module.
- Console output is aggregate-only: every function that prints during a
  run (_print_summary) only ever receives counts/bools - never a
  filename, path, or extracted text. The per-candidate results (which DO
  contain filenames, by design - see the Excel columns below) live only
  in the local checkpoint file and the local Excel output, never on
  stdout/stderr.
- Reuses the existing, human-authored prompt/schema under files/ verbatim
  (files/cdc_21_criteres_extraction.fr.txt,
  files/cdc_21_criteres.schema.json) - this module never invents or edits
  the 21 criteria, the prompt wording, or code_interne_concept (the schema
  itself forbids inventing that field; nothing here overrides it).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import requests

ROOT = Path(__file__).resolve().parent
FILES_DIR = ROOT / "files"
PROMPT_PATH = FILES_DIR / "cdc_21_criteres_extraction.fr.txt"
SCHEMA_PATH = FILES_DIR / "cdc_21_criteres.schema.json"

EXTRACTOR_VERSION = "v1"

DEFAULT_ARCHIVE_ROOT = os.getenv(
    "CDC_ARCHIVE_ROOT",
    str(Path.home() / "Desktop" / "CONCEPT_ARCHIVES" / "Sauvegarde_lamia" / "OFFRES"),
)
DOCLING_ENDPOINT = os.getenv("KB_DOCLING_ENDPOINT", "http://127.0.0.1:8010").rstrip("/")
OLLAMA_ENDPOINT = os.getenv("KB_OLLAMA_ENDPOINT", "http://127.0.0.1:11434").rstrip("/")
GEN_MODEL = os.getenv("KB_GEN_MODEL", "qwen3:14b")
HTTP_TIMEOUT = float(os.getenv("KB_HTTP_TIMEOUT", "120"))
PARSE_TIMEOUT_SECS = float(os.getenv("KB_PARSE_TIMEOUT_SECS", "1800"))
PARSE_POLL_SECS = float(os.getenv("KB_PARSE_POLL_SECS", "2"))
LIBREOFFICE_TIMEOUT_SECONDS = float(os.getenv("KB_LIBREOFFICE_TIMEOUT_SECS", "120"))
EXTRACTION_CHAR_LIMIT = int(os.getenv("KB_EXTRACTION_CHAR_LIMIT", "24000"))

ALLOWED_EXTENSIONS = ("pdf", "docx", "doc")
CLIENT_FOLDER_PATTERN = re.compile("client", re.IGNORECASE)
OFFRES_YEAR_PATTERN = re.compile(r"^OFFRES[\s._-]+((?:19|20)\d{2})$", re.IGNORECASE)
YEAR_PATTERN = re.compile(r"\b(19|20)\d{2}\b")

DEFAULT_OUTPUT_PATH = ROOT / "output" / "cdc_candidates_review.xlsx"

VERDICT_RANK = {"CONFIRMED_CDC": 0, "LIKELY_CDC": 1, "NEEDS_HUMAN_REVIEW": 2, "NOT_CDC": 3}

CRITERIA_KEYS = (
    "SS_AEP", "SS_PCI", "SS_BARRAGES_TRANSFERTS", "SS_ASSAINISSEMENT", "SS_DECHETS", "SS_ENERGIES_RENOUVELABLES",
    "CP_RESEAUX_ENTERRES", "CP_CANAUX_CIEL_OUVERT", "CP_DIGUE", "CP_STATION_POMPAGE", "CP_STEP", "CP_STBV",
    "CP_CVET", "CP_CENTRE_TRANSFERT_CT",
    "NP_FAISABILITE", "NP_APS", "NP_APD", "NP_DAO", "NP_EXE", "NP_EIES", "NP_SUPERVISION",
)
assert len(CRITERIA_KEYS) == 21

EXCEL_COLUMNS = (
    "Projet", "Année", "Fichier", "Rôle", "Verdict IA", "Titre", "Pays", "Bailleur",
) + CRITERIA_KEYS + ("CDC ? (à valider)",)


class ExtractionError(RuntimeError):
    def __init__(self, reason_code: str, detail: str = ""):
        super().__init__(detail or reason_code)
        self.reason_code = reason_code
        # A short, human-readable explanation (never a filename/path/
        # document excerpt) - used to build the one repair re-prompt to
        # Ollama. Defaults to the reason_code itself so every EXISTING
        # ExtractionError(reason_code) call site keeps working unchanged.
        self.detail = detail or reason_code


# =====================================================================
# Discovery - client-folder matching, project/year derivation. Read-only:
# only os.walk/Path.iterdir/Path.stat, never opens or modifies a source
# file here.
# =====================================================================


@dataclass(frozen=True)
class CandidateFile:
    path: Path
    relative_path: str
    project: str
    year: Optional[int]
    extension: str
    candidate_id: str


def is_client_folder(name: str) -> bool:
    return bool(CLIENT_FOLDER_PATTERN.search(name))


def derive_project_and_year(relative_parts: "tuple[str, ...]") -> "tuple[str, Optional[int]]":
    """OFFRES <year>/<project>/... convention (same as scripts/cdc_discovery.py's
    derive_project_folder_key for the other archive). Falls back to the
    first path segment as project and the first year-like token found
    anywhere in the path."""
    for index, part in enumerate(relative_parts):
        match = OFFRES_YEAR_PATTERN.match(part.strip())
        if match:
            year = int(match.group(1))
            project = relative_parts[index + 1] if index + 1 < len(relative_parts) else part
            return project, year
    project = relative_parts[0] if relative_parts else "UNKNOWN"
    joined = "/".join(relative_parts)
    year_match = YEAR_PATTERN.search(joined)
    return project, (int(year_match.group(0)) if year_match else None)


def enumerate_project_folders(archive_root: Path) -> "list[Path]":
    """Deterministic (sorted), top-level project folders directly under an
    'OFFRES <year>' folder. Non-OFFRES top-level entries (e.g. a shared
    templates folder) are never treated as a year/project scope."""
    projects: list[Path] = []
    for year_dir in sorted((p for p in archive_root.iterdir() if p.is_dir()), key=lambda p: p.name):
        if not OFFRES_YEAR_PATTERN.match(year_dir.name.strip()):
            continue
        for project_dir in sorted((p for p in year_dir.iterdir() if p.is_dir()), key=lambda p: p.name):
            projects.append(project_dir)
    return projects


def discover_candidates_in_project(project_dir: Path, archive_root: Path) -> "list[CandidateFile]":
    """A candidate is a .pdf/.docx/.doc file with at least one ancestor
    directory (between the project folder and the file) whose name
    contains "client" (case-insensitive, any variant - "Client",
    "Dossier Client", "documents clients", ...)."""
    candidates: list[CandidateFile] = []
    for dirpath, dirnames, filenames in os.walk(project_dir):
        dirnames.sort()
        current_dir = Path(dirpath)
        for filename in sorted(filenames):
            extension = Path(filename).suffix.lower().lstrip(".")
            if extension not in ALLOWED_EXTENSIONS:
                continue
            file_path = current_dir / filename
            relative_to_project = file_path.relative_to(project_dir)
            folder_segments = relative_to_project.parts[:-1]
            if not any(is_client_folder(segment) for segment in folder_segments):
                continue
            relative_path = file_path.relative_to(archive_root)
            project, year = derive_project_and_year(relative_path.parts)
            candidate_id = hashlib.sha256(str(relative_path).encode("utf-8")).hexdigest()[:24]
            candidates.append(CandidateFile(
                path=file_path, relative_path=str(relative_path), project=project,
                year=year, extension=extension, candidate_id=candidate_id,
            ))
    return candidates


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


# =====================================================================
# Local extraction. PDF -> Docling HTTP (submit + poll, mirrors
# services/knowledge-base/service.py's poll_docling). DOCX -> stdlib
# zipfile+XML only. DOC -> LibreOffice headless conversion to a FRESH
# temp directory (never back into the archive), then the DOCX reader; if
# that yields no usable text, falls back to antiword then catdoc - never
# fatal if either binary is missing, just recorded as such.
# =====================================================================


def extract_pdf_text(path: Path, session=requests) -> str:
    if not path.exists():
        raise ExtractionError("pdf_path_missing")
    try:
        with open(path, "rb") as source:
            submitted = session.post(
                f"{DOCLING_ENDPOINT}/convert",
                files={"file": (path.name, source, "application/pdf")},
                timeout=HTTP_TIMEOUT,
            )
        submitted.raise_for_status()
        job_id = submitted.json().get("job_id")
        if not job_id:
            raise ExtractionError("docling_no_job_id")
        deadline = time.monotonic() + PARSE_TIMEOUT_SECS
        while time.monotonic() < deadline:
            result = session.get(f"{DOCLING_ENDPOINT}/result/{job_id}", timeout=HTTP_TIMEOUT)
            result.raise_for_status()
            payload = result.json()
            status = str(payload.get("status", "")).lower()
            if status == "completed":
                markdown = str(payload.get("markdown") or "")
                if not markdown.strip():
                    raise ExtractionError("docling_output_empty")
                return markdown
            if status == "failed":
                raise ExtractionError("docling_failed")
            if status != "processing":
                raise ExtractionError("docling_unknown_status")
            time.sleep(PARSE_POLL_SECS)
        raise ExtractionError("docling_timeout")
    except ExtractionError:
        raise
    except Exception as error:
        raise ExtractionError("docling_process_failed") from error


_WORD_TEXT_TAG = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"


def extract_docx_text(path: Path) -> str:
    if not path.exists():
        raise ExtractionError("docx_path_missing")
    try:
        with zipfile.ZipFile(path) as archive:
            with archive.open("word/document.xml") as handle:
                xml_bytes = handle.read()
    except (zipfile.BadZipFile, KeyError) as error:
        raise ExtractionError("docx_read_failed") from error
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as error:
        raise ExtractionError("docx_xml_parse_failed") from error
    text = "".join(node.text or "" for node in root.iter(_WORD_TEXT_TAG))
    if not text.strip():
        raise ExtractionError("docx_output_empty")
    return text


def resolve_libreoffice_binary() -> Optional[str]:
    import shutil
    return shutil.which("soffice") or shutil.which("libreoffice")


def convert_doc_to_docx(source: Path, output_dir: Path) -> Path:
    binary = resolve_libreoffice_binary()
    if binary is None:
        raise ExtractionError("libreoffice_missing")
    profile_dir = output_dir / "profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    try:
        completed = subprocess.run(
            [
                binary, "--headless", "--invisible", "--nodefault", "--norestore", "--nolockcheck",
                f"-env:UserInstallation=file://{profile_dir}",
                "--convert-to", "docx", "--outdir", str(output_dir), str(source),
            ],
            check=False, capture_output=True, text=True, timeout=LIBREOFFICE_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise ExtractionError("libreoffice_timeout") from error
    except OSError as error:
        raise ExtractionError("libreoffice_process_failed") from error
    if completed.returncode != 0:
        raise ExtractionError("libreoffice_process_failed")
    converted = output_dir / (source.stem + ".docx")
    if not converted.exists():
        raise ExtractionError("libreoffice_output_missing")
    return converted


def extract_via_antiword(source: Path) -> str:
    import shutil
    binary = shutil.which("antiword")
    if binary is None:
        raise ExtractionError("antiword_missing")
    try:
        completed = subprocess.run(
            [binary, str(source)], check=False, capture_output=True, text=True, timeout=LIBREOFFICE_TIMEOUT_SECONDS,
        )
    except (subprocess.TimeoutExpired, OSError) as error:
        raise ExtractionError("antiword_failed") from error
    if completed.returncode != 0 or not completed.stdout.strip():
        raise ExtractionError("antiword_empty")
    return completed.stdout


def extract_via_catdoc(source: Path) -> str:
    import shutil
    binary = shutil.which("catdoc")
    if binary is None:
        raise ExtractionError("catdoc_missing")
    try:
        completed = subprocess.run(
            [binary, str(source)], check=False, capture_output=True, text=True, timeout=LIBREOFFICE_TIMEOUT_SECONDS,
        )
    except (subprocess.TimeoutExpired, OSError) as error:
        raise ExtractionError("catdoc_failed") from error
    if completed.returncode != 0 or not completed.stdout.strip():
        raise ExtractionError("catdoc_empty")
    return completed.stdout


def extract_doc_text(path: Path) -> str:
    """LibreOffice first; on ANY failure of that path (missing binary,
    timeout, crash, or a conversion that produced no usable text) falls
    back to antiword then catdoc - a superset of "conversion is empty",
    since a hard LibreOffice failure deserves the same fallback chance as
    an empty one. Every attempted tool's own outcome is exposed via the
    reason_code on the final raised ExtractionError so a caller can still
    tell which stage ultimately failed."""
    if not path.exists():
        raise ExtractionError("doc_path_missing")
    try:
        with tempfile.TemporaryDirectory(prefix="cdc-candidate-doc-") as tmp_dir:
            converted = convert_doc_to_docx(path, Path(tmp_dir))
            text = extract_docx_text(converted)
            if text.strip():
                return text
    except ExtractionError:
        pass
    for fallback in (extract_via_antiword, extract_via_catdoc):
        try:
            text = fallback(path)
            if text.strip():
                return text
        except ExtractionError:
            continue
    raise ExtractionError("doc_extraction_empty")


def extract_text(candidate: CandidateFile, session=requests) -> str:
    if candidate.extension == "pdf":
        return extract_pdf_text(candidate.path, session=session)
    if candidate.extension == "docx":
        return extract_docx_text(candidate.path)
    if candidate.extension == "doc":
        return extract_doc_text(candidate.path)
    raise ExtractionError("unsupported_extension")


# =====================================================================
# Local AI classification - Ollama only, reuses files/cdc_21_criteres_*
# verbatim. Never invents the 21 criteria, the prompt wording, or
# code_interne_concept (the schema forbids it; this module never
# overrides that).
# =====================================================================


def build_prompt(markdown: str, document_id: str, source_hash: str, language: str) -> str:
    schema_json = SCHEMA_PATH.read_text(encoding="utf-8")
    return (
        PROMPT_PATH.read_text(encoding="utf-8")
        .replace("{DOCUMENT_ID}", document_id)
        .replace("{SOURCE_HASH}", source_hash)
        .replace("{LANGUAGE}", language)
        .replace("{SCHEMA_JSON}", schema_json)
        .replace("{MARKDOWN}", markdown[:EXTRACTION_CHAR_LIMIT])
    )


def build_repair_prompt(previous_response: str, validation_error: str, schema_json: str) -> str:
    """The ONE repair re-prompt (never re-sent with the document text -
    the model already has its own prior answer to fix, so the source
    document never needs to be repeated here)."""
    return (
        "Ta reponse precedente n'etait pas un JSON valide conforme au schema demande.\n\n"
        f"ERREUR DE VALIDATION :\n{validation_error}\n\n"
        f"TA REPONSE PRECEDENTE :\n{previous_response}\n\n"
        "SCHEMA JSON A RESPECTER STRICTEMENT :\n"
        f"{schema_json}\n\n"
        "Corrige ta reponse pour qu'elle soit un objet JSON valide conforme a ce schema. "
        "Ne recopie aucun extrait du document original, aucun nom de fichier, aucun chemin. "
        "Reponds UNIQUEMENT par l'objet JSON corrige, sans aucun texte hors JSON."
    )


_MARKDOWN_FENCE_PATTERN = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def extract_json_object(raw: str) -> str:
    """Strips a markdown code fence if present, then returns the FIRST
    balanced {...} block (brace-depth counted, not a naive first-{/last-}
    slice, so trailing prose containing its own braces can't truncate the
    real object early or late). If no '{' is found at all, returns the
    (fence-stripped) text as-is and lets json.loads raise its own error."""
    text = raw.strip()
    fence_match = _MARKDOWN_FENCE_PATTERN.search(text)
    if fence_match:
        text = fence_match.group(1).strip()
    start = text.find("{")
    if start == -1:
        return text
    depth = 0
    for index in range(start, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
    return text[start:]


# Task-relaxed validation (deliberately looser than the schema's own
# additionalProperties:false + fully-required shape): only document_role,
# verdict, and criteres are load-bearing enough to reject the whole row
# over. Every optional identity field is normalized to null rather than
# failing the row, and every one of the 21 criteria is normalized to
# "Non déterminable" (never silently "Absent" - matches the prompt's own
# "Non déterminable n'est PAS Absent" rule) if missing/malformed, instead
# of discarding an otherwise-usable AI answer over one missing field.
REQUIRED_TOP_LEVEL_FIELDS = ("document_role", "verdict", "criteres")
VALID_DOCUMENT_ROLES = ("CDC", "DAO", "TDR", "DCE", "RFP", "autre", "indéterminé")
VALID_VERDICTS = ("CONFIRMED_CDC", "LIKELY_CDC", "NEEDS_HUMAN_REVIEW", "NOT_CDC")
VALID_STATUTS = ("Explicite", "Implicite", "Absent", "Non déterminable")


def validate_and_normalize(payload: Any) -> dict:
    if not isinstance(payload, dict):
        raise ExtractionError("ollama_schema_invalid", detail="top-level response is not a JSON object")

    missing = [field_name for field_name in REQUIRED_TOP_LEVEL_FIELDS if field_name not in payload]
    if missing:
        raise ExtractionError("ollama_schema_invalid", detail=f"missing required field(s): {', '.join(missing)}")

    if payload.get("document_role") not in VALID_DOCUMENT_ROLES:
        raise ExtractionError(
            "ollama_schema_invalid", detail=f"document_role {payload.get('document_role')!r} is not one of {VALID_DOCUMENT_ROLES}"
        )
    if payload.get("verdict") not in VALID_VERDICTS:
        raise ExtractionError(
            "ollama_schema_invalid", detail=f"verdict {payload.get('verdict')!r} is not one of {VALID_VERDICTS}"
        )

    criteres = payload.get("criteres")
    if not isinstance(criteres, dict):
        raise ExtractionError("ollama_schema_invalid", detail="'criteres' is not a JSON object")

    normalized: dict = dict(payload)
    normalized["criteres"] = {
        key: {"statut": entry.get("statut") if isinstance(entry := criteres.get(key), dict) and entry.get("statut") in VALID_STATUTS else "Non déterminable"}
        for key in CRITERIA_KEYS
    }

    identite = payload.get("identite")
    identite = identite if isinstance(identite, dict) else {}
    normalized["identite"] = {
        "titre_officiel": value if isinstance(value := identite.get("titre_officiel"), str) else None,
        "annee_lancement": value if isinstance(value := identite.get("annee_lancement"), int) else None,
        "pays": value if isinstance(value := identite.get("pays"), str) else None,
        "bailleur": value if isinstance(value := identite.get("bailleur"), str) else None,
        # NEVER invented, per the prompt's own absolute rule - normalized
        # to null exactly like every other missing optional identity
        # field, never fabricated from anything else in the payload.
        "code_interne_concept": value if isinstance(value := identite.get("code_interne_concept"), str) else None,
    }
    return normalized


def parse_and_validate_ollama_response(raw_response: str) -> dict:
    cleaned = extract_json_object(raw_response)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError as error:
        raise ExtractionError("ollama_invalid_json", detail=f"JSON parse failed: {error}") from error
    return validate_and_normalize(payload)


def _post_ollama_generate(prompt: str, schema: Optional[dict], session=requests) -> str:
    """One logical Ollama call. format=schema (structured outputs) is
    tried first when a schema is given; on ANY failure of that attempt
    (including an HTTP error from an Ollama version that does not support
    an object-shaped `format`), falls back to the plain "format": "json"
    mode exactly once before giving up. Always raises ExtractionError
    (never a raw requests exception) so every caller only ever has to
    handle one exception type."""
    base_payload = {"model": GEN_MODEL, "prompt": prompt, "stream": False, "options": {"temperature": 0}}
    attempts = [dict(base_payload, format=schema)] if schema is not None else []
    attempts.append(dict(base_payload, format="json"))

    last_error: Optional[Exception] = None
    for payload in attempts:
        try:
            response = session.post(f"{OLLAMA_ENDPOINT}/api/generate", json=payload, timeout=HTTP_TIMEOUT * 3)
            response.raise_for_status()
            return response.json()["response"]
        except Exception as error:  # noqa: BLE001 - deliberately broad: any failure tries the next attempt
            last_error = error
            continue
    raise ExtractionError("ollama_unreachable", detail=str(last_error)) from last_error


def call_ollama_extraction(
    markdown: str, document_id: str, source_hash: str, language: str = "fr", session=requests
) -> "tuple[Optional[dict], str, Optional[str]]":
    """Returns (extraction_or_none, outcome, failure_reason_code).
    outcome is one of "first_try", "after_repair", "failed". A failure is
    only ever reported (and only ever tallied as ollama_invalid_json/
    ollama_schema_invalid/ollama_unreachable) once the ONE repair retry
    has ALSO failed - never on the first bad response alone."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    prompt = build_prompt(markdown, document_id, source_hash, language)

    try:
        raw_response = _post_ollama_generate(prompt, schema, session=session)
    except ExtractionError as error:
        return None, "failed", error.reason_code  # Ollama itself unreachable - repairing would not help

    try:
        return parse_and_validate_ollama_response(raw_response), "first_try", None
    except ExtractionError as error:
        first_detail = error.detail

    try:
        repair_prompt = build_repair_prompt(raw_response, first_detail, json.dumps(schema, ensure_ascii=False))
        repaired_raw = _post_ollama_generate(repair_prompt, schema, session=session)
        return parse_and_validate_ollama_response(repaired_raw), "after_repair", None
    except ExtractionError as error:
        return None, "failed", error.reason_code


# =====================================================================
# Row assembly + Excel output. The Excel file is the one deliberate,
# LOCAL, human-facing exception to "no filenames" - it exists precisely
# so the supervisor can find and open the source file. It is never
# printed to stdout and never leaves local disk from this module.
# =====================================================================

FAILED_ROLE = "EXTRACTION_FAILED"


def build_row(candidate: CandidateFile, extraction: Optional[dict]) -> dict:
    base = {"Projet": candidate.project, "Année": candidate.year, "Fichier": candidate.relative_path}
    if extraction is None:
        return {
            **base,
            "Rôle": FAILED_ROLE, "Verdict IA": FAILED_ROLE,
            "Titre": "", "Pays": "", "Bailleur": "",
            **{key: "Non déterminable" for key in CRITERIA_KEYS},
            "CDC ? (à valider)": "",
        }
    identite = extraction.get("identite") or {}
    criteres = extraction.get("criteres") or {}
    return {
        **base,
        "Rôle": extraction.get("document_role"),
        "Verdict IA": extraction.get("verdict"),
        "Titre": identite.get("titre_officiel") or "",
        "Pays": identite.get("pays") or "",
        "Bailleur": identite.get("bailleur") or "",
        **{key: (criteres.get(key) or {}).get("statut", "Non déterminable") for key in CRITERIA_KEYS},
        "CDC ? (à valider)": "",
    }


def sort_rows(rows: "list[dict]") -> "list[dict]":
    """By project, then within a project the highest-verdict candidate
    first (CONFIRMED_CDC > LIKELY_CDC > NEEDS_HUMAN_REVIEW > NOT_CDC >
    unrecognized/failed), tiebroken by filename for determinism."""
    def key(row: dict):
        return (
            row.get("Projet") or "",
            VERDICT_RANK.get(row.get("Verdict IA"), 99),
            row.get("Fichier") or "",
        )
    return sorted(rows, key=key)


def write_excel(rows: "list[dict]", output_path: Path) -> None:
    import openpyxl

    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "Candidats CDC"
    sheet.append(list(EXCEL_COLUMNS))
    for row in sort_rows(rows):
        sheet.append([row.get(column, "") for column in EXCEL_COLUMNS])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(output_path)


# =====================================================================
# Checkpoint / resume / idempotency. completed_candidate_ids and rows are
# LOCAL-ONLY state (rows necessarily contain filenames, to rebuild the
# Excel across a resumed run) - never printed; only the `counts` section
# of this file is safe/aggregate and mirrors what _print_summary prints.
# =====================================================================


def build_scope_config(archive_root: Path, project_count: int) -> dict:
    return {
        "mode": "cdc_candidate_extractor",
        "archive_root_hash": hashlib.sha256(str(archive_root).encode("utf-8")).hexdigest()[:16],
        "project_count": project_count,
        "extractor_version": EXTRACTOR_VERSION,
        "model": GEN_MODEL,
        "schema_hash": hashlib.sha256(SCHEMA_PATH.read_bytes()).hexdigest()[:16],
        "prompt_hash": hashlib.sha256(PROMPT_PATH.read_bytes()).hexdigest()[:16],
    }


def compute_scope_signature(config: dict) -> str:
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode("utf-8")).hexdigest()


def describe_scope_mismatch(old_config: dict, new_config: dict) -> str:
    all_keys = sorted(set(old_config) | set(new_config))
    differences = [
        f"{key}: checkpoint={old_config.get(key)!r} vs current={new_config.get(key)!r}"
        for key in all_keys
        if old_config.get(key) != new_config.get(key)
    ]
    return "; ".join(differences) if differences else "project set changed"


@dataclass
class Checkpoint:
    scope_signature: str
    config: dict
    completed_candidate_ids: "list[str]" = field(default_factory=list)
    rows: "list[dict]" = field(default_factory=list)
    counts: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "scope_signature": self.scope_signature,
            "config": self.config,
            "completed_candidate_ids": self.completed_candidate_ids,
            "rows": self.rows,
            "counts": self.counts,
        }

    @staticmethod
    def from_dict(data: dict) -> "Checkpoint":
        return Checkpoint(
            scope_signature=data["scope_signature"],
            config=dict(data.get("config", {})),
            completed_candidate_ids=list(data.get("completed_candidate_ids", [])),
            rows=list(data.get("rows", [])),
            counts=dict(data.get("counts", {})),
        )


def load_checkpoint(path: Path) -> Optional[Checkpoint]:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return Checkpoint.from_dict(data)
    except (json.JSONDecodeError, OSError, KeyError, TypeError):
        return None


def save_checkpoint(path: Path, checkpoint: Checkpoint) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(checkpoint.as_dict(), indent=2, ensure_ascii=False), encoding="utf-8")


# =====================================================================
# Orchestration
# =====================================================================


def process_candidate(candidate: CandidateFile, session=requests) -> dict:
    """Returns {"row": dict, "failure_reason": Optional[str], "ollama_outcome": Optional[str]}.
    failure_reason is a short, stable code (e.g. "ollama_schema_invalid",
    "docling_timeout"), never a filename/path/excerpt - safe to tally into
    the AGGREGATE counts dict so a real run's failures are diagnosable
    without ever printing which document failed. ollama_outcome is one of
    "first_try"/"after_repair"/"failed", or None when Ollama was never
    reached because local extraction itself failed first."""
    try:
        text = extract_text(candidate, session=session)
        source_hash = sha256_file(candidate.path)
    except ExtractionError as error:
        return {"row": build_row(candidate, None), "failure_reason": error.reason_code, "ollama_outcome": None}

    extraction, ollama_outcome, failure_reason = call_ollama_extraction(
        text, document_id=candidate.candidate_id, source_hash=source_hash, session=session,
    )
    return {"row": build_row(candidate, extraction), "failure_reason": failure_reason, "ollama_outcome": ollama_outcome}


def run(
    archive_root: Path,
    pilot_limit: Optional[int],
    dry_run: bool,
    resume: bool,
    output_path: Path,
    checkpoint_path: Path,
    session=requests,
) -> dict:
    projects = enumerate_project_folders(archive_root)
    if pilot_limit is not None:
        projects = projects[:pilot_limit]

    scope_config = build_scope_config(archive_root, len(projects))
    scope_signature = compute_scope_signature(scope_config)
    existing = load_checkpoint(checkpoint_path)

    if existing is not None and existing.scope_signature == scope_signature:
        if not resume:
            raise RuntimeError(
                "an incomplete checkpoint already exists for this exact scope. "
                "Pass --resume to continue it, or remove the checkpoint file to start fresh."
            )
        checkpoint = existing
    elif existing is not None and resume:
        raise RuntimeError(
            "--resume was passed but the existing checkpoint does not match the current scope. "
            f"Refusing to overwrite it. Mismatch: {describe_scope_mismatch(existing.config, scope_config)}"
        )
    else:
        checkpoint = Checkpoint(scope_signature=scope_signature, config=scope_config)

    all_candidates: list[CandidateFile] = []
    for project_dir in projects:
        all_candidates.extend(discover_candidates_in_project(project_dir, archive_root))

    counts = {
        "projects_selected": len(projects),
        "candidates_found": len(all_candidates),
        "candidates_processed": 0,
        "candidates_skipped_done": 0,
        "candidates_failed": 0,
        "external_calls": 0,
        "dry_run": dry_run,
    }
    # Short reason-code -> count, e.g. {"ollama_schema_invalid": 12,
    # "docling_timeout": 3} - never a filename/path, always safe to print,
    # and the only way a high failure rate is diagnosable from aggregate
    # output alone.
    failure_reasons: dict = {}
    # How many candidates that reached Ollama were accepted on the first
    # response vs only after the one repair re-prompt vs never (failed
    # even after repair) - "Log (aggregate only) how many succeeded on
    # first try vs after repair."
    ollama_outcomes: dict = {"first_try": 0, "after_repair": 0, "failed": 0}

    if dry_run:
        return counts

    completed_ids = set(checkpoint.completed_candidate_ids)
    for candidate in all_candidates:
        if candidate.candidate_id in completed_ids:
            counts["candidates_skipped_done"] += 1
            continue
        result = process_candidate(candidate, session=session)
        row, failure_reason, ollama_outcome = result["row"], result["failure_reason"], result["ollama_outcome"]
        checkpoint.rows.append(row)
        checkpoint.completed_candidate_ids.append(candidate.candidate_id)
        if ollama_outcome is not None:
            ollama_outcomes[ollama_outcome] = ollama_outcomes.get(ollama_outcome, 0) + 1
        if row.get("Verdict IA") == FAILED_ROLE:
            counts["candidates_failed"] += 1
            failure_reasons[failure_reason or "unknown"] = failure_reasons.get(failure_reason or "unknown", 0) + 1
        else:
            counts["candidates_processed"] += 1
        counts["failure_reasons"] = failure_reasons
        counts["ollama_outcomes"] = ollama_outcomes
        checkpoint.counts = counts
        save_checkpoint(checkpoint_path, checkpoint)

    write_excel(checkpoint.rows, output_path)
    counts["rows_written"] = len(checkpoint.rows)
    checkpoint.counts = counts
    save_checkpoint(checkpoint_path, checkpoint)
    return counts


# =====================================================================
# CLI
# =====================================================================


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cdc_candidate_extractor.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--archive-root", type=str, default=DEFAULT_ARCHIVE_ROOT)
    parser.add_argument("--dry-run", action="store_true", help="Count candidates only. No extraction, no AI call, no Excel.")
    parser.add_argument("--pilot-limit", type=int, default=None, metavar="N", help="Process only the first N project folders.")
    parser.add_argument("--resume", action="store_true", help="Continue a previous run from its checkpoint.")
    parser.add_argument("--output", type=str, default=str(DEFAULT_OUTPUT_PATH), metavar="PATH")
    parser.add_argument("--checkpoint-file", type=str, default=None, metavar="PATH")
    return parser


def _validate_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.pilot_limit is not None and args.pilot_limit <= 0:
        parser.error("--pilot-limit must be a positive integer.")
    if args.resume and args.dry_run:
        parser.error("--resume and --dry-run cannot be combined (dry-run never writes a checkpoint).")


def _print_summary(counts: dict) -> None:
    # Aggregate-only by construction: every value here is a count/bool -
    # never a filename, path, or excerpt of document content.
    print("cdc_candidate_extractor aggregate report:")
    for key, value in counts.items():
        print(f"  {key}: {value}")


def main(argv: Optional["list[str]"] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    _validate_args(parser, args)

    archive_root = Path(args.archive_root).expanduser()
    if not archive_root.is_dir():
        print("cdc_candidate_extractor: archive root not found.", file=sys.stderr)
        return 1

    output_path = Path(args.output).expanduser()
    checkpoint_path = (
        Path(args.checkpoint_file).expanduser() if args.checkpoint_file
        else output_path.with_suffix(".checkpoint.json")
    )

    try:
        counts = run(archive_root, args.pilot_limit, args.dry_run, args.resume, output_path, checkpoint_path)
    except RuntimeError as error:
        print(f"cdc_candidate_extractor: {error}", file=sys.stderr)
        return 1

    _print_summary(counts)
    if not args.dry_run:
        print(f"  output_excel_path: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
