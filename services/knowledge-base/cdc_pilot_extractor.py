#!/usr/bin/env python3
"""Controlled five-document pilot framework for local extraction of the 21
CDC criteria (CONCEPT Knowledge Base).

SCOPE OF THIS MODULE
This module builds and validates the PILOT WORKFLOW only. It does not
select the five real documents, does not call a real Docling/Ollama
instance, and does not write to PostgreSQL. Every network/filesystem call
this module can ever make is dependency-injected (a `session` / `transport`
parameter, exactly like services/knowledge-base/cdc_candidate_extractor.py's
own `session=requests` convention) so the entire pipeline is testable with
synthetic fixtures only - see test_cdc_pilot_extractor.py.

WHAT IS REUSED, NOT DUPLICATED
- Text extraction (PDF via Docling submit/poll, DOCX via stdlib zipfile,
  DOC via LibreOffice/antiword/catdoc fallback) and sha256_file() are reused
  verbatim from cdc_candidate_extractor.py - see _configure_base_extractor()
  for how this pilot's own validated, loopback-only --docling-endpoint is
  injected into that module before any call.
- The established prompt template, the brace-balanced JSON extractor
  (extract_json_object) and the repair-prompt builder (build_repair_prompt)
  are reused verbatim too. The Ollama HTTP call and response-validation
  strictness are NOT reused as-is: cdc_candidate_extractor.
  call_ollama_extraction() is deliberately LENIENT (normalizes a missing/
  malformed criterion instead of rejecting the row - intentional, tested,
  serves that module's own bulk-discovery caller). This task explicitly
  requires the opposite ("reject extra, missing or malformed criteria"), so
  this module's own classify_with_ollama() layers strict jsonschema
  validation on top of the SAME reused prompt/repair helpers instead of
  altering the existing lenient function - see that section's docstring.
- The 21-criteria JSON Schema (files/cdc_21_criteres.schema.json) and its
  French statut enum ("Explicite"/"Implicite"/"Absent"/"Non déterminable")
  are the established source of truth and are NEVER redefined here. This
  module additionally exposes each criterion under a normalized,
  locale-independent ASCII key (EXPLICITE/IMPLICITE/ABSENT/NON_DETERMINABLE)
  for callers that prefer one - see STATUT_CANONICAL_MAP. The French value
  is always the source of truth; the canonical key is derived from it, never
  the other way around.
- The processing-group business rule (HUMAN_VALIDATED_CDC + year in
  [2020, 2026] -> PRIORITAIRE_2020_2026, etc.) is a deliberate, documented
  Python port of lib/archive-cartography/cdc-review.ts's
  computeProcessingGroup() - see compute_processing_group() below. Kept in
  sync by inspection (no shared import across the Python/TypeScript
  boundary is possible), same constants (RECENT_YEAR_MIN/MAX = 2020/2026).

WHAT IS NEW IN THIS MODULE (not present anywhere else in the repo)
- The five-document manifest contract and its fail-closed validation
  (validate_manifest_structure / validate_manifest_for_execution).
- The pilot's own structured output-record contract
  (PilotExtractionResult) - audit fields (model/prompt/schema identity,
  timestamps, duration, retry count, processing status) around the reused
  21-criteria extraction.
- assert_loopback_url() is duplicated (not imported) from
  scripts/semantic_review.py's own function of the same name - deliberately,
  for the same reason that module gives for not importing it from
  scripts/cdc_content_inspector.py either: this module's local-only
  guarantee must never depend on a heavier sibling module's import surface
  being importable at all. All three copies enforce the exact same rule
  (http(s) + hostname in {127.0.0.1, localhost, ::1}) and are kept in sync
  by inspection.
- SafeLocalSession: a redirect-rejecting, bounded-retry transport wrapper
  that is passed as the `session=` argument into the reused extraction/
  Ollama-calling functions above, so their existing logic is not touched at
  all - only wrapped.
- Atomic, owner-only-permission output/checkpoint writing
  (write_bytes_atomic / ensure_private_directory) - stricter than either
  cdc_candidate_extractor.py's or scripts/semantic_review.py's existing
  (non-atomic, default-permission) checkpoint writers.

ARCHITECTURE PRINCIPLE (unchanged by this module)
Claude Code builds and verifies this workflow. Docling/local parsers will
later extract text locally. Ollama will later classify the 21 criteria.
Human review will validate pilot quality before scaling. This module's
--execute path is a real, general-purpose, dependency-injected
implementation - not a stub - but it is never invoked against a real
document, endpoint, or manifest by this task; every invocation in this
repository's test suite uses synthetic fixtures and injected fake
transports only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import time
import urllib.parse
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import jsonschema

import cdc_candidate_extractor as base_extractor

ROOT = Path(__file__).resolve().parent
PILOT_VERSION = "v1"

# The established schema, loaded once, verbatim, never redefined - see
# module docstring. jsonschema is already a project dependency (used by
# services/knowledge-base/service.py).
SCHEMA = json.loads(base_extractor.SCHEMA_PATH.read_text(encoding="utf-8"))

DEFAULT_MANIFEST_PATH = ROOT / "pilot" / "manifest.json"
DEFAULT_CHECKPOINT_PATH = ROOT / "output" / "pilot" / ".pilot_checkpoint.json"

PILOT_ENTRY_COUNT = 5

# ---------------------------------------------------------------------
# Business rules reused/ported from lib/archive-cartography/cdc-review.ts
# (computeProcessingGroup, RECENT_YEAR_MIN/MAX, PROCESSING_GROUPS) and from
# scripts/sql/create_historical_technical_source_candidates_table.sql's
# validation_status CHECK constraint. This module never invents a
# competing taxonomy - see compute_processing_group()'s docstring.
# ---------------------------------------------------------------------

REQUIRED_VALIDATION_STATUS = "HUMAN_VALIDATED_CDC"
REJECTED_VALIDATION_STATUS = "HUMAN_REJECTED_CDC"
UNCERTAIN_VALIDATION_STATUSES = ("MACHINE_CLASSIFIED", "NEEDS_HUMAN_REVIEW")

RECENT_YEAR_MIN = 2020
RECENT_YEAR_MAX = 2026

REQUIRED_PROCESSING_GROUP = "PRIORITAIRE_2020_2026"
PROCESSING_GROUPS = ("PRIORITAIRE_2020_2026", "SECONDAIRE_AVANT_2020", "EXCLU", "A_REVOIR")

ALLOWED_EXTENSIONS = base_extractor.ALLOWED_EXTENSIONS  # ("pdf", "docx", "doc")

_UUID_PATTERN = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_SHA256_HEX_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def compute_processing_group(validation_status: str, year: Optional[int]) -> str:
    """Pure port of lib/archive-cartography/cdc-review.ts's
    computeProcessingGroup(). Same three rules, same constants:
        HUMAN_VALIDATED_CDC + year in [2020, 2026] -> PRIORITAIRE_2020_2026
        HUMAN_VALIDATED_CDC + year outside that range -> SECONDAIRE_AVANT_2020
        HUMAN_REJECTED_CDC (any year)                 -> EXCLU
        anything else (MACHINE_CLASSIFIED / NEEDS_HUMAN_REVIEW / unknown)
                                                        -> A_REVOIR
    Used here only to CROSS-CHECK a manifest entry's self-declared
    processing_group against its own validation_status/year - never as a
    database query, never as a source of truth on its own."""
    if validation_status == REJECTED_VALIDATION_STATUS:
        return "EXCLU"
    if validation_status == REQUIRED_VALIDATION_STATUS:
        if year is not None and RECENT_YEAR_MIN <= year <= RECENT_YEAR_MAX:
            return "PRIORITAIRE_2020_2026"
        return "SECONDAIRE_AVANT_2020"
    return "A_REVOIR"


# =====================================================================
# Manifest contract
# =====================================================================


class ManifestError(RuntimeError):
    """Raised for a malformed manifest FILE (bad JSON, missing keys, wrong
    types). Never for a structurally-valid-but-ineligible entry - that is
    reported via validate_manifest_structure()'s error list instead, so a
    dry-run can always finish and report every problem at once rather than
    stopping at the first one."""


@dataclass(frozen=True)
class PilotManifestEntry:
    candidate_uuid: str
    archive_file_id: int
    source_sha256: str
    year: Optional[int]
    extension: str
    processing_group: str
    validation_status: str
    # Local-only. Never included in any aggregate print, any committed
    # fixture, or any field of PilotExtractionResult - see
    # process_pilot_entry()'s docstring.
    local_source_path: str
    selection_reason: str

    @staticmethod
    def from_dict(data: Any, index: int) -> "PilotManifestEntry":
        if not isinstance(data, dict):
            raise ManifestError(f"manifest entry #{index} is not a JSON object")
        required_keys = (
            "candidate_uuid", "archive_file_id", "source_sha256", "year", "extension",
            "processing_group", "validation_status", "local_source_path", "selection_reason",
        )
        missing = [key for key in required_keys if key not in data]
        if missing:
            raise ManifestError(f"manifest entry #{index} is missing required field(s): {', '.join(missing)}")
        try:
            return PilotManifestEntry(
                candidate_uuid=str(data["candidate_uuid"]),
                archive_file_id=int(data["archive_file_id"]),
                source_sha256=str(data["source_sha256"]).lower(),
                year=int(data["year"]) if data["year"] is not None else None,
                extension=str(data["extension"]).lower(),
                processing_group=str(data["processing_group"]),
                validation_status=str(data["validation_status"]),
                local_source_path=str(data["local_source_path"]),
                selection_reason=str(data["selection_reason"]),
            )
        except (TypeError, ValueError) as error:
            raise ManifestError(f"manifest entry #{index} has a malformed field: {error}") from error


def load_manifest(path: Path) -> "list[PilotManifestEntry]":
    """Reads and parses the manifest JSON file only - no other filesystem
    access, no network, no PostgreSQL. Safe to call during --dry-run.
    Raises ManifestError with a sanitized message (never echoing raw file
    content, which could contain a local path) on any malformed input."""
    if not path.is_file():
        raise ManifestError("manifest file does not exist")
    try:
        raw_text = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ManifestError("manifest file could not be read") from error
    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as error:
        raise ManifestError("manifest file is not valid JSON") from error
    if not isinstance(data, dict) or "entries" not in data:
        raise ManifestError("manifest must be a JSON object with an \"entries\" array")
    entries_raw = data["entries"]
    if not isinstance(entries_raw, list):
        raise ManifestError("manifest \"entries\" must be an array")
    return [PilotManifestEntry.from_dict(entry, index) for index, entry in enumerate(entries_raw)]


def validate_manifest_structure(entries: "list[PilotManifestEntry]") -> "list[str]":
    """Structural, database-free, filesystem-free, network-free validation.
    Safe to call during --dry-run. Returns a list of sanitized error
    strings (referencing only the opaque archive_file_id, never a path or
    filename); an empty list means every fail-closed gate below passes:

        - exactly 5 entries
        - every candidate marked HUMAN_VALIDATED_CDC (not uncertain, not
          rejected)
        - every candidate in the 2020-2026 priority group (both the
          declared processing_group AND the value independently derived
          from validation_status/year must agree, and both must be
          PRIORITAIRE_2020_2026)
        - candidate_uuid values unique and well-formed
        - archive_file_id values unique
        - source_sha256 values well-formed (64 lowercase hex) and unique -
          duplicate source hashes are never supported by this pilot; there
          is no duplicate-handling mode to opt into
        - extension is one of the extractor's supported types
        - local_source_path / selection_reason are non-empty
    """
    errors: list[str] = []

    if len(entries) != PILOT_ENTRY_COUNT:
        errors.append(f"manifest must contain exactly {PILOT_ENTRY_COUNT} entries, found {len(entries)}")

    uuids = [entry.candidate_uuid for entry in entries]
    if len(set(uuids)) != len(uuids):
        errors.append("duplicate candidate_uuid values are not allowed")

    archive_ids = [entry.archive_file_id for entry in entries]
    if len(set(archive_ids)) != len(archive_ids):
        errors.append("duplicate archive_file_id values are not allowed")

    hashes = [entry.source_sha256 for entry in entries]
    if len(set(hashes)) != len(hashes):
        errors.append("duplicate source_sha256 values are not allowed (this pilot has no duplicate-handling mode)")

    for entry in entries:
        prefix = f"entry archive_file_id={entry.archive_file_id!r}"

        if not _UUID_PATTERN.match(entry.candidate_uuid):
            errors.append(f"{prefix}: candidate_uuid is not a well-formed UUID")

        if not _SHA256_HEX_PATTERN.match(entry.source_sha256):
            errors.append(f"{prefix}: source_sha256 is not a well-formed 64-character lowercase hex SHA-256")

        if entry.extension not in ALLOWED_EXTENSIONS:
            errors.append(f"{prefix}: extension {entry.extension!r} is not one of {ALLOWED_EXTENSIONS}")

        if entry.validation_status == REJECTED_VALIDATION_STATUS:
            errors.append(f"{prefix}: rejected candidates are not eligible for the pilot")
        elif entry.validation_status in UNCERTAIN_VALIDATION_STATUSES:
            errors.append(f"{prefix}: uncertain/unreviewed candidates are not eligible for the pilot")
        elif entry.validation_status != REQUIRED_VALIDATION_STATUS:
            errors.append(f"{prefix}: validation_status must be {REQUIRED_VALIDATION_STATUS!r}, got {entry.validation_status!r}")

        if entry.processing_group == "EXCLU":
            errors.append(f"{prefix}: rejected candidates are not eligible for the pilot")
        elif entry.processing_group == "A_REVOIR":
            errors.append(f"{prefix}: uncertain/unreviewed candidates are not eligible for the pilot")

        if entry.processing_group not in PROCESSING_GROUPS:
            errors.append(f"{prefix}: processing_group {entry.processing_group!r} is not one of {PROCESSING_GROUPS}")
        elif entry.processing_group != REQUIRED_PROCESSING_GROUP:
            errors.append(f"{prefix}: processing_group must be {REQUIRED_PROCESSING_GROUP!r} for this pilot")

        derived_group = compute_processing_group(entry.validation_status, entry.year)
        if entry.processing_group in PROCESSING_GROUPS and derived_group != entry.processing_group:
            errors.append(
                f"{prefix}: declared processing_group {entry.processing_group!r} does not match the group "
                f"{derived_group!r} derived from validation_status/year - manifest is internally inconsistent"
            )

        if entry.year is None or not (RECENT_YEAR_MIN <= entry.year <= RECENT_YEAR_MAX):
            errors.append(f"{prefix}: year must be between {RECENT_YEAR_MIN} and {RECENT_YEAR_MAX}")

        if not entry.local_source_path.strip():
            errors.append(f"{prefix}: local_source_path must not be empty")

        if not entry.selection_reason.strip():
            errors.append(f"{prefix}: selection_reason must not be empty")

    return errors


def validate_manifest_for_execution(entries: "list[PilotManifestEntry]") -> "list[str]":
    """Execution-only checks: the ONLY function in this module that opens a
    real local file. Never called during --dry-run. Never touches the
    network or PostgreSQL. For each entry: the declared local_source_path
    must exist, and its live sha256 must match the declared source_sha256
    (protects against a stale manifest or a changed/corrupted file)."""
    errors: list[str] = []
    for entry in entries:
        prefix = f"entry archive_file_id={entry.archive_file_id!r}"
        path = Path(entry.local_source_path)
        if not path.is_file():
            errors.append(f"{prefix}: source file does not exist at the declared local_source_path")
            continue
        actual_hash = base_extractor.sha256_file(path)
        if actual_hash != entry.source_sha256:
            errors.append(f"{prefix}: source_sha256 mismatch - file content does not match the manifest")
    return errors


# =====================================================================
# 21-criteria output contract. Reuses the established schema/prompt from
# cdc_candidate_extractor.py verbatim - see module docstring.
# =====================================================================

# The established schema's own statut enum (files/cdc_21_criteres.schema.json
# $defs.statut) is the permanent source of truth and is never redefined
# here. This mapping is a DERIVED, locale-independent, ASCII-uppercase
# alias for callers that want one (e.g. this pilot's own output contract).
STATUT_CANONICAL_MAP = {
    "Explicite": "EXPLICITE",
    "Implicite": "IMPLICITE",
    "Absent": "ABSENT",
    "Non déterminable": "NON_DETERMINABLE",
}
CANONICAL_STATUT_MAP = {canonical: statut for statut, canonical in STATUT_CANONICAL_MAP.items()}
CANONICAL_STATUSES = tuple(STATUT_CANONICAL_MAP.values())  # ("EXPLICITE", "IMPLICITE", "ABSENT", "NON_DETERMINABLE")


def to_canonical_statut(statut: str) -> str:
    canonical = STATUT_CANONICAL_MAP.get(statut)
    if canonical is None:
        raise ValueError(f"unknown statut {statut!r}; expected one of {tuple(STATUT_CANONICAL_MAP)}")
    return canonical


PROCESSING_STATUSES = (
    "PENDING",
    "TEXT_EXTRACTION_FAILED",
    "OLLAMA_UNREACHABLE",
    "INVALID_JSON",
    "SCHEMA_INVALID",
    "SUCCESS",
)


@dataclass(frozen=True)
class PilotCriterionResult:
    statut: str            # established schema spelling - source of truth
    statut_canonical: str  # derived ASCII-uppercase alias

    def as_dict(self) -> dict:
        return {"statut": self.statut, "statut_canonical": self.statut_canonical}


@dataclass
class PilotExtractionResult:
    candidate_uuid: str
    archive_file_id: int
    source_sha256: str
    model_name: str
    model_digest: Optional[str]
    prompt_version: str
    prompt_hash: str
    schema_version: str
    schema_hash: str
    pilot_version: str
    extracted_at: str  # ISO 8601 UTC
    processing_status: str
    # Exactly the 21 keys in base_extractor.CRITERIA_KEYS on success; empty
    # on any failure before Ollama returned a schema-valid response.
    criteria: "dict[str, PilotCriterionResult]"
    document_role: Optional[str]
    verdict: Optional[str]
    confidence: Optional[float]
    # The established schema's own signaux_structurels booleans - the only
    # "evidence" signal the schema exposes at all (additionalProperties:
    # false on each criterion object rules out any free-text excerpt by
    # construction). Never free text, never a quote, never a filename.
    structural_signals: Optional[dict]
    validation_errors: "list[str]"
    processing_duration_ms: Optional[int]
    retry_count: int
    failure_category: Optional[str]

    def as_dict(self) -> dict:
        return {
            "candidate_uuid": self.candidate_uuid,
            "archive_file_id": self.archive_file_id,
            "source_sha256": self.source_sha256,
            "model_name": self.model_name,
            "model_digest": self.model_digest,
            "prompt_version": self.prompt_version,
            "prompt_hash": self.prompt_hash,
            "schema_version": self.schema_version,
            "schema_hash": self.schema_hash,
            "pilot_version": self.pilot_version,
            "extracted_at": self.extracted_at,
            "processing_status": self.processing_status,
            "criteria": {key: value.as_dict() for key, value in self.criteria.items()},
            "document_role": self.document_role,
            "verdict": self.verdict,
            "confidence": self.confidence,
            "structural_signals": self.structural_signals,
            "validation_errors": self.validation_errors,
            "processing_duration_ms": self.processing_duration_ms,
            "retry_count": self.retry_count,
            "failure_category": self.failure_category,
        }


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _compute_prompt_hash() -> str:
    return hashlib.sha256(base_extractor.PROMPT_PATH.read_bytes()).hexdigest()


def _compute_schema_hash() -> str:
    return hashlib.sha256(base_extractor.SCHEMA_PATH.read_bytes()).hexdigest()


def build_pending_result(entry: PilotManifestEntry, model_name: str) -> PilotExtractionResult:
    return PilotExtractionResult(
        candidate_uuid=entry.candidate_uuid, archive_file_id=entry.archive_file_id,
        source_sha256=entry.source_sha256, model_name=model_name, model_digest=None,
        prompt_version=base_extractor.EXTRACTOR_VERSION, prompt_hash=_compute_prompt_hash(),
        schema_version=base_extractor.EXTRACTOR_VERSION, schema_hash=_compute_schema_hash(),
        pilot_version=PILOT_VERSION, extracted_at=_utc_now_iso(), processing_status="PENDING",
        criteria={}, document_role=None, verdict=None, confidence=None, structural_signals=None,
        validation_errors=[], processing_duration_ms=None, retry_count=0, failure_category=None,
    )


def build_result_from_extraction(
    entry: PilotManifestEntry, model_name: str, model_digest: Optional[str],
    extraction: dict, duration_ms: int, retry_count: int,
) -> PilotExtractionResult:
    """extraction is an already schema-validated, normalized payload from
    base_extractor.validate_and_normalize() - never raw model output."""
    criteria = {
        key: PilotCriterionResult(statut=entry_["statut"], statut_canonical=to_canonical_statut(entry_["statut"]))
        for key, entry_ in extraction["criteres"].items()
    }
    return PilotExtractionResult(
        candidate_uuid=entry.candidate_uuid, archive_file_id=entry.archive_file_id,
        source_sha256=entry.source_sha256, model_name=model_name, model_digest=model_digest,
        prompt_version=base_extractor.EXTRACTOR_VERSION, prompt_hash=_compute_prompt_hash(),
        schema_version=base_extractor.EXTRACTOR_VERSION, schema_hash=_compute_schema_hash(),
        pilot_version=PILOT_VERSION, extracted_at=_utc_now_iso(), processing_status="SUCCESS",
        criteria=criteria, document_role=extraction.get("document_role"), verdict=extraction.get("verdict"),
        confidence=extraction.get("confiance"), structural_signals=extraction.get("signaux_structurels"),
        validation_errors=[], processing_duration_ms=duration_ms, retry_count=retry_count, failure_category=None,
    )


def build_failure_result(
    entry: PilotManifestEntry, model_name: str, processing_status: str, failure_category: str,
    validation_errors: "list[str]", duration_ms: Optional[int], retry_count: int,
) -> PilotExtractionResult:
    if processing_status not in PROCESSING_STATUSES:
        raise ValueError(f"processing_status {processing_status!r} is not one of {PROCESSING_STATUSES}")
    return PilotExtractionResult(
        candidate_uuid=entry.candidate_uuid, archive_file_id=entry.archive_file_id,
        source_sha256=entry.source_sha256, model_name=model_name, model_digest=None,
        prompt_version=base_extractor.EXTRACTOR_VERSION, prompt_hash=_compute_prompt_hash(),
        schema_version=base_extractor.EXTRACTOR_VERSION, schema_hash=_compute_schema_hash(),
        pilot_version=PILOT_VERSION, extracted_at=_utc_now_iso(), processing_status=processing_status,
        criteria={}, document_role=None, verdict=None, confidence=None, structural_signals=None,
        validation_errors=validation_errors, processing_duration_ms=duration_ms, retry_count=retry_count,
        failure_category=failure_category,
    )


# =====================================================================
# Local-only, redirect-rejecting, bounded-retry transport safety.
# =====================================================================

_LOOPBACK_HOSTNAMES = ("127.0.0.1", "localhost", "::1")


def assert_loopback_url(raw_url: str) -> None:
    """Duplicated deliberately (not imported) from scripts/semantic_review.py's
    assert_loopback_url - see this module's docstring for why. Fails closed
    (raises ValueError) on anything but a loopback http(s) URL. Repository
    policy provides no approved non-loopback local-network exception
    anywhere else in this codebase, so none is honored here either."""
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"endpoint must use an http(s) loopback URL; got scheme {parsed.scheme!r}")
    if parsed.hostname not in _LOOPBACK_HOSTNAMES:
        raise ValueError(f"endpoint must be a loopback host (one of {_LOOPBACK_HOSTNAMES}); got {parsed.hostname!r}")


MAX_TRANSPORT_RETRIES = 2
RETRY_BACKOFF_SECONDS = 1.0
_REDIRECT_STATUS_CODES = (301, 302, 303, 307, 308)

# Defensive ceiling on raw extracted text before it is ever handed to the
# prompt builder (which additionally truncates to EXTRACTION_CHAR_LIMIT for
# the model itself) - catches a pathological/corrupt extraction result
# early and fails closed instead of building an oversized prompt.
MAX_EXTRACTED_TEXT_CHARS = 2_000_000


class PilotTransportError(RuntimeError):
    def __init__(self, reason_code: str):
        super().__init__(reason_code)
        self.reason_code = reason_code


class SafeLocalSession:
    """Wraps an injected transport (production: the `requests` module;
    tests: a fake with .post()/.get()) and is itself passed as the
    `session=` argument into cdc_candidate_extractor's extract_text() /
    extract_pdf_text() and call_ollama_extraction() - those functions
    already only ever call .post()/.get() on their injected session and
    then .raise_for_status()/.json() on the result, so this wrapper only
    needs to match that minimal surface; it never duplicates the Docling
    submit/poll state machine or the Ollama JSON-repair logic.

    On every call:
      - the target URL must be loopback (assert_loopback_url) - checked
        BEFORE the transport is ever invoked;
      - redirects are never followed (allow_redirects=False is forced) and
        any 3xx response is treated as a hard failure, never silently
        returned to the caller - a well-behaved local service has no
        reason to redirect at all, local destination or not;
      - a transport-level failure (connection error, timeout - anything
        the underlying transport raises) is retried up to max_retries times
        with linear backoff; a redirect or an HTTP error status is NEVER
        retried (neither is transient).
    total_retries accumulates across every call made through one instance,
    for reporting into PilotExtractionResult.retry_count.
    """

    def __init__(
        self, transport, *, max_retries: int = MAX_TRANSPORT_RETRIES,
        backoff_seconds: float = RETRY_BACKOFF_SECONDS, sleep=time.sleep,
    ) -> None:
        self._transport = transport
        self._max_retries = max_retries
        self._backoff_seconds = backoff_seconds
        self._sleep = sleep
        self.total_retries = 0

    def post(self, url: str, **kwargs: Any):
        return self._call("post", url, kwargs)

    def get(self, url: str, **kwargs: Any):
        return self._call("get", url, kwargs)

    def _call(self, method_name: str, url: str, kwargs: dict):
        assert_loopback_url(url)
        kwargs.setdefault("allow_redirects", False)
        last_error: Optional[Exception] = None
        for attempt_index in range(self._max_retries + 1):
            try:
                response = getattr(self._transport, method_name)(url, **kwargs)
            except Exception as error:  # noqa: BLE001 - transport-level only, matches cdc_candidate_extractor's own established broad-catch pattern
                last_error = error
                if attempt_index < self._max_retries:
                    self.total_retries += 1
                    self._sleep(self._backoff_seconds * (attempt_index + 1))
                    continue
                raise PilotTransportError("transport_error") from last_error

            status_code = getattr(response, "status_code", 200)
            if status_code in _REDIRECT_STATUS_CODES:
                # Never retried: a redirect is a policy violation, not a
                # transient failure.
                raise PilotTransportError("redirect_rejected")
            return response
        raise PilotTransportError("transport_error") from last_error  # pragma: no cover - unreachable, loop always returns or raises


def _configure_base_extractor(docling_endpoint: str) -> None:
    """Injects this pilot run's validated, loopback-only Docling endpoint
    into the reused cdc_candidate_extractor module, whose extract_pdf_text()
    builds its request URL from a module-level DOCLING_ENDPOINT constant
    (normally read from KB_DOCLING_ENDPOINT once, at import time). Overriding
    it directly makes each pilot run's configuration explicit and
    independent of whatever environment variable happens to be set in the
    calling process. The Ollama endpoint/model are NOT set here - this
    pilot's own classify_with_ollama() takes them as explicit parameters
    instead (see its docstring), so no equivalent override is needed for
    them. Narrow and confined to this one function - callers (run_execute()
    and the tests) are responsible for restoring the previous value if a
    test needs isolation from a prior call."""
    assert_loopback_url(docling_endpoint)
    base_extractor.DOCLING_ENDPOINT = docling_endpoint.rstrip("/")


# =====================================================================
# Atomic, owner-only-permission local output writing.
# =====================================================================


def ensure_private_directory(path: Path) -> None:
    """Creates `path` (and parents) if missing, then forces owner-only
    (0o700) permissions regardless of umask. Idempotent - safe to call
    before every write."""
    path.mkdir(parents=True, exist_ok=True)
    os.chmod(path, 0o700)


def write_bytes_atomic(path: Path, data: bytes, *, mode: int = 0o600) -> None:
    """Writes `data` to `path` atomically: a temp file in the SAME
    directory (so the final os.replace() is an atomic rename on the same
    filesystem, never a partial write visible to a concurrent reader) with
    owner-only permissions set BEFORE any content is written to it."""
    ensure_private_directory(path.parent)
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        os.chmod(tmp_name, mode)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


class ResultAlreadyExistsError(RuntimeError):
    """Raised by write_pilot_result() when a SUCCESS result already exists
    at the target path and overwrite was not explicitly requested."""


def result_output_path(output_dir: Path, candidate_uuid: str) -> Path:
    return output_dir / f"{candidate_uuid}.json"


def write_pilot_result(output_dir: Path, result: PilotExtractionResult, *, overwrite: bool = False) -> Path:
    """Never silently overwrites a prior SUCCESS result. A prior FAILED/
    PENDING result at the same path is always safe to replace (it recorded
    no usable extraction), regardless of `overwrite`."""
    path = result_output_path(output_dir, result.candidate_uuid)
    if path.is_file() and not overwrite:
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing = None
        if isinstance(existing, dict) and existing.get("processing_status") == "SUCCESS":
            raise ResultAlreadyExistsError(
                f"a successful result already exists for candidate_uuid={result.candidate_uuid!r}; "
                "pass overwrite=True to replace it explicitly."
            )
    payload = json.dumps(result.as_dict(), indent=2, ensure_ascii=False).encode("utf-8")
    write_bytes_atomic(path, payload)
    return path


# =====================================================================
# Checkpoint / resume (atomic + owner-only, unlike the existing checkpoint
# writers in cdc_candidate_extractor.py / scripts/semantic_review.py).
# =====================================================================


def build_pilot_scope_config(entries: "list[PilotManifestEntry]", model_name: str, docling_endpoint: str, ollama_endpoint: str) -> dict:
    return {
        "mode": "cdc_pilot_extractor",
        "pilot_version": PILOT_VERSION,
        "manifest_signature": hashlib.sha256(
            json.dumps(sorted(entry.candidate_uuid for entry in entries)).encode("utf-8")
        ).hexdigest()[:16],
        "model_name": model_name,
        "docling_endpoint": docling_endpoint,
        "ollama_endpoint": ollama_endpoint,
        "prompt_hash": _compute_prompt_hash()[:16],
        "schema_hash": _compute_schema_hash()[:16],
    }


def compute_scope_signature(config: dict) -> str:
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode("utf-8")).hexdigest()


# describe_scope_mismatch is generic/pure (two dicts in, a diff string out)
# with no cdc_candidate_extractor-specific keys baked in - reused verbatim
# rather than duplicated.
describe_scope_mismatch = base_extractor.describe_scope_mismatch


@dataclass
class PilotCheckpoint:
    scope_signature: str
    config: dict
    completed_candidate_uuids: "list[str]" = field(default_factory=list)
    aggregate: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "scope_signature": self.scope_signature,
            "config": self.config,
            "completed_candidate_uuids": sorted(set(self.completed_candidate_uuids)),
            "aggregate": self.aggregate,
        }

    @staticmethod
    def from_dict(data: dict) -> "PilotCheckpoint":
        return PilotCheckpoint(
            scope_signature=data["scope_signature"],
            config=dict(data.get("config", {})),
            completed_candidate_uuids=list(data.get("completed_candidate_uuids", [])),
            aggregate=dict(data.get("aggregate", {})),
        )


def load_pilot_checkpoint(path: Path) -> Optional[PilotCheckpoint]:
    """Fails closed to None on any malformed/unreadable file."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return PilotCheckpoint.from_dict(data)
    except (json.JSONDecodeError, OSError, KeyError, TypeError):
        return None


