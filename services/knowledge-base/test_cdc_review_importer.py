#!/usr/bin/env python3
"""Synthetic test suite for cdc_review_importer.py.

SYNTHETIC DATA ONLY. Every workbook fixture uses invented, generic
placeholder values (reusing test_cdc_review_import_preview.py's
build_synthetic_workbook builder). Every candidate/database row used here
is an in-memory, invented fixture (SYN-ID-*, ALT-ID-*, "concept_test" as a
fake database name, "Youssef" as the reviewer label - a generic first name
used only as the confirmed provenance label, never combined with any real
identity detail). No PostgreSQL connection is ever made or attempted -
FakeDatabaseGateway is a plain in-memory Python object. The REAL
PostgresDatabaseGateway class - the one whose __init__ lazily imports
psycopg and opens an actual connection - is never instantiated anywhere
in this file; a handful of tests patch the *name* `PostgresDatabaseGateway`
inside the importer module to point at a FakeDatabaseGateway factory
instead, purely to exercise main()'s connection-lifecycle wiring (creation
order, close-on-success, close-on-failure) without ever touching a
database driver. No real archive filenames, paths, project names, or
document content is used.
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
from unittest.mock import patch

HERE = Path(__file__).resolve().parent

# Load order matters: the fixture module spec-loads cdc_review_import_preview.py
# and registers it in sys.modules under the plain name "cdc_review_import_preview".
# It must load FIRST, so that cdc_review_importer.py's own plain
# `import cdc_review_import_preview as preview` (below) binds to that SAME
# already-registered module object instead of triggering a second, separate
# execution of the file - two separate instances would define two distinct
# (if identically-named) WorkbookValidationError classes, and assertRaises
# is identity-based, so exceptions raised via one instance would not be
# caught when asserted against the other.
FIXTURE_SPEC = importlib.util.spec_from_file_location(
    "test_cdc_review_import_preview_fixtures", HERE / "test_cdc_review_import_preview.py"
)
fixtures = importlib.util.module_from_spec(FIXTURE_SPEC)
sys.modules[FIXTURE_SPEC.name] = fixtures
FIXTURE_SPEC.loader.exec_module(fixtures)

preview = fixtures.preview  # the already-verified parser module, re-exposed by the fixture module

SPEC = importlib.util.spec_from_file_location("cdc_review_importer", HERE / "cdc_review_importer.py")
importer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = importer
SPEC.loader.exec_module(importer)

REAL_WORKBOOK = Path("/home/concept/cdc-validation-input/2026-09-17/cdc_candidates_validated_youssef.xlsx")
REAL_WORKBOOK_SHA256 = "47597354cdcf5c82f658ee3af41ca536682be879edaf080340fc6e57f031bb89"

EXTERNAL = importer.ReviewerSpec(reviewer_type="EXTERNAL_HUMAN", external_reviewer_label="Youssef")
INTERNAL = importer.ReviewerSpec(reviewer_type="INTERNAL_USER", reviewer_user_id=42)


def make_candidate(identifier, decision, year):
    return preview.CandidateRow(identifier=identifier, decision=decision, year=year, category=preview.classify(decision, year))


def make_plan(rows):
    """rows: list of (identifier, decision, year, archive_file_id)."""
    candidates = [make_candidate(i, d, y) for i, d, y, _ in rows]
    pairs = [(i, a) for i, _, _, a in rows]
    return importer.build_import_plan(candidates, pairs)


def make_candidate_state(id_, archive_file_id, validation_status="MACHINE_CLASSIFIED", review_priority="HIGH_PRIORITY", detected_role="CDC", structural_band="STRONG_TECHNICAL_SOURCE"):
    return importer.CandidateState(
        id=id_, archive_file_id=archive_file_id, validation_status=validation_status,
        review_priority=review_priority, detected_role=detected_role, structural_band=structural_band,
    )


class TestReviewerSpecValidation(unittest.TestCase):
    def test_external_reviewer_accepted_without_app_users_id(self):
        importer.validate_reviewer_spec(
            importer.ReviewerSpec(reviewer_type="EXTERNAL_HUMAN", external_reviewer_label="Youssef")
        )  # must not raise

    def test_external_reviewer_label_required(self):
        with self.assertRaises(importer.ImportGuardError):
            importer.validate_reviewer_spec(importer.ReviewerSpec(reviewer_type="EXTERNAL_HUMAN"))

    def test_external_reviewer_forbids_reviewer_user_id(self):
        with self.assertRaises(importer.ImportGuardError):
            importer.validate_reviewer_spec(
                importer.ReviewerSpec(reviewer_type="EXTERNAL_HUMAN", external_reviewer_label="Youssef", reviewer_user_id=42)
            )

    def test_internal_reviewer_requires_reviewer_user_id(self):
        with self.assertRaises(importer.ImportGuardError):
            importer.validate_reviewer_spec(importer.ReviewerSpec(reviewer_type="INTERNAL_USER"))

    def test_internal_reviewer_forbids_external_label(self):
        with self.assertRaises(importer.ImportGuardError):
            importer.validate_reviewer_spec(
                importer.ReviewerSpec(reviewer_type="INTERNAL_USER", reviewer_user_id=42, external_reviewer_label="Youssef")
            )

    def test_unknown_reviewer_type_rejected(self):
        with self.assertRaises(importer.ImportGuardError):
            importer.validate_reviewer_spec(importer.ReviewerSpec(reviewer_type="ROBOT"))

    def test_overlong_external_label_rejected(self):
        with self.assertRaises(importer.ImportGuardError):
            importer.validate_reviewer_spec(
                importer.ReviewerSpec(reviewer_type="EXTERNAL_HUMAN", external_reviewer_label="x" * 101)
            )

    def test_no_fake_app_user_is_ever_created_for_external_reviewer(self):
        # There is no function anywhere in this module capable of creating
        # an app_users row - confirmed by construction (no INSERT INTO
        # app_users / public.app_users anywhere in the source).
        source_text = (HERE / "cdc_review_importer.py").read_text(encoding="utf-8")
        self.assertNotIn("INSERT INTO public.app_users", source_text)
        self.assertNotIn("INSERT INTO app_users", source_text)


class RaisesIfReviewerExistsCalledGateway(importer.FakeDatabaseGateway):
    """Proves no app_users existence check ever runs for EXTERNAL_HUMAN:
    if execute_import ever called reviewer_exists() for this mode, this
    gateway would raise and the test would fail."""

    def reviewer_exists(self, reviewer_id: int) -> bool:
        raise AssertionError("reviewer_exists() must never be called for EXTERNAL_HUMAN mode.")


class TestExternalHumanRequiresNoAppUsersAccount(unittest.TestCase):
    """Regression tests for the exact question this task was raised to
    resolve: EXTERNAL_HUMAN must be fully executable with zero app_users
    involvement - no reviewer id, no operator id, no existence check."""

    def setUp(self):
        self.plan = make_plan([("SYN-1", "OUI", 2022, "1001")])
        self.expected_counts = {"total": 1, "usable": 1, "excluded": 0, "skipped_uncertain": 0}
        # Minimal spec exactly as stated in the task: only reviewer_type and
        # external_reviewer_label set - reviewer_user_id and
        # imported_by_user_id both left at their default of None.
        self.minimal_external = importer.ReviewerSpec(reviewer_type="EXTERNAL_HUMAN", external_reviewer_label="Youssef")

    def test_minimal_external_human_spec_is_valid_on_its_own(self):
        importer.validate_reviewer_spec(self.minimal_external)  # must not raise
        self.assertIsNone(self.minimal_external.reviewer_user_id)
        self.assertIsNone(self.minimal_external.imported_by_user_id)

    def test_imported_by_user_id_stays_null_and_is_never_required(self):
        gateway = importer.FakeDatabaseGateway({("SYN-1", "1001"): make_candidate_state("SYN-1", "1001")}, reviewer_ids=set())
        result = importer.execute_import(gateway, self.plan, self.minimal_external, self.expected_counts, source_workbook_sha256="4" + "0" * 63)
        self.assertEqual(result["status"], "COMMITTED")
        self.assertIsNone(gateway.import_batches[0]["imported_by_user_id"])

    def test_imported_by_user_id_column_is_nullable_with_no_required_check(self):
        text = (HERE.parent.parent / "scripts" / "sql" / "create_historical_technical_source_import_batches_table.sql").read_text(encoding="utf-8")
        for line in text.splitlines():
            if "imported_by_user_id" in line and "REFERENCES" in line:
                self.assertNotIn("NOT NULL", line)
        # No CHECK constraint anywhere ties imported_by_user_id to reviewer_type.
        self.assertNotIn("imported_by_user_id IS NOT NULL", text)

    def test_no_app_users_existence_check_runs_for_external_human(self):
        gateway = RaisesIfReviewerExistsCalledGateway({("SYN-1", "1001"): make_candidate_state("SYN-1", "1001")}, reviewer_ids=set())
        result = importer.execute_import(gateway, self.plan, self.minimal_external, self.expected_counts, source_workbook_sha256="5" + "0" * 63)
        self.assertEqual(result["status"], "COMMITTED")  # would have raised via the gateway above if reviewer_exists() were ever called

    def test_import_succeeds_truthfully_with_only_type_and_label(self):
        # No reviewer_ids seeded at all - proves no app_users id, real or
        # fake, is needed anywhere in this path.
        gateway = importer.FakeDatabaseGateway({("SYN-1", "1001"): make_candidate_state("SYN-1", "1001")}, reviewer_ids=set())
        result = importer.execute_import(gateway, self.plan, self.minimal_external, self.expected_counts, source_workbook_sha256="6" + "0" * 63)
        self.assertEqual(result["status"], "COMMITTED")
        state = gateway._candidates[("SYN-1", "1001")]
        self.assertIsNone(state.reviewed_by)
        self.assertEqual(gateway.import_batches[0]["reviewer_type"], "EXTERNAL_HUMAN")
        self.assertEqual(gateway.import_batches[0]["external_reviewer_label"], "Youssef")
        self.assertIsNone(gateway.import_batches[0]["reviewer_user_id"])

    def test_dry_run_cli_succeeds_with_no_app_users_id_of_any_kind(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            fixtures.build_synthetic_workbook(path, fixtures.make_default_rows())
            digest = preview.sha256_file(path)
            out = io.StringIO()
            with redirect_stdout(out):
                exit_code = importer.main([
                    "--source", str(path), "--expected-sha256", digest,
                    "--reviewer-type", "EXTERNAL_HUMAN", "--external-reviewer-label", "Youssef", "--dry-run",
                ])
            self.assertEqual(exit_code, 0)
            self.assertIn("DRY_RUN_RESULT=PASS", out.getvalue())


def _shared_seed_from_plan(plan):
    seed = {}
    for u in plan.updates:
        seed[(u.identifier, u.archive_file_id)] = make_candidate_state(u.identifier, u.archive_file_id)
    for identifier, archive_file_id in plan.skipped_pairs:
        seed[(identifier, archive_file_id)] = make_candidate_state(identifier, archive_file_id)
    return seed


class TestExecuteWiring(unittest.TestCase):
    """Covers the now-wired main() --execute path end to end: gateway
    creation order, connection lifecycle, and success/failure handling -
    all against a patched FakeDatabaseGateway, never real PostgreSQL."""

    def _build_synthetic_plan_and_seed(self, path):
        fixtures.build_synthetic_workbook(path, fixtures.make_default_rows())
        digest = preview.sha256_file(path)
        candidates, pairs = importer.parse_workbook_for_import(path, digest)
        plan = importer.build_import_plan(candidates, pairs)
        return digest, plan, _shared_seed_from_plan(plan)

    def _execute_args(self, path, digest, plan, database_url_env=None, database_url=None,
                       deployment_ack=None, expected_database_name="concept_prod"):
        ack = deployment_ack if deployment_ack is not None else importer.build_expected_deployment_ack(expected_database_name)
        args = [
            "--source", str(path), "--expected-sha256", digest,
            "--reviewer-type", "EXTERNAL_HUMAN", "--external-reviewer-label", "Youssef",
            "--execute",
            "--expected-total", str(plan.total), "--expected-usable", str(plan.usable),
            "--expected-excluded", str(plan.excluded), "--expected-skipped-uncertain", str(plan.skipped_uncertain),
            "--expected-source-sha256", digest,
            "--confirm-token", importer.build_confirmation_token(plan.total, plan.usable, plan.excluded, plan.skipped_uncertain),
            "--expected-database-name", expected_database_name,
            "--deployment-ack", ack,
        ]
        if database_url_env is not None:
            args += ["--database-url-env", database_url_env]
        elif database_url is not None:
            args += ["--database-url", database_url]
        else:
            args += ["--database-url", f"postgresql://u:p@h/{expected_database_name}"]
        return args

    def test_guard_chain_completes_before_gateway_creation_without_any_app_users_id(self):
        # Every safety flag except database connectivity is supplied; no
        # --reviewer-id, no --imported-by-user-id anywhere. Guard validation
        # must complete and reach gateway construction - not fail earlier
        # on a missing app_users id. PostgresDatabaseGateway is patched to
        # a stub that always raises, so this test proves guard completion
        # without needing a working fake connection.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            digest, plan, _seed = self._build_synthetic_plan_and_seed(path)

            def _raising_gateway(_connection_string):
                raise RuntimeError("gateway reached - guard chain completed")

            out, err = io.StringIO(), io.StringIO()
            with patch.object(importer, "PostgresDatabaseGateway", side_effect=_raising_gateway) as mock_gw:
                with redirect_stdout(out), redirect_stderr(err):
                    exit_code = importer.main(self._execute_args(path, digest, plan))
            self.assertNotEqual(exit_code, 0)
            mock_gw.assert_called_once()
            self.assertIn("DATABASE_TARGET_HOST=", out.getvalue())
            self.assertIn("EXECUTE_FAILED=RuntimeError", err.getvalue())
            # The raw exception text must never appear in place of a
            # sanitized label - only the exception type name is printed.
            self.assertNotIn("guard chain completed", out.getvalue())

    def test_execute_mode_resolves_the_dedicated_environment_variable(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            digest, plan, seed = self._build_synthetic_plan_and_seed(path)
            fake_gateway = importer.FakeDatabaseGateway(seed, database_name="concept_prod")

            with patch.dict(os.environ, {"MY_DEDICATED_IMPORT_VAR": "postgresql://u:p@h/concept_prod"}):
                with patch.object(importer, "PostgresDatabaseGateway", return_value=fake_gateway) as mock_gw:
                    out = io.StringIO()
                    with redirect_stdout(out):
                        exit_code = importer.main(self._execute_args(path, digest, plan, database_url_env="MY_DEDICATED_IMPORT_VAR"))

            self.assertEqual(exit_code, 0)
            mock_gw.assert_called_once_with("postgresql://u:p@h/concept_prod")
            self.assertTrue(fake_gateway.committed)
            self.assertTrue(fake_gateway.closed)
            self.assertIn("EXECUTE_RESULT=PASS", out.getvalue())

    def test_database_url_and_test_database_url_names_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            digest, plan, _seed = self._build_synthetic_plan_and_seed(path)
            for forbidden_name in ("DATABASE_URL", "TEST_DATABASE_URL"):
                with self.subTest(env_name=forbidden_name):
                    with patch.object(importer, "PostgresDatabaseGateway") as mock_gw:
                        out, err = io.StringIO(), io.StringIO()
                        with redirect_stdout(out), redirect_stderr(err):
                            exit_code = importer.main(self._execute_args(path, digest, plan, database_url_env=forbidden_name))
                    self.assertNotEqual(exit_code, 0)
                    mock_gw.assert_not_called()
                    self.assertIn("EXECUTE_GUARD=FAIL", err.getvalue())
                    self.assertIn("DATABASE_ACCESSED=NO", out.getvalue())

    def test_missing_dedicated_variable_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            digest, plan, _seed = self._build_synthetic_plan_and_seed(path)
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop("SOME_UNSET_IMPORT_VAR", None)
                with patch.object(importer, "PostgresDatabaseGateway") as mock_gw:
                    out, err = io.StringIO(), io.StringIO()
                    with redirect_stdout(out), redirect_stderr(err):
                        exit_code = importer.main(self._execute_args(path, digest, plan, database_url_env="SOME_UNSET_IMPORT_VAR"))
            self.assertNotEqual(exit_code, 0)
            mock_gw.assert_not_called()
            self.assertIn("DATABASE_ACCESSED=NO", out.getvalue())

    def test_malformed_url_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            digest, plan, _seed = self._build_synthetic_plan_and_seed(path)
            with patch.object(importer, "PostgresDatabaseGateway") as mock_gw:
                out, err = io.StringIO(), io.StringIO()
                with redirect_stdout(out), redirect_stderr(err):
                    exit_code = importer.main(self._execute_args(path, digest, plan, database_url="not-a-url-at-all"))
            self.assertNotEqual(exit_code, 0)
            mock_gw.assert_not_called()
            self.assertIn("DATABASE_ACCESSED=NO", out.getvalue())

    def test_database_name_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            digest, plan, _seed = self._build_synthetic_plan_and_seed(path)
            with patch.object(importer, "PostgresDatabaseGateway") as mock_gw:
                out, err = io.StringIO(), io.StringIO()
                with redirect_stdout(out), redirect_stderr(err):
                    exit_code = importer.main(self._execute_args(
                        path, digest, plan,
                        database_url="postgresql://u:p@h/actual_db",
                        expected_database_name="expected_db",
                    ))
            self.assertNotEqual(exit_code, 0)
            mock_gw.assert_not_called()  # the URL's own db name mismatch is caught before gateway creation
            self.assertIn("DATABASE_ACCESSED=NO", out.getvalue())

    def test_deployment_acknowledgement_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            digest, plan, _seed = self._build_synthetic_plan_and_seed(path)
            with patch.object(importer, "PostgresDatabaseGateway") as mock_gw:
                out, err = io.StringIO(), io.StringIO()
                with redirect_stdout(out), redirect_stderr(err):
                    exit_code = importer.main(self._execute_args(path, digest, plan, deployment_ack="WRONG_ACK"))
            self.assertNotEqual(exit_code, 0)
            mock_gw.assert_not_called()
            self.assertIn("DATABASE_ACCESSED=NO", out.getvalue())

    def test_gateway_created_only_after_all_guards_pass(self):
        # A single call order assertion: PostgresDatabaseGateway must never
        # be constructed when any earlier guard would have failed (covered
        # above by mock_gw.assert_not_called() in each failing case), and
        # must be constructed exactly once when every guard passes.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            digest, plan, seed = self._build_synthetic_plan_and_seed(path)
            fake_gateway = importer.FakeDatabaseGateway(seed, database_name="concept_prod")
            with patch.object(importer, "PostgresDatabaseGateway", return_value=fake_gateway) as mock_gw:
                out = io.StringIO()
                with redirect_stdout(out):
                    exit_code = importer.main(self._execute_args(path, digest, plan))
            self.assertEqual(exit_code, 0)
            self.assertEqual(mock_gw.call_count, 1)

    def test_execute_import_called_exactly_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            digest, plan, seed = self._build_synthetic_plan_and_seed(path)
            fake_gateway = importer.FakeDatabaseGateway(seed, database_name="concept_prod")
            with patch.object(importer, "PostgresDatabaseGateway", return_value=fake_gateway):
                with patch.object(importer, "execute_import", wraps=importer.execute_import) as wrapped:
                    out = io.StringIO()
                    with redirect_stdout(out):
                        exit_code = importer.main(self._execute_args(path, digest, plan))
            self.assertEqual(exit_code, 0)
            wrapped.assert_called_once()

    def test_connection_always_closed_on_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            digest, plan, seed = self._build_synthetic_plan_and_seed(path)
            fake_gateway = importer.FakeDatabaseGateway(seed, database_name="concept_prod")
            with patch.object(importer, "PostgresDatabaseGateway", return_value=fake_gateway):
                out = io.StringIO()
                with redirect_stdout(out):
                    exit_code = importer.main(self._execute_args(path, digest, plan))
            self.assertEqual(exit_code, 0)
            self.assertTrue(fake_gateway.closed)

    def test_connection_closed_after_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            digest, plan, seed = self._build_synthetic_plan_and_seed(path)
            # Seed nothing matching the plan's keys -> execute_import raises
            # (partial match) after the gateway is created but before commit.
            fake_gateway = importer.FakeDatabaseGateway({}, database_name="concept_prod")
            with patch.object(importer, "PostgresDatabaseGateway", return_value=fake_gateway):
                out, err = io.StringIO(), io.StringIO()
                with redirect_stdout(out), redirect_stderr(err):
                    exit_code = importer.main(self._execute_args(path, digest, plan))
            self.assertNotEqual(exit_code, 0)
            self.assertTrue(fake_gateway.closed)
            self.assertTrue(fake_gateway.rolled_back)
            self.assertFalse(fake_gateway.committed)
            self.assertIn("EXECUTE_GUARD=FAIL", err.getvalue())
            self.assertIn("DATABASE_ACCESSED=YES", out.getvalue())

    def test_rollback_behavior_remains_delegated_to_execute_import(self):
        # main() itself never calls gateway.rollback() directly - that
        # remains execute_import()'s exclusive responsibility. Proven by
        # the same failure case above: rollback happened, and it happened
        # via execute_import's own try/except, not any new logic in main().
        source_text = (HERE / "cdc_review_importer.py").read_text(encoding="utf-8")
        main_source = source_text[source_text.index("def main("):]
        self.assertNotIn(".rollback()", main_source)

    def test_aggregate_output_contains_no_credentials_or_identifiers(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            digest, plan, seed = self._build_synthetic_plan_and_seed(path)
            fake_gateway = importer.FakeDatabaseGateway(seed, database_name="concept_prod")
            secret_url = "postgresql://someuser:somesecret@dbhost:5432/concept_prod"
            with patch.object(importer, "PostgresDatabaseGateway", return_value=fake_gateway):
                out = io.StringIO()
                with redirect_stdout(out):
                    exit_code = importer.main(self._execute_args(path, digest, plan, database_url=secret_url, expected_database_name="concept_prod"))
            self.assertEqual(exit_code, 0)
            output = out.getvalue()
            self.assertNotIn("somesecret", output)
            self.assertNotIn("someuser", output)
            self.assertNotIn("SYN-ID-", output)
            self.assertNotIn("ALT-ID-", output)

    def test_idempotent_result_is_rendered_correctly(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            digest, plan, seed = self._build_synthetic_plan_and_seed(path)
            fake_gateway = importer.FakeDatabaseGateway(seed, database_name="concept_prod")

            with patch.object(importer, "PostgresDatabaseGateway", return_value=fake_gateway):
                out1 = io.StringIO()
                with redirect_stdout(out1):
                    importer.main(self._execute_args(path, digest, plan))

                fake_gateway._in_transaction = False  # reset as if it were a fresh connection
                out2 = io.StringIO()
                with redirect_stdout(out2):
                    exit_code2 = importer.main(self._execute_args(path, digest, plan))

            self.assertEqual(exit_code2, 0)
            self.assertIn("IMPORT_RESULT_STATUS=IDEMPOTENT_NOOP", out2.getvalue())
            self.assertIn("IMPORT_RESULT_UPDATED=0", out2.getvalue())


class TestExecuteImportExternalReviewer(unittest.TestCase):
    def setUp(self):
        self.plan = make_plan([
            ("SYN-1", "OUI", 2022, "1001"),
            ("SYN-2", "NON", 2015, "1002"),
        ])
        seed = {
            ("SYN-1", "1001"): make_candidate_state("SYN-1", "1001"),
            ("SYN-2", "1002"): make_candidate_state("SYN-2", "1002"),
        }
        self.gateway = importer.FakeDatabaseGateway(seed, reviewer_ids={42})
        self.expected_counts = {"total": 2, "usable": 1, "excluded": 1, "skipped_uncertain": 0}

    def test_external_human_leaves_reviewed_by_null(self):
        importer.execute_import(self.gateway, self.plan, EXTERNAL, self.expected_counts, source_workbook_sha256="a" * 64)
        self.assertIsNone(self.gateway._candidates[("SYN-1", "1001")].reviewed_by)
        self.assertIsNone(self.gateway._candidates[("SYN-2", "1002")].reviewed_by)

    def test_reviewed_at_set_for_updated_rows(self):
        importer.execute_import(self.gateway, self.plan, EXTERNAL, self.expected_counts, source_workbook_sha256="a" * 64)
        self.assertTrue(self.gateway._candidates[("SYN-1", "1001")].reviewed_at_is_set)
        self.assertTrue(self.gateway._candidates[("SYN-2", "1002")].reviewed_at_is_set)

    def test_batch_id_assigned_to_updated_rows(self):
        result = importer.execute_import(self.gateway, self.plan, EXTERNAL, self.expected_counts, source_workbook_sha256="a" * 64)
        batch_id = result["batch_id"]
        self.assertEqual(self.gateway._candidates[("SYN-1", "1001")].human_review_import_batch_id, batch_id)
        self.assertEqual(self.gateway._candidates[("SYN-2", "1002")].human_review_import_batch_id, batch_id)

    def test_reviewer_label_stored_only_at_batch_level(self):
        importer.execute_import(self.gateway, self.plan, EXTERNAL, self.expected_counts, source_workbook_sha256="a" * 64)
        self.assertEqual(self.gateway.import_batches[0]["external_reviewer_label"], "Youssef")
        # Candidate rows have no external_reviewer_label field at all - the
        # dataclass itself proves the label is never duplicated onto rows.
        self.assertFalse(hasattr(self.gateway._candidates[("SYN-1", "1001")], "external_reviewer_label"))

    def test_validation_status_applied_correctly(self):
        importer.execute_import(self.gateway, self.plan, EXTERNAL, self.expected_counts, source_workbook_sha256="a" * 64)
        self.assertEqual(self.gateway._candidates[("SYN-1", "1001")].validation_status, "HUMAN_VALIDATED_CDC")
        self.assertEqual(self.gateway._candidates[("SYN-2", "1002")].validation_status, "HUMAN_REJECTED_CDC")

    def test_preservation_of_review_priority_and_machine_fields(self):
        importer.execute_import(self.gateway, self.plan, EXTERNAL, self.expected_counts, source_workbook_sha256="a" * 64)
        state = self.gateway._candidates[("SYN-1", "1001")]
        self.assertEqual(state.review_priority, "HIGH_PRIORITY")
        self.assertEqual(state.detected_role, "CDC")
        self.assertEqual(state.structural_band, "STRONG_TECHNICAL_SOURCE")

    def test_successful_commit_ordering(self):
        result = importer.execute_import(self.gateway, self.plan, EXTERNAL, self.expected_counts, source_workbook_sha256="a" * 64)
        self.assertEqual(result["status"], "COMMITTED")
        self.assertTrue(self.gateway.committed)
        self.assertFalse(self.gateway.rolled_back)
        self.assertEqual(self.gateway.import_batches[0]["status"], "COMPLETED")
        self.assertEqual(self.gateway.import_batches[0]["updated_count"], 2)


class TestExecuteImportInternalReviewer(unittest.TestCase):
    def test_internal_user_sets_reviewed_by(self):
        plan = make_plan([("SYN-1", "OUI", 2022, "1001")])
        gateway = importer.FakeDatabaseGateway({("SYN-1", "1001"): make_candidate_state("SYN-1", "1001")}, reviewer_ids={42})
        expected_counts = {"total": 1, "usable": 1, "excluded": 0, "skipped_uncertain": 0}
        importer.execute_import(gateway, plan, INTERNAL, expected_counts, source_workbook_sha256="b" * 64)
        self.assertEqual(gateway._candidates[("SYN-1", "1001")].reviewed_by, 42)

    def test_internal_reviewer_not_found_rolls_back(self):
        plan = make_plan([("SYN-1", "OUI", 2022, "1001")])
        gateway = importer.FakeDatabaseGateway({("SYN-1", "1001"): make_candidate_state("SYN-1", "1001")}, reviewer_ids={1, 2, 3})
        expected_counts = {"total": 1, "usable": 1, "excluded": 0, "skipped_uncertain": 0}
        bad_internal = importer.ReviewerSpec(reviewer_type="INTERNAL_USER", reviewer_user_id=999)
        with self.assertRaises(importer.ImportGuardError):
            importer.execute_import(gateway, plan, bad_internal, expected_counts, source_workbook_sha256="c" * 64)
        self.assertTrue(gateway.rolled_back)
        self.assertFalse(gateway.committed)


class TestIncertainRowsUntouched(unittest.TestCase):
    def test_incertain_rows_receive_no_batch_id_or_status_change(self):
        plan = make_plan([
            ("SYN-1", "OUI", 2022, "1001"),
            ("SYN-2", "INCERTAIN", 2018, "1002"),
        ])
        seed = {
            ("SYN-1", "1001"): make_candidate_state("SYN-1", "1001"),
            ("SYN-2", "1002"): make_candidate_state("SYN-2", "1002"),
        }
        gateway = importer.FakeDatabaseGateway(seed, reviewer_ids={42})
        expected_counts = {"total": 2, "usable": 1, "excluded": 0, "skipped_uncertain": 1}
        importer.execute_import(gateway, plan, EXTERNAL, expected_counts, source_workbook_sha256="d" * 64)

        incertain_state = gateway._candidates[("SYN-2", "1002")]
        self.assertEqual(incertain_state.validation_status, "MACHINE_CLASSIFIED")
        self.assertIsNone(incertain_state.human_review_import_batch_id)
        self.assertFalse(incertain_state.reviewed_at_is_set)
        self.assertIsNone(incertain_state.reviewed_by)


class TestSourceHashUniquenessAndIdempotency(unittest.TestCase):
    def setUp(self):
        self.plan = make_plan([("SYN-1", "OUI", 2022, "1001")])
        self.gateway = importer.FakeDatabaseGateway({("SYN-1", "1001"): make_candidate_state("SYN-1", "1001")}, reviewer_ids={42})
        self.expected_counts = {"total": 1, "usable": 1, "excluded": 0, "skipped_uncertain": 0}

    def test_idempotent_completed_batch_is_a_safe_noop(self):
        first = importer.execute_import(self.gateway, self.plan, EXTERNAL, self.expected_counts, source_workbook_sha256="e" * 64)
        self.assertEqual(first["status"], "COMMITTED")
        calls_before = len(self.gateway.update_calls)

        second = importer.execute_import(self.gateway, self.plan, EXTERNAL, self.expected_counts, source_workbook_sha256="e" * 64)
        self.assertEqual(second["status"], "IDEMPOTENT_NOOP")
        self.assertEqual(second["updated"], 0)
        self.assertEqual(len(self.gateway.update_calls), calls_before)

    def test_incomplete_duplicate_hash_fails_closed(self):
        # Simulate a crashed/concurrent run: a batch row exists for this
        # hash but never reached COMPLETED.
        self.gateway.begin()
        self.gateway.record_import_batch("f" * 64, EXTERNAL, importer.IMPORTER_VERSION, self.plan)
        self.gateway.commit()

        with self.assertRaises(importer.ImportGuardError):
            importer.execute_import(self.gateway, self.plan, EXTERNAL, self.expected_counts, source_workbook_sha256="f" * 64)


class TestExistingDecisionConflicts(unittest.TestCase):
    def test_conflicting_existing_human_decision_is_rejected(self):
        plan = make_plan([("SYN-1", "OUI", 2022, "1001")])
        gateway = importer.FakeDatabaseGateway(
            {("SYN-1", "1001"): make_candidate_state("SYN-1", "1001", validation_status="HUMAN_REJECTED_CDC")},
            reviewer_ids={42},
        )
        expected_counts = {"total": 1, "usable": 1, "excluded": 0, "skipped_uncertain": 0}
        with self.assertRaises(importer.ImportGuardError):
            importer.execute_import(gateway, plan, EXTERNAL, expected_counts, source_workbook_sha256="1" + "0" * 63)
        self.assertTrue(gateway.rolled_back)
        self.assertEqual(gateway._candidates[("SYN-1", "1001")].validation_status, "HUMAN_REJECTED_CDC")


class FaultyUpdateGateway(importer.FakeDatabaseGateway):
    def update_candidate(self, id_, archive_file_id, new_validation_status, reviewed_by, batch_id):
        super().update_candidate(id_, archive_file_id, new_validation_status, reviewed_by, batch_id)
        return 0


class TestTransactionSafety(unittest.TestCase):
    def setUp(self):
        self.plan = make_plan([("SYN-1", "OUI", 2022, "1001")])
        self.expected_counts = {"total": 1, "usable": 1, "excluded": 0, "skipped_uncertain": 0}

    def test_rollback_on_batch_count_mismatch(self):
        gateway = importer.FakeDatabaseGateway({("SYN-1", "1001"): make_candidate_state("SYN-1", "1001")}, reviewer_ids={42})
        wrong_counts = {"total": 999, "usable": 1, "excluded": 0, "skipped_uncertain": 0}
        with self.assertRaises(importer.ImportGuardError):
            importer.execute_import(gateway, self.plan, EXTERNAL, wrong_counts, source_workbook_sha256="2" + "0" * 63)
        self.assertFalse(gateway.committed)

    def test_rollback_on_candidate_link_mismatch(self):
        gateway = FaultyUpdateGateway({("SYN-1", "1001"): make_candidate_state("SYN-1", "1001")}, reviewer_ids={42})
        with self.assertRaises(importer.ImportGuardError):
            importer.execute_import(gateway, self.plan, EXTERNAL, self.expected_counts, source_workbook_sha256="3" + "0" * 63)
        self.assertTrue(gateway.rolled_back)
        self.assertFalse(gateway.committed)


class TestConfidentiality(unittest.TestCase):
    def test_no_row_level_identifiers_in_dry_run_cli_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.xlsx"
            fixtures.build_synthetic_workbook(path, fixtures.make_default_rows())
            digest = preview.sha256_file(path)
            out = io.StringIO()
            with redirect_stdout(out):
                exit_code = importer.main([
                    "--source", str(path), "--expected-sha256", digest,
                    "--reviewer-type", "EXTERNAL_HUMAN", "--external-reviewer-label", "Youssef", "--dry-run",
                ])
            self.assertEqual(exit_code, 0)
            output = out.getvalue()
            self.assertNotIn("SYN-ID-", output)
            self.assertNotIn("ALT-ID-", output)
            self.assertIn("DRY_RUN_RESULT=PASS", output)

    def test_no_database_driver_imported_by_default(self):
        for name in list(sys.modules):
            self.assertFalse(name.startswith("psycopg") or name == "pg8000", f"unexpected DB driver loaded: {name}")


class TestRealWorkbookPlan(unittest.TestCase):
    def test_expected_436_312_2_plan_against_the_real_validated_workbook(self):
        if not REAL_WORKBOOK.is_file():
            self.skipTest("real validated workbook not present in this environment")
        candidates, pairs = importer.parse_workbook_for_import(REAL_WORKBOOK, REAL_WORKBOOK_SHA256)
        plan = importer.build_import_plan(candidates, pairs)
        self.assertEqual((plan.total, plan.usable, plan.excluded, plan.skipped_uncertain), (750, 436, 312, 2))
        self.assertEqual(len(plan.updates), 748)
        self.assertEqual(len(plan.skipped_pairs), 2)

    def test_full_scale_external_human_import_leaves_reviewed_by_null_for_all_748_and_incertain_untouched(self):
        if not REAL_WORKBOOK.is_file():
            self.skipTest("real validated workbook not present in this environment")
        candidates, pairs = importer.parse_workbook_for_import(REAL_WORKBOOK, REAL_WORKBOOK_SHA256)
        plan = importer.build_import_plan(candidates, pairs)

        # In-memory fixture only - identifiers come from the real, already
        # hash-verified workbook (never printed anywhere, only used as dict
        # keys), seeded as plain MACHINE_CLASSIFIED rows exactly like a
        # clean pre-import database state.
        seed = {}
        for u in plan.updates:
            seed[(u.identifier, u.archive_file_id)] = make_candidate_state(u.identifier, u.archive_file_id)
        for identifier, archive_file_id in plan.skipped_pairs:
            seed[(identifier, archive_file_id)] = make_candidate_state(identifier, archive_file_id)

        gateway = importer.FakeDatabaseGateway(seed, reviewer_ids=set())
        expected_counts = {"total": 750, "usable": 436, "excluded": 312, "skipped_uncertain": 2}
        minimal_external = importer.ReviewerSpec(reviewer_type="EXTERNAL_HUMAN", external_reviewer_label="Youssef")

        result = importer.execute_import(gateway, plan, minimal_external, expected_counts, source_workbook_sha256=REAL_WORKBOOK_SHA256)
        self.assertEqual(result["status"], "COMMITTED")
        self.assertEqual(result["updated"], 748)

        reviewed_by_null_count = sum(1 for u in plan.updates if gateway._candidates[(u.identifier, u.archive_file_id)].reviewed_by is None)
        linked_count = sum(1 for u in plan.updates if gateway._candidates[(u.identifier, u.archive_file_id)].human_review_import_batch_id == result["batch_id"])
        self.assertEqual(reviewed_by_null_count, 748)
        self.assertEqual(linked_count, 748)

        for identifier, archive_file_id in plan.skipped_pairs:
            state = gateway._candidates[(identifier, archive_file_id)]
            self.assertEqual(state.validation_status, "MACHINE_CLASSIFIED")
            self.assertIsNone(state.human_review_import_batch_id)
            self.assertFalse(state.reviewed_at_is_set)


class TestMigrationStructure(unittest.TestCase):
    def setUp(self):
        self.batches_migration = HERE.parent.parent / "scripts" / "sql" / "create_historical_technical_source_import_batches_table.sql"
        self.link_migration = HERE.parent.parent / "scripts" / "sql" / "add_historical_technical_source_candidates_import_batch_link.sql"

    def test_both_migration_files_exist(self):
        self.assertTrue(self.batches_migration.is_file())
        self.assertTrue(self.link_migration.is_file())

    def test_both_migration_headers_say_applied_and_live_verified(self):
        # Applied and live-verified on GONOGO on 2026-09-18 (see the CDC
        # import authorization report). Headers were updated accordingly;
        # neither file claims NOT APPLIED any more.
        for path in (self.batches_migration, self.link_migration):
            text = path.read_text(encoding="utf-8")
            self.assertIn("APPLIED AND LIVE-VERIFIED", text)
            self.assertIn("2026-09-18", text)
            self.assertNotIn("NOT APPLIED", text)

    def test_executable_migration_sql_is_byte_for_byte_unchanged_apart_from_comments(self):
        # The exact statement sequence live-applied to GONOGO, captured
        # once and pinned here so a future documentation-only edit can
        # never silently drift the executable SQL.
        expected_batches_sql = (
            "CREATE SCHEMA IF NOT EXISTS knowledge_base;\n"
            "CREATE TABLE IF NOT EXISTS knowledge_base.historical_technical_source_import_batches (\n"
            "  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,\n"
            "  source_workbook_sha256 TEXT NOT NULL UNIQUE\n"
            "    CHECK (source_workbook_sha256 ~ '^[a-f0-9]{64}$'),\n"
            "  reviewer_type TEXT NOT NULL\n"
            "    CHECK (reviewer_type IN ('INTERNAL_USER', 'EXTERNAL_HUMAN')),\n"
            "  reviewer_user_id BIGINT REFERENCES public.app_users(id) ON DELETE RESTRICT,\n"
            "  external_reviewer_label TEXT\n"
            "    CHECK (external_reviewer_label IS NULL OR length(external_reviewer_label) <= 100),\n"
            "  CHECK (\n"
            "    (reviewer_type = 'INTERNAL_USER' AND reviewer_user_id IS NOT NULL AND external_reviewer_label IS NULL)\n"
            "    OR\n"
            "    (reviewer_type = 'EXTERNAL_HUMAN' AND reviewer_user_id IS NULL AND external_reviewer_label IS NOT NULL)\n"
            "  ),\n"
            "  imported_by_user_id BIGINT REFERENCES public.app_users(id) ON DELETE SET NULL,\n"
            "  status TEXT NOT NULL DEFAULT 'IN_PROGRESS'\n"
            "    CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK')),\n"
            "  importer_version TEXT NOT NULL,\n"
            "  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),\n"
            "  usable_count INTEGER NOT NULL DEFAULT 0 CHECK (usable_count >= 0),\n"
            "  excluded_count INTEGER NOT NULL DEFAULT 0 CHECK (excluded_count >= 0),\n"
            "  skipped_uncertain_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_uncertain_count >= 0),\n"
            "  updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),\n"
            "  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n"
            "  completed_at TIMESTAMPTZ,\n"
            "  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n"
            "  error_message TEXT,\n"
            "  CHECK (usable_count + excluded_count + skipped_uncertain_count <= total_count),\n"
            "  CHECK (updated_count <= usable_count + excluded_count)\n"
            ");\n"
            "CREATE INDEX IF NOT EXISTS historical_technical_source_import_batches_reviewer_user_idx\n"
            "  ON knowledge_base.historical_technical_source_import_batches(reviewer_user_id, started_at DESC);\n"
            "CREATE INDEX IF NOT EXISTS historical_technical_source_import_batches_status_idx\n"
            "  ON knowledge_base.historical_technical_source_import_batches(status, started_at DESC);\n"
            "CREATE INDEX IF NOT EXISTS historical_technical_source_import_batches_source_hash_idx\n"
            "  ON knowledge_base.historical_technical_source_import_batches(source_workbook_sha256);"
        )
        expected_link_sql = (
            "ALTER TABLE knowledge_base.historical_technical_source_candidates\n"
            "  ADD COLUMN IF NOT EXISTS human_review_import_batch_id BIGINT\n"
            "    REFERENCES knowledge_base.historical_technical_source_import_batches(id) ON DELETE SET NULL;\n"
            "CREATE INDEX IF NOT EXISTS historical_technical_source_candidates_import_batch_idx\n"
            "  ON knowledge_base.historical_technical_source_candidates(human_review_import_batch_id);"
        )

        def executable_sql(path):
            lines = path.read_text(encoding="utf-8").splitlines()
            active = [line for line in lines if line.strip() and not line.strip().startswith("--")]
            return "\n".join(active)

        self.assertEqual(executable_sql(self.batches_migration), expected_batches_sql)
        self.assertEqual(executable_sql(self.link_migration), expected_link_sql)

    def test_batches_migration_enforces_reviewer_combinations(self):
        text = self.batches_migration.read_text(encoding="utf-8")
        self.assertIn("reviewer_type = 'INTERNAL_USER' AND reviewer_user_id IS NOT NULL AND external_reviewer_label IS NULL", text)
        self.assertIn("reviewer_type = 'EXTERNAL_HUMAN' AND reviewer_user_id IS NULL AND external_reviewer_label IS NOT NULL", text)

    def test_batches_migration_enforces_sha256_uniqueness(self):
        text = self.batches_migration.read_text(encoding="utf-8")
        self.assertIn("source_workbook_sha256 TEXT NOT NULL UNIQUE", text)

    def test_migrations_are_additive_only(self):
        for path in (self.batches_migration, self.link_migration):
            text = path.read_text(encoding="utf-8")
            active_lines = [line for line in text.splitlines() if not line.strip().startswith("--")]
            active_text = "\n".join(active_lines)
            for forbidden in ("DROP TABLE knowledge_base.historical_technical_source_import_batches;\n", "DELETE FROM", "INSERT INTO", "TRUNCATE"):
                self.assertNotIn(forbidden, active_text)

    def test_link_migration_does_not_rewrite_the_candidates_table(self):
        text = self.link_migration.read_text(encoding="utf-8")
        self.assertIn("ADD COLUMN IF NOT EXISTS", text)
        self.assertNotIn("NOT NULL DEFAULT", text)  # a non-null default would force a table rewrite

    def test_no_workbook_paths_or_filenames_stored(self):
        for path in (self.batches_migration, self.link_migration):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn(".xlsx", text)


if __name__ == "__main__":
    unittest.main()
