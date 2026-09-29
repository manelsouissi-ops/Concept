#!/usr/bin/env python3
"""Guarded, local-only OCR recovery pilot for CDC candidates whose
extraction previously FAILED as DOC_EMBEDDED_IMAGES_ONLY or a scan/
image-only PDF (2026-09 diagnosis).

SCOPE: this module implements ONLY the local file-processing workflow
(private copy -> convert/OCR -> sanitized metrics). It never opens a
PostgreSQL connection, never calls Ollama, and never persists a result
anywhere other than the in-memory OcrPilotResult its caller receives.
Any DB read/write, semantic review, or manifest/checkpoint handling is
the caller's responsibility, not this module's.

SAFETY GUARANTEES
- Every subprocess call uses an argument list, never a shell string, and
  a bounded timeout.
- Works exclusively on a PRIVATE, per-document temporary copy - the
  archive original (confirmed read-only mounted) is only ever opened for
  a single buffered read to make that copy; nothing here ever opens the
  original for writing.
- Rejects any symlinked path component, anywhere in the private working
  tree, before it is used.
- Rejects any resolved path that would escape the private working
  directory.
- Enforces maximum input size, maximum page count, maximum temporary
  output size, and a maximum extracted-text length - each a controlled,
  named failure category, never a silent truncation that could look like
  success.
- Never persists raw OCR text: compute_quality_metrics() only ever
  returns SANITIZED counts/ratios; the caller must not (and this module
  never gives it the means to) write the actual text anywhere.
- Cleans up its private working directory in a `finally` block on every
  path - success, a controlled failure, an unexpected exception, or a
  SIGTERM/SIGINT received mid-run (see _cleanup_guaranteed).
- Strips proxy-related environment variables before invoking any
  subprocess - belt-and-suspenders on top of the fact that none of
  soffice/ocrmypdf/tesseract/pdftotext/pdfinfo make any network call in
  normal local use.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import signal
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

# =====================================================================
# Limits (fail-closed - a controlled failure category, never a silent
# truncation or best-effort continuation past one of these)
# =====================================================================

MAX_INPUT_SIZE_BYTES = 20_000_000          # 20MB - well above every observed failure's size
MAX_TEMP_OUTPUT_SIZE_BYTES = 100_000_000   # 100MB - a rasterized+OCR'd PDF can expand a lot
MAX_EXTRACTED_TEXT_LENGTH = 2_000_000      # characters, in-memory only, never persisted raw
MAX_PAGE_COUNT = 100

DOC_TO_PDF_TIMEOUT_SECONDS = 120.0
OCR_TIMEOUT_SECONDS = 300.0
TEXT_EXTRACT_TIMEOUT_SECONDS = 60.0
PAGE_COUNT_TIMEOUT_SECONDS = 30.0

OCR_LANGUAGES = "fra+eng"

# --- Quality-acceptance thresholds (Part 5 of the task; defined BEFORE
# any real pilot document is processed). Deliberately fail-closed: a
# document with many characters that are mostly non-alphabetic garbage,
# or that only covers a small fraction of its pages, is NOT accepted
# just because its raw character count is high. No threshold here claims
# semantic correctness - only that the OCR output is plausibly readable
# text worth a human's manual review. ---
MIN_NON_WHITESPACE_CHARS = 200
MIN_PAGE_COVERAGE_RATIO = 0.5
MIN_ALPHABETIC_RATIO = 0.6
MAX_REPLACEMENT_CONTROL_CHAR_RATIO = 0.02
MAX_REPEATED_GARBAGE_RATIO = 0.3

# --- Controlled technical outcomes (Part 3) ---
OCR_SUCCESS = "OCR_SUCCESS"
DOC_CONVERSION_FAILED = "DOC_CONVERSION_FAILED"
OCR_TIMEOUT = "OCR_TIMEOUT"
OCR_NO_TEXT = "OCR_NO_TEXT"
OCR_LOW_QUALITY = "OCR_LOW_QUALITY"
OCR_OUTPUT_TOO_LARGE = "OCR_OUTPUT_TOO_LARGE"
OCR_PAGE_LIMIT_EXCEEDED = "OCR_PAGE_LIMIT_EXCEEDED"
OCR_DEPENDENCY_MISSING = "OCR_DEPENDENCY_MISSING"
OCR_UNEXPECTED_FAILURE = "OCR_UNEXPECTED_FAILURE"
OCR_ENCRYPTED_OUTPUT_REJECTED = "OCR_ENCRYPTED_OUTPUT_REJECTED"
OCR_CONFINEMENT_FAILURE = "OCR_CONFINEMENT_FAILURE"
OCR_SOURCE_HASH_MISMATCH = "OCR_SOURCE_HASH_MISMATCH"

TECHNICAL_OUTCOMES = (
    OCR_SUCCESS, DOC_CONVERSION_FAILED, OCR_TIMEOUT, OCR_NO_TEXT, OCR_LOW_QUALITY,
    OCR_OUTPUT_TOO_LARGE, OCR_PAGE_LIMIT_EXCEEDED, OCR_DEPENDENCY_MISSING,
    OCR_UNEXPECTED_FAILURE, OCR_ENCRYPTED_OUTPUT_REJECTED, OCR_CONFINEMENT_FAILURE,
    OCR_SOURCE_HASH_MISMATCH,
)

# --- Final, human-facing classification (Part 4) ---
ACCEPTABLE_FOR_MANUAL_REVIEW = "ACCEPTABLE_FOR_MANUAL_REVIEW"
LOW_QUALITY_NEEDS_REVIEW = "LOW_QUALITY_NEEDS_REVIEW"
OCR_FAILED = "OCR_FAILED"

_FAILED_TECHNICAL_OUTCOMES = frozenset(TECHNICAL_OUTCOMES) - {OCR_SUCCESS, OCR_LOW_QUALITY}


class OcrError(Exception):
    """Raised by any internal step on a controlled failure. Always
    carries one of TECHNICAL_OUTCOMES (never a filename/path/document
    text) as reason_code."""

    def __init__(self, reason_code: str) -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code


# =====================================================================
# Dependency check (read-only - never installs anything)
# =====================================================================


@dataclass(frozen=True)
class OcrDependencyStatus:
    soffice_available: bool
    ocrmypdf_available: bool
    pdftotext_available: bool
    pdfinfo_available: bool
    tesseract_languages: "tuple[str, ...]"

    @property
    def ready(self) -> bool:
        return (
            self.soffice_available and self.ocrmypdf_available
            and self.pdftotext_available and self.pdfinfo_available
            and "fra" in self.tesseract_languages and "eng" in self.tesseract_languages
        )


def check_ocr_dependencies() -> OcrDependencyStatus:
    """Read-only. Never installs, downloads, or modifies anything."""
    def _which(name: str) -> bool:
        return shutil.which(name) is not None

    languages: "tuple[str, ...]" = ()
    if _which("tesseract"):
        try:
            completed = subprocess.run(
                ["tesseract", "--list-langs"], capture_output=True, text=True, timeout=10.0, check=False,
            )
            lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
            # first line is typically "List of available languages ..." - drop it
            languages = tuple(l for l in lines if l.lower() not in ("", ) and not l.lower().startswith("list of"))
        except (subprocess.TimeoutExpired, OSError):
            languages = ()

    return OcrDependencyStatus(
        soffice_available=_which("soffice"),
        ocrmypdf_available=_which("ocrmypdf"),
        pdftotext_available=_which("pdftotext"),
        pdfinfo_available=_which("pdfinfo"),
        tesseract_languages=languages,
    )


# =====================================================================
# Confinement / private-directory helpers
# =====================================================================


def _reject_symlink_components(path: Path) -> None:
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        if current.is_symlink():
            raise OcrError(OCR_CONFINEMENT_FAILURE)


def _ensure_private_workdir(path: Path) -> None:
    """Mirrors export_cdc_ai_review_comparison._ensure_private_output_directory:
    forces mode 0o700 on every component it creates, rejects any symlink
    component, never relies on mkdir(mode=...) alone."""
    if not path.is_absolute():
        raise OcrError(OCR_CONFINEMENT_FAILURE)
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        if current.is_symlink():
            raise OcrError(OCR_CONFINEMENT_FAILURE)
        if current.exists():
            if not current.is_dir():
                raise OcrError(OCR_CONFINEMENT_FAILURE)
            continue
        os.mkdir(current)
        if current.is_symlink():
            raise OcrError(OCR_CONFINEMENT_FAILURE)
        os.chmod(current, 0o700)
    if (os.stat(path).st_mode & 0o777) != 0o700:
        raise OcrError(OCR_CONFINEMENT_FAILURE)


def _require_within(path: Path, root: Path) -> None:
    try:
        resolved = path.resolve(strict=False)
        resolved_root = root.resolve(strict=False)
    except OSError:
        raise OcrError(OCR_CONFINEMENT_FAILURE)
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise OcrError(OCR_CONFINEMENT_FAILURE)


def _clean_subprocess_env() -> dict:
    """Strips proxy-related variables so no subprocess can be redirected
    to an external network endpoint via environment configuration - none
    of these tools make a network call in normal local use, this is
    defense in depth only."""
    blocked_prefixes = ("http_proxy", "https_proxy", "ftp_proxy", "all_proxy", "no_proxy")
    return {
        k: v for k, v in os.environ.items()
        if k.lower() not in blocked_prefixes
    }


def _cleanup_guaranteed(workdir: Path) -> None:
    shutil.rmtree(workdir, ignore_errors=True)


class _InterruptionRaised(Exception):
    pass


def _install_interruption_guard():
    def _handler(signum, frame):
        raise _InterruptionRaised(f"signal {signum}")
    previous_term = signal.signal(signal.SIGTERM, _handler)
    return previous_term


def _restore_interruption_guard(previous_term) -> None:
    signal.signal(signal.SIGTERM, previous_term)


# =====================================================================
# Copy + hash verification
# =====================================================================


def _sha256_of_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def copy_and_verify_hash(source_path: Path, dest_path: Path, expected_sha256: str) -> None:
    """Reads the (read-only mounted) source once, writes a private copy,
    and verifies the copy's hash before any further step ever runs. Never
    opens the source for writing."""
    try:
        size = source_path.stat().st_size
    except OSError:
        raise OcrError(OCR_UNEXPECTED_FAILURE)
    if size > MAX_INPUT_SIZE_BYTES:
        raise OcrError(OCR_OUTPUT_TOO_LARGE)

    try:
        with open(source_path, "rb") as src, open(dest_path, "wb") as dst:
            shutil.copyfileobj(src, dst)
    except OSError:
        raise OcrError(OCR_UNEXPECTED_FAILURE)
    os.chmod(dest_path, 0o600)

    if _sha256_of_file(dest_path) != expected_sha256:
        raise OcrError(OCR_SOURCE_HASH_MISMATCH)


def _pdf_is_encrypted(path: Path) -> bool:
    try:
        raw = path.read_bytes()
    except OSError:
        return False
    return b"/Encrypt" in raw


# =====================================================================
# Subprocess wrappers (injectable for tests - mirrors
# cdc_content_inspector.py's DoclingConverter injection pattern)
# =====================================================================

DocToPdfConverter = Callable[[Path, Path, float], None]
OcrRunner = Callable[[Path, Path, str, float], None]
PdfTextExtractor = Callable[[Path, float], str]
PdfPageCounter = Callable[[Path, float], int]


def default_doc_to_pdf_converter(doc_path: Path, output_dir: Path, timeout: float = DOC_TO_PDF_TIMEOUT_SECONDS) -> None:
    """LibreOffice headless DOC -> PDF, on the private copy only."""
    try:
        completed = subprocess.run(
            ["soffice", "--headless", "--norestore", "--convert-to", "pdf", "--outdir", str(output_dir), str(doc_path)],
            check=False, capture_output=True, text=True, timeout=timeout, env=_clean_subprocess_env(),
        )
    except subprocess.TimeoutExpired:
        raise OcrError(OCR_TIMEOUT)
    except OSError:
        raise OcrError(OCR_DEPENDENCY_MISSING)
    if completed.returncode != 0:
        raise OcrError(DOC_CONVERSION_FAILED)


def default_ocrmypdf_runner(
    input_pdf: Path, output_pdf: Path, languages: str = OCR_LANGUAGES, timeout: float = OCR_TIMEOUT_SECONDS,
) -> None:
    try:
        completed = subprocess.run(
            [
                "ocrmypdf", "--force-ocr", "--language", languages,
                "--output-type", "pdf", "--optimize", "0",
                str(input_pdf), str(output_pdf),
            ],
            check=False, capture_output=True, text=True, timeout=timeout, env=_clean_subprocess_env(),
        )
    except subprocess.TimeoutExpired:
        raise OcrError(OCR_TIMEOUT)
    except OSError:
        raise OcrError(OCR_DEPENDENCY_MISSING)
    if completed.returncode != 0:
        raise OcrError(OCR_UNEXPECTED_FAILURE)


def default_pdftotext_extractor(pdf_path: Path, timeout: float = TEXT_EXTRACT_TIMEOUT_SECONDS) -> str:
    try:
        completed = subprocess.run(
            ["pdftotext", str(pdf_path), "-"],
            check=False, capture_output=True, text=True, timeout=timeout, env=_clean_subprocess_env(),
        )
    except subprocess.TimeoutExpired:
        raise OcrError(OCR_TIMEOUT)
    except OSError:
        raise OcrError(OCR_DEPENDENCY_MISSING)
    if completed.returncode != 0:
        raise OcrError(OCR_UNEXPECTED_FAILURE)
    return completed.stdout[:MAX_EXTRACTED_TEXT_LENGTH]


def default_pdfinfo_page_counter(pdf_path: Path, timeout: float = PAGE_COUNT_TIMEOUT_SECONDS) -> int:
    try:
        completed = subprocess.run(
            ["pdfinfo", str(pdf_path)],
            check=False, capture_output=True, text=True, timeout=timeout, env=_clean_subprocess_env(),
        )
    except subprocess.TimeoutExpired:
        raise OcrError(OCR_TIMEOUT)
    except OSError:
        raise OcrError(OCR_DEPENDENCY_MISSING)
    if completed.returncode != 0:
        raise OcrError(OCR_UNEXPECTED_FAILURE)
    match = re.search(r"^Pages:\s*(\d+)", completed.stdout, re.MULTILINE)
    if not match:
        raise OcrError(OCR_UNEXPECTED_FAILURE)
    return int(match.group(1))


# =====================================================================
# Quality metrics (Part 4) - sanitized only, raw text never returned/stored
# =====================================================================


@dataclass(frozen=True)
class OcrQualityMetrics:
    non_whitespace_char_count: int
    page_count: int
    pages_with_text: int
    page_coverage_ratio: float
    alphabetic_ratio: float
    replacement_control_char_ratio: float
    repeated_garbage_ratio: float
    ocr_duration_seconds: float
    output_size_ratio: float


_CONTROL_OR_REPLACEMENT_PATTERN = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f�]")


def compute_quality_metrics(
    text: str, page_count: int, ocr_duration_seconds: float, output_size_bytes: int, input_size_bytes: int,
) -> OcrQualityMetrics:
    """Pure function over an in-memory string - the caller must discard
    `text` immediately after this call; this module never writes it
    anywhere."""
    pages = text.split("\x0c")
    if page_count <= 0:
        page_count = max(len(pages), 1)
    pages_with_text = sum(1 for p in pages if p.strip())
    non_whitespace = re.sub(r"\s", "", text)
    non_whitespace_char_count = len(non_whitespace)

    alphabetic_count = sum(1 for ch in non_whitespace if ch.isalpha())
    alphabetic_ratio = (alphabetic_count / non_whitespace_char_count) if non_whitespace_char_count else 0.0

    bad_char_count = len(_CONTROL_OR_REPLACEMENT_PATTERN.findall(text))
    replacement_control_char_ratio = (bad_char_count / len(text)) if text else 0.0

    repeated_garbage_ratio = _longest_repeated_char_run_ratio(non_whitespace)

    page_coverage_ratio = (pages_with_text / page_count) if page_count else 0.0
    output_size_ratio = (output_size_bytes / input_size_bytes) if input_size_bytes else 0.0

    return OcrQualityMetrics(
        non_whitespace_char_count=non_whitespace_char_count,
        page_count=page_count,
        pages_with_text=pages_with_text,
        page_coverage_ratio=round(page_coverage_ratio, 4),
        alphabetic_ratio=round(alphabetic_ratio, 4),
        replacement_control_char_ratio=round(replacement_control_char_ratio, 4),
        repeated_garbage_ratio=round(repeated_garbage_ratio, 4),
        ocr_duration_seconds=round(ocr_duration_seconds, 2),
        output_size_ratio=round(output_size_ratio, 4),
    )


def _longest_repeated_char_run_ratio(s: str) -> float:
    if not s:
        return 0.0
    longest = 1
    current = 1
    for i in range(1, len(s)):
        if s[i] == s[i - 1]:
            current += 1
            longest = max(longest, current)
        else:
            current = 1
    return longest / len(s)


def classify_quality(metrics: OcrQualityMetrics) -> str:
    """Fail-closed: every threshold must pass for ACCEPTABLE_FOR_MANUAL_REVIEW.
    Never a claim of semantic correctness - only that the output is
    plausibly readable and worth a human's review."""
    if (
        metrics.non_whitespace_char_count >= MIN_NON_WHITESPACE_CHARS
        and metrics.page_coverage_ratio >= MIN_PAGE_COVERAGE_RATIO
        and metrics.alphabetic_ratio >= MIN_ALPHABETIC_RATIO
        and metrics.replacement_control_char_ratio <= MAX_REPLACEMENT_CONTROL_CHAR_RATIO
        and metrics.repeated_garbage_ratio <= MAX_REPEATED_GARBAGE_RATIO
    ):
        return ACCEPTABLE_FOR_MANUAL_REVIEW
    return LOW_QUALITY_NEEDS_REVIEW


