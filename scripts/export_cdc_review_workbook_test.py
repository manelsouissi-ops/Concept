#!/usr/bin/env python3
"""Synthetic test suite for scripts/export_cdc_review_workbook.py.

SYNTHETIC DATA ONLY. No real archive filenames, paths, project names, or
PostgreSQL rows are used anywhere in this file. All DB access is mocked -
no live PostgreSQL connection is required or attempted, and no real
.xlsx workbook produced here is ever a genuine review deliverable.

    python3 -m unittest scripts.export_cdc_review_workbook_test -v
"""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

SPEC = importlib.util.spec_from_file_location("export_cdc_review_workbook", HERE / "export_cdc_review_workbook.py")
export_mod = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = export_mod
SPEC.loader.exec_module(export_mod)


def synthetic_row(
    candidate_id="cand-0000",
    archive_file_id=1,
    year=2009,
    project_key="OFFRES 2009/SYNTHETIC_PROJECT",
    filename="synthetic_file.pdf",
    extension="pdf",
    is_primary_candidate=True,
    extraction_status="SUCCESS",
    extraction_failure_category=None,
    detected_role="OTHER",
    structural_score=2,
    structural_max=8,
    structural_band="WEAK_TECHNICAL_SOURCE",
    review_priority=None,
    project_mapping_status="UNRESOLVED",
    v3_proposed_role=None,
    v3_confidence=None,
    v3_json_outcome=None,
    **evidence_overrides,
):
    evidence_defaults = dict(
        v3_evidence_scope_of_work=None, v3_evidence_technical_specifications=None,
        v3_evidence_required_deliverables=None, v3_evidence_bidder_obligations=None,
        v3_evidence_evaluation_criteria=None, v3_evidence_mission_or_tasks=None,
        v3_evidence_consultant_profiles=None, v3_evidence_administrative_tender_package=None,
        v3_evidence_pricing_or_forms=None, v3_evidence_bidder_response_language=None,
    )
    evidence_defaults.update(evidence_overrides)
    return export_mod.CandidateExportRow(
        candidate_id=candidate_id, archive_file_id=archive_file_id, year=year, project_key=project_key,
        filename=filename, extension=extension, is_primary_candidate=is_primary_candidate,
        extraction_status=extraction_status, extraction_failure_category=extraction_failure_category,
        detected_role=detected_role, structural_score=structural_score, structural_max=structural_max,
        structural_band=structural_band, review_priority=review_priority,
        project_mapping_status=project_mapping_status, v3_proposed_role=v3_proposed_role,
        v3_confidence=v3_confidence, v3_json_outcome=v3_json_outcome, **evidence_defaults,
    )


def synthetic_metadata():
    return export_mod.WorkbookMetadata(
        generated_at="2026-01-01", model_name="qwen3:14b", schema_version="v3",
        semantic_classifier_version="v3", prompt_hash="hash",
    )


# =====================================================================
# Formula-injection protection
# =====================================================================


class FormulaInjectionTest(unittest.TestCase):
    def test_leading_equals_sanitized(self):
        self.assertEqual(export_mod.sanitize_cell_value("=SUM(A1:A10)"), "'=SUM(A1:A10)")

    def test_leading_plus_sanitized(self):
        self.assertEqual(export_mod.sanitize_cell_value("+1+1"), "'+1+1")

    def test_leading_minus_sanitized(self):
        self.assertEqual(export_mod.sanitize_cell_value("-cmd|'/c calc'!A1"), "'-cmd|'/c calc'!A1")

    def test_leading_at_sanitized(self):
        self.assertEqual(export_mod.sanitize_cell_value("@SUM(1,2)"), "'@SUM(1,2)")

    def test_safe_string_unchanged(self):
        self.assertEqual(export_mod.sanitize_cell_value("PROJECT_A"), "PROJECT_A")

    def test_non_string_passes_through(self):
        self.assertEqual(export_mod.sanitize_cell_value(42), 42)
        self.assertIsNone(export_mod.sanitize_cell_value(None))

    def test_empty_string_unchanged(self):
        self.assertEqual(export_mod.sanitize_cell_value(""), "")

    def test_malicious_filename_and_project_sanitized_in_workbook(self):
        rows = [synthetic_row(filename="=cmd|' /C calc'!A1", project_key="+HYPERLINK(\"http://evil\")")]
        wb = export_mod.build_workbook(rows, synthetic_metadata())
        for sheet in wb.worksheets:
            for row_cells in sheet.iter_rows():
                for cell in row_cells:
                    if isinstance(cell.value, str) and cell.value:
                        self.assertNotEqual(cell.data_type, "f", f"cell {sheet.title}!{cell.coordinate} was a formula")
                        if cell.value[0] == "'":
                            continue  # sanitized as expected
                        self.assertNotIn(cell.value[0], ("=", "+", "-", "@"))