def save_pilot_checkpoint(path: Path, checkpoint: PilotCheckpoint) -> None:
    payload = json.dumps(checkpoint.as_dict(), indent=2, ensure_ascii=False).encode("utf-8")
    write_bytes_atomic(path, payload)


# =====================================================================
# Private (outside-Git) output directory guard.
# =====================================================================


class OutputDirectoryError(RuntimeError):
    pass


def validate_private_output_dir(output_dir: Path, repo_root: Path) -> None:
    """--execute requires an output directory fully OUTSIDE the Git
    repository tree - not merely one covered by a .gitignore rule. This
    removes any dependency on .gitignore correctness for the confidentiality
    of real pilot results (candidate identifiers, per-candidate JSON, any
    future checkpoint) and matches the task's "private output directory
    outside Git" requirement literally."""
    resolved_output = output_dir.expanduser().resolve()
    resolved_repo = repo_root.expanduser().resolve()
    if resolved_output == resolved_repo or resolved_repo in resolved_output.parents:
        raise OutputDirectoryError(
            "--output-dir must be a private directory fully outside the Git repository tree "
            f"({resolved_repo}); refusing to write real pilot results inside the repo."
        )


# =====================================================================
# Confirmation token (mirrors cdc_review_importer.py's
# build_confirmation_token convention: derived only from fixed,
# non-confidential values - never from a hash, identifier, or path).
# =====================================================================


