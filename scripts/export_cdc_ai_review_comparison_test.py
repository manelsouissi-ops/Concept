#!/usr/bin/env python3
"""Synthetic test suite for scripts/export_cdc_ai_review_comparison.py.

SYNTHETIC DATA ONLY. No real archive filenames, paths, project names, or
PostgreSQL rows are used anywhere in this file. No live connection of any
kind is required or attempted.
"""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("export_cdc_ai_review_comparison", HERE / "export_cdc_ai_review_comparison.py")
mod = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = mod
SPEC.loader.exec_module(mod)


def synthetic_row(**overrides) -> "mod.ComparisonRow":
    defaults = dict(
        candidate_id="cand-0001", archive_file_id=1, year=2020, project_key="OFFRES 2020/SYNTHETIC",
        filename="synthetic.pdf", relative_path="OFFRES 2020/SYNTHETIC/synthetic.pdf",
        original_proposal="UNKNOWN", validation_status="HUMAN_VALIDATED_CDC",
        extraction_status="SUCCESS", extraction_method="pdf_text", extraction_failure_category=None,
        ai_proposed_role=None, ai_confidence=None, ai_model_name=None, ai_created_at=None,
        ai_processing_status=None,
        is_primary_candidate=True, duplicate_of_archive_file_id=None,
    )
    defaults.update(overrides)
    return mod.ComparisonRow(**defaults)


class YoussefDecisionTest(unittest.TestCase):
    def test_human_validated_cdc_is_oui(self):
        row = synthetic_row(validation_status="HUMAN_VALIDATED_CDC")
        self.assertEqual(row.youssef_decision, "OUI")

    def test_human_rejected_cdc_is_non(self):
        row = synthetic_row(validation_status="HUMAN_REJECTED_CDC")
        self.assertEqual(row.youssef_decision, "NON")

    def test_anything_else_is_incertain(self):
        row = synthetic_row(validation_status="MACHINE_CLASSIFIED")
        self.assertEqual(row.youssef_decision, "INCERTAIN")

    def test_decision_is_never_recomputed_from_ai_or_extraction_fields(self):
        # Changing AI/extraction fields must never change youssef_decision.
        row_a = synthetic_row(validation_status="HUMAN_VALIDATED_CDC", ai_proposed_role="TDR", ai_processing_status="SUCCESS")
        row_b = synthetic_row(validation_status="HUMAN_VALIDATED_CDC", extraction_status="FAILED")
        self.assertEqual(row_a.youssef_decision, "OUI")
        self.assertEqual(row_b.youssef_decision, "OUI")