# =====================================================================
# Review-priority ordering (new 6-group scheme)
# =====================================================================


class ReviewPriorityTest(unittest.TestCase):
    def test_ollama_or_rules_cdc_is_priority_one(self):
        self.assertEqual(export_mod.compute_review_priority_group(synthetic_row(v3_proposed_role="CDC", detected_role="OTHER")), 1)
        self.assertEqual(export_mod.compute_review_priority_group(synthetic_row(v3_proposed_role=None, detected_role="CDC")), 1)

    def test_ollama_or_rules_dao_with_cdc_is_priority_two(self):
        self.assertEqual(export_mod.compute_review_priority_group(synthetic_row(v3_proposed_role="DAO_WITH_CDC", detected_role="OTHER")), 2)
        self.assertEqual(export_mod.compute_review_priority_group(synthetic_row(v3_proposed_role=None, detected_role="DAO_WITH_CDC")), 2)

    def test_tdr_family_is_priority_three(self):
        for role in ("TDR", "DAO_WITH_TDR", "DAO", "RFP"):
            with self.subTest(role=role):
                row = synthetic_row(v3_proposed_role=None, detected_role=role)
                self.assertEqual(export_mod.compute_review_priority_group(row), 3)

    def test_offer_other_unknown_is_priority_four(self):
        for role in ("OFFER", "OTHER", "UNKNOWN"):
            with self.subTest(role=role):
                row = synthetic_row(v3_proposed_role=None, detected_role=role, extraction_status="SUCCESS")
                self.assertEqual(export_mod.compute_review_priority_group(row), 4)

    def test_extraction_failed_is_priority_five(self):
        row = synthetic_row(v3_proposed_role=None, detected_role="UNKNOWN", extraction_status="FAILED")
        self.assertEqual(export_mod.compute_review_priority_group(row), 5)

    def test_not_attempted_is_priority_six(self):
        row = synthetic_row(v3_proposed_role=None, detected_role="UNKNOWN", extraction_status="NOT_ATTEMPTED")
        self.assertEqual(export_mod.compute_review_priority_group(row), 6)

    def test_v3_signal_outranks_extraction_status(self):
        row = synthetic_row(v3_proposed_role="CDC", detected_role="UNKNOWN", extraction_status="NOT_ATTEMPTED")
        self.assertEqual(export_mod.compute_review_priority_group(row), 1)

    def test_ordering_is_stable_by_year_project_filename_within_group(self):
        rows = [
            synthetic_row(candidate_id="c3", year=2010, project_key="P_B", filename="z.pdf", detected_role="TDR"),
            synthetic_row(candidate_id="c1", year=2009, project_key="P_A", filename="a.pdf", detected_role="TDR"),
            synthetic_row(candidate_id="c2", year=2009, project_key="P_A", filename="b.pdf", detected_role="TDR"),
        ]
        ordered = export_mod.order_rows_for_review(rows)
        self.assertEqual([r.candidate_id for r in ordered], ["c1", "c2", "c3"])

    def test_higher_priority_group_always_sorts_first(self):
        rows = [
            synthetic_row(candidate_id="low", year=2009, detected_role="OTHER", extraction_status="SUCCESS"),
            synthetic_row(candidate_id="high", year=2026, v3_proposed_role="CDC"),
        ]
        ordered = export_mod.order_rows_for_review(rows)
        self.assertEqual(ordered[0].candidate_id, "high")


# =====================================================================
# Automatic-proposal label (simple French values, assistance only)
# =====================================================================


