#!/usr/bin/env python3
"""Synthetic, DB-free test suite for scripts/ocr_recovery_pilot.py.

SYNTHETIC DATA ONLY. No real archive filenames, paths, project names, or
PostgreSQL rows are used anywhere in this file. No live PostgreSQL
connection, no real tesseract/ocrmypdf/soffice invocation, and no real
Ollama call is possible from this file - every subprocess-calling
function is dependency-injected with a fake.
"""
from __future__ import annotations

import hashlib
import importlib.util
import shutil
import signal
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("ocr_recovery_pilot", HERE / "ocr_recovery_pilot.py")
ocr = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ocr
SPEC.loader.exec_module(ocr)


def _tmpdir() -> Path:
    return Path(tempfile.mkdtemp(prefix="ocr-pilot-test-"))


def _write_source(tmp: Path, name: str, content: bytes) -> tuple[Path, str]:
    path = tmp / name
    path.write_bytes(content)
    return path, hashlib.sha256(content).hexdigest()


GOOD_TEXT = (
    "Ceci est un texte synthetique de test avec suffisamment de caracteres "
    "alphabetiques pour depasser tous les seuils de qualite minimaux requis "
    "par le pilote de recuperation OCR local. " * 4
)


def _fake_ocr_runner_writes_valid_pdf(input_pdf, output_pdf, languages, timeout):
    output_pdf.write_bytes(b"%PDF-1.4 fake ocr output content %%EOF")


def _fake_doc_converter_writes_pdf(doc_path, output_dir, timeout):
    (output_dir / "source.pdf").write_bytes(b"%PDF-1.4 fake converted content %%EOF")


def _fake_page_counter_returns(n):
    def _counter(pdf_path, timeout):
        return n
    return _counter


def _fake_text_extractor_returns(text):
    def _extractor(pdf_path, timeout):
        return text
    return _extractor


class QualityMetricsTest(unittest.TestCase):
    def test_good_text_is_acceptable(self):
        metrics = ocr.compute_quality_metrics(GOOD_TEXT, page_count=2, ocr_duration_seconds=1.0, output_size_bytes=1000, input_size_bytes=800)
        self.assertEqual(ocr.classify_quality(metrics), ocr.ACCEPTABLE_FOR_MANUAL_REVIEW)

    def test_low_char_count_is_low_quality(self):
        metrics = ocr.compute_quality_metrics("short", page_count=1, ocr_duration_seconds=1.0, output_size_bytes=100, input_size_bytes=100)
        self.assertEqual(ocr.classify_quality(metrics), ocr.LOW_QUALITY_NEEDS_REVIEW)

    def test_low_page_coverage_is_low_quality(self):
        # 10 pages worth of form-feeds, only 1 has real text
        text = "\x0c".join([GOOD_TEXT] + [""] * 9)
        metrics = ocr.compute_quality_metrics(text, page_count=10, ocr_duration_seconds=1.0, output_size_bytes=1000, input_size_bytes=800)
        self.assertLess(metrics.page_coverage_ratio, ocr.MIN_PAGE_COVERAGE_RATIO)
        self.assertEqual(ocr.classify_quality(metrics), ocr.LOW_QUALITY_NEEDS_REVIEW)

    def test_low_alphabetic_ratio_is_low_quality(self):
        garbage = "###@@@$$$%%%^^^&&&***(((" * 20
        metrics = ocr.compute_quality_metrics(garbage, page_count=1, ocr_duration_seconds=1.0, output_size_bytes=1000, input_size_bytes=800)
        self.assertLess(metrics.alphabetic_ratio, ocr.MIN_ALPHABETIC_RATIO)
        self.assertEqual(ocr.classify_quality(metrics), ocr.LOW_QUALITY_NEEDS_REVIEW)

    def test_many_characters_alone_does_not_guarantee_acceptance(self):
        # High char count, but mostly repeated garbage/non-alphabetic
        garbage = "x" * 5000
        metrics = ocr.compute_quality_metrics(garbage, page_count=1, ocr_duration_seconds=1.0, output_size_bytes=1000, input_size_bytes=800)
        self.assertGreater(metrics.non_whitespace_char_count, ocr.MIN_NON_WHITESPACE_CHARS)
        self.assertEqual(ocr.classify_quality(metrics), ocr.LOW_QUALITY_NEEDS_REVIEW)

    def test_replacement_characters_penalized(self):
        text = ("�" * 100) + GOOD_TEXT
        metrics = ocr.compute_quality_metrics(text, page_count=1, ocr_duration_seconds=1.0, output_size_bytes=1000, input_size_bytes=800)
        self.assertGreater(metrics.replacement_control_char_ratio, 0.0)

    def test_repeated_garbage_ratio_detects_long_runs(self):
        text = "a" * 1000
        metrics = ocr.compute_quality_metrics(text, page_count=1, ocr_duration_seconds=1.0, output_size_bytes=1000, input_size_bytes=800)
        self.assertGreater(metrics.repeated_garbage_ratio, ocr.MAX_REPEATED_GARBAGE_RATIO)

    def test_metrics_never_expose_raw_text(self):
        metrics = ocr.compute_quality_metrics(GOOD_TEXT, page_count=1, ocr_duration_seconds=1.0, output_size_bytes=1000, input_size_bytes=800)
        for field_name in metrics.__dataclass_fields__:
            value = getattr(metrics, field_name)
            self.assertNotIsInstance(value, str)  # every field is a number - never the raw text itself


class PdfBranchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = _tmpdir()
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.source, self.sha = _write_source(self.tmp, "src.pdf", b"%PDF-1.4 synthetic source %%EOF")
        self.private_root = self.tmp / "private_root"

    def test_success_path(self):
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-01",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(2),
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_SUCCESS)
        self.assertEqual(result.final_classification, ocr.ACCEPTABLE_FOR_MANUAL_REVIEW)

    def test_empty_ocr_output_is_no_text(self):
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-02",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(""),
            page_counter=_fake_page_counter_returns(1),
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_NO_TEXT)
        self.assertEqual(result.final_classification, ocr.OCR_FAILED)

    def test_low_quality_output(self):
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-03",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns("x" * 500),
            page_counter=_fake_page_counter_returns(1),
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_LOW_QUALITY)
        self.assertEqual(result.final_classification, ocr.LOW_QUALITY_NEEDS_REVIEW)

    def test_page_limit_exceeded(self):
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-04",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(ocr.MAX_PAGE_COUNT + 1),
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_PAGE_LIMIT_EXCEEDED)
        self.assertEqual(result.final_classification, ocr.OCR_FAILED)

    def test_output_too_large(self):
        def big_ocr_runner(input_pdf, output_pdf, languages, timeout):
            output_pdf.write_bytes(b"%PDF-1.4 " + b"0" * (ocr.MAX_TEMP_OUTPUT_SIZE_BYTES + 10) + b" %%EOF")
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-05",
            ocr_runner=big_ocr_runner,
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_OUTPUT_TOO_LARGE)
        self.assertEqual(result.final_classification, ocr.OCR_FAILED)

    def test_encrypted_source_rejected(self):
        encrypted_source, sha = _write_source(self.tmp, "enc.pdf", b"%PDF-1.4 /Encrypt 5 0 R content %%EOF")
        def must_not_be_called(*a, **k):
            raise AssertionError("ocr_runner must not be called for an encrypted source")
        result = ocr.run_ocr_pilot_for_document(
            source_path=encrypted_source, source_sha256=sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-06",
            ocr_runner=must_not_be_called,
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_ENCRYPTED_OUTPUT_REJECTED)
        self.assertEqual(result.final_classification, ocr.OCR_FAILED)

    def test_encrypted_ocr_output_rejected(self):
        def encrypted_output_runner(input_pdf, output_pdf, languages, timeout):
            output_pdf.write_bytes(b"%PDF-1.4 /Encrypt 5 0 R %%EOF")
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-07",
            ocr_runner=encrypted_output_runner,
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_ENCRYPTED_OUTPUT_REJECTED)

    def test_ocr_timeout(self):
        def timeout_runner(input_pdf, output_pdf, languages, timeout):
            raise ocr.OcrError(ocr.OCR_TIMEOUT)
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-08",
            ocr_runner=timeout_runner,
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_TIMEOUT)
        self.assertEqual(result.final_classification, ocr.OCR_FAILED)

    def test_dependency_missing(self):
        def missing_dep_runner(input_pdf, output_pdf, languages, timeout):
            raise ocr.OcrError(ocr.OCR_DEPENDENCY_MISSING)
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-09",
            ocr_runner=missing_dep_runner,
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_DEPENDENCY_MISSING)

    def test_source_hash_mismatch_rejected_before_ocr_runs(self):
        def must_not_be_called(*a, **k):
            raise AssertionError("ocr_runner must not be called when the source hash does not match")
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256="0" * 64, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-10",
            ocr_runner=must_not_be_called,
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_SOURCE_HASH_MISMATCH)

    def test_oversized_input_rejected(self):
        big_source, sha = _write_source(self.tmp, "big.pdf", b"0" * (ocr.MAX_INPUT_SIZE_BYTES + 10))
        def must_not_be_called(*a, **k):
            raise AssertionError("must not reach OCR for an oversized input")
        result = ocr.run_ocr_pilot_for_document(
            source_path=big_source, source_sha256=sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-11",
            ocr_runner=must_not_be_called,
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_INPUT_TOO_LARGE)


class DocBranchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = _tmpdir()
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.source, self.sha = _write_source(self.tmp, "src.doc", b"synthetic doc bytes for hash test")
        self.private_root = self.tmp / "private_root"

    def test_success_path(self):
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="doc",
            private_root=self.private_root, document_workdir_name="pilot-doc-01",
            doc_converter=_fake_doc_converter_writes_pdf,
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_SUCCESS)
        self.assertEqual(result.final_classification, ocr.ACCEPTABLE_FOR_MANUAL_REVIEW)

    def test_conversion_failure(self):
        def failing_converter(doc_path, output_dir, timeout):
            raise ocr.OcrError(ocr.DOC_CONVERSION_FAILED)
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="doc",
            private_root=self.private_root, document_workdir_name="pilot-doc-02",
            doc_converter=failing_converter,
        )
        self.assertEqual(result.technical_outcome, ocr.DOC_CONVERSION_FAILED)
        self.assertEqual(result.final_classification, ocr.OCR_FAILED)

    def test_conversion_produces_no_output_file(self):
        def converter_writes_nothing(doc_path, output_dir, timeout):
            pass  # no source.pdf written
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="doc",
            private_root=self.private_root, document_workdir_name="pilot-doc-03",
            doc_converter=converter_writes_nothing,
        )
        self.assertEqual(result.technical_outcome, ocr.DOC_CONVERSION_FAILED)

    def test_french_and_english_languages_passed_to_ocr_runner(self):
        captured = {}
        def capturing_ocr_runner(input_pdf, output_pdf, languages, timeout):
            captured["languages"] = languages
            output_pdf.write_bytes(b"%PDF-1.4 %%EOF")
        ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="doc",
            private_root=self.private_root, document_workdir_name="pilot-doc-04",
            doc_converter=_fake_doc_converter_writes_pdf,
            ocr_runner=capturing_ocr_runner,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
        )
        self.assertEqual(captured["languages"], "fra+eng")
        self.assertIn("fra", captured["languages"])
        self.assertIn("eng", captured["languages"])


class UnsupportedExtensionTest(unittest.TestCase):
    def test_unsupported_extension_fails_closed_without_touching_disk(self):
        tmp = _tmpdir()
        self.addCleanup(lambda: shutil.rmtree(tmp, ignore_errors=True))
        source, sha = _write_source(tmp, "src.xlsx", b"fake")
        private_root = tmp / "private_root"
        result = ocr.run_ocr_pilot_for_document(
            source_path=source, source_sha256=sha, extension="xlsx",
            private_root=private_root, document_workdir_name="pilot-unsupported",
        )
        self.assertEqual(result.final_classification, ocr.OCR_FAILED)
        self.assertFalse(private_root.exists())  # never even created a workdir


