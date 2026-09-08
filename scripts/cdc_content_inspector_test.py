#!/usr/bin/env python3
"""Synthetic test suite for scripts/cdc_content_inspector.py.

SYNTHETIC DATA ONLY. All PDF/DOCX text samples below are invented for
testing - no real archive filenames, paths, project names, client names,
or document content appear anywhere in this file. No real Docling
subprocess and no real Ollama server is ever invoked: the Docling
converter is dependency-injected (FakeDoclingConverter) and all Ollama
HTTP calls are mocked via unittest.mock.patch on urllib.request.urlopen.
"""
from __future__ import annotations

import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Optional
from unittest.mock import patch
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent

_CDC_SPEC = importlib.util.spec_from_file_location("cdc_discovery", HERE / "cdc_discovery.py")
cdc_discovery = importlib.util.module_from_spec(_CDC_SPEC)
sys.modules[_CDC_SPEC.name] = cdc_discovery
_CDC_SPEC.loader.exec_module(cdc_discovery)

_INSPECTOR_SPEC = importlib.util.spec_from_file_location("cdc_content_inspector", HERE / "cdc_content_inspector.py")
inspector_module = importlib.util.module_from_spec(_INSPECTOR_SPEC)
sys.modules[_INSPECTOR_SPEC.name] = inspector_module
_INSPECTOR_SPEC.loader.exec_module(inspector_module)

DiscoveryCounters = cdc_discovery.DiscoveryCounters
DOCUMENT_ROLES = cdc_discovery.DOCUMENT_ROLES

# A real (but content-irrelevant) file on disk, needed because
# extract_pdf_text() now checks path.exists() before attempting extraction
# (Step 3's path-mapping fix). Tests that exercise a fully-injected fake
# converter don't care about the file's actual bytes - only that
# something exists at the path - so one small shared synthetic file
# suffices for all of them. A dedicated nonexistent path is still used
# separately to test the pdf_path_missing reason code itself.
_SYNTHETIC_FILES_DIR = tempfile.mkdtemp(prefix="cdc-content-inspector-test-")
SYNTHETIC_PDF_PATH = Path(_SYNTHETIC_FILES_DIR) / "synthetic.pdf"
SYNTHETIC_PDF_PATH.write_bytes(b"%PDF-synthetic-placeholder-content-ignored-by-fake-converters-in-these-tests")
NONEXISTENT_PDF_PATH = Path(_SYNTHETIC_FILES_DIR) / "does-not-exist.pdf"


def tearDownModule() -> None:
    import shutil

    shutil.rmtree(_SYNTHETIC_FILES_DIR, ignore_errors=True)


# =====================================================================
# Synthetic text fixtures - invented content only
# =====================================================================

SYNTHETIC_CDC_TEXT = """
CAHIER DES CHARGES

TERMES DE REFERENCE

1. Mission
La presente mission a pour objet la realisation d'une etude synthetique.

2. Prestations demandees
Le consultant devra realiser les prestations demandees suivantes.

3. Criteres de consultation
Les criteres de consultation sont detailles ci-dessous.
"""

SYNTHETIC_DAO_TEXT = (
    "DOSSIER D'APPEL D'OFFRES\n\n"
    "Ce dossier d'appel d'offres synthetique concerne une consultation fictive."
)

SYNTHETIC_TDR_TEXT = (
    "TERMES DE REFERENCE\n\n"
    "Les termes de reference de cette mission synthetique sont presentes ci-apres."
)

SYNTHETIC_UNRELATED_TEXT = (
    "RAPPORT TECHNIQUE\n\n"
    "Ce document synthetique presente des resultats techniques generiques sans rapport avec un marche."
)


def write_synthetic_docx(path: Path, paragraphs: list[str]) -> None:
    """Builds a minimal, real, valid DOCX file (a zip containing
    word/document.xml) using only the standard library - no external
    library needed to produce genuine test fixtures."""
    body = "".join(f"<w:p><w:r><w:t>{escape(text)}</w:t></w:r></w:p>" for text in paragraphs)
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body>"
        "</w:document>"
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", document_xml)


class FakeDoclingConverter:
    """Synthetic double for DoclingConverter - never invokes the real
    subprocess/Docling environment."""

    def __init__(self, text: str = SYNTHETIC_CDC_TEXT, raise_error: bool = False):
        self.text = text
        self.raise_error = raise_error
        self.calls = 0

    def __call__(self, source: Path, destination: Path) -> None:
        self.calls += 1
        if self.raise_error:
            raise inspector_module.ExtractionError("synthetic_conversion_failure")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(self.text, encoding="utf-8")


class FakeAiAdapter:
    """Synthetic double for AiAdapter - never calls Ollama."""

    def __init__(self, result=None):
        self._result = result
        self.calls = 0

    def classify(self, text_sample: str, counters: DiscoveryCounters):
        self.calls += 1
        counters.local_ai_calls += 1
        return self._result


class FakeHttpResponse:
    def __init__(self, payload: dict):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class MalformedHttpResponse:
    def read(self) -> bytes:
        return b"not json at all"

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


# =====================================================================
# PDF extraction (Docling, dependency-injected - never the real subprocess)
# =====================================================================