class AutomaticProposalLabelTest(unittest.TestCase):
    def test_v3_role_preferred_over_rules(self):
        row = synthetic_row(v3_proposed_role="RFP", detected_role="CDC")
        self.assertEqual(export_mod.compute_automatic_proposal_label(row), "RFP probable")

    def test_rules_used_when_no_v3_review(self):
        row = synthetic_row(v3_proposed_role=None, detected_role="CDC")
        self.assertEqual(export_mod.compute_automatic_proposal_label(row), "CDC probable")

    def test_all_required_labels_reachable(self):
        expected = {
            "CDC": "CDC probable",
            "DAO_WITH_CDC": "DAO contenant un CDC probable",
            "TDR": "TDR probable",
            "DAO_WITH_TDR": "DAO/TDR probable",
            "DAO": "DAO probable",
            "RFP": "RFP probable",
            "OFFER": "Offre probable",
            "OTHER": "Autre document",
        }
        for role, label in expected.items():
            with self.subTest(role=role):
                row = synthetic_row(v3_proposed_role=None, detected_role=role)
                self.assertEqual(export_mod.compute_automatic_proposal_label(row), label)

    def test_unknown_role_is_non_analyse(self):
        row = synthetic_row(v3_proposed_role=None, detected_role="UNKNOWN")
        self.assertEqual(export_mod.compute_automatic_proposal_label(row), export_mod.NON_ANALYSE)

    def test_extraction_failed_is_extraction_impossible(self):
        row = synthetic_row(extraction_status="FAILED", detected_role="CDC")  # role must never leak through
        self.assertEqual(export_mod.compute_automatic_proposal_label(row), "Extraction impossible")

    def test_not_attempted_is_non_analyse(self):
        row = synthetic_row(extraction_status="NOT_ATTEMPTED", detected_role="CDC")
        self.assertEqual(export_mod.compute_automatic_proposal_label(row), export_mod.NON_ANALYSE)


# =====================================================================
# Row content - the 7 visible columns only
# =====================================================================


class RowContentTest(unittest.TestCase):
    def test_visible_row_has_exactly_seven_values(self):
        row = synthetic_row()
        cells = export_mod.build_row_cells(row)
        self.assertEqual(len(cells), 7)

    def test_visible_headers_are_exactly_the_seven_requested(self):
        self.assertEqual(
            list(export_mod.VISIBLE_HEADERS),
            ["Priorité", "Année", "Projet", "Titre / fichier", "Proposition automatique",
             "CDC utilisable ?", "Commentaire facultatif"],
        )

    def test_no_technical_vocabulary_leaks_into_visible_headers(self):
        forbidden = ("Structurel", "JSON", "Evidence", "Validé par", "Date de validation", "Code projet", "Doublon")
        joined = " ".join(export_mod.VISIBLE_HEADERS)
        for term in forbidden:
            self.assertNotIn(term, joined)

    def test_default_human_validation_is_a_verifier(self):
        row = synthetic_row()
        cells = export_mod.build_row_cells(row)
        self.assertEqual(cells[5], export_mod.DEFAULT_HUMAN_VALIDATION)
        self.assertEqual(export_mod.DEFAULT_HUMAN_VALIDATION, "À VÉRIFIER")

    def test_comment_column_starts_empty(self):
        row = synthetic_row()
        cells = export_mod.build_row_cells(row)
        self.assertEqual(cells[6], "")

    def test_not_attempted_and_failed_candidates_are_preserved_not_discarded(self):
        rows = [
            synthetic_row(candidate_id="ok", extraction_status="SUCCESS"),
            synthetic_row(candidate_id="failed", extraction_status="FAILED"),
            synthetic_row(candidate_id="not_attempted", extraction_status="NOT_ATTEMPTED"),
        ]
        ordered = export_mod.order_rows_for_review(rows)
        self.assertEqual({r.candidate_id for r in ordered}, {"ok", "failed", "not_attempted"})

    def test_no_document_text_field_exists_on_the_row_type(self):
        field_names = set(export_mod.CandidateExportRow.__dataclass_fields__.keys())
        for forbidden in ("text", "excerpt", "raw_response", "prompt", "chain_of_thought", "content"):
            self.assertFalse(any(forbidden in name for name in field_names), f"unexpected field containing {forbidden!r}")


# =====================================================================
# Hidden technical sheet: never a project code, never a path, and a
# strict one-to-one correspondence with the visible sheet.
# =====================================================================