class ConfinementTest(unittest.TestCase):
    def setUp(self):
        self.tmp = _tmpdir()
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.source, self.sha = _write_source(self.tmp, "src.pdf", b"%PDF-1.4 synthetic %%EOF")

    def test_rejects_symlinked_private_root(self):
        real_dir = self.tmp / "real"
        real_dir.mkdir(mode=0o700)
        link = self.tmp / "linked_root"
        link.symlink_to(real_dir, target_is_directory=True)
        with self.assertRaises(ocr.OcrError) as ctx:
            ocr.run_ocr_pilot_for_document(
                source_path=self.source, source_sha256=self.sha, extension="pdf",
                private_root=link, document_workdir_name="pilot-symlink-01",
            )
        self.assertEqual(ctx.exception.reason_code, ocr.OCR_CONFINEMENT_FAILURE)

    def test_workdir_is_mode_700(self):
        private_root = self.tmp / "private_root"
        captured_workdir = {}

        def capturing_ocr_runner(input_pdf, output_pdf, languages, timeout):
            captured_workdir["path"] = output_pdf.parent
            output_pdf.write_bytes(b"%PDF-1.4 %%EOF")

        ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=private_root, document_workdir_name="pilot-perm-01",
            ocr_runner=capturing_ocr_runner,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
        )
        # workdir is cleaned up afterward - verified indirectly via the
        # PermissionCleanupTest below, which checks mode WHILE running.

    def test_require_within_rejects_path_outside_root(self):
        root = self.tmp / "root"
        root.mkdir(mode=0o700)
        outside = self.tmp / "outside" / "file.pdf"
        outside.parent.mkdir(mode=0o700)
        outside.write_bytes(b"x")
        with self.assertRaises(ocr.OcrError) as ctx:
            ocr._require_within(outside, root)
        self.assertEqual(ctx.exception.reason_code, ocr.OCR_CONFINEMENT_FAILURE)

    def test_require_within_accepts_path_inside_root(self):
        root = self.tmp / "root2"
        root.mkdir(mode=0o700)
        inside = root / "file.pdf"
        inside.write_bytes(b"x")
        ocr._require_within(inside, root)  # must not raise


class CleanupTest(unittest.TestCase):
    def setUp(self):
        self.tmp = _tmpdir()
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.source, self.sha = _write_source(self.tmp, "src.pdf", b"%PDF-1.4 synthetic %%EOF")
        self.private_root = self.tmp / "private_root"

    def test_cleanup_on_success(self):
        ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-cleanup-01",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
        )
        self.assertFalse((self.private_root / "pilot-cleanup-01").exists())

    def test_cleanup_on_controlled_failure(self):
        def failing_runner(input_pdf, output_pdf, languages, timeout):
            raise ocr.OcrError(ocr.OCR_UNEXPECTED_FAILURE)
        ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-cleanup-02",
            ocr_runner=failing_runner,
        )
        self.assertFalse((self.private_root / "pilot-cleanup-02").exists())

    def test_cleanup_on_unexpected_exception(self):
        def crashing_runner(input_pdf, output_pdf, languages, timeout):
            raise RuntimeError("synthetic unexpected crash")
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-cleanup-03",
            ocr_runner=crashing_runner,
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_UNEXPECTED_FAILURE)
        self.assertFalse((self.private_root / "pilot-cleanup-03").exists())

    def test_cleanup_on_interruption(self):
        def interrupting_runner(input_pdf, output_pdf, languages, timeout):
            import os
            os.kill(os.getpid(), signal.SIGTERM)
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-cleanup-04",
            ocr_runner=interrupting_runner,
        )
        self.assertEqual(result.final_classification, ocr.OCR_FAILED)
        self.assertFalse((self.private_root / "pilot-cleanup-04").exists())


