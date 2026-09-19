#!/usr/bin/env python3
"""Synthetic test suite for cdc_candidate_extractor.py.

SYNTHETIC DATA ONLY. No real archive filenames, paths, project names, or
document content are used anywhere in this file. No real Docling service,
no real Ollama server, no real LibreOffice/antiword/catdoc subprocess is
ever invoked - every external dependency is mocked or dependency-injected.
"""
from __future__ import annotations

import importlib.util
import io
import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("cdc_candidate_extractor", HERE / "cdc_candidate_extractor.py")
extractor = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = extractor
SPEC.loader.exec_module(extractor)


def write_synthetic_docx(path: Path, paragraphs: "list[str]") -> None:
    body = "".join(f"<w:p><w:r><w:t>{escape(text)}</w:t></w:r></w:p>" for text in paragraphs)
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", document_xml)


VALID_EXTRACTION = {
    "document_id": "synthetic-id",
    "source_hash": "a" * 64,
    "language": "fr",
    "document_role": "CDC",
    "identite": {
        "titre_officiel": "Titre synthétique",
        "annee_lancement": 2020,
        "pays": "Pays synthétique",
        "bailleur": "Bailleur synthétique",
        "code_interne_concept": None,
    },
    "criteres": {key: {"statut": "Explicite"} for key in extractor.CRITERIA_KEYS},
    "signaux_structurels": {
        "role_cdc_explicite": True, "exigences_techniques": True, "exigences_perimetre": True,
        "livrables": True, "obligations_soumissionnaire": True, "criteres_evaluation": True,
        "exigences_administratives": True, "possible_dao": False, "possible_offre": False,
    },
    "verdict": "CONFIRMED_CDC",
    "confiance": 0.9,
}


class Response:
    def __init__(self, payload=None, status=200):
        self.payload, self.status_code = payload or {}, status

    def json(self):
        return self.payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeSession:
    """Mocks both the Docling and Ollama HTTP calls - never reaches a real
    localhost:8010 or localhost:11434 service."""

    def __init__(self, docling_markdown="CAHIER DES CHARGES synthétique", ollama_payload=None, docling_fails=False):
        self.docling_markdown = docling_markdown
        self.ollama_payload = ollama_payload if ollama_payload is not None else VALID_EXTRACTION
        self.docling_fails = docling_fails
        self.posts = []
        self.gets = []

    def post(self, url, **kwargs):
        self.posts.append(url)
        if url.endswith("/convert"):
            return Response({"status": "processing", "job_id": "job-synthetic"})
        if url.endswith("/api/generate"):
            return Response({"response": json.dumps(self.ollama_payload)})
        raise AssertionError(f"unexpected POST {url}")

    def get(self, url, **kwargs):
        self.gets.append(url)
        if self.docling_fails:
            return Response({"status": "failed", "error": "synthetic failure"})
        return Response({"status": "completed", "markdown": self.docling_markdown})


# =====================================================================
# Discovery
# =====================================================================


class TestClientFolderMatching(unittest.TestCase):
    def test_matches_common_variants(self):
        for name in ("Client", "CLIENT", "Dossier Client", "documents clients", "Dossier client corrigé", "DOC Client"):
            self.assertTrue(extractor.is_client_folder(name), name)

    def test_does_not_match_unrelated_names(self):
        for name in ("Offre Technique", "Dossier Fin", "Rapport"):
            self.assertFalse(extractor.is_client_folder(name), name)


class TestDeriveProjectAndYear(unittest.TestCase):
    def test_offres_year_convention(self):
        project, year = extractor.derive_project_and_year(("OFFRES 2020", "SYNTH-PROJECT-A", "Dossier Client", "doc.pdf"))
        self.assertEqual(project, "SYNTH-PROJECT-A")
        self.assertEqual(year, 2020)

    def test_falls_back_when_no_offres_segment(self):
        project, year = extractor.derive_project_and_year(("SYNTH-PROJECT-B", "Client", "2019", "doc.pdf"))
        self.assertEqual(project, "SYNTH-PROJECT-B")
        self.assertEqual(year, 2019)

    def test_falls_back_to_none_year_when_no_year_token(self):
        project, year = extractor.derive_project_and_year(("SYNTH-PROJECT-C", "Client", "doc.pdf"))
        self.assertEqual(project, "SYNTH-PROJECT-C")
        self.assertIsNone(year)


class TestEnumerateProjectFolders(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="cdc-extractor-test-"))
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)

    def test_only_offres_year_folders_are_scoped(self):
        (self.tmp_dir / "Divers modèles").mkdir()
        (self.tmp_dir / "OFFRES 2020" / "SYNTH-B").mkdir(parents=True)
        (self.tmp_dir / "OFFRES 2020" / "SYNTH-A").mkdir(parents=True)
        (self.tmp_dir / "OFFRES 2021" / "SYNTH-C").mkdir(parents=True)

        projects = extractor.enumerate_project_folders(self.tmp_dir)
        names = [p.relative_to(self.tmp_dir).as_posix() for p in projects]
        self.assertEqual(names, ["OFFRES 2020/SYNTH-A", "OFFRES 2020/SYNTH-B", "OFFRES 2021/SYNTH-C"])

    def test_deterministic_across_repeated_calls(self):
        for i in range(3):
            (self.tmp_dir / "OFFRES 2020" / f"SYNTH-{i}").mkdir(parents=True)
        first = [p.name for p in extractor.enumerate_project_folders(self.tmp_dir)]
        second = [p.name for p in extractor.enumerate_project_folders(self.tmp_dir)]
        self.assertEqual(first, second)