class TechnicalSheetContentTest(unittest.TestCase):
    def test_technical_headers_have_no_archive_path_or_project_code_column(self):
        joined = " ".join(export_mod.TECHNICAL_HEADERS)
        self.assertNotIn("Chemin", joined)
        self.assertNotIn("Code projet", joined)
        self.assertNotIn("path", joined.lower())

    def test_technical_row_never_includes_the_filename(self):
        row = synthetic_row(filename="CONFIDENTIAL_FILENAME.pdf")
        technical_cells = export_mod.build_technical_row_cells(row)
        self.assertNotIn("CONFIDENTIAL_FILENAME.pdf", technical_cells)

    def test_technical_row_carries_ids_needed_for_later_import(self):
        row = synthetic_row(candidate_id="cand-42", archive_file_id=42)
        technical_cells = export_mod.build_technical_row_cells(row)
        self.assertIn("cand-42", technical_cells)
        self.assertIn(42, technical_cells)


# =====================================================================
# SQL uses only v3 (never v1/v2) for the current proposal
# =====================================================================


class NoV1V2AsCurrentProposalTest(unittest.TestCase):
    def test_fetch_sql_filters_on_schema_version_v3_only(self):
        sql = export_mod._FETCH_SQL
        self.assertIn("schema_version = 'v3'", sql)
        self.assertNotIn("'v1'", sql)
        self.assertNotIn("'v2'", sql)

    def test_fetch_sql_takes_latest_success_only(self):
        sql = export_mod._FETCH_SQL
        self.assertIn("processing_status = 'SUCCESS'", sql)
        self.assertIn("limit 1", sql)


# =====================================================================
# Workbook structure
# =====================================================================


