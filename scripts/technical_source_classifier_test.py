#!/usr/bin/env python3
"""Synthetic test suite for scripts/technical_source_classifier.py.

SYNTHETIC DATA ONLY. Every text sample below is invented for testing - no
real archive filenames, paths, project names, client names, or document
content appears anywhere in this file. This module has zero I/O of its
own, so these tests never touch the database, the filesystem (beyond the
test file itself), or a real archive document.
"""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("technical_source_classifier", HERE / "technical_source_classifier.py")
tsc = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = tsc
SPEC.loader.exec_module(tsc)


# =====================================================================
# Synthetic fixtures - one per Task 15 role scenario (1-10)
# =====================================================================

PURE_CDC_TEXT = """
CAHIER DES CHARGES

1. Objet de la mission
Le present document decrit l'objet de la mission confiee au consultant.

2. Specifications techniques
Les specifications techniques attendues sont detaillees ci-dessous.

3. Livrables
La liste des livrables attendus est precisee dans cette section.
"""

PURE_TDR_TEXT = """
TERMES DE REFERENCE

1. Contexte et justification
Le present contexte decrit la justification de la mission synthetique.

2. Objectifs
Les objectifs de la mission sont enumeres ci-dessous.

3. Methodologie
La methodologie proposee doit etre detaillee par le consultant.
"""

DAO_WITH_TDR_TEXT = """
DOSSIER D'APPEL D'OFFRES

Instructions aux soumissionnaires

SECTION 2 - TERMES DE REFERENCE

1. Contexte
2. Objectifs
3. Etendue des prestations
4. Specifications techniques
5. Experts requis et experience requise
6. Methodologie proposee
7. Livrables
8. Criteres d'evaluation
9. Calendrier de la mission
"""

DAO_WITH_CDC_TEXT = """
APPEL D'OFFRES

Instructions aux soumissionnaires

ANNEXE - CAHIER DES CHARGES

1. Objet de la mission et etendue des prestations
2. Specifications techniques exigees
3. Livrables attendus
4. Obligations du consultant
5. Pieces administratives requises
"""

PURE_DAO_NO_TECHNICAL_SECTION_TEXT = """
DOSSIER D'APPEL D'OFFRES

Reglement de la consultation. Les soumissionnaires sont invites a
deposer leur pli avant la date limite indiquee dans l'avis. Aucune
information technique complementaire n'est fournie dans cet extrait
administratif synthetique de test.
"""

DCE_TEXT = """
DCE - DOSSIER DE CONSULTATION DES ENTREPRISES

Le present dossier de consultation regroupe les pieces necessaires a la
consultation synthetique de test decrite dans cet extrait administratif.
"""

RFP_TEXT = """
REQUEST FOR PROPOSAL

This synthetic RFP invites consultants to submit a proposal for a
generic assignment described only at a high level in this test extract.
"""

OFFER_TEXT = """
NOTRE OFFRE TECHNIQUE ET FINANCIERE

Nous avons l'honneur de vous soumettre notre offre technique et
financiere en reponse a votre consultation synthetique de test.
"""

REPORT_TEXT = """
RAPPORT DE MISSION

Le present rapport de mission synthetique presente l'avancement des
travaux realises par le consultant au cours de la periode consideree.
"""

METHODOLOGY_TEXT = """
NOTE METHODOLOGIQUE

La presente note methodologique decrit la methodologie proposee par
CONCEPT pour la realisation de la mission synthetique de test.
"""

ADMINISTRATIVE_TEXT = (
    "FACTURE\n\nMontant total synthetique. Merci de proceder au paiement "
    "sous 30 jours conformement aux conditions generales de vente. " * 3
)

# Structural-fingerprint-strength fixtures (Task 15: strong/partial/weak).
STRONG_STRUCTURAL_TEXT = """
Contexte et justification de la mission.
Objectifs de la mission synthetique.
Etendue des prestations demandees dans le cadre de cette mission.
Specifications techniques exigees pour ce document synthetique.
Phase 1 de la mission puis phase 2 de la mission.
Methodologie proposee par le consultant.
Experts requis pour la realisation de la mission.
Experience requise des experts proposes.
Livrables attendus au terme de la mission.
Calendrier et duree de la mission synthetique.
Criteres d'evaluation des propositions recues.
Obligations du soumissionnaire dans le cadre de cette consultation.
Pieces administratives requises pour la soumission.
Conditions de paiement applicables au present contrat.
"""

