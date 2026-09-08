#!/usr/bin/env python3
"""Synthetic test suite for scripts/cdc_review.py.

SYNTHETIC DATA ONLY. No real archive filenames, paths, project names, or
PostgreSQL rows are used anywhere in this file. All DB access is mocked/
stubbed - no live PostgreSQL connection is required or attempted, and
knowledge_base.historical_technical_source_candidates is never actually
queried against a real database.
"""
from __future__ import annotations

import importlib.util
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch

FAKE_DATABASE_URL = "postgresql://synthetic:synthetic@127.0.0.1/synthetic_test_db"

HERE = Path(__file__).resolve().parent

_CDC_SPEC = importlib.util.spec_from_file_location("cdc_discovery", HERE / "cdc_discovery.py")
cdc_discovery = importlib.util.module_from_spec(_CDC_SPEC)
sys.modules[_CDC_SPEC.name] = cdc_discovery
_CDC_SPEC.loader.exec_module(cdc_discovery)

_TSC_SPEC = importlib.util.spec_from_file_location("technical_source_classifier", HERE / "technical_source_classifier.py")
tsc = importlib.util.module_from_spec(_TSC_SPEC)
sys.modules[_TSC_SPEC.name] = tsc
_TSC_SPEC.loader.exec_module(tsc)

_REVIEW_SPEC = importlib.util.spec_from_file_location("cdc_review", HERE / "cdc_review.py")
review = importlib.util.module_from_spec(_REVIEW_SPEC)
sys.modules[_REVIEW_SPEC.name] = review
_REVIEW_SPEC.loader.exec_module(review)


class FakeCursor:
    """Synthetic double for a psycopg cursor - replays a scripted sequence
    of fetchone()/fetchall() results, one per execute() call, and records
    every executed query text (so tests can assert on WHAT was queried,
    e.g. that no row-level identifying column is ever selected in
    aggregate mode)."""

    def __init__(self, plan):
        self.plan = list(plan)
        self.index = 0
        self.queries: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query, params=None):
        self.queries.append(" ".join(query.split()))
        self._params = params

    def fetchone(self):
        result = self.plan[self.index]
        self.index += 1
        return result

    def fetchall(self):
        result = self.plan[self.index]
        self.index += 1
        return result


def make_fake_conn(plan):
    conn = MagicMock()
    cursor = FakeCursor(plan)
    conn.cursor.return_value = cursor
    return conn, cursor


_SUMMARY_PLAN = [
    (750,),
    (300,),
    [("CDC", 12), ("TDR", 125), ("DAO_WITH_TDR", 189), ("DAO_WITH_CDC", 11)],
    [("STRONG_TECHNICAL_SOURCE", 2), ("POSSIBLE_TECHNICAL_SOURCE", 82), ("WEAK_TECHNICAL_SOURCE", 40764)],
    [("HIGH_PRIORITY", 337), ("MEDIUM_PRIORITY", 60), ("EXTRACTION_FAILED", 117)],
    [("SUCCESS", 516), ("FAILED", 117), ("NOT_ATTEMPTED", 40214)],
    [("pdf_text", 380), ("docx_text", 136)],
    [("MISSING_SOURCE", 20), ("DOC_EXTRACTION_FAILURE", 46)],
    [("MACHINE_CLASSIFIED", 748), ("HUMAN_VALIDATED_CDC", 2)],
    [("pdf", 400), ("docx", 136), (None, 3)],
]