class WorkbookStructureTest(unittest.TestCase):
    def _build(self, n=5, **row_kwargs):
        rows = [synthetic_row(candidate_id=f"cand-{i}", archive_file_id=i, filename=f"file_{i}.pdf", **row_kwargs) for i in range(n)]
        return export_mod.build_workbook(rows, synthetic_metadata()), rows

    def test_sheet_names(self):
        wb, _ = self._build()
        self.assertEqual(wb.sheetnames, ["Validation CDC", "Listes", "Données techniques", "Résumé", "Instructions"])

    def test_listes_and_technical_sheets_hidden(self):
        wb, _ = self._build()
        self.assertEqual(wb["Listes"].sheet_state, "hidden")
        self.assertEqual(wb["Données techniques"].sheet_state, "hidden")

    def test_visible_sheet_has_only_seven_columns_of_content(self):
        wb, _ = self._build(n=3)
        ws = wb["Validation CDC"]
        # Header row (row 2) must have exactly 7 non-empty cells.
        header_values = [ws.cell(row=2, column=c).value for c in range(1, 12)]
        non_empty = [v for v in header_values if v not in (None, "")]
        self.assertEqual(len(non_empty), 7)

    def test_exactly_750_style_row_count(self):
        wb, rows = self._build(n=750)
        ws = wb["Validation CDC"]
        self.assertEqual(ws.max_row - 2, 750)  # minus banner row + header row

    def test_exactly_one_row_per_candidate(self):
        wb, rows = self._build(n=7)
        ws = wb["Validation CDC"]
        self.assertEqual(ws.max_row - 2, 7)

    def test_visible_and_technical_rows_correspond_one_to_one(self):
        rows = [
            synthetic_row(candidate_id="c0", archive_file_id=10, year=2009, detected_role="CDC"),
            synthetic_row(candidate_id="c1", archive_file_id=11, year=2010, detected_role="TDR"),
            synthetic_row(candidate_id="c2", archive_file_id=12, year=2009, extraction_status="FAILED"),
        ]
        wb = export_mod.build_workbook(rows, synthetic_metadata())
        visible = wb["Validation CDC"]
        technical = wb["Données techniques"]
        ordered = export_mod.order_rows_for_review(rows)
        for offset, row in enumerate(ordered):
            visible_row_index = 3 + offset
            technical_row_index = 3 + offset
            self.assertEqual(visible.cell(row=visible_row_index, column=2).value, row.year)  # Année
            self.assertEqual(technical.cell(row=technical_row_index, column=1).value, row.candidate_id)  # ID candidat
            self.assertEqual(technical.cell(row=technical_row_index, column=2).value, row.archive_file_id)

    def test_freeze_panes_set(self):
        wb, _ = self._build()
        self.assertEqual(wb["Validation CDC"].freeze_panes, "A3")

    def test_autofilter_covers_header_and_data(self):
        wb, rows = self._build(n=5)
        ws = wb["Validation CDC"]
        self.assertIsNotNone(ws.auto_filter.ref)
        self.assertTrue(ws.auto_filter.ref.startswith("A2"))
        self.assertIn(f"{ws.max_row}", ws.auto_filter.ref)

    def test_dropdown_covers_every_data_row(self):
        wb, rows = self._build(n=6)
        ws = wb["Validation CDC"]
        dvs = list(ws.data_validations.dataValidation)
        self.assertEqual(len(dvs), 1)
        dv = dvs[0]
        self.assertEqual(dv.type, "list")
        ranges = str(dv.sqref)
        self.assertIn("F3", ranges)
        self.assertIn(f"F{ws.max_row}", ranges)

    def test_dropdown_has_exactly_four_choices(self):
        wb, _ = self._build()
        self.assertEqual(
            export_mod.HUMAN_VALIDATION_CHOICES,
            ("À VÉRIFIER", "OUI", "NON", "INCERTAIN"),
        )
        listes = wb["Listes"]
        values = [listes.cell(row=i, column=1).value for i in range(1, 5)]
        self.assertEqual(tuple(values), export_mod.HUMAN_VALIDATION_CHOICES)

    def test_all_rows_default_to_a_verifier_in_the_workbook(self):
        wb, rows = self._build(n=8)
        ws = wb["Validation CDC"]
        for r in range(3, ws.max_row + 1):
            self.assertEqual(ws.cell(row=r, column=6).value, "À VÉRIFIER")

    def test_conditional_formatting_rules_cover_all_four_choices(self):
        wb, _ = self._build(n=4)
        ws = wb["Validation CDC"]
        formulas = []
        for cf_range in ws.conditional_formatting:
            for rule in cf_range.rules:
                formulas.extend(rule.formula)
        for expected in ('"OUI"', '"NON"', '"INCERTAIN"', '"À VÉRIFIER"'):
            self.assertIn(expected, formulas)

    def test_no_formulas_derived_from_database_values(self):
        wb, _ = self._build(n=5)
        for sheet_name in ("Validation CDC", "Données techniques", "Résumé", "Instructions"):
            ws = wb[sheet_name]
            for row_cells in ws.iter_rows():
                for cell in row_cells:
                    self.assertNotEqual(cell.data_type, "f", f"{sheet_name}!{cell.coordinate}")

    def test_banner_instruction_present(self):
        wb, _ = self._build(n=2)
        ws = wb["Validation CDC"]
        self.assertEqual(ws.cell(row=1, column=1).value, export_mod.BANNER_TEXT)

    def test_warning_present_in_resume_sheet(self):
        wb, _ = self._build()
        resume = wb["Résumé"]
        found = any(cell.value == export_mod.WARNING_TEXT for row in resume.iter_rows() for cell in row)
        self.assertTrue(found)

    def test_warning_present_in_instructions_sheet(self):
        wb, _ = self._build()
        instructions = wb["Instructions"]
        found = any(cell.value == export_mod.WARNING_TEXT for row in instructions.iter_rows() for cell in row)
        self.assertTrue(found)

    def test_instructions_explain_the_four_choices(self):
        wb, _ = self._build()
        instructions = wb["Instructions"]
        joined = " ".join(str(cell.value) for row in instructions.iter_rows() for cell in row if cell.value)
        for choice in ("OUI", "NON", "INCERTAIN", "À VÉRIFIER"):
            self.assertIn(choice, joined)

    def test_resume_sheet_has_only_the_required_simple_counts(self):
        wb, rows = self._build(n=10)
        resume = wb["Résumé"]
        labels = [cell.value for row in resume.iter_rows() for cell in row if isinstance(cell.value, str)]
        for expected_label in ("Total documents", "À vérifier", "Oui", "Non", "Incertain", "Extraction impossible", "Analysés par Ollama v3"):
            self.assertIn(expected_label, labels)

    def test_resume_reflects_no_human_validation_yet(self):
        wb, rows = self._build(n=10)
        resume = wb["Résumé"]
        values_by_label = {}
        for row in resume.iter_rows():
            cells = list(row)
            if len(cells) >= 2 and isinstance(cells[0].value, str):
                values_by_label[cells[0].value] = cells[1].value
        self.assertEqual(values_by_label.get("Total documents"), 10)
        self.assertEqual(values_by_label.get("À vérifier"), 10)
        self.assertEqual(values_by_label.get("Oui"), 0)
        self.assertEqual(values_by_label.get("Non"), 0)
        self.assertEqual(values_by_label.get("Incertain"), 0)