class TestDiscoverCandidatesInProject(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="cdc-extractor-test-"))
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)
        self.project_dir = self.tmp_dir / "OFFRES 2020" / "SYNTH-PROJECT"
        self.project_dir.mkdir(parents=True)

    def test_only_files_under_a_client_folder_are_candidates(self):
        client_dir = self.project_dir / "Dossier Client"
        client_dir.mkdir()
        (client_dir / "cahier.pdf").write_bytes(b"%PDF-synthetic")
        other_dir = self.project_dir / "Offre Technique"
        other_dir.mkdir()
        (other_dir / "offre.pdf").write_bytes(b"%PDF-synthetic")

        candidates = extractor.discover_candidates_in_project(self.project_dir, self.tmp_dir)
        self.assertEqual(len(candidates), 1)
        self.assertTrue(candidates[0].relative_path.endswith("Dossier Client/cahier.pdf"))

    def test_only_allowed_extensions_are_candidates(self):
        client_dir = self.project_dir / "Client"
        client_dir.mkdir()
        (client_dir / "doc.pdf").write_bytes(b"x")
        (client_dir / "doc.docx").write_bytes(b"x")
        (client_dir / "doc.doc").write_bytes(b"x")
        (client_dir / "photo.jpg").write_bytes(b"x")
        (client_dir / "archive.zip").write_bytes(b"x")

        candidates = extractor.discover_candidates_in_project(self.project_dir, self.tmp_dir)
        extensions = sorted(c.extension for c in candidates)
        self.assertEqual(extensions, ["doc", "docx", "pdf"])

    def test_nested_subfolder_under_client_folder_still_counts(self):
        nested = self.project_dir / "Dossier Client" / "Sous-dossier"
        nested.mkdir(parents=True)
        (nested / "doc.pdf").write_bytes(b"x")
        candidates = extractor.discover_candidates_in_project(self.project_dir, self.tmp_dir)
        self.assertEqual(len(candidates), 1)

    def test_candidate_id_is_stable_and_deterministic(self):
        client_dir = self.project_dir / "Client"
        client_dir.mkdir()
        (client_dir / "doc.pdf").write_bytes(b"x")
        first = extractor.discover_candidates_in_project(self.project_dir, self.tmp_dir)
        second = extractor.discover_candidates_in_project(self.project_dir, self.tmp_dir)
        self.assertEqual(first[0].candidate_id, second[0].candidate_id)

    def test_empty_project_yields_no_candidates(self):
        candidates = extractor.discover_candidates_in_project(self.project_dir, self.tmp_dir)
        self.assertEqual(candidates, [])


# =====================================================================
# Extraction
# =====================================================================


class TestExtractDocxText(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="cdc-extractor-test-"))
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)

    def test_extracts_real_synthetic_docx(self):
        path = self.tmp_dir / "doc.docx"
        write_synthetic_docx(path, ["CAHIER DES CHARGES synthétique"])
        text = extractor.extract_docx_text(path)
        self.assertIn("CAHIER DES CHARGES synthétique", text)

    def test_missing_file_raises_path_missing(self):
        with self.assertRaises(extractor.ExtractionError) as ctx:
            extractor.extract_docx_text(self.tmp_dir / "does-not-exist.docx")
        self.assertEqual(ctx.exception.reason_code, "docx_path_missing")

    def test_empty_paragraphs_raise_output_empty(self):
        path = self.tmp_dir / "empty.docx"
        write_synthetic_docx(path, [])
        with self.assertRaises(extractor.ExtractionError) as ctx:
            extractor.extract_docx_text(path)
        self.assertEqual(ctx.exception.reason_code, "docx_output_empty")

    def test_corrupt_file_raises_read_failed(self):
        path = self.tmp_dir / "corrupt.docx"
        path.write_bytes(b"not a zip file")
        with self.assertRaises(extractor.ExtractionError) as ctx:
            extractor.extract_docx_text(path)
        self.assertEqual(ctx.exception.reason_code, "docx_read_failed")


class TestExtractPdfText(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="cdc-extractor-test-"))
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)
        self.path = self.tmp_dir / "doc.pdf"
        self.path.write_bytes(b"%PDF-synthetic")

    def test_successful_extraction(self):
        session = FakeSession(docling_markdown="Texte synthétique extrait")
        text = extractor.extract_pdf_text(self.path, session=session)
        self.assertEqual(text, "Texte synthétique extrait")

    def test_docling_failure_status_raises(self):
        session = FakeSession(docling_fails=True)
        with self.assertRaises(extractor.ExtractionError) as ctx:
            extractor.extract_pdf_text(self.path, session=session)
        self.assertEqual(ctx.exception.reason_code, "docling_failed")

    def test_missing_source_raises_before_any_call(self):
        session = FakeSession()
        with self.assertRaises(extractor.ExtractionError) as ctx:
            extractor.extract_pdf_text(self.tmp_dir / "missing.pdf", session=session)
        self.assertEqual(ctx.exception.reason_code, "pdf_path_missing")
        self.assertEqual(session.posts, [])

    def test_empty_markdown_raises_output_empty(self):
        session = FakeSession(docling_markdown="   ")
        with self.assertRaises(extractor.ExtractionError) as ctx:
            extractor.extract_pdf_text(self.path, session=session)
        self.assertEqual(ctx.exception.reason_code, "docling_output_empty")


