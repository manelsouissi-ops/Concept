from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "rag"))
sys.path.insert(0, str(ROOT / "services" / "local-rag"))

from llama_index.core.schema import TextNode
from benchmark_qwen3_14b_hybrid import populated_financing_matter, populated_front_matter, section_family, section_route_score  # noqa: E402


class SectionRoutingTests(unittest.TestCase):
    def node(self, text, family="procurement", heading="Données particulières"):
        return TextNode(text=text, metadata={"section_family": family, "section_heading": heading, "chunk_profile": "structured_section"})

    def test_heading_drives_schedule_and_equipment_families(self):
        self.assertEqual(section_family("8. LIEU ET DURÉE DE LA MISSION", None, "90 jours"), "schedule")
        self.assertEqual(section_family("7. MOYENS LOGISTIQUES", None, "matériel"), "equipment")

    def test_financing_facts_ignore_earlier_toc_section_heading(self):
        markdown = """## Section 2 Instructions aux Candidats et Données particulières
TOC only
## DP No : REF-TEST-1/2026
## Services
Désignation de la Mission : Mission test
Prêt/Crédit/Don No :
Crédit IDA N°12345
Le Gouvernement a reçu un financement de l'Association Internationale de Développement (IDA) en vue de financer le coût du Projet Exemple.
## Section 2 Instructions aux Candidats
Body
"""
        compact = populated_financing_matter(markdown)
        self.assertIn("Crédit IDA N°12345", compact or "")
        self.assertIn("Projet Exemple", compact or "")
        self.assertNotIn("TOC only", compact or "")

    def test_targeted_procedure_evidence_beats_templates(self):
        good = section_route_score("type_proposition", self.node("15.2 Le Consultant doit fournir une Proposition technique complète (PTC)."))[0]
        template = section_route_score("type_proposition", self.node("INSTRUCTIONS : insérez puis sélectionnez Proposition technique complète (PTC) ou simplifiée (PTS)."))[0]
        self.assertGreater(good, template)

    def test_minimum_score_is_distinct_from_weighting(self):
        minimum = section_route_score("note_technique_minimale", self.node("La note technique (Nt) minimum de qualification est : 75 points"))[0]
        weighting = section_route_score("note_technique_minimale", self.node("Pondération T = 80% et F = 20%"))[0]
        self.assertGreater(minimum, weighting)

    def test_es_obligation_beats_expert_qualification(self):
        obligation = section_route_score("exigences_es", self.node("Le Consultant doit soumettre son Code de Conduite EAS/HS", "environmental_social"))[0]
        qualification = section_route_score("exigences_es", self.node("Expert: diplôme et huit années d'expérience", "environmental_social"))[0]
        self.assertGreater(obligation, qualification)

    def test_populated_simplified_proposal_beats_template_alternatives(self):
        populated = section_route_score("type_proposition", self.node("| 15.2 | Le Consultant doit fournir une Proposition technique Simplifiée (PTS). |"))[0]
        template = section_route_score("type_proposition", self.node("Les Données particulières indiquent si une Proposition technique complète (PTC) ou simplifiée (PTS) est utilisée."))[0]
        self.assertGreater(populated, template)

    def test_generic_clause_number_does_not_make_alternatives_populated(self):
        generic = self.node("15.2 En fonction de la nature de la mission, fournir une PTC ou une Proposition Technique Simplifiée (PTS) comme précisé ailleurs.")
        populated = self.node("| 15.2 | Le Consultant doit fournir une Proposition technique Simplifiée (PTS). |")
        self.assertGreater(section_route_score("type_proposition", populated)[0], section_route_score("type_proposition", generic)[0])

    def test_numbered_financing_label_beats_generic_financing_text(self):
        numbered = section_route_score("credit_financement", self.node("Crédit No : IDA-1234-CI", "financing"))[0]
        generic = section_route_score("credit_financement", self.node("Le projet est financé sous la forme d'un accord de crédit.", "financing"))[0]
        self.assertGreater(numbered, generic)

    def test_cover_extractor_accepts_dossier_heading_and_split_values(self):
        markdown = """## DOSSIER DE DEMANDE DE PROPOSITIONS SERVICES DE CONSULTANTS
DP No :
DP-TEST-2026
Client :
Agence Exemple
Pays :
Côte d'Ivoire
Emis le :
01/02/2026
## TABLE DES MATIÈRES
template
"""
        compact = populated_front_matter(markdown)
        self.assertIn("DP No: DP-TEST-2026", compact or "")
        self.assertIn("Client: Agence Exemple", compact or "")
        self.assertIn("Pays: Côte d'Ivoire", compact or "")

    def test_current_mission_statement_beats_historical_project_context(self):
        current = section_route_score("intitule_mission", self.node("Désignation de la Mission : Suivi et contrôle des travaux actuels", "front_matter"))[0]
        historical = section_route_score("intitule_mission", self.node("Les études antérieurement réalisées en 2020 concernaient un ancien projet.", "scope"))[0]
        self.assertGreater(current, historical)

    def test_operative_es_clause_beats_definition(self):
        operative = section_route_score("exigences_es", self.node("Le Consultant doit mettre en œuvre le plan de gestion environnementale et sociale.", "environmental_social"))[0]
        definition = section_route_score("exigences_es", self.node("L'expression ES signifie environnemental et social.", "environmental_social"))[0]
        self.assertGreater(operative, definition)


if __name__ == "__main__":
    unittest.main()