class TestPdfExtraction(unittest.TestCase):
    def test_extraction_increments_counter_and_returns_text(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_CDC_TEXT)
        text = inspector_module.extract_pdf_text(SYNTHETIC_PDF_PATH, counters, converter=converter)
        self.assertEqual(counters.pdf_extraction_calls, 1)
        self.assertIn("CAHIER DES CHARGES", text)

    def test_conversion_failure_raises_extraction_error(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(raise_error=True)
        with self.assertRaises(inspector_module.ExtractionError):
            inspector_module.extract_pdf_text(SYNTHETIC_PDF_PATH, counters, converter=converter)
        self.assertEqual(counters.pdf_extraction_calls, 1)

    def test_empty_text_triggers_ocr_fallback_which_fails_safely(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text="   ")
        with self.assertRaises(inspector_module.ExtractionError):
            inspector_module.extract_pdf_text(SYNTHETIC_PDF_PATH, counters, converter=converter)
        self.assertEqual(counters.ocr_calls, 1)

    def test_text_is_truncated_to_char_limit(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text="A" * 100)
        text = inspector_module.extract_pdf_text(SYNTHETIC_PDF_PATH, counters, char_limit=10, converter=converter)
        self.assertEqual(len(text), 10)

    def test_missing_source_path_raises_pdf_path_missing_before_calling_converter(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_CDC_TEXT)
        with self.assertRaises(inspector_module.ExtractionError) as ctx:
            inspector_module.extract_pdf_text(NONEXISTENT_PDF_PATH, counters, converter=converter)
        self.assertEqual(ctx.exception.reason_code, "pdf_path_missing")
        self.assertEqual(converter.calls, 0)  # never even reached Docling
        self.assertEqual(counters.pdf_extraction_calls, 1)

    def test_missing_docling_output_raises_docling_output_missing(self):
        counters = DiscoveryCounters()

        def converter_that_writes_nothing(source: Path, destination: Path) -> None:
            pass  # simulates Docling reporting success but leaving no output file

        with self.assertRaises(inspector_module.ExtractionError) as ctx:
            inspector_module.extract_pdf_text(SYNTHETIC_PDF_PATH, counters, converter=converter_that_writes_nothing)
        self.assertEqual(ctx.exception.reason_code, "docling_output_missing")


class TestResolveDoclingPython(unittest.TestCase):
    def test_explicit_env_var_is_trusted_as_is(self):
        with patch.dict(inspector_module.os.environ, {"DOCLING_PYTHON": "/synthetic/configured/python"}):
            self.assertEqual(inspector_module.resolve_docling_python(), Path("/synthetic/configured/python"))

    def test_falls_back_to_default_venv_only_if_it_exists(self):
        existing_path = SYNTHETIC_PDF_PATH  # any real file on disk works as a stand-in
        with patch.dict(inspector_module.os.environ, {}, clear=False):
            inspector_module.os.environ.pop("DOCLING_PYTHON", None)
            with patch.object(inspector_module, "DEFAULT_DOCLING_VENV_PYTHON", existing_path):
                self.assertEqual(inspector_module.resolve_docling_python(), existing_path)

    def test_returns_none_when_default_venv_missing_and_no_override(self):
        with patch.dict(inspector_module.os.environ, {}, clear=False):
            inspector_module.os.environ.pop("DOCLING_PYTHON", None)
            with patch.object(inspector_module, "DEFAULT_DOCLING_VENV_PYTHON", NONEXISTENT_PDF_PATH):
                self.assertIsNone(inspector_module.resolve_docling_python())


class TestDefaultDoclingConverterFailureModes(unittest.TestCase):
    """Exercises default_docling_converter's own error handling - NOT the
    real subprocess (resolve_docling_python is mocked/forced to fail in
    every scenario here except the real end-to-end test in
    TestRealDoclingIntegration below)."""

    def test_missing_interpreter_raises_docling_python_missing(self):
        with patch.object(inspector_module, "resolve_docling_python", return_value=None):
            with self.assertRaises(inspector_module.ExtractionError) as ctx:
                inspector_module.default_docling_converter(SYNTHETIC_PDF_PATH, Path("/tmp/unused-output.md"))
        self.assertEqual(ctx.exception.reason_code, "docling_python_missing")

    def test_timeout_raises_docling_timeout(self):
        import subprocess as subprocess_module

        with patch.object(inspector_module, "resolve_docling_python", return_value=Path("/synthetic/python")), \
             patch.object(
                 inspector_module.subprocess, "run",
                 side_effect=subprocess_module.TimeoutExpired(cmd="synthetic", timeout=1),
             ):
            with self.assertRaises(inspector_module.ExtractionError) as ctx:
                inspector_module.default_docling_converter(SYNTHETIC_PDF_PATH, Path("/tmp/unused-output.md"))
        self.assertEqual(ctx.exception.reason_code, "docling_timeout")

    def test_nonzero_exit_raises_docling_process_failed(self):
        class FakeCompletedProcess:
            returncode = 1
            stdout = ""
            stderr = ""

        with patch.object(inspector_module, "resolve_docling_python", return_value=Path("/synthetic/python")), \
             patch.object(inspector_module.subprocess, "run", return_value=FakeCompletedProcess()):
            with self.assertRaises(inspector_module.ExtractionError) as ctx:
                inspector_module.default_docling_converter(SYNTHETIC_PDF_PATH, Path("/tmp/unused-output.md"))
        self.assertEqual(ctx.exception.reason_code, "docling_process_failed")

    def test_os_error_spawning_process_raises_docling_process_failed(self):
        with patch.object(inspector_module, "resolve_docling_python", return_value=Path("/synthetic/python")), \
             patch.object(inspector_module.subprocess, "run", side_effect=OSError("synthetic spawn failure")):
            with self.assertRaises(inspector_module.ExtractionError) as ctx:
                inspector_module.default_docling_converter(SYNTHETIC_PDF_PATH, Path("/tmp/unused-output.md"))
        self.assertEqual(ctx.exception.reason_code, "docling_process_failed")


# =====================================================================
# DOCX extraction (stdlib zipfile/XML - real minimal files, no library)
# =====================================================================


class TestDocxExtraction(unittest.TestCase):
    def test_extraction_increments_counter_and_returns_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.docx"
            write_synthetic_docx(path, ["CAHIER DES CHARGES", "Mission et prestations demandees."])
            counters = DiscoveryCounters()
            text = inspector_module.extract_docx_text(path, counters)
            self.assertEqual(counters.docx_extraction_calls, 1)
            self.assertIn("CAHIER DES CHARGES", text)

    def test_invalid_zip_raises_extraction_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "not-a-docx.docx"
            path.write_bytes(b"not a zip file at all")
            counters = DiscoveryCounters()
            with self.assertRaises(inspector_module.ExtractionError):
                inspector_module.extract_docx_text(path, counters)
            self.assertEqual(counters.docx_extraction_calls, 1)

    def test_zip_without_document_xml_raises_extraction_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "weird.docx"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("unrelated.txt", "nothing useful")
            counters = DiscoveryCounters()
            with self.assertRaises(inspector_module.ExtractionError):
                inspector_module.extract_docx_text(path, counters)


# =====================================================================
# Legacy DOC extraction - always fails safely (no tool available)
# =====================================================================


NONEXISTENT_DOC_PATH = Path(_SYNTHETIC_FILES_DIR) / "does-not-exist.doc"
SYNTHETIC_DOC_PATH = Path(_SYNTHETIC_FILES_DIR) / "synthetic.doc"
SYNTHETIC_DOC_PATH.write_bytes(b"synthetic-placeholder-not-a-real-doc-file-content-ignored-by-fake-converters")


class TestDocExtraction(unittest.TestCase):
    """Unit-level DOC tests using a dependency-injected/mocked LibreOffice
    layer (resolve_libreoffice_binary / subprocess.run) - never the real
    LibreOffice binary. See TestRealLibreOfficeDocIntegration below for the
    genuine, unmocked end-to-end test."""

    def test_missing_source_path_raises_doc_path_missing_before_calling_libreoffice(self):
        counters = DiscoveryCounters()
        with patch.object(inspector_module, "resolve_libreoffice_binary", return_value="/usr/bin/soffice") as mock_resolve:
            with self.assertRaises(inspector_module.ExtractionError) as ctx:
                inspector_module.extract_doc_text(NONEXISTENT_DOC_PATH, counters)
        self.assertEqual(ctx.exception.reason_code, "doc_path_missing")
        self.assertEqual(counters.doc_extraction_calls, 1)
        mock_resolve.assert_not_called()  # never even reached LibreOffice resolution

    def test_missing_libreoffice_binary_raises_libreoffice_missing(self):
        with patch.object(inspector_module, "resolve_libreoffice_binary", return_value=None):
            with self.assertRaises(inspector_module.ExtractionError) as ctx:
                inspector_module.convert_doc_to_docx_via_libreoffice(SYNTHETIC_DOC_PATH, Path(_SYNTHETIC_FILES_DIR))
        self.assertEqual(ctx.exception.reason_code, "libreoffice_missing")

    def test_timeout_raises_libreoffice_timeout(self):
        import subprocess as subprocess_module

        with patch.object(inspector_module, "resolve_libreoffice_binary", return_value="/usr/bin/soffice"), \
             patch.object(
                 inspector_module.subprocess, "run",
                 side_effect=subprocess_module.TimeoutExpired(cmd="synthetic", timeout=1),
             ):
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(inspector_module.ExtractionError) as ctx:
                    inspector_module.convert_doc_to_docx_via_libreoffice(SYNTHETIC_DOC_PATH, Path(tmp))
        self.assertEqual(ctx.exception.reason_code, "libreoffice_timeout")

    def test_nonzero_exit_raises_libreoffice_process_failed(self):
        class FakeCompletedProcess:
            returncode = 1
            stdout = ""
            stderr = ""

        with patch.object(inspector_module, "resolve_libreoffice_binary", return_value="/usr/bin/soffice"), \
             patch.object(inspector_module.subprocess, "run", return_value=FakeCompletedProcess()):
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(inspector_module.ExtractionError) as ctx:
                    inspector_module.convert_doc_to_docx_via_libreoffice(SYNTHETIC_DOC_PATH, Path(tmp))
        self.assertEqual(ctx.exception.reason_code, "libreoffice_process_failed")

    def test_os_error_spawning_process_raises_libreoffice_process_failed(self):
        with patch.object(inspector_module, "resolve_libreoffice_binary", return_value="/usr/bin/soffice"), \
             patch.object(inspector_module.subprocess, "run", side_effect=OSError("synthetic spawn failure")):
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(inspector_module.ExtractionError) as ctx:
                    inspector_module.convert_doc_to_docx_via_libreoffice(SYNTHETIC_DOC_PATH, Path(tmp))
        self.assertEqual(ctx.exception.reason_code, "libreoffice_process_failed")

    def test_missing_converted_output_raises_libreoffice_output_missing(self):
        class FakeCompletedProcessSuccess:
            returncode = 0
            stdout = ""
            stderr = ""

        # LibreOffice reports success but leaves no output/<stem>.docx file.
        with patch.object(inspector_module, "resolve_libreoffice_binary", return_value="/usr/bin/soffice"), \
             patch.object(inspector_module.subprocess, "run", return_value=FakeCompletedProcessSuccess()):
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(inspector_module.ExtractionError) as ctx:
                    inspector_module.convert_doc_to_docx_via_libreoffice(SYNTHETIC_DOC_PATH, Path(tmp))
        self.assertEqual(ctx.exception.reason_code, "libreoffice_output_missing")

    def test_empty_converted_output_raises_extracted_text_empty(self):
        # A "successful" conversion whose resulting DOCX has no extractable
        # text (e.g. a genuinely blank source document).
        def fake_converter(source: Path, output_dir: Path) -> Path:
            empty_docx = output_dir / "empty.docx"
            write_synthetic_docx(empty_docx, [])
            return empty_docx

        with patch.object(inspector_module, "convert_doc_to_docx_via_libreoffice", side_effect=fake_converter):
            counters = DiscoveryCounters()
            with self.assertRaises(inspector_module.ExtractionError) as ctx:
                inspector_module.extract_doc_text(SYNTHETIC_DOC_PATH, counters)
        self.assertEqual(ctx.exception.reason_code, "extracted_text_empty")

    def test_successful_conversion_extracts_text_and_reuses_docx_core(self):
        def fake_converter(source: Path, output_dir: Path) -> Path:
            docx_path = output_dir / "converted.docx"
            write_synthetic_docx(docx_path, [SYNTHETIC_CDC_TEXT])
            return docx_path

        with patch.object(inspector_module, "convert_doc_to_docx_via_libreoffice", side_effect=fake_converter):
            counters = DiscoveryCounters()
            text = inspector_module.extract_doc_text(SYNTHETIC_DOC_PATH, counters)
        self.assertIn("CAHIER DES CHARGES", text)
        self.assertEqual(counters.doc_extraction_calls, 1)
        # extract_doc_text must NOT double-count against docx_extraction_calls
        # (that counter is reserved for genuinely native .docx files).
        self.assertEqual(counters.docx_extraction_calls, 0)

    def test_temp_directory_is_cleaned_up_after_success(self):
        captured_output_dir: list[Path] = []

        def fake_converter(source: Path, output_dir: Path) -> Path:
            captured_output_dir.append(output_dir)
            docx_path = output_dir / "converted.docx"
            write_synthetic_docx(docx_path, [SYNTHETIC_CDC_TEXT])
            return docx_path

        with patch.object(inspector_module, "convert_doc_to_docx_via_libreoffice", side_effect=fake_converter):
            counters = DiscoveryCounters()
            inspector_module.extract_doc_text(SYNTHETIC_DOC_PATH, counters)

        self.assertEqual(len(captured_output_dir), 1)
        self.assertFalse(captured_output_dir[0].exists())  # cleaned up by the `with` block

    def test_temp_directory_is_cleaned_up_after_failure(self):
        captured_output_dir: list[Path] = []

        def fake_converter(source: Path, output_dir: Path) -> Path:
            captured_output_dir.append(output_dir)
            raise inspector_module.ExtractionError("libreoffice_process_failed")

        with patch.object(inspector_module, "convert_doc_to_docx_via_libreoffice", side_effect=fake_converter):
            counters = DiscoveryCounters()
            with self.assertRaises(inspector_module.ExtractionError):
                inspector_module.extract_doc_text(SYNTHETIC_DOC_PATH, counters)

        self.assertEqual(len(captured_output_dir), 1)
        self.assertFalse(captured_output_dir[0].exists())  # cleaned up even on failure

    def test_libreoffice_never_writes_into_the_source_directory(self):
        # convert_doc_to_docx_via_libreoffice must only ever pass a
        # dedicated temp directory as --outdir - never the source file's
        # own directory (which, for a real archive file, is the read-only
        # mount).
        captured_args: list[list[str]] = []

        class FakeCompletedProcess:
            returncode = 0
            stdout = ""
            stderr = ""

        def fake_run(args, **kwargs):
            captured_args.append(args)
            # Simulate LibreOffice writing the expected output file so the
            # call succeeds and we can inspect what args it was given.
            outdir_index = args.index("--outdir") + 1
            output_dir = Path(args[outdir_index])
            (output_dir / (SYNTHETIC_DOC_PATH.stem + ".docx")).write_bytes(b"")
            write_synthetic_docx(output_dir / (SYNTHETIC_DOC_PATH.stem + ".docx"), ["placeholder"])
            return FakeCompletedProcess()

        with patch.object(inspector_module, "resolve_libreoffice_binary", return_value="/usr/bin/soffice"), \
             patch.object(inspector_module.subprocess, "run", side_effect=fake_run):
            with tempfile.TemporaryDirectory() as tmp:
                inspector_module.convert_doc_to_docx_via_libreoffice(SYNTHETIC_DOC_PATH, Path(tmp))

        self.assertEqual(len(captured_args), 1)
        outdir_index = captured_args[0].index("--outdir") + 1
        outdir_used = Path(captured_args[0][outdir_index])
        self.assertNotEqual(outdir_used, SYNTHETIC_DOC_PATH.parent)
        self.assertNotIn(str(SYNTHETIC_DOC_PATH.parent), str(outdir_used))


# =====================================================================
# Document evidence analysis (pure, rule-based)
# =====================================================================


class TestDocumentEvidenceAnalysis(unittest.TestCase):
    def test_strong_cdc_text_yields_role_cdc_and_high_confidence(self):
        evidence = inspector_module.analyze_document_evidence(SYNTHETIC_CDC_TEXT)
        self.assertEqual(evidence.role_hint, "CDC")
        self.assertGreaterEqual(evidence.signal_count, 3)
        self.assertGreaterEqual(evidence.confidence, inspector_module.CONFIRMED_CDC_CONFIDENCE_THRESHOLD)

    def test_dao_text_yields_role_dao_not_cdc(self):
        evidence = inspector_module.analyze_document_evidence(SYNTHETIC_DAO_TEXT)
        self.assertEqual(evidence.role_hint, "DAO")

    def test_tdr_text_yields_role_tdr_not_cdc(self):
        evidence = inspector_module.analyze_document_evidence(SYNTHETIC_TDR_TEXT)
        self.assertEqual(evidence.role_hint, "TDR")

    def test_unrelated_technical_text_yields_no_role_and_low_confidence(self):
        evidence = inspector_module.analyze_document_evidence(SYNTHETIC_UNRELATED_TEXT)
        self.assertIsNone(evidence.role_hint)
        self.assertEqual(evidence.signal_count, 0)
        self.assertLess(evidence.confidence, inspector_module.CONFIRMED_CDC_CONFIDENCE_THRESHOLD)

    def test_all_detected_role_hints_are_valid_document_roles(self):
        for text in (SYNTHETIC_CDC_TEXT, SYNTHETIC_DAO_TEXT, SYNTHETIC_TDR_TEXT):
            evidence = inspector_module.analyze_document_evidence(text)
            if evidence.role_hint is not None:
                self.assertIn(evidence.role_hint, DOCUMENT_ROLES)

    def test_evidence_never_returns_raw_matched_text(self):
        evidence = inspector_module.analyze_document_evidence(SYNTHETIC_CDC_TEXT)
        for code in evidence.matched_signal_codes:
            self.assertNotIn(" ", code)  # short codes only, never a text excerpt
            self.assertLess(len(code), 40)


class TestContentVerificationDecision(unittest.TestCase):
    def test_strong_cdc_evidence_confirms(self):
        evidence = inspector_module.analyze_document_evidence(SYNTHETIC_CDC_TEXT)
        verified_as_cdc, verified_not_cdc, _reason = inspector_module.decide_content_verification(evidence)
        self.assertTrue(verified_as_cdc)
        self.assertFalse(verified_not_cdc)

    def test_dao_evidence_never_confirms_regardless_of_signal_strength(self):
        # Many tender-related signals, but never the literal "cahier des
        # charges" phrase - must never auto-confirm as CDC.
        strong_dao_text = (
            SYNTHETIC_DAO_TEXT
            + " mission prestations demandees criteres de consultation termes de reference"
        )
        evidence = inspector_module.analyze_document_evidence(strong_dao_text)
        self.assertNotEqual(evidence.role_hint, "CDC")
        verified_as_cdc, _verified_not_cdc, _reason = inspector_module.decide_content_verification(evidence)
        self.assertFalse(verified_as_cdc)

    def test_no_signals_yields_verified_not_cdc(self):
        evidence = inspector_module.analyze_document_evidence(SYNTHETIC_UNRELATED_TEXT)
        verified_as_cdc, verified_not_cdc, _reason = inspector_module.decide_content_verification(evidence)
        self.assertFalse(verified_as_cdc)
        self.assertTrue(verified_not_cdc)


# =====================================================================
# LocalContentInspector end-to-end (rule-based only, no AI adapter)
# =====================================================================


class TestLocalContentInspectorEndToEnd(unittest.TestCase):
    def test_strong_cdc_pdf_yields_confirmed_cdc(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_CDC_TEXT)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertTrue(outcome.verified_as_cdc)
        self.assertEqual(outcome.document_role, "CDC")
        self.assertEqual(counters.files_content_inspected, 1)
        self.assertEqual(counters.pdf_extraction_calls, 1)
        self.assertEqual(counters.pdf_extraction_successes, 1)
        self.assertEqual(counters.pdf_extraction_failures, 0)

    def test_filename_says_cdc_but_content_unrelated_is_not_confirmed(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_UNRELATED_TEXT)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertFalse(outcome.verified_as_cdc)
        self.assertTrue(outcome.verified_not_cdc)

    def test_dao_content_keeps_dao_role(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_DAO_TEXT)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertEqual(outcome.document_role, "DAO")
        self.assertFalse(outcome.verified_as_cdc)

    def test_tdr_content_keeps_tdr_role(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_TDR_TEXT)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertEqual(outcome.document_role, "TDR")
        self.assertFalse(outcome.verified_as_cdc)

    def test_normal_technical_offer_yields_needs_review_or_not_cdc(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_UNRELATED_TEXT)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertFalse(outcome.verified_as_cdc)

    def test_failed_extraction_yields_needs_human_review(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(raise_error=True)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertTrue(outcome.failed)
        self.assertTrue(outcome.needs_human_review)
        self.assertFalse(outcome.verified_as_cdc)
        self.assertEqual(counters.failed_extractions, 1)
        self.assertEqual(counters.pdf_extraction_successes, 0)
        self.assertEqual(counters.pdf_extraction_failures, 1)
        self.assertEqual(counters.files_content_inspected, 0)  # never reached analysis

    def test_unsupported_extension_is_handled_safely(self):
        counters = DiscoveryCounters()
        local_inspector = inspector_module.LocalContentInspector()
        outcome = local_inspector.inspect(1, "xyz", counters, file_path=Path("/tmp/synthetic.xyz"))
        self.assertTrue(outcome.attempted)
        self.assertTrue(outcome.needs_human_review)
        self.assertFalse(outcome.verified_as_cdc)
        self.assertEqual(counters.pdf_extraction_calls, 0)
        self.assertEqual(counters.docx_extraction_calls, 0)
        self.assertEqual(counters.doc_extraction_calls, 0)

    def test_no_file_path_is_handled_safely(self):
        counters = DiscoveryCounters()
        local_inspector = inspector_module.LocalContentInspector()
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=None)
        self.assertTrue(outcome.attempted)
        self.assertTrue(outcome.failed)
        self.assertFalse(outcome.verified_as_cdc)

    def test_docx_end_to_end_via_local_inspector(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.docx"
            write_synthetic_docx(path, [SYNTHETIC_CDC_TEXT])
            counters = DiscoveryCounters()
            local_inspector = inspector_module.LocalContentInspector()
            outcome = local_inspector.inspect(1, "docx", counters, file_path=path)
            self.assertEqual(counters.docx_extraction_calls, 1)
            self.assertTrue(outcome.verified_as_cdc)

    def test_doc_end_to_end_missing_source_fails_safely(self):
        counters = DiscoveryCounters()
        local_inspector = inspector_module.LocalContentInspector()
        outcome = local_inspector.inspect(1, "doc", counters, file_path=NONEXISTENT_DOC_PATH)
        self.assertTrue(outcome.failed)
        self.assertTrue(outcome.needs_human_review)
        self.assertFalse(outcome.verified_as_cdc)
        self.assertEqual(outcome.reason_code, "doc_path_missing")
        self.assertEqual(counters.doc_extraction_failures, 1)
        self.assertEqual(counters.doc_extraction_successes, 0)

    def test_doc_end_to_end_via_local_inspector_with_successful_conversion(self):
        # LocalContentInspector's full DOC path, with only the LibreOffice
        # conversion step itself dependency-injected (mirrors how the PDF
        # tests inject a fake Docling converter) - everything else (the
        # DOCX text-reading core, evidence analysis, verification decision)
        # is real.
        def fake_converter(source: Path, output_dir: Path) -> Path:
            docx_path = output_dir / "converted.docx"
            write_synthetic_docx(docx_path, [SYNTHETIC_CDC_TEXT])
            return docx_path

        with patch.object(inspector_module, "convert_doc_to_docx_via_libreoffice", side_effect=fake_converter):
            counters = DiscoveryCounters()
            local_inspector = inspector_module.LocalContentInspector()
            outcome = local_inspector.inspect(1, "doc", counters, file_path=SYNTHETIC_DOC_PATH)

        self.assertTrue(outcome.verified_as_cdc)
        self.assertEqual(outcome.document_role, "CDC")
        self.assertEqual(counters.doc_extraction_calls, 1)
        self.assertEqual(counters.doc_extraction_successes, 1)
        self.assertEqual(counters.doc_extraction_failures, 0)
        self.assertEqual(counters.files_content_inspected, 1)

    def test_no_raw_content_is_ever_printed(self):
        buffer = io.StringIO()
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_CDC_TEXT)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        with redirect_stdout(buffer), redirect_stderr(buffer):
            local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        output = buffer.getvalue()
        self.assertEqual(output, "")

    def test_no_raw_content_or_path_is_ever_printed_during_doc_extraction(self):
        def fake_converter(source: Path, output_dir: Path) -> Path:
            docx_path = output_dir / "converted.docx"
            write_synthetic_docx(docx_path, [SYNTHETIC_CDC_TEXT])
            return docx_path

        buffer = io.StringIO()
        counters = DiscoveryCounters()
        local_inspector = inspector_module.LocalContentInspector()
        with patch.object(inspector_module, "convert_doc_to_docx_via_libreoffice", side_effect=fake_converter):
            with redirect_stdout(buffer), redirect_stderr(buffer):
                local_inspector.inspect(1, "doc", counters, file_path=SYNTHETIC_DOC_PATH)
        output = buffer.getvalue()
        self.assertEqual(output, "")
        self.assertNotIn(str(SYNTHETIC_DOC_PATH), output)
        self.assertNotIn(str(_SYNTHETIC_FILES_DIR), output)

    def test_aggregate_report_contains_no_filename_or_path(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_CDC_TEXT)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)

        as_dict = counters.as_dict()
        for value in as_dict.values():
            self.assertNotIsInstance(value, (str, Path))
        serialized = json.dumps(as_dict)
        self.assertNotIn(str(SYNTHETIC_PDF_PATH), serialized)
        self.assertNotIn(str(_SYNTHETIC_FILES_DIR), serialized)
        self.assertNotIn("CAHIER DES CHARGES", serialized)

    def test_no_external_calls_for_rule_based_inspection(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_CDC_TEXT)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertEqual(counters.external_calls, 0)