class TestExtractDocText(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="cdc-extractor-test-"))
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)
        self.path = self.tmp_dir / "doc.doc"
        self.path.write_bytes(b"synthetic legacy doc bytes")

    def test_missing_file_raises_before_any_conversion(self):
        with self.assertRaises(extractor.ExtractionError) as ctx:
            extractor.extract_doc_text(self.tmp_dir / "missing.doc")
        self.assertEqual(ctx.exception.reason_code, "doc_path_missing")

    def test_successful_libreoffice_conversion(self):
        def fake_convert(source, output_dir):
            converted = output_dir / (source.stem + ".docx")
            write_synthetic_docx(converted, ["Texte converti par LibreOffice"])
            return converted

        with patch.object(extractor, "convert_doc_to_docx", side_effect=fake_convert):
            text = extractor.extract_doc_text(self.path)
        self.assertIn("Texte converti par LibreOffice", text)

    def test_empty_libreoffice_output_falls_back_to_antiword(self):
        def fake_convert(source, output_dir):
            converted = output_dir / (source.stem + ".docx")
            write_synthetic_docx(converted, [])  # empty -> triggers fallback
            return converted

        with patch.object(extractor, "convert_doc_to_docx", side_effect=fake_convert), \
             patch.object(extractor, "extract_via_antiword", return_value="Texte via antiword") as mock_antiword:
            text = extractor.extract_doc_text(self.path)
        self.assertEqual(text, "Texte via antiword")
        mock_antiword.assert_called_once()

    def test_libreoffice_missing_falls_back_to_catdoc(self):
        with patch.object(extractor, "convert_doc_to_docx", side_effect=extractor.ExtractionError("libreoffice_missing")), \
             patch.object(extractor, "extract_via_antiword", side_effect=extractor.ExtractionError("antiword_missing")), \
             patch.object(extractor, "extract_via_catdoc", return_value="Texte via catdoc"):
            text = extractor.extract_doc_text(self.path)
        self.assertEqual(text, "Texte via catdoc")

    def test_all_tools_failing_raises_doc_extraction_empty(self):
        with patch.object(extractor, "convert_doc_to_docx", side_effect=extractor.ExtractionError("libreoffice_missing")), \
             patch.object(extractor, "extract_via_antiword", side_effect=extractor.ExtractionError("antiword_missing")), \
             patch.object(extractor, "extract_via_catdoc", side_effect=extractor.ExtractionError("catdoc_missing")):
            with self.assertRaises(extractor.ExtractionError) as ctx:
                extractor.extract_doc_text(self.path)
        self.assertEqual(ctx.exception.reason_code, "doc_extraction_empty")

    def test_antiword_and_catdoc_never_invoked_when_libreoffice_succeeds(self):
        def fake_convert(source, output_dir):
            converted = output_dir / (source.stem + ".docx")
            write_synthetic_docx(converted, ["Contenu suffisant"])
            return converted

        with patch.object(extractor, "convert_doc_to_docx", side_effect=fake_convert), \
             patch.object(extractor, "extract_via_antiword") as mock_antiword, \
             patch.object(extractor, "extract_via_catdoc") as mock_catdoc:
            extractor.extract_doc_text(self.path)
        mock_antiword.assert_not_called()
        mock_catdoc.assert_not_called()


# =====================================================================
# Ollama / prompt+schema reuse
# =====================================================================


class TestBuildPrompt(unittest.TestCase):
    def test_all_placeholders_are_substituted(self):
        prompt = extractor.build_prompt("TEXTE SYNTHETIQUE", "doc-1", "hash-1", "fr")
        self.assertNotIn("{DOCUMENT_ID}", prompt)
        self.assertNotIn("{SOURCE_HASH}", prompt)
        self.assertNotIn("{LANGUAGE}", prompt)
        self.assertNotIn("{SCHEMA_JSON}", prompt)
        self.assertNotIn("{MARKDOWN}", prompt)
        self.assertIn("doc-1", prompt)
        self.assertIn("hash-1", prompt)
        self.assertIn("TEXTE SYNTHETIQUE", prompt)

    def test_markdown_is_truncated_to_char_limit(self):
        long_text = "x" * (extractor.EXTRACTION_CHAR_LIMIT + 500)
        prompt = extractor.build_prompt(long_text, "doc-1", "hash-1", "fr")
        self.assertNotIn("x" * (extractor.EXTRACTION_CHAR_LIMIT + 1), prompt)


