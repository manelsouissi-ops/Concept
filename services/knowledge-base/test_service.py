import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("kb_service", HERE / "service.py")
kb = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = kb
SPEC.loader.exec_module(kb)


class Response:
    def __init__(self, payload=None, status=200, text=""):
        self.payload, self.status_code, self.text = payload or {}, status, text
    def json(self): return self.payload
    def raise_for_status(self):
        if self.status_code >= 400: raise RuntimeError(f"HTTP {self.status_code}")


class DoclingSession:
    def __init__(self, states): self.states = iter(states)
    def post(self, *_args, **_kwargs): return Response({"status": "processing", "job_id": "job-1"})
    def get(self, *_args, **_kwargs): return Response(next(self.states))


class PipelineSession:
    def __init__(self, metadata=None, qdrant_status=200, embeddings=None):
        self.metadata = metadata or {}
        self.qdrant_status = qdrant_status
        self.embeddings = embeddings
    def post(self, url, **kwargs):
        if url.endswith("/convert"): return Response({"status": "processing", "job_id": "job-fixture"})
        if url.endswith("/api/generate"): return Response({"response": json.dumps(self.metadata)})
        if url.endswith("/api/embed"):
            count = len(kwargs["json"]["input"])
            vectors = self.embeddings if self.embeddings is not None else [[0.1, 0.2, 0.3] for _ in range(count)]
            return Response({"embeddings": vectors})
        raise AssertionError(url)
    def get(self, url, **_kwargs):
        if "/result/" in url: return Response({"status": "completed", "markdown": "# Identité\nProjet fixture textuel"})
        if "/collections/" in url: return Response({}, 404)
        return Response({})
    def put(self, _url, **_kwargs): return Response({}, self.qdrant_status, "qdrant fixture failure")


class FakeCatalog:
    def __init__(self, duplicate=False, updated=False, fail_success=False):
        self.duplicate, self.updated, self.fail_success = duplicate, updated, fail_success
        self.success_calls = self.failure_calls = 0
    def begin(self, _result): return {"duplicate": self.duplicate, "updated": self.updated, "document_id": 10, "version_id": 20}
    def success(self, _result, _metadata):
        self.success_calls += 1
        if self.fail_success: raise kb.StageError("CATALOG_FAILED", "catalog", "fixture failure")
    def failure(self, _result): self.failure_calls += 1


def valid_metadata():
    return {
        "language": "fr", "project_title": None, "country": None, "countries": [],
        "mission_type": None, "project_type": None, "sector": None, "subsector": None,
        "client": None, "contracting_authority": None, "funding_institution": None,
        "selection_method": None, "publication_date": None, "submission_deadline": None,
        "project_duration": None, "main_scope": None, "main_components": [], "services": [],
        "technical_requirements": [], "required_expertise": [], "key_personnel": [],
        "financial_conditions": None, "guarantees": [], "insurance_requirements": [],
        "contractual_conditions": None, "keywords": [], "internal_code": None,
        "extraction_confidence": None,
    }


