#!/usr/bin/env python3
"""Synthetic test suite for cdc_pilot_extractor.py.

SYNTHETIC DATA ONLY. Every manifest entry, document, and Ollama response
in this file is invented (random UUIDs generated at test time, placeholder
hashes, generic synthetic document text such as "CAHIER DES CHARGES
synthetique"). No real archive filenames, paths, project names,
identifiers, or document content is used anywhere in this file. No
PostgreSQL connection, no DATABASE_URL/TEST_DATABASE_URL read, and no
Ollama/Docling/n8n/Qdrant call is ever made or possible from this test
file or the module it tests - every transport is a fake object injected
via cdc_pilot_extractor's own dependency-injection points
(SafeLocalSession(transport), session_factory, session=...).
"""
from __future__ import annotations

import importlib.util
import io
import json
import os
import stat
import sys
import tempfile
import unittest
import uuid
import zipfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent

# Load order matters, same convention as test_cdc_review_importer.py: the
# module under test does a plain `import cdc_candidate_extractor as
# base_extractor`, which is only safe to resolve to THIS SAME already-
# loaded instance if that module is pre-registered in sys.modules under
# its plain name before cdc_pilot_extractor.py is spec-loaded. Loading it
# twice under two different module identities would otherwise make
# isinstance/exception-identity checks across the two files silently fail.
BASE_SPEC = importlib.util.spec_from_file_location("cdc_candidate_extractor", HERE / "cdc_candidate_extractor.py")
base_extractor = importlib.util.module_from_spec(BASE_SPEC)
sys.modules[BASE_SPEC.name] = base_extractor
BASE_SPEC.loader.exec_module(base_extractor)

SPEC = importlib.util.spec_from_file_location("cdc_pilot_extractor", HERE / "cdc_pilot_extractor.py")
pilot = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pilot
SPEC.loader.exec_module(pilot)


# =====================================================================
# Fixtures
# =====================================================================


def write_synthetic_docx(path: Path, paragraphs: "list[str]") -> None:
    body = "".join(f"<w:p><w:r><w:t>{escape(text)}</w:t></w:r></w:p>" for text in paragraphs)
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", document_xml)


def valid_extraction_payload(source_hash: str = "a" * 64) -> dict:
    return {
        "document_id": "synthetic-doc-id", "source_hash": source_hash, "language": "fr", "document_role": "CDC",
        "identite": {
            "titre_officiel": None, "annee_lancement": None, "pays": None, "bailleur": None,
            "code_interne_concept": None,
        },
        "criteres": {key: {"statut": "Explicite"} for key in base_extractor.CRITERIA_KEYS},
        "signaux_structurels": {
            "role_cdc_explicite": True, "exigences_techniques": True, "exigences_perimetre": True,
            "livrables": True, "obligations_soumissionnaire": True, "criteres_evaluation": True,
            "exigences_administratives": True, "possible_dao": False, "possible_offre": False,
        },
        "verdict": "CONFIRMED_CDC", "confiance": 0.9,
    }


def make_manifest_entry(**overrides) -> pilot.PilotManifestEntry:
    defaults = dict(
        candidate_uuid=str(uuid.uuid4()), archive_file_id=1001, source_sha256="a" * 64,
        year=2022, extension="docx", processing_group="PRIORITAIRE_2020_2026",
        validation_status="HUMAN_VALIDATED_CDC", local_source_path="/tmp/does-not-need-to-exist.docx",
        selection_reason="synthetic selection reason",
    )
    defaults.update(overrides)
    return pilot.PilotManifestEntry(**defaults)


def make_five_valid_entries() -> "list[pilot.PilotManifestEntry]":
    return [
        make_manifest_entry(candidate_uuid=str(uuid.uuid4()), archive_file_id=2000 + i, source_sha256=f"{i}" * 64)
        for i in range(5)
    ]


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class FakeOllamaTransport:
    """response_text: a dict (JSON-encoded as the model's reply) or a raw
    string (used verbatim, to simulate a non-JSON reply)."""

    def __init__(self, response_text, status_code: int = 200):
        self.response_text = response_text
        self.status_code = status_code
        self.calls = 0

    def post(self, url, **kwargs):
        self.calls += 1
        raw = json.dumps(self.response_text) if isinstance(self.response_text, dict) else self.response_text
        return FakeResponse({"response": raw}, status_code=self.status_code)


