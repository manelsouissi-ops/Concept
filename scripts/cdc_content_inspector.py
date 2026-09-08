#!/usr/bin/env python3
"""Local-only document content inspection for CDC discovery (Phase 4).

This module is the real implementation of the `ContentInspector` interface
defined in scripts/cdc_discovery.py - it is NOT wired into that script's
default (Null) behavior; it is only used when a caller explicitly
constructs a LocalContentInspector and passes it into
run_pilot_discovery()/run_pilot_mode(). Nothing in this module is invoked
automatically by `--pilot-limit ... --dry-run` alone.

SAFETY GUARANTEES
- Local only. PDF extraction shells out to the existing local Docling
  environment (scripts/document_parser_service.py, run via its own
  isolated .venv-docling interpreter) exactly the way that service already
  invokes itself internally - no new external dependency. DOCX extraction
  uses only the Python standard library (zipfile + XML), no new
  dependency. Legacy .doc extraction uses local LibreOffice headless
  conversion to .docx (subprocess, PATH-resolved, isolated per-call temp
  directory and profile, source never modified) followed by the same
  DOCX text-reading core - see convert_doc_to_docx_via_libreoffice /
  extract_doc_text. OCR still has no local tool wired in and remains a
  reserved, not-yet-implemented fallback. Every extraction path fails
  closed to NEEDS_REVIEW on any error rather than guessing.
- The only network call this module can ever make is to a local Ollama
  instance, and only when a caller explicitly constructs an
  OllamaAiAdapter and passes it into LocalContentInspector. The adapter
  refuses (raises) at construction time if given anything other than a
  loopback URL (127.0.0.1/localhost) - see assert_loopback_url(). There is
  no cloud/external code path anywhere in this module.
- Extracted text is length-limited (EXTRACTION_CHAR_LIMIT) before any
  further processing (Step 7, content minimization) and is NEVER stored,
  logged, or returned in full - only short reason/evidence CODES ever
  leave this module (see ContentInspectionOutcome.reason_code in
  cdc_discovery.py). No function in this module prints anything.
- CONFIRMED_CDC requires: content inspection actually attempted, a
  document-level "CDC" role signal specifically (not just any
  tender-related signal - DAO/TDR/DCE/RFP keep their own role), and
  confidence at or above a conservative threshold. See
  decide_content_verification().
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from html.parser import HTMLParser as _HTMLParser
from pathlib import Path
from typing import Callable, Optional, Protocol

from cdc_discovery import (
    DOCUMENT_ROLES,
    ContentInspectionOutcome,
    DiscoveryCounters,
)
from technical_source_classifier import classify_technical_source

EXTRACTION_CHAR_LIMIT = 20_000
DOCLING_TIMEOUT_SECONDS = 60.0
OLLAMA_TIMEOUT_SECONDS = 30.0
OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
OLLAMA_MODEL = "qwen3:14b"

# A document-role signal must reach this confidence for CONFIRMED_CDC.
# Deliberately high - "prefer conservative classification" (Step 4).
CONFIRMED_CDC_CONFIDENCE_THRESHOLD = 0.85


class ExtractionError(Exception):
    """Raised by any extract_* function on failure. Always carries a short,
    aggregate-safe reason_code (never a filename/path). Caller
    (LocalContentInspector) always catches this and converts it into a
    NEEDS_REVIEW outcome - never lets a raw exception (or its message,
    which could theoretically embed a path) escape to the orchestrator."""

    def __init__(self, reason_code: str, sanitized_diagnostic: Optional[str] = None) -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code
        # Optional, ALREADY-SANITIZED (see _sanitize_process_diagnostic)
        # short diagnostic for local debugging only - never populated with
        # raw document content, never printed automatically by any caller.
        self.sanitized_diagnostic = sanitized_diagnostic


# Maps an ExtractionError.reason_code to the specific DiscoveryCounters
# attribute it should increment, for PDF extraction only (Step 4). Every
# PDF failure reason this module can raise is listed here; a reason with no
# dedicated counter (e.g. "ocr_not_available", already reflected via
# docling_output_empty + ocr_calls at its own raise site) maps to None.
_PDF_FAILURE_REASON_COUNTERS: dict[str, Optional[str]] = {
    "pdf_path_missing": "pdf_path_missing",
    "docling_python_missing": "docling_python_missing",
    "docling_process_failed": "docling_process_failed",
    "docling_timeout": "docling_timeout",
    "docling_output_missing": "docling_output_missing",
    "ocr_not_available": None,
}


# =====================================================================
# PDF extraction - via the existing local Docling service, subprocess-invoked
# =====================================================================

DoclingConverter = Callable[[Path, Path], None]

DEFAULT_DOCLING_VENV_PYTHON = Path.home() / ".venv-docling" / "bin" / "python"


def resolve_docling_python() -> Optional[Path]:
    """Resolves the interpreter used to run the isolated Docling
    environment.

    DOCLING_PYTHON, if set in the environment, is trusted as an explicit
    operator override and used as-is. Otherwise this defaults to
    ~/.venv-docling/bin/python (the manually-verified working interpreter)
    - but ONLY if that executable actually exists on disk. It never falls
    back to the ambient `python3` (which is not guaranteed - and in this
    repository's own archive_cartography venv, is confirmed NOT - to have
    Docling installed): returns None instead, so the caller fails closed
    with a clear docling_python_missing reason rather than silently trying
    to run Docling under an interpreter that doesn't have it."""
    configured = os.environ.get("DOCLING_PYTHON", "").strip()
    if configured:
        return Path(configured)
    return DEFAULT_DOCLING_VENV_PYTHON if DEFAULT_DOCLING_VENV_PYTHON.exists() else None