PARTIAL_STRUCTURAL_TEXT = """
Objectifs de la mission synthetique.
Specifications techniques exigees pour ce document synthetique.
Livrables attendus au terme de la mission.
Calendrier de la mission synthetique.
Experts requis pour la realisation de la mission.
"""

WEAK_STRUCTURAL_TEXT = "Ceci est un extrait synthetique sans structure technique particuliere."


class TestClassifyTechnicalSourceRoleScenarios(unittest.TestCase):
    """Task 15, scenarios 1-10."""

    def test_scenario_1_pure_cdc(self):
        result = tsc.classify_technical_source(PURE_CDC_TEXT)
        self.assertEqual(result.detected_role, "CDC")
        self.assertTrue(result.technical_source_candidate)

    def test_scenario_2_pure_tdr(self):
        result = tsc.classify_technical_source(PURE_TDR_TEXT)
        self.assertEqual(result.detected_role, "TDR")
        self.assertTrue(result.technical_source_candidate)

    def test_scenario_3_dao_containing_tdr(self):
        result = tsc.classify_technical_source(DAO_WITH_TDR_TEXT)
        self.assertEqual(result.detected_role, "DAO_WITH_TDR")
        self.assertTrue(result.technical_source_candidate)
        self.assertEqual(result.review_priority, "HIGH_PRIORITY")

    def test_scenario_4_dao_containing_cdc(self):
        result = tsc.classify_technical_source(DAO_WITH_CDC_TEXT)
        self.assertEqual(result.detected_role, "DAO_WITH_CDC")
        self.assertTrue(result.technical_source_candidate)
        self.assertEqual(result.review_priority, "HIGH_PRIORITY")

    def test_scenario_5_pure_dao_no_technical_section(self):
        result = tsc.classify_technical_source(PURE_DAO_NO_TECHNICAL_SECTION_TEXT)
        self.assertEqual(result.detected_role, "DAO")
        # A DAO wrapper with no embedded technical content is not, by
        # itself, treated as a source document - Task 2's rule cuts both
        # ways: DAO_WITH_TDR/CDC is valid, a bare DAO is not automatically.
        self.assertFalse(result.technical_source_candidate)

    def test_scenario_6_dce(self):
        result = tsc.classify_technical_source(DCE_TEXT)
        self.assertEqual(result.detected_role, "DCE")
        self.assertTrue(result.technical_source_candidate)

    def test_scenario_7_rfp(self):
        result = tsc.classify_technical_source(RFP_TEXT)
        self.assertEqual(result.detected_role, "RFP")
        self.assertTrue(result.technical_source_candidate)

    def test_scenario_8_offer_is_never_a_candidate(self):
        result = tsc.classify_technical_source(OFFER_TEXT)
        self.assertEqual(result.detected_role, "OFFER")
        self.assertFalse(result.technical_source_candidate)
        self.assertIsNone(result.review_priority)

    def test_scenario_9_report_is_never_a_candidate(self):
        result = tsc.classify_technical_source(REPORT_TEXT)
        self.assertEqual(result.detected_role, "REPORT")
        self.assertFalse(result.technical_source_candidate)
        self.assertIsNone(result.review_priority)

    def test_scenario_10_irrelevant_administrative_file(self):
        result = tsc.classify_technical_source(ADMINISTRATIVE_TEXT)
        self.assertIn(result.detected_role, ("UNKNOWN", "OTHER"))
        self.assertFalse(result.technical_source_candidate)
        self.assertIsNone(result.review_priority)

    def test_methodology_is_never_a_candidate(self):
        result = tsc.classify_technical_source(METHODOLOGY_TEXT)
        self.assertEqual(result.detected_role, "METHODOLOGY")
        self.assertFalse(result.technical_source_candidate)