class SequencedOllamaSession:
    """Returns a DIFFERENT /api/generate response on each successive call
    (to simulate "first response bad, repair response good") while still
    answering /convert-style Docling calls if ever hit. raw_responses
    items are either a string (used as the "response" field verbatim) or
    an Exception instance (raised instead, to simulate a connection
    failure on that specific attempt)."""

    def __init__(self, raw_responses):
        self.raw_responses = list(raw_responses)
        self.calls = 0
        self.prompts = []

    def post(self, url, **kwargs):
        if url.endswith("/api/generate"):
            self.prompts.append(kwargs.get("json", {}).get("prompt", ""))
            self.calls += 1
            item = self.raw_responses.pop(0)
            if isinstance(item, Exception):
                raise item
            return Response({"response": item})
        raise AssertionError(f"unexpected POST {url}")

    def get(self, url, **kwargs):
        raise AssertionError(f"unexpected GET {url}")


class TestCallOllamaExtraction(unittest.TestCase):
    def test_valid_response_succeeds_on_first_try(self):
        session = FakeSession(ollama_payload=VALID_EXTRACTION)
        result, outcome, reason = extractor.call_ollama_extraction("texte", "doc-1", "a" * 64, session=session)
        self.assertEqual(outcome, "first_try")
        self.assertIsNone(reason)
        self.assertEqual(result["verdict"], "CONFIRMED_CDC")
        self.assertEqual(result["criteres"]["SS_AEP"]["statut"], "Explicite")

    def test_bad_first_response_is_repaired_and_succeeds(self):
        session = SequencedOllamaSession(["not json at all", json.dumps(VALID_EXTRACTION)])
        result, outcome, reason = extractor.call_ollama_extraction("texte", "doc-1", "a" * 64, session=session)
        self.assertEqual(outcome, "after_repair")
        self.assertIsNone(reason)
        self.assertEqual(result["verdict"], "CONFIRMED_CDC")
        self.assertEqual(session.calls, 2)
        # The repair prompt must reference the earlier failure, never the
        # original document text.
        self.assertIn("not json at all", session.prompts[1])

    def test_invalid_json_after_repair_is_only_then_counted_as_failed(self):
        session = SequencedOllamaSession(["not json", "still not json"])
        result, outcome, reason = extractor.call_ollama_extraction("texte", "doc-1", "a" * 64, session=session)
        self.assertIsNone(result)
        self.assertEqual(outcome, "failed")
        self.assertEqual(reason, "ollama_invalid_json")
        self.assertEqual(session.calls, 2)  # exactly one repair attempt, never more

    def test_schema_violation_after_repair_is_only_then_counted_as_failed(self):
        bad_payload = dict(VALID_EXTRACTION)
        bad_payload["verdict"] = "NOT_A_REAL_VERDICT"
        session = SequencedOllamaSession([json.dumps(bad_payload), json.dumps(bad_payload)])
        result, outcome, reason = extractor.call_ollama_extraction("texte", "doc-1", "a" * 64, session=session)
        self.assertIsNone(result)
        self.assertEqual(outcome, "failed")
        self.assertEqual(reason, "ollama_schema_invalid")

    def test_repair_can_fix_a_schema_violation(self):
        bad_payload = dict(VALID_EXTRACTION)
        bad_payload["verdict"] = "NOT_A_REAL_VERDICT"
        session = SequencedOllamaSession([json.dumps(bad_payload), json.dumps(VALID_EXTRACTION)])
        result, outcome, reason = extractor.call_ollama_extraction("texte", "doc-1", "a" * 64, session=session)
        self.assertEqual(outcome, "after_repair")
        self.assertEqual(result["verdict"], "CONFIRMED_CDC")

    def test_unreachable_ollama_skips_the_repair_attempt_entirely(self):
        # _post_ollama_generate tries the structured-format attempt, then
        # falls back to plain "json" format once - both must fail for a
        # single logical call_ollama_extraction attempt to be exhausted.
        session = SequencedOllamaSession([
            ConnectionError("synthetic connection refused"),
            ConnectionError("synthetic connection refused"),
        ])
        result, outcome, reason = extractor.call_ollama_extraction("texte", "doc-1", "a" * 64, session=session)
        self.assertIsNone(result)
        self.assertEqual(outcome, "failed")
        self.assertEqual(reason, "ollama_unreachable")
        self.assertEqual(session.calls, 2)  # structured + json-fallback, then gives up - never reaches repair

    def test_markdown_fence_is_stripped_before_parsing(self):
        fenced = "```json\n" + json.dumps(VALID_EXTRACTION) + "\n```"
        session = SequencedOllamaSession([fenced])
        result, outcome, _reason = extractor.call_ollama_extraction("texte", "doc-1", "a" * 64, session=session)
        self.assertEqual(outcome, "first_try")
        self.assertEqual(result["verdict"], "CONFIRMED_CDC")

    def test_leading_and_trailing_prose_is_stripped_before_parsing(self):
        wrapped = "Voici le resultat demande :\n" + json.dumps(VALID_EXTRACTION) + "\nFin de la reponse."
        session = SequencedOllamaSession([wrapped])
        result, outcome, _reason = extractor.call_ollama_extraction("texte", "doc-1", "a" * 64, session=session)
        self.assertEqual(outcome, "first_try")
        self.assertEqual(result["verdict"], "CONFIRMED_CDC")

    def test_code_interne_concept_null_passes_validation(self):
        # The schema/prompt explicitly forbid inventing this field - null
        # must always be accepted.
        self.assertIsNone(VALID_EXTRACTION["identite"]["code_interne_concept"])
        session = FakeSession(ollama_payload=VALID_EXTRACTION)
        result, _outcome, _reason = extractor.call_ollama_extraction("texte", "doc-1", "a" * 64, session=session)
        self.assertIsNone(result["identite"]["code_interne_concept"])

    def test_missing_optional_identity_fields_are_normalized_to_null_not_failed(self):
        payload = dict(VALID_EXTRACTION)
        payload["identite"] = {}  # every optional field missing
        session = FakeSession(ollama_payload=payload)
        result, outcome, reason = extractor.call_ollama_extraction("texte", "doc-1", "a" * 64, session=session)
        self.assertEqual(outcome, "first_try")
        self.assertIsNone(reason)
        for key in ("titre_officiel", "annee_lancement", "pays", "bailleur", "code_interne_concept"):
            self.assertIsNone(result["identite"][key])

    def test_missing_some_criteria_keys_are_normalized_not_failed(self):
        payload = dict(VALID_EXTRACTION)
        payload["criteres"] = {"SS_AEP": {"statut": "Explicite"}}  # only 1 of 21
        session = FakeSession(ollama_payload=payload)
        result, outcome, _reason = extractor.call_ollama_extraction("texte", "doc-1", "a" * 64, session=session)
        self.assertEqual(outcome, "first_try")
        self.assertEqual(result["criteres"]["SS_AEP"]["statut"], "Explicite")
        self.assertEqual(result["criteres"]["NP_SUPERVISION"]["statut"], "Non déterminable")