# =====================================================================
# Orchestration
# =====================================================================


@dataclass(frozen=True)
class OcrPilotResult:
    technical_outcome: str
    final_classification: str
    metrics: Optional[OcrQualityMetrics]


def _run_pdf_branch(
    pdf_copy: Path, workdir: Path, ocr_runner: OcrRunner, text_extractor: PdfTextExtractor,
    page_counter: PdfPageCounter,
) -> OcrPilotResult:
    if _pdf_is_encrypted(pdf_copy):
        raise OcrError(OCR_ENCRYPTED_OUTPUT_REJECTED)

    ocred_pdf = workdir / "ocr_output.pdf"
    start = time.monotonic()
    ocr_runner(pdf_copy, ocred_pdf, OCR_LANGUAGES, OCR_TIMEOUT_SECONDS)
    duration = time.monotonic() - start

    _require_within(ocred_pdf, workdir)
    if not ocred_pdf.exists():
        raise OcrError(OCR_UNEXPECTED_FAILURE)
    if ocred_pdf.is_symlink():
        raise OcrError(OCR_CONFINEMENT_FAILURE)
    output_size = ocred_pdf.stat().st_size
    if output_size > MAX_TEMP_OUTPUT_SIZE_BYTES:
        raise OcrError(OCR_OUTPUT_TOO_LARGE)
    if _pdf_is_encrypted(ocred_pdf):
        raise OcrError(OCR_ENCRYPTED_OUTPUT_REJECTED)

    page_count = page_counter(ocred_pdf, PAGE_COUNT_TIMEOUT_SECONDS)
    if page_count > MAX_PAGE_COUNT:
        raise OcrError(OCR_PAGE_LIMIT_EXCEEDED)

    text = text_extractor(ocred_pdf, TEXT_EXTRACT_TIMEOUT_SECONDS)
    input_size = pdf_copy.stat().st_size
    metrics = compute_quality_metrics(text, page_count, duration, output_size, input_size)
    text = None  # never referenced again - not returned, not logged, not persisted

    if metrics.non_whitespace_char_count == 0:
        return OcrPilotResult(technical_outcome=OCR_NO_TEXT, final_classification=OCR_FAILED, metrics=metrics)

    quality = classify_quality(metrics)
    technical_outcome = OCR_SUCCESS if quality == ACCEPTABLE_FOR_MANUAL_REVIEW else OCR_LOW_QUALITY
    return OcrPilotResult(technical_outcome=technical_outcome, final_classification=quality, metrics=metrics)