class KnowledgeBaseTests(unittest.TestCase):
    def test_async_docling_polling(self):
        with tempfile.NamedTemporaryFile() as source:
            job, markdown = kb.poll_docling(source.name, DoclingSession([
                {"status": "processing"}, {"status": "completed", "markdown": "# Résultat"}
            ]), sleep=lambda _seconds: None)
        self.assertEqual(job, "job-1")
        self.assertEqual(markdown, "# Résultat")

    def test_docling_failure(self):
        with tempfile.NamedTemporaryFile() as source:
            with self.assertRaisesRegex(kb.StageError, "conversion refusée"):
                kb.poll_docling(source.name, DoclingSession([{"status": "failed", "error": "conversion refusée"}]), sleep=lambda _: None)

    def test_docling_timeout(self):
        clock_values = iter([0, 0, 2])
        with tempfile.NamedTemporaryFile() as source, patch.object(kb, "PARSE_TIMEOUT_SECS", 1):
            with self.assertRaises(kb.StageError) as caught:
                kb.poll_docling(source.name, DoclingSession([{"status": "processing"}]), sleep=lambda _: None, clock=lambda: next(clock_values))
        self.assertEqual(caught.exception.code, "PARSER_TIMEOUT")

    def test_long_paragraph_is_fully_represented(self):
        tokens = [f"TOKEN_{index:04d}" for index in range(800)]
        chunks = kb.section_aware_chunks("# Long\n" + " ".join(tokens), maximum=300, overlap=30)
        self.assertGreater(len(chunks), 2)
        combined = "\n".join(chunk.text for chunk in chunks)
        self.assertTrue(all(token in combined for token in tokens))
        self.assertIn(tokens[-1], combined)

    def test_section_and_subsection_provenance(self):
        chunks = kb.section_aware_chunks("# Identité\nTitre\n### Client\nAutorité X\n# Personnel\nChef de mission")
        self.assertEqual(chunks[0].section, "Identité")
        self.assertEqual(chunks[1].subsection, "Client")
        self.assertEqual(chunks[-1].section, "Personnel")
        self.assertIsNone(chunks[0].page)

    def test_metadata_evidence_uses_late_sections(self):
        markdown = "# Introduction\n" + ("généralités\n" * 20000) + "\n# Garanties contractuelles\nGarantie bancaire de bonne exécution."
        evidence = kb.select_metadata_evidence(markdown)
        self.assertIn("Garantie bancaire", evidence["financial_contractual"])

    def test_missing_metadata_normalizes_to_null_or_empty(self):
        metadata = kb.normalize_metadata({"language": "fr"})
        self.assertIsNone(metadata["country"])
        self.assertEqual(metadata["key_personnel"], [])

    def test_metadata_schema_validation(self):
        metadata = kb.normalize_metadata(valid_metadata())
        metadata.update({"document_id": "1", "document_version_id": "2", "source_filename": "fixture.txt", "source_path": "/fixture.txt", "source_hash": "a" * 64})
        kb.validate_metadata(metadata)
        metadata["language"] = "invented"
        with self.assertRaises(kb.StageError): kb.validate_metadata(metadata)

    def test_embedding_dimension_detection(self):
        self.assertEqual(kb.detect_embedding_dimension(PipelineSession(embeddings=[[0.0] * 1024])), 1024)

    def test_deterministic_point_ids(self):
        first = kb.deterministic_point_id(12, "a" * 64, 3)
        self.assertEqual(first, kb.deterministic_point_id(12, "a" * 64, 3))
        self.assertNotEqual(first, kb.deterministic_point_id(12, "a" * 64, 4))

    def test_duplicate_sha_skips_before_external_services(self):
        with tempfile.NamedTemporaryFile(suffix=".txt") as source:
            source.write(b"fixture text only"); source.flush()
            result = kb.ingest_document(source.name, catalog=FakeCatalog(duplicate=True), session=object())
        self.assertEqual(result.status, "SKIPPED_DUPLICATE")
        self.assertEqual(result.document_version_id, 20)

    def test_same_filename_new_sha_is_updated(self):
        self.assertEqual(kb.logical_document_key("Même Nom.pdf"), kb.logical_document_key("même nom.PDF"))
        with tempfile.NamedTemporaryFile(suffix=".txt") as source:
            source.write(b"changed text fixture"); source.flush()
            catalog = FakeCatalog(updated=True)
            result = kb.ingest_document(source.name, catalog=catalog, session=PipelineSession(valid_metadata()))
        self.assertEqual(result.status, "SUCCESS")
        self.assertEqual(result.outcome, "UPDATED")

    def test_catalog_failure_prevents_success(self):
        with tempfile.NamedTemporaryFile(suffix=".txt") as source:
            source.write(b"fixture"); source.flush()
            result = kb.ingest_document(source.name, catalog=FakeCatalog(fail_success=True), session=PipelineSession(valid_metadata()))
        self.assertEqual(result.status, "FAILED")
        self.assertEqual(result.error_code, "CATALOG_FAILED")

    def test_qdrant_failure_prevents_success(self):
        with tempfile.NamedTemporaryFile(suffix=".txt") as source:
            source.write(b"fixture"); source.flush()
            result = kb.ingest_document(source.name, catalog=FakeCatalog(), session=PipelineSession(valid_metadata(), qdrant_status=500))
        self.assertEqual(result.status, "FAILED")
        self.assertEqual(result.error_code, "QDRANT_FAILED")

    def test_embedding_count_mismatch_prevents_success(self):
        with tempfile.NamedTemporaryFile(suffix=".txt") as source:
            source.write(b"fixture"); source.flush()
            result = kb.ingest_document(source.name, catalog=FakeCatalog(), session=PipelineSession(valid_metadata(), embeddings=[]))
        self.assertEqual(result.status, "FAILED")
        self.assertEqual(result.error_code, "EMBEDDING_MISMATCH")


if __name__ == "__main__": unittest.main()
