from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("canonical.py")
SPEC = importlib.util.spec_from_file_location("concept_local_rag_canonical", MODULE_PATH)
assert SPEC and SPEC.loader
canonical = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(canonical)


class CanonicalContractTests(unittest.TestCase):
    def test_contract_has_exactly_34_unique_fields(self):
        self.assertEqual(len(canonical.EXTRACTION_FIELDS), 34)
        self.assertEqual(len(set(canonical.EXTRACTION_FIELDS)), 34)
        self.assertEqual(set(canonical.FIELD_ROUTES), set(canonical.EXTRACTION_FIELDS))

    def test_builder_is_canonical_and_escapes_values(self):
        fields = {
            key: {"value": "A & B" if key == "intitule_mission" else None, "supported": key == "intitule_mission", "source_chunks": ["chunk_1"] if key == "intitule_mission" else []}
            for key in canonical.EXTRACTION_FIELDS
        }
        evaluations = {
            "complexite_technique": {"note": 1, "justification": "Faible"},
            "difficulte_terrain": {"note": 1, "justification": "Faible"},
            "risque_sous_dimensionnement": {"note": 1, "charge_estimee": "Non documentée", "justification": "Faible"},
        }
        xml = canonical.build_xml("AO-TEST", fields, evaluations, canonical.deterministic_control(fields))
        canonical.validate_canonical_xml(xml)
        self.assertIn("A &amp; B", xml)
        self.assertIn(">Non trouvé<", xml)

    def test_grounding_rejects_unknown_citation_and_placeholder(self):
        self.assertFalse(canonical.validate_field("pays", {"value": "France", "supported": True, "source_chunks": ["chunk_2"]}, {"chunk_1": "France"})[0])
        self.assertFalse(canonical.validate_field("date_limite_depot", {"value": ".../.../2024", "supported": True, "source_chunks": ["chunk_1"]}, {"chunk_1": ".../.../2024"})[0])
        self.assertFalse(canonical.validate_field("credit_financement", {"value": "crédit", "supported": True, "source_chunks": ["chunk_1"]}, {"chunk_1": "accord de crédit"})[0])

    def test_null_requires_unsupported_without_citation(self):
        self.assertTrue(canonical.validate_field("pays", {"value": None, "supported": False, "source_chunks": []}, {})[0])
        self.assertFalse(canonical.validate_field("pays", {"value": None, "supported": True, "source_chunks": []}, {})[0])

    def test_malformed_canonical_xml_fails_closed(self):
        with self.assertRaises(ValueError):
            canonical.validate_canonical_xml("<fiche_projet><extraction /></fiche_projet>")

    def test_es_obligation_helper_matches_validator_behavior(self):
        # Regression for AO-20260824-1322: the shared helper must agree with
        # validate_field's own exigences_es grounding check on both sides.
        self.assertTrue(canonical.is_es_obligation_evidence("Le Consultant doit soumettre son Code de conduite EAS/HS"))
        self.assertFalse(canonical.is_es_obligation_evidence("Cadre environnemental et social du projet"))

    def test_six_field_semantic_guards(self):
        self.assertFalse(canonical.validate_field("contraintes_site", {"value": "Abidjan, Cocody", "supported": True, "source_chunks": ["chunk_1"]}, {"chunk_1": "Sites situés à Abidjan et Cocody"})[0])
        self.assertTrue(canonical.validate_field("contraintes_site", {"value": "ravinement et érosion", "supported": True, "source_chunks": ["chunk_1"]}, {"chunk_1": "Le site présente un ravinement et une érosion régressive"})[0])
        self.assertFalse(canonical.validate_field("exigences_es", {"value": "Expert avec huit ans d'expérience", "supported": True, "source_chunks": ["chunk_1"]}, {"chunk_1": "L'Expert doit avoir un diplôme et huit ans d'expérience"})[0])
        self.assertTrue(canonical.validate_field("exigences_es", {"value": "Code de conduite EAS/HS", "supported": True, "source_chunks": ["chunk_1"]}, {"chunk_1": "Le Consultant doit soumettre son Code de conduite EAS/HS"})[0])
        self.assertFalse(canonical.validate_field("disciplines_techniques", {"value": "Expert Hydraulicien", "supported": True, "source_chunks": ["chunk_1"]}, {"chunk_1": "Expert Hydraulicien"})[0])


if __name__ == "__main__":
    unittest.main()