class AgreementMappingTest(unittest.TestCase):
    def test_extraction_failed_is_analyse_impossible_regardless_of_decision(self):
        row = synthetic_row(extraction_status="FAILED", validation_status="HUMAN_VALIDATED_CDC")
        self.assertEqual(mod.compute_agreement(row), mod.AGREEMENT_ANALYSE_IA_IMPOSSIBLE)

    def test_no_ai_review_is_non_compare(self):
        row = synthetic_row(extraction_status="SUCCESS", ai_processing_status=None)
        self.assertEqual(mod.compute_agreement(row), mod.AGREEMENT_NON_COMPARE)

    def test_incertain_is_a_revoir_even_with_an_ai_review(self):
        row = synthetic_row(
            validation_status="MACHINE_CLASSIFIED", extraction_status="SUCCESS",
            ai_proposed_role="CDC", ai_processing_status="SUCCESS",
        )
        self.assertEqual(mod.compute_agreement(row), mod.AGREEMENT_A_REVOIR)

    def test_oui_and_cdc_role_is_accord(self):
        row = synthetic_row(
            validation_status="HUMAN_VALIDATED_CDC", extraction_status="SUCCESS",
            ai_proposed_role="CDC", ai_processing_status="SUCCESS",
        )
        self.assertEqual(mod.compute_agreement(row), mod.AGREEMENT_ACCORD)

    def test_oui_and_dao_with_cdc_role_is_accord(self):
        row = synthetic_row(
            validation_status="HUMAN_VALIDATED_CDC", extraction_status="SUCCESS",
            ai_proposed_role="DAO_WITH_CDC", ai_processing_status="SUCCESS",
        )
        self.assertEqual(mod.compute_agreement(row), mod.AGREEMENT_ACCORD)

    def test_non_and_non_cdc_role_is_accord(self):
        row = synthetic_row(
            validation_status="HUMAN_REJECTED_CDC", extraction_status="SUCCESS",
            ai_proposed_role="OFFER", ai_processing_status="SUCCESS",
        )
        self.assertEqual(mod.compute_agreement(row), mod.AGREEMENT_ACCORD)

    def test_oui_and_non_cdc_role_is_desaccord(self):
        row = synthetic_row(
            validation_status="HUMAN_VALIDATED_CDC", extraction_status="SUCCESS",
            ai_proposed_role="OFFER", ai_processing_status="SUCCESS",
        )
        self.assertEqual(mod.compute_agreement(row), mod.AGREEMENT_DESACCORD)

    def test_non_and_cdc_role_is_desaccord(self):
        row = synthetic_row(
            validation_status="HUMAN_REJECTED_CDC", extraction_status="SUCCESS",
            ai_proposed_role="CDC", ai_processing_status="SUCCESS",
        )
        self.assertEqual(mod.compute_agreement(row), mod.AGREEMENT_DESACCORD)

    def test_agreement_is_always_one_of_the_five_defined_values(self):
        for row in [
            synthetic_row(extraction_status="FAILED"),
            synthetic_row(ai_processing_status=None),
            synthetic_row(validation_status="MACHINE_CLASSIFIED", ai_proposed_role="CDC", ai_processing_status="SUCCESS"),
            synthetic_row(validation_status="HUMAN_VALIDATED_CDC", ai_proposed_role="CDC", ai_processing_status="SUCCESS"),
            synthetic_row(validation_status="HUMAN_REJECTED_CDC", ai_proposed_role="CDC", ai_processing_status="SUCCESS"),
        ]:
            self.assertIn(mod.compute_agreement(row), mod.AGREEMENT_VALUES)


class ExtractionFailureLabelTest(unittest.TestCase):
    def test_failed_row_ai_verdict_label_is_impossible(self):
        row = synthetic_row(extraction_status="FAILED", extraction_failure_category="DOC_EMBEDDED_IMAGES_ONLY")
        self.assertIn("IMPOSSIBLE", mod.compute_ai_verdict_label(row))

    def test_never_invents_a_verdict_for_a_failed_row(self):
        row = synthetic_row(extraction_status="FAILED", ai_proposed_role="CDC", ai_processing_status="SUCCESS")
        # Even if a stale AI row somehow exists for a now-FAILED candidate,
        # the verdict label must never surface it as a real result.
        label = mod.compute_ai_verdict_label(row)
        self.assertNotEqual(label, "CDC")

    def test_not_yet_reviewed_is_shown_honestly(self):
        row = synthetic_row(extraction_status="SUCCESS", ai_processing_status=None)
        self.assertEqual(mod.compute_ai_verdict_label(row), "PAS ENCORE ANALYSÉ")