class TestFetchReviewSummary(unittest.TestCase):
    def test_produces_the_headline_categories(self):
        conn, _cursor = make_fake_conn(_SUMMARY_PLAN)
        summary = review.fetch_review_summary(conn)
        self.assertEqual(summary["cdc_candidates"], 12)
        self.assertEqual(summary["dao_with_cdc_candidates"], 11)
        self.assertEqual(summary["strong_technical_candidates"], 2)
        self.assertEqual(summary["possible_technical_candidates"], 82)
        self.assertEqual(summary["extraction_failures"], 117)

    def test_reports_projects_represented_as_a_count_only(self):
        conn, _cursor = make_fake_conn(_SUMMARY_PLAN)
        summary = review.fetch_review_summary(conn)
        self.assertEqual(summary["projects_represented"], 300)
        self.assertIsInstance(summary["projects_represented"], int)

    def test_distinguishes_machine_classified_from_human_validated(self):
        # Task 5: "Machine classification is not human validation" - this
        # is the one field that makes that distinction visible in the
        # aggregate report.
        conn, _cursor = make_fake_conn(_SUMMARY_PLAN)
        summary = review.fetch_review_summary(conn)
        self.assertEqual(summary["machine_classified_never_reviewed"], 748)
        self.assertEqual(summary["validation_HUMAN_VALIDATED_CDC"], 2)
        self.assertNotIn("validation_MACHINE_CLASSIFIED", summary)

    def test_every_extraction_failure_category_is_present_even_at_zero(self):
        conn, _cursor = make_fake_conn(_SUMMARY_PLAN)
        summary = review.fetch_review_summary(conn)
        for category in tsc.EXTRACTION_FAILURE_CATEGORIES:
            self.assertIn(f"failure_category_{category}", summary)

    def test_every_role_is_present_even_at_zero(self):
        conn, _cursor = make_fake_conn(_SUMMARY_PLAN)
        summary = review.fetch_review_summary(conn)
        for role in cdc_discovery.TECHNICAL_SOURCE_ROLES:
            self.assertIn(f"role_{role}", summary)

    def test_all_values_are_ints_never_strings_or_identifiers(self):
        conn, _cursor = make_fake_conn(_SUMMARY_PLAN)
        summary = review.fetch_review_summary(conn)
        for value in summary.values():
            self.assertIsInstance(value, int)

    def test_no_query_selects_a_row_level_identifying_column(self):
        # Confidentiality guarantee by construction: every query is a
        # count()/count(distinct)/group-by-count - none selects
        # archive_file_id, project_reference, relative_path, or filename
        # as a projected value.
        conn, cursor = make_fake_conn(_SUMMARY_PLAN)
        review.fetch_review_summary(conn)
        for query in cursor.queries:
            lowered = query.lower()
            self.assertNotIn("select archive_file_id,", lowered)
            self.assertNotIn("select project_reference,", lowered)
            self.assertNotIn("relative_path", lowered)
            self.assertNotIn("filename", lowered)

    def test_extension_none_is_labeled_unknown_not_dropped(self):
        conn, _cursor = make_fake_conn(_SUMMARY_PLAN)
        summary = review.fetch_review_summary(conn)
        self.assertEqual(summary["extension_unknown"], 3)


class TestRunReviewSummaryMode(unittest.TestCase):
    def test_prints_only_aggregate_lines_no_secrets(self):
        conn, _cursor = make_fake_conn(_SUMMARY_PLAN)
        buffer = io.StringIO()
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(review, "_connect", return_value=conn), \
             redirect_stdout(buffer):
            exit_code = review.run_review_summary_mode()
        output = buffer.getvalue()
        self.assertEqual(exit_code, 0)
        self.assertIn("cdc_candidates: 12", output)
        self.assertNotIn("/mnt/", output)
        self.assertNotIn(".pdf", output)

    def test_requires_database_url(self):
        with patch.dict(os.environ, {}, clear=True), redirect_stderr(io.StringIO()):
            exit_code = review.run_review_summary_mode()
        self.assertEqual(exit_code, 1)