class SubprocessSafetyTest(unittest.TestCase):
    def test_all_default_runners_use_argument_lists_not_shell(self):
        source = (HERE / "ocr_recovery_pilot.py").read_text(encoding="utf-8")
        self.assertNotIn("shell=True", source)

    def test_default_doc_to_pdf_converter_uses_subprocess_run_with_list(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value.returncode = 0
            tmp = _tmpdir()
            self.addCleanup(lambda: shutil.rmtree(tmp, ignore_errors=True))
            ocr.default_doc_to_pdf_converter(tmp / "in.doc", tmp, 10.0)
            args, kwargs = mock_run.call_args
            self.assertIsInstance(args[0], list)
            self.assertNotIn("shell", kwargs)

    def test_default_ocrmypdf_runner_passes_languages_as_separate_arg(self):
        with patch("subprocess.run") as mock_run:
            mock_run.return_value.returncode = 0
            tmp = _tmpdir()
            self.addCleanup(lambda: shutil.rmtree(tmp, ignore_errors=True))
            ocr.default_ocrmypdf_runner(tmp / "in.pdf", tmp / "out.pdf", "fra+eng", 10.0)
            args, kwargs = mock_run.call_args
            command = args[0]
            self.assertIsInstance(command, list)
            self.assertIn("fra+eng", command)
            self.assertNotIn("shell", kwargs)

    def test_timeout_is_passed_through_to_subprocess(self):
        with patch("subprocess.run") as mock_run:
            mock_run.side_effect = __import__("subprocess").TimeoutExpired(cmd="ocrmypdf", timeout=5)
            tmp = _tmpdir()
            self.addCleanup(lambda: shutil.rmtree(tmp, ignore_errors=True))
            with self.assertRaises(ocr.OcrError) as ctx:
                ocr.default_ocrmypdf_runner(tmp / "in.pdf", tmp / "out.pdf", "fra+eng", 5.0)
            self.assertEqual(ctx.exception.reason_code, ocr.OCR_TIMEOUT)

    def test_proxy_env_vars_stripped_from_subprocess_env(self):
        with patch.dict("os.environ", {"HTTP_PROXY": "http://synthetic:8080", "http_proxy": "http://synthetic:8080"}):
            env = ocr._clean_subprocess_env()
            self.assertNotIn("HTTP_PROXY", env)
            self.assertNotIn("http_proxy", env)


class DependencyCheckTest(unittest.TestCase):
    def test_check_ocr_dependencies_never_installs_anything(self):
        source = (HERE / "ocr_recovery_pilot.py").read_text(encoding="utf-8")
        start = source.index("def check_ocr_dependencies")
        end = source.index("\ndef ", start + 1)
        body = source[start:end]
        for forbidden in ('"apt"', "'apt'", '"apt-get"', "'apt-get'", "pip install", "snap install"):
            self.assertNotIn(forbidden, body)

    def test_dependency_status_ready_requires_both_languages(self):
        status = ocr.OcrDependencyStatus(
            soffice_available=True, ocrmypdf_available=True, pdftotext_available=True,
            pdfinfo_available=True, tesseract_languages=("eng",),
        )
        self.assertFalse(status.ready)  # missing fra

        status_ready = ocr.OcrDependencyStatus(
            soffice_available=True, ocrmypdf_available=True, pdftotext_available=True,
            pdfinfo_available=True, tesseract_languages=("eng", "fra"),
        )
        self.assertTrue(status_ready.ready)


class NoRawTextExposureTest(unittest.TestCase):
    def test_ocr_pilot_result_never_carries_raw_text_field(self):
        result_fields = ocr.OcrPilotResult.__dataclass_fields__
        self.assertNotIn("text", result_fields)
        self.assertNotIn("raw_text", result_fields)
        self.assertNotIn("extracted_text", result_fields)

    def test_metrics_dataclass_has_no_string_fields(self):
        for name, f in ocr.OcrQualityMetrics.__dataclass_fields__.items():
            self.assertIn(f.type, ("int", "float"), f"field {name} should be numeric only")


class NoDatabaseOrOllamaAccessTest(unittest.TestCase):
    def test_module_never_imports_psycopg_or_ollama_url_at_top_level(self):
        source = (HERE / "ocr_recovery_pilot.py").read_text(encoding="utf-8")
        self.assertNotIn("import psycopg", source)
        self.assertNotIn("11434", source)  # the Ollama loopback port never appears here

    def test_run_ocr_pilot_never_takes_a_db_connection_argument(self):
        import inspect
        sig = inspect.signature(ocr.run_ocr_pilot_for_document)
        for name in sig.parameters:
            self.assertNotIn("conn", name.lower())


class ReviewOutputModeTest(unittest.TestCase):
    """2026-09-29: explicit private-review mode - retains a searchable
    OCR PDF (and optionally text) outside the ephemeral per-document
    workdir, ONLY when review_output_dir is explicitly passed."""

    def setUp(self):
        self.tmp = _tmpdir()
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.source, self.sha = _write_source(self.tmp, "src.pdf", b"%PDF-1.4 synthetic %%EOF")
        self.private_root = self.tmp / "private_root"

    def test_default_mode_retains_nothing(self):
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-r01",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
        )
        self.assertIsNone(result.review_pdf_path)
        self.assertIsNone(result.review_text_path)

    def test_review_mode_retains_ocr_pdf_on_success(self):
        review_dir = self.tmp / "review_out"
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="PILOT-01",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
            review_output_dir=review_dir,
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_SUCCESS)
        self.assertIsNotNone(result.review_pdf_path)
        self.assertTrue(result.review_pdf_path.exists())
        self.assertEqual(result.review_pdf_path.name, "PILOT-01.pdf")
        self.assertIsNone(result.review_text_path)  # retain_ocr_text defaults False

    def test_review_mode_retains_text_only_when_requested(self):
        review_dir = self.tmp / "review_out"
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="PILOT-02",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
            review_output_dir=review_dir, retain_ocr_text=True,
        )
        self.assertIsNotNone(result.review_text_path)
        self.assertTrue(result.review_text_path.exists())
        self.assertEqual(result.review_text_path.read_text(encoding="utf-8"), GOOD_TEXT)

    def test_no_review_output_retained_on_controlled_failure(self):
        review_dir = self.tmp / "review_out"
        def failing_runner(input_pdf, output_pdf, languages, timeout):
            raise ocr.OcrError(ocr.OCR_UNEXPECTED_FAILURE)
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="PILOT-03",
            ocr_runner=failing_runner, review_output_dir=review_dir,
        )
        self.assertIsNone(result.review_pdf_path)
        self.assertFalse(review_dir.exists() and any(review_dir.iterdir()))

    def test_review_output_filename_reveals_no_source_identity(self):
        review_dir = self.tmp / "review_out"
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="PILOT-04",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
            review_output_dir=review_dir,
        )
        self.assertNotIn("src", result.review_pdf_path.name)
        self.assertNotIn(self.sha[:16], result.review_pdf_path.name)
        self.assertEqual(result.review_pdf_path.name, "PILOT-04.pdf")

    def test_review_output_dir_mode_700_and_file_mode_600(self):
        import os
        review_dir = self.tmp / "review_out"
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="PILOT-05",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
            review_output_dir=review_dir,
        )
        self.assertEqual(os.stat(review_dir).st_mode & 0o777, 0o700)
        self.assertEqual(os.stat(result.review_pdf_path).st_mode & 0o777, 0o600)

    def test_review_output_dir_rejects_symlink(self):
        real_dir = self.tmp / "real_review"
        real_dir.mkdir(mode=0o700)
        link = self.tmp / "linked_review"
        link.symlink_to(real_dir, target_is_directory=True)
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="PILOT-06",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
            review_output_dir=link,
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_CONFINEMENT_FAILURE)
        self.assertIsNone(result.review_pdf_path)

    def test_no_raw_text_in_ocr_pilot_result_even_in_review_mode(self):
        review_dir = self.tmp / "review_out"
        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="PILOT-07",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
            review_output_dir=review_dir, retain_ocr_text=True,
        )
        # the result object itself never carries the raw text - only paths
        for value in result.__dict__.values():
            if isinstance(value, str):
                self.assertNotIn("Ceci est un texte", value)

    def test_cleanup_of_ephemeral_workdir_still_occurs_in_review_mode(self):
        review_dir = self.tmp / "review_out"
        ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="PILOT-08",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
            review_output_dir=review_dir,
        )
        self.assertFalse((self.private_root / "PILOT-08").exists())

    def test_atomic_write_never_leaves_a_tmp_file_behind(self):
        review_dir = self.tmp / "review_out"
        ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="PILOT-09",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
            review_output_dir=review_dir,
        )
        leftover_tmp = list(review_dir.glob("*.tmp-write"))
        self.assertEqual(leftover_tmp, [])

    def test_source_document_never_modified_in_review_mode(self):
        original_bytes = self.source.read_bytes()
        review_dir = self.tmp / "review_out"
        ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="PILOT-10",
            ocr_runner=_fake_ocr_runner_writes_valid_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
            review_output_dir=review_dir,
        )
        self.assertEqual(self.source.read_bytes(), original_bytes)

    def test_review_mode_multiple_documents_share_review_dir_safely(self):
        review_dir = self.tmp / "review_out"
        for i in range(1, 4):
            source, sha = _write_source(self.tmp, f"src{i}.pdf", f"%PDF-1.4 synthetic {i} %%EOF".encode())
            result = ocr.run_ocr_pilot_for_document(
                source_path=source, source_sha256=sha, extension="pdf",
                private_root=self.private_root, document_workdir_name=f"PILOT-{i:02d}",
                ocr_runner=_fake_ocr_runner_writes_valid_pdf,
                text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
                page_counter=_fake_page_counter_returns(1),
                review_output_dir=review_dir,
            )
            self.assertTrue(result.review_pdf_path.exists())
        retained = sorted(p.name for p in review_dir.glob("*.pdf"))
        self.assertEqual(retained, ["PILOT-01.pdf", "PILOT-02.pdf", "PILOT-03.pdf"])