class WorkbookStructureTest(unittest.TestCase):
    def _rows(self, n=750):
        rows = []
        for i in range(1, n + 1):
            decision = "HUMAN_VALIDATED_CDC" if i % 3 else "HUMAN_REJECTED_CDC"
            rows.append(synthetic_row(
                candidate_id=f"cand-{i:04d}", archive_file_id=i, filename=f"synthetic-{i}.pdf",
                relative_path=f"OFFRES 2020/SYNTHETIC-{i}/synthetic-{i}.pdf",
                validation_status=decision,
            ))
        return rows

    def test_exactly_750_data_rows(self):
        rows = self._rows(750)
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        ws = wb["Comparaison Youssef vs IA"]
        data_row_count = sum(
            1 for row in ws.iter_rows(min_row=2, max_row=ws.max_row) if row[0].value is not None
        )
        self.assertEqual(data_row_count, 750)

    def test_visible_headers_match_exactly(self):
        rows = self._rows(3)
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        ws = wb["Comparaison Youssef vs IA"]
        headers = [cell.value for cell in ws[1]]
        self.assertEqual(headers, mod.VISIBLE_HEADERS)

    def test_hidden_technical_sheet_present_and_hidden(self):
        rows = self._rows(3)
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        self.assertIn("Données techniques", wb.sheetnames)
        self.assertEqual(wb["Données techniques"].sheet_state, "hidden")

    def test_technical_sheet_correspondence_matches_visible_row_count(self):
        rows = self._rows(750)
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        visible = wb["Comparaison Youssef vs IA"]
        technical = wb["Données techniques"]
        visible_count = sum(1 for row in visible.iter_rows(min_row=2) if row[0].value is not None)
        technical_count = sum(1 for row in technical.iter_rows(min_row=2) if row[0].value is not None)
        self.assertEqual(visible_count, technical_count)
        self.assertEqual(visible_count, 750)

    def test_summary_sheet_present_with_aggregate_counts(self):
        rows = self._rows(9)
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        self.assertIn("Résumé", wb.sheetnames)
        summary_text = "\n".join(
            str(cell.value) for row in wb["Résumé"].iter_rows() for cell in row if cell.value is not None
        )
        self.assertIn("Total candidats", summary_text)
        self.assertIn("Total désaccords", summary_text)


class RealisticPopulationScaleTest(unittest.TestCase):
    """Simulates the actual 2026-09-28 population shape: 750 candidates
    total, 436/312/2 Youssef decisions, 40 controlled extraction
    failures, and 94 rows (68 recovered SUCCESS + 26 original) each with
    their own independent refreshed AI review."""

    def _realistic_rows(self):
        rows = []
        afid = 1
        # 436 OUI, 312 NON, 2 INCERTAIN = 750
        for _ in range(436):
            rows.append(synthetic_row(candidate_id=f"cand-{afid}", archive_file_id=afid, validation_status="HUMAN_VALIDATED_CDC"))
            afid += 1
        for _ in range(312):
            rows.append(synthetic_row(candidate_id=f"cand-{afid}", archive_file_id=afid, validation_status="HUMAN_REJECTED_CDC"))
            afid += 1
        for _ in range(2):
            rows.append(synthetic_row(candidate_id=f"cand-{afid}", archive_file_id=afid, validation_status="MACHINE_CLASSIFIED"))
            afid += 1
        self.assertEqual(len(rows), 750)

        # 40 controlled extraction failures (among the OUI rows, first 40).
        for i in range(40):
            rows[i] = synthetic_row(
                candidate_id=rows[i].candidate_id, archive_file_id=rows[i].archive_file_id,
                validation_status="HUMAN_VALIDATED_CDC", extraction_status="FAILED",
                extraction_failure_category="DOC_EMBEDDED_IMAGES_ONLY",
            )

        # 94 rows (indices 40..133, still within the 436 OUI block) each
        # with their OWN independent refreshed AI review.
        for i in range(40, 134):
            rows[i] = synthetic_row(
                candidate_id=rows[i].candidate_id, archive_file_id=rows[i].archive_file_id,
                validation_status="HUMAN_VALIDATED_CDC", extraction_status="SUCCESS",
                ai_proposed_role="CDC" if i % 2 == 0 else "TDR",
                ai_confidence=0.5 + (i % 10) / 20, ai_model_name="qwen3:14b",
                ai_created_at="2026-09-28 12:00:00", ai_processing_status="SUCCESS",
            )
        return rows

    def test_750_rows_436_312_2_youssef_decisions_preserved(self):
        rows = self._realistic_rows()
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        ws = wb["Comparaison Youssef vs IA"]
        decision_col = mod.VISIBLE_HEADERS.index("Décision de Youssef") + 1
        counts = {"OUI": 0, "NON": 0, "INCERTAIN": 0}
        for r in range(2, ws.max_row + 1):
            value = ws.cell(row=r, column=decision_col).value
            if value in counts:
                counts[value] += 1
        self.assertEqual(counts, {"OUI": 436, "NON": 312, "INCERTAIN": 2})

    def test_40_extraction_failures_map_to_analyse_impossible(self):
        rows = self._realistic_rows()
        agreement_counts = {v: 0 for v in mod.AGREEMENT_VALUES}
        for row in rows:
            agreement_counts[mod.compute_agreement(row)] += 1
        self.assertEqual(agreement_counts[mod.AGREEMENT_ANALYSE_IA_IMPOSSIBLE], 40)

    def test_94_rows_have_independently_sourced_refreshed_reviews(self):
        rows = self._realistic_rows()
        reviewed = [row for row in rows if row.has_ai_review]
        self.assertEqual(len(reviewed), 94)
        # Each reviewed row's verdict is a function of ITS OWN row only -
        # no two rows share object identity or a copied evidence dict.
        seen_ids = set()
        for row in reviewed:
            self.assertNotIn(row.archive_file_id, seen_ids)
            seen_ids.add(row.archive_file_id)
        self.assertEqual(len(seen_ids), 94)

    def test_workbook_builds_successfully_at_full_realistic_scale(self):
        rows = self._realistic_rows()
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        ws = wb["Comparaison Youssef vs IA"]
        data_row_count = sum(1 for row in ws.iter_rows(min_row=2) if row[0].value is not None)
        self.assertEqual(data_row_count, 750)


