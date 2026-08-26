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
    def test_authoritative_default_uses_proven_qwen_model(self):
        self.assertEqual(server.MODEL, "qwen3:14b")

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

    def test_multiple_sites_route_beats_component_section(self):
        from llama_index.core.schema import TextNode
        locations = TextNode(id_="locations", text="Sites d'intervention : Localité Alpha; Localité Bêta; Localité Gamma", metadata={"chunk_profile": "structured_section", "section_family": "sites", "section_heading": "Sites d'intervention", "chunk_index": "section_sites"})
        components = TextNode(id_="components", text="Chaque site comprend une prise, un réservoir et une conduite.", metadata={"chunk_profile": "structured_section", "section_family": "technical", "section_heading": "Composantes", "chunk_index": "section_components"})
        self.assertGreater(server.section_route_score("nombre_sites", locations)[0], server.section_route_score("nombre_sites", components)[0])

    def test_key_profile_candidates_include_split_table_but_not_support_table(self):
        from llama_index.core.schema import TextNode
        key = TextNode(id_="key", text="Composition de l'équipe | Personnel clé | Chef de mission | Spécialiste eau", metadata={"chunk_profile": "compact_table", "section_family": "personnel", "section_heading": "Experts clés", "chunk_index": "table_key"})
        support = TextNode(id_="support", text="Personnel d'appui | Chauffeur | Secrétaire", metadata={"chunk_profile": "compact_table", "section_family": "personnel", "section_heading": "Personnel d'appui", "chunk_index": "table_support"})
        selected = server.select_field_candidates("nombre_profils_experts", [], [key, support])
        self.assertEqual([item["node"].node_id for item in selected], ["key"])

    def test_standards_sections_are_aggregated_across_generic_headings(self):
        from llama_index.core.schema import TextNode
        nodes = [
            TextNode(id_="code", text="Le titulaire doit respecter le code technique explicitement applicable.", metadata={"chunk_profile": "structured_section", "section_family": "standards", "section_heading": "Codes applicables", "chunk_index": "section_code"}),
            TextNode(id_="manual", text="Les prestations doivent suivre le manuel de référence nommé dans le dossier.", metadata={"chunk_profile": "structured_section", "section_family": "standards", "section_heading": "Documents de référence", "chunk_index": "section_manual"}),
        ]
        selected = server.select_field_candidates("normes_referentiels", [], nodes)
        self.assertEqual({item["node"].node_id for item in selected}, {"code", "manual"})

    def test_accented_issue_date_candidate_is_selected_from_front_matter(self):
        from llama_index.core.schema import TextNode
        date = TextNode(id_="date", text="Émis le : 03/04/2026", metadata={"chunk_profile": "compact_front_matter", "section_family": "front_matter", "section_heading": "Avis", "chunk_index": "front"})
        generic = TextNode(id_="generic", text="Calendrier général sans date d'émission.", metadata={"chunk_profile": "structured_section", "section_family": "schedule", "section_heading": "Calendrier", "chunk_index": "schedule"})
        selected = server.select_field_candidates("date_emission", [], [generic, date])
        self.assertEqual([item["node"].node_id for item in selected], ["date"])

    def test_multi_phase_assignment_has_canonical_duration_and_phase_rules(self):
        rules = server.CANONICAL_INTERPRETATION_RULES
        self.assertIn("assignment execution period", rules["duree_totale"])
        self.assertIn("EXHAUSTIVE", rules["phases_mission"])

    def test_procedure_prompt_separates_document_method_and_proposal_terms(self):
        prompt = server.group_prompt("procedure", ("type_procedure",), {"chunk_1": "Avis de procédure générique."})
        self.assertIn("Do not substitute the consultant selection method", prompt)

    def test_exigences_es_prefers_obligation_chunk_over_top_ranked_intro(self):
        # Regression for AO-20260824-1322: the top-ranked chunk for exigences_es
        # was the E&S section's intro sentence (no obligation language); the
        # actual obligation clause ranked #3 and was previously never offered
        # to the model because the field is limited to a single candidate.
        from llama_index.core.schema import TextNode
        intro = TextNode(id_="intro", text="Cadre environnemental et social du projet et présentation générale.", metadata={"chunk_profile": "structured_section", "section_family": "environmental_social", "section_heading": "E&S", "chunk_index": "section_1"})
        scope = TextNode(id_="scope", text="Le projet est situé dans une zone périurbaine sensible.", metadata={"chunk_profile": "structured_section", "section_family": "environmental_social", "section_heading": "E&S", "chunk_index": "section_2"})
        obligation = TextNode(id_="obligation", text="Le Consultant doit soumettre son Code de conduite EAS/HS avant le démarrage.", metadata={"chunk_profile": "structured_section", "section_family": "environmental_social", "section_heading": "E&S", "chunk_index": "section_3"})
        ranked = [
            {"node": intro, "dense_rank": 1, "lexical_rank": 1, "routed_rank": 1, "fused_rank": 1, "reranked_rank": 1},
            {"node": scope, "dense_rank": 2, "lexical_rank": 2, "routed_rank": 2, "fused_rank": 2, "reranked_rank": 2},
            {"node": obligation, "dense_rank": 3, "lexical_rank": 3, "routed_rank": 3, "fused_rank": 3, "reranked_rank": 3},
        ]
        selected = server.select_field_candidates("exigences_es", ranked, [intro, scope, obligation])
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["node"].node_id, "obligation")

    def test_exigences_es_falls_back_to_top_rank_when_no_obligation_in_window(self):
        from llama_index.core.schema import TextNode
        intro = TextNode(id_="intro", text="Cadre environnemental et social du projet et présentation générale.", metadata={"chunk_profile": "structured_section", "section_family": "environmental_social", "section_heading": "E&S", "chunk_index": "section_1"})
        scope = TextNode(id_="scope", text="Le projet est situé dans une zone périurbaine sensible.", metadata={"chunk_profile": "structured_section", "section_family": "environmental_social", "section_heading": "E&S", "chunk_index": "section_2"})
        ranked = [
            {"node": intro, "dense_rank": 1, "lexical_rank": 1, "routed_rank": 1, "fused_rank": 1, "reranked_rank": 1},
            {"node": scope, "dense_rank": 2, "lexical_rank": 2, "routed_rank": 2, "fused_rank": 2, "reranked_rank": 2},
        ]
        selected = server.select_field_candidates("exigences_es", ranked, [intro, scope])
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["node"].node_id, "intro")

    def test_semantic_comparison_accepts_supported_wording_variant(self):
        self.assertTrue(
            server.values_agree(
                "Sélection fondée sur la Qualité technique et le Coût (SFQC)",
                "Sélection Fondée sur la Qualité et le Coût (SFQC)",
            )
        )

    def test_shadow_comparison_has_exact_34_field_statuses(self):
        local = {
            "fields": {
                key: {"value": None, "source_chunks": []}
                for key in server.EXTRACTION_FIELDS
            },
            "validation": {"passed": True},
        }
        local["fields"]["reference_officielle"]["value"] = "DP 123"
        xml = server.build_xml(
            "AO-TEST",
            local["fields"],
            {
                "complexite_technique": {"note": 1, "justification": "Test"},
                "difficulte_terrain": {"note": 1, "justification": "Test"},
                "risque_sous_dimensionnement": {"note": 1, "justification": "Test", "charge_estimee": "Test"},
            },
            server.deterministic_control(local["fields"]),
        )
        comparison = server.compare_shadow(local, xml)
        self.assertEqual(comparison["fields_total"], 34)
        self.assertEqual(len(comparison["fields"]), 34)
        self.assertEqual(comparison["fields"]["reference_officielle"]["match_status"], "EXACT_MATCH")
        self.assertEqual(comparison["both_null"], 33)

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