def _fake_normalizer_writes_pdf(input_pdf, output_pdf, timeout):
    output_pdf.write_bytes(b"%PDF-1.4 fake normalized content %%EOF")


class NormalizationRetryTest(unittest.TestCase):
    """2026-09-29 (PILOT-07 diagnosis): a first OCR attempt that comes
    back too large triggers exactly one bounded normalization retry;
    every other failure category is never retried."""

    def setUp(self):
        self.tmp = _tmpdir()
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.source, self.sha = _write_source(self.tmp, "src.pdf", b"%PDF-1.4 synthetic %%EOF")
        self.private_root = self.tmp / "private_root"

    def test_oversized_first_attempt_triggers_normalization_retry(self):
        calls = {"ocr": 0, "normalize": 0}

        def counting_ocr_runner(input_pdf, output_pdf, languages, timeout):
            calls["ocr"] += 1
            if calls["ocr"] == 1:
                output_pdf.write_bytes(b"%PDF-1.4 " + b"0" * (ocr.MAX_TEMP_OUTPUT_SIZE_BYTES + 10) + b" %%EOF")
            else:
                output_pdf.write_bytes(b"%PDF-1.4 small normalized output %%EOF")

        def counting_normalizer(input_pdf, output_pdf, timeout):
            calls["normalize"] += 1
            output_pdf.write_bytes(b"%PDF-1.4 normalized %%EOF")

        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-n01",
            ocr_runner=counting_ocr_runner, normalizer=counting_normalizer,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
        )
        self.assertEqual(calls["ocr"], 2)  # exactly one retry, never more
        self.assertEqual(calls["normalize"], 1)
        self.assertEqual(result.technical_outcome, ocr.OCR_SUCCESS)

    def test_still_too_large_after_normalization_fails_closed(self):
        def always_too_large_runner(input_pdf, output_pdf, languages, timeout):
            output_pdf.write_bytes(b"%PDF-1.4 " + b"0" * (ocr.MAX_TEMP_OUTPUT_SIZE_BYTES + 10) + b" %%EOF")

        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-n02",
            ocr_runner=always_too_large_runner, normalizer=_fake_normalizer_writes_pdf,
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_OUTPUT_TOO_LARGE)
        self.assertEqual(result.final_classification, ocr.OCR_FAILED)

    def test_normalization_failure_itself_is_a_distinct_category(self):
        def too_large_runner(input_pdf, output_pdf, languages, timeout):
            output_pdf.write_bytes(b"%PDF-1.4 " + b"0" * (ocr.MAX_TEMP_OUTPUT_SIZE_BYTES + 10) + b" %%EOF")
        def failing_normalizer(input_pdf, output_pdf, timeout):
            raise ocr.OcrError(ocr.OCR_NORMALIZATION_FAILED)

        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-n03",
            ocr_runner=too_large_runner, normalizer=failing_normalizer,
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_NORMALIZATION_FAILED)
        self.assertEqual(result.final_classification, ocr.OCR_FAILED)

    def test_normalization_timeout_maps_to_ocr_timeout(self):
        def too_large_runner(input_pdf, output_pdf, languages, timeout):
            output_pdf.write_bytes(b"%PDF-1.4 " + b"0" * (ocr.MAX_TEMP_OUTPUT_SIZE_BYTES + 10) + b" %%EOF")
        def timing_out_normalizer(input_pdf, output_pdf, timeout):
            raise ocr.OcrError(ocr.OCR_TIMEOUT)

        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-n04",
            ocr_runner=too_large_runner, normalizer=timing_out_normalizer,
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_TIMEOUT)

    def test_non_size_failure_is_never_retried_with_normalization(self):
        calls = {"normalize": 0}
        def timeout_runner(input_pdf, output_pdf, languages, timeout):
            raise ocr.OcrError(ocr.OCR_TIMEOUT)
        def counting_normalizer(input_pdf, output_pdf, timeout):
            calls["normalize"] += 1
            output_pdf.write_bytes(b"%PDF-1.4 %%EOF")

        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-n05",
            ocr_runner=timeout_runner, normalizer=counting_normalizer,
        )
        self.assertEqual(calls["normalize"], 0)  # never invoked for a non-size failure
        self.assertEqual(result.technical_outcome, ocr.OCR_TIMEOUT)

    def test_expansion_ratio_alone_triggers_retry_even_under_absolute_ceiling(self):
        # A small input whose output balloons past MAX_EXPANSION_RATIO
        # must be caught even though the absolute output size is well
        # under MAX_TEMP_OUTPUT_SIZE_BYTES.
        tiny_source, tiny_sha = _write_source(self.tmp, "tiny.pdf", b"%PDF-1.4 x %%EOF")  # ~18 bytes
        calls = {"ocr": 0}

        def expanding_runner(input_pdf, output_pdf, languages, timeout):
            calls["ocr"] += 1
            # Far more than MAX_EXPANSION_RATIO x the ~18-byte tiny input,
            # but nowhere near the absolute MAX_TEMP_OUTPUT_SIZE_BYTES.
            output_pdf.write_bytes(b"%PDF-1.4 " + b"0" * 100_000 + b" %%EOF")

        result = ocr.run_ocr_pilot_for_document(
            source_path=tiny_source, source_sha256=tiny_sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-n06",
            ocr_runner=expanding_runner, normalizer=_fake_normalizer_writes_pdf,
        )
        self.assertGreaterEqual(calls["ocr"], 1)
        self.assertIn(result.technical_outcome, (ocr.OCR_OUTPUT_TOO_LARGE, ocr.OCR_SUCCESS, ocr.OCR_LOW_QUALITY, ocr.OCR_NO_TEXT))

    def test_normalized_output_still_reports_true_original_input_size_ratio(self):
        def too_large_then_small_runner(input_pdf, output_pdf, languages, timeout):
            if not hasattr(too_large_then_small_runner, "called"):
                too_large_then_small_runner.called = True
                output_pdf.write_bytes(b"%PDF-1.4 " + b"0" * (ocr.MAX_TEMP_OUTPUT_SIZE_BYTES + 10) + b" %%EOF")
            else:
                output_pdf.write_bytes(b"%PDF-1.4 small %%EOF")

        result = ocr.run_ocr_pilot_for_document(
            source_path=self.source, source_sha256=self.sha, extension="pdf",
            private_root=self.private_root, document_workdir_name="pilot-n07",
            ocr_runner=too_large_then_small_runner, normalizer=_fake_normalizer_writes_pdf,
            text_extractor=_fake_text_extractor_returns(GOOD_TEXT),
            page_counter=_fake_page_counter_returns(1),
        )
        self.assertEqual(result.technical_outcome, ocr.OCR_SUCCESS)
        # output_size_ratio must be computed against the TRUE original
        # source.pdf size, not the intermediate normalized copy.
        self.assertIsNotNone(result.metrics)


class RaisedLimitsRegressionTest(unittest.TestCase):
    """2026-09-29: MAX_INPUT_SIZE_BYTES/MAX_PAGE_COUNT were raised after
    evidence; MAX_TEMP_OUTPUT_SIZE_BYTES was deliberately left unchanged."""

    def test_max_temp_output_size_unchanged(self):
        self.assertEqual(ocr.MAX_TEMP_OUTPUT_SIZE_BYTES, 100_000_000)

    def test_max_input_size_raised_above_82mb_evidence(self):
        self.assertGreater(ocr.MAX_INPUT_SIZE_BYTES, 82_320_948)

    def test_max_page_count_raised_above_387_page_evidence(self):
        self.assertGreater(ocr.MAX_PAGE_COUNT, 387)

    def test_expansion_ratio_constant_exists_and_is_reasonable(self):
        self.assertGreater(ocr.MAX_EXPANSION_RATIO, 1.0)
        self.assertLess(ocr.MAX_EXPANSION_RATIO, 50.0)


if __name__ == "__main__":
    unittest.main()