def default_docling_converter(source: Path, destination: Path, timeout: float = DOCLING_TIMEOUT_SECONDS) -> None:
    """Real Docling invocation, mirroring the exact subprocess pattern
    scripts/document_parser_service.py already uses internally (its own
    `process()` function) to hand a PDF to the isolated Docling
    interpreter. NEVER called during synthetic unit tests - tests inject a
    fake converter via LocalContentInspector(pdf_converter=...)."""
    docling_python = resolve_docling_python()
    if docling_python is None:
        raise ExtractionError("docling_python_missing")

    service_script = Path(__file__).resolve().parent / "document_parser_service.py"
    try:
        completed = subprocess.run(
            [str(docling_python), str(service_script), "--convert", str(source), "--output", str(destination)],
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as error:
        raise ExtractionError("docling_timeout") from error
    except OSError as error:
        # e.g. the configured interpreter path exists in DOCLING_PYTHON's
        # env var but isn't actually executable, or spawning failed for
        # some other OS-level reason.
        raise ExtractionError("docling_process_failed") from error

    if completed.returncode != 0:
        raise ExtractionError("docling_process_failed")


def attempt_ocr_fallback(path: Path, counters: DiscoveryCounters) -> str:
    """Reserved OCR fallback extension point (Step 3: "OCR only if
    necessary"). No local OCR engine was confirmed available in this
    environment (see the infrastructure survey in the accompanying
    report), so this always fails safely rather than fabricating a result.
    The counter increments regardless, so callers/tests can prove the
    fallback was genuinely triggered; a future local OCR tool would only
    need to change this one function's body."""
    counters.ocr_calls += 1
    raise ExtractionError("ocr_not_available")


def extract_pdf_text(
    path: Path,
    counters: DiscoveryCounters,
    char_limit: int = EXTRACTION_CHAR_LIMIT,
    converter: DoclingConverter = default_docling_converter,
) -> str:
    """Local text extraction step 1+2 (Step 3): the Docling pipeline
    already performs its own local text-layer extraction; no separate
    "plain text extraction" tool exists in this environment to try first
    (see the infrastructure survey in the accompanying report). If the
    result comes back empty (a strong signal of a scanned/image-only PDF),
    falls back to attempt_ocr_fallback() (step 3 of the PDF order) rather
    than silently returning an empty string.

    pdf_extraction_calls always increments (an attempt happened).
    pdf_extraction_successes/pdf_extraction_failures and the granular
    reason counters are tallied centrally by the caller
    (LocalContentInspector.inspect / tally_pdf_extraction_failure) so the
    invariant pdf_extraction_calls == successes + failures always holds in
    exactly one place."""
    counters.pdf_extraction_calls += 1

    if not path.exists():
        raise ExtractionError("pdf_path_missing")

    with tempfile.TemporaryDirectory() as tmp_dir:
        destination = Path(tmp_dir) / "output.md"
        converter(path, destination)
        if not destination.exists():
            raise ExtractionError("docling_output_missing")
        text = destination.read_text(encoding="utf-8", errors="replace")

    if not text.strip():
        counters.docling_output_empty += 1
        return attempt_ocr_fallback(path, counters)

    return text[:char_limit]


def tally_pdf_extraction_failure(counters: DiscoveryCounters, reason_code: str) -> None:
    """Centralizes PDF failure bookkeeping so the invariant
    pdf_extraction_calls == pdf_extraction_successes + pdf_extraction_failures
    always holds: exactly one call site (LocalContentInspector.inspect)
    increments pdf_extraction_failures, general failed_extractions, and the
    specific granular reason counter for a given ExtractionError."""
    counters.pdf_extraction_failures += 1
    counters.failed_extractions += 1
    attr = _PDF_FAILURE_REASON_COUNTERS.get(reason_code)
    if attr is not None:
        setattr(counters, attr, getattr(counters, attr) + 1)


# =====================================================================
# DOCX extraction - stdlib only (zipfile + XML), no new dependency
# =====================================================================

_DOCX_WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_DOCX_TEXT_TAG = f"{{{_DOCX_WORD_NAMESPACE}}}t"

# Phase 4 (review workflow): word/document.xml alone already covers
# ordinary paragraphs AND tables (a <w:tbl>'s cells are just more <w:p>/
# <w:r>/<w:t> runs nested under the same root - root.iter() below already
# walks every descendant regardless of nesting depth) and text boxes
# (both the modern DrawingML <w:txbxContent> and the legacy VML
# <v:textbox><w:txbxContent> form nest ordinary <w:t> runs too). Headers,
# footers, footnotes and endnotes, however, are each a SEPARATE XML part
# in the zip - never reachable from document.xml at all - which is why
# they were silently skipped before. Read in a fixed, deterministic order
# (body, then headers/footers sorted by part name, then footnotes, then
# endnotes) so a rerun is always byte-identical, and each part is read at
# most once - never duplicated.
_DOCX_HEADER_FOOTER_PART_PATTERN = re.compile(r"^word/(header|footer)\d+\.xml$")


def _extract_text_fragments_from_xml_bytes(xml_bytes: bytes) -> list[str]:
    root = ET.fromstring(xml_bytes)
    return [node.text for node in root.iter(_DOCX_TEXT_TAG) if node.text]


def _read_docx_text(path: Path, char_limit: int) -> str:
    """Core DOCX text extraction (stdlib zipfile + XML) - no counter side
    effects, so it can be shared by both extract_docx_text (native .docx
    files) and extract_doc_text (LibreOffice-converted .doc files) without
    either miscounting the other's *_extraction_calls."""
    try:
        with zipfile.ZipFile(path) as archive:
            try:
                with archive.open("word/document.xml") as handle:
                    body_xml_bytes = handle.read()
            except KeyError as error:
                raise ExtractionError("docx_read_failed") from error

            part_names = archive.namelist()
            header_footer_parts = sorted(
                name for name in part_names if _DOCX_HEADER_FOOTER_PART_PATTERN.match(name)
            )
            extra_part_names = header_footer_parts + [
                name for name in ("word/footnotes.xml", "word/endnotes.xml") if name in part_names
            ]

            extra_xml_bytes: list[bytes] = []
            for name in extra_part_names:
                with archive.open(name) as handle:
                    extra_xml_bytes.append(handle.read())
    except (zipfile.BadZipFile, OSError) as error:
        raise ExtractionError("docx_read_failed") from error

    try:
        fragments = _extract_text_fragments_from_xml_bytes(body_xml_bytes)
        for xml_bytes in extra_xml_bytes:
            # A malformed header/footer/footnote part never fails the
            # whole extraction (the main body already parsed fine) - it is
            # simply skipped, exactly like a document with no such part.
            try:
                fragments.extend(_extract_text_fragments_from_xml_bytes(xml_bytes))
            except ET.ParseError:
                continue
    except ET.ParseError as error:
        raise ExtractionError("docx_xml_parse_failed") from error

    return " ".join(fragments)[:char_limit]


def extract_docx_text(path: Path, counters: DiscoveryCounters, char_limit: int = EXTRACTION_CHAR_LIMIT) -> str:
    """DOCX is a zip archive containing word/document.xml with plain-text
    runs in <w:t> elements - extractable with only the standard library,
    no new dependency needed."""
    counters.docx_extraction_calls += 1
    return _read_docx_text(path, char_limit)


# =====================================================================
# Legacy DOC extraction - LOCAL LibreOffice headless conversion to DOCX,
# then the same DOCX text-reading core as above (Task 2: "prefer
# conversion to DOCX if reliable because DOCX extraction already exists").
#
# Read-only/safety guarantees:
# - subprocess only, local execution only (LibreOffice's own --headless
#   CLI, resolved via PATH lookup - see resolve_libreoffice_binary).
# - the source file is never modified: LibreOffice's --convert-to/--outdir
#   combination writes ONLY to the given output directory, never back to
#   the input path. The archive mount itself is also already a read-only
#   mount at the OS level, an independent guarantee.
# - all converted/temporary output lives in a fresh tempfile.TemporaryDirectory
#   per call (unique per extraction - no cross-call filename collisions
#   possible) OUTSIDE the archive, always cleaned up via the `with` block
#   on every exit path (success, extraction failure, or an unexpected
#   exception alike).
# - a dedicated, isolated LibreOffice user profile directory is used per
#   call (-env:UserInstallation) to avoid the well-known "already running
#   / profile locked" failure mode when converting many files in sequence.
# - no raw converted text and no source filename/path are ever logged.
# =====================================================================

LIBREOFFICE_TIMEOUT_SECONDS = 60.0
_LIBREOFFICE_BINARY_CANDIDATES = ("libreoffice", "soffice")


def resolve_libreoffice_binary() -> Optional[str]:
    """Resolves the local LibreOffice executable via a plain PATH lookup
    (shutil.which) only - never assumes a hardcoded install location.
    Returns None (fail closed) if neither `libreoffice` nor `soffice` is
    found, so the caller reports libreoffice_missing rather than guessing
    a path that may not exist."""
    for name in _LIBREOFFICE_BINARY_CANDIDATES:
        resolved = shutil.which(name)
        if resolved:
            return resolved
    return None


# =====================================================================
# Source format sniffing (Phase 1/3 review-workflow repair) - a small,
# local, offline signature check on the first few bytes only. Legacy .doc
# is sometimes not a genuine OLE2 binary at all (an RTF/HTML/XML/DOCX
# document that was merely renamed/saved with a .doc extension); routing
# those through LibreOffice's .doc importer is exactly the kind of
# mismatch that can silently produce a near-empty conversion. Detection is
# DELIBERATELY PERMISSIVE: it only redirects away from the normal
# LibreOffice path when a signature POSITIVELY matches a different known
# format; anything inconclusive (including a genuine OLE2 .doc, or a tiny/
# synthetic test fixture with no recognizable signature at all) falls
# through to the existing LibreOffice conversion path unchanged, so a
# real .doc is never rejected on a false negative.
# =====================================================================

_OLE2_SIGNATURE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_ZIP_SIGNATURE = b"PK\x03\x04"
_SNIFF_HEADER_BYTES = 8
_SNIFF_TEXT_PREFIX_BYTES = 4096
# Standard CFBF/OOXML password-protection wrapper: encrypted Office
# documents (including legacy .doc saved with a password) store their
# content under a stream literally named "EncryptedPackage" (or, for
# older RC4 encryption, "EncryptionInfo"), encoded as UTF-16LE in the
# compound file directory - a well-known, safe, local signature check
# that requires no OLE2 directory parser.
_OLE2_ENCRYPTION_MARKERS = (
    "EncryptedPackage".encode("utf-16-le"),
    "EncryptionInfo".encode("utf-16-le"),
)
_ENCRYPTION_SCAN_BYTES = 2_000_000


def _sniff_source_format(path: Path) -> str:
    """Returns "OLE2", "ZIP", "RTF", "HTML", "XML", or "UNKNOWN" from the
    first few bytes/characters only - never reads the full file, never
    logs anything it read."""
    try:
        with path.open("rb") as handle:
            header = handle.read(_SNIFF_HEADER_BYTES)
            handle.seek(0)
            text_prefix = handle.read(_SNIFF_TEXT_PREFIX_BYTES)
    except OSError:
        return "UNKNOWN"

    if header.startswith(_OLE2_SIGNATURE):
        return "OLE2"
    if header.startswith(_ZIP_SIGNATURE):
        return "ZIP"

    stripped = text_prefix.lstrip()
    if stripped.startswith(b"{\\rtf"):
        return "RTF"
    lowered = stripped[:512].lower()
    if lowered.startswith(b"<!doctype html") or lowered.startswith(b"<html") or b"<html" in lowered[:200]:
        return "HTML"
    if stripped.startswith(b"<?xml"):
        return "XML"
    return "UNKNOWN"


def _ole2_has_encryption_marker(path: Path) -> bool:
    """A bounded, local, offline scan for the standard CFBF encryption
    wrapper stream name - never a full-file read for large files, never
    logs/returns any document content."""
    try:
        with path.open("rb") as handle:
            data = handle.read(_ENCRYPTION_SCAN_BYTES)
    except OSError:
        return False
    return any(marker in data for marker in _OLE2_ENCRYPTION_MARKERS)


# =====================================================================
# RTF/HTML fallback extraction - stdlib only, used when a ".doc"-named
# file is actually RTF or HTML (see _sniff_source_format above). Neither
# ever shells out to LibreOffice or any other subprocess.
# =====================================================================

_RTF_CONTROL_WORD_RE = re.compile(r"\\[a-zA-Z]+-?\d*[ ]?")
_RTF_HEX_ESCAPE_RE = re.compile(r"\\'[0-9a-fA-F]{2}")
_RTF_GROUP_CHARS_RE = re.compile(r"[{}]")


def extract_rtf_text(path: Path, char_limit: int) -> str:
    """A minimal, best-effort RTF-to-text stripper: drops control words,
    groups, and hex escapes, keeping ordinary text runs. Not a full RTF
    parser (destinations like \\fldinst are not specially excluded), but
    safe and dependency-free, and good enough for keyword-based structural
    classification rather than faithful reproduction."""
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise ExtractionError("rtf_read_failed") from error

    try:
        content = raw.decode("latin-1")
    except UnicodeDecodeError as error:
        raise ExtractionError("rtf_read_failed") from error

    content = _RTF_HEX_ESCAPE_RE.sub(" ", content)
    content = _RTF_CONTROL_WORD_RE.sub(" ", content)
    content = _RTF_GROUP_CHARS_RE.sub(" ", content)
    content = content.replace("\\", " ")
    text = " ".join(content.split())
    return text[:char_limit]


class _HTMLTextExtractor(_HTMLParser):
    """Stdlib html.parser-based text extractor - script/style content is
    dropped, every other text node is kept in document order."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._chunks: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data):
        if self._skip_depth == 0 and data.strip():
            self._chunks.append(data.strip())

    def get_text(self) -> str:
        return " ".join(self._chunks)


def extract_html_text(path: Path, char_limit: int) -> str:
    """Stdlib-only HTML text extraction, for a ".doc"-named file that is
    actually HTML (e.g. Word's own "Web Page, Filtered" export)."""
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise ExtractionError("html_read_failed") from error

    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError:
        content = raw.decode("latin-1", errors="replace")

    parser = _HTMLTextExtractor()
    try:
        parser.feed(content)
    except Exception as error:  # html.parser is lenient but not infallible
        raise ExtractionError("html_read_failed") from error

    return parser.get_text()[:char_limit]


def convert_doc_to_docx_via_libreoffice(
    source: Path, output_dir: Path, timeout: float = LIBREOFFICE_TIMEOUT_SECONDS
) -> Path:
    """Converts a legacy .doc file to .docx using local LibreOffice
    headless conversion. output_dir must be a fresh, unique, temporary
    directory outside the archive (see extract_doc_text) - this function
    never writes anywhere else, and never touches `source` itself."""
    binary = resolve_libreoffice_binary()
    if binary is None:
        raise ExtractionError("libreoffice_missing")

    profile_dir = output_dir / "profile"
    profile_dir.mkdir(parents=True, exist_ok=True)

    try:
        completed = subprocess.run(
            [
                binary,
                "--headless",
                "--invisible",
                "--nodefault",
                "--norestore",
                "--nolockcheck",
                "--nofirststartwizard",
                "--nologo",
                f"-env:UserInstallation=file://{profile_dir}",
                "--convert-to", "docx",
                "--outdir", str(output_dir),
                str(source),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as error:
        raise ExtractionError("libreoffice_timeout") from error
    except OSError as error:
        raise ExtractionError("libreoffice_process_failed") from error

    if completed.returncode != 0:
        raise ExtractionError(
            "libreoffice_process_failed", sanitized_diagnostic=_sanitize_process_diagnostic(completed)
        )

    # Detect the generated output by INSPECTING the temp directory rather
    # than assuming LibreOffice preserved the source's exact stem (it
    # normally does, but this never depends on that assumption holding for
    # every filename, including ones with spaces/Unicode characters).
    # Case-insensitive on the extension; the LibreOffice-owned "profile"
    # subdirectory is never considered a candidate output.
    candidates = sorted(
        p for p in output_dir.iterdir()
        if p.is_file() and p.suffix.lower() == ".docx"
    )
    if not candidates:
        raise ExtractionError(
            "libreoffice_output_missing", sanitized_diagnostic=_sanitize_process_diagnostic(completed)
        )
    converted_path = candidates[0]

    try:
        size = converted_path.stat().st_size
    except OSError as error:
        # Found by the directory scan a moment ago but no longer stat-able
        # (e.g. a permissions issue or a race with something else touching
        # the temp dir) - distinct from "nothing matched at all" above.
        raise ExtractionError("libreoffice_output_not_a_file") from error
    if size == 0:
        raise ExtractionError("libreoffice_output_zero_bytes")

    if not zipfile.is_zipfile(converted_path):
        raise ExtractionError("libreoffice_output_invalid_docx")
    try:
        with zipfile.ZipFile(converted_path) as archive:
            if "word/document.xml" not in archive.namelist():
                raise ExtractionError("libreoffice_output_invalid_docx")
    except zipfile.BadZipFile as error:
        raise ExtractionError("libreoffice_output_invalid_docx") from error

    return converted_path


_PATH_LIKE_RE = re.compile(r"(/[^\s]+)|([A-Za-z]:\\\S+)")


def _sanitize_process_diagnostic(completed: "subprocess.CompletedProcess") -> str:
    """A short, SANITIZED diagnostic string for local debugging only -
    return code plus stdout/stderr with anything path-like redacted, so a
    LibreOffice message that happens to echo the source/output path (a
    real, observed LibreOffice behavior) can never leak one. Never printed
    automatically by any caller in this module - callers may choose to
    log it locally, never to the archive or a remote service."""
    def redact(text: str) -> str:
        return _PATH_LIKE_RE.sub("[REDACTED_PATH]", text or "")[:500]

    return f"returncode={completed.returncode} stdout={redact(completed.stdout)} stderr={redact(completed.stderr)}"


def extract_doc_text(path: Path, counters: DiscoveryCounters, char_limit: int = EXTRACTION_CHAR_LIMIT) -> str:
    """Local legacy .DOC extraction (Task 2, hardened per the review-
    workflow .DOC pipeline repair): sniffs the actual file format first
    (see _sniff_source_format) since a ".doc"-named file is not always a
    genuine OLE2 binary. A confidently-detected RTF/HTML/DOCX-in-disguise
    file is routed to the matching local, dependency-free extractor
    instead of LibreOffice; a genuine (or inconclusive) OLE2 binary is
    checked for the standard encryption wrapper before ever invoking
    LibreOffice, then converted via LibreOffice headless in an isolated,
    unique-per-call temp directory, then read with the shared DOCX
    text-reading core. The temp directory (converted file + LibreOffice's
    own isolated profile) is always cleaned up, success or failure alike.

    doc_extraction_calls always increments (an attempt happened).
    doc_extraction_successes/doc_extraction_failures and the granular
    reason counters are tallied centrally by the caller
    (LocalContentInspector.inspect / tally_doc_extraction_failure) - the
    same pattern as PDF - so the invariant doc_extraction_calls ==
    successes + failures always holds in exactly one place."""
    counters.doc_extraction_calls += 1

    if not path.exists():
        raise ExtractionError("doc_path_missing")

    detected_format = _sniff_source_format(path)

    if detected_format == "RTF":
        text = extract_rtf_text(path, char_limit)
    elif detected_format == "HTML":
        text = extract_html_text(path, char_limit)
    elif detected_format == "ZIP":
        # Already a DOCX (or DOCX-compatible zip) wearing a .doc
        # extension - read it directly, no LibreOffice needed.
        text = _read_docx_text(path, char_limit)
    elif detected_format == "XML":
        # WordprocessingML 2003 XML or another bare-XML variant saved with
        # a .doc extension - not confidently a genuine OLE2 .doc, and no
        # safe dedicated extractor exists for this format yet. Recorded
        # precisely rather than guessed at or silently sent to LibreOffice.
        raise ExtractionError("source_format_mismatch")
    else:
        # "OLE2" (a genuine legacy .doc) or "UNKNOWN" (inconclusive, e.g.
        # a tiny/synthetic fixture) both fall through to the normal
        # LibreOffice path unchanged - detection here is deliberately
        # permissive, never a reason to reject a real .doc on a false
        # negative.
        if detected_format == "OLE2" and _ole2_has_encryption_marker(path):
            raise ExtractionError("encrypted_or_protected")

        with tempfile.TemporaryDirectory(prefix="cdc-doc-convert-") as tmp_dir:
            output_dir = Path(tmp_dir)
            converted = convert_doc_to_docx_via_libreoffice(path, output_dir)
            text = _read_docx_text(converted, char_limit)

    if not text.strip():
        raise ExtractionError("extracted_text_empty")

    return text


# Maps an ExtractionError.reason_code to the specific DiscoveryCounters
# attribute it should increment, for DOC extraction only - the same
# pattern as _PDF_FAILURE_REASON_COUNTERS. A reason with no dedicated
# counter here (e.g. a rare docx_read_failed/docx_xml_parse_failed from a
# corrupt LibreOffice conversion output, or one of the new format-sniffing/
# encryption/validation reasons added by the .DOC pipeline repair) still
# increments the generic doc_extraction_failures/failed_extractions
# tallies via tally_doc_extraction_failure, just no extra granular counter.
_DOC_FAILURE_REASON_COUNTERS: dict[str, Optional[str]] = {
    "doc_path_missing": "doc_path_missing",
    "libreoffice_missing": "libreoffice_missing",
    "libreoffice_process_failed": "libreoffice_process_failed",
    "libreoffice_timeout": "libreoffice_timeout",
    "libreoffice_output_missing": "libreoffice_output_missing",
}


def tally_doc_extraction_failure(counters: DiscoveryCounters, reason_code: str) -> None:
    """Centralizes DOC failure bookkeeping so the invariant
    doc_extraction_calls == doc_extraction_successes + doc_extraction_failures
    always holds: exactly one call site (LocalContentInspector.inspect)
    increments doc_extraction_failures, general failed_extractions, and
    the specific granular reason counter for a given ExtractionError."""
    counters.doc_extraction_failures += 1
    counters.failed_extractions += 1
    attr = _DOC_FAILURE_REASON_COUNTERS.get(reason_code)
    if attr is not None:
        setattr(counters, attr, getattr(counters, attr) + 1)


# =====================================================================
# Document evidence analysis - pure, deterministic, rule-based
# =====================================================================

# Short signal codes only - matched patterns are generic French/English
# procurement terminology, never stored or logged as raw matched text.
_CDC_SIGNAL_PATTERNS: tuple[tuple[str, "re.Pattern[str]"], ...] = (
    ("cahier_des_charges", re.compile(r"cahier\s+des\s+charges", re.IGNORECASE)),
    ("termes_de_reference", re.compile(r"termes?\s+de\s+r[ée]f[ée]rence", re.IGNORECASE)),
    ("dossier_appel_offres", re.compile(r"dossier\s+d.?appel\s+d.?offres?", re.IGNORECASE)),
    ("instructions_consultants", re.compile(r"instructions?\s+aux\s+consultants?", re.IGNORECASE)),
    ("donnees_particulieres", re.compile(r"donn[ée]es\s+particuli[èe]res", re.IGNORECASE)),
    ("prestations_demandees", re.compile(r"prestations?\s+demand[ée]es?", re.IGNORECASE)),
    (
        "criteres_consultation",
        re.compile(r"crit[èe]res?\s+(de\s+)?consultation|conditions?\s+de\s+consultation", re.IGNORECASE),
    ),
    ("mission", re.compile(r"\bmission\b", re.IGNORECASE)),
    ("request_for_proposal", re.compile(r"request\s+for\s+proposals?|\brfp\b", re.IGNORECASE)),
)

# Role signals, checked in priority order. Matching "CDC" specifically
# requires the literal "cahier des charges" phrase - a generic tender
# signal (e.g. "mission") is never enough on its own to assign role=CDC.
_ROLE_SIGNAL_PATTERNS: tuple[tuple[str, "re.Pattern[str]"], ...] = (
    ("CDC", re.compile(r"cahier\s+des\s+charges", re.IGNORECASE)),
    ("DCE", re.compile(r"\bdce\b|dossier\s+de\s+consultation", re.IGNORECASE)),
    ("DAO", re.compile(r"\bdao\b|dossier\s+d.?appel\s+d.?offres?", re.IGNORECASE)),
    ("TDR", re.compile(r"\btdr\b|termes?\s+de\s+r[ée]f[ée]rence", re.IGNORECASE)),
    ("RFP", re.compile(r"\brfp\b|request\s+for\s+proposals?", re.IGNORECASE)),
)


@dataclass(frozen=True)
class DocumentEvidence:
    matched_signal_codes: tuple[str, ...]
    role_hint: Optional[str]
    signal_count: int
    confidence: float


def analyze_document_evidence(text: str, char_limit: int = EXTRACTION_CHAR_LIMIT) -> DocumentEvidence:
    """Pure, deterministic, rule-based analysis over already length-limited
    text. Returns only short signal CODES, never matched text. A
    deliberately conservative confidence ladder: 3+ distinct signals
    required to approach the CONFIRMED_CDC threshold; 1-2 signals lands in
    LIKELY_CDC/NEEDS_REVIEW territory instead."""
    sample = text[:char_limit]
    matched = tuple(code for code, pattern in _CDC_SIGNAL_PATTERNS if pattern.search(sample))

    role_hint: Optional[str] = None
    for role, pattern in _ROLE_SIGNAL_PATTERNS:
        if pattern.search(sample):
            role_hint = role
            break
    if role_hint is not None:
        assert role_hint in DOCUMENT_ROLES

    signal_count = len(matched)
    if signal_count >= 3:
        confidence = 0.92
    elif signal_count == 2:
        confidence = 0.75
    elif signal_count == 1:
        confidence = 0.45
    else:
        confidence = 0.05

    return DocumentEvidence(
        matched_signal_codes=matched,
        role_hint=role_hint,
        signal_count=signal_count,
        confidence=confidence,
    )


def decide_content_verification(
    evidence: DocumentEvidence, threshold: float = CONFIRMED_CDC_CONFIDENCE_THRESHOLD
) -> tuple[bool, bool, str]:
    """Returns (verified_as_cdc, verified_not_cdc, reason_code).

    CONFIRMED_CDC requires role_hint == "CDC" SPECIFICALLY (the literal
    "cahier des charges" phrase was found) AND confidence >= threshold. A
    document whose content clearly signals DAO/TDR/DCE/RFP - however many
    tender-related signals it contains - is never auto-confirmed as CDC;
    it keeps its own role and falls through to the metadata-level status
    (Step 4: "DAO/TDR/DCE must never automatically equal CDC")."""
    if evidence.role_hint == "CDC" and evidence.confidence >= threshold:
        return True, False, "content_confirmed_cdc_role_and_signals"
    if evidence.signal_count == 0:
        return False, True, "no_tender_signals_found"
    return False, False, "insufficient_or_non_cdc_signals"


# =====================================================================
# Second-pass, human-style structural validation for --validate-single-confirmed
# (cdc_discovery.py's run_single_confirmed_validation). This is a SEPARATE,
# STRICTER, additional check applied ONLY to a document that has already
# passed decide_content_verification() above - it never runs instead of
# that check and never changes what decide_content_verification() itself
# decides. Operates on the SAME already-extracted text LocalContentInspector
# already has in scope - never re-opens a file. Returns and stores only
# short YES/NO/UNKNOWN strings; never matched text, never an excerpt.
# =====================================================================

# Below this sample length, absence of a signal is not meaningful (the
# excerpt may simply be too short to contain it) - every flag becomes
# UNKNOWN rather than a confident NO, which in turn forces
# decide_structural_validation() toward NEEDS_HUMAN_REVIEW rather than a
# guess in either direction.
MIN_TEXT_LENGTH_FOR_STRUCTURAL_ANALYSIS = 200

_YES = "YES"
_NO = "NO"
_UNKNOWN = "UNKNOWN"

_EXPLICIT_CDC_ROLE_PATTERN = re.compile(r"cahier\s+des\s+charges", re.IGNORECASE)

_STRUCTURAL_EVIDENCE_PATTERNS: dict[str, tuple["re.Pattern[str]", ...]] = {
    "scope_requirements": (
        re.compile(r"objet\s+de\s+la\s+mission", re.IGNORECASE),
        re.compile(r"[ée]tendue\s+des\s+prestations", re.IGNORECASE),
        re.compile(r"scope\s+of\s+(work|services)", re.IGNORECASE),
    ),
    "technical_requirements": (
        re.compile(r"sp[ée]cifications?\s+techniques?", re.IGNORECASE),
        re.compile(r"exigences?\s+techniques?", re.IGNORECASE),
        re.compile(r"technical\s+requirements?", re.IGNORECASE),
    ),
    "deliverables": (
        re.compile(r"livrables?", re.IGNORECASE),
        re.compile(r"\bdeliverables?\b", re.IGNORECASE),
    ),
    "bidder_obligations": (
        re.compile(r"obligations?\s+du\s+(soumissionnaire|consultant|prestataire)", re.IGNORECASE),
        re.compile(r"bidder.?s?\s+obligations?", re.IGNORECASE),
    ),
    "evaluation_requirements": (
        re.compile(r"crit[èe]res?\s+d.?[ée]valuation", re.IGNORECASE),
        re.compile(r"m[ée]thode\s+d.?[ée]valuation", re.IGNORECASE),
        re.compile(r"evaluation\s+criteria", re.IGNORECASE),
    ),
    "administrative_requirements": (
        re.compile(r"pi[èe]ces?\s+administratives?", re.IGNORECASE),
        re.compile(r"documents?\s+administratifs?", re.IGNORECASE),
        re.compile(r"administrative\s+requirements?", re.IGNORECASE),
    ),
}

_CONFLICTING_ROLE_PATTERNS: dict[str, tuple["re.Pattern[str]", ...]] = {
    "possible_dao": (
        re.compile(r"\bdao\b", re.IGNORECASE),
        re.compile(r"dossier\s+d.?appel\s+d.?offres?", re.IGNORECASE),
    ),
    "possible_tdr": (
        re.compile(r"\btdr\b", re.IGNORECASE),
        re.compile(r"termes?\s+de\s+r[ée]f[ée]rence", re.IGNORECASE),
    ),
    "possible_dce": (
        re.compile(r"\bdce\b", re.IGNORECASE),
        re.compile(r"dossier\s+de\s+consultation", re.IGNORECASE),
    ),
    "possible_rfp": (
        re.compile(r"\brfp\b", re.IGNORECASE),
        re.compile(r"request\s+for\s+proposals?", re.IGNORECASE),
    ),
    "possible_offer": (
        re.compile(r"offre\s+technique", re.IGNORECASE),
        re.compile(r"offre\s+financi[èe]re", re.IGNORECASE),
    ),
}

_STRUCTURAL_EVIDENCE_KEYS = tuple(_STRUCTURAL_EVIDENCE_PATTERNS.keys())
_CONFLICTING_ROLE_KEYS = tuple(_CONFLICTING_ROLE_PATTERNS.keys())


def build_structural_cdc_evidence(text: str) -> dict:
    """Task 5. Pure, deterministic, second-pass evidence flags computed
    over text already extracted for the primary rule engine - never
    re-reads a file. Returns a flat dict of "explicit_cdc_role" plus the
    six structural-requirement keys plus the five conflicting-role keys,
    each mapped to exactly "YES"/"NO"/"UNKNOWN". Never includes matched
    text, an excerpt, a filename, or a path."""
    sample = text.strip()
    all_keys = ("explicit_cdc_role", *_STRUCTURAL_EVIDENCE_KEYS, *_CONFLICTING_ROLE_KEYS)

    if len(sample) < MIN_TEXT_LENGTH_FOR_STRUCTURAL_ANALYSIS:
        return {key: _UNKNOWN for key in all_keys}

    result: dict = {"explicit_cdc_role": _YES if _EXPLICIT_CDC_ROLE_PATTERN.search(sample) else _NO}
    for key, patterns in _STRUCTURAL_EVIDENCE_PATTERNS.items():
        result[key] = _YES if any(pattern.search(sample) for pattern in patterns) else _NO
    for key, patterns in _CONFLICTING_ROLE_PATTERNS.items():
        result[key] = _YES if any(pattern.search(sample) for pattern in patterns) else _NO
    return result


def decide_structural_validation(evidence: dict) -> str:
    """Task 6. Conservative final decision - VALIDATED_CDC / REJECTED_NOT_CDC
    / NEEDS_HUMAN_REVIEW. Never weakens or replaces the primary
    decide_content_verification() threshold; this only ever runs on a
    document that has already passed it, as an additional, stricter,
    independent safety check.

    VALIDATED_CDC requires: explicit_cdc_role YES, at least 3 of the 6
    structural-requirement flags YES, and ZERO conflicting-role flags YES.
    REJECTED_NOT_CDC requires: explicit_cdc_role NO, at least one
    conflicting-role flag YES, and ZERO structural-requirement flags YES
    (a genuinely clear alternate-role document with no CDC-shaped content
    at all). Anything else - including "has cahier des charges language
    AND a conflicting role" (mixed/ambiguous signals) or too little
    extracted text to be confident either way - is NEEDS_HUMAN_REVIEW."""
    if evidence.get("explicit_cdc_role") == _UNKNOWN:
        return "NEEDS_HUMAN_REVIEW"

    structural_unknown = sum(1 for key in _STRUCTURAL_EVIDENCE_KEYS if evidence.get(key) == _UNKNOWN)
    if structural_unknown >= 3:
        return "NEEDS_HUMAN_REVIEW"

    structural_yes = sum(1 for key in _STRUCTURAL_EVIDENCE_KEYS if evidence.get(key) == _YES)
    any_conflicting_yes = any(evidence.get(key) == _YES for key in _CONFLICTING_ROLE_KEYS)

    if evidence.get("explicit_cdc_role") == _YES and structural_yes >= 3 and not any_conflicting_yes:
        return "VALIDATED_CDC"

    if evidence.get("explicit_cdc_role") == _NO and any_conflicting_yes and structural_yes == 0:
        return "REJECTED_NOT_CDC"

    return "NEEDS_HUMAN_REVIEW"


# =====================================================================
# Aggregate classification reason counters (Task 5) - WHY a successfully
# extracted document ended up with the role/status it did, as pure
# counts. Never a filename, path, or matched text - only short, stable
# reason codes/counter names.
# =====================================================================

_CONTENT_ROLE_COUNTER_ATTR: dict[Optional[str], str] = {
    "CDC": "content_role_cdc",
    "DAO": "content_role_dao",
    "TDR": "content_role_tdr",
    "DCE": "content_role_dce",
    "RFP": "content_role_rfp",
    None: "content_role_unknown",
}

_TENDER_RELATED_NON_CDC_ROLES = ("DAO", "TDR", "DCE", "RFP")


def tally_classification_reasons(
    counters: DiscoveryCounters,
    evidence: DocumentEvidence,
    verified_as_cdc: bool,
    verified_not_cdc: bool,
) -> None:
    """Called once per successfully-extracted-and-analyzed document (never
    for extraction failures - see tally_content_extraction_failure for
    that). Tallies three independent, purely aggregate views:
      1. content_role_* - the CONTENT-derived role signal, if any.
      2. evidence_strong/medium/weak - how many distinct tender-related
         signal phrases were found (derived from the same signal_count
         analyze_document_evidence already computed for its confidence
         ladder - 0-1 signals is "weak", 2 is "medium", 3+ is "strong").
      3. content_confirmed_cdc/content_not_cdc/content_ambiguous/
         content_insufficient_signals - the FINAL verification outcome
         (post local-AI combination, if that stage ran) for this file.
    """
    role_attr = _CONTENT_ROLE_COUNTER_ATTR.get(evidence.role_hint, "content_role_unknown")
    setattr(counters, role_attr, getattr(counters, role_attr) + 1)

    if evidence.signal_count >= 3:
        counters.evidence_strong += 1
    elif evidence.signal_count == 2:
        counters.evidence_medium += 1
    else:
        counters.evidence_weak += 1

    if verified_as_cdc:
        counters.content_confirmed_cdc += 1
    elif verified_not_cdc:
        counters.content_not_cdc += 1
    elif evidence.role_hint in _TENDER_RELATED_NON_CDC_ROLES:
        # Clearly tender-related content, but not confirmed as CDC
        # specifically - genuinely ambiguous rather than "no signal at all".
        counters.content_ambiguous += 1
    else:
        counters.content_insufficient_signals += 1


def tally_content_extraction_failure_reason(counters: DiscoveryCounters) -> None:
    """The classification-reason counterpart to a failed extraction
    (Task 5's content_extraction_failed) - kept separate from
    tally_classification_reasons because a failed extraction never
    produces a DocumentEvidence to characterize."""
    counters.content_extraction_failed += 1


# =====================================================================
# Optional local AI second stage (Step 5) - Ollama only, fail-closed
# =====================================================================

_SYSTEM_PROMPT = (
    "You are a strict document classifier. You are given a short excerpt of a "
    "tender-related document. Respond with ONLY a single JSON object matching "
    'exactly this shape: {"role": "<CDC|DAO|TDR|DCE|RFP|INVITATION|ANNEX|'
    'OTHER_TENDER_DOCUMENT|UNKNOWN>", "is_cdc": <true|false>, "confidence": '
    '<number 0.0-1.0>, "reason_code": "<short_snake_case_code>"}. '
    "role=CDC only if the document explicitly presents itself as a cahier des "
    "charges / terms of reference document, not merely tender-related. Never "
    "include any text outside the JSON object. Never quote or reproduce the "
    "input text in your response."
)


@dataclass(frozen=True)
class AiClassificationResult:
    role: Optional[str]
    is_cdc: bool
    confidence: float
    reason_code: str


class AiAdapter(Protocol):
    def classify(self, text_sample: str, counters: DiscoveryCounters) -> Optional[AiClassificationResult]:
        """Returns None on ANY failure - timeout, connection error,
        malformed JSON, schema violation. Must never raise. Fail closed."""
        ...


def assert_loopback_url(raw_url: str) -> None:
    """Mirrors the loopback-enforcement convention already established in
    lib/appels-offres/fci/local-benchmark.ts (requestLocalFci) and
    rex-project-rag.ts (assertLoopbackUrl) - refuses anything but a local
    Ollama endpoint. Raises immediately (at adapter construction time),
    never silently falls back to a remote host."""
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost"):
        raise ValueError(f"Local AI adapter must use a loopback http URL; got {parsed.hostname!r}")


_AI_RESPONSE_REQUIRED_KEYS = {"role", "is_cdc", "confidence", "reason_code"}


def validate_ai_response(payload: object) -> Optional[AiClassificationResult]:
    """Strict schema validation (Step 5). Returns None - never raises - on
    any violation, which is what makes the AI stage fail closed."""
    if not isinstance(payload, dict):
        return None
    if not _AI_RESPONSE_REQUIRED_KEYS.issubset(payload.keys()):
        return None

    role = payload.get("role")
    if role is not None and role not in DOCUMENT_ROLES:
        return None

    is_cdc = payload.get("is_cdc")
    if not isinstance(is_cdc, bool):
        return None

    confidence = payload.get("confidence")
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        return None
    if not (0.0 <= float(confidence) <= 1.0):
        return None

    reason_code = payload.get("reason_code")
    if not isinstance(reason_code, str) or not reason_code or len(reason_code) > 64:
        return None

    return AiClassificationResult(role=role, is_cdc=is_cdc, confidence=float(confidence), reason_code=reason_code)


class OllamaAiAdapter:
    """Real local-AI adapter. Ollama only, loopback-enforced at
    construction, strict-JSON output requested, low temperature, timeout,
    and full schema validation on the way back out. Any failure at any
    step returns None (fail closed) rather than raising or guessing."""

    def __init__(self, url: str = OLLAMA_URL, model: str = OLLAMA_MODEL, timeout: float = OLLAMA_TIMEOUT_SECONDS):
        assert_loopback_url(url)
        self._url = url
        self._model = model
        self._timeout = timeout

    def classify(self, text_sample: str, counters: DiscoveryCounters) -> Optional[AiClassificationResult]:
        counters.local_ai_calls += 1
        request_body = json.dumps(
            {
                "model": self._model,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": text_sample},
                ],
                "stream": False,
                "format": "json",
                "options": {"temperature": 0},
            }
        ).encode("utf-8")

        request = urllib.request.Request(
            self._url, data=request_body, headers={"Content-Type": "application/json"}, method="POST"
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                raw = response.read()
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            return None

        try:
            outer = json.loads(raw)
            content = outer["message"]["content"]
            payload = json.loads(content)
        except (json.JSONDecodeError, KeyError, TypeError):
            return None

        return validate_ai_response(payload)


def combine_rule_and_ai_verification(
    rule_verified_as_cdc: bool,
    rule_verified_not_cdc: bool,
    rule_reason_code: str,
    ai_result: Optional[AiClassificationResult],
    threshold: float = CONFIRMED_CDC_CONFIDENCE_THRESHOLD,
) -> tuple[bool, bool, str]:
    """Conservative combination (Step 6): the AI stage can only ever ADD
    friction, never bypass the rule-based gate on its own. If the AI stage
    failed (ai_result is None - timeout/malformed/schema violation), the
    rule-only result stands unchanged. If AI disagrees with a rule-based
    CONFIRMED_CDC, the result is downgraded to NEEDS_REVIEW rather than
    trusting either side alone."""
    if ai_result is None:
        return rule_verified_as_cdc, rule_verified_not_cdc, rule_reason_code

    if rule_verified_as_cdc:
        if ai_result.is_cdc and ai_result.role == "CDC" and ai_result.confidence >= threshold:
            return True, False, "content_confirmed_rule_and_ai_agree"
        return False, False, "rule_ai_disagreement_needs_review"

    return rule_verified_as_cdc, rule_verified_not_cdc, rule_reason_code


# =====================================================================
# LocalContentInspector - the real ContentInspector implementation
#
# File-path resolution (source_root_path + relative_path -> an absolute
# Path) is the orchestrator's responsibility - see
# resolve_archive_file_path() in scripts/cdc_discovery.py - not this
# module's. LocalContentInspector always receives an already-resolved
# file_path (or None).
# =====================================================================


class LocalContentInspector:
    """The real ContentInspector implementation (satisfies the Protocol
    defined in cdc_discovery.py). Extraction format is chosen from the
    file extension; the AI stage is entirely optional (ai_adapter=None by
    default) per Step 5's "keep it as an optional second-stage adapter"."""

    def __init__(
        self,
        char_limit: int = EXTRACTION_CHAR_LIMIT,
        pdf_converter: DoclingConverter = default_docling_converter,
        ai_adapter: Optional[AiAdapter] = None,
        confirmed_confidence_threshold: float = CONFIRMED_CDC_CONFIDENCE_THRESHOLD,
    ) -> None:
        self._char_limit = char_limit
        self._pdf_converter = pdf_converter
        self._ai_adapter = ai_adapter
        self._threshold = confirmed_confidence_threshold

    def inspect(
        self,
        archive_file_id: int,
        extension: Optional[str],
        counters: DiscoveryCounters,
        file_path: Optional[Path] = None,
    ) -> ContentInspectionOutcome:
        if file_path is None:
            return ContentInspectionOutcome(
                attempted=True, failed=True, needs_human_review=True, reason_code="no_file_path_available"
            )

        normalized_extension = (extension or "").strip().lower()
        try:
            if normalized_extension == "pdf":
                text = extract_pdf_text(file_path, counters, self._char_limit, self._pdf_converter)
                extraction_method = "pdf_text"
            elif normalized_extension == "docx":
                text = extract_docx_text(file_path, counters, self._char_limit)
                extraction_method = "docx_text"
            elif normalized_extension == "doc":
                text = extract_doc_text(file_path, counters, self._char_limit)
                extraction_method = "doc_text"
            else:
                return ContentInspectionOutcome(
                    attempted=True, needs_human_review=True, reason_code="unsupported_extraction_format"
                )
        except ExtractionError as error:
            # PDF/DOC failure bookkeeping (pdf_extraction_failures/
            # doc_extraction_failures + the granular reason counter +
            # failed_extractions) is centralized in
            # tally_pdf_extraction_failure/tally_doc_extraction_failure so
            # the *_extraction_calls == successes + failures invariant
            # always holds in exactly one place. DOCX failures use the
            # plain failed_extractions tally - they have no granular
            # reason breakdown of their own.
            if normalized_extension == "pdf":
                tally_pdf_extraction_failure(counters, error.reason_code)
            elif normalized_extension == "doc":
                tally_doc_extraction_failure(counters, error.reason_code)
            else:
                counters.failed_extractions += 1
            tally_content_extraction_failure_reason(counters)
            return ContentInspectionOutcome(
                attempted=True,
                failed=True,
                needs_human_review=True,
                reason_code=error.reason_code,
            )

        if normalized_extension == "pdf":
            counters.pdf_extraction_successes += 1
        elif normalized_extension == "doc":
            counters.doc_extraction_successes += 1
        counters.files_content_inspected += 1

        evidence = analyze_document_evidence(text, self._char_limit)
        verified_as_cdc, verified_not_cdc, reason_code = decide_content_verification(evidence, self._threshold)

        ai_result: Optional[AiClassificationResult] = None
        if self._ai_adapter is not None:
            ai_result = self._ai_adapter.classify(text[: self._char_limit], counters)
            verified_as_cdc, verified_not_cdc, reason_code = combine_rule_and_ai_verification(
                verified_as_cdc, verified_not_cdc, reason_code, ai_result, self._threshold
            )

        tally_classification_reasons(counters, evidence, verified_as_cdc, verified_not_cdc)

        confidence = evidence.confidence
        if ai_result is not None and verified_as_cdc:
            confidence = max(evidence.confidence, ai_result.confidence)

        # Second-pass structural evidence (Task 5/6) is computed only for a
        # document that has already been confirmed by the primary rule -
        # never used to promote/demote verified_as_cdc/verified_not_cdc
        # themselves, and never persisted (see CdcCandidate.structural_validation).
        structural_validation: Optional[dict] = None
        if verified_as_cdc:
            structural_evidence = build_structural_cdc_evidence(text)
            structural_validation = dict(structural_evidence)
            structural_validation["validation_result"] = decide_structural_validation(structural_evidence)

        # Full-corpus technical-source taxonomy (Phase 5) - computed for
        # every successfully-extracted document, independent of the
        # narrower CDC-only verified_as_cdc/verified_not_cdc outcome above.
        # Never used to change verified_as_cdc/verified_not_cdc themselves.
        technical_source_result = classify_technical_source(text)
        technical_source_classification = {
            "detected_role": technical_source_result.detected_role,
            "technical_source_candidate": technical_source_result.technical_source_candidate,
            "structural_score": technical_source_result.structural_score,
            "structural_max": technical_source_result.structural_max,
            "structural_ratio": technical_source_result.structural_ratio,
            "structural_band": technical_source_result.structural_band,
            "review_priority": technical_source_result.review_priority,
            **technical_source_result.section_flags,
        }

        return ContentInspectionOutcome(
            attempted=True,
            extraction_method=extraction_method,
            verified_as_cdc=verified_as_cdc,
            verified_not_cdc=verified_not_cdc,
            document_role=evidence.role_hint,
            confidence=confidence,
            reason_code=reason_code,
            failed=False,
            needs_human_review=not verified_as_cdc and not verified_not_cdc,
            structural_validation=structural_validation,
            technical_source_classification=technical_source_classification,
        )