# =====================================================================
# Optional local AI second stage (mocked only - never real Ollama)
# =====================================================================


class TestValidateAiResponse(unittest.TestCase):
    def test_valid_payload_accepted(self):
        result = inspector_module.validate_ai_response(
            {"role": "CDC", "is_cdc": True, "confidence": 0.9, "reason_code": "synthetic_ok"}
        )
        self.assertIsNotNone(result)

    def test_missing_keys_rejected(self):
        self.assertIsNone(inspector_module.validate_ai_response({"role": "CDC"}))

    def test_invalid_role_rejected(self):
        self.assertIsNone(
            inspector_module.validate_ai_response(
                {"role": "NOT_A_REAL_ROLE", "is_cdc": True, "confidence": 0.9, "reason_code": "x"}
            )
        )

    def test_confidence_out_of_range_rejected(self):
        self.assertIsNone(
            inspector_module.validate_ai_response({"role": "CDC", "is_cdc": True, "confidence": 1.5, "reason_code": "x"})
        )

    def test_non_dict_payload_rejected(self):
        self.assertIsNone(inspector_module.validate_ai_response(["not", "a", "dict"]))

    def test_boolean_confidence_rejected(self):
        # bool is an int subclass in Python - must be explicitly rejected.
        self.assertIsNone(
            inspector_module.validate_ai_response({"role": "CDC", "is_cdc": True, "confidence": True, "reason_code": "x"})
        )

    def test_is_cdc_wrong_type_rejected(self):
        self.assertIsNone(
            inspector_module.validate_ai_response({"role": "CDC", "is_cdc": "yes", "confidence": 0.9, "reason_code": "x"})
        )