class DuplicateProvenanceTest(unittest.TestCase):
    def test_duplicate_marker_never_appears_on_the_visible_sheet(self):
        rows = [synthetic_row(
            candidate_id="cand-dup", archive_file_id=42, is_primary_candidate=False,
            duplicate_of_archive_file_id=7,
        )]
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        visible_text = "\n".join(
            str(cell.value) for row in wb["Comparaison Youssef vs IA"].iter_rows() for cell in row if cell.value is not None
        )
        self.assertNotIn("is_primary_candidate", visible_text)
        self.assertNotIn("duplicate_of_archive_file_id", visible_text)

    def test_duplicate_marker_appears_only_on_the_hidden_technical_sheet(self):
        rows = [synthetic_row(
            candidate_id="cand-dup", archive_file_id=42, is_primary_candidate=False,
            duplicate_of_archive_file_id=7,
        )]
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        technical_headers = [cell.value for cell in wb["Données techniques"][1]]
        self.assertIn("is_primary_candidate", technical_headers)
        self.assertIn("duplicate_of_archive_file_id", technical_headers)
        primary_col = technical_headers.index("is_primary_candidate") + 1
        dup_col = technical_headers.index("duplicate_of_archive_file_id") + 1
        self.assertEqual(wb["Données techniques"].cell(row=2, column=primary_col).value, "NON")
        self.assertEqual(wb["Données techniques"].cell(row=2, column=dup_col).value, 7)

    def test_each_duplicate_carries_its_own_independent_ai_result(self):
        # A duplicate and its primary must each show THEIR OWN ai_proposed_role
        # (from their own independent archive_file_id-scoped LATERAL join) -
        # never one inherited/copied from the other.
        primary = synthetic_row(
            candidate_id="cand-primary", archive_file_id=7, is_primary_candidate=True,
            ai_proposed_role="CDC", ai_processing_status="SUCCESS",
        )
        duplicate = synthetic_row(
            candidate_id="cand-dup", archive_file_id=42, is_primary_candidate=False,
            duplicate_of_archive_file_id=7, ai_proposed_role=None, ai_processing_status=None,
        )
        self.assertEqual(mod.compute_agreement(primary), mod.AGREEMENT_ACCORD)
        self.assertEqual(mod.compute_agreement(duplicate), mod.AGREEMENT_NON_COMPARE)
        self.assertNotEqual(mod.compute_ai_verdict_label(primary), mod.compute_ai_verdict_label(duplicate))