def build_confirmation_token(entry_count: int, model_name: str) -> str:
    return f"CONFIRM-PILOT-{entry_count}-{model_name}"


# =====================================================================
# Strict Ollama classification.
#
# cdc_candidate_extractor.call_ollama_extraction() is deliberately LENIENT
# (its own docstring: "task-relaxed validation... only document_role,
# verdict, and criteres are load-bearing enough to reject the whole row
# over" - missing/malformed criteria are silently normalized to "Non
# déterminable" rather than rejected). That behavior is intentional,
# tested, and serves that module's own bulk-discovery caller - it is left
# completely untouched here.
#
# THIS pilot's task explicitly requires the opposite: "reject extra,
# missing or malformed criteria" and "validate every response against the
# JSON schema". So this section reuses the established prompt/schema and
# the pure JSON-extraction/repair-prompt helpers (build_prompt,
# extract_json_object, build_repair_prompt - genuinely generic, nothing
# lenient about them), but adds a NEW strict admission gate on top, using
# jsonschema.validate() against the SAME schema file
# (additionalProperties:false + full "required" lists already there) -
# never a second, competing schema.
# =====================================================================

DEFAULT_OLLAMA_TIMEOUT_SECONDS = 120.0


def _sanitize_validation_error(error: "jsonschema.exceptions.ValidationError") -> str:
    """Never includes error.message (which echoes the invalid instance
    value verbatim - could be a stray fragment of model output). Only the
    JSON path and the violated keyword name, both derived purely from the
    fixed schema structure, are safe to surface."""
    path = ".".join(str(part) for part in error.absolute_path) or "<root>"
    return f"schema validation failed at {path!r} ({error.validator})"