class TestOpenReviewCandidate(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp(prefix="cdc-review-test-")
        self.addCleanup(__import__("shutil").rmtree, self.tmp_dir, ignore_errors=True)
        self.synthetic_file = Path(self.tmp_dir).resolve() / "OFFRES 2020" / "PROJECT-ALPHA" / "doc.pdf"
        self.synthetic_file.parent.mkdir(parents=True)
        self.synthetic_file.write_bytes(b"%PDF-synthetic-placeholder")

    def _row_plan(self, detected_role="CDC", validation_status="MACHINE_CLASSIFIED"):
        return [(
            1, "OFFRES 2020/PROJECT-ALPHA/doc.pdf", "doc.pdf", "pdf", None, None, self.tmp_dir,
            detected_role, validation_status,
        )]

    def test_exactly_one_candidate_is_opened(self):
        conn, _cursor = make_fake_conn(self._row_plan())
        with patch.object(cdc_discovery.subprocess, "Popen") as mock_popen:
            result = review.open_review_candidate(conn, 1)
        self.assertEqual(mock_popen.call_count, 1)
        self.assertEqual(result["document_open_process_started"], "YES")

    def test_correct_path_is_passed_to_the_opener(self):
        conn, _cursor = make_fake_conn(self._row_plan())
        with patch.object(cdc_discovery.subprocess, "Popen") as mock_popen:
            review.open_review_candidate(conn, 1)
        (command,), _kwargs = mock_popen.call_args
        self.assertEqual(command[-1], str(self.synthetic_file))

    def test_unknown_archive_file_id_fails_closed(self):
        conn, _cursor = make_fake_conn([None])
        with patch.object(cdc_discovery.subprocess, "Popen") as mock_popen:
            result = review.open_review_candidate(conn, 999)
        mock_popen.assert_not_called()
        self.assertEqual(result["open_failure_reason"], "CANDIDATE_NOT_FOUND")

    def test_opening_never_changes_validation_status(self):
        # Task 4: "If a candidate is not structurally confirmed, it must
        # NOT be silently upgraded to confirmed just because it was
        # opened." open_review_candidate has no code path that writes
        # anything - proven here by asserting the connection's cursor
        # never executes an UPDATE/INSERT statement.
        conn, cursor = make_fake_conn(self._row_plan(validation_status="NEEDS_HUMAN_REVIEW"))
        with patch.object(cdc_discovery.subprocess, "Popen"):
            result = review.open_review_candidate(conn, 1)
        self.assertEqual(result["opened_candidate_validation_status"], "NEEDS_HUMAN_REVIEW")
        for query in cursor.queries:
            self.assertNotIn("update", query.lower())
            self.assertNotIn("insert", query.lower())

    def test_no_filename_or_path_in_output(self):
        conn, _cursor = make_fake_conn(self._row_plan())
        with patch.object(cdc_discovery.subprocess, "Popen"):
            result = review.open_review_candidate(conn, 1)
        serialized = repr(result)
        self.assertNotIn("doc.pdf", serialized)
        self.assertNotIn("PROJECT-ALPHA", serialized)
        self.assertNotIn(str(self.synthetic_file), serialized)

    def test_outside_root_path_is_rejected(self):
        plan = [(
            1, "../../outside/secret.pdf", "secret.pdf", "pdf", None, None, self.tmp_dir,
            "CDC", "MACHINE_CLASSIFIED",
        )]
        conn, _cursor = make_fake_conn(plan)
        with patch.object(cdc_discovery.subprocess, "Popen") as mock_popen:
            result = review.open_review_candidate(conn, 1)
        mock_popen.assert_not_called()
        self.assertEqual(result["open_failure_reason"], "INVALID_FILE_PATH")


class TestRunReviewOpenMode(unittest.TestCase):
    def test_never_persists_anything(self):
        conn = MagicMock()
        conn.cursor.return_value = FakeCursor([None])
        buffer = io.StringIO()
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(review, "_connect", return_value=conn), \
             redirect_stdout(buffer):
            exit_code = review.run_review_open_mode(999)
        self.assertEqual(exit_code, 0)
        conn.transaction.assert_not_called()


class TestMarkValidationStatusIntegration(unittest.TestCase):
    def test_records_a_human_decision(self):
        conn = MagicMock()
        cursor = FakeCursor([])
        cursor.rowcount = 1
        conn.cursor.return_value = cursor
        buffer = io.StringIO()
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(review, "_connect", return_value=conn), \
             redirect_stdout(buffer):
            exit_code = review.run_review_mark_mode(1, "HUMAN_VALIDATED_CDC", reviewed_by=42)
        self.assertEqual(exit_code, 0)
        self.assertIn("new_validation_status: HUMAN_VALIDATED_CDC", buffer.getvalue())

    def test_rejects_machine_classified_target_before_any_write_commits(self):
        conn = MagicMock()
        cursor = FakeCursor([])
        conn.cursor.return_value = cursor
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(review, "_connect", return_value=conn), \
             redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            exit_code = review.run_review_mark_mode(1, "MACHINE_CLASSIFIED", reviewed_by=None)
        self.assertEqual(exit_code, 1)

    def test_unknown_archive_file_id_fails_closed(self):
        conn = MagicMock()
        cursor = FakeCursor([])
        cursor.rowcount = 0
        conn.cursor.return_value = cursor
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(review, "_connect", return_value=conn), \
             redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            exit_code = review.run_review_mark_mode(999, "HUMAN_VALIDATED_CDC", reviewed_by=None)
        self.assertEqual(exit_code, 1)

    def test_successful_mark_calls_commit(self):
        # Regression test for a real bug found against a live database (see
        # cdc_discovery.run_full_corpus_mode's identical fix): _connect()
        # never sets autocommit=True, so conn.transaction() alone never
        # durably commits - this is the ONE path that can ever record a
        # human validation decision, so an explicit commit is required or
        # the reviewer's decision is silently discarded on conn.close().
        conn = MagicMock()
        cursor = FakeCursor([])
        cursor.rowcount = 1
        conn.cursor.return_value = cursor
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(review, "_connect", return_value=conn), \
             redirect_stdout(io.StringIO()):
            exit_code = review.run_review_mark_mode(1, "HUMAN_VALIDATED_CDC", reviewed_by=42)
        self.assertEqual(exit_code, 0)
        conn.commit.assert_called_once()

    def test_rejected_mark_never_calls_commit(self):
        conn = MagicMock()
        cursor = FakeCursor([])
        conn.cursor.return_value = cursor
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(review, "_connect", return_value=conn), \
             redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            exit_code = review.run_review_mark_mode(1, "MACHINE_CLASSIFIED", reviewed_by=None)
        self.assertEqual(exit_code, 1)
        conn.commit.assert_not_called()

    def test_commit_failure_is_reported_and_not_treated_as_success(self):
        conn = MagicMock()
        cursor = FakeCursor([])
        cursor.rowcount = 1
        conn.cursor.return_value = cursor
        conn.commit.side_effect = RuntimeError("connection lost")
        buffer_out = io.StringIO()
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(review, "_connect", return_value=conn), \
             redirect_stdout(buffer_out), redirect_stderr(io.StringIO()):
            exit_code = review.run_review_mark_mode(1, "HUMAN_VALIDATED_CDC", reviewed_by=42)
        self.assertEqual(exit_code, 1)
        self.assertNotIn("validation_recorded", buffer_out.getvalue())


class TestCliGating(unittest.TestCase):
    def test_review_open_requires_archive_file_id(self):
        parser = review.build_arg_parser()
        args = parser.parse_args(["--review-open"])
        with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
            review._validate_args(parser, args)

    def test_review_mark_requires_validation_status(self):
        parser = review.build_arg_parser()
        args = parser.parse_args(["--review-mark", "--archive-file-id", "1"])
        with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
            review._validate_args(parser, args)

    def test_review_mark_rejects_invalid_validation_status_choice(self):
        parser = review.build_arg_parser()
        with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
            parser.parse_args(["--review-mark", "--archive-file-id", "1", "--validation-status", "NOT_REAL"])

    def test_review_summary_rejects_archive_file_id(self):
        parser = review.build_arg_parser()
        args = parser.parse_args(["--review-summary", "--archive-file-id", "1"])
        with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
            review._validate_args(parser, args)

    def test_review_open_rejects_validation_status(self):
        parser = review.build_arg_parser()
        args = parser.parse_args(["--review-open", "--archive-file-id", "1", "--validation-status", "HUMAN_REJECTED_CDC"])
        with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
            review._validate_args(parser, args)

    def test_negative_archive_file_id_rejected(self):
        parser = review.build_arg_parser()
        args = parser.parse_args(["--review-open", "--archive-file-id", "-5"])
        with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
            review._validate_args(parser, args)

    def test_valid_review_open_args_pass_validation(self):
        parser = review.build_arg_parser()
        args = parser.parse_args(["--review-open", "--archive-file-id", "1"])
        review._validate_args(parser, args)  # must not raise

    def test_valid_review_mark_args_pass_validation(self):
        parser = review.build_arg_parser()
        args = parser.parse_args([
            "--review-mark", "--archive-file-id", "1", "--validation-status", "HUMAN_VALIDATED_CDC",
        ])
        review._validate_args(parser, args)  # must not raise

    def test_main_dispatches_to_review_summary(self):
        with patch.object(review, "run_review_summary_mode", return_value=0) as mock_run:
            exit_code = review.main(["--review-summary"])
        mock_run.assert_called_once()
        self.assertEqual(exit_code, 0)

    def test_main_dispatches_to_review_open_with_archive_file_id(self):
        with patch.object(review, "run_review_open_mode", return_value=0) as mock_run:
            review.main(["--review-open", "--archive-file-id", "7"])
        mock_run.assert_called_once_with(7)

    def test_main_dispatches_to_review_mark_with_all_args(self):
        with patch.object(review, "run_review_mark_mode", return_value=0) as mock_run:
            review.main([
                "--review-mark", "--archive-file-id", "7",
                "--validation-status", "HUMAN_REJECTED_CDC", "--reviewed-by", "3",
            ])
        mock_run.assert_called_once_with(7, "HUMAN_REJECTED_CDC", 3)


if __name__ == "__main__":
    unittest.main()
