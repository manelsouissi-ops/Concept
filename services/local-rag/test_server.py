from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
import hashlib
from pathlib import Path
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("server.py")
SPEC = importlib.util.spec_from_file_location("concept_local_rag_server", MODULE_PATH)
assert SPEC and SPEC.loader
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)


class LocalRagBoundaryTests(unittest.TestCase):
    def request_fixture(self, root: Path):
        code = "AO-TEST"
        path = root / code / "cdc.md"
        path.parent.mkdir(parents=True)
        path.write_text("# Safe CDC", encoding="utf-8")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        payload = {"contract_version": server.CONTRACT_VERSION, "appel_offre_id": 1, "code_interne": code, "document_id": 2, "markdown_path": str(path), "markdown_content_hash": "sha256:" + digest}
        tender = {"appel_offre_id": 1, "code_interne": code, "document_id": 2, "markdown_path": path}
        return payload, tender

    def test_invalid_markdown_hash_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload, tender = self.request_fixture(root)
            payload["markdown_content_hash"] = "sha256:" + "0" * 64
            with patch.object(server, "DATA_ROOT", root), patch.object(server, "resolve_tender", return_value=tender):
                with self.assertRaisesRegex(server.ServiceError, "hash mismatch"):
                    server.validate_request(payload)

    def test_tender_document_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload, tender = self.request_fixture(root)
            payload["document_id"] = 999
            with patch.object(server, "DATA_ROOT", root), patch.object(server, "resolve_tender", return_value=tender):
                with self.assertRaisesRegex(server.ServiceError, "metadata mismatch"):
                    server.validate_request(payload)

    def test_collection_name_is_tender_and_hash_scoped(self):
        left = server.collection_name({"appel_offre_id": 1}, "a" * 64)
        right = server.collection_name({"appel_offre_id": 2}, "a" * 64)
        changed = server.collection_name({"appel_offre_id": 1}, "b" * 64)
        self.assertEqual(len({left, right, changed}), 3)

    def test_two_tenders_cannot_share_collection_identity(self):
        tender_a = server.collection_name({"appel_offre_id": 101}, "a" * 64)
        tender_b = server.collection_name({"appel_offre_id": 202}, "b" * 64)
        self.assertNotEqual(tender_a, tender_b)
        self.assertIn("_101_", tender_a)
        self.assertIn("_202_", tender_b)

    def test_malformed_local_json_fails_after_one_correction(self):
        malformed = (["not", "an", "object"], {"wall_seconds": 0.01})
        with patch.object(server, "ollama_generate", side_effect=[malformed, malformed]) as generate:
            answer, metrics = server.extract_group("identification", ("pays",), {"chunk_1": "Pays : Côte d'Ivoire"})
        self.assertEqual(answer, {})
        self.assertTrue(metrics["validation_failures"])
        self.assertEqual(generate.call_count, 2)

    def test_es_exact_sentence_fallback_after_bounded_correction(self):
        null = ({"exigences_es": {"value": None, "supported": False, "source_chunks": []}}, {"wall_seconds": 0.01})
        evidence = {"chunk_1": "Ce DTPM incorpore des dispositions pour refléter le Cadre Environnemental et Social de la Banque, et adresser l'EAS et le HS."}
        with patch.object(server, "ollama_generate", side_effect=[null, null]) as generate:
            answer, metrics = server.extract_group("site_contraintes", ("exigences_es",), evidence)
        self.assertTrue(metrics["deterministic_fallback"])
        self.assertEqual(answer["exigences_es"]["source_chunks"], ["chunk_1"])
        self.assertEqual(generate.call_count, 2)

    def test_constraint_exact_sentence_fallback_after_bounded_correction(self):
        null = ({"contraintes_site": {"value": None, "supported": False, "source_chunks": []}}, {"wall_seconds": 0.01})
        evidence = {"chunk_1": "Les sites étant indépendants, il y aura un décalage de huit mois entre les deux missions."}
        with patch.object(server, "ollama_generate", side_effect=[null, null]) as generate:
            answer, metrics = server.extract_group("site_contraintes", ("contraintes_site",), evidence)
        self.assertTrue(metrics["deterministic_fallback"])
        self.assertEqual(answer["contraintes_site"]["source_chunks"], ["chunk_1"])
        self.assertEqual(generate.call_count, 2)

    def test_compact_snippet_keeps_field_anchor_and_heading(self):
        text = "Bruit générique. " * 250 + "Le délai de réalisation de la mission est de 90 jours calendaires, soit 03 mois. " + "Fin générique. " * 100
        snippet = server.compact_field_snippet("duree_totale", text, "8. LIEU ET DURÉE DE LA MISSION")
        self.assertIn("90 jours calendaires", snippet)
        self.assertIn("LIEU ET DURÉE", snippet)
        self.assertLessEqual(len(snippet), 3200)

    def test_personnel_table_continuations_are_bounded_and_preserved(self):
        from llama_index.core.schema import TextNode
        nodes = [TextNode(id_=f"n{index}", text=f"Désignation des experts | Expert {index} | Temps de mobilisation", metadata={"chunk_profile": "compact_table", "section_family": "personnel", "section_heading": "Personnel", "chunk_index": f"table_1_{index}"}) for index in range(7)]
        ranked = [{"node": nodes[0], "dense_rank": 1, "lexical_rank": 1, "routed_rank": 1, "fused_rank": 1, "reranked_rank": 1}]
        selected = server.select_field_candidates("profils_cles", ranked, nodes)
        self.assertEqual(len(selected), 5)
        self.assertEqual(selected[0]["node"].node_id, "n0")
        self.assertIn("n4", {item["node"].node_id for item in selected})

    def test_site_sections_aggregate_without_personnel_tables(self):
        from llama_index.core.schema import TextNode
        sites = [TextNode(id_=f"s{index}", text=f"Zone {index}: localisation des travaux", metadata={"chunk_profile": "structured_section", "section_family": "sites", "section_heading": f"Site {index}", "chunk_index": f"section_{index}"}) for index in range(3)]
        personnel = TextNode(id_="p", text="Désignation des experts | Qualification | Temps de mobilisation", metadata={"chunk_profile": "compact_table", "section_family": "sites", "section_heading": "Personnel", "chunk_index": "table_1"})
        selected = server.select_field_candidates("zone_execution", [], [*sites, personnel])
        self.assertEqual({item["node"].node_id for item in selected}, {"s0", "s1", "s2"})

    def test_semantic_comparison_accepts_supported_wording_variant(self):
        self.assertTrue(
            server.values_agree(
                "Sélection fondée sur la Qualité technique et le Coût (SFQC)",
                "Sélection Fondée sur la Qualité et le Coût (SFQC)",
            )
        )

    def test_semantic_comparison_rejects_different_values(self):
        self.assertFalse(server.values_agree("06/08/2024", "08/06/2024"))

    def test_shadow_log_is_idempotent_for_job_and_correlation(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            server.os.environ, {"LOCAL_RAG_SHADOW_LOG_DIR": directory}
        ):
            record = {
                "processing_job_id": "job-1",
                "correlation_id": "correlation-1",
                "code_interne": "AO-TEST",
            }
            path, first_recorded = server.write_shadow_log(record)
            _, second_recorded = server.write_shadow_log(record)
            self.assertTrue(first_recorded)
            self.assertFalse(second_recorded)
            self.assertEqual(len(path.read_text(encoding="utf-8").splitlines()), 1)

    def test_xml_comparison_reads_all_canonical_extraction_fields(self):
        fields = "".join(f'<{key} source="x">value</{key}>' for key in server.EXTRACTION_FIELDS)
        xml = f"<fiche_projet><extraction>{fields}</extraction></fiche_projet>"
        values = server.xml_values(xml)
        self.assertEqual(values["reference_officielle"], "value")
        self.assertEqual(set(values), set(server.XML_FIELD_MAP))

    def test_health_fails_when_ollama_is_unavailable(self):
        with patch.object(server, "OLLAMA_URL", "http://127.0.0.1:1"):
            with self.assertRaises(Exception):
                server.health()

    def test_health_fails_when_qdrant_is_unavailable(self):
        fake_tags = {
            "models": [
                {"name": server.EMBEDDING_MODEL},
                {"name": server.MODEL},
            ]
        }
        response = unittest.mock.MagicMock()
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        response.read.return_value = json.dumps(fake_tags).encode()
        with patch.object(server, "urlopen", return_value=response), patch.object(
            server, "QdrantClient", side_effect=RuntimeError("qdrant unavailable")
        ):
            with self.assertRaisesRegex(RuntimeError, "qdrant unavailable"):
                server.health()

    def test_invalid_json_log_lines_do_not_break_idempotency(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            server.os.environ, {"LOCAL_RAG_SHADOW_LOG_DIR": directory}
        ):
            path = Path(directory) / "AO-TEST.jsonl"
            path.write_text("not-json\n", encoding="utf-8")
            _, recorded = server.write_shadow_log(
                {
                    "processing_job_id": "job-2",
                    "correlation_id": "correlation-2",
                    "code_interne": "AO-TEST",
                }
            )
            self.assertTrue(recorded)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8").splitlines()[-1])["processing_job_id"], "job-2")


if __name__ == "__main__":
    unittest.main()