def _parse_and_strict_validate(raw_response: str) -> "tuple[Optional[dict], list[str], bool]":
    """Returns (payload_or_none, sanitized_errors, was_json_decode_failure)."""
    cleaned = base_extractor.extract_json_object(raw_response)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        return None, ["response is not valid JSON"], True
    try:
        jsonschema.validate(instance=payload, schema=SCHEMA)
    except jsonschema.exceptions.ValidationError as error:
        return None, [_sanitize_validation_error(error)], False
    return payload, [], False


def _post_ollama_generate(
    ollama_endpoint: str, model: str, prompt: str, session, timeout: float,
) -> str:
    payload = {"model": model, "prompt": prompt, "stream": False, "format": SCHEMA, "options": {"temperature": 0}}
    response = session.post(f"{ollama_endpoint}/api/generate", json=payload, timeout=timeout)
    response.raise_for_status()
    return response.json()["response"]


def classify_with_ollama(
    text: str, document_id: str, source_hash: str, ollama_endpoint: str, model: str, session,
    *, language: str = "fr", timeout: float = DEFAULT_OLLAMA_TIMEOUT_SECONDS,
) -> "tuple[Optional[dict], str, Optional[str], list[str]]":
    """Returns (extraction_or_none, outcome, failure_category, errors).
    outcome is one of "first_try"/"after_repair"/"failed". Exactly one
    controlled repair attempt (never re-sent with the document text - the
    model already has its own prior answer to fix), mirroring
    cdc_candidate_extractor's own repair convention. Never raises - every
    transport/JSON/schema failure fails closed to ("failed", category,
    errors)."""
    prompt = base_extractor.build_prompt(text, document_id, source_hash, language)
    schema_json_text = base_extractor.SCHEMA_PATH.read_text(encoding="utf-8")

    try:
        raw = _post_ollama_generate(ollama_endpoint, model, prompt, session, timeout)
    except PilotTransportError as error:
        return None, "failed", "OLLAMA_UNREACHABLE", [error.reason_code]
    except Exception as error:  # noqa: BLE001 - transport-level only
        return None, "failed", "OLLAMA_UNREACHABLE", [str(error)]

    payload, errors, decode_failed = _parse_and_strict_validate(raw)
    if payload is not None:
        return payload, "first_try", None, []

    try:
        repair_prompt = base_extractor.build_repair_prompt(raw, "; ".join(errors), schema_json_text)
        repaired_raw = _post_ollama_generate(ollama_endpoint, model, repair_prompt, session, timeout)
    except PilotTransportError as error:
        return None, "failed", "OLLAMA_UNREACHABLE", [error.reason_code]
    except Exception as error:  # noqa: BLE001 - transport-level only
        return None, "failed", "OLLAMA_UNREACHABLE", [str(error)]

    repaired_payload, repaired_errors, repaired_decode_failed = _parse_and_strict_validate(repaired_raw)
    if repaired_payload is not None:
        return repaired_payload, "after_repair", None, []

    failure_category = "INVALID_JSON" if repaired_decode_failed else "SCHEMA_INVALID"
    return None, "failed", failure_category, repaired_errors