class TestStructuralFingerprint(unittest.TestCase):
    """Task 15: strong/partial/weak structural fingerprint bands."""

    def test_strong_full_technical_document(self):
        fingerprint = tsc.compute_structural_fingerprint(STRONG_STRUCTURAL_TEXT)
        self.assertEqual(fingerprint.band, "STRONG_TECHNICAL_SOURCE")
        self.assertEqual(fingerprint.max_score, tsc.STRUCTURAL_MAX_SCORE)
        self.assertGreaterEqual(fingerprint.ratio, tsc.STRUCTURAL_BAND_STRONG_RATIO)
        self.assertTrue(all(fingerprint.signals.values()))

    def test_partial_technical_document(self):
        fingerprint = tsc.compute_structural_fingerprint(PARTIAL_STRUCTURAL_TEXT)
        self.assertIn(fingerprint.band, ("POSSIBLE_TECHNICAL_SOURCE", "STRONG_TECHNICAL_SOURCE"))
        self.assertGreater(fingerprint.score, 0)
        self.assertLess(fingerprint.score, fingerprint.max_score)

    def test_weak_document(self):
        fingerprint = tsc.compute_structural_fingerprint(WEAK_STRUCTURAL_TEXT)
        self.assertEqual(fingerprint.band, "WEAK_TECHNICAL_SOURCE")
        self.assertEqual(fingerprint.score, 0)

    def test_band_thresholds_are_constants_and_directly_testable(self):
        # Exercises classify_structural_band directly against the exact
        # threshold boundaries - proves the bands are driven by the named
        # constants, not inline magic numbers.
        self.assertEqual(tsc.classify_structural_band(tsc.STRUCTURAL_BAND_STRONG_RATIO), "STRONG_TECHNICAL_SOURCE")
        self.assertEqual(
            tsc.classify_structural_band(tsc.STRUCTURAL_BAND_STRONG_RATIO - 0.01), "POSSIBLE_TECHNICAL_SOURCE"
        )
        self.assertEqual(tsc.classify_structural_band(tsc.STRUCTURAL_BAND_POSSIBLE_RATIO), "POSSIBLE_TECHNICAL_SOURCE")
        self.assertEqual(
            tsc.classify_structural_band(tsc.STRUCTURAL_BAND_POSSIBLE_RATIO - 0.01), "WEAK_TECHNICAL_SOURCE"
        )
        self.assertEqual(tsc.classify_structural_band(0.0), "WEAK_TECHNICAL_SOURCE")

    def test_important_technical_signals_are_weighted_more_heavily(self):
        self.assertEqual(tsc.STRUCTURAL_SIGNAL_WEIGHTS["scope_or_prestations"], 2)
        self.assertEqual(tsc.STRUCTURAL_SIGNAL_WEIGHTS["technical_requirements"], 2)
        self.assertEqual(tsc.STRUCTURAL_SIGNAL_WEIGHTS["deliverables"], 2)
        self.assertEqual(tsc.STRUCTURAL_SIGNAL_WEIGHTS["objectives"], 1)
        self.assertEqual(tsc.STRUCTURAL_MAX_SCORE, sum(tsc.STRUCTURAL_SIGNAL_WEIGHTS.values()))

    def test_all_fourteen_signals_present(self):
        self.assertEqual(len(tsc.STRUCTURAL_SIGNAL_PATTERNS), 14)
        self.assertEqual(len(tsc.STRUCTURAL_SIGNAL_WEIGHTS), 14)
        self.assertEqual(set(tsc.STRUCTURAL_SIGNAL_PATTERNS.keys()), set(tsc.STRUCTURAL_SIGNAL_WEIGHTS.keys()))