class TestExtractJsonObject(unittest.TestCase):
    def test_plain_json_passes_through(self):
        self.assertEqual(extractor.extract_json_object('{"a": 1}'), '{"a": 1}')

    def test_strips_markdown_fence(self):
        self.assertEqual(extractor.extract_json_object('```json\n{"a": 1}\n```'), '{"a": 1}')

    def test_extracts_first_balanced_block_ignoring_surrounding_prose(self):
        raw = 'Voici le resultat: {"a": {"b": 1}} Merci pour votre patience.'
        self.assertEqual(extractor.extract_json_object(raw), '{"a": {"b": 1}}')

    def test_no_json_present_returns_text_unchanged(self):
        self.assertEqual(extractor.extract_json_object("no json here"), "no json here")


class TestValidateAndNormalize(unittest.TestCase):
    def test_missing_required_top_level_field_raises(self):
        with self.assertRaises(extractor.ExtractionError) as ctx:
            extractor.validate_and_normalize({"document_role": "CDC", "verdict": "NOT_CDC"})  # no criteres
        self.assertEqual(ctx.exception.reason_code, "ollama_schema_invalid")
        self.assertIn("criteres", ctx.exception.detail)

    def test_invalid_document_role_raises(self):
        payload = dict(VALID_EXTRACTION, document_role="NOT_A_ROLE")
        with self.assertRaises(extractor.ExtractionError):
            extractor.validate_and_normalize(payload)

    def test_non_dict_payload_raises(self):
        with self.assertRaises(extractor.ExtractionError) as ctx:
            extractor.validate_and_normalize(["not", "a", "dict"])
        self.assertEqual(ctx.exception.reason_code, "ollama_schema_invalid")


# =====================================================================
# Row assembly / sorting / Excel
# =====================================================================


class TestBuildRow(unittest.TestCase):
    def _candidate(self, project="SYNTH-A", relative_path="OFFRES 2020/SYNTH-A/Client/doc.pdf"):
        return extractor.CandidateFile(
            path=Path("/tmp/synthetic.pdf"), relative_path=relative_path, project=project,
            year=2020, extension="pdf", candidate_id="synthetic-id",
        )

    def test_successful_extraction_populates_all_columns(self):
        row = extractor.build_row(self._candidate(), VALID_EXTRACTION)
        self.assertEqual(row["Rôle"], "CDC")
        self.assertEqual(row["Verdict IA"], "CONFIRMED_CDC")
        self.assertEqual(row["Titre"], "Titre synthétique")
        self.assertEqual(row["Pays"], "Pays synthétique")
        self.assertEqual(row["Bailleur"], "Bailleur synthétique")
        for key in extractor.CRITERIA_KEYS:
            self.assertEqual(row[key], "Explicite")
        self.assertEqual(row["CDC ? (à valider)"], "")

    def test_failed_extraction_marks_every_criterion_as_non_determinable(self):
        row = extractor.build_row(self._candidate(), None)
        self.assertEqual(row["Rôle"], "EXTRACTION_FAILED")
        self.assertEqual(row["Verdict IA"], "EXTRACTION_FAILED")
        for key in extractor.CRITERIA_KEYS:
            self.assertEqual(row[key], "Non déterminable")

    def test_last_column_is_always_empty_for_the_supervisor(self):
        for extraction in (VALID_EXTRACTION, None):
            row = extractor.build_row(self._candidate(), extraction)
            self.assertEqual(row["CDC ? (à valider)"], "")

    def test_row_never_contains_raw_extracted_text(self):
        row = extractor.build_row(self._candidate(), VALID_EXTRACTION)
        serialized = repr(row)
        self.assertNotIn("MARKDOWN", serialized)