# =====================================================================
# Per-candidate pipeline.
# =====================================================================


def process_pilot_entry(
    entry: PilotManifestEntry, model_name: str, ollama_endpoint: str, session: SafeLocalSession, *, sleep=time.sleep,
) -> PilotExtractionResult:
    """Full per-candidate pipeline: fresh hash re-verification (defense in
    depth against a TOCTOU change since the batch-level
    validate_manifest_for_execution() check), text extraction, oversized-
    text guard, strict Ollama classification (classify_with_ollama - one
    repair attempt, strict jsonschema validation), and result assembly.
    NEVER logs or returns entry.local_source_path or
    entry.selection_reason - only the opaque candidate_uuid/archive_file_id
    ever appear on the returned result or in any exception message."""
    started = time.monotonic()

    hash_errors = validate_manifest_for_execution([entry])
    if hash_errors:
        return build_failure_result(
            entry, model_name, "TEXT_EXTRACTION_FAILED", "SOURCE_VERIFICATION_FAILED",
            hash_errors, int((time.monotonic() - started) * 1000), session.total_retries,
        )

    candidate = base_extractor.CandidateFile(
        path=Path(entry.local_source_path), relative_path="", project="", year=entry.year,
        extension=entry.extension, candidate_id=entry.candidate_uuid,
    )

    # Note on SafeLocalSession + call_ollama_extraction/extract_text composed
    # retry bound: cdc_candidate_extractor's own retry logic (Ollama's
    # structured-format-then-json-fallback, and the one JSON-repair attempt)
    # each issue their own session.post() call, and EACH of those calls is
    # independently retried by SafeLocalSession up to MAX_TRANSPORT_RETRIES
    # times. The composed worst case is therefore bounded but multiplicative
    # (at most a handful of underlying HTTP attempts per candidate) - never
    # unbounded. Both layers convert every transport failure to an
    # ExtractionError with a stable reason_code (never let a
    # PilotTransportError escape uncaught) - see extract_pdf_text's and
    # _post_ollama_generate's own broad `except Exception` handling.
    try:
        text = base_extractor.extract_text(candidate, session=session)
    except base_extractor.ExtractionError as error:
        return build_failure_result(
            entry, model_name, "TEXT_EXTRACTION_FAILED", error.reason_code,
            [error.detail], int((time.monotonic() - started) * 1000), session.total_retries,
        )

    if len(text) > MAX_EXTRACTED_TEXT_CHARS:
        return build_failure_result(
            entry, model_name, "TEXT_EXTRACTION_FAILED", "TEXT_TOO_LARGE",
            [f"extracted text exceeds the {MAX_EXTRACTED_TEXT_CHARS}-character pilot ceiling"],
            int((time.monotonic() - started) * 1000), session.total_retries,
        )

    # No model-digest lookup is implemented in this pilot (fetch_model_identity
    # is scripts/semantic_review.py-specific plumbing this task does not
    # reuse) - always None rather than fabricated.
    model_identity = None

    extraction, outcome, failure_category, ollama_errors = classify_with_ollama(
        text, entry.candidate_uuid, entry.source_sha256, ollama_endpoint, model_name, session,
    )

    duration_ms = int((time.monotonic() - started) * 1000)

    if outcome == "failed":
        processing_status = failure_category or "OLLAMA_UNREACHABLE"
        return build_failure_result(
            entry, model_name, processing_status, processing_status, ollama_errors, duration_ms, session.total_retries,
        )

    assert extraction is not None  # outcome in {"first_try", "after_repair"} always carries a payload
    return build_result_from_extraction(entry, model_name, model_identity, extraction, duration_ms, session.total_retries)