class TestOllamaAiAdapter(unittest.TestCase):
    def test_non_loopback_url_is_refused_at_construction(self):
        with self.assertRaises(ValueError):
            inspector_module.OllamaAiAdapter(url="http://example.com/api/chat")

    def test_loopback_url_is_accepted(self):
        adapter = inspector_module.OllamaAiAdapter(url="http://127.0.0.1:11434/api/chat")
        self.assertIsInstance(adapter, inspector_module.OllamaAiAdapter)

    def test_successful_mocked_classification_increments_counter(self):
        counters = DiscoveryCounters()
        adapter = inspector_module.OllamaAiAdapter()
        payload = {"role": "CDC", "is_cdc": True, "confidence": 0.9, "reason_code": "synthetic_ai_ok"}
        response = FakeHttpResponse({"message": {"content": json.dumps(payload)}})
        with patch.object(inspector_module.urllib.request, "urlopen", return_value=response):
            result = adapter.classify("synthetic sample text", counters)
        self.assertIsNotNone(result)
        self.assertEqual(result.role, "CDC")
        self.assertEqual(counters.local_ai_calls, 1)
        self.assertEqual(counters.external_calls, 0)

    def test_malformed_response_fails_closed(self):
        counters = DiscoveryCounters()
        adapter = inspector_module.OllamaAiAdapter()
        with patch.object(inspector_module.urllib.request, "urlopen", return_value=MalformedHttpResponse()):
            result = adapter.classify("synthetic sample text", counters)
        self.assertIsNone(result)

    def test_schema_violation_fails_closed(self):
        counters = DiscoveryCounters()
        adapter = inspector_module.OllamaAiAdapter()
        payload = {"role": "CDC", "is_cdc": "yes", "confidence": 0.9, "reason_code": "x"}
        response = FakeHttpResponse({"message": {"content": json.dumps(payload)}})
        with patch.object(inspector_module.urllib.request, "urlopen", return_value=response):
            result = adapter.classify("synthetic sample text", counters)
        self.assertIsNone(result)

    def test_timeout_fails_closed(self):
        counters = DiscoveryCounters()
        adapter = inspector_module.OllamaAiAdapter(timeout=0.01)
        with patch.object(inspector_module.urllib.request, "urlopen", side_effect=TimeoutError):
            result = adapter.classify("synthetic sample text", counters)
        self.assertIsNone(result)

    def test_connection_error_fails_closed(self):
        counters = DiscoveryCounters()
        adapter = inspector_module.OllamaAiAdapter()
        with patch.object(
            inspector_module.urllib.request, "urlopen", side_effect=inspector_module.urllib.error.URLError("refused")
        ):
            result = adapter.classify("synthetic sample text", counters)
        self.assertIsNone(result)


class TestCombineRuleAndAiVerification(unittest.TestCase):
    def test_ai_none_preserves_rule_result(self):
        result = inspector_module.combine_rule_and_ai_verification(True, False, "rule_reason", None)
        self.assertEqual(result, (True, False, "rule_reason"))

    def test_agreement_confirms(self):
        ai = inspector_module.AiClassificationResult(role="CDC", is_cdc=True, confidence=0.9, reason_code="x")
        result = inspector_module.combine_rule_and_ai_verification(True, False, "rule_reason", ai)
        self.assertTrue(result[0])

    def test_disagreement_downgrades_to_needs_review(self):
        ai = inspector_module.AiClassificationResult(role="OTHER_TENDER_DOCUMENT", is_cdc=False, confidence=0.9, reason_code="x")
        result = inspector_module.combine_rule_and_ai_verification(True, False, "rule_reason", ai)
        self.assertFalse(result[0])
        self.assertFalse(result[1])


class TestLocalContentInspectorWithMockedAiAdapter(unittest.TestCase):
    def test_local_ai_counter_increments_when_adapter_configured(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_CDC_TEXT)
        ai_result = inspector_module.AiClassificationResult(role="CDC", is_cdc=True, confidence=0.95, reason_code="ai_agrees")
        ai_adapter = FakeAiAdapter(result=ai_result)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter, ai_adapter=ai_adapter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertEqual(counters.local_ai_calls, 1)
        self.assertEqual(ai_adapter.calls, 1)
        self.assertTrue(outcome.verified_as_cdc)

    def test_ai_disagreement_downgrades_rule_based_confirmation(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_CDC_TEXT)  # rule-based alone would confirm
        ai_result = inspector_module.AiClassificationResult(
            role="OTHER_TENDER_DOCUMENT", is_cdc=False, confidence=0.9, reason_code="ai_disagrees"
        )
        ai_adapter = FakeAiAdapter(result=ai_result)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter, ai_adapter=ai_adapter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertFalse(outcome.verified_as_cdc)
        self.assertFalse(outcome.verified_not_cdc)
        self.assertTrue(outcome.needs_human_review)

    def test_failed_ai_call_leaves_rule_based_confirmation_unchanged(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_CDC_TEXT)
        ai_adapter = FakeAiAdapter(result=None)  # simulates fail-closed AI call
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter, ai_adapter=ai_adapter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertTrue(outcome.verified_as_cdc)
        self.assertEqual(counters.local_ai_calls, 1)


# =====================================================================
# pdf_extraction_calls == pdf_extraction_successes + pdf_extraction_failures
# =====================================================================


class TestPdfExtractionCounterInvariant(unittest.TestCase):
    def test_invariant_holds_across_a_mixed_batch_of_successes_and_failures(self):
        counters = DiscoveryCounters()

        scenarios = [
            FakeDoclingConverter(text=SYNTHETIC_CDC_TEXT),  # success
            FakeDoclingConverter(text=SYNTHETIC_UNRELATED_TEXT),  # success (extraction succeeds; content just isn't CDC)
            FakeDoclingConverter(raise_error=True),  # failure
        ]
        local_inspector = inspector_module.LocalContentInspector()
        for converter in scenarios:
            local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
            local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)

        # A fourth attempt against a genuinely missing path.
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=FakeDoclingConverter())
        local_inspector.inspect(1, "pdf", counters, file_path=NONEXISTENT_PDF_PATH)

        self.assertEqual(counters.pdf_extraction_calls, 4)
        self.assertEqual(counters.pdf_extraction_successes, 2)
        self.assertEqual(counters.pdf_extraction_failures, 2)
        self.assertEqual(
            counters.pdf_extraction_calls, counters.pdf_extraction_successes + counters.pdf_extraction_failures
        )
        self.assertEqual(counters.pdf_path_missing, 1)


# =====================================================================
# Real, unmocked Docling integration test (synthetic PDF only - Step 6).
# Skips gracefully if the local Docling environment isn't available on
# this machine, rather than failing the whole suite.
# =====================================================================


def _real_docling_available() -> bool:
    return inspector_module.resolve_docling_python() is not None


class TestRealDoclingIntegration(unittest.TestCase):
    @unittest.skipUnless(_real_docling_available(), "local Docling environment (~/.venv-docling) not available")
    def test_real_docling_extracts_synthetic_cdc_pdf_end_to_end(self):
        # A genuinely synthetic PDF - built fresh here, never taken from
        # the archive - containing invented CDC-like text, run through the
        # REAL Docling subprocess (no converter injected) and the REAL
        # LocalContentInspector pipeline end to end.
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "synthetic_cdc_smoke_test.pdf"
            _write_minimal_synthetic_pdf(pdf_path, SYNTHETIC_CDC_TEXT)

            counters = DiscoveryCounters()
            local_inspector = inspector_module.LocalContentInspector()  # real default_docling_converter
            outcome = local_inspector.inspect(1, "pdf", counters, file_path=pdf_path)

        self.assertEqual(counters.pdf_extraction_calls, 1)
        self.assertEqual(counters.pdf_extraction_successes, 1)
        self.assertEqual(counters.pdf_extraction_failures, 0)
        self.assertEqual(counters.files_content_inspected, 1)
        self.assertEqual(counters.external_calls, 0)
        self.assertTrue(outcome.attempted)
        self.assertFalse(outcome.failed)
        # The synthetic content is CDC-like by construction, so the
        # rule-based stage should recognize it - proving text genuinely
        # reached the verification stage (not just "extraction didn't crash").
        self.assertTrue(outcome.verified_as_cdc or outcome.document_role == "CDC")