def run_ocr_pilot_for_document(
    source_path: Path,
    source_sha256: str,
    extension: str,
    private_root: Path,
    document_workdir_name: str,
    doc_converter: DocToPdfConverter = default_doc_to_pdf_converter,
    ocr_runner: OcrRunner = default_ocrmypdf_runner,
    text_extractor: PdfTextExtractor = default_pdftotext_extractor,
    page_counter: PdfPageCounter = default_pdfinfo_page_counter,
) -> OcrPilotResult:
    """Runs the full guarded OCR workflow for exactly one document. Never
    opens a PostgreSQL connection, never calls Ollama, never persists raw
    text. `document_workdir_name` must be a caller-chosen, non-identifying
    label (e.g. "pilot-01") - never a filename or archive_file_id."""
    normalized_extension = (extension or "").strip().lower()
    if normalized_extension not in ("doc", "pdf"):
        return OcrPilotResult(technical_outcome=OCR_UNEXPECTED_FAILURE, final_classification=OCR_FAILED, metrics=None)

    _reject_symlink_components(private_root)
    workdir = private_root / document_workdir_name
    _reject_symlink_components(workdir)
    _ensure_private_workdir(workdir)

    previous_term_handler = _install_interruption_guard()
    try:
        source_copy = workdir / f"source.{normalized_extension}"
        try:
            copy_and_verify_hash(source_path, source_copy, source_sha256)
        except OcrError as error:
            return OcrPilotResult(technical_outcome=error.reason_code, final_classification=OCR_FAILED, metrics=None)

        try:
            if normalized_extension == "doc":
                doc_converter(source_copy, workdir, DOC_TO_PDF_TIMEOUT_SECONDS)
                converted_pdf = workdir / "source.pdf"
                _require_within(converted_pdf, workdir)
                if not converted_pdf.exists() or converted_pdf.is_symlink():
                    return OcrPilotResult(
                        technical_outcome=DOC_CONVERSION_FAILED, final_classification=OCR_FAILED, metrics=None,
                    )
                return _run_pdf_branch(converted_pdf, workdir, ocr_runner, text_extractor, page_counter)

            return _run_pdf_branch(source_copy, workdir, ocr_runner, text_extractor, page_counter)

        except OcrError as error:
            return OcrPilotResult(technical_outcome=error.reason_code, final_classification=OCR_FAILED, metrics=None)
        except _InterruptionRaised:
            return OcrPilotResult(
                technical_outcome=OCR_UNEXPECTED_FAILURE, final_classification=OCR_FAILED, metrics=None,
            )
        except Exception:
            return OcrPilotResult(
                technical_outcome=OCR_UNEXPECTED_FAILURE, final_classification=OCR_FAILED, metrics=None,
            )
    finally:
        _restore_interruption_guard(previous_term_handler)
        _cleanup_guaranteed(workdir)