class TestMixedRoleDetection(unittest.TestCase):
    def test_dao_with_tdr_never_forced_into_pure_tdr_or_dao(self):
        role = tsc.classify_technical_source_role(DAO_WITH_TDR_TEXT)
        self.assertNotEqual(role, "TDR")
        self.assertNotEqual(role, "DAO")
        self.assertEqual(role, "DAO_WITH_TDR")

    def test_dao_with_cdc_never_forced_into_pure_cdc_or_dao(self):
        role = tsc.classify_technical_source_role(DAO_WITH_CDC_TEXT)
        self.assertNotEqual(role, "CDC")
        self.assertNotEqual(role, "DAO")
        self.assertEqual(role, "DAO_WITH_CDC")

    def test_section_flags_reflect_the_embedded_section_not_just_the_wrapper(self):
        result = tsc.classify_technical_source(DAO_WITH_TDR_TEXT)
        self.assertTrue(result.section_flags["has_tdr_section"])
        self.assertFalse(result.section_flags["has_cdc_section"])

    def test_all_roles_are_from_the_required_taxonomy(self):
        for text in (
            PURE_CDC_TEXT, PURE_TDR_TEXT, DAO_WITH_TDR_TEXT, DAO_WITH_CDC_TEXT,
            PURE_DAO_NO_TECHNICAL_SECTION_TEXT, DCE_TEXT, RFP_TEXT, OFFER_TEXT,
            REPORT_TEXT, METHODOLOGY_TEXT, ADMINISTRATIVE_TEXT,
        ):
            role = tsc.classify_technical_source_role(text)
            self.assertIn(role, tsc.TECHNICAL_SOURCE_ROLES)

    def test_taxonomy_contains_exactly_the_required_roles(self):
        self.assertEqual(
            set(tsc.TECHNICAL_SOURCE_ROLES),
            {
                "CDC", "TDR", "DAO_WITH_TDR", "DAO_WITH_CDC", "DAO", "DCE", "RFP",
                "OFFER", "REPORT", "METHODOLOGY", "OTHER", "UNKNOWN",
            },
        )


class TestSectionFlagsNeverLeakRawText(unittest.TestCase):
    def test_section_flags_are_booleans_only(self):
        result = tsc.classify_technical_source(DAO_WITH_TDR_TEXT)
        for value in result.section_flags.values():
            self.assertIsInstance(value, bool)

    def test_classification_dataclass_never_carries_raw_text(self):
        result = tsc.classify_technical_source(STRONG_STRUCTURAL_TEXT)
        # Every field is a short label/int/float/bool/dict-of-bool - never
        # a string long enough to be an excerpt of the source text.
        self.assertLessEqual(len(result.detected_role), 20)
        self.assertIsInstance(result.structural_score, int)
        self.assertIsInstance(result.structural_ratio, float)


class TestMetadataPrefilter(unittest.TestCase):
    """Task 4/15 - Stage A prefilter. Metadata alone never produces a
    final validation - only is_content_inspection_candidate."""

    def test_strong_term_relevant_extension_and_bucket_is_a_candidate(self):
        result = tsc.classify_prefilter("cahier des charges.pdf", "OFFRES 2020/P/cahier des charges.pdf", "pdf", "BUSINESS_DOCUMENT")
        self.assertTrue(result.is_content_inspection_candidate)

    def test_unclassified_technical_bucket_is_treated_as_relevant(self):
        # Fail OPEN for recall when Phase 2 classification has not run yet.
        result = tsc.classify_prefilter("termes de reference.pdf", "OFFRES 2020/P/termes de reference.pdf", "pdf", None)
        self.assertTrue(result.technical_bucket_relevant)
        self.assertTrue(result.is_content_inspection_candidate)

    def test_non_business_document_bucket_is_not_relevant(self):
        result = tsc.classify_prefilter("cahier des charges.pdf", "OFFRES 2020/P/cahier des charges.pdf", "pdf", "IMAGE")
        self.assertFalse(result.technical_bucket_relevant)
        self.assertFalse(result.is_content_inspection_candidate)

    def test_irrelevant_extension_is_rejected_even_with_a_strong_term(self):
        result = tsc.classify_prefilter("cahier des charges.jpg", "OFFRES 2020/P/cahier des charges.jpg", "jpg", "BUSINESS_DOCUMENT")
        self.assertFalse(result.extension_relevant)
        self.assertFalse(result.is_content_inspection_candidate)

    def test_no_matched_term_is_rejected_even_with_relevant_extension(self):
        result = tsc.classify_prefilter("photo site.pdf", "OFFRES 2020/P/photo site.pdf", "pdf", "BUSINESS_DOCUMENT")
        self.assertFalse(result.matched_term)
        self.assertFalse(result.is_content_inspection_candidate)

    def test_xlsx_only_relevant_when_filename_also_matches_a_strong_term(self):
        no_term = tsc.classify_prefilter("budget.xlsx", "OFFRES 2020/P/budget.xlsx", "xlsx", "BUSINESS_DOCUMENT")
        self.assertFalse(no_term.extension_relevant)
        with_term = tsc.classify_prefilter("dao budget.xlsx", "OFFRES 2020/P/dao budget.xlsx", "xlsx", "BUSINESS_DOCUMENT")
        self.assertTrue(with_term.extension_relevant)

    def test_prefilter_never_produces_a_role_or_final_validation(self):
        # Task 4: "Metadata alone MUST NEVER produce final validation." -
        # PrefilterClassification structurally has no role/score/validation
        # field at all, only booleans about candidacy for Stage B.
        result = tsc.classify_prefilter("cahier des charges.pdf", "OFFRES 2020/P/cahier des charges.pdf", "pdf", "BUSINESS_DOCUMENT")
        self.assertFalse(hasattr(result, "detected_role"))
        self.assertFalse(hasattr(result, "validation_status"))