# =====================================================================
# Dry-run report (aggregate-only; never a per-entry identifier, path, or
# filename appears in anything this function returns).
# =====================================================================


@dataclass
class DryRunReport:
    manifest_loaded: bool
    manifest_error: Optional[str]
    entry_count: int
    structural_errors: "list[str]"
    valid: bool
    processing_group_counts: dict
    extension_counts: dict


def run_dry_run(manifest_path: Path) -> DryRunReport:
    """Validates configuration/manifest structure and prints only sanitized
    aggregates. Opens no real document, calls no local service, uses no
    PostgreSQL - the only filesystem access here is reading the manifest
    JSON file itself."""
    try:
        entries = load_manifest(manifest_path)
    except ManifestError as error:
        return DryRunReport(
            manifest_loaded=False, manifest_error=str(error), entry_count=0,
            structural_errors=[], valid=False, processing_group_counts={}, extension_counts={},
        )

    errors = validate_manifest_structure(entries)
    return DryRunReport(
        manifest_loaded=True, manifest_error=None, entry_count=len(entries), structural_errors=errors,
        valid=(len(errors) == 0),
        processing_group_counts=dict(Counter(entry.processing_group for entry in entries)),
        extension_counts=dict(Counter(entry.extension for entry in entries)),
    )


def print_dry_run_report(report: DryRunReport) -> None:
    print("cdc_pilot_extractor dry-run report:")
    print(f"  manifest_loaded: {report.manifest_loaded}")
    if report.manifest_error:
        print(f"  manifest_error: {report.manifest_error}")
    print(f"  entry_count: {report.entry_count}")
    print(f"  valid: {report.valid}")
    print(f"  structural_error_count: {len(report.structural_errors)}")
    for error in report.structural_errors:
        print(f"    - {error}")
    print(f"  processing_group_counts: {report.processing_group_counts}")
    print(f"  extension_counts: {report.extension_counts}")
    print("  database_accessed: NO")
    print("  network_accessed: NO")
    print("  documents_opened: NO")