class TestSortRows(unittest.TestCase):
    def _row(self, project, verdict, filename):
        return {"Projet": project, "Verdict IA": verdict, "Fichier": filename}

    def test_sorted_by_project_first(self):
        rows = [self._row("Z-Project", "CONFIRMED_CDC", "a.pdf"), self._row("A-Project", "NOT_CDC", "b.pdf")]
        sorted_rows = extractor.sort_rows(rows)
        self.assertEqual([r["Projet"] for r in sorted_rows], ["A-Project", "Z-Project"])

    def test_highest_verdict_first_within_a_project(self):
        rows = [
            self._row("P", "NOT_CDC", "c.pdf"),
            self._row("P", "CONFIRMED_CDC", "a.pdf"),
            self._row("P", "NEEDS_HUMAN_REVIEW", "b.pdf"),
        ]
        sorted_rows = extractor.sort_rows(rows)
        self.assertEqual([r["Verdict IA"] for r in sorted_rows], ["CONFIRMED_CDC", "NEEDS_HUMAN_REVIEW", "NOT_CDC"])

    def test_unrecognized_verdict_sorts_last(self):
        rows = [self._row("P", "EXTRACTION_FAILED", "a.pdf"), self._row("P", "NOT_CDC", "b.pdf")]
        sorted_rows = extractor.sort_rows(rows)
        self.assertEqual(sorted_rows[-1]["Verdict IA"], "EXTRACTION_FAILED")


class TestWriteExcel(unittest.TestCase):
    def test_writes_expected_headers_and_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "review.xlsx"
            candidate = extractor.CandidateFile(
                path=Path("/tmp/x.pdf"), relative_path="OFFRES 2020/SYNTH-A/Client/x.pdf",
                project="SYNTH-A", year=2020, extension="pdf", candidate_id="id-1",
            )
            row = extractor.build_row(candidate, VALID_EXTRACTION)
            extractor.write_excel([row], output_path)

            import openpyxl
            workbook = openpyxl.load_workbook(output_path)
            sheet = workbook.active
            headers = [cell.value for cell in next(sheet.iter_rows(min_row=1, max_row=1))]
            self.assertEqual(tuple(headers), extractor.EXCEL_COLUMNS)
            data_row = [cell.value for cell in next(sheet.iter_rows(min_row=2, max_row=2))]
            self.assertEqual(data_row[headers.index("Projet")], "SYNTH-A")
            self.assertEqual(data_row[headers.index("Verdict IA")], "CONFIRMED_CDC")
            # openpyxl round-trips an empty-string cell as None - still
            # empty for the supervisor either way.
            self.assertIn(data_row[-1], ("", None))  # CDC ? (à valider)

    def test_has_exactly_21_criteria_columns(self):
        criteria_columns = [c for c in extractor.EXCEL_COLUMNS if c in extractor.CRITERIA_KEYS]
        self.assertEqual(len(criteria_columns), 21)


# =====================================================================
# Checkpoint / scope signature
# =====================================================================


class TestScopeSignature(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="cdc-extractor-test-"))
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)

    def test_signature_is_deterministic(self):
        config_a = extractor.build_scope_config(self.tmp_dir, 5)
        config_b = extractor.build_scope_config(self.tmp_dir, 5)
        self.assertEqual(extractor.compute_scope_signature(config_a), extractor.compute_scope_signature(config_b))

    def test_signature_changes_with_project_count(self):
        sig_a = extractor.compute_scope_signature(extractor.build_scope_config(self.tmp_dir, 5))
        sig_b = extractor.compute_scope_signature(extractor.build_scope_config(self.tmp_dir, 6))
        self.assertNotEqual(sig_a, sig_b)

    def test_signature_changes_with_archive_root(self):
        other_dir = self.tmp_dir / "other"
        other_dir.mkdir()
        sig_a = extractor.compute_scope_signature(extractor.build_scope_config(self.tmp_dir, 5))
        sig_b = extractor.compute_scope_signature(extractor.build_scope_config(other_dir, 5))
        self.assertNotEqual(sig_a, sig_b)

    def test_config_never_contains_archive_root_path_itself(self):
        config = extractor.build_scope_config(self.tmp_dir, 5)
        serialized = json.dumps(config)
        self.assertNotIn(str(self.tmp_dir), serialized)

    def test_describe_scope_mismatch_names_the_differing_dimension(self):
        old = {"project_count": 5, "model": "qwen3:14b"}
        new = {"project_count": 5, "model": "qwen3:30b"}
        message = extractor.describe_scope_mismatch(old, new)
        self.assertIn("model", message)
        self.assertNotIn("project_count:", message)