class SequencedOllamaTransport:
    """Returns a different reply on each successive call - first_try vs
    after_repair scenarios."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = 0

    def post(self, url, **kwargs):
        self.calls += 1
        item = self.replies.pop(0)
        if isinstance(item, Exception):
            raise item
        raw = json.dumps(item) if isinstance(item, dict) else item
        return FakeResponse({"response": raw})


class DoclingAndOllamaTransport:
    """Full fake for process_pilot_entry's docling-submit/poll + ollama
    /api/generate, keyed by URL suffix."""

    def __init__(self, markdown: str, ollama_payload):
        self.markdown = markdown
        self.ollama_payload = ollama_payload
        self.post_calls: "list[str]" = []

    def post(self, url, **kwargs):
        self.post_calls.append(url)
        if url.endswith("/convert"):
            return FakeResponse({"status": "processing", "job_id": "job-synthetic"})
        if url.endswith("/api/generate"):
            raw = json.dumps(self.ollama_payload) if isinstance(self.ollama_payload, dict) else self.ollama_payload
            return FakeResponse({"response": raw})
        raise AssertionError(f"unexpected POST {url}")

    def get(self, url, **kwargs):
        return FakeResponse({"status": "completed", "markdown": self.markdown})


# =====================================================================
# Manifest structural validation
# =====================================================================


class TestManifestStructuralValidation(unittest.TestCase):
    def test_valid_five_entry_manifest_passes(self):
        errors = pilot.validate_manifest_structure(make_five_valid_entries())
        self.assertEqual(errors, [])

    def test_four_entries_rejected(self):
        errors = pilot.validate_manifest_structure(make_five_valid_entries()[:4])
        self.assertTrue(any("exactly 5" in error for error in errors))

    def test_six_entries_rejected(self):
        entries = make_five_valid_entries() + [make_manifest_entry(candidate_uuid=str(uuid.uuid4()), archive_file_id=9999, source_sha256="f" * 64)]
        errors = pilot.validate_manifest_structure(entries)
        self.assertTrue(any("exactly 5" in error for error in errors))

    def test_duplicate_candidate_uuid_rejected(self):
        entries = make_five_valid_entries()
        duplicated = make_manifest_entry(candidate_uuid=entries[0].candidate_uuid, archive_file_id=8888, source_sha256="b" * 64)
        errors = pilot.validate_manifest_structure(entries[:4] + [duplicated])
        self.assertTrue(any("duplicate candidate_uuid" in error for error in errors))

    def test_duplicate_archive_file_id_rejected(self):
        entries = make_five_valid_entries()
        duplicated = make_manifest_entry(candidate_uuid=str(uuid.uuid4()), archive_file_id=entries[0].archive_file_id, source_sha256="c" * 64)
        errors = pilot.validate_manifest_structure(entries[:4] + [duplicated])
        self.assertTrue(any("duplicate archive_file_id" in error for error in errors))

    def test_duplicate_source_sha256_rejected(self):
        entries = make_five_valid_entries()
        duplicated = make_manifest_entry(candidate_uuid=str(uuid.uuid4()), archive_file_id=7777, source_sha256=entries[0].source_sha256)
        errors = pilot.validate_manifest_structure(entries[:4] + [duplicated])
        self.assertTrue(any("duplicate source_sha256" in error for error in errors))

    def test_malformed_sha256_rejected(self):
        entries = make_five_valid_entries()
        entries[0] = make_manifest_entry(
            candidate_uuid=entries[0].candidate_uuid, archive_file_id=entries[0].archive_file_id,
            source_sha256="not-a-valid-hash",
        )
        errors = pilot.validate_manifest_structure(entries)
        self.assertTrue(any("source_sha256 is not a well-formed" in error for error in errors))

    def test_malformed_uuid_rejected(self):
        entries = make_five_valid_entries()
        entries[0] = make_manifest_entry(
            candidate_uuid="not-a-uuid", archive_file_id=entries[0].archive_file_id, source_sha256=entries[0].source_sha256,
        )
        errors = pilot.validate_manifest_structure(entries)
        self.assertTrue(any("candidate_uuid is not a well-formed UUID" in error for error in errors))

    def test_rejected_candidate_is_ineligible(self):
        entries = make_five_valid_entries()
        entries[0] = make_manifest_entry(
            candidate_uuid=entries[0].candidate_uuid, archive_file_id=entries[0].archive_file_id,
            source_sha256=entries[0].source_sha256, validation_status="HUMAN_REJECTED_CDC", processing_group="EXCLU",
        )
        errors = pilot.validate_manifest_structure(entries)
        self.assertTrue(any("rejected candidates are not eligible" in error for error in errors))

    def test_uncertain_candidate_is_ineligible(self):
        entries = make_five_valid_entries()
        entries[0] = make_manifest_entry(
            candidate_uuid=entries[0].candidate_uuid, archive_file_id=entries[0].archive_file_id,
            source_sha256=entries[0].source_sha256, validation_status="MACHINE_CLASSIFIED", processing_group="A_REVOIR",
        )
        errors = pilot.validate_manifest_structure(entries)
        self.assertTrue(any("uncertain/unreviewed candidates are not eligible" in error for error in errors))

    def test_candidate_outside_2020_2026_is_ineligible(self):
        entries = make_five_valid_entries()
        entries[0] = make_manifest_entry(
            candidate_uuid=entries[0].candidate_uuid, archive_file_id=entries[0].archive_file_id,
            source_sha256=entries[0].source_sha256, year=2015, processing_group="SECONDAIRE_AVANT_2020",
        )
        errors = pilot.validate_manifest_structure(entries)
        self.assertTrue(any("year must be between" in error for error in errors) or any("processing_group must be" in error for error in errors))

    def test_declared_processing_group_inconsistent_with_validation_status_year_is_rejected(self):
        entries = make_five_valid_entries()
        # Lies about the group: claims priority while year is out of range
        # (compute_processing_group would derive SECONDAIRE_AVANT_2020).
        entries[0] = make_manifest_entry(
            candidate_uuid=entries[0].candidate_uuid, archive_file_id=entries[0].archive_file_id,
            source_sha256=entries[0].source_sha256, year=2010, processing_group="PRIORITAIRE_2020_2026",
        )
        errors = pilot.validate_manifest_structure(entries)
        self.assertTrue(any("internally inconsistent" in error for error in errors))

    def test_unsupported_extension_rejected(self):
        entries = make_five_valid_entries()
        entries[0] = make_manifest_entry(
            candidate_uuid=entries[0].candidate_uuid, archive_file_id=entries[0].archive_file_id,
            source_sha256=entries[0].source_sha256, extension="xlsx",
        )
        errors = pilot.validate_manifest_structure(entries)
        self.assertTrue(any("extension" in error for error in errors))

    def test_empty_selection_reason_rejected(self):
        entries = make_five_valid_entries()
        entries[0] = make_manifest_entry(
            candidate_uuid=entries[0].candidate_uuid, archive_file_id=entries[0].archive_file_id,
            source_sha256=entries[0].source_sha256, selection_reason="   ",
        )
        errors = pilot.validate_manifest_structure(entries)
        self.assertTrue(any("selection_reason must not be empty" in error for error in errors))

    def test_empty_local_source_path_rejected(self):
        entries = make_five_valid_entries()
        entries[0] = make_manifest_entry(
            candidate_uuid=entries[0].candidate_uuid, archive_file_id=entries[0].archive_file_id,
            source_sha256=entries[0].source_sha256, local_source_path="",
        )
        errors = pilot.validate_manifest_structure(entries)
        self.assertTrue(any("local_source_path must not be empty" in error for error in errors))

    def test_error_strings_never_contain_a_local_path(self):
        entries = make_five_valid_entries()
        entries[0] = make_manifest_entry(
            candidate_uuid=entries[0].candidate_uuid, archive_file_id=entries[0].archive_file_id,
            source_sha256=entries[0].source_sha256, extension="xlsx", local_source_path="/very/secret/real/path/file.xlsx",
        )
        errors = pilot.validate_manifest_structure(entries)
        self.assertTrue(errors)
        for error in errors:
            self.assertNotIn("/very/secret/real/path", error)


# =====================================================================
# Manifest execution-time validation (the only functions that touch a
# real local file - never the network, never PostgreSQL).
# =====================================================================


class TestManifestExecutionValidation(unittest.TestCase):
    def test_matching_file_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "doc.docx"
            write_synthetic_docx(path, ["synthetic"])
            digest = base_extractor.sha256_file(path)
            entry = make_manifest_entry(local_source_path=str(path), source_sha256=digest)
            self.assertEqual(pilot.validate_manifest_for_execution([entry]), [])

    def test_missing_source_file_is_rejected(self):
        entry = make_manifest_entry(local_source_path="/tmp/definitely-does-not-exist-pilot-fixture.docx")
        errors = pilot.validate_manifest_for_execution([entry])
        self.assertTrue(any("does not exist" in error for error in errors))

    def test_hash_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "doc.docx"
            write_synthetic_docx(path, ["synthetic"])
            entry = make_manifest_entry(local_source_path=str(path), source_sha256="0" * 64)
            errors = pilot.validate_manifest_for_execution([entry])
            self.assertTrue(any("mismatch" in error for error in errors))


# =====================================================================
# Statut canonical mapping (preserves the established schema; documents
# the mapping rather than creating a second incompatible format).
# =====================================================================


class TestStatutCanonicalMapping(unittest.TestCase):
    def test_every_established_statut_maps_to_a_canonical_ascii_value(self):
        self.assertEqual(pilot.to_canonical_statut("Explicite"), "EXPLICITE")
        self.assertEqual(pilot.to_canonical_statut("Implicite"), "IMPLICITE")
        self.assertEqual(pilot.to_canonical_statut("Absent"), "ABSENT")
        self.assertEqual(pilot.to_canonical_statut("Non déterminable"), "NON_DETERMINABLE")

    def test_unknown_statut_raises(self):
        with self.assertRaises(ValueError):
            pilot.to_canonical_statut("Inconnu")

    def test_mapping_matches_the_established_schema_enum_exactly(self):
        schema_enum = pilot.SCHEMA["$defs"]["statut"]["enum"]
        self.assertEqual(set(schema_enum), set(pilot.STATUT_CANONICAL_MAP.keys()))


# =====================================================================
# Loopback + redirect + retry transport safety.
# =====================================================================


class TestLoopbackEnforcement(unittest.TestCase):
    def test_loopback_urls_pass(self):
        for url in ("http://127.0.0.1:11434", "http://localhost:8010", "https://127.0.0.1:9999"):
            pilot.assert_loopback_url(url)  # must not raise

    def test_non_loopback_url_rejected(self):
        with self.assertRaises(ValueError):
            pilot.assert_loopback_url("http://evil.example.com:11434")

    def test_non_http_scheme_rejected(self):
        with self.assertRaises(ValueError):
            pilot.assert_loopback_url("ftp://127.0.0.1")

    def test_safe_session_never_reaches_the_transport_for_a_non_local_url(self):
        class PoisonTransport:
            def post(self, url, **kwargs):
                raise AssertionError("must never be called for a non-loopback URL")

        session = pilot.SafeLocalSession(PoisonTransport())
        with self.assertRaises(ValueError):
            session.post("http://evil.example.com/api/generate", json={})


class TestSafeLocalSessionRedirects(unittest.TestCase):
    def test_redirect_status_is_rejected_and_never_followed(self):
        class RedirectTransport:
            def __init__(self):
                self.calls = 0

            def post(self, url, **kwargs):
                self.calls += 1
                return FakeResponse({}, status_code=302)

        transport = RedirectTransport()
        session = pilot.SafeLocalSession(transport)
        with self.assertRaises(pilot.PilotTransportError) as ctx:
            session.post("http://127.0.0.1:11434/api/generate", json={})
        self.assertEqual(ctx.exception.reason_code, "redirect_rejected")
        self.assertEqual(transport.calls, 1)  # never retried - a redirect is not transient

    def test_allow_redirects_is_always_forced_false(self):
        captured = {}

        class CapturingTransport:
            def post(self, url, **kwargs):
                captured.update(kwargs)
                return FakeResponse({"ok": True})

        session = pilot.SafeLocalSession(CapturingTransport())
        session.post("http://127.0.0.1:11434/api/generate", json={})
        self.assertEqual(captured.get("allow_redirects"), False)


class TestSafeLocalSessionRetries(unittest.TestCase):
    def test_bounded_retries_then_raises(self):
        class AlwaysFailingTransport:
            def __init__(self):
                self.calls = 0

            def post(self, url, **kwargs):
                self.calls += 1
                raise ConnectionError("synthetic connection refused")

        sleeps = []
        transport = AlwaysFailingTransport()
        session = pilot.SafeLocalSession(transport, max_retries=2, backoff_seconds=0.01, sleep=sleeps.append)
        with self.assertRaises(pilot.PilotTransportError) as ctx:
            session.post("http://127.0.0.1:11434/api/generate", json={})
        self.assertEqual(ctx.exception.reason_code, "transport_error")
        self.assertEqual(transport.calls, 3)  # 1 initial + 2 retries, never more
        self.assertEqual(session.total_retries, 2)
        self.assertEqual(len(sleeps), 2)

    def test_succeeds_after_a_transient_failure_within_the_retry_budget(self):
        class FlakyTransport:
            def __init__(self):
                self.calls = 0

            def post(self, url, **kwargs):
                self.calls += 1
                if self.calls < 2:
                    raise TimeoutError("synthetic timeout")
                return FakeResponse({"ok": True})

        session = pilot.SafeLocalSession(FlakyTransport(), max_retries=2, backoff_seconds=0.01, sleep=lambda s: None)
        response = session.post("http://127.0.0.1:11434/api/generate", json={})
        self.assertEqual(response.json(), {"ok": True})
        self.assertEqual(session.total_retries, 1)

    def test_timeout_is_treated_as_a_retryable_transport_failure(self):
        class TimeoutTransport:
            def post(self, url, **kwargs):
                raise TimeoutError("synthetic timeout")

        session = pilot.SafeLocalSession(TimeoutTransport(), max_retries=1, backoff_seconds=0.0, sleep=lambda s: None)
        with self.assertRaises(pilot.PilotTransportError):
            session.post("http://127.0.0.1:11434/api/generate", json={})

    def test_http_error_status_is_never_retried(self):
        class HttpErrorTransport:
            def __init__(self):
                self.calls = 0

            def post(self, url, **kwargs):
                self.calls += 1
                return FakeResponse({}, status_code=500)

        transport = HttpErrorTransport()
        session = pilot.SafeLocalSession(transport, max_retries=2, backoff_seconds=0.0, sleep=lambda s: None)
        response = session.post("http://127.0.0.1:11434/api/generate", json={})
        self.assertEqual(transport.calls, 1)
        with self.assertRaises(RuntimeError):
            response.raise_for_status()


# =====================================================================
# Strict Ollama classification.
# =====================================================================


class TestClassifyWithOllama(unittest.TestCase):
    def test_valid_response_succeeds_on_first_try(self):
        payload = valid_extraction_payload()
        session = pilot.SafeLocalSession(FakeOllamaTransport(payload))
        result, outcome, category, errors = pilot.classify_with_ollama(
            "texte synthetique", "doc-1", "a" * 64, "http://127.0.0.1:11434", "qwen3:14b", session,
        )
        self.assertEqual(outcome, "first_try")
        self.assertIsNone(category)
        self.assertEqual(errors, [])
        self.assertEqual(result["verdict"], "CONFIRMED_CDC")

    def test_malformed_json_after_repair_fails_as_invalid_json(self):
        session = pilot.SafeLocalSession(SequencedOllamaTransport(["not json {{{ 1", "not json {{{ 2"]))
        result, outcome, category, errors = pilot.classify_with_ollama(
            "texte", "doc-1", "a" * 64, "http://127.0.0.1:11434", "m", session,
        )
        self.assertIsNone(result)
        self.assertEqual(outcome, "failed")
        self.assertEqual(category, "INVALID_JSON")

    def test_bad_first_response_is_repaired_and_succeeds(self):
        payload = valid_extraction_payload()
        session = pilot.SafeLocalSession(SequencedOllamaTransport(["not json {{{", payload]))
        result, outcome, category, errors = pilot.classify_with_ollama(
            "texte", "doc-1", "a" * 64, "http://127.0.0.1:11434", "m", session,
        )
        self.assertEqual(outcome, "after_repair")
        self.assertIsNone(category)
        self.assertEqual(result["verdict"], "CONFIRMED_CDC")

    def test_missing_criterion_is_rejected_as_schema_invalid(self):
        payload = valid_extraction_payload()
        del payload["criteres"]["SS_AEP"]
        session = pilot.SafeLocalSession(FakeOllamaTransport(payload))
        result, outcome, category, errors = pilot.classify_with_ollama(
            "t", "doc-1", "a" * 64, "http://127.0.0.1:11434", "m", session,
        )
        self.assertIsNone(result)
        self.assertEqual(category, "SCHEMA_INVALID")

    def test_extra_criterion_is_rejected_as_schema_invalid(self):
        payload = valid_extraction_payload()
        payload["criteres"]["EXTRA_MADE_UP_CRITERION"] = {"statut": "Explicite"}
        session = pilot.SafeLocalSession(FakeOllamaTransport(payload))
        result, outcome, category, errors = pilot.classify_with_ollama(
            "t", "doc-1", "a" * 64, "http://127.0.0.1:11434", "m", session,
        )
        self.assertIsNone(result)
        self.assertEqual(category, "SCHEMA_INVALID")

    def test_malformed_criterion_status_value_is_rejected(self):
        payload = valid_extraction_payload()
        payload["criteres"]["SS_AEP"] = {"statut": "MaybeSortOf"}
        session = pilot.SafeLocalSession(FakeOllamaTransport(payload))
        result, outcome, category, errors = pilot.classify_with_ollama(
            "t", "doc-1", "a" * 64, "http://127.0.0.1:11434", "m", session,
        )
        self.assertIsNone(result)
        self.assertEqual(category, "SCHEMA_INVALID")

    def test_every_allowed_criterion_status_round_trips(self):
        for statut in ("Explicite", "Implicite", "Absent", "Non déterminable"):
            payload = valid_extraction_payload()
            payload["criteres"] = {key: {"statut": statut} for key in base_extractor.CRITERIA_KEYS}
            session = pilot.SafeLocalSession(FakeOllamaTransport(payload))
            result, outcome, category, errors = pilot.classify_with_ollama(
                "t", "doc-1", "a" * 64, "http://127.0.0.1:11434", "m", session,
            )
            self.assertEqual(outcome, "first_try", msg=f"statut={statut}")
            self.assertEqual(result["criteres"]["SS_AEP"]["statut"], statut)

    def test_transport_failure_is_reported_as_ollama_unreachable(self):
        class AlwaysFailingTransport:
            def post(self, url, **kwargs):
                raise ConnectionError("synthetic")

        session = pilot.SafeLocalSession(AlwaysFailingTransport(), max_retries=0, sleep=lambda s: None)
        result, outcome, category, errors = pilot.classify_with_ollama(
            "t", "doc-1", "a" * 64, "http://127.0.0.1:11434", "m", session,
        )
        self.assertIsNone(result)
        self.assertEqual(category, "OLLAMA_UNREACHABLE")

    def test_redirect_is_reported_as_ollama_unreachable_with_reason(self):
        class RedirectTransport:
            def post(self, url, **kwargs):
                return FakeResponse({}, status_code=307)

        session = pilot.SafeLocalSession(RedirectTransport())
        result, outcome, category, errors = pilot.classify_with_ollama(
            "t", "doc-1", "a" * 64, "http://127.0.0.1:11434", "m", session,
        )
        self.assertIsNone(result)
        self.assertEqual(category, "OLLAMA_UNREACHABLE")
        self.assertIn("redirect_rejected", errors)

    def test_validation_errors_never_echo_a_raw_instance_value(self):
        payload = valid_extraction_payload()
        payload["criteres"]["SS_AEP"] = {"statut": "SECRET_DOCUMENT_MARKER_XYZ"}
        session = pilot.SafeLocalSession(FakeOllamaTransport(payload))
        result, outcome, category, errors = pilot.classify_with_ollama(
            "t", "doc-1", "a" * 64, "http://127.0.0.1:11434", "m", session,
        )
        for error in errors:
            self.assertNotIn("SECRET_DOCUMENT_MARKER_XYZ", error)


# =====================================================================
# Per-candidate pipeline (process_pilot_entry).
# =====================================================================


class TestProcessPilotEntry(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.tmp_path = Path(self._tmpdir.name)
        self.doc_path = self.tmp_path / "doc.docx"
        write_synthetic_docx(self.doc_path, ["CAHIER DES CHARGES synthetique"])
        self.source_hash = base_extractor.sha256_file(self.doc_path)
        self.entry = make_manifest_entry(local_source_path=str(self.doc_path), source_sha256=self.source_hash)

    def test_successful_extraction(self):
        payload = valid_extraction_payload()
        session = pilot.SafeLocalSession(FakeOllamaTransport(payload))
        result = pilot.process_pilot_entry(self.entry, "qwen3:14b", "http://127.0.0.1:11434", session)
        self.assertEqual(result.processing_status, "SUCCESS")
        self.assertEqual(len(result.criteria), 21)
        self.assertEqual(result.criteria["SS_AEP"].statut_canonical, "EXPLICITE")
        self.assertIsNone(result.failure_category)

    def test_source_hash_mismatch_fails_closed_before_any_ollama_call(self):
        transport = FakeOllamaTransport(valid_extraction_payload())
        session = pilot.SafeLocalSession(transport)
        bad_entry = make_manifest_entry(local_source_path=str(self.doc_path), source_sha256="0" * 64)
        result = pilot.process_pilot_entry(bad_entry, "qwen3:14b", "http://127.0.0.1:11434", session)
        self.assertEqual(result.failure_category, "SOURCE_VERIFICATION_FAILED")
        self.assertEqual(transport.calls, 0)  # never reached Ollama

    def test_missing_source_file_fails_closed(self):
        missing_entry = make_manifest_entry(local_source_path=str(self.tmp_path / "nope.docx"), source_sha256="0" * 64)
        session = pilot.SafeLocalSession(FakeOllamaTransport(valid_extraction_payload()))
        result = pilot.process_pilot_entry(missing_entry, "qwen3:14b", "http://127.0.0.1:11434", session)
        self.assertEqual(result.failure_category, "SOURCE_VERIFICATION_FAILED")

    def test_oversized_extracted_text_fails_closed(self):
        old_max = pilot.MAX_EXTRACTED_TEXT_CHARS
        pilot.MAX_EXTRACTED_TEXT_CHARS = 5
        try:
            session = pilot.SafeLocalSession(FakeOllamaTransport(valid_extraction_payload()))
            result = pilot.process_pilot_entry(self.entry, "qwen3:14b", "http://127.0.0.1:11434", session)
        finally:
            pilot.MAX_EXTRACTED_TEXT_CHARS = old_max
        self.assertEqual(result.processing_status, "TEXT_EXTRACTION_FAILED")
        self.assertEqual(result.failure_category, "TEXT_TOO_LARGE")

    def test_corrupt_document_is_a_text_extraction_failure(self):
        corrupt_path = self.tmp_path / "corrupt.docx"
        corrupt_path.write_bytes(b"not a zip file at all")
        digest = base_extractor.sha256_file(corrupt_path)
        entry = make_manifest_entry(local_source_path=str(corrupt_path), source_sha256=digest)
        session = pilot.SafeLocalSession(FakeOllamaTransport(valid_extraction_payload()))
        result = pilot.process_pilot_entry(entry, "qwen3:14b", "http://127.0.0.1:11434", session)
        self.assertEqual(result.processing_status, "TEXT_EXTRACTION_FAILED")

    def test_result_never_contains_the_local_source_path_or_selection_reason(self):
        entry = make_manifest_entry(
            local_source_path=str(self.doc_path), source_sha256=self.source_hash,
            selection_reason="SECRET_SELECTION_COMMENTARY",
        )
        session = pilot.SafeLocalSession(FakeOllamaTransport(valid_extraction_payload()))
        result = pilot.process_pilot_entry(entry, "qwen3:14b", "http://127.0.0.1:11434", session)
        serialized = json.dumps(result.as_dict())
        self.assertNotIn(str(self.doc_path), serialized)
        self.assertNotIn("SECRET_SELECTION_COMMENTARY", serialized)

    def test_result_never_contains_the_raw_extracted_document_text(self):
        session = pilot.SafeLocalSession(FakeOllamaTransport(valid_extraction_payload()))
        result = pilot.process_pilot_entry(self.entry, "qwen3:14b", "http://127.0.0.1:11434", session)
        serialized = json.dumps(result.as_dict())
        self.assertNotIn("CAHIER DES CHARGES synthetique", serialized)

    def test_retry_count_is_reported_on_the_result(self):
        class FlakyTransport:
            def __init__(self):
                self.calls = 0

            def post(self, url, **kwargs):
                self.calls += 1
                if self.calls == 1:
                    raise ConnectionError("synthetic")
                raw = json.dumps(valid_extraction_payload())
                return FakeResponse({"response": raw})

        session = pilot.SafeLocalSession(FlakyTransport(), max_retries=2, backoff_seconds=0.0, sleep=lambda s: None)
        result = pilot.process_pilot_entry(self.entry, "qwen3:14b", "http://127.0.0.1:11434", session)
        self.assertEqual(result.processing_status, "SUCCESS")
        self.assertEqual(result.retry_count, 1)


# =====================================================================
# Atomic, owner-only output writing.
# =====================================================================


class TestOutputWriting(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.output_dir = Path(self._tmpdir.name) / "out"
        self.entry = make_manifest_entry()

    def _success_result(self):
        payload = valid_extraction_payload()
        return pilot.build_result_from_extraction(self.entry, "m", None, payload, 10, 0)

    def test_write_produces_valid_json_with_the_expected_fields(self):
        result = self._success_result()
        path = pilot.write_pilot_result(self.output_dir, result)
        data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(data["candidate_uuid"], self.entry.candidate_uuid)
        self.assertEqual(data["processing_status"], "SUCCESS")
        self.assertEqual(len(data["criteria"]), 21)

    def test_output_file_has_owner_only_permissions(self):
        result = self._success_result()
        path = pilot.write_pilot_result(self.output_dir, result)
        mode = stat.S_IMODE(os.stat(path).st_mode)
        self.assertEqual(mode, 0o600)

    def test_output_directory_has_owner_only_permissions(self):
        result = self._success_result()
        pilot.write_pilot_result(self.output_dir, result)
        mode = stat.S_IMODE(os.stat(self.output_dir).st_mode)
        self.assertEqual(mode, 0o700)

    def test_refuses_to_overwrite_a_successful_result_without_the_flag(self):
        result = self._success_result()
        pilot.write_pilot_result(self.output_dir, result)
        with self.assertRaises(pilot.ResultAlreadyExistsError):
            pilot.write_pilot_result(self.output_dir, result, overwrite=False)

    def test_explicit_overwrite_flag_allows_replacing_a_successful_result(self):
        result = self._success_result()
        pilot.write_pilot_result(self.output_dir, result)
        pilot.write_pilot_result(self.output_dir, result, overwrite=True)  # must not raise

    def test_a_failed_result_may_always_be_replaced_without_the_flag(self):
        failure = pilot.build_failure_result(self.entry, "m", "TEXT_EXTRACTION_FAILED", "docling_failed", ["x"], 10, 0)
        pilot.write_pilot_result(self.output_dir, failure)
        pilot.write_pilot_result(self.output_dir, failure, overwrite=False)  # must not raise - not a SUCCESS result

    def test_write_is_atomic_no_partial_file_is_ever_visible(self):
        result = self._success_result()
        path = pilot.write_pilot_result(self.output_dir, result)
        # No stray temp file left behind after a successful write.
        leftovers = [p for p in self.output_dir.iterdir() if p.name != path.name]
        self.assertEqual(leftovers, [])


# =====================================================================
# Checkpoint / resume.
# =====================================================================


class TestCheckpointResume(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.checkpoint_path = Path(self._tmpdir.name) / "out" / ".checkpoint.json"

    def test_save_and_load_roundtrip(self):
        checkpoint = pilot.PilotCheckpoint(scope_signature="deadbeef", config={"model": "m"}, completed_candidate_uuids=["a", "b"])
        pilot.save_pilot_checkpoint(self.checkpoint_path, checkpoint)
        loaded = pilot.load_pilot_checkpoint(self.checkpoint_path)
        self.assertEqual(loaded.scope_signature, "deadbeef")
        self.assertEqual(loaded.completed_candidate_uuids, ["a", "b"])

    def test_missing_checkpoint_loads_as_none(self):
        self.assertIsNone(pilot.load_pilot_checkpoint(self.checkpoint_path))

    def test_malformed_checkpoint_fails_closed_to_none(self):
        self.checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        self.checkpoint_path.write_text("not valid json{{{", encoding="utf-8")
        self.assertIsNone(pilot.load_pilot_checkpoint(self.checkpoint_path))

    def test_checkpoint_file_has_owner_only_permissions(self):
        checkpoint = pilot.PilotCheckpoint(scope_signature="x", config={})
        pilot.save_pilot_checkpoint(self.checkpoint_path, checkpoint)
        mode = stat.S_IMODE(os.stat(self.checkpoint_path).st_mode)
        self.assertEqual(mode, 0o600)


# =====================================================================
# Private output directory guard.
# =====================================================================


class TestPrivateOutputDir(unittest.TestCase):
    def test_directory_inside_the_repo_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo_root = Path(tmp) / "repo"
            repo_root.mkdir()
            inside = repo_root / "services" / "knowledge-base" / "output"
            with self.assertRaises(pilot.OutputDirectoryError):
                pilot.validate_private_output_dir(inside, repo_root)

    def test_repo_root_itself_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo_root = Path(tmp) / "repo"
            repo_root.mkdir()
            with self.assertRaises(pilot.OutputDirectoryError):
                pilot.validate_private_output_dir(repo_root, repo_root)

    def test_directory_outside_the_repo_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo_root = Path(tmp) / "repo"
            repo_root.mkdir()
            outside = Path(tmp) / "private"
            pilot.validate_private_output_dir(outside, repo_root)  # must not raise


# =====================================================================
# Confirmation token.
# =====================================================================


class TestConfirmationToken(unittest.TestCase):
    def test_deterministic_for_the_same_inputs(self):
        self.assertEqual(pilot.build_confirmation_token(5, "qwen3:14b"), pilot.build_confirmation_token(5, "qwen3:14b"))

    def test_differs_for_a_different_model(self):
        self.assertNotEqual(pilot.build_confirmation_token(5, "qwen3:14b"), pilot.build_confirmation_token(5, "other-model"))

    def test_never_derived_from_a_hash_or_identifier(self):
        token = pilot.build_confirmation_token(5, "qwen3:14b")
        self.assertNotIn("a" * 8, token)  # sanity: no accidental hash fragment


# =====================================================================
# --dry-run (aggregate-only; no network, no filesystem beyond the
# manifest file itself, no PostgreSQL).
# =====================================================================


class TestRunDryRun(unittest.TestCase):
    def _write_manifest(self, tmp: Path, entries) -> Path:
        manifest_path = tmp / "manifest.json"
        manifest_path.write_text(json.dumps({"entries": [
            {
                "candidate_uuid": e.candidate_uuid, "archive_file_id": e.archive_file_id,
                "source_sha256": e.source_sha256, "year": e.year, "extension": e.extension,
                "processing_group": e.processing_group, "validation_status": e.validation_status,
                "local_source_path": e.local_source_path, "selection_reason": e.selection_reason,
            }
            for e in entries
        ]}), encoding="utf-8")
        return manifest_path

    def test_valid_manifest_reports_valid_true(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = self._write_manifest(Path(tmp), make_five_valid_entries())
            report = pilot.run_dry_run(manifest_path)
            self.assertTrue(report.valid)
            self.assertEqual(report.entry_count, 5)
            self.assertEqual(report.processing_group_counts, {"PRIORITAIRE_2020_2026": 5})

    def test_invalid_json_manifest_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "manifest.json"
            manifest_path.write_text("not valid json{{{", encoding="utf-8")
            report = pilot.run_dry_run(manifest_path)
            self.assertFalse(report.manifest_loaded)
            self.assertFalse(report.valid)

    def test_structural_violations_are_reported_not_silently_dropped(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = self._write_manifest(Path(tmp), make_five_valid_entries()[:4])
            report = pilot.run_dry_run(manifest_path)
            self.assertFalse(report.valid)
            self.assertTrue(report.structural_errors)

    def test_dry_run_makes_no_network_call(self):
        # run_dry_run's signature takes only a manifest path - there is no
        # session/transport parameter anywhere in its call graph, so a
        # network call is structurally impossible, not merely untested.
        import inspect
        signature = inspect.signature(pilot.run_dry_run)
        self.assertEqual(list(signature.parameters), ["manifest_path"])

    def test_dry_run_never_imports_requests_at_module_level(self):
        # requests is imported lazily inside main(), only on the --execute
        # path - see the "imported lazily" comment in cdc_pilot_extractor.py.
        source = (HERE / "cdc_pilot_extractor.py").read_text(encoding="utf-8")
        self.assertNotIn("\nimport requests", source.split("def main(")[0])

    def test_printed_dry_run_report_contains_no_candidate_identifier(self):
        with tempfile.TemporaryDirectory() as tmp:
            entries = make_five_valid_entries()
            manifest_path = self._write_manifest(Path(tmp), entries)
            report = pilot.run_dry_run(manifest_path)
            buffer = io.StringIO()
            with redirect_stdout(buffer):
                pilot.print_dry_run_report(report)
            output = buffer.getvalue()
            for entry in entries:
                self.assertNotIn(entry.candidate_uuid, output)
            self.assertIn("database_accessed: NO", output)
            self.assertIn("network_accessed: NO", output)


# =====================================================================
# --execute guard chain (fully synthetic - fake transport factory only).
# =====================================================================


class TestRunExecuteGuardChain(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.tmp_path = Path(self._tmpdir.name)
        self.repo_root = self.tmp_path / "repo"
        self.repo_root.mkdir()
        self.output_dir = self.tmp_path / "private_output"
        self.docs_dir = self.tmp_path / "docs"
        self.docs_dir.mkdir()
        self.model = "qwen3:14b"

        self.entries_data = []
        for i in range(5):
            doc_path = self.docs_dir / f"doc{i}.docx"
            write_synthetic_docx(doc_path, [f"CAHIER DES CHARGES synthetique {i}"])
            digest = base_extractor.sha256_file(doc_path)
            self.entries_data.append({
                "candidate_uuid": str(uuid.uuid4()), "archive_file_id": 3000 + i, "source_sha256": digest,
                "year": 2020 + i, "extension": "docx", "processing_group": "PRIORITAIRE_2020_2026",
                "validation_status": "HUMAN_VALIDATED_CDC", "local_source_path": str(doc_path),
                "selection_reason": f"synthetic reason {i}",
            })
        self.manifest_path = self.tmp_path / "manifest.json"
        self.manifest_path.write_text(json.dumps({"entries": self.entries_data}), encoding="utf-8")

        self.ollama_payload = valid_extraction_payload()

    def _build_args(self, parser, **overrides):
        values = dict(
            manifest=str(self.manifest_path), confirm_token=pilot.build_confirmation_token(5, self.model),
            docling_endpoint="http://127.0.0.1:8010", ollama_endpoint="http://127.0.0.1:11434",
            model=self.model, output_dir=str(self.output_dir),
        )
        values.update(overrides)
        argv = ["--manifest", values["manifest"], "--execute"]
        if values.get("confirm_token") is not None:
            argv += ["--confirm-token", values["confirm_token"]]
        if values.get("docling_endpoint") is not None:
            argv += ["--docling-endpoint", values["docling_endpoint"]]
        if values.get("ollama_endpoint") is not None:
            argv += ["--ollama-endpoint", values["ollama_endpoint"]]
        if values.get("model") is not None:
            argv += ["--model", values["model"]]
        if values.get("output_dir") is not None:
            argv += ["--output-dir", values["output_dir"]]
        if values.get("resume"):
            argv.append("--resume")
        if values.get("overwrite"):
            argv.append("--overwrite")
        return parser.parse_args(argv)

    def _session_factory(self):
        markdown = "CAHIER DES CHARGES synthetique"
        return lambda: DoclingAndOllamaTransport(markdown, self.ollama_payload)

    def test_all_five_succeed_end_to_end(self):
        parser = pilot.build_arg_parser()
        args = self._build_args(parser)
        report = pilot.run_execute(args, self._session_factory(), repo_root=self.repo_root)
        self.assertTrue(report.guard_passed)
        self.assertEqual(report.succeeded, 5)
        self.assertEqual(report.failed, 0)

    def test_resume_skips_already_completed_entries(self):
        parser = pilot.build_arg_parser()
        args = self._build_args(parser)
        pilot.run_execute(args, self._session_factory(), repo_root=self.repo_root)
        args_resume = self._build_args(parser, resume=True)
        report2 = pilot.run_execute(args_resume, self._session_factory(), repo_root=self.repo_root)
        self.assertEqual(report2.skipped_already_done, 5)

    def test_output_dir_inside_repo_is_rejected_before_any_transport_call(self):
        parser = pilot.build_arg_parser()
        args = self._build_args(parser, output_dir=str(self.repo_root / "inside"))

        class PoisonSessionFactory:
            def __call__(self):
                raise AssertionError("must never construct a transport when a guard fails")

        report = pilot.run_execute(args, PoisonSessionFactory(), repo_root=self.repo_root)
        self.assertFalse(report.guard_passed)

    def test_non_loopback_docling_endpoint_rejected_before_any_transport_call(self):
        parser = pilot.build_arg_parser()
        args = self._build_args(parser, docling_endpoint="http://evil.example.com")

        class PoisonSessionFactory:
            def __call__(self):
                raise AssertionError("must never construct a transport when a guard fails")

        report = pilot.run_execute(args, PoisonSessionFactory(), repo_root=self.repo_root)
        self.assertFalse(report.guard_passed)

    def test_non_loopback_ollama_endpoint_rejected(self):
        parser = pilot.build_arg_parser()
        args = self._build_args(parser, ollama_endpoint="http://10.0.0.5:11434")
        report = pilot.run_execute(args, self._session_factory(), repo_root=self.repo_root)
        self.assertFalse(report.guard_passed)

    def test_redirect_target_endpoint_is_rejected_at_the_transport_layer(self):
        # A --docling-endpoint/--ollama-endpoint value is validated as
        # loopback text; a *response* redirecting elsewhere is rejected by
        # SafeLocalSession itself (covered by TestSafeLocalSessionRedirects
        # and TestClassifyWithOllama's dedicated tests) - this test
        # confirms the end-to-end run also fails closed rather than
        # succeeding when Docling responds with a redirect.
        class RedirectingTransport:
            def post(self, url, **kwargs):
                return FakeResponse({}, status_code=302)

            def get(self, url, **kwargs):
                return FakeResponse({}, status_code=302)

        parser = pilot.build_arg_parser()
        args = self._build_args(parser)
        report = pilot.run_execute(args, lambda: RedirectingTransport(), repo_root=self.repo_root)
        self.assertTrue(report.guard_passed)  # guards themselves passed (loopback URLs)
        self.assertEqual(report.succeeded, 0)
        self.assertEqual(report.failed, 5)

    def test_wrong_entry_count_is_rejected(self):
        four_entries = self.entries_data[:4]
        manifest_path = self.tmp_path / "manifest_four.json"
        manifest_path.write_text(json.dumps({"entries": four_entries}), encoding="utf-8")
        parser = pilot.build_arg_parser()
        args = self._build_args(parser, manifest=str(manifest_path), confirm_token=pilot.build_confirmation_token(4, self.model))
        report = pilot.run_execute(args, self._session_factory(), repo_root=self.repo_root)
        self.assertFalse(report.guard_passed)

    def test_mismatched_confirm_token_is_rejected(self):
        parser = pilot.build_arg_parser()
        args = self._build_args(parser, confirm_token="CONFIRM-PILOT-5-wrong-model")
        report = pilot.run_execute(args, self._session_factory(), repo_root=self.repo_root)
        self.assertFalse(report.guard_passed)

    def test_missing_required_execute_flags_are_rejected_by_the_cli_parser(self):
        parser = pilot.build_arg_parser()
        args = parser.parse_args(["--manifest", str(self.manifest_path), "--execute"])
        with self.assertRaises(SystemExit):
            pilot._validate_args(parser, args)

    def test_dry_run_and_execute_are_mutually_exclusive(self):
        parser = pilot.build_arg_parser()
        args = parser.parse_args(["--manifest", str(self.manifest_path), "--dry-run", "--execute"])
        with self.assertRaises(SystemExit):
            pilot._validate_args(parser, args)

    def test_rejected_candidate_in_manifest_blocks_execute_entirely(self):
        entries_with_rejected = list(self.entries_data)
        entries_with_rejected[0] = dict(entries_with_rejected[0], validation_status="HUMAN_REJECTED_CDC", processing_group="EXCLU")
        manifest_path = self.tmp_path / "manifest_rejected.json"
        manifest_path.write_text(json.dumps({"entries": entries_with_rejected}), encoding="utf-8")
        parser = pilot.build_arg_parser()
        args = self._build_args(parser, manifest=str(manifest_path))

        class PoisonSessionFactory:
            def __call__(self):
                raise AssertionError("must never construct a transport when manifest validation fails")

        report = pilot.run_execute(args, PoisonSessionFactory(), repo_root=self.repo_root)
        self.assertFalse(report.guard_passed)


# =====================================================================
# Structural / confidentiality safeguards (source-text checks, same
# pattern as app/administration/knowledge/cdc-review-guards.test.ts and
# services/knowledge-base/test_cdc_review_import_preview.py).
# =====================================================================


class TestStructuralSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = (HERE / "cdc_pilot_extractor.py").read_text(encoding="utf-8")

    def test_no_database_driver_module_is_imported_by_this_module(self):
        for name in list(sys.modules):
            self.assertFalse(name.startswith("psycopg") or name == "pg8000", f"unexpected DB driver present: {name}")

    def test_module_never_contains_write_capable_sql(self):
        # "truncate" alone would false-positive on this module's own
        # legitimate English usage ("...additionally truncates to
        # EXTRACTION_CHAR_LIMIT...") - every forbidden phrase here is
        # therefore the actual multi-word SQL statement, not a bare verb.
        lowered = self.source.lower()
        for forbidden in ("insert into", "update knowledge_base", "delete from", "truncate table", "drop table"):
            self.assertNotIn(forbidden, lowered)

    def test_module_never_hardcodes_a_non_loopback_default_endpoint(self):
        for forbidden in ("http://0.0.0.0", "https://", "http://10.", "http://192.168."):
            self.assertNotIn(forbidden, self.source)

    def test_execute_requires_five_manifest_entries_explicitly_in_source(self):
        self.assertIn("PILOT_ENTRY_COUNT", self.source)
        self.assertIn(f"len(entries) != PILOT_ENTRY_COUNT", self.source)


if __name__ == "__main__":
    unittest.main()