# =====================================================================
# Export orchestration: zero DB writes, zero document/Ollama/external
# calls, correct summary counts.
# =====================================================================


def _synthetic_fetchall_row(
    candidate_id="cand-1", archive_file_id=1, detected_role="CDC", extraction_status="SUCCESS",
    v3_proposed_role="CDC", v3_confidence=0.91, v3_json_outcome="FIRST_ATTEMPT_VALID",
):
    return (
        candidate_id, archive_file_id, 2009, detected_role, 5, 8, "STRONG_TECHNICAL_SOURCE", "HIGH_PRIORITY",
        extraction_status, None, True, "UNRESOLVED",
        "OFFRES 2009/PROJECT_A/file.pdf", "file.pdf", "pdf", "label",
        v3_proposed_role, v3_confidence, v3_json_outcome,
        True, True, True, True, True, False, False, True, False, False,
    )


class RunExportTest(unittest.TestCase):
    def test_run_export_writes_only_the_xlsx_never_the_database(self):
        conn = MagicMock()
        cursor = MagicMock()
        cursor.fetchall.return_value = [_synthetic_fetchall_row()]
        conn.cursor.return_value.__enter__.return_value = cursor

        with tempfile.TemporaryDirectory() as tmp:
            output_path = str(Path(tmp) / "test_output.xlsx")
            summary = export_mod.run_export(conn, output_path, "qwen3:14b", "v3", "v3", "hash")

            conn.commit.assert_not_called()
            cursor.execute.assert_called_once()
            self.assertEqual(summary.total_rows, 1)
            self.assertEqual(summary.v3_success_count, 1)
            self.assertTrue(Path(summary.output_path).exists())

    def test_run_export_never_calls_ollama_or_any_external_endpoint(self):
        conn = MagicMock()
        cursor = MagicMock()
        cursor.fetchall.return_value = [
            _synthetic_fetchall_row(extraction_status="NOT_ATTEMPTED", v3_proposed_role=None, v3_confidence=None, v3_json_outcome=None)
        ]
        conn.cursor.return_value.__enter__.return_value = cursor

        with tempfile.TemporaryDirectory() as tmp:
            output_path = str(Path(tmp) / "test_output.xlsx")
            with patch("urllib.request.urlopen") as mocked_urlopen:
                summary = export_mod.run_export(conn, output_path, "qwen3:14b", "v3", "v3", "hash")
        mocked_urlopen.assert_not_called()
        self.assertEqual(summary.v3_success_count, 0)

    def test_export_summary_never_carries_confidential_values(self):
        conn = MagicMock()
        cursor = MagicMock()
        cursor.fetchall.return_value = [_synthetic_fetchall_row()]
        conn.cursor.return_value.__enter__.return_value = cursor
        with tempfile.TemporaryDirectory() as tmp:
            output_path = str(Path(tmp) / "test_output.xlsx")
            summary = export_mod.run_export(conn, output_path, "qwen3:14b", "v3", "v3", "hash")
        field_names = set(export_mod.ExportSummary.__dataclass_fields__.keys())
        self.assertEqual(field_names, {"output_path", "total_rows", "by_extraction_status", "v3_success_count", "awaiting_review_count"})


class GitIgnoreTest(unittest.TestCase):
    def test_output_directory_is_gitignored(self):
        gitignore = (HERE.parent / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("services/knowledge-base/output/", gitignore)

    def test_default_output_path_is_under_the_ignored_directory(self):
        self.assertTrue(export_mod.DEFAULT_OUTPUT_PATH.startswith("services/knowledge-base/output/"))


if __name__ == "__main__":
    unittest.main()