class TestCheckpointRoundtrip(unittest.TestCase):
    def test_roundtrips_through_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "checkpoint.json"
            checkpoint = extractor.Checkpoint(
                scope_signature="deadbeef", config={"model": "qwen3:14b"},
                completed_candidate_ids=["id-1", "id-2"],
                rows=[{"Projet": "SYNTH-A"}], counts={"candidates_found": 2},
            )
            extractor.save_checkpoint(path, checkpoint)
            loaded = extractor.load_checkpoint(path)
            self.assertEqual(loaded.scope_signature, "deadbeef")
            self.assertEqual(loaded.completed_candidate_ids, ["id-1", "id-2"])
            self.assertEqual(loaded.rows, [{"Projet": "SYNTH-A"}])

    def test_missing_file_loads_as_none(self):
        self.assertIsNone(extractor.load_checkpoint(Path("/tmp/definitely-does-not-exist-checkpoint.json")))

    def test_malformed_file_fails_closed_to_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "checkpoint.json"
            path.write_text("not valid json{{{", encoding="utf-8")
            self.assertIsNone(extractor.load_checkpoint(path))


# =====================================================================
# Full run() integration - synthetic archive, mocked session
# =====================================================================


class TestRunIntegration(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="cdc-extractor-test-"))
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)
        self.archive_root = self.tmp_dir / "archive"
        for project in ("SYNTH-A", "SYNTH-B"):
            client_dir = self.archive_root / "OFFRES 2020" / project / "Dossier Client"
            client_dir.mkdir(parents=True)
            write_synthetic_docx(client_dir / "cahier.docx", ["CAHIER DES CHARGES synthétique"])
        self.output_path = self.tmp_dir / "output" / "review.xlsx"
        self.checkpoint_path = self.output_path.with_suffix(".checkpoint.json")

    def test_dry_run_counts_only_no_excel_no_checkpoint(self):
        counts = extractor.run(self.archive_root, None, True, False, self.output_path, self.checkpoint_path)
        self.assertEqual(counts["projects_selected"], 2)
        self.assertEqual(counts["candidates_found"], 2)
        self.assertEqual(counts["external_calls"], 0)
        self.assertFalse(self.output_path.exists())
        self.assertFalse(self.checkpoint_path.exists())

    def test_pilot_limit_restricts_project_count(self):
        counts = extractor.run(self.archive_root, 1, True, False, self.output_path, self.checkpoint_path)
        self.assertEqual(counts["projects_selected"], 1)
        self.assertEqual(counts["candidates_found"], 1)

    def test_full_run_writes_excel_and_checkpoint(self):
        session = FakeSession()
        counts = extractor.run(self.archive_root, None, False, False, self.output_path, self.checkpoint_path, session=session)
        self.assertEqual(counts["candidates_processed"], 2)
        self.assertEqual(counts["candidates_failed"], 0)
        self.assertTrue(self.output_path.exists())
        self.assertTrue(self.checkpoint_path.exists())

    def test_idempotent_resume_skips_already_completed_candidates(self):
        session = FakeSession()
        extractor.run(self.archive_root, None, False, False, self.output_path, self.checkpoint_path, session=session)
        counts = extractor.run(self.archive_root, None, False, True, self.output_path, self.checkpoint_path, session=session)
        self.assertEqual(counts["candidates_skipped_done"], 2)
        self.assertEqual(counts["candidates_processed"], 0)

    def test_rerun_without_resume_on_incomplete_checkpoint_refuses(self):
        extractor.save_checkpoint(
            self.checkpoint_path,
            extractor.Checkpoint(
                scope_signature=extractor.compute_scope_signature(extractor.build_scope_config(self.archive_root, 2)),
                config=extractor.build_scope_config(self.archive_root, 2),
            ),
        )
        with self.assertRaises(RuntimeError):
            extractor.run(self.archive_root, None, False, False, self.output_path, self.checkpoint_path, session=FakeSession())

    def test_resume_with_mismatched_scope_refuses(self):
        extractor.save_checkpoint(
            self.checkpoint_path,
            extractor.Checkpoint(scope_signature="totally-different-signature", config={"project_count": 999}),
        )
        with self.assertRaises(RuntimeError):
            extractor.run(self.archive_root, None, False, True, self.output_path, self.checkpoint_path, session=FakeSession())

    def test_failed_extraction_still_produces_a_row(self):
        session = FakeSession(docling_fails=True)  # irrelevant here, docx path doesn't use Docling
        with patch.object(extractor, "extract_docx_text", side_effect=extractor.ExtractionError("docx_output_empty")):
            counts = extractor.run(self.archive_root, None, False, False, self.output_path, self.checkpoint_path, session=session)
        self.assertEqual(counts["candidates_failed"], 2)
        self.assertEqual(counts["candidates_processed"], 0)
        self.assertTrue(self.output_path.exists())

    def test_failure_reasons_are_tallied_by_short_safe_code(self):
        # A high failure rate must be diagnosable from aggregate output
        # alone - never by re-reading which file failed.
        with patch.object(extractor, "extract_docx_text", side_effect=extractor.ExtractionError("docx_output_empty")):
            counts = extractor.run(
                self.archive_root, None, False, False, self.output_path, self.checkpoint_path, session=FakeSession()
            )
        self.assertEqual(counts["failure_reasons"], {"docx_output_empty": 2})

    def test_process_candidate_returns_reason_code_on_failure_and_none_on_success(self):
        candidate = extractor.discover_candidates_in_project(
            extractor.enumerate_project_folders(self.archive_root)[0], self.archive_root
        )[0]
        result = extractor.process_candidate(candidate, session=FakeSession())
        self.assertIsNone(result["failure_reason"])
        self.assertEqual(result["ollama_outcome"], "first_try")
        self.assertEqual(result["row"]["Verdict IA"], "CONFIRMED_CDC")

        with patch.object(extractor, "extract_docx_text", side_effect=extractor.ExtractionError("docx_output_empty")):
            failed = extractor.process_candidate(candidate, session=FakeSession())
        self.assertEqual(failed["failure_reason"], "docx_output_empty")
        self.assertIsNone(failed["ollama_outcome"])  # extraction failed before Ollama was ever reached
        self.assertEqual(failed["row"]["Verdict IA"], "EXTRACTION_FAILED")

    def test_no_external_calls_counter_stays_zero(self):
        counts = extractor.run(self.archive_root, None, True, False, self.output_path, self.checkpoint_path)
        self.assertEqual(counts["external_calls"], 0)