def _real_libreoffice_available() -> bool:
    return inspector_module.resolve_libreoffice_binary() is not None


def _create_synthetic_doc_via_libreoffice(dest_doc_path: Path, text: str) -> None:
    """Creates a GENUINE legacy .doc fixture entirely from synthetic
    content, using real local LibreOffice itself (txt -> doc), never
    real archive content. dest_doc_path's parent must already exist;
    dest_doc_path's stem/extension are respected exactly (LibreOffice
    writes <stem>.doc into --outdir), so the caller can freely test
    uppercase extensions, spaces, and Unicode characters in the filename
    by choosing dest_doc_path accordingly."""
    with tempfile.TemporaryDirectory(prefix="cdc-doc-fixture-src-") as src_tmp, \
         tempfile.TemporaryDirectory(prefix="cdc-doc-fixture-profile-") as profile_tmp:
        txt_path = Path(src_tmp) / "source.txt"
        txt_path.write_text(text, encoding="utf-8")

        binary = inspector_module.resolve_libreoffice_binary()
        completed = subprocess.run(
            [
                binary, "--headless", "--invisible", "--nodefault", "--norestore", "--nolockcheck",
                f"-env:UserInstallation=file://{profile_tmp}",
                "--convert-to", "doc",
                "--outdir", str(dest_doc_path.parent),
                str(txt_path),
            ],
            check=False, capture_output=True, text=True, timeout=60,
        )
        if completed.returncode != 0:
            raise RuntimeError("synthetic .doc fixture creation failed")
        generated = dest_doc_path.parent / "source.doc"
        if not generated.exists():
            raise RuntimeError("synthetic .doc fixture was not created")
        generated.rename(dest_doc_path)