# =====================================================================
# --execute guard chain + orchestration.
# =====================================================================


@dataclass
class ExecuteRunReport:
    guard_passed: bool
    guard_errors: "list[str]"
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped_already_done: int = 0
    failure_categories: dict = field(default_factory=dict)


def run_execute(
    args: argparse.Namespace, session_factory, *, repo_root: Path = ROOT.parent.parent, sleep=time.sleep,
) -> ExecuteRunReport:
    """`session_factory` is a zero-argument callable returning the raw
    transport to wrap in a SafeLocalSession (production: `lambda: requests`;
    tests: a fake-transport factory) - never constructed before every guard
    below has passed, so a guard failure never even instantiates a
    transport, let alone calls it."""
    guard_errors: list[str] = []

    try:
        entries = load_manifest(Path(args.manifest))
    except ManifestError as error:
        return ExecuteRunReport(guard_passed=False, guard_errors=[str(error)])

    guard_errors.extend(validate_manifest_structure(entries))
    if len(entries) != PILOT_ENTRY_COUNT:
        guard_errors.append(f"--execute requires exactly {PILOT_ENTRY_COUNT} manifest entries")

    expected_token = build_confirmation_token(len(entries), args.model)
    if args.confirm_token != expected_token:
        guard_errors.append("--confirm-token does not match the expected value for this manifest/model.")

    try:
        assert_loopback_url(args.docling_endpoint)
    except ValueError as error:
        guard_errors.append(f"--docling-endpoint rejected: {error}")
    try:
        assert_loopback_url(args.ollama_endpoint)
    except ValueError as error:
        guard_errors.append(f"--ollama-endpoint rejected: {error}")

    if not args.model:
        guard_errors.append("--model is required and must name the exact model to use.")

    try:
        validate_private_output_dir(Path(args.output_dir), repo_root)
    except OutputDirectoryError as error:
        guard_errors.append(str(error))

    if guard_errors:
        return ExecuteRunReport(guard_passed=False, guard_errors=guard_errors)

    # Only now - after every guard above has passed - is a real filesystem
    # path (other than the manifest file itself) ever touched.
    guard_errors.extend(validate_manifest_for_execution(entries))
    if guard_errors:
        return ExecuteRunReport(guard_passed=False, guard_errors=guard_errors)

    _configure_base_extractor(args.docling_endpoint)

    output_dir = Path(args.output_dir)
    ensure_private_directory(output_dir)

    checkpoint_path = Path(args.checkpoint_file) if args.checkpoint_file else output_dir / ".pilot_checkpoint.json"
    scope_config = build_pilot_scope_config(entries, args.model, args.docling_endpoint, args.ollama_endpoint)
    scope_signature = compute_scope_signature(scope_config)
    existing = load_pilot_checkpoint(checkpoint_path)

    if existing is not None and existing.scope_signature == scope_signature:
        if not args.resume:
            return ExecuteRunReport(
                guard_passed=False,
                guard_errors=["an incomplete checkpoint already exists for this exact scope; pass --resume to continue it."],
            )
        checkpoint = existing
    elif existing is not None and args.resume:
        return ExecuteRunReport(
            guard_passed=False,
            guard_errors=[f"--resume was passed but the checkpoint scope does not match: {describe_scope_mismatch(existing.config, scope_config)}"],
        )
    else:
        checkpoint = PilotCheckpoint(scope_signature=scope_signature, config=scope_config)

    report = ExecuteRunReport(guard_passed=True, guard_errors=[])
    completed = set(checkpoint.completed_candidate_uuids)

    for entry in entries:
        if entry.candidate_uuid in completed:
            report.skipped_already_done += 1
            continue

        session = SafeLocalSession(session_factory(), sleep=sleep)
        result = process_pilot_entry(entry, args.model, args.ollama_endpoint, session, sleep=sleep)

        try:
            write_pilot_result(output_dir, result, overwrite=args.overwrite)
        except ResultAlreadyExistsError as error:
            report.failed += 1
            report.failure_categories["RESULT_ALREADY_EXISTS"] = report.failure_categories.get("RESULT_ALREADY_EXISTS", 0) + 1
            continue

        report.processed += 1
        if result.processing_status == "SUCCESS":
            report.succeeded += 1
            checkpoint.completed_candidate_uuids.append(entry.candidate_uuid)
        else:
            report.failed += 1
            category = result.failure_category or "unknown"
            report.failure_categories[category] = report.failure_categories.get(category, 0) + 1

        checkpoint.aggregate = {
            "processed": report.processed, "succeeded": report.succeeded, "failed": report.failed,
        }
        save_pilot_checkpoint(checkpoint_path, checkpoint)

    return report