# =====================================================================
# Confidentiality - stdout/log output must never contain a filename,
# path, project name, or document content.
# =====================================================================


class TestConfidentialOutput(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp(prefix="cdc-extractor-test-"))
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)
        self.archive_root = self.tmp_dir / "archive"
        client_dir = self.archive_root / "OFFRES 2020" / "SECRET_CLIENT_PROJECT_123" / "Dossier Client"
        client_dir.mkdir(parents=True)
        write_synthetic_docx(client_dir / "SECRET_FILENAME_MARKER.docx", ["SECRET_DOCUMENT_TEXT_XYZ"])
        self.output_path = self.tmp_dir / "output" / "review.xlsx"
        self.checkpoint_path = self.output_path.with_suffix(".checkpoint.json")

    def test_print_summary_never_leaks_markers(self):
        counts = {"projects_selected": 1, "candidates_found": 1, "candidates_processed": 1}
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            extractor._print_summary(counts)
        output = buffer.getvalue()
        self.assertNotIn("SECRET", output)

    def test_full_run_stdout_never_contains_filename_project_or_text(self):
        # main() never accepts a session override (it is not a CLI concern) -
        # session=requests is a late-bound default, so the correct way to
        # mock it here is patching requests.post/requests.get themselves
        # (same convention as patch.object(cdc.subprocess, "Popen", ...)
        # elsewhere in this project), not swapping the `requests` name.
        argv = ["--archive-root", str(self.archive_root), "--output", str(self.output_path),
                "--checkpoint-file", str(self.checkpoint_path)]
        session = FakeSession(docling_markdown="SECRET_DOCUMENT_TEXT_XYZ")
        buffer = io.StringIO()
        with patch.object(extractor.requests, "post", side_effect=session.post), \
             patch.object(extractor.requests, "get", side_effect=session.get), \
             redirect_stdout(buffer):
            exit_code = extractor.main(argv)
        output = buffer.getvalue()
        self.assertEqual(exit_code, 0)
        self.assertNotIn("SECRET_CLIENT_PROJECT_123", output)
        self.assertNotIn("SECRET_FILENAME_MARKER", output)
        self.assertNotIn("SECRET_DOCUMENT_TEXT_XYZ", output)
        # The Excel output path itself is safe to print (it's this tool's
        # own local deliverable, never a source-archive path).
        self.assertIn("output_excel_path", output)

    def test_excel_file_itself_is_allowed_to_contain_the_filename(self):
        # The Excel is the deliberate, local, human-facing exception - the
        # supervisor needs "Fichier" to find the source document.
        session = FakeSession()
        extractor.run(self.archive_root, None, False, False, self.output_path, self.checkpoint_path, session=session)
        import openpyxl
        workbook = openpyxl.load_workbook(self.output_path)
        sheet = workbook.active
        values = [cell.value for row in sheet.iter_rows(min_row=2) for cell in row]
        self.assertTrue(any("SECRET_FILENAME_MARKER" in str(v) for v in values if v))


# =====================================================================
# CLI
# =====================================================================


class TestCliGating(unittest.TestCase):
    def test_pilot_limit_must_be_positive(self):
        parser = extractor.build_arg_parser()
        args = parser.parse_args(["--pilot-limit", "0"])
        with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
            extractor._validate_args(parser, args)

    def test_resume_and_dry_run_are_mutually_exclusive(self):
        parser = extractor.build_arg_parser()
        args = parser.parse_args(["--resume", "--dry-run"])
        with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
            extractor._validate_args(parser, args)

    def test_valid_args_pass(self):
        parser = extractor.build_arg_parser()
        args = parser.parse_args(["--pilot-limit", "5", "--dry-run"])
        extractor._validate_args(parser, args)  # must not raise


class TestMainArchiveRootMissing(unittest.TestCase):
    def test_missing_archive_root_exits_1_without_raising(self):
        with redirect_stderr(io.StringIO()) as err:
            exit_code = extractor.main(["--archive-root", "/tmp/definitely-does-not-exist-cdc-archive-root"])
        self.assertEqual(exit_code, 1)
        self.assertIn("archive root not found", err.getvalue())


if __name__ == "__main__":
    unittest.main()
