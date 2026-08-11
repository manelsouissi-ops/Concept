from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "rag"))
sys.path.insert(0, str(ROOT / "services" / "local-rag"))

from benchmark_qwen3_14b_hybrid import populated_financing_matter, section_family  # noqa: E402


class SectionRoutingTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