class TestExtractionFailureCategoryMapping(unittest.TestCase):
    """.DOC/LibreOffice pipeline repair: each new reason_code must map to
    the specific, distinguishable category the review workflow needs -
    never all collapsing back into one ambiguous bucket."""

    def test_new_reason_codes_map_to_the_new_specific_categories(self):
        expected = {
            "libreoffice_missing": "CONVERSION_FAILED",
            "libreoffice_process_failed": "CONVERSION_FAILED",
            "libreoffice_timeout": "CONVERSION_TIMEOUT",
            "libreoffice_output_missing": "CONVERSION_NO_OUTPUT",
            "libreoffice_output_zero_bytes": "CONVERSION_NO_OUTPUT",
            "libreoffice_output_not_a_file": "CONVERSION_NO_OUTPUT",
            "libreoffice_output_invalid_docx": "INVALID_DOCX_OUTPUT",
            "extracted_text_empty": "EMPTY_EXTRACTED_TEXT",
            "encrypted_or_protected": "ENCRYPTED_OR_PROTECTED",
            "source_format_mismatch": "SOURCE_FORMAT_MISMATCH",
        }
        for reason_code, category in expected.items():
            self.assertEqual(tsc.categorize_extraction_failure_reason(reason_code), category)

    def test_new_categories_are_registered_in_the_stable_enum(self):
        for category in (
            "CONVERSION_NO_OUTPUT", "CONVERSION_FAILED", "CONVERSION_TIMEOUT",
            "INVALID_DOCX_OUTPUT", "EMPTY_EXTRACTED_TEXT", "ENCRYPTED_OR_PROTECTED",
            "SOURCE_FORMAT_MISMATCH",
        ):
            self.assertIn(category, tsc.EXTRACTION_FAILURE_CATEGORIES)

    def test_old_empty_output_category_is_kept_for_backward_compatibility(self):
        # Never removed: PDF's ocr_not_available still maps here, and
        # already-persisted rows from before this repair use this value.
        self.assertIn("EMPTY_OUTPUT", tsc.EXTRACTION_FAILURE_CATEGORIES)
        self.assertEqual(tsc.categorize_extraction_failure_reason("ocr_not_available"), "EMPTY_OUTPUT")

    def test_unrenamed_reason_codes_are_unaffected(self):
        self.assertEqual(tsc.categorize_extraction_failure_reason("doc_path_missing"), "MISSING_SOURCE")
        self.assertEqual(tsc.categorize_extraction_failure_reason("docx_read_failed"), "DOCX_EXTRACTION_FAILURE")
        self.assertEqual(tsc.categorize_extraction_failure_reason("docx_xml_parse_failed"), "DOCX_EXTRACTION_FAILURE")


if __name__ == "__main__":
    unittest.main()