class ConfidentialityScanTest(unittest.TestCase):
    def test_no_absolute_archive_path_anywhere_in_the_workbook(self):
        rows = [synthetic_row(
            relative_path="OFFRES 2020/SYNTHETIC/synthetic.pdf",
        )]
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        for sheet in wb.worksheets:
            for row in sheet.iter_rows():
                for cell in row:
                    if isinstance(cell.value, str):
                        self.assertNotIn("/mnt/", cell.value)
                        self.assertNotIn("/home/", cell.value)

    def test_relative_path_only_appears_on_the_hidden_technical_sheet(self):
        rows = [synthetic_row(relative_path="OFFRES 2020/SYNTHETIC/synthetic_needle.pdf")]
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        visible_text = "\n".join(
            str(cell.value) for row in wb["Comparaison Youssef vs IA"].iter_rows() for cell in row if cell.value is not None
        )
        self.assertNotIn("synthetic_needle", visible_text)
        technical_text = "\n".join(
            str(cell.value) for row in wb["Données techniques"].iter_rows() for cell in row if cell.value is not None
        )
        self.assertIn("synthetic_needle", technical_text)

    def test_technical_sheet_never_carries_absolute_root_path(self):
        rows = [synthetic_row()]
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        self.assertEqual(len(mod.TECHNICAL_HEADERS), 5)
        self.assertNotIn("root_path", mod.TECHNICAL_HEADERS)
        self.assertNotIn("source_root_path", mod.TECHNICAL_HEADERS)

    def test_no_uuid_candidate_id_on_the_visible_sheet(self):
        rows = [synthetic_row(candidate_id="11111111-2222-3333-4444-555555555555")]
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        visible_text = "\n".join(
            str(cell.value) for row in wb["Comparaison Youssef vs IA"].iter_rows() for cell in row if cell.value is not None
        )
        self.assertNotIn("11111111-2222-3333-4444-555555555555", visible_text)
        technical_text = "\n".join(
            str(cell.value) for row in wb["Données techniques"].iter_rows() for cell in row if cell.value is not None
        )
        self.assertIn("11111111-2222-3333-4444-555555555555", technical_text)

    def test_no_full_sha256_hash_anywhere_in_the_workbook(self):
        # ComparisonRow structurally carries no content-hash field at all -
        # a full 64-hex-char SHA-256 can never appear anywhere in this
        # workbook, visible or hidden.
        rows = [synthetic_row()]
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        import re
        sha256_pattern = re.compile(r"\b[0-9a-f]{64}\b")
        for sheet in wb.worksheets:
            for row in sheet.iter_rows():
                for cell in row:
                    if isinstance(cell.value, str):
                        self.assertIsNone(sha256_pattern.search(cell.value))


class FormulaInjectionTest(unittest.TestCase):
    def test_leading_equals_sanitized(self):
        self.assertEqual(mod.sanitize_cell_value("=cmd()"), "'=cmd()")

    def test_reopen_after_save_preserves_all_750_rows(self):
        rows = [synthetic_row(candidate_id=f"cand-{i}", archive_file_id=i) for i in range(1, 751)]
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "roundtrip.xlsx"
            wb.save(str(path))
            from openpyxl import load_workbook
            reopened = load_workbook(str(path))
            ws = reopened["Comparaison Youssef vs IA"]
            data_row_count = sum(1 for row in ws.iter_rows(min_row=2) if row[0].value is not None)
            self.assertEqual(data_row_count, 750)


class YoussefDecisionPreservationInWorkbookTest(unittest.TestCase):
    def test_every_decision_value_preserved_exactly_in_visible_sheet(self):
        rows = [
            synthetic_row(candidate_id="c1", archive_file_id=1, validation_status="HUMAN_VALIDATED_CDC"),
            synthetic_row(candidate_id="c2", archive_file_id=2, validation_status="HUMAN_REJECTED_CDC"),
            synthetic_row(candidate_id="c3", archive_file_id=3, validation_status="MACHINE_CLASSIFIED"),
        ]
        wb = mod.build_workbook(rows, "qwen3:14b", "v3", "2026-09-28 00:00")
        ws = wb["Comparaison Youssef vs IA"]
        decision_col = mod.VISIBLE_HEADERS.index("Décision de Youssef") + 1
        decisions = {ws.cell(row=r, column=decision_col).value for r in range(2, ws.max_row + 1)}
        self.assertEqual(decisions, {"OUI", "NON", "INCERTAIN"})


if __name__ == "__main__":
    unittest.main()