class TestSourceFormatSniffingAndFallbackExtractors(unittest.TestCase):
    """Synthetic-only unit tests for _sniff_source_format and the RTF/HTML
    fallback extractors - a ".doc"-named file that is actually a different
    format must never be blindly sent to LibreOffice. No real LibreOffice
    invocation in this class at all (all sniffed formats are handled
    without it, or the fallthrough to LibreOffice is mocked)."""

    def test_rtf_disguised_as_doc_is_extracted_without_libreoffice(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake_doc = Path(tmp) / "report.doc"
            fake_doc.write_bytes(rb"{\rtf1\ansi Cahier des charges synthetique {\b criteres} de consultation.}")
            counters = DiscoveryCounters()
            with patch.object(inspector_module, "resolve_libreoffice_binary") as mock_resolve:
                text = inspector_module.extract_doc_text(fake_doc, counters)
            mock_resolve.assert_not_called()
        self.assertIn("Cahier des charges synthetique", text)
        self.assertIn("criteres", text)

    def test_html_disguised_as_doc_is_extracted_without_libreoffice(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake_doc = Path(tmp) / "report.doc"
            fake_doc.write_bytes(
                b"<html><head><style>body{color:red}</style></head>"
                b"<body><p>Cahier des charges synthetique</p><script>evil()</script></body></html>"
            )
            counters = DiscoveryCounters()
            with patch.object(inspector_module, "resolve_libreoffice_binary") as mock_resolve:
                text = inspector_module.extract_doc_text(fake_doc, counters)
            mock_resolve.assert_not_called()
        self.assertIn("Cahier des charges synthetique", text)
        self.assertNotIn("evil()", text)  # script content is never extracted as text

    def test_docx_disguised_as_doc_is_extracted_without_libreoffice(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake_doc = Path(tmp) / "report.doc"
            write_synthetic_docx(fake_doc, ["Cahier des charges synthetique"])
            counters = DiscoveryCounters()
            with patch.object(inspector_module, "resolve_libreoffice_binary") as mock_resolve:
                text = inspector_module.extract_doc_text(fake_doc, counters)
            mock_resolve.assert_not_called()
        self.assertIn("Cahier des charges synthetique", text)

    def test_xml_disguised_as_doc_raises_source_format_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake_doc = Path(tmp) / "report.doc"
            fake_doc.write_bytes(b"<?xml version=\"1.0\"?><wordDocument>synthetic</wordDocument>")
            counters = DiscoveryCounters()
            with patch.object(inspector_module, "resolve_libreoffice_binary") as mock_resolve:
                with self.assertRaises(inspector_module.ExtractionError) as ctx:
                    inspector_module.extract_doc_text(fake_doc, counters)
            mock_resolve.assert_not_called()
        self.assertEqual(ctx.exception.reason_code, "source_format_mismatch")

    def test_genuine_ole2_signature_falls_through_to_libreoffice(self):
        # A real OLE2 header (no encryption marker) must still take the
        # normal LibreOffice path - detection here never rejects a real .doc.
        with tempfile.TemporaryDirectory() as tmp:
            fake_doc = Path(tmp) / "report.doc"
            fake_doc.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 100)
            counters = DiscoveryCounters()
            with patch.object(
                inspector_module, "convert_doc_to_docx_via_libreoffice"
            ) as mock_convert:
                mock_convert.side_effect = inspector_module.ExtractionError("libreoffice_missing")
                with self.assertRaises(inspector_module.ExtractionError):
                    inspector_module.extract_doc_text(fake_doc, counters)
            mock_convert.assert_called_once()

    def test_unrecognized_signature_falls_through_to_libreoffice(self):
        # Backward compatibility: the existing SYNTHETIC_DOC_PATH fixture
        # (plain ASCII placeholder text) matches no known signature and
        # must still reach the LibreOffice path unchanged.
        counters = DiscoveryCounters()
        with patch.object(inspector_module, "convert_doc_to_docx_via_libreoffice") as mock_convert:
            mock_convert.side_effect = inspector_module.ExtractionError("libreoffice_missing")
            with self.assertRaises(inspector_module.ExtractionError):
                inspector_module.extract_doc_text(SYNTHETIC_DOC_PATH, counters)
        mock_convert.assert_called_once()

    def test_encrypted_ole2_marker_raises_before_libreoffice(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake_doc = Path(tmp) / "report.doc"
            fake_doc.write_bytes(
                b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 50
                + "EncryptedPackage".encode("utf-16-le") + b"\x00" * 50
            )
            counters = DiscoveryCounters()
            with patch.object(inspector_module, "resolve_libreoffice_binary") as mock_resolve:
                with self.assertRaises(inspector_module.ExtractionError) as ctx:
                    inspector_module.extract_doc_text(fake_doc, counters)
            mock_resolve.assert_not_called()
        self.assertEqual(ctx.exception.reason_code, "encrypted_or_protected")


class TestConvertDocRobustness(unittest.TestCase):
    """Synthetic-only unit tests for convert_doc_to_docx_via_libreoffice's
    hardened output detection/validation - subprocess.run is always
    mocked, never a real LibreOffice invocation."""

    def _fake_success(self):
        class FakeCompletedProcess:
            returncode = 0
            stdout = ""
            stderr = ""
        return FakeCompletedProcess()

    def test_output_detected_by_directory_scan_not_exact_stem(self):
        # LibreOffice is mocked as having "succeeded" without the code
        # assuming any particular output filename - it locates whatever
        # single .docx-suffixed file exists in the output directory.
        with patch.object(inspector_module, "resolve_libreoffice_binary", return_value="/usr/bin/soffice"), \
             patch.object(inspector_module.subprocess, "run", return_value=self._fake_success()):
            with tempfile.TemporaryDirectory() as tmp:
                output_dir = Path(tmp)
                unexpected_name = output_dir / "totally-different-name.DOCX"  # uppercase extension too
                write_synthetic_docx(unexpected_name, ["synthetic"])
                result = inspector_module.convert_doc_to_docx_via_libreoffice(
                    Path("source-with-a-different-stem.doc"), output_dir
                )
        self.assertEqual(result, unexpected_name)

    def test_zero_byte_output_raises_zero_bytes_reason(self):
        with patch.object(inspector_module, "resolve_libreoffice_binary", return_value="/usr/bin/soffice"), \
             patch.object(inspector_module.subprocess, "run", return_value=self._fake_success()):
            with tempfile.TemporaryDirectory() as tmp:
                output_dir = Path(tmp)
                (output_dir / "empty.docx").write_bytes(b"")
                with self.assertRaises(inspector_module.ExtractionError) as ctx:
                    inspector_module.convert_doc_to_docx_via_libreoffice(Path("source.doc"), output_dir)
        self.assertEqual(ctx.exception.reason_code, "libreoffice_output_zero_bytes")

    def test_invalid_zip_output_raises_invalid_docx_reason(self):
        with patch.object(inspector_module, "resolve_libreoffice_binary", return_value="/usr/bin/soffice"), \
             patch.object(inspector_module.subprocess, "run", return_value=self._fake_success()):
            with tempfile.TemporaryDirectory() as tmp:
                output_dir = Path(tmp)
                (output_dir / "garbage.docx").write_bytes(b"not a real zip file at all")
                with self.assertRaises(inspector_module.ExtractionError) as ctx:
                    inspector_module.convert_doc_to_docx_via_libreoffice(Path("source.doc"), output_dir)
        self.assertEqual(ctx.exception.reason_code, "libreoffice_output_invalid_docx")

    def test_valid_zip_missing_document_xml_raises_invalid_docx_reason(self):
        with patch.object(inspector_module, "resolve_libreoffice_binary", return_value="/usr/bin/soffice"), \
             patch.object(inspector_module.subprocess, "run", return_value=self._fake_success()):
            with tempfile.TemporaryDirectory() as tmp:
                output_dir = Path(tmp)
                bad_docx = output_dir / "no_body.docx"
                with zipfile.ZipFile(bad_docx, "w") as archive:
                    archive.writestr("unrelated.txt", "nothing useful")
                with self.assertRaises(inspector_module.ExtractionError) as ctx:
                    inspector_module.convert_doc_to_docx_via_libreoffice(Path("source.doc"), output_dir)
        self.assertEqual(ctx.exception.reason_code, "libreoffice_output_invalid_docx")

    def test_process_failure_captures_sanitized_diagnostic_without_raw_path(self):
        class FakeCompletedProcessFailure:
            returncode = 1
            stdout = "converting /mnt/concept-archives-readonly/SECRET/file.doc"
            stderr = "error opening /mnt/concept-archives-readonly/SECRET/file.doc"

        with patch.object(inspector_module, "resolve_libreoffice_binary", return_value="/usr/bin/soffice"), \
             patch.object(inspector_module.subprocess, "run", return_value=FakeCompletedProcessFailure()):
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaises(inspector_module.ExtractionError) as ctx:
                    inspector_module.convert_doc_to_docx_via_libreoffice(SYNTHETIC_DOC_PATH, Path(tmp))
        self.assertEqual(ctx.exception.reason_code, "libreoffice_process_failed")
        self.assertIsNotNone(ctx.exception.sanitized_diagnostic)
        self.assertNotIn("/mnt/concept-archives-readonly", ctx.exception.sanitized_diagnostic)
        self.assertNotIn("SECRET", ctx.exception.sanitized_diagnostic)
        self.assertIn("[REDACTED_PATH]", ctx.exception.sanitized_diagnostic)

    def test_two_calls_use_distinct_profile_directories(self):
        captured_commands = []

        def fake_run(cmd, **kwargs):
            captured_commands.append(cmd)
            return self._fake_success()

        with patch.object(inspector_module, "resolve_libreoffice_binary", return_value="/usr/bin/soffice"), \
             patch.object(inspector_module.subprocess, "run", side_effect=fake_run):
            with tempfile.TemporaryDirectory() as tmp1, tempfile.TemporaryDirectory() as tmp2:
                write_synthetic_docx(Path(tmp1) / "a.docx", ["x"])
                write_synthetic_docx(Path(tmp2) / "b.docx", ["x"])
                inspector_module.convert_doc_to_docx_via_libreoffice(Path("source1.doc"), Path(tmp1))
                inspector_module.convert_doc_to_docx_via_libreoffice(Path("source2.doc"), Path(tmp2))

        profile_args = [
            arg for cmd in captured_commands for arg in cmd if arg.startswith("-env:UserInstallation=")
        ]
        self.assertEqual(len(profile_args), 2)
        self.assertNotEqual(profile_args[0], profile_args[1])


class TestExtractDocTextCleanup(unittest.TestCase):
    def test_temp_directory_is_removed_after_success(self):
        captured_dirs = []

        def fake_converter(source: Path, output_dir: Path) -> Path:
            captured_dirs.append(output_dir)
            docx_path = output_dir / "converted.docx"
            write_synthetic_docx(docx_path, [SYNTHETIC_CDC_TEXT])
            return docx_path

        with patch.object(inspector_module, "convert_doc_to_docx_via_libreoffice", side_effect=fake_converter):
            counters = DiscoveryCounters()
            inspector_module.extract_doc_text(SYNTHETIC_DOC_PATH, counters)
        self.assertFalse(captured_dirs[0].exists())

    def test_temp_directory_is_removed_after_failure(self):
        captured_dirs = []

        def fake_converter(source: Path, output_dir: Path) -> Path:
            captured_dirs.append(output_dir)
            raise inspector_module.ExtractionError("libreoffice_process_failed")

        with patch.object(inspector_module, "convert_doc_to_docx_via_libreoffice", side_effect=fake_converter):
            counters = DiscoveryCounters()
            with self.assertRaises(inspector_module.ExtractionError):
                inspector_module.extract_doc_text(SYNTHETIC_DOC_PATH, counters)
        self.assertFalse(captured_dirs[0].exists())


def _write_synthetic_docx_with_parts(
    path: Path, body_paragraphs: list[str], extra_parts: Optional[dict] = None
) -> None:
    """Like write_synthetic_docx, but can also add header/footer/footnote/
    endnote XML parts (Phase 4 - these are real, separate zip members in a
    genuine DOCX, never reachable from word/document.xml alone)."""
    body = "".join(f"<w:p><w:r><w:t>{escape(text)}</w:t></w:r></w:p>" for text in body_paragraphs)
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body>"
        "</w:document>"
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", document_xml)
        for part_name, paragraphs in (extra_parts or {}).items():
            if paragraphs is None:
                archive.writestr(part_name, "not valid xml <<<")
                continue
            part_body = "".join(f"<w:p><w:r><w:t>{escape(text)}</w:t></w:r></w:p>" for text in paragraphs)
            part_xml = (
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                f"{part_body}</w:root>"
            )
            archive.writestr(part_name, part_xml)


def _write_synthetic_docx_with_table(path: Path, cell_texts: list[str]) -> None:
    cells = "".join(
        f"<w:tc><w:p><w:r><w:t>{escape(text)}</w:t></w:r></w:p></w:tc>" for text in cell_texts
    )
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body><w:tbl><w:tr>{cells}</w:tr></w:tbl></w:body>"
        "</w:document>"
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", document_xml)


class TestReadDocxTextAdditionalParts(unittest.TestCase):
    """Phase 4: verifies _read_docx_text (shared by native .docx and
    LibreOffice-converted .doc alike) reads tables, headers, footers,
    footnotes and endnotes - not just the plain body paragraphs."""

    def test_table_cell_text_is_extracted(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "table.docx"
            _write_synthetic_docx_with_table(path, ["Cahier des charges", "Termes de reference"])
            counters = DiscoveryCounters()
            text = inspector_module.extract_docx_text(path, counters)
        self.assertIn("Cahier des charges", text)
        self.assertIn("Termes de reference", text)

    def test_header_text_is_extracted(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "with_header.docx"
            _write_synthetic_docx_with_parts(
                path, ["corps du document"], {"word/header1.xml": ["texte den-tete synthetique"]}
            )
            counters = DiscoveryCounters()
            text = inspector_module.extract_docx_text(path, counters)
        self.assertIn("texte den-tete synthetique", text)
        self.assertIn("corps du document", text)

    def test_footer_text_is_extracted(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "with_footer.docx"
            _write_synthetic_docx_with_parts(
                path, ["corps du document"], {"word/footer1.xml": ["texte de pied de page"]}
            )
            counters = DiscoveryCounters()
            text = inspector_module.extract_docx_text(path, counters)
        self.assertIn("texte de pied de page", text)

    def test_footnote_text_is_extracted(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "with_footnote.docx"
            _write_synthetic_docx_with_parts(
                path, ["corps du document"], {"word/footnotes.xml": ["texte de note de bas de page"]}
            )
            counters = DiscoveryCounters()
            text = inspector_module.extract_docx_text(path, counters)
        self.assertIn("texte de note de bas de page", text)

    def test_endnote_text_is_extracted(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "with_endnote.docx"
            _write_synthetic_docx_with_parts(
                path, ["corps du document"], {"word/endnotes.xml": ["texte de note de fin"]}
            )
            counters = DiscoveryCounters()
            text = inspector_module.extract_docx_text(path, counters)
        self.assertIn("texte de note de fin", text)

    def test_malformed_extra_part_does_not_fail_the_whole_extraction(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "with_bad_header.docx"
            _write_synthetic_docx_with_parts(
                path, ["corps du document valide"], {"word/header1.xml": None}
            )
            counters = DiscoveryCounters()
            text = inspector_module.extract_docx_text(path, counters)
        self.assertIn("corps du document valide", text)

    def test_multiple_headers_and_footers_read_in_deterministic_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "multi.docx"
            _write_synthetic_docx_with_parts(
                path, ["corps"],
                {
                    "word/header2.xml": ["entete-deux"],
                    "word/header1.xml": ["entete-un"],
                    "word/footer1.xml": ["pied-un"],
                },
            )
            counters = DiscoveryCounters()
            text_a = inspector_module.extract_docx_text(path, counters)
            text_b = inspector_module.extract_docx_text(path, DiscoveryCounters())
        self.assertEqual(text_a, text_b)  # deterministic across reruns
        self.assertLess(text_a.index("entete-un"), text_a.index("entete-deux"))  # sorted by part name

    def test_char_limit_is_applied_once_to_the_combined_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "long.docx"
            _write_synthetic_docx_with_parts(
                path, ["a" * 30], {"word/header1.xml": ["b" * 30]}
            )
            counters = DiscoveryCounters()
            text = inspector_module.extract_docx_text(path, counters, char_limit=10)
        self.assertEqual(len(text), 10)


class TestRealLibreOfficeDocIntegration(unittest.TestCase):
    @unittest.skipUnless(_real_libreoffice_available(), "local LibreOffice (libreoffice/soffice) not available")
    def test_real_libreoffice_extracts_synthetic_cdc_doc_end_to_end(self):
        # 1. A genuinely synthetic plain-text document with invented
        #    CDC-like content - never taken from the archive.
        # 2. Converted to legacy .doc using REAL local LibreOffice headless
        #    conversion (this is itself the synthetic-doc-creation step
        #    Task 7 allows).
        # 3. Run through the REAL new DOC extraction pipeline (no mocking)
        #    end to end via LocalContentInspector.
        synthetic_content = (
            "CAHIER DES CHARGES\n"
            "Mission fictive\n"
            "Prestations demandees\n"
            "Criteres de consultation\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            source_dir = Path(tmp) / "source"
            source_dir.mkdir()
            txt_path = source_dir / "synthetic_cdc_smoke_test.txt"
            txt_path.write_text(synthetic_content, encoding="utf-8")

            binary = inspector_module.resolve_libreoffice_binary()
            profile_dir = Path(tmp) / "creation_profile"
            profile_dir.mkdir()
            completed = subprocess.run(
                [
                    binary, "--headless", "--invisible", "--nodefault", "--norestore", "--nolockcheck",
                    f"-env:UserInstallation=file://{profile_dir}",
                    "--convert-to", "doc",
                    "--outdir", str(source_dir),
                    str(txt_path),
                ],
                check=False, capture_output=True, text=True, timeout=60,
            )
            self.assertEqual(completed.returncode, 0, "synthetic .doc fixture creation failed")
            doc_path = source_dir / "synthetic_cdc_smoke_test.doc"
            self.assertTrue(doc_path.exists(), "synthetic .doc fixture was not created")
            source_mtime_before = doc_path.stat().st_mtime

            counters = DiscoveryCounters()
            local_inspector = inspector_module.LocalContentInspector()  # real converter, no injection
            outcome = local_inspector.inspect(1, "doc", counters, file_path=doc_path)

            # Source file must be untouched by the extraction pipeline
            # itself (read-only safety - Task 3/Task 8).
            self.assertTrue(doc_path.exists())
            self.assertEqual(doc_path.stat().st_mtime, source_mtime_before)

        self.assertEqual(counters.doc_extraction_calls, 1)
        self.assertEqual(counters.doc_extraction_successes, 1)
        self.assertEqual(counters.doc_extraction_failures, 0)
        self.assertEqual(counters.files_content_inspected, 1)
        self.assertEqual(counters.external_calls, 0)
        self.assertTrue(outcome.attempted)
        self.assertFalse(outcome.failed)
        # The synthetic content is CDC-like by construction, so the
        # rule-based stage should recognize it - proving text genuinely
        # reached the verification stage, not just "conversion didn't crash".
        self.assertTrue(outcome.verified_as_cdc or outcome.document_role == "CDC")

    @unittest.skipUnless(_real_libreoffice_available(), "local LibreOffice (libreoffice/soffice) not available")
    def test_uppercase_doc_extension(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc_path = Path(tmp) / "SYNTHETIC_REPORT.DOC"
            _create_synthetic_doc_via_libreoffice(doc_path, "Rapport technique synthetique.")
            counters = DiscoveryCounters()
            text = inspector_module.extract_doc_text(doc_path, counters, char_limit=5000)
        self.assertIn("Rapport technique synthetique", text)
        self.assertEqual(counters.doc_extraction_calls, 1)

    @unittest.skipUnless(_real_libreoffice_available(), "local LibreOffice (libreoffice/soffice) not available")
    def test_filename_with_spaces(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc_path = Path(tmp) / "synthetic report with spaces.doc"
            _create_synthetic_doc_via_libreoffice(doc_path, "Cahier des charges synthetique avec espaces.")
            counters = DiscoveryCounters()
            text = inspector_module.extract_doc_text(doc_path, counters, char_limit=5000)
        self.assertIn("Cahier des charges synthetique avec espaces", text)

    @unittest.skipUnless(_real_libreoffice_available(), "local LibreOffice (libreoffice/soffice) not available")
    def test_filename_with_unicode_characters(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc_path = Path(tmp) / "synthetique_rapport_été_ünïcödé_文档.doc"
            _create_synthetic_doc_via_libreoffice(doc_path, "Termes de reference synthetiques unicode.")
            counters = DiscoveryCounters()
            text = inspector_module.extract_doc_text(doc_path, counters, char_limit=5000)
        self.assertIn("Termes de reference synthetiques unicode", text)

    @unittest.skipUnless(_real_libreoffice_available(), "local LibreOffice (libreoffice/soffice) not available")
    def test_empty_document_raises_extracted_text_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc_path = Path(tmp) / "synthetic_empty.doc"
            _create_synthetic_doc_via_libreoffice(doc_path, "")
            counters = DiscoveryCounters()
            with self.assertRaises(inspector_module.ExtractionError) as ctx:
                inspector_module.extract_doc_text(doc_path, counters)
        self.assertEqual(ctx.exception.reason_code, "extracted_text_empty")

    @unittest.skipUnless(_real_libreoffice_available(), "local LibreOffice (libreoffice/soffice) not available")
    def test_source_file_is_never_modified_on_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            doc_path = Path(tmp) / "synthetic_readonly_check.doc"
            _create_synthetic_doc_via_libreoffice(doc_path, "Contenu synthetique pour verification.")
            mtime_before = doc_path.stat().st_mtime
            size_before = doc_path.stat().st_size
            counters = DiscoveryCounters()
            inspector_module.extract_doc_text(doc_path, counters)
            self.assertEqual(doc_path.stat().st_mtime, mtime_before)
            self.assertEqual(doc_path.stat().st_size, size_before)

    @unittest.skipUnless(_real_libreoffice_available(), "local LibreOffice (libreoffice/soffice) not available")
    def test_corrupt_doc_fails_closed_to_a_known_category_never_crashes(self):
        # Garbage bytes named .doc: no recognizable signature (falls
        # through to the LibreOffice path, as designed), and LibreOffice
        # itself cannot make sense of it. Whatever happens, the pipeline
        # must fail closed to a KNOWN reason_code, never an unhandled
        # exception and never a silent "success" with fabricated text.
        with tempfile.TemporaryDirectory() as tmp:
            doc_path = Path(tmp) / "synthetic_corrupt.doc"
            doc_path.write_bytes(os.urandom(2048))
            counters = DiscoveryCounters()
            known_reason_codes = {
                "libreoffice_missing", "libreoffice_process_failed", "libreoffice_timeout",
                "libreoffice_output_missing", "libreoffice_output_zero_bytes",
                "libreoffice_output_invalid_docx", "extracted_text_empty",
                "docx_read_failed", "docx_xml_parse_failed",
            }
            try:
                inspector_module.extract_doc_text(doc_path, counters)
            except inspector_module.ExtractionError as error:
                self.assertIn(error.reason_code, known_reason_codes)


def _write_minimal_synthetic_pdf(path: Path, body_text: str) -> None:
    """Writes a minimal, real, valid single-page PDF containing body_text,
    using only the standard library (no reportlab/fpdf dependency). Good
    enough for Docling's text-layer extraction to read back the text."""
    lines = [line for line in body_text.strip().splitlines() if line.strip()]
    content_lines = ["BT", "/F1 12 Tf", "50 750 Td", "14 TL"]
    for line in lines:
        escaped = line.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
        content_lines.append(f"({escaped}) Tj T*")
    content_lines.append("ET")
    content_stream = "\n".join(content_lines).encode("latin-1", errors="replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(content_stream)).encode("ascii") + b" >>\nstream\n" + content_stream + b"\nendstream",
    ]

    buffer = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, body in enumerate(objects, start=1):
        offsets.append(len(buffer))
        buffer += f"{index} 0 obj\n".encode("ascii") + body + b"\nendobj\n"

    xref_offset = len(buffer)
    buffer += f"xref\n0 {len(objects) + 1}\n".encode("ascii")
    buffer += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        buffer += f"{offset:010d} 00000 n \n".encode("ascii")
    buffer += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF".encode("ascii")
    )

    path.write_bytes(bytes(buffer))


# =====================================================================
# Aggregate classification reason counters (Task 5/9) - synthetic text
# only, verifying only counts/reason-code enums are ever produced.
# =====================================================================

SYNTHETIC_WEAK_SIGNAL_TEXT = "Ce document synthetique mentionne une mission generale sans autre precision."


class TestClassificationReasonCounters(unittest.TestCase):
    def _inspect_with_text(self, text: str) -> tuple["cdc_discovery.ContentInspectionOutcome", DiscoveryCounters]:
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=text)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        return outcome, counters

    def test_strong_cdc_content_tallies_role_cdc_confirmed_and_strong_evidence(self):
        outcome, counters = self._inspect_with_text(SYNTHETIC_CDC_TEXT)
        self.assertTrue(outcome.verified_as_cdc)
        self.assertEqual(counters.content_role_cdc, 1)
        self.assertEqual(counters.content_confirmed_cdc, 1)
        self.assertEqual(counters.evidence_strong, 1)
        self.assertEqual(counters.evidence_medium, 0)
        self.assertEqual(counters.evidence_weak, 0)

    def test_dao_content_tallies_role_dao_and_ambiguous(self):
        outcome, counters = self._inspect_with_text(SYNTHETIC_DAO_TEXT)
        self.assertFalse(outcome.verified_as_cdc)
        self.assertEqual(counters.content_role_dao, 1)
        self.assertEqual(counters.content_ambiguous, 1)
        self.assertEqual(counters.content_confirmed_cdc, 0)

    def test_tdr_content_tallies_role_tdr_and_ambiguous(self):
        outcome, counters = self._inspect_with_text(SYNTHETIC_TDR_TEXT)
        self.assertFalse(outcome.verified_as_cdc)
        self.assertEqual(counters.content_role_tdr, 1)
        self.assertEqual(counters.content_ambiguous, 1)

    def test_unrelated_technical_offer_tallies_role_unknown_and_not_cdc(self):
        outcome, counters = self._inspect_with_text(SYNTHETIC_UNRELATED_TEXT)
        self.assertFalse(outcome.verified_as_cdc)
        self.assertTrue(outcome.verified_not_cdc)
        self.assertEqual(counters.content_role_unknown, 1)
        self.assertEqual(counters.content_not_cdc, 1)
        self.assertEqual(counters.evidence_weak, 1)

    def test_ambiguous_weak_signal_document_tallies_insufficient_signals(self):
        outcome, counters = self._inspect_with_text(SYNTHETIC_WEAK_SIGNAL_TEXT)
        self.assertFalse(outcome.verified_as_cdc)
        self.assertFalse(outcome.verified_not_cdc)
        self.assertEqual(counters.content_role_unknown, 1)
        self.assertEqual(counters.content_insufficient_signals, 1)
        self.assertEqual(counters.evidence_weak, 1)

    def test_extraction_failure_tallies_content_extraction_failed_only(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(raise_error=True)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)

        self.assertEqual(counters.content_extraction_failed, 1)
        # A failed extraction never produced evidence to characterize.
        self.assertEqual(counters.content_confirmed_cdc, 0)
        self.assertEqual(counters.content_not_cdc, 0)
        self.assertEqual(counters.content_ambiguous, 0)
        self.assertEqual(counters.content_insufficient_signals, 0)
        self.assertEqual(counters.evidence_strong, 0)
        self.assertEqual(counters.evidence_medium, 0)
        self.assertEqual(counters.evidence_weak, 0)
        self.assertEqual(counters.content_role_cdc, 0)
        self.assertEqual(counters.content_role_unknown, 0)

    def test_reason_counters_are_aggregate_only_no_raw_text(self):
        # Sanity check that the counters dict produced for a report is
        # entirely numeric - the actual "no filenames/paths" guarantee is
        # exercised by test_no_raw_content_is_ever_printed elsewhere, this
        # specifically checks the classification-reason keys themselves.
        outcome, counters = self._inspect_with_text(SYNTHETIC_CDC_TEXT)
        as_dict = counters.as_dict()
        for key in (
            "content_role_cdc", "content_role_dao", "content_role_tdr", "content_role_dce", "content_role_rfp",
            "content_role_unknown", "content_confirmed_cdc", "content_insufficient_signals", "content_ambiguous",
            "content_not_cdc", "content_extraction_failed", "evidence_strong", "evidence_medium", "evidence_weak",
        ):
            self.assertIn(key, as_dict)
            self.assertIsInstance(as_dict[key], int)


# =====================================================================
# Structural validation (--validate-single-confirmed second pass,
# Task 5/6/7/10/11)
# =====================================================================

STRUCTURAL_STRONG_CDC_TEXT = """
CAHIER DES CHARGES

1. Objet de la mission
Le present document decrit l'objet de la mission confiee au consultant
dans le cadre de cette consultation synthetique de test. Les prestations
demandees dans le cadre de cette mission sont detaillees ci-apres.

2. Specifications techniques
Les specifications techniques attendues sont detaillees ci-dessous de
maniere exhaustive pour ce document synthetique de test.

3. Livrables
La liste des livrables attendus est precisee dans cette section du
document synthetique de test.

4. Obligations du consultant
Les obligations du consultant sont definies avec precision dans ce
chapitre du document synthetique de test.

5. Pieces administratives
Les pieces administratives requises pour la soumission sont listees ici,
dans ce document synthetique de test.
"""

STRUCTURAL_DAO_ONLY_TEXT = """
DOSSIER D'APPEL D'OFFRES

Ce dossier d'appel d'offres synthetique concerne une consultation fictive
portant sur la fourniture de services generiques dans un cadre standard.
Aucune clause additionnelle ne figure dans cet extrait de test synthetique
qui sert uniquement a valider un scenario de rejet conservateur pour ce
document synthetique de test.
"""

SYNTHETIC_SHORT_TEXT = "Un court extrait synthetique."


class TestBuildStructuralCdcEvidence(unittest.TestCase):
    def test_short_text_yields_all_unknown(self):
        evidence = inspector_module.build_structural_cdc_evidence(SYNTHETIC_SHORT_TEXT)
        self.assertTrue(len(SYNTHETIC_SHORT_TEXT) < inspector_module.MIN_TEXT_LENGTH_FOR_STRUCTURAL_ANALYSIS)
        for value in evidence.values():
            self.assertEqual(value, "UNKNOWN")

    def test_strong_cdc_text_yields_expected_flags(self):
        evidence = inspector_module.build_structural_cdc_evidence(STRUCTURAL_STRONG_CDC_TEXT)
        self.assertEqual(evidence["explicit_cdc_role"], "YES")
        self.assertEqual(evidence["scope_requirements"], "YES")
        self.assertEqual(evidence["technical_requirements"], "YES")
        self.assertEqual(evidence["deliverables"], "YES")
        self.assertEqual(evidence["bidder_obligations"], "YES")
        self.assertEqual(evidence["administrative_requirements"], "YES")
        for conflicting_key in ("possible_dao", "possible_tdr", "possible_dce", "possible_rfp", "possible_offer"):
            self.assertEqual(evidence[conflicting_key], "NO")

    def test_dao_only_text_yields_conflicting_role_and_no_structural_signals(self):
        evidence = inspector_module.build_structural_cdc_evidence(STRUCTURAL_DAO_ONLY_TEXT)
        self.assertEqual(evidence["explicit_cdc_role"], "NO")
        self.assertEqual(evidence["possible_dao"], "YES")
        for structural_key in (
            "scope_requirements", "technical_requirements", "deliverables",
            "bidder_obligations", "evaluation_requirements", "administrative_requirements",
        ):
            self.assertEqual(evidence[structural_key], "NO")

    def test_evidence_values_are_always_yes_no_or_unknown(self):
        for text in (STRUCTURAL_STRONG_CDC_TEXT, STRUCTURAL_DAO_ONLY_TEXT, SYNTHETIC_CDC_TEXT, SYNTHETIC_UNRELATED_TEXT):
            evidence = inspector_module.build_structural_cdc_evidence(text)
            for value in evidence.values():
                self.assertIn(value, ("YES", "NO", "UNKNOWN"))


class TestDecideStructuralValidation(unittest.TestCase):
    def test_strong_evidence_is_validated(self):
        evidence = inspector_module.build_structural_cdc_evidence(STRUCTURAL_STRONG_CDC_TEXT)
        self.assertEqual(inspector_module.decide_structural_validation(evidence), "VALIDATED_CDC")

    def test_dao_only_evidence_is_rejected(self):
        evidence = inspector_module.build_structural_cdc_evidence(STRUCTURAL_DAO_ONLY_TEXT)
        self.assertEqual(inspector_module.decide_structural_validation(evidence), "REJECTED_NOT_CDC")

    def test_mixed_cdc_and_tdr_signals_need_human_review(self):
        # SYNTHETIC_CDC_TEXT contains both "cahier des charges" AND a
        # "termes de reference" heading - genuinely ambiguous, must never
        # be auto-validated.
        evidence = inspector_module.build_structural_cdc_evidence(SYNTHETIC_CDC_TEXT)
        self.assertEqual(inspector_module.decide_structural_validation(evidence), "NEEDS_HUMAN_REVIEW")

    def test_too_short_for_analysis_needs_human_review(self):
        evidence = inspector_module.build_structural_cdc_evidence(SYNTHETIC_SHORT_TEXT)
        self.assertEqual(inspector_module.decide_structural_validation(evidence), "NEEDS_HUMAN_REVIEW")

    def test_never_weakens_below_conservative_thresholds(self):
        # Two structural YES flags plus explicit_cdc_role YES is not enough
        # on its own (threshold is >= 3) - must stay NEEDS_HUMAN_REVIEW,
        # never VALIDATED_CDC.
        evidence = {
            "explicit_cdc_role": "YES", "scope_requirements": "YES", "technical_requirements": "YES",
            "deliverables": "NO", "bidder_obligations": "NO", "evaluation_requirements": "NO",
            "administrative_requirements": "NO", "possible_dao": "NO", "possible_tdr": "NO",
            "possible_dce": "NO", "possible_rfp": "NO", "possible_offer": "NO",
        }
        self.assertEqual(inspector_module.decide_structural_validation(evidence), "NEEDS_HUMAN_REVIEW")


class TestLocalContentInspectorStructuralValidationWiring(unittest.TestCase):
    def test_confirmed_cdc_outcome_carries_structural_validation(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=STRUCTURAL_STRONG_CDC_TEXT)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertTrue(outcome.verified_as_cdc)
        self.assertIsNotNone(outcome.structural_validation)
        self.assertEqual(outcome.structural_validation["validation_result"], "VALIDATED_CDC")

    def test_non_confirmed_outcome_never_carries_structural_validation(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_UNRELATED_TEXT)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertFalse(outcome.verified_as_cdc)
        self.assertIsNone(outcome.structural_validation)


class TestNoConfidentialLeakInStructuralValidation(unittest.TestCase):
    """Task 11: obvious confidential markers in the path and in the
    extracted text must never appear anywhere in what LocalContentInspector
    returns - not in the outcome's own fields, not inside
    structural_validation's values."""

    def test_secret_path_and_text_markers_never_appear_in_outcome(self):
        secret_dir = Path(tempfile.mkdtemp(prefix="SECRET_CLIENT_PROJECT-"))
        try:
            secret_path = secret_dir / "confidential-cdc.pdf"
            secret_path.write_bytes(b"%PDF-synthetic-placeholder")

            secret_text = STRUCTURAL_STRONG_CDC_TEXT + "\nSECRET_CLIENT_NAME_123\n"
            counters = DiscoveryCounters()
            converter = FakeDoclingConverter(text=secret_text)
            local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
            outcome = local_inspector.inspect(1, "pdf", counters, file_path=secret_path)

            self.assertTrue(outcome.verified_as_cdc)
            self.assertIsNotNone(outcome.structural_validation)

            serialized = repr(outcome) + repr(outcome.structural_validation) + repr(counters.as_dict())
            self.assertNotIn("SECRET_CLIENT_NAME_123", serialized)
            self.assertNotIn("SECRET_CLIENT_PROJECT", serialized)
            self.assertNotIn("confidential-cdc.pdf", serialized)
            self.assertNotIn(str(secret_path), serialized)
            for value in outcome.structural_validation.values():
                self.assertIn(value, ("YES", "NO", "UNKNOWN", "VALIDATED_CDC", "REJECTED_NOT_CDC", "NEEDS_HUMAN_REVIEW"))
        finally:
            import shutil

            shutil.rmtree(secret_dir, ignore_errors=True)


# =====================================================================
# Full-corpus technical-source taxonomy wiring (Phase 5) - LocalContentInspector
# populates technical_source_classification for EVERY successfully-extracted
# document, independent of the narrower CDC-only verified_as_cdc outcome.
# =====================================================================


class TestTechnicalSourceClassificationWiring(unittest.TestCase):
    def test_populated_for_every_successful_extraction_not_just_cdc(self):
        # SYNTHETIC_DAO_TEXT never verifies as CDC (see
        # TestLocalContentInspectorEndToEnd.test_dao_content_keeps_dao_role)
        # but content was still successfully extracted and analyzed - the
        # taxonomy classification must be populated regardless.
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_DAO_TEXT)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertFalse(outcome.verified_as_cdc)
        self.assertIsNotNone(outcome.technical_source_classification)
        self.assertIn(outcome.technical_source_classification["detected_role"], (
            "DAO", "DAO_WITH_TDR", "DAO_WITH_CDC",
        ))

    def test_not_populated_when_extraction_fails(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(raise_error=True)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        self.assertTrue(outcome.failed)
        self.assertIsNone(outcome.technical_source_classification)

    def test_classification_is_a_flat_dict_of_short_safe_values(self):
        counters = DiscoveryCounters()
        converter = FakeDoclingConverter(text=SYNTHETIC_CDC_TEXT)
        local_inspector = inspector_module.LocalContentInspector(pdf_converter=converter)
        outcome = local_inspector.inspect(1, "pdf", counters, file_path=SYNTHETIC_PDF_PATH)
        classification = outcome.technical_source_classification
        self.assertIsInstance(classification, dict)
        self.assertLessEqual(len(classification["detected_role"]), 20)
        for key in ("has_context_section", "has_objectives_section", "has_tdr_section", "has_cdc_section"):
            self.assertIsInstance(classification[key], bool)


if __name__ == "__main__":
    unittest.main()