def print_execute_report(report: ExecuteRunReport) -> None:
    print("cdc_pilot_extractor execute report:")
    print(f"  guard_passed: {report.guard_passed}")
    for error in report.guard_errors:
        print(f"  guard_error: {error}")
    if not report.guard_passed:
        return
    print(f"  processed: {report.processed}")
    print(f"  succeeded: {report.succeeded}")
    print(f"  failed: {report.failed}")
    print(f"  skipped_already_done: {report.skipped_already_done}")
    print(f"  failure_categories: {report.failure_categories}")


# =====================================================================
# CLI
# =====================================================================


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cdc_pilot_extractor.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--manifest", type=str, default=str(DEFAULT_MANIFEST_PATH))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-token", type=str, default=None, metavar="TOKEN")
    parser.add_argument("--docling-endpoint", type=str, default=None, metavar="URL")
    parser.add_argument("--ollama-endpoint", type=str, default=None, metavar="URL")
    parser.add_argument("--model", type=str, default=None, metavar="NAME")
    parser.add_argument("--output-dir", type=str, default=None, metavar="PATH")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--checkpoint-file", type=str, default=None, metavar="PATH")
    return parser


def _validate_args(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    if args.dry_run and args.execute:
        parser.error("--dry-run and --execute are mutually exclusive.")
    if not args.dry_run and not args.execute:
        parser.error("one of --dry-run or --execute is required.")
    if args.execute:
        required = (
            ("--confirm-token", args.confirm_token), ("--docling-endpoint", args.docling_endpoint),
            ("--ollama-endpoint", args.ollama_endpoint), ("--model", args.model), ("--output-dir", args.output_dir),
        )
        missing = [name for name, value in required if not value]
        if missing:
            parser.error(f"--execute requires: {', '.join(missing)}")


def main(argv: Optional["list[str]"] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    _validate_args(parser, args)

    if args.dry_run:
        report = run_dry_run(Path(args.manifest))
        print_dry_run_report(report)
        return 0 if report.valid else 1

    import requests  # imported lazily: --dry-run must never require/import a network-capable module at all

    report = run_execute(args, session_factory=lambda: requests)
    print_execute_report(report)
    return 0 if (report.guard_passed and report.failed == 0) else 1


if __name__ == "__main__":
    raise SystemExit(main())
