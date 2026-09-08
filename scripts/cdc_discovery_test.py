#!/usr/bin/env python3
"""Synthetic test suite for scripts/cdc_discovery.py.

SYNTHETIC DATA ONLY. No real archive filenames, paths, project names, or
PostgreSQL rows are used anywhere in this file. All DB access is mocked/
stubbed - no live PostgreSQL connection is required or attempted.

Written against the stdlib `unittest` framework (matching
scripts/archive_cartography/test_scan_archive.py's existing convention in
this repo, and requiring no new dependency). unittest.TestCase classes are
also fully discoverable and runnable by pytest, if/when it is installed:

    python3 -m unittest scripts.cdc_discovery_test -v      # works today
    python3 -m pytest scripts/cdc_discovery_test.py -v     # works once pytest is installed
"""
from __future__ import annotations

import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, patch

# A syntactically-valid but entirely fake connection string. _connect() is
# always mocked/patched in these tests, so this value is never used to
# actually reach any host.
FAKE_DATABASE_URL = "postgresql://synthetic:synthetic@127.0.0.1/synthetic_test_db"

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("cdc_discovery", HERE / "cdc_discovery.py")
cdc = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = cdc
SPEC.loader.exec_module(cdc)


# =====================================================================
# Synthetic fixtures - none of these strings are real archive data.
# =====================================================================


def synthetic_row(
    id: int,
    relative_path: str,
    filename: str,
    extension: str = "pdf",
    sha256: str | None = None,
    source_root_label: str | None = None,
) -> "cdc.ArchiveFileRow":
    return cdc.ArchiveFileRow(
        id=id,
        relative_path=relative_path,
        filename=filename,
        extension=extension,
        sha256=sha256,
        source_root_label=source_root_label,
    )


def synthetic_pilot_rows() -> list["cdc.ArchiveFileRow"]:
    """Three synthetic project folders, a handful of files each, including
    one deliberate duplicate pair (same synthetic sha256). Convention 1:
    year embedded directly in relative_path."""
    return [
        synthetic_row(1, "OFFRES 2020/PROJECT-ALPHA/cahier des charges.pdf", "cahier des charges.pdf", sha256="a" * 64),
        synthetic_row(2, "OFFRES 2020/PROJECT-ALPHA/annexe technique.pdf", "annexe technique.pdf"),
        synthetic_row(3, "OFFRES 2020/PROJECT-BETA/dao document.pdf", "dao document.pdf", sha256="b" * 64),
        synthetic_row(4, "OFFRES 2021/PROJECT-GAMMA/rapport final.pdf", "rapport final.pdf", sha256="b" * 64),
        synthetic_row(5, "OFFRES 2021/PROJECT-GAMMA/photo site.jpg", "photo site.jpg", extension="jpg"),
        synthetic_row(6, "OFFRES 2022/PROJECT-DELTA/unrelated.txt", "unrelated.txt", extension="txt"),
    ]


def build_synthetic_archive(
    total_years: int = 18,
    total_projects: int = 433,
    convention: str = "path_embedded",
) -> list["cdc.ArchiveFileRow"]:
    """A synthetic archive shaped exactly like the real one: `total_years`
    OFFRES year folders, `total_projects` distinct project folders spread
    across them (as evenly as possible), one file per project. Every
    filename/project name here is synthetic (SYNTH-PROJECT-####).

    `convention` selects which real storage convention
    derive_project_folder_key must handle (see its docstring):
      - "path_embedded": relative_path = "OFFRES <year>/<project>/file.pdf"
      - "root_scoped": relative_path = "<project>/file.pdf", year comes from
        source_root_label = "OFFRES <year>"
      - "prefix_embedded": relative_path =
        "ARCHIVE_ROOT/OFFRES <year>/<project>/file.pdf" - the convention
        CONFIRMED against the real database (2026-09 diagnosis).
    """
    rows: list["cdc.ArchiveFileRow"] = []
    base_year = 2009
    per_year, remainder = divmod(total_projects, total_years)
    file_id = 1
    project_counter = 0

    for year_index in range(total_years):
        year = base_year + year_index
        projects_this_year = per_year + (1 if year_index < remainder else 0)
        for _ in range(projects_this_year):
            project_counter += 1
            project_name = f"SYNTH-PROJECT-{project_counter:04d}"
            if convention == "path_embedded":
                rows.append(
                    synthetic_row(file_id, f"OFFRES {year}/{project_name}/document.pdf", "document.pdf")
                )
            elif convention == "root_scoped":
                rows.append(
                    synthetic_row(
                        file_id, f"{project_name}/document.pdf", "document.pdf",
                        source_root_label=f"OFFRES {year}",
                    )
                )
            elif convention == "prefix_embedded":
                rows.append(
                    synthetic_row(
                        file_id, f"ARCHIVE_ROOT/OFFRES {year}/{project_name}/document.pdf", "document.pdf"
                    )
                )
            else:
                raise ValueError(convention)
            file_id += 1

    return rows


class InMemoryCandidateRepository:
    """Synthetic double for CandidateRepository. Simulates the same UNIQUE
    (archive_file_id) upsert semantics as the real Postgres table, plus a
    snapshot/restore mechanism so rollback_batch() can be proven without a
    real transaction."""

    def __init__(self) -> None:
        self.store: dict[int, "cdc.CdcCandidate"] = {}
        self._snapshot: dict[int, "cdc.CdcCandidate"] | None = None
        self.fail_after: int | None = None
        self._calls = 0

    def begin_batch(self) -> None:
        self._snapshot = dict(self.store)

    def commit_batch(self) -> None:
        self._snapshot = None

    def rollback_batch(self) -> None:
        assert self._snapshot is not None
        self.store = self._snapshot
        self._snapshot = None

    def upsert(self, candidate: "cdc.CdcCandidate") -> str:
        self._calls += 1
        if self.fail_after is not None and self._calls > self.fail_after:
            raise RuntimeError("synthetic upsert failure")
        outcome = "updated" if candidate.archive_file_id in self.store else "inserted"
        self.store[candidate.archive_file_id] = candidate
        return outcome


# =====================================================================
# 1/2/3 - CLI safety
# =====================================================================


class TestCliSafety(unittest.TestCase):
    def _connect_should_never_be_called(self):
        mock_connect = MagicMock(side_effect=AssertionError("DB connect must not be attempted"))
        return patch.object(cdc, "_connect", mock_connect), mock_connect

    def test_help_performs_zero_discovery(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stdout(io.StringIO()) as out:
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--help"])
        self.assertEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)
        self.assertIn("usage:", out.getvalue().lower())

    def test_no_arguments_performs_zero_discovery(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_pilot_limit_without_dry_run_or_persist_fails_closed(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--pilot-limit", "25"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_dry_run_and_persist_together_fails_closed(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--pilot-limit", "25", "--dry-run", "--persist"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_negative_pilot_limit_fails_closed(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--pilot-limit", "-5", "--dry-run"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_summary_combined_with_persist_fails_closed(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--summary", "--persist"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_idempotent_run_without_persist_fails_closed(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--pilot-limit", "5", "--dry-run", "--idempotent-run"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)


# =====================================================================
# 4/5 - pilot-limit selects project folders, deterministically
# =====================================================================


class TestPilotFolderSelection(unittest.TestCase):
    def test_selects_exactly_requested_number_of_project_folders(self):
        rows = synthetic_pilot_rows()  # 4 distinct project folders across 6 files
        selected = cdc.select_pilot_project_folders(rows, limit=2)
        self.assertEqual(len(selected), 2)

    def test_selection_never_exceeds_available_distinct_folders(self):
        rows = synthetic_pilot_rows()
        selected = cdc.select_pilot_project_folders(rows, limit=100)
        self.assertEqual(len(selected), 4)  # ALPHA, BETA, GAMMA, DELTA

    def test_selection_counts_folders_not_files_or_candidates(self):
        # PROJECT-ALPHA alone has 2 files; requesting 1 folder must select
        # that whole folder's worth of files downstream, not "1 file".
        rows = synthetic_pilot_rows()
        candidates, counters = cdc.run_pilot_discovery(rows, pilot_limit=1)
        self.assertEqual(counters.project_folders_selected, 1)
        self.assertGreaterEqual(counters.files_metadata_inspected, 1)

    def test_selection_is_deterministic_across_repeated_calls(self):
        rows = synthetic_pilot_rows()
        first = cdc.select_pilot_project_folders(rows, limit=3)
        second = cdc.select_pilot_project_folders(rows, limit=3)
        third = cdc.select_pilot_project_folders(list(reversed(rows)), limit=3)
        self.assertEqual(first, second)
        self.assertEqual(first, third)  # order of input rows must not affect the result

    def test_project_folder_key_uses_year_and_project_segments_only(self):
        key = cdc.derive_project_folder_key("OFFRES 2020/PROJECT-ALPHA/Dossier Client/deep/nested/file.pdf")
        self.assertEqual(key, "OFFRES 2020/PROJECT-ALPHA")

    def test_project_folder_key_none_for_shallow_paths(self):
        self.assertIsNone(cdc.derive_project_folder_key("just-a-file.pdf"))

    def test_project_folder_key_root_scoped_convention(self):
        key = cdc.derive_project_folder_key(
            "SYNTH-PROJECT-0001/Dossier Client/document.pdf", source_root_label="OFFRES 2011"
        )
        self.assertEqual(key, "OFFRES 2011/SYNTH-PROJECT-0001")


# =====================================================================
# Regression tests for the real --pilot-limit 25 dry-run bug: it reported
# project_folders_selected=18 (== number of OFFRES year folders, not
# projects) and files_metadata_inspected=40853 (== the WHOLE archive).
# Both numbers prove the exact same root cause: project-folder keys were
# collapsing to year-level granularity, so the 18 "folders" covered every
# file in the archive. All fixtures below are synthetic.
# =====================================================================


class TestProjectFolderBugRegression(unittest.TestCase):
    def test_year_folders_alone_are_never_counted_as_projects(self):
        # Files sitting directly in the year folder (no project subfolder
        # beneath them) must contribute zero project folders - this is
        # exactly the bug: 18 year folders must never be countable as 18
        # "projects".
        rows = [synthetic_row(i, f"OFFRES {2009 + i}/loose-file.pdf", "loose-file.pdf") for i in range(18)]
        self.assertEqual(cdc.enumerate_project_folders(rows), [])

        rows_root_scoped = [
            synthetic_row(i, "loose-file.pdf", "loose-file.pdf", source_root_label=f"OFFRES {2009 + i}")
            for i in range(18)
        ]
        self.assertEqual(cdc.enumerate_project_folders(rows_root_scoped), [])

    def test_realistic_scale_18_years_433_projects_path_embedded(self):
        rows = build_synthetic_archive(total_years=18, total_projects=433, convention="path_embedded")
        folders = cdc.enumerate_project_folders(rows)
        self.assertEqual(len(folders), 433)
        self.assertEqual(len(set(folders)), 433)  # no accidental collisions

    def test_realistic_scale_18_years_433_projects_root_scoped(self):
        rows = build_synthetic_archive(total_years=18, total_projects=433, convention="root_scoped")
        folders = cdc.enumerate_project_folders(rows)
        self.assertEqual(len(folders), 433)
        self.assertEqual(len(set(folders)), 433)

    def test_pilot_limit_25_returns_exactly_25_of_433(self):
        for convention in ("path_embedded", "root_scoped"):
            rows = build_synthetic_archive(total_years=18, total_projects=433, convention=convention)
            selected = cdc.select_pilot_project_folders(rows, limit=25)
            self.assertEqual(len(selected), 25, convention)

    def test_files_from_unselected_projects_are_excluded(self):
        # 433 projects, 3 files each (one per project would not exercise
        # this - need multiple files per project, with only some projects
        # selected).
        rows = []
        file_id = 1
        for project_index in range(50):  # 50 projects, well over pilot_limit
            for doc_index in range(3):
                rows.append(
                    synthetic_row(
                        file_id,
                        f"OFFRES 2015/SYNTH-PROJECT-{project_index:03d}/doc-{doc_index}.pdf",
                        f"doc-{doc_index}.pdf",
                    )
                )
                file_id += 1
        total_files = len(rows)  # 150

        candidates, counters = cdc.run_pilot_discovery(rows, pilot_limit=5)
        self.assertEqual(counters.project_folders_selected, 5)
        self.assertEqual(counters.files_metadata_inspected, 15)  # 5 projects * 3 files
        self.assertLess(counters.files_metadata_inspected, total_files)

    def test_files_metadata_inspected_never_equals_full_archive_for_a_pilot(self):
        rows = build_synthetic_archive(total_years=18, total_projects=433, convention="path_embedded")
        # 1 file per project in this fixture, so the full archive has 433 files.
        candidates, counters = cdc.run_pilot_discovery(rows, pilot_limit=25)
        self.assertEqual(counters.project_folders_selected, 25)
        self.assertEqual(counters.files_metadata_inspected, 25)
        self.assertLess(counters.files_metadata_inspected, len(rows))

    def test_files_outside_offres_scope_are_excluded(self):
        rows = [
            synthetic_row(1, "OFFRES 2020/SYNTH-PROJECT-0001/document.pdf", "document.pdf"),
            # Not under any "OFFRES <year>" folder, and not under a
            # year-labeled source root either - out of scope entirely.
            synthetic_row(2, "ARCHIVES_DIVERS/SOMETHING/document.pdf", "document.pdf"),
            synthetic_row(3, "misc-file.pdf", "misc-file.pdf", source_root_label="Backups"),
        ]
        folders = cdc.enumerate_project_folders(rows)
        self.assertEqual(folders, ["OFFRES 2020/SYNTH-PROJECT-0001"])

        candidates, counters = cdc.run_pilot_discovery(rows, pilot_limit=10)
        self.assertEqual(counters.project_folders_selected, 1)
        self.assertEqual(counters.files_metadata_inspected, 1)

    def test_pilot_duplicate_counts_exclude_out_of_scope_duplicates(self):
        shared_hash = "d" * 64
        rows = [
            # Selected project (OFFRES 2020/P): a genuine in-scope duplicate pair.
            synthetic_row(1, "OFFRES 2020/P/a.pdf", "a.pdf", sha256=shared_hash),
            synthetic_row(2, "OFFRES 2020/P/b.pdf", "b.pdf", sha256=shared_hash),
            # A different, UNSELECTED project that happens to share the same
            # hash - must not inflate the pilot's duplicate counts.
            synthetic_row(3, "OFFRES 2021/OTHER-PROJECT/c.pdf", "c.pdf", sha256=shared_hash),
        ]
        candidates, counters = cdc.run_pilot_discovery(rows, pilot_limit=1)  # selects only OFFRES 2020/P
        self.assertEqual(counters.project_folders_selected, 1)
        self.assertEqual(counters.files_metadata_inspected, 2)
        self.assertEqual(counters.duplicate_groups, 1)
        self.assertEqual(counters.duplicate_files, 1)  # not 2, which global scope would have given


# =====================================================================
# Real storage convention (confirmed via safe, read-only, aggregate-only
# PostgreSQL diagnosis, 2026-09): relative_path =
# "<constant archive-root prefix>/OFFRES <year>/<project>/...file", i.e.
# the OFFRES-year token sits at path segment 2, not segment 1 - the
# previous fix only checked segment 1 (and, separately, source_root_label),
# which is why the real 25-project dry-run returned project_folders_selected: 0.
# =====================================================================


class TestConfirmedPrefixEmbeddedConvention(unittest.TestCase):
    def test_project_folder_key_with_one_prefix_segment_before_year(self):
        key = cdc.derive_project_folder_key("ARCHIVE_ROOT/OFFRES 2013/SYNTH-PROJECT-0001/document.pdf")
        self.assertEqual(key, "OFFRES 2013/SYNTH-PROJECT-0001")

    def test_year_at_segment_2_deep_nesting_still_resolves_to_immediate_child(self):
        key = cdc.derive_project_folder_key(
            "ARCHIVE_ROOT/OFFRES 2013/SYNTH-PROJECT-0001/Dossier Client/deep/nested/document.pdf"
        )
        self.assertEqual(key, "OFFRES 2013/SYNTH-PROJECT-0001")

    def test_loose_file_directly_in_year_folder_excluded_with_prefix(self):
        self.assertIsNone(cdc.derive_project_folder_key("ARCHIVE_ROOT/OFFRES 2013/loose-file.pdf"))

    def test_project_segment_that_looks_like_a_year_is_used_as_is_not_skipped(self):
        # A confirmed real archive year has a project folder immediately
        # under the year folder whose own name happens to textually
        # resemble "OFFRES <year>" (e.g. an internal reference/archival
        # subfolder naming convention). Manually verified per-year project
        # counts (2026-09) prove that segment IS the project - a previous
        # version of this code skipped it, assuming it was a duplicated
        # wrapper, which inflated that year's count instead of fixing it.
        # This must NOT be special-cased or skipped.
        key = cdc.derive_project_folder_key(
            "ARCHIVE_ROOT/OFFRES 2013/OFFRES 2013/document.pdf"
        )
        self.assertEqual(key, "OFFRES 2013/OFFRES 2013")

    def test_year_like_project_segment_still_requires_a_filename_beneath_it(self):
        # Even though the project segment itself is not skipped, the
        # existing "must have a filename beneath the project" rule still
        # applies - a file sitting directly in the year folder is still
        # excluded regardless of what the (nonexistent) project segment
        # would have looked like.
        self.assertIsNone(cdc.derive_project_folder_key("ARCHIVE_ROOT/OFFRES 2013/loose-file.pdf"))

    def test_synthetic_18_years_433_projects_prefix_embedded_enumerates_exactly_433(self):
        # Proves the LOGIC is exactly correct for clean, complete data
        # matching the confirmed real convention (every project folder has
        # at least one file). MANUAL FILESYSTEM VERIFICATION (2026-09)
        # settled the historical 420-vs-433 question definitively:
        #   433 physical top-level OFFRES project folders exist on disk.
        #   411 of those contain at least one file (document-bearing).
        #    22 of those are genuinely empty (zero files, on purpose or
        #       not - either way, zero documents to classify).
        # The automatic DB-derived enumeration is CORRECT at 411 - it
        # reflects the 411 document-bearing projects exactly (7 of 18
        # years match the verified "with files" count precisely, the rest
        # are exact per Step 9's confirmation). It intentionally does NOT
        # and should NOT try to reach 433: a file-row-based enumeration can
        # never see a folder with zero files, and a folder with zero files
        # has zero CDC candidates to discover regardless. This test proves
        # the logic reaches 433/433 given synthetic data where every
        # project has at least one file - the real 411 is a fact about the
        # archive's contents, not a defect in this function.
        rows = build_synthetic_archive(total_years=18, total_projects=433, convention="prefix_embedded")
        folders = cdc.enumerate_project_folders(rows)
        self.assertEqual(len(folders), 433)

    def test_pilot_limit_25_on_prefix_embedded_convention(self):
        rows = build_synthetic_archive(total_years=18, total_projects=433, convention="prefix_embedded")
        selected = cdc.select_pilot_project_folders(rows, limit=25)
        self.assertEqual(len(selected), 25)

    def test_files_scoped_to_selected_25_projects_prefix_embedded(self):
        rows = build_synthetic_archive(total_years=18, total_projects=433, convention="prefix_embedded")
        candidates, counters = cdc.run_pilot_discovery(rows, pilot_limit=25)
        self.assertEqual(counters.project_folders_selected, 25)
        self.assertEqual(counters.files_metadata_inspected, 25)  # 1 file per project in this fixture
        self.assertLess(counters.files_metadata_inspected, len(rows))

    def test_manually_verified_physical_folder_count_reproduces_exactly_when_every_folder_has_a_file(self):
        # The manually-verified per-year PHYSICAL folder counts (i.e. every
        # top-level OFFRES project folder that exists on disk, whether or
        # not it contains any file) - 433 total. Reproduced here as
        # SYNTHETIC per-year quantities only (no real folder/project/client
        # names). This is a hypothetical "no empty folders" scenario: it
        # proves the enumeration logic is exact per-year for archive data
        # where every physical folder happens to contain at least one
        # file. The real archive is NOT this scenario - see
        # test_automatic_enumeration_matches_the_411_document_bearing_projects
        # below for the actual, correct target.
        physical_counts_by_year = {
            2009: 42, 2010: 52, 2011: 18, 2012: 23, 2013: 1, 2014: 22,
            2015: 17, 2016: 38, 2017: 29, 2018: 43, 2019: 30, 2020: 44,
            2021: 4, 2022: 5, 2023: 11, 2024: 18, 2025: 11, 2026: 25,
        }
        self.assertEqual(sum(physical_counts_by_year.values()), 433)

        rows: list["cdc.ArchiveFileRow"] = []
        file_id = 1
        for year, project_count in physical_counts_by_year.items():
            for project_index in range(project_count):
                rows.append(
                    synthetic_row(
                        file_id,
                        f"ARCHIVE_ROOT/OFFRES {year}/SYNTH-PROJECT-{project_index:04d}/document.pdf",
                        "document.pdf",
                    )
                )
                file_id += 1

        folders = cdc.enumerate_project_folders(rows)
        self.assertEqual(len(folders), 433)

        per_year_detected: dict[int, int] = {}
        for key in folders:
            year_segment, _, _ = key.partition("/")
            year = int(year_segment.replace("OFFRES ", ""))
            per_year_detected[year] = per_year_detected.get(year, 0) + 1
        self.assertEqual(per_year_detected, physical_counts_by_year)

    def test_automatic_enumeration_matches_the_411_document_bearing_projects(self):
        # AUTHORITATIVE FACTS (manual filesystem verification, 2026-09):
        #   433 physical top-level OFFRES project folders exist.
        #   411 of them contain at least one file (document-bearing).
        #    22 of them are genuinely empty.
        # The automatic DB-derived project count is 411, and it is
        # CORRECT - it is not something to "fix" toward 433. This is the
        # real per-year "with files" breakdown (measured directly against
        # the real database with the current, fixed logic), reproduced
        # here as a synthetic fixture to prove the code's output for a
        # dataset that genuinely has no empty-folder blind spot (every
        # synthetic project below has exactly one file, by construction).
        document_bearing_counts_by_year = {
            2009: 42, 2010: 50, 2011: 18, 2012: 23, 2013: 1, 2014: 21,
            2015: 17, 2016: 37, 2017: 26, 2018: 38, 2019: 27, 2020: 41,
            2021: 4, 2022: 4, 2023: 10, 2024: 17, 2025: 10, 2026: 25,
        }
        self.assertEqual(sum(document_bearing_counts_by_year.values()), 411)

        rows: list["cdc.ArchiveFileRow"] = []
        file_id = 1
        for year, project_count in document_bearing_counts_by_year.items():
            for project_index in range(project_count):
                rows.append(
                    synthetic_row(
                        file_id,
                        f"ARCHIVE_ROOT/OFFRES {year}/SYNTH-PROJECT-{project_index:04d}/document.pdf",
                        "document.pdf",
                    )
                )
                file_id += 1

        folders = cdc.enumerate_project_folders(rows)
        self.assertEqual(len(folders), 411)

    def test_selection_deterministic_for_prefix_embedded_convention(self):
        rows = build_synthetic_archive(total_years=18, total_projects=433, convention="prefix_embedded")
        first = cdc.select_pilot_project_folders(rows, limit=25)
        second = cdc.select_pilot_project_folders(list(reversed(rows)), limit=25)
        self.assertEqual(first, second)


# =====================================================================
# 6/7/8 - classification safety, status validation, role validation
# =====================================================================


class TestClassificationSafety(unittest.TestCase):
    def test_metadata_only_classification_never_produces_confirmed_cdc(self):
        # Even the strongest possible metadata signal (filename literally
        # named after a CDC pattern) must cap out at LIKELY_CDC.
        result = cdc.classify_metadata("OFFRES 2020/PROJECT-ALPHA", "cahier des charges definitif.pdf")
        self.assertNotEqual(result.metadata_status, "CONFIRMED_CDC")
        self.assertIn(result.metadata_status, ("LIKELY_CDC", "NEEDS_REVIEW", "NOT_CDC"))

    def test_dao_tdr_dce_never_automatically_equal_cdc(self):
        for filename in ("dao document.pdf", "tdr mission.pdf", "dce evaluation.pdf"):
            result = cdc.classify_metadata("OFFRES 2020/PROJECT-X", filename)
            self.assertNotEqual(result.document_role, "CDC", filename)
            self.assertNotEqual(result.metadata_status, "CONFIRMED_CDC", filename)

    def test_finalize_status_requires_verified_as_cdc_for_confirmed(self):
        not_attempted = cdc.ContentInspectionOutcome(attempted=False, verified_as_cdc=False, verified_not_cdc=False)
        self.assertEqual(cdc.finalize_cdc_status("LIKELY_CDC", not_attempted), "LIKELY_CDC")

        attempted_but_not_verified = cdc.ContentInspectionOutcome(attempted=True, verified_as_cdc=False, verified_not_cdc=False)
        self.assertNotEqual(cdc.finalize_cdc_status("LIKELY_CDC", attempted_but_not_verified), "CONFIRMED_CDC")

        verified = cdc.ContentInspectionOutcome(attempted=True, verified_as_cdc=True, verified_not_cdc=False, confidence=0.95)
        self.assertEqual(cdc.finalize_cdc_status("LIKELY_CDC", verified), "CONFIRMED_CDC")

    def test_null_content_inspector_never_verifies_anything(self):
        inspector = cdc.NullContentInspector()
        counters = cdc.DiscoveryCounters()
        outcome = inspector.inspect(archive_file_id=1, extension="pdf", counters=counters)
        self.assertFalse(outcome.attempted)
        self.assertFalse(outcome.verified_as_cdc)
        self.assertEqual(counters.files_content_inspected, 0)
        self.assertEqual(counters.external_calls, 0)

    def test_pilot_discovery_produces_zero_confirmed_cdc_with_null_inspector(self):
        rows = synthetic_pilot_rows()
        candidates, counters = cdc.run_pilot_discovery(rows, pilot_limit=10)
        self.assertEqual(counters.confirmed_cdc, 0)
        self.assertTrue(all(c.cdc_status != "CONFIRMED_CDC" for c in candidates))

    def test_cdc_candidate_rejects_invalid_status(self):
        with self.assertRaises(ValueError):
            cdc.CdcCandidate(
                archive_file_id=1, year=None, project_reference=None, document_role="UNKNOWN",
                cdc_status="MAYBE_CDC", confidence=0.5, detection_method="RULE", reason="x",
                duplicate_of_archive_file_id=None, is_primary_candidate=True, needs_human_review=False,
            )

    def test_cdc_candidate_rejects_invalid_role(self):
        with self.assertRaises(ValueError):
            cdc.CdcCandidate(
                archive_file_id=1, year=None, project_reference=None, document_role="SPREADSHEET",
                cdc_status="NOT_CDC", confidence=0.1, detection_method="RULE", reason="x",
                duplicate_of_archive_file_id=None, is_primary_candidate=True, needs_human_review=False,
            )

    def test_cdc_candidate_rejects_confirmed_cdc_from_metadata_detection_method(self):
        with self.assertRaises(ValueError):
            cdc.CdcCandidate(
                archive_file_id=1, year=None, project_reference=None, document_role="CDC",
                cdc_status="CONFIRMED_CDC", confidence=0.9, detection_method=cdc.DETECTION_METHOD_METADATA,
                reason="x", duplicate_of_archive_file_id=None, is_primary_candidate=True, needs_human_review=False,
            )

    def test_all_document_role_values_accepted(self):
        for role in cdc.DOCUMENT_ROLES:
            candidate = cdc.CdcCandidate(
                archive_file_id=1, year=None, project_reference=None, document_role=role,
                cdc_status="NOT_CDC", confidence=0.1, detection_method="RULE", reason="x",
                duplicate_of_archive_file_id=None, is_primary_candidate=True, needs_human_review=False,
            )
            self.assertEqual(candidate.document_role, role)

    def test_all_cdc_status_values_accepted_except_confirmed_via_metadata(self):
        for status in cdc.CDC_STATUSES:
            if status == "CONFIRMED_CDC":
                continue  # covered separately - requires a non-metadata detection_method
            candidate = cdc.CdcCandidate(
                archive_file_id=1, year=None, project_reference=None, document_role="UNKNOWN",
                cdc_status=status, confidence=0.1, detection_method="RULE", reason="x",
                duplicate_of_archive_file_id=None, is_primary_candidate=True, needs_human_review=False,
            )
            self.assertEqual(candidate.cdc_status, status)


# =====================================================================
# 9 - duplicate handling
# =====================================================================


class TestDuplicateHandling(unittest.TestCase):
    def test_null_sha256_is_never_treated_as_duplicate(self):
        rows = [synthetic_row(1, "OFFRES 2020/P/a.pdf", "a.pdf"), synthetic_row(2, "OFFRES 2020/P/b.pdf", "b.pdf")]
        groups, files = cdc.count_duplicate_groups_and_files(rows)
        self.assertEqual((groups, files), (0, 0))

    def test_shared_sha256_forms_one_duplicate_group(self):
        rows = [
            synthetic_row(1, "OFFRES 2020/P/a.pdf", "a.pdf", sha256="x" * 64),
            synthetic_row(2, "OFFRES 2020/P/b.pdf", "b.pdf", sha256="x" * 64),
            synthetic_row(3, "OFFRES 2020/P/c.pdf", "c.pdf", sha256="y" * 64),
        ]
        groups, files = cdc.count_duplicate_groups_and_files(rows)
        self.assertEqual(groups, 1)
        self.assertEqual(files, 1)  # 2 members - 1 primary = 1 duplicate file

    def test_lowest_id_in_group_is_primary(self):
        rows = [
            synthetic_row(5, "OFFRES 2020/P/a.pdf", "a.pdf", sha256="x" * 64),
            synthetic_row(2, "OFFRES 2020/P/b.pdf", "b.pdf", sha256="x" * 64),
        ]
        assignments = cdc.assign_duplicate_relationships(rows)
        self.assertTrue(assignments[2].is_primary_candidate)
        self.assertIsNone(assignments[2].duplicate_of_archive_file_id)
        self.assertFalse(assignments[5].is_primary_candidate)
        self.assertEqual(assignments[5].duplicate_of_archive_file_id, 2)

    def test_unique_file_is_its_own_primary(self):
        rows = [synthetic_row(1, "OFFRES 2020/P/a.pdf", "a.pdf", sha256="z" * 64)]
        assignments = cdc.assign_duplicate_relationships(rows)
        self.assertTrue(assignments[1].is_primary_candidate)
        self.assertIsNone(assignments[1].duplicate_of_archive_file_id)


# =====================================================================
# 10 - aggregate reporting contains no filenames/paths
# =====================================================================


class TestAggregateReportingIsSafe(unittest.TestCase):
    def test_summary_output_never_contains_synthetic_filenames_or_paths(self):
        rows = synthetic_pilot_rows()
        candidates, counters = cdc.run_pilot_discovery(rows, pilot_limit=10)

        buffer = io.StringIO()
        with redirect_stdout(buffer):
            cdc._print_summary(counters.as_dict())
        output = buffer.getvalue()

        forbidden_markers = [
            "cahier des charges.pdf", "annexe technique.pdf", "dao document.pdf",
            "rapport final.pdf", "photo site.jpg", "unrelated.txt",
            "PROJECT-ALPHA", "PROJECT-BETA", "PROJECT-GAMMA", "PROJECT-DELTA",
            "/mnt/", "a" * 64, "b" * 64,
        ]
        for marker in forbidden_markers:
            self.assertNotIn(marker, output, f"leaked marker in aggregate output: {marker!r}")

    def test_summary_output_is_aggregate_counts_only(self):
        counters = cdc.DiscoveryCounters(project_folders_selected=3, files_metadata_inspected=12, confirmed_cdc=0)
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            cdc._print_summary(counters.as_dict())
        output = buffer.getvalue()
        self.assertIn("project_folders_selected: 3", output)
        self.assertIn("files_metadata_inspected: 12", output)


# =====================================================================
# 11/12 - persistence upsert/idempotency + rollback
# =====================================================================


class TestPersistenceIdempotencyAndRollback(unittest.TestCase):
    def _candidate(self, archive_file_id: int, status: str = "NOT_CDC") -> "cdc.CdcCandidate":
        return cdc.CdcCandidate(
            archive_file_id=archive_file_id, year=2020, project_reference=None, document_role="UNKNOWN",
            cdc_status=status, confidence=0.1, detection_method="RULE", reason="synthetic",
            duplicate_of_archive_file_id=None, is_primary_candidate=True, needs_human_review=False,
        )

    def test_first_insert_works(self):
        repo = InMemoryCandidateRepository()
        result = cdc.persist_candidates(repo, [self._candidate(1), self._candidate(2)])
        self.assertEqual(result.inserted, 2)
        self.assertEqual(result.updated, 0)
        self.assertFalse(result.failed_batch)
        self.assertEqual(len(repo.store), 2)

    def test_second_identical_run_creates_zero_duplicates(self):
        repo = InMemoryCandidateRepository()
        cdc.persist_candidates(repo, [self._candidate(1), self._candidate(2)])
        result = cdc.persist_candidates(repo, [self._candidate(1), self._candidate(2)])
        self.assertEqual(result.inserted, 0)
        self.assertEqual(result.updated, 2)
        self.assertEqual(len(repo.store), 2)  # still exactly 2 rows, no duplicates

    def test_intentional_status_update_is_handled_predictably(self):
        repo = InMemoryCandidateRepository()
        cdc.persist_candidates(repo, [self._candidate(1, status="NEEDS_REVIEW")])
        cdc.persist_candidates(repo, [self._candidate(1, status="NOT_CDC")])
        self.assertEqual(len(repo.store), 1)
        self.assertEqual(repo.store[1].cdc_status, "NOT_CDC")

    def test_batch_failure_rolls_back_all_writes_in_that_batch(self):
        repo = InMemoryCandidateRepository()
        repo.fail_after = 1  # succeed once, then fail on the 2nd upsert
        result = cdc.persist_candidates(repo, [self._candidate(1), self._candidate(2), self._candidate(3)])
        self.assertTrue(result.failed_batch)
        self.assertEqual(len(repo.store), 0)  # the successful 1st write was rolled back too

    def test_failed_records_are_never_silently_marked_successful(self):
        repo = InMemoryCandidateRepository()
        repo.fail_after = 0
        result = cdc.persist_candidates(repo, [self._candidate(1)])
        self.assertTrue(result.failed_batch)
        self.assertEqual(result.inserted, 0)
        self.assertEqual(result.updated, 0)


# =====================================================================
# 13 - confidence validation
# =====================================================================


class TestConfidenceValidation(unittest.TestCase):
    def test_confidence_boundaries_are_accepted(self):
        for confidence in (0.0, 1.0, 0.5):
            candidate = cdc.CdcCandidate(
                archive_file_id=1, year=None, project_reference=None, document_role="UNKNOWN",
                cdc_status="NOT_CDC", confidence=confidence, detection_method="RULE", reason="x",
                duplicate_of_archive_file_id=None, is_primary_candidate=True, needs_human_review=False,
            )
            self.assertEqual(candidate.confidence, confidence)

    def test_confidence_above_one_is_rejected(self):
        with self.assertRaises(ValueError):
            cdc.CdcCandidate(
                archive_file_id=1, year=None, project_reference=None, document_role="UNKNOWN",
                cdc_status="NOT_CDC", confidence=1.5, detection_method="RULE", reason="x",
                duplicate_of_archive_file_id=None, is_primary_candidate=True, needs_human_review=False,
            )

    def test_confidence_below_zero_is_rejected(self):
        with self.assertRaises(ValueError):
            cdc.CdcCandidate(
                archive_file_id=1, year=None, project_reference=None, document_role="UNKNOWN",
                cdc_status="NOT_CDC", confidence=-0.1, detection_method="RULE", reason="x",
                duplicate_of_archive_file_id=None, is_primary_candidate=True, needs_human_review=False,
            )


# =====================================================================
# 14 - dry-run causes zero writes
# =====================================================================


class TestDryRunCausesZeroWrites(unittest.TestCase):
    def test_dry_run_never_constructs_a_repository_or_writes(self):
        fake_conn = MagicMock()
        rows = synthetic_pilot_rows()

        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(cdc, "_connect", return_value=fake_conn), \
             patch.object(cdc, "_fetch_archive_file_rows", return_value=rows), \
             patch.object(cdc, "PostgresCandidateRepository") as mock_repo_cls, \
             redirect_stdout(io.StringIO()):
            exit_code = cdc.run_pilot_mode(pilot_limit=2, dry_run=True, persist=False, idempotent_run=False)

        self.assertEqual(exit_code, 0)
        mock_repo_cls.assert_not_called()
        fake_conn.transaction.assert_not_called()

    def test_persist_mode_does_construct_a_repository(self):
        fake_conn = MagicMock()
        rows = synthetic_pilot_rows()

        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(cdc, "_connect", return_value=fake_conn), \
             patch.object(cdc, "_fetch_archive_file_rows", return_value=rows), \
             patch.object(cdc, "PostgresCandidateRepository") as mock_repo_cls, \
             patch.object(cdc, "persist_candidates", return_value=cdc.PersistResult(inserted=1, updated=0)), \
             redirect_stdout(io.StringIO()):
            exit_code = cdc.run_pilot_mode(pilot_limit=2, dry_run=False, persist=True, idempotent_run=True)

        self.assertEqual(exit_code, 0)
        mock_repo_cls.assert_called_once()

    def test_persist_mode_calls_commit_on_success(self):
        # Regression test for a real bug found against a live database (see
        # run_full_corpus_mode's identical fix): _connect() never sets
        # autocommit=True, so conn.transaction() alone never durably
        # commits once the connection is already inside an ambient
        # transaction (started by the earlier _fetch_archive_file_rows
        # read) - without an explicit commit, rows are reported as
        # persisted while conn.close() silently discards them.
        fake_conn = MagicMock()
        rows = synthetic_pilot_rows()
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(cdc, "_connect", return_value=fake_conn), \
             patch.object(cdc, "_fetch_archive_file_rows", return_value=rows), \
             patch.object(cdc, "PostgresCandidateRepository") as mock_repo_cls, \
             patch.object(cdc, "persist_candidates", return_value=cdc.PersistResult(inserted=1, updated=0)), \
             redirect_stdout(io.StringIO()):
            exit_code = cdc.run_pilot_mode(pilot_limit=2, dry_run=False, persist=True, idempotent_run=False)

        self.assertEqual(exit_code, 0)
        fake_conn.commit.assert_called_once()

    def test_dry_run_never_calls_commit(self):
        fake_conn = MagicMock()
        rows = synthetic_pilot_rows()
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(cdc, "_connect", return_value=fake_conn), \
             patch.object(cdc, "_fetch_archive_file_rows", return_value=rows), \
             patch.object(cdc, "PostgresCandidateRepository") as mock_repo_cls, \
             redirect_stdout(io.StringIO()):
            exit_code = cdc.run_pilot_mode(pilot_limit=2, dry_run=True, persist=False, idempotent_run=False)

        self.assertEqual(exit_code, 0)
        fake_conn.commit.assert_not_called()

    def test_failed_batch_never_calls_commit(self):
        fake_conn = MagicMock()
        rows = synthetic_pilot_rows()
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(cdc, "_connect", return_value=fake_conn), \
             patch.object(cdc, "_fetch_archive_file_rows", return_value=rows), \
             patch.object(cdc, "PostgresCandidateRepository") as mock_repo_cls, \
             patch.object(
                 cdc, "persist_candidates",
                 return_value=cdc.PersistResult(inserted=0, updated=0, failed_batch=True),
             ), \
             redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            exit_code = cdc.run_pilot_mode(pilot_limit=2, dry_run=False, persist=True, idempotent_run=False)

        self.assertEqual(exit_code, 1)
        fake_conn.commit.assert_not_called()

    def test_commit_failure_is_reported_as_a_failed_batch(self):
        fake_conn = MagicMock()
        fake_conn.commit.side_effect = RuntimeError("connection lost")
        rows = synthetic_pilot_rows()
        buffer = io.StringIO()
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(cdc, "_connect", return_value=fake_conn), \
             patch.object(cdc, "_fetch_archive_file_rows", return_value=rows), \
             patch.object(cdc, "PostgresCandidateRepository") as mock_repo_cls, \
             patch.object(cdc, "persist_candidates", return_value=cdc.PersistResult(inserted=1, updated=0)), \
             redirect_stdout(buffer), redirect_stderr(io.StringIO()):
            exit_code = cdc.run_pilot_mode(pilot_limit=2, dry_run=False, persist=True, idempotent_run=False)

        self.assertEqual(exit_code, 1)  # commit failure must be a failed batch, never silent success
        self.assertNotIn("rows_inserted: 1", buffer.getvalue())

    def test_content_inspection_dry_run_still_zero_writes(self):
        # --enable-content-inspection changes WHAT is inspected, never
        # whether dry-run writes anything.
        fake_conn = MagicMock()
        rows = synthetic_pilot_rows()

        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(cdc, "_connect", return_value=fake_conn), \
             patch.object(cdc, "_fetch_archive_file_rows_with_root_path", return_value=rows), \
             patch.object(cdc, "PostgresCandidateRepository") as mock_repo_cls, \
             redirect_stdout(io.StringIO()):
            exit_code = cdc.run_pilot_mode(
                pilot_limit=2, dry_run=True, persist=False, idempotent_run=False, enable_content_inspection=True
            )

        self.assertEqual(exit_code, 0)
        mock_repo_cls.assert_not_called()
        fake_conn.transaction.assert_not_called()


# =====================================================================
# Content-inspector injection at the orchestration level (run_pilot_discovery)
# =====================================================================


class FakeContentInspector:
    """Synthetic double satisfying the ContentInspector Protocol - proves
    run_pilot_discovery correctly wires an injected inspector end-to-end
    without needing the real LocalContentInspector or any real file."""

    def __init__(self, outcome: "cdc.ContentInspectionOutcome"):
        self._outcome = outcome
        self.calls = 0
        self.received_file_paths: list = []

    def inspect(self, archive_file_id, extension, counters, file_path=None):
        self.calls += 1
        self.received_file_paths.append(file_path)
        return self._outcome


class TestContentInspectorInjection(unittest.TestCase):
    def test_default_inspector_is_null_and_confirmed_cdc_stays_zero(self):
        rows = synthetic_pilot_rows()
        candidates, counters = cdc.run_pilot_discovery(rows, pilot_limit=10)
        self.assertEqual(counters.confirmed_cdc, 0)
        self.assertEqual(counters.files_content_inspected, 0)

    def test_injected_inspector_can_produce_confirmed_cdc(self):
        rows = synthetic_pilot_rows()
        confirming_outcome = cdc.ContentInspectionOutcome(
            attempted=True,
            extraction_method="pdf_text",
            verified_as_cdc=True,
            document_role="CDC",
            confidence=0.95,
            reason_code="synthetic_confirmed",
        )
        fake_inspector = FakeContentInspector(confirming_outcome)
        candidates, counters = cdc.run_pilot_discovery(rows, pilot_limit=10, content_inspector=fake_inspector)
        self.assertGreater(counters.confirmed_cdc, 0)
        self.assertTrue(any(c.cdc_status == "CONFIRMED_CDC" for c in candidates))

    def test_not_cdc_metadata_files_are_never_content_inspected(self):
        # A file with no candidate signal at all in its filename/path
        # (metadata_status = NOT_CDC) must never reach the content
        # inspector - only LIKELY_CDC/NEEDS_REVIEW candidates do.
        rows = [
            synthetic_row(1, "OFFRES 2020/PROJECT-ALPHA/cahier des charges.pdf", "cahier des charges.pdf"),  # candidate
            synthetic_row(2, "OFFRES 2020/PROJECT-ALPHA/unrelated.txt", "unrelated.txt", extension="txt"),  # NOT_CDC
        ]
        never_called_outcome = cdc.ContentInspectionOutcome(attempted=True, verified_as_cdc=True, reason_code="should_not_happen")
        fake_inspector = FakeContentInspector(never_called_outcome)
        cdc.run_pilot_discovery(rows, pilot_limit=10, content_inspector=fake_inspector)
        self.assertEqual(fake_inspector.calls, 1)  # only the candidate file

    def test_content_inspector_receives_resolved_file_path_when_root_path_available(self):
        rows = [
            cdc.ArchiveFileRow(
                id=1,
                relative_path="OFFRES 2020/PROJECT-ALPHA/cahier des charges.pdf",
                filename="cahier des charges.pdf",
                extension="pdf",
                sha256=None,
                source_root_path="/tmp/synthetic-root",
            )
        ]
        outcome = cdc.ContentInspectionOutcome(attempted=True, verified_not_cdc=True, reason_code="synthetic")
        fake_inspector = FakeContentInspector(outcome)
        cdc.run_pilot_discovery(rows, pilot_limit=10, content_inspector=fake_inspector)
        self.assertEqual(fake_inspector.received_file_paths, [Path("/tmp/synthetic-root/OFFRES 2020/PROJECT-ALPHA/cahier des charges.pdf")])

    def test_content_inspector_receives_none_path_when_root_path_unavailable(self):
        rows = synthetic_pilot_rows()  # source_root_path defaults to None
        outcome = cdc.ContentInspectionOutcome(attempted=True, verified_not_cdc=True, reason_code="synthetic")
        fake_inspector = FakeContentInspector(outcome)
        cdc.run_pilot_discovery(rows, pilot_limit=10, content_inspector=fake_inspector)
        self.assertTrue(all(path is None for path in fake_inspector.received_file_paths))

    def test_resolve_archive_file_path_pure_helper(self):
        row_with_root = cdc.ArchiveFileRow(
            id=1, relative_path="OFFRES 2020/PROJECT/file.pdf", filename="file.pdf",
            extension="pdf", sha256=None, source_root_path="/synthetic/root",
        )
        self.assertEqual(
            cdc.resolve_archive_file_path(row_with_root), Path("/synthetic/root/OFFRES 2020/PROJECT/file.pdf")
        )
        row_without_root = cdc.ArchiveFileRow(
            id=2, relative_path="OFFRES 2020/PROJECT/file.pdf", filename="file.pdf", extension="pdf", sha256=None,
        )
        self.assertIsNone(cdc.resolve_archive_file_path(row_without_root))


# =====================================================================
# 2026-09 path-mapping fix: DB relative_path -> current mount location.
# root_path already points at the OFFRES-containing directory directly;
# any leading "wrapper" segment(s) before the OFFRES-year segment in
# relative_path must be dropped, not joined verbatim. Synthetic names only.
# =====================================================================


class TestArchiveFilePathMapping(unittest.TestCase):
    def test_convention_a_no_wrapper_prefix_joins_verbatim(self):
        # relative_path already starts at "OFFRES <year>" - nothing to
        # strip, root_path already points at the right place.
        row = cdc.ArchiveFileRow(
            id=1, relative_path="OFFRES 2015/SYNTH-PROJECT/document.pdf", filename="document.pdf",
            extension="pdf", sha256=None, source_root_path="/synthetic/mount",
        )
        self.assertEqual(
            cdc.resolve_archive_file_path(row), Path("/synthetic/mount/OFFRES 2015/SYNTH-PROJECT/document.pdf")
        )

    def test_convention_c_wrapper_prefix_is_stripped(self):
        # relative_path carries a leading wrapper segment before the
        # OFFRES-year segment (exactly the real-archive shape confirmed
        # 2026-09) - that segment must be dropped when reconstructing the
        # CURRENT on-disk path, since root_path already corresponds to
        # what used to be that wrapper's own parent.
        row = cdc.ArchiveFileRow(
            id=1, relative_path="SYNTH_ARCHIVE_WRAPPER/OFFRES 2015/SYNTH-PROJECT/document.pdf",
            filename="document.pdf", extension="pdf", sha256=None, source_root_path="/synthetic/mount",
        )
        self.assertEqual(
            cdc.resolve_archive_file_path(row), Path("/synthetic/mount/OFFRES 2015/SYNTH-PROJECT/document.pdf")
        )

    def test_convention_c_wrapper_stripped_regardless_of_nesting_depth(self):
        row = cdc.ArchiveFileRow(
            id=1,
            relative_path="SYNTH_WRAPPER/OFFRES 2018/SYNTH-PROJECT/Sub Folder/deep/document.pdf",
            filename="document.pdf", extension="pdf", sha256=None, source_root_path="/synthetic/mount",
        )
        self.assertEqual(
            cdc.resolve_archive_file_path(row),
            Path("/synthetic/mount/OFFRES 2018/SYNTH-PROJECT/Sub Folder/deep/document.pdf"),
        )

    def test_root_scoped_convention_b_needs_no_stripping(self):
        # Per-year source root: relative_path already starts at the
        # project level (no year segment in the path at all) - joined
        # verbatim, same as before.
        row = cdc.ArchiveFileRow(
            id=1, relative_path="SYNTH-PROJECT/document.pdf", filename="document.pdf",
            extension="pdf", sha256=None, source_root_label="OFFRES 2011", source_root_path="/synthetic/year-root",
        )
        self.assertEqual(cdc.resolve_archive_file_path(row), Path("/synthetic/year-root/SYNTH-PROJECT/document.pdf"))

    def test_parent_traversal_in_relative_path_is_rejected(self):
        row = cdc.ArchiveFileRow(
            id=1, relative_path="OFFRES 2015/../../../etc/passwd", filename="passwd",
            extension=None, sha256=None, source_root_path="/synthetic/mount",
        )
        self.assertIsNone(cdc.resolve_archive_file_path(row))

    def test_wrapper_prefixed_traversal_is_also_rejected(self):
        row = cdc.ArchiveFileRow(
            id=1, relative_path="SYNTH_WRAPPER/OFFRES 2015/../../../../etc/passwd", filename="passwd",
            extension=None, sha256=None, source_root_path="/synthetic/mount",
        )
        self.assertIsNone(cdc.resolve_archive_file_path(row))

    def test_resolved_path_never_escapes_the_configured_root(self):
        # A broader property check across several synthetic shapes: no
        # matter the relative_path shape, the resolved candidate (when not
        # None) must always be a descendant of source_root_path.
        root = Path("/synthetic/mount")
        rows = [
            cdc.ArchiveFileRow(id=1, relative_path="OFFRES 2009/P/a.pdf", filename="a.pdf", extension="pdf", sha256=None, source_root_path=str(root)),
            cdc.ArchiveFileRow(id=2, relative_path="WRAP/OFFRES 2009/P/b.pdf", filename="b.pdf", extension="pdf", sha256=None, source_root_path=str(root)),
            cdc.ArchiveFileRow(id=3, relative_path="../../outside/c.pdf", filename="c.pdf", extension="pdf", sha256=None, source_root_path=str(root)),
        ]
        for row in rows:
            resolved = cdc.resolve_archive_file_path(row)
            if resolved is not None:
                self.assertTrue(
                    resolved.is_relative_to(root) if hasattr(resolved, "is_relative_to") else str(resolved).startswith(str(root))
                )


# =====================================================================
# --validate-single-confirmed (SAFE LOCAL VALIDATION MODE)
# =====================================================================


class TestValidateSingleConfirmedCliGating(unittest.TestCase):
    """Task 2/10.6-10.8: --validate-single-confirmed must fail closed,
    before any archive processing, in every disallowed combination."""

    def _connect_should_never_be_called(self):
        mock_connect = MagicMock(side_effect=AssertionError("DB connect must not be attempted"))
        return patch.object(cdc, "_connect", mock_connect), mock_connect

    def test_rejected_when_combined_with_persist(self):
        # --pilot-limit requires exactly one of --dry-run/--persist, so this
        # single case exercises both "combined with --persist" and "used
        # without --dry-run" at once - the two are the same input by
        # construction under that pre-existing mutual-exclusivity rule.
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--pilot-limit", "25", "--persist", "--enable-content-inspection", "--validate-single-confirmed"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_rejected_without_enable_content_inspection(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--pilot-limit", "25", "--dry-run", "--validate-single-confirmed"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_rejected_when_combined_with_idempotent_run(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--pilot-limit", "25", "--persist", "--idempotent-run",
                    "--enable-content-inspection", "--validate-single-confirmed",
                ])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_rejected_when_combined_with_summary(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--summary", "--validate-single-confirmed"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_accepted_with_exactly_the_required_flags(self):
        # Only proves argparse/_validate_args accept the combination and
        # proceed to attempt a DB connection (the only thing gated) - the
        # actual discovery run is exercised separately below with the
        # connection mocked out.
        mock_connect = MagicMock(side_effect=RuntimeError("stop right after arg validation"))
        with patch.object(cdc, "_connect", mock_connect), \
             patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             redirect_stderr(io.StringIO()):
            with self.assertRaises(RuntimeError):
                cdc.main(["--pilot-limit", "25", "--dry-run", "--enable-content-inspection", "--validate-single-confirmed"])
        self.assertEqual(mock_connect.call_count, 1)


class TestRunSingleConfirmedValidation(unittest.TestCase):
    """Task 3/4/5/6/8/9: run_single_confirmed_validation's cardinality and
    decision logic, exercised directly against synthetic in-memory
    CdcCandidate objects - never touches the database or a real file."""

    def _candidate(self, archive_file_id: int, cdc_status: str, structural_validation: dict | None = None) -> "cdc.CdcCandidate":
        return cdc.CdcCandidate(
            archive_file_id=archive_file_id, year=2020, project_reference=None, document_role="CDC",
            cdc_status=cdc_status, confidence=0.95, detection_method="LOCAL_CONTENT_V1", reason="synthetic",
            duplicate_of_archive_file_id=None, is_primary_candidate=True, needs_human_review=False,
            structural_validation=structural_validation,
        )

    _VALIDATED_EVIDENCE = {
        "explicit_cdc_role": "YES", "scope_requirements": "YES", "technical_requirements": "YES",
        "deliverables": "YES", "bidder_obligations": "NO", "evaluation_requirements": "NO",
        "administrative_requirements": "YES", "possible_dao": "NO", "possible_tdr": "NO",
        "possible_dce": "NO", "possible_rfp": "NO", "possible_offer": "NO",
        "validation_result": "VALIDATED_CDC",
    }

    _REJECTED_EVIDENCE = {
        "explicit_cdc_role": "NO", "scope_requirements": "NO", "technical_requirements": "NO",
        "deliverables": "NO", "bidder_obligations": "NO", "evaluation_requirements": "NO",
        "administrative_requirements": "NO", "possible_dao": "YES", "possible_tdr": "NO",
        "possible_dce": "NO", "possible_rfp": "NO", "possible_offer": "NO",
        "validation_result": "REJECTED_NOT_CDC",
    }

    _AMBIGUOUS_EVIDENCE = {
        "explicit_cdc_role": "YES", "scope_requirements": "NO", "technical_requirements": "NO",
        "deliverables": "NO", "bidder_obligations": "NO", "evaluation_requirements": "NO",
        "administrative_requirements": "NO", "possible_dao": "NO", "possible_tdr": "YES",
        "possible_dce": "NO", "possible_rfp": "NO", "possible_offer": "NO",
        "validation_result": "NEEDS_HUMAN_REVIEW",
    }

    def test_scenario_1_zero_confirmed_candidates(self):
        candidates = [self._candidate(1, "NOT_CDC"), self._candidate(2, "LIKELY_CDC")]
        result = cdc.run_single_confirmed_validation(candidates)
        self.assertEqual(result, {"confirmed_candidates_found": 0, "validation_result": "NO_CONFIRMED_CANDIDATE"})

    def test_scenario_2_single_strong_candidate_is_validated(self):
        candidates = [self._candidate(1, "CONFIRMED_CDC", self._VALIDATED_EVIDENCE)]
        result = cdc.run_single_confirmed_validation(candidates)
        self.assertEqual(result["confirmed_candidates_found"], 1)
        self.assertEqual(result["validation_result"], "VALIDATED_CDC")
        self.assertEqual(result["explicit_cdc_role"], "YES")
        self.assertEqual(result["possible_dao"], "NO")

    def test_scenario_3_ambiguous_candidate_needs_human_review(self):
        candidates = [self._candidate(1, "CONFIRMED_CDC", self._AMBIGUOUS_EVIDENCE)]
        result = cdc.run_single_confirmed_validation(candidates)
        self.assertEqual(result["validation_result"], "NEEDS_HUMAN_REVIEW")

    def test_scenario_4_dao_like_candidate_is_rejected(self):
        candidates = [self._candidate(1, "CONFIRMED_CDC", self._REJECTED_EVIDENCE)]
        result = cdc.run_single_confirmed_validation(candidates)
        self.assertIn(result["validation_result"], ("REJECTED_NOT_CDC", "NEEDS_HUMAN_REVIEW"))

    def test_scenario_5_multiple_confirmed_candidates_never_picks_one(self):
        candidates = [
            self._candidate(1, "CONFIRMED_CDC", self._VALIDATED_EVIDENCE),
            self._candidate(2, "CONFIRMED_CDC", self._VALIDATED_EVIDENCE),
        ]
        result = cdc.run_single_confirmed_validation(candidates)
        self.assertEqual(result, {"confirmed_candidates_found": 2, "validation_result": "MULTIPLE_CONFIRMED_CANDIDATES"})

    def test_missing_structural_validation_fails_closed(self):
        # A CONFIRMED_CDC candidate whose structural_validation was never
        # populated (e.g. constructed directly, bypassing LocalContentInspector)
        # must never be guessed at - always NEEDS_HUMAN_REVIEW with UNKNOWN flags.
        candidates = [self._candidate(1, "CONFIRMED_CDC", None)]
        result = cdc.run_single_confirmed_validation(candidates)
        self.assertEqual(result["validation_result"], "NEEDS_HUMAN_REVIEW")
        self.assertEqual(result["explicit_cdc_role"], "UNKNOWN")

    def test_scenario_9_10_no_identifying_information_in_output(self):
        candidates = [self._candidate(42, "CONFIRMED_CDC", self._VALIDATED_EVIDENCE)]
        result = cdc.run_single_confirmed_validation(candidates)
        self.assertNotIn("archive_file_id", result)
        self.assertNotIn(42, result.values())
        for value in result.values():
            self.assertIn(value, ("YES", "NO", "UNKNOWN", "VALIDATED_CDC", "REJECTED_NOT_CDC", "NEEDS_HUMAN_REVIEW", 1, 0))

    def test_scenario_11_result_never_claims_a_database_write(self):
        candidates = [self._candidate(1, "CONFIRMED_CDC", self._VALIDATED_EVIDENCE)]
        result = cdc.run_single_confirmed_validation(candidates)
        self.assertEqual(result["database_writes"], 0)
        self.assertEqual(result["archive_modified"], "NO")


class TestValidateSingleConfirmedIntegration(unittest.TestCase):
    """Wires --validate-single-confirmed through run_pilot_mode end-to-end
    with a mocked DB connection and synthetic rows that have no resolvable
    file path (so the real LocalContentInspector fails closed without ever
    opening a file), proving the new fields are appended safely and
    existing behavior/counters are untouched."""

    def _run(self, pilot_limit: int = 2, validate_single_confirmed: bool = True) -> tuple[int, str]:
        fake_conn = MagicMock()
        rows = synthetic_pilot_rows()  # no source_root_path -> file_path stays None
        buffer = io.StringIO()
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(cdc, "_connect", return_value=fake_conn), \
             patch.object(cdc, "_fetch_archive_file_rows_with_root_path", return_value=rows), \
             patch.object(cdc, "PostgresCandidateRepository") as mock_repo_cls, \
             redirect_stdout(buffer):
            exit_code = cdc.run_pilot_mode(
                pilot_limit=pilot_limit, dry_run=True, persist=False, idempotent_run=False,
                enable_content_inspection=True, validate_single_confirmed=validate_single_confirmed,
            )
        mock_repo_cls.assert_not_called()
        fake_conn.transaction.assert_not_called()
        return exit_code, buffer.getvalue()

    def test_scenario_12_no_confirmed_candidates_reports_safely_and_zero_external_calls(self):
        exit_code, output = self._run(validate_single_confirmed=True)
        self.assertEqual(exit_code, 0)
        self.assertIn("confirmed_candidates_found: 0", output)
        self.assertIn("validation_result: NO_CONFIRMED_CANDIDATE", output)
        self.assertIn("external_calls: 0", output)
        self.assertIn("rows_inserted: 0", output)

    def test_scenario_13_non_validation_mode_output_is_unchanged(self):
        exit_code, output = self._run(validate_single_confirmed=False)
        self.assertEqual(exit_code, 0)
        self.assertNotIn("confirmed_candidates_found", output)
        self.assertNotIn("validation_result", output)


# =====================================================================
# --open-single-confirmed (SAFE LOCAL DOCUMENT OPENER)
# =====================================================================


class TestOpenSingleConfirmedDocumentUnit(unittest.TestCase):
    """Direct unit tests of open_single_confirmed_document() with
    subprocess.Popen mocked - never spawns a real viewer, never touches
    anything outside a synthetic /tmp fixture."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp(prefix="cdc-open-single-confirmed-test-")
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)
        self.synthetic_file = Path(self.tmp_dir).resolve() / "OFFRES 2020" / "PROJECT-ALPHA" / "cahier des charges.pdf"
        self.synthetic_file.parent.mkdir(parents=True)
        self.synthetic_file.write_bytes(b"%PDF-synthetic-placeholder")

    def _candidate(self, archive_file_id: int, cdc_status: str = "CONFIRMED_CDC") -> "cdc.CdcCandidate":
        return cdc.CdcCandidate(
            archive_file_id=archive_file_id, year=2020, project_reference=None, document_role="CDC",
            cdc_status=cdc_status, confidence=0.95, detection_method="LOCAL_CONTENT_V1", reason="synthetic",
            duplicate_of_archive_file_id=None, is_primary_candidate=True, needs_human_review=False,
        )

    def _row(self, archive_file_id: int, relative_path: str = "OFFRES 2020/PROJECT-ALPHA/cahier des charges.pdf") -> "cdc.ArchiveFileRow":
        return cdc.ArchiveFileRow(
            id=archive_file_id, relative_path=relative_path, filename="cahier des charges.pdf",
            extension="pdf", sha256=None, source_root_path=self.tmp_dir,
        )

    def test_scenario_1_zero_confirmed_opener_not_called(self):
        candidates = [self._candidate(1, "NOT_CDC")]
        rows = [self._row(1)]
        with patch.object(cdc.subprocess, "Popen") as mock_popen:
            result = cdc.open_single_confirmed_document(candidates, rows)
        mock_popen.assert_not_called()
        self.assertEqual(result, {})

    def test_scenario_2_multiple_confirmed_opener_not_called(self):
        candidates = [self._candidate(1), self._candidate(2)]
        rows = [self._row(1), self._row(2)]
        with patch.object(cdc.subprocess, "Popen") as mock_popen:
            result = cdc.open_single_confirmed_document(candidates, rows)
        mock_popen.assert_not_called()
        self.assertEqual(result, {})

    def test_scenario_3_exactly_one_confirmed_opener_called_once(self):
        candidates = [self._candidate(1)]
        rows = [self._row(1)]
        with patch.object(cdc.subprocess, "Popen") as mock_popen:
            result = cdc.open_single_confirmed_document(candidates, rows)
        self.assertEqual(mock_popen.call_count, 1)
        self.assertEqual(result["document_open_process_started"], "YES")

    def test_scenario_4_correct_internal_path_passed_to_opener(self):
        candidates = [self._candidate(1)]
        rows = [self._row(1)]
        with patch.object(cdc.subprocess, "Popen") as mock_popen:
            cdc.open_single_confirmed_document(candidates, rows)
        (command,), kwargs = mock_popen.call_args
        self.assertEqual(command[-1], str(self.synthetic_file))
        self.assertIn(command[0], ("xdg-open", "gio"))

    def test_scenario_5_outside_root_path_rejected(self):
        candidates = [self._candidate(1)]
        rows = [self._row(1, relative_path="../../outside/secret.pdf")]
        with patch.object(cdc.subprocess, "Popen") as mock_popen:
            result = cdc.open_single_confirmed_document(candidates, rows)
        mock_popen.assert_not_called()
        self.assertEqual(result["document_open_process_started"], "NO")
        self.assertEqual(result["open_failure_reason"], "INVALID_FILE_PATH")

    def test_scenario_12_stdout_is_devnull(self):
        candidates = [self._candidate(1)]
        rows = [self._row(1)]
        with patch.object(cdc.subprocess, "Popen") as mock_popen:
            cdc.open_single_confirmed_document(candidates, rows)
        _, kwargs = mock_popen.call_args
        self.assertIs(kwargs["stdout"], cdc.subprocess.DEVNULL)

    def test_scenario_13_stderr_is_devnull(self):
        candidates = [self._candidate(1)]
        rows = [self._row(1)]
        with patch.object(cdc.subprocess, "Popen") as mock_popen:
            cdc.open_single_confirmed_document(candidates, rows)
        _, kwargs = mock_popen.call_args
        self.assertIs(kwargs["stderr"], cdc.subprocess.DEVNULL)

    def test_scenario_14_no_filename_or_path_in_output(self):
        candidates = [self._candidate(1)]
        rows = [self._row(1)]
        with patch.object(cdc.subprocess, "Popen"):
            result = cdc.open_single_confirmed_document(candidates, rows)
        serialized = repr(result)
        self.assertNotIn("cahier des charges.pdf", serialized)
        self.assertNotIn(str(self.synthetic_file), serialized)
        self.assertNotIn("PROJECT-ALPHA", serialized)

    def test_scenario_15_no_raw_document_text_in_output(self):
        # open_single_confirmed_document never reads document content at
        # all - it only resolves a path and launches an external viewer -
        # this locks in that every returned value is a short safe code.
        candidates = [self._candidate(1)]
        rows = [self._row(1)]
        with patch.object(cdc.subprocess, "Popen"):
            result = cdc.open_single_confirmed_document(candidates, rows)
        for value in result.values():
            self.assertIn(value, ("YES", "NO", "INVALID_FILE_PATH", "NO_GRAPHICAL_SESSION"))

    def test_opener_falls_back_from_xdg_open_to_gio(self):
        candidates = [self._candidate(1)]
        rows = [self._row(1)]
        with patch.object(cdc.subprocess, "Popen", side_effect=[FileNotFoundError(), MagicMock()]) as mock_popen:
            result = cdc.open_single_confirmed_document(candidates, rows)
        self.assertEqual(mock_popen.call_count, 2)
        self.assertEqual(result["document_open_process_started"], "YES")
        first_command = mock_popen.call_args_list[0].args[0]
        second_command = mock_popen.call_args_list[1].args[0]
        self.assertEqual(first_command[0], "xdg-open")
        self.assertEqual(second_command[0], "gio")

    def test_opener_reports_no_graphical_session_when_both_openers_missing(self):
        candidates = [self._candidate(1)]
        rows = [self._row(1)]
        with patch.object(cdc.subprocess, "Popen", side_effect=FileNotFoundError()):
            result = cdc.open_single_confirmed_document(candidates, rows)
        self.assertEqual(result["document_open_process_started"], "NO")
        self.assertEqual(result["open_failure_reason"], "NO_GRAPHICAL_SESSION")

    def test_no_matching_row_is_handled_safely(self):
        candidates = [self._candidate(999)]
        rows = [self._row(1)]
        with patch.object(cdc.subprocess, "Popen") as mock_popen:
            result = cdc.open_single_confirmed_document(candidates, rows)
        mock_popen.assert_not_called()
        self.assertEqual(result["open_failure_reason"], "INVALID_FILE_PATH")


class TestOpenSingleConfirmedCliGating(unittest.TestCase):
    """Scenarios 6-11: --open-single-confirmed CLI gating - fails safely
    before any archive processing / DB connection."""

    def _connect_should_never_be_called(self):
        mock_connect = MagicMock(side_effect=AssertionError("DB connect must not be attempted"))
        return patch.object(cdc, "_connect", mock_connect), mock_connect

    def test_scenario_6_requires_validate_single_confirmed(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--pilot-limit", "25", "--dry-run", "--enable-content-inspection", "--open-single-confirmed"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_scenario_7_requires_dry_run(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--pilot-limit", "25", "--persist", "--enable-content-inspection",
                    "--validate-single-confirmed", "--open-single-confirmed",
                ])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_scenario_8_requires_enable_content_inspection(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--pilot-limit", "25", "--dry-run", "--validate-single-confirmed", "--open-single-confirmed"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_scenario_9_rejects_persist(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--pilot-limit", "25", "--persist", "--enable-content-inspection",
                    "--validate-single-confirmed", "--open-single-confirmed",
                ])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_scenario_10_rejects_idempotent_run(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--pilot-limit", "25", "--persist", "--idempotent-run", "--enable-content-inspection",
                    "--validate-single-confirmed", "--open-single-confirmed",
                ])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_scenario_11_rejects_summary(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--summary", "--open-single-confirmed"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_accepted_with_exactly_the_required_flags(self):
        mock_connect = MagicMock(side_effect=RuntimeError("stop right after arg validation"))
        with patch.object(cdc, "_connect", mock_connect), \
             patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             redirect_stderr(io.StringIO()):
            with self.assertRaises(RuntimeError):
                cdc.main([
                    "--pilot-limit", "25", "--dry-run", "--enable-content-inspection",
                    "--validate-single-confirmed", "--open-single-confirmed",
                ])
        self.assertEqual(mock_connect.call_count, 1)


class TestOpenSingleConfirmedIntegration(unittest.TestCase):
    """Scenarios 16-19: wires --open-single-confirmed through run_pilot_mode
    end-to-end with a mocked DB connection and synthetic rows with no
    resolvable file path (so the real LocalContentInspector never produces
    a CONFIRMED_CDC candidate and the opener is never actually reached),
    proving existing behavior/counters stay untouched."""

    def _run(self, open_single_confirmed: bool, validate_single_confirmed: bool = True):
        fake_conn = MagicMock()
        rows = synthetic_pilot_rows()  # no source_root_path -> file_path stays None everywhere
        buffer = io.StringIO()
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(cdc, "_connect", return_value=fake_conn), \
             patch.object(cdc, "_fetch_archive_file_rows_with_root_path", return_value=rows), \
             patch.object(cdc, "PostgresCandidateRepository") as mock_repo_cls, \
             patch.object(cdc.subprocess, "Popen") as mock_popen, \
             redirect_stdout(buffer):
            exit_code = cdc.run_pilot_mode(
                pilot_limit=2, dry_run=True, persist=False, idempotent_run=False,
                enable_content_inspection=True, validate_single_confirmed=validate_single_confirmed,
                open_single_confirmed=open_single_confirmed,
            )
        mock_repo_cls.assert_not_called()
        fake_conn.transaction.assert_not_called()
        return exit_code, buffer.getvalue(), mock_popen

    def test_scenario_16_validation_mode_without_opening_is_unchanged(self):
        exit_code, output, mock_popen = self._run(open_single_confirmed=False)
        self.assertEqual(exit_code, 0)
        self.assertNotIn("document_open_requested", output)
        mock_popen.assert_not_called()

    def test_scenario_17_normal_discovery_mode_unchanged(self):
        exit_code, output, mock_popen = self._run(open_single_confirmed=False, validate_single_confirmed=False)
        self.assertEqual(exit_code, 0)
        self.assertNotIn("document_open_requested", output)
        self.assertNotIn("confirmed_candidates_found", output)
        mock_popen.assert_not_called()

    def test_scenario_18_dry_run_db_writes_remain_zero(self):
        exit_code, output, mock_popen = self._run(open_single_confirmed=True)
        self.assertEqual(exit_code, 0)
        self.assertIn("rows_inserted: 0", output)
        self.assertIn("rows_updated: 0", output)
        mock_popen.assert_not_called()  # no confirmed candidates possible in this synthetic fixture

    def test_scenario_19_external_calls_remains_zero(self):
        _exit_code, output, _mock_popen = self._run(open_single_confirmed=True)
        self.assertIn("external_calls: 0", output)


# =====================================================================
# --full-corpus (Phase 5: taxonomy-aware full-corpus technical-source
# discovery). Task 15's comprehensive synthetic test coverage.
# =====================================================================


class FakeTechnicalSourceContentInspector:
    """Synthetic double satisfying the ContentInspector Protocol, keyed by
    archive_file_id -> ContentInspectionOutcome, so different files in one
    synthetic batch can resolve to different roles/failure states."""

    def __init__(self, outcomes_by_id: dict, default_outcome=None):
        self._outcomes_by_id = outcomes_by_id
        self._default = default_outcome or cdc.ContentInspectionOutcome(attempted=False)
        self.calls = 0

    def inspect(self, archive_file_id, extension, counters, file_path=None):
        self.calls += 1
        return self._outcomes_by_id.get(archive_file_id, self._default)


def _technical_outcome(role: str, band: str = "STRONG_TECHNICAL_SOURCE", priority=None) -> "cdc.ContentInspectionOutcome":
    return cdc.ContentInspectionOutcome(
        attempted=True,
        extraction_method="pdf_text",
        technical_source_classification={
            "detected_role": role,
            "technical_source_candidate": role not in ("OFFER", "REPORT", "METHODOLOGY", "UNKNOWN"),
            "structural_score": 10,
            "structural_max": 17,
            "structural_ratio": 0.59,
            "structural_band": band,
            "review_priority": priority,
            "has_context_section": True,
            "has_objectives_section": True,
            "has_scope_section": True,
            "has_tdr_section": role in ("TDR", "DAO_WITH_TDR"),
            "has_cdc_section": role in ("CDC", "DAO_WITH_CDC"),
            "has_deliverables_section": True,
            "has_personnel_section": True,
            "has_evaluation_section": True,
        },
    )


class TestFullCorpusProjectEnumeration(unittest.TestCase):
    """Task 8: project_folders_selected must be DERIVED, never a hardcoded
    411 - proven by varying the synthetic archive's shape and confirming
    the count tracks it exactly."""

    def test_enumeration_is_not_hardcoded_and_tracks_input_shape(self):
        small = build_synthetic_archive(total_years=3, total_projects=12)
        large = build_synthetic_archive(total_years=5, total_projects=57)
        self.assertEqual(len(enumerate_project_folders_of(small)), 12)
        self.assertEqual(len(enumerate_project_folders_of(large)), 57)
        self.assertNotEqual(len(enumerate_project_folders_of(small)), 411)

    def test_full_corpus_selects_every_document_bearing_project(self):
        rows = build_synthetic_archive(total_years=4, total_projects=33)
        folders = cdc.enumerate_project_folders(rows)
        candidates, counters = cdc.run_technical_source_discovery_for_projects(rows, folders)
        self.assertEqual(counters.project_folders_selected, 33)


def enumerate_project_folders_of(rows):
    return cdc.enumerate_project_folders(rows)


class TestSplitIntoBatchesAndCheckpoint(unittest.TestCase):
    def test_split_into_batches_is_deterministic_and_covers_every_folder(self):
        folders = [f"OFFRES 2020/PROJECT-{i}" for i in range(7)]
        batches = cdc.split_into_batches(folders, 3)
        self.assertEqual(batches, [folders[0:3], folders[3:6], folders[6:7]])
        self.assertEqual(sum(len(b) for b in batches), len(folders))

    def test_split_into_batches_rejects_non_positive_size(self):
        with self.assertRaises(ValueError):
            cdc.split_into_batches(["a"], 0)

    def test_scope_signature_changes_with_batch_size(self):
        folders = ["OFFRES 2020/A", "OFFRES 2020/B"]
        sig_a = cdc.compute_batch_scope_signature(folders, cdc.build_full_corpus_scope_config(folders, 10, False))
        sig_b = cdc.compute_batch_scope_signature(folders, cdc.build_full_corpus_scope_config(folders, 20, False))
        self.assertNotEqual(sig_a, sig_b)

    def test_scope_signature_changes_with_project_set(self):
        folders_a, folders_b = ["OFFRES 2020/A"], ["OFFRES 2020/A", "OFFRES 2020/B"]
        sig_a = cdc.compute_batch_scope_signature(folders_a, cdc.build_full_corpus_scope_config(folders_a, 10, False))
        sig_b = cdc.compute_batch_scope_signature(folders_b, cdc.build_full_corpus_scope_config(folders_b, 10, False))
        self.assertNotEqual(sig_a, sig_b)

    def test_scope_signature_changes_with_content_inspection_flag(self):
        # Task 8: a metadata-only checkpoint must never be silently
        # resumable as a content-inspection run - the flag alone must
        # change the signature even with identical folders/batch_size.
        folders = ["OFFRES 2020/A", "OFFRES 2020/B"]
        sig_metadata_only = cdc.compute_batch_scope_signature(
            folders, cdc.build_full_corpus_scope_config(folders, 10, False)
        )
        sig_content_inspection = cdc.compute_batch_scope_signature(
            folders, cdc.build_full_corpus_scope_config(folders, 10, True)
        )
        self.assertNotEqual(sig_metadata_only, sig_content_inspection)

    def test_scope_config_includes_classifier_version(self):
        folders = ["OFFRES 2020/A"]
        config = cdc.build_full_corpus_scope_config(folders, 10, True)
        self.assertEqual(config["classifier_version"], cdc.TECHNICAL_SOURCE_CLASSIFIER_VERSION)
        self.assertEqual(config["mode"], "full_corpus")
        self.assertEqual(config["project_count"], 1)

    def test_describe_scope_mismatch_names_the_differing_dimension(self):
        old_config = {"batch_size": 10, "enable_content_inspection": False, "classifier_version": "v1"}
        new_config = {"batch_size": 10, "enable_content_inspection": True, "classifier_version": "v1"}
        message = cdc.describe_scope_mismatch(old_config, new_config)
        self.assertIn("enable_content_inspection", message)
        self.assertNotIn("batch_size:", message)  # unchanged dimension not listed

    def test_checkpoint_roundtrips_through_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "checkpoint.json"
            checkpoint = cdc.Checkpoint(
                scope_signature="deadbeef", batch_size=5, total_batches=3,
                completed_batches=[0, 1], failed_batches=[2], aggregate={"CDC": 4},
            )
            cdc.save_checkpoint(path, checkpoint)
            loaded = cdc.load_checkpoint(path)
            self.assertEqual(loaded.scope_signature, "deadbeef")
            self.assertEqual(loaded.completed_batches, [0, 1])
            self.assertEqual(loaded.failed_batches, [2])
            self.assertEqual(loaded.aggregate, {"CDC": 4})

    def test_missing_checkpoint_file_loads_as_none(self):
        self.assertIsNone(cdc.load_checkpoint(Path("/tmp/definitely-does-not-exist-cdc-checkpoint.json")))

    def test_malformed_checkpoint_file_fails_closed_to_none(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "checkpoint.json"
            path.write_text("not valid json{{{", encoding="utf-8")
            self.assertIsNone(cdc.load_checkpoint(path))

    def test_checkpoint_file_never_contains_a_project_or_file_name(self):
        # Task 9: "no confidential filenames/paths in CLI output" applies
        # equally to the checkpoint file itself, even though it is a local
        # artifact rather than stdout.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "checkpoint.json"
            folders = ["OFFRES 2020/SECRET-CLIENT-PROJECT-548"]
            config = cdc.build_full_corpus_scope_config(folders, 5, False)
            signature = cdc.compute_batch_scope_signature(folders, config)
            checkpoint = cdc.Checkpoint(scope_signature=signature, batch_size=5, total_batches=1, config=config)
            cdc.save_checkpoint(path, checkpoint)
            raw = path.read_text(encoding="utf-8")
            self.assertNotIn("SECRET-CLIENT-PROJECT", raw)
            self.assertNotIn("OFFRES 2020", raw)

    def test_merge_counters_into_aggregate_sums_across_batches(self):
        counters_a = cdc.FullCorpusCounters()
        counters_a.role_cdc = 2
        counters_b = cdc.FullCorpusCounters()
        counters_b.role_cdc = 3
        merged = cdc.merge_counters_into_aggregate({}, counters_a)
        merged = cdc.merge_counters_into_aggregate(merged, counters_b)
        self.assertEqual(merged["CDC"], 5)

    def test_merge_counters_into_aggregate_is_pure(self):
        aggregate = {"CDC": 1}
        counters = cdc.FullCorpusCounters()
        counters.role_cdc = 1
        cdc.merge_counters_into_aggregate(aggregate, counters)
        self.assertEqual(aggregate, {"CDC": 1})  # original dict untouched


class TestRunTechnicalSourceDiscoveryForProjects(unittest.TestCase):
    """Pure-orchestration unit tests (Task 4/5/6/10/16) against
    run_technical_source_discovery_for_projects directly - no DB, no
    filesystem, synthetic content_inspector doubles only."""

    def _rows(self):
        return [
            synthetic_row(1, "OFFRES 2020/PROJECT-ALPHA/dao avec tdr.pdf", "dao avec tdr.pdf", sha256="a" * 64),
            synthetic_row(2, "OFFRES 2020/PROJECT-ALPHA/rapport.pdf", "rapport.pdf"),
            synthetic_row(3, "OFFRES 2020/PROJECT-BETA/photo.jpg", "photo.jpg", extension="jpg"),
        ]

    def test_stage_a_prefilter_gates_stage_b(self):
        # photo.jpg never matches the prefilter (irrelevant extension) -
        # the injected inspector must never be called for it.
        rows = self._rows()
        outcomes = {1: _technical_outcome("DAO_WITH_TDR")}
        inspector = FakeTechnicalSourceContentInspector(outcomes)
        folders = cdc.enumerate_project_folders(rows)
        candidates, counters = cdc.run_technical_source_discovery_for_projects(
            rows, folders, content_inspector=inspector
        )
        self.assertLessEqual(inspector.calls, 1)  # dao avec tdr.pdf only

    def test_prefilter_candidate_without_stage_b_result_is_not_attempted(self):
        # "rapport.pdf" alone (no strong term) never becomes a prefilter
        # candidate, so its outcome is NOT_ATTEMPTED, not FAILED.
        rows = self._rows()
        inspector = FakeTechnicalSourceContentInspector({1: _technical_outcome("DAO_WITH_TDR")})
        folders = cdc.enumerate_project_folders(rows)
        candidates, counters = cdc.run_technical_source_discovery_for_projects(
            rows, folders, content_inspector=inspector
        )
        by_id = {c.archive_file_id: c for c in candidates}
        self.assertEqual(by_id[2].extraction_status, "NOT_ATTEMPTED")
        self.assertIsNone(by_id[2].review_priority)

    def test_extraction_failure_is_never_blocking_and_flagged_for_review(self):
        # Task 16: a relevant candidate whose extraction failed must never
        # block the rest of the corpus - it fails closed to
        # extraction_status=FAILED / review_priority=EXTRACTION_FAILED.
        rows = self._rows()
        failed_outcome = cdc.ContentInspectionOutcome(attempted=True, failed=True, reason_code="pdf_path_missing")
        inspector = FakeTechnicalSourceContentInspector({1: failed_outcome})
        folders = cdc.enumerate_project_folders(rows)
        candidates, counters = cdc.run_technical_source_discovery_for_projects(
            rows, folders, content_inspector=inspector
        )
        by_id = {c.archive_file_id: c for c in candidates}
        self.assertEqual(by_id[1].extraction_status, "FAILED")
        self.assertEqual(by_id[1].review_priority, "EXTRACTION_FAILED")
        self.assertEqual(counters.extraction_failed_priority, 1)

    def test_role_band_and_priority_are_tallied(self):
        rows = self._rows()
        inspector = FakeTechnicalSourceContentInspector(
            {1: _technical_outcome("DAO_WITH_TDR", priority="HIGH_PRIORITY")}
        )
        folders = cdc.enumerate_project_folders(rows)
        candidates, counters = cdc.run_technical_source_discovery_for_projects(
            rows, folders, content_inspector=inspector
        )
        self.assertEqual(counters.role_dao_with_tdr, 1)
        self.assertEqual(counters.strong_technical_source, 1)
        self.assertEqual(counters.high_priority, 1)

    def test_technical_bucket_filters_out_non_business_documents(self):
        rows = [synthetic_row(1, "OFFRES 2020/P/cahier des charges.pdf", "cahier des charges.pdf")]
        inspector = FakeTechnicalSourceContentInspector({1: _technical_outcome("CDC")})
        folders = cdc.enumerate_project_folders(rows)
        candidates, counters = cdc.run_technical_source_discovery_for_projects(
            rows, folders, content_inspector=inspector, technical_categories={1: "IMAGE"}
        )
        self.assertEqual(counters.prefilter_candidates, 0)
        self.assertEqual(inspector.calls, 0)

    def test_external_calls_remains_zero(self):
        rows = self._rows()
        inspector = FakeTechnicalSourceContentInspector({1: _technical_outcome("DAO_WITH_TDR")})
        folders = cdc.enumerate_project_folders(rows)
        _candidates, counters = cdc.run_technical_source_discovery_for_projects(
            rows, folders, content_inspector=inspector
        )
        self.assertEqual(counters.extraction.external_calls, 0)

    def test_duplicate_handling_is_reused(self):
        rows = [
            synthetic_row(1, "OFFRES 2020/P/cahier des charges.pdf", "cahier des charges.pdf", sha256="x" * 64),
            synthetic_row(2, "OFFRES 2020/P/copie cahier des charges.pdf", "copie cahier des charges.pdf", sha256="x" * 64),
        ]
        folders = cdc.enumerate_project_folders(rows)
        candidates, counters = cdc.run_technical_source_discovery_for_projects(rows, folders)
        self.assertEqual(counters.duplicate_groups, 1)
        by_id = {c.archive_file_id: c for c in candidates}
        self.assertTrue(by_id[1].is_primary_candidate)
        self.assertFalse(by_id[2].is_primary_candidate)
        self.assertEqual(by_id[2].duplicate_of_archive_file_id, 1)

    def test_duplicate_content_reuses_cached_classification_without_reinspecting(self):
        # Task 9 (review workflow) performance: two prefilter candidates
        # sharing a sha256 must be classified IDENTICALLY, and the second
        # one must never trigger a second real inspect() call.
        rows = [
            synthetic_row(1, "OFFRES 2020/P/cahier des charges.pdf", "cahier des charges.pdf", sha256="x" * 64),
            synthetic_row(2, "OFFRES 2020/P/copie cahier des charges.pdf", "copie cahier des charges.pdf", sha256="x" * 64),
        ]
        inspector = FakeTechnicalSourceContentInspector({1: _technical_outcome("CDC")})
        folders = cdc.enumerate_project_folders(rows)
        candidates, counters = cdc.run_technical_source_discovery_for_projects(
            rows, folders, content_inspector=inspector
        )
        self.assertEqual(inspector.calls, 1)  # the duplicate never reached the inspector a second time
        self.assertEqual(counters.duplicate_extractions_avoided, 1)
        by_id = {c.archive_file_id: c for c in candidates}
        self.assertEqual(by_id[1].detected_role, by_id[2].detected_role)
        self.assertEqual(by_id[1].structural_score, by_id[2].structural_score)

    def test_null_sha256_files_are_never_cached_together(self):
        # A NULL hash is never treated as a duplicate anywhere in this
        # pipeline - two different un-hashed files must each be inspected
        # independently, never conflated via a shared cache key of None.
        rows = [
            synthetic_row(1, "OFFRES 2020/P/cahier des charges.pdf", "cahier des charges.pdf", sha256=None),
            synthetic_row(2, "OFFRES 2020/P/copie cahier des charges.pdf", "copie cahier des charges.pdf", sha256=None),
        ]
        inspector = FakeTechnicalSourceContentInspector({1: _technical_outcome("CDC"), 2: _technical_outcome("TDR")})
        folders = cdc.enumerate_project_folders(rows)
        candidates, counters = cdc.run_technical_source_discovery_for_projects(
            rows, folders, content_inspector=inspector
        )
        self.assertEqual(inspector.calls, 2)
        self.assertEqual(counters.duplicate_extractions_avoided, 0)


class TestRunPrefilterOnlyDiscoveryForProjects(unittest.TestCase):
    """Synthetic-only unit tests for run_prefilter_only_discovery_for_projects
    - the metadata-only candidate recreation path used by
    --persist-prefilter-only. No DB, no filesystem, no content inspector of
    any kind is ever constructed here."""

    def _rows(self):
        return [
            synthetic_row(1, "OFFRES 2020/PROJECT-ALPHA/dao avec tdr.pdf", "dao avec tdr.pdf", sha256="a" * 64),
            synthetic_row(2, "OFFRES 2020/PROJECT-ALPHA/rapport.pdf", "rapport.pdf"),
            synthetic_row(3, "OFFRES 2020/PROJECT-BETA/photo.jpg", "photo.jpg", extension="jpg"),
        ]

    def test_non_candidates_are_never_returned(self):
        # Only "dao avec tdr.pdf" matches the Stage A prefilter - the other
        # two rows must never appear in the returned list at all (not even
        # as a PREFILTER_SKIPPED placeholder), which is exactly what bounds
        # persistence to the prefilter queue instead of the whole corpus.
        rows = self._rows()
        folders = cdc.enumerate_project_folders(rows)
        candidates, counters = cdc.run_prefilter_only_discovery_for_projects(rows, folders)
        self.assertEqual([c.archive_file_id for c in candidates], [1])
        self.assertEqual(len(candidates), 1)

    def test_counters_still_reflect_every_row_inspected(self):
        # Aggregate reporting must still see the true corpus size even
        # though only 1 of 3 rows is ever turned into a candidate.
        rows = self._rows()
        folders = cdc.enumerate_project_folders(rows)
        _candidates, counters = cdc.run_prefilter_only_discovery_for_projects(rows, folders)
        self.assertEqual(counters.files_metadata_inspected, 3)
        self.assertEqual(counters.prefilter_candidates, 1)

    def test_never_touches_a_content_inspector_or_file_path(self):
        # No ContentInspector argument exists on this function at all; this
        # test guards against a future edit accidentally re-adding one and
        # resolving a real archive file path in "metadata-only" mode.
        self.assertNotIn("content_inspector", cdc.run_prefilter_only_discovery_for_projects.__code__.co_varnames)
        rows = self._rows()
        folders = cdc.enumerate_project_folders(rows)
        with patch.object(cdc, "resolve_archive_file_path") as mock_resolve:
            cdc.run_prefilter_only_discovery_for_projects(rows, folders)
        mock_resolve.assert_not_called()

    def test_external_calls_remains_zero(self):
        rows = self._rows()
        folders = cdc.enumerate_project_folders(rows)
        _candidates, counters = cdc.run_prefilter_only_discovery_for_projects(rows, folders)
        self.assertEqual(counters.extraction.external_calls, 0)

    def test_returned_candidates_are_not_attempted_and_prefilter_classified(self):
        rows = self._rows()
        folders = cdc.enumerate_project_folders(rows)
        candidates, _counters = cdc.run_prefilter_only_discovery_for_projects(rows, folders)
        candidate = candidates[0]
        self.assertEqual(candidate.extraction_status, "NOT_ATTEMPTED")
        self.assertEqual(candidate.classification_method, "PREFILTER_SKIPPED")
        self.assertIsNone(candidate.review_priority)

    def test_technical_bucket_filters_out_non_business_documents(self):
        rows = [synthetic_row(1, "OFFRES 2020/P/cahier des charges.pdf", "cahier des charges.pdf")]
        folders = cdc.enumerate_project_folders(rows)
        candidates, counters = cdc.run_prefilter_only_discovery_for_projects(
            rows, folders, technical_categories={1: "IMAGE"}
        )
        self.assertEqual(candidates, [])
        self.assertEqual(counters.prefilter_candidates, 0)

    def test_duplicate_handling_is_reused(self):
        rows = [
            synthetic_row(1, "OFFRES 2020/P/cahier des charges.pdf", "cahier des charges.pdf", sha256="x" * 64),
            synthetic_row(2, "OFFRES 2020/P/copie cahier des charges.pdf", "copie cahier des charges.pdf", sha256="x" * 64),
        ]
        folders = cdc.enumerate_project_folders(rows)
        candidates, counters = cdc.run_prefilter_only_discovery_for_projects(rows, folders)
        self.assertEqual(counters.duplicate_groups, 1)
        by_id = {c.archive_file_id: c for c in candidates}
        self.assertTrue(by_id[1].is_primary_candidate)
        self.assertFalse(by_id[2].is_primary_candidate)
        self.assertEqual(by_id[2].duplicate_of_archive_file_id, 1)

    def test_rerun_with_identical_inputs_is_deterministic(self):
        # Idempotency precondition: the same rows/folders must always
        # produce the same candidate set and counts, since persistence
        # relies on upsert-by-archive_file_id being safe to repeat.
        rows = self._rows()
        folders = cdc.enumerate_project_folders(rows)
        candidates_a, counters_a = cdc.run_prefilter_only_discovery_for_projects(rows, folders)
        candidates_b, counters_b = cdc.run_prefilter_only_discovery_for_projects(rows, folders)
        self.assertEqual([c.archive_file_id for c in candidates_a], [c.archive_file_id for c in candidates_b])
        self.assertEqual(counters_a.prefilter_candidates, counters_b.prefilter_candidates)


class TestBuildReviewQueue(unittest.TestCase):
    def _candidate(self, priority):
        return cdc.TechnicalSourceCandidate(
            archive_file_id=1, year=None, project_reference=None, detected_role="CDC",
            technical_source_candidate=priority is not None, structural_score=5, structural_max=17,
            structural_ratio=0.3, structural_band="POSSIBLE_TECHNICAL_SOURCE", confidence=None,
            extraction_status="SUCCESS", review_priority=priority, classification_method="RULE",
            duplicate_of_archive_file_id=None, is_primary_candidate=True,
        )

    def test_ordinary_non_candidates_are_never_counted(self):
        queue = cdc.build_review_queue([self._candidate(None), self._candidate(None)])
        self.assertEqual(queue, {"HIGH_PRIORITY": 0, "MEDIUM_PRIORITY": 0, "EXTRACTION_FAILED": 0})

    def test_counts_each_priority_bucket(self):
        candidates = [
            self._candidate("HIGH_PRIORITY"), self._candidate("HIGH_PRIORITY"),
            self._candidate("MEDIUM_PRIORITY"), self._candidate("EXTRACTION_FAILED"),
        ]
        queue = cdc.build_review_queue(candidates)
        self.assertEqual(queue, {"HIGH_PRIORITY": 2, "MEDIUM_PRIORITY": 1, "EXTRACTION_FAILED": 1})


class TestTechnicalSourceCandidateValidation(unittest.TestCase):
    def _base_kwargs(self):
        return dict(
            archive_file_id=1, year=None, project_reference=None, detected_role="CDC",
            technical_source_candidate=True, structural_score=5, structural_max=17,
            structural_ratio=0.3, structural_band="POSSIBLE_TECHNICAL_SOURCE", confidence=None,
            extraction_status="SUCCESS", review_priority="MEDIUM_PRIORITY", classification_method="RULE",
            duplicate_of_archive_file_id=None, is_primary_candidate=True,
        )

    def test_rejects_invalid_detected_role(self):
        kwargs = self._base_kwargs()
        kwargs["detected_role"] = "NOT_A_REAL_ROLE"
        with self.assertRaises(ValueError):
            cdc.TechnicalSourceCandidate(**kwargs)

    def test_rejects_invalid_extraction_status(self):
        kwargs = self._base_kwargs()
        kwargs["extraction_status"] = "MAYBE"
        with self.assertRaises(ValueError):
            cdc.TechnicalSourceCandidate(**kwargs)

    def test_rejects_invalid_review_priority(self):
        kwargs = self._base_kwargs()
        kwargs["review_priority"] = "URGENT"
        with self.assertRaises(ValueError):
            cdc.TechnicalSourceCandidate(**kwargs)

    def test_rejects_invalid_classification_method(self):
        kwargs = self._base_kwargs()
        kwargs["classification_method"] = "CLOUD_AI"
        with self.assertRaises(ValueError):
            cdc.TechnicalSourceCandidate(**kwargs)

    def test_none_review_priority_is_accepted(self):
        kwargs = self._base_kwargs()
        kwargs["review_priority"] = None
        candidate = cdc.TechnicalSourceCandidate(**kwargs)
        self.assertIsNone(candidate.review_priority)


class InMemoryTechnicalSourceCandidateRepository:
    """Synthetic double for TechnicalSourceCandidateRepository - same
    UNIQUE(archive_file_id)-upsert + snapshot/rollback contract as
    InMemoryCandidateRepository above."""

    def __init__(self) -> None:
        self.store: dict = {}
        self._snapshot = None
        self.fail_after = None
        self._calls = 0
        # Separate from `store` (machine-classification rows) exactly the
        # way the real schema keeps validation_status writes separate from
        # upsert()'s column list - this double must reproduce that
        # separation to be a faithful test double.
        self.validation_status: dict = {}
        self.reviewed_by: dict = {}

    def begin_batch(self) -> None:
        self._snapshot = dict(self.store)

    def commit_batch(self) -> None:
        self._snapshot = None

    def rollback_batch(self) -> None:
        assert self._snapshot is not None
        self.store = self._snapshot
        self._snapshot = None

    def upsert(self, candidate) -> str:
        self._calls += 1
        if self.fail_after is not None and self._calls > self.fail_after:
            raise RuntimeError("synthetic upsert failure")
        outcome = "updated" if candidate.archive_file_id in self.store else "inserted"
        self.store[candidate.archive_file_id] = candidate
        self.validation_status.setdefault(candidate.archive_file_id, "MACHINE_CLASSIFIED")
        return outcome

    def mark_validation_status(self, archive_file_id, validation_status, reviewed_by=None) -> None:
        if validation_status not in cdc.HUMAN_SETTABLE_VALIDATION_STATUSES:
            raise ValueError(f"validation_status must be human-settable: {validation_status!r}")
        if archive_file_id not in self.store:
            raise ValueError(f"No candidate row found for archive_file_id={archive_file_id!r}")
        self.validation_status[archive_file_id] = validation_status
        self.reviewed_by[archive_file_id] = reviewed_by


class TestPersistTechnicalSourceCandidates(unittest.TestCase):
    def _candidate(self, archive_file_id):
        return cdc.TechnicalSourceCandidate(
            archive_file_id=archive_file_id, year=2020, project_reference=None, detected_role="CDC",
            technical_source_candidate=True, structural_score=10, structural_max=17,
            structural_ratio=0.59, structural_band="STRONG_TECHNICAL_SOURCE", confidence=0.9,
            extraction_status="SUCCESS", review_priority="HIGH_PRIORITY", classification_method="RULE",
            duplicate_of_archive_file_id=None, is_primary_candidate=True,
        )

    def test_first_insert_works(self):
        repo = InMemoryTechnicalSourceCandidateRepository()
        result = cdc.persist_technical_source_candidates(repo, [self._candidate(1), self._candidate(2)])
        self.assertEqual(result.inserted, 2)
        self.assertEqual(result.updated, 0)
        self.assertFalse(result.failed_batch)

    def test_second_identical_run_is_idempotent(self):
        repo = InMemoryTechnicalSourceCandidateRepository()
        cdc.persist_technical_source_candidates(repo, [self._candidate(1)])
        result = cdc.persist_technical_source_candidates(repo, [self._candidate(1)])
        self.assertEqual(result.inserted, 0)
        self.assertEqual(result.updated, 1)
        self.assertEqual(len(repo.store), 1)

    def test_batch_failure_rolls_back_all_writes_in_that_batch(self):
        repo = InMemoryTechnicalSourceCandidateRepository()
        repo.fail_after = 1
        result = cdc.persist_technical_source_candidates(repo, [self._candidate(1), self._candidate(2)])
        self.assertTrue(result.failed_batch)
        self.assertEqual(len(repo.store), 0)

    def test_fresh_row_starts_machine_classified(self):
        repo = InMemoryTechnicalSourceCandidateRepository()
        cdc.persist_technical_source_candidates(repo, [self._candidate(1)])
        self.assertEqual(repo.validation_status[1], "MACHINE_CLASSIFIED")

    def test_rerunning_upsert_never_clobbers_a_human_validation_decision(self):
        # The core Task 5 safety invariant: re-running discovery for a
        # candidate a human already reviewed must never silently revert
        # that decision back to MACHINE_CLASSIFIED (or anything else).
        repo = InMemoryTechnicalSourceCandidateRepository()
        cdc.persist_technical_source_candidates(repo, [self._candidate(1)])
        repo.mark_validation_status(1, "HUMAN_VALIDATED_CDC", reviewed_by=42)
        cdc.persist_technical_source_candidates(repo, [self._candidate(1)])  # discovery reruns
        self.assertEqual(repo.validation_status[1], "HUMAN_VALIDATED_CDC")
        self.assertEqual(repo.reviewed_by[1], 42)


class TestPostgresTechnicalSourceCandidateRepositorySqlShape(unittest.TestCase):
    """Exercises the REAL PostgresTechnicalSourceCandidateRepository.upsert()
    SQL text against a mocked cursor - InMemoryTechnicalSourceCandidateRepository
    (used by every other persistence test above) never generates real SQL,
    so it cannot catch a field that exists on TechnicalSourceCandidate but
    was never added to upsert()'s column list (exactly the bug a code-only
    safety audit found: structural_band was computed, tallied, and even
    accepted by the SQL migration's sibling test fixtures, but silently
    absent from both the INSERT column list and the CREATE TABLE statement
    - discovered because scripts/cdc_review.py --review-summary's
    band_*/strong_technical_candidates/possible_technical_candidates fields
    would have raised "column structural_band does not exist" against a
    real, populated table)."""

    def _candidate(self):
        return cdc.TechnicalSourceCandidate(
            archive_file_id=1, year=2020, project_reference=None, detected_role="CDC",
            technical_source_candidate=True, structural_score=10, structural_max=17,
            structural_ratio=0.59, structural_band="STRONG_TECHNICAL_SOURCE", confidence=0.9,
            extraction_status="SUCCESS", review_priority="HIGH_PRIORITY", classification_method="RULE",
            duplicate_of_archive_file_id=None, is_primary_candidate=True,
        )

    def test_structural_band_is_present_in_the_insert_column_list(self):
        fake_cursor = MagicMock()
        fake_cursor.__enter__.return_value = fake_cursor
        fake_cursor.__exit__.return_value = False
        fake_cursor.fetchone.return_value = (True,)
        fake_conn = MagicMock()
        fake_conn.cursor.return_value = fake_cursor

        repo = cdc.PostgresTechnicalSourceCandidateRepository(fake_conn)
        repo.upsert(self._candidate())

        query, params = fake_cursor.execute.call_args[0]
        self.assertIn("structural_band", query)
        self.assertIn(self._candidate().structural_band, params)

    def test_column_count_placeholder_count_and_param_count_all_agree(self):
        # A stronger, self-checking guard against this entire class of bug:
        # whatever the column list says, the number of "%s" placeholders
        # and the number of bound parameters must match it exactly, or the
        # INSERT would fail (or silently misalign values into the wrong
        # columns) against a real database.
        fake_cursor = MagicMock()
        fake_cursor.__enter__.return_value = fake_cursor
        fake_cursor.__exit__.return_value = False
        fake_cursor.fetchone.return_value = (True,)
        fake_conn = MagicMock()
        fake_conn.cursor.return_value = fake_cursor

        repo = cdc.PostgresTechnicalSourceCandidateRepository(fake_conn)
        repo.upsert(self._candidate())

        query, params = fake_cursor.execute.call_args[0]
        insert_columns_clause = query.split("(", 1)[1].split(")", 1)[0]
        column_count = len([c for c in insert_columns_clause.split(",") if c.strip()])
        placeholder_count = query.count("%s")
        self.assertEqual(column_count, placeholder_count)
        self.assertEqual(column_count, len(params))

    def test_every_technicalsourcecandidate_field_is_written_or_deliberately_excluded(self):
        # Fields that must NEVER be written by upsert() (human-only, see
        # mark_validation_status) are the only allowed absences.
        deliberately_excluded = {"validation_status"}  # human-only; reviewed_at/reviewed_by are DB-only columns
        fake_cursor = MagicMock()
        fake_cursor.__enter__.return_value = fake_cursor
        fake_cursor.__exit__.return_value = False
        fake_cursor.fetchone.return_value = (True,)
        fake_conn = MagicMock()
        fake_conn.cursor.return_value = fake_cursor

        repo = cdc.PostgresTechnicalSourceCandidateRepository(fake_conn)
        repo.upsert(self._candidate())

        query, _params = fake_cursor.execute.call_args[0]
        for field in cdc.TechnicalSourceCandidate.__dataclass_fields__:
            if field in deliberately_excluded:
                self.assertNotIn(field, query, f"{field} must never be written by upsert()")
            else:
                self.assertIn(field, query, f"{field} is on TechnicalSourceCandidate but missing from upsert()'s SQL")


class TestMarkValidationStatus(unittest.TestCase):
    def _seed(self):
        repo = InMemoryTechnicalSourceCandidateRepository()
        cdc.persist_technical_source_candidates(
            repo,
            [cdc.TechnicalSourceCandidate(
                archive_file_id=1, year=2020, project_reference=None, detected_role="CDC",
                technical_source_candidate=True, structural_score=10, structural_max=17,
                structural_ratio=0.59, structural_band="STRONG_TECHNICAL_SOURCE", confidence=0.9,
                extraction_status="SUCCESS", review_priority="HIGH_PRIORITY", classification_method="RULE",
                duplicate_of_archive_file_id=None, is_primary_candidate=True,
            )],
        )
        return repo

    def test_rejects_machine_classified_as_a_target_status(self):
        # A human action can never re-assert the machine-default state -
        # MACHINE_CLASSIFIED is only ever the column's own DEFAULT.
        repo = self._seed()
        with self.assertRaises(ValueError):
            repo.mark_validation_status(1, "MACHINE_CLASSIFIED")

    def test_accepts_every_human_settable_status(self):
        repo = self._seed()
        for status in cdc.HUMAN_SETTABLE_VALIDATION_STATUSES:
            repo.mark_validation_status(1, status, reviewed_by=7)
            self.assertEqual(repo.validation_status[1], status)

    def test_fails_closed_for_an_unknown_archive_file_id(self):
        repo = self._seed()
        with self.assertRaises(ValueError):
            repo.mark_validation_status(999, "HUMAN_VALIDATED_CDC")

    def test_human_settable_statuses_exclude_machine_classified(self):
        self.assertNotIn("MACHINE_CLASSIFIED", cdc.HUMAN_SETTABLE_VALIDATION_STATUSES)
        self.assertIn("NEEDS_HUMAN_REVIEW", cdc.HUMAN_SETTABLE_VALIDATION_STATUSES)
        self.assertIn("HUMAN_VALIDATED_CDC", cdc.HUMAN_SETTABLE_VALIDATION_STATUSES)
        self.assertIn("HUMAN_REJECTED_CDC", cdc.HUMAN_SETTABLE_VALIDATION_STATUSES)


class TestReviewCategoriesAndOrdering(unittest.TestCase):
    """Review workflow Task 2: CDC / DAO_WITH_CDC / STRONG_TECHNICAL_SOURCE /
    POSSIBLE_TECHNICAL_SOURCE / EXTRACTION_FAILED, deterministic ordering."""

    def _candidate(self, archive_file_id, detected_role="OTHER", structural_band="WEAK_TECHNICAL_SOURCE",
                    extraction_status="SUCCESS"):
        return cdc.TechnicalSourceCandidate(
            archive_file_id=archive_file_id, year=None, project_reference=None, detected_role=detected_role,
            technical_source_candidate=True, structural_score=0, structural_max=17,
            structural_ratio=0.0, structural_band=structural_band, confidence=None,
            extraction_status=extraction_status,
            review_priority="EXTRACTION_FAILED" if extraction_status == "FAILED" else "MEDIUM_PRIORITY",
            classification_method="RULE", duplicate_of_archive_file_id=None, is_primary_candidate=True,
        )

    def test_all_five_required_categories_are_distinguished(self):
        self.assertEqual(
            set(cdc.REVIEW_CATEGORY_ORDER),
            {"EXTRACTION_FAILED", "STRONG_TECHNICAL_SOURCE", "POSSIBLE_TECHNICAL_SOURCE", "CDC", "DAO_WITH_CDC"},
        )

    def test_category_assignment_per_dimension(self):
        cdc_candidate = self._candidate(1, detected_role="CDC")
        self.assertEqual(cdc.review_categories_for_candidate(cdc_candidate), {"CDC"})

        strong = self._candidate(2, structural_band="STRONG_TECHNICAL_SOURCE")
        self.assertEqual(cdc.review_categories_for_candidate(strong), {"STRONG_TECHNICAL_SOURCE"})

        failed = self._candidate(3, extraction_status="FAILED")
        self.assertEqual(cdc.review_categories_for_candidate(failed), {"EXTRACTION_FAILED"})

    def test_candidate_can_belong_to_multiple_categories(self):
        overlapping = self._candidate(1, detected_role="CDC", structural_band="STRONG_TECHNICAL_SOURCE")
        self.assertEqual(
            cdc.review_categories_for_candidate(overlapping), {"CDC", "STRONG_TECHNICAL_SOURCE"}
        )

    def test_build_review_categories_counts_are_aggregate_only(self):
        candidates = [
            self._candidate(1, detected_role="CDC"),
            self._candidate(2, detected_role="DAO_WITH_CDC"),
            self._candidate(3, structural_band="STRONG_TECHNICAL_SOURCE"),
            self._candidate(4, structural_band="POSSIBLE_TECHNICAL_SOURCE"),
            self._candidate(5, extraction_status="FAILED"),
            self._candidate(6),  # no category
        ]
        counts = cdc.build_review_categories(candidates)
        self.assertEqual(counts, {
            "EXTRACTION_FAILED": 1, "STRONG_TECHNICAL_SOURCE": 1, "POSSIBLE_TECHNICAL_SOURCE": 1,
            "CDC": 1, "DAO_WITH_CDC": 1,
        })
        for value in counts.values():
            self.assertIsInstance(value, int)

    def test_ordering_follows_the_documented_conceptual_order(self):
        low_priority = self._candidate(1)  # matches no category
        cdc_role = self._candidate(2, detected_role="CDC")
        strong = self._candidate(3, structural_band="STRONG_TECHNICAL_SOURCE")
        failed = self._candidate(4, extraction_status="FAILED")

        ordered = cdc.order_candidates_for_review([low_priority, cdc_role, strong, failed])
        ordered_ids = [c.archive_file_id for c in ordered]
        # EXTRACTION_FAILED and STRONG_TECHNICAL_SOURCE both rank ahead of
        # CDC, which ranks ahead of a candidate matching no category.
        self.assertLess(ordered_ids.index(4), ordered_ids.index(2))  # failed before cdc
        self.assertLess(ordered_ids.index(3), ordered_ids.index(2))  # strong before cdc
        self.assertEqual(ordered_ids[-1], 1)  # no-category candidate ranks last

    def test_ordering_is_deterministic_across_repeated_calls(self):
        candidates = [self._candidate(i, detected_role="CDC") for i in (5, 3, 1, 4, 2)]
        first = [c.archive_file_id for c in cdc.order_candidates_for_review(candidates)]
        second = [c.archive_file_id for c in cdc.order_candidates_for_review(list(reversed(candidates)))]
        self.assertEqual(first, second)
        self.assertEqual(first, [1, 2, 3, 4, 5])  # tiebreak by archive_file_id, never by filename


class TestFullCorpusCliGating(unittest.TestCase):
    def _connect_should_never_be_called(self):
        mock_connect = MagicMock(side_effect=AssertionError("DB connect must not be attempted"))
        return patch.object(cdc, "_connect", mock_connect), mock_connect

    def test_requires_batch_size(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--full-corpus", "--dry-run"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_requires_dry_run_or_persist(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--full-corpus", "--batch-size", "25"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_rejects_negative_batch_size(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--full-corpus", "--dry-run", "--batch-size", "-5"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_rejects_validate_single_confirmed(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--full-corpus", "--dry-run", "--batch-size", "25", "--validate-single-confirmed"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_pilot_limit_rejects_batch_size(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--pilot-limit", "5", "--dry-run", "--batch-size", "25"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_summary_rejects_batch_size_and_resume(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--summary", "--resume"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_accepted_with_required_flags(self):
        mock_connect = MagicMock(side_effect=RuntimeError("stop right after arg validation"))
        with patch.object(cdc, "_connect", mock_connect), \
             patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             redirect_stderr(io.StringIO()):
            with self.assertRaises(RuntimeError):
                cdc.main(["--full-corpus", "--dry-run", "--batch-size", "25"])
        self.assertEqual(mock_connect.call_count, 1)


class TestRunFullCorpusModeIntegration(unittest.TestCase):
    """End-to-end (mocked DB) integration tests for run_full_corpus_mode:
    batching, checkpoint/resume, batch-failure isolation, confidentiality,
    dry-run-zero-writes, and idempotent persistence via a synthetic
    repository."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp(prefix="cdc-full-corpus-test-")
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)
        self.checkpoint_file = str(Path(self.tmp_dir) / "checkpoint.json")

    def _rows(self, n_projects=5):
        return [
            synthetic_row(i, f"OFFRES 2020/PROJECT-{i}/doc.pdf", "doc.pdf", sha256=None)
            for i in range(1, n_projects + 1)
        ]

    def _run(
        self, batch_size, resume=False, persist=False, dry_run=True, rows=None, mock_repo_cls=None,
        enable_content_inspection=False, persist_prefilter_only=False,
    ):
        fake_conn = MagicMock()
        rows = rows if rows is not None else self._rows()
        buffer = io.StringIO()
        patches = [
            patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}),
            patch.object(cdc, "_connect", return_value=fake_conn),
            patch.object(cdc, "_fetch_archive_file_rows", return_value=rows),
            patch.object(cdc, "_fetch_archive_file_rows_with_root_path", return_value=rows),
            patch.object(cdc, "_fetch_technical_categories", return_value={}),
        ]
        if mock_repo_cls is not None:
            patches.append(patch.object(cdc, "PostgresTechnicalSourceCandidateRepository", mock_repo_cls))
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with redirect_stdout(buffer):
            exit_code = cdc.run_full_corpus_mode(
                dry_run=dry_run, persist=persist, idempotent_run=False,
                batch_size=batch_size, resume=resume, checkpoint_file=self.checkpoint_file,
                enable_content_inspection=enable_content_inspection,
                persist_prefilter_only=persist_prefilter_only,
            )
        return exit_code, buffer.getvalue(), fake_conn

    def test_project_folders_selected_is_derived_not_hardcoded(self):
        exit_code, output, _conn = self._run(batch_size=2, rows=self._rows(n_projects=7))
        self.assertEqual(exit_code, 0)
        self.assertIn("projects_selected: 7", output)
        self.assertNotIn("projects_selected: 411", output)

    def test_batching_produces_multiple_checkpointed_batches(self):
        exit_code, output, _conn = self._run(batch_size=2, rows=self._rows(n_projects=5))
        self.assertEqual(exit_code, 0)
        self.assertIn("batches_total: 3", output)
        checkpoint = cdc.load_checkpoint(Path(self.checkpoint_file))
        self.assertEqual(sorted(checkpoint.completed_batches), [0, 1, 2])

    def test_resume_skips_already_completed_batches(self):
        rows = self._rows(n_projects=5)
        self._run(batch_size=2, rows=rows)  # first, complete run
        with patch.object(cdc, "run_technical_source_discovery_for_projects") as mock_run:
            mock_run.side_effect = AssertionError("must not reprocess a completed batch")
            exit_code, output, _conn = self._run(batch_size=2, resume=True, rows=rows)
        self.assertEqual(exit_code, 0)
        mock_run.assert_not_called()

    def test_rerun_without_resume_refuses_when_checkpoint_incomplete(self):
        rows = self._rows(n_projects=5)
        self._run(batch_size=2, rows=rows)
        exit_code, output, _conn = self._run(batch_size=2, resume=False, rows=rows)
        self.assertEqual(exit_code, 1)

    def test_resume_with_mismatched_scope_refuses(self):
        rows = self._rows(n_projects=5)
        self._run(batch_size=2, rows=rows)
        exit_code, output, _conn = self._run(batch_size=3, resume=True, rows=rows)
        self.assertEqual(exit_code, 1)

    def test_metadata_only_checkpoint_is_never_resumed_as_content_inspection_run(self):
        # Task 8 (review workflow) - the exact bug scenario: a metadata-only
        # run (enable_content_inspection=False) completes and checkpoints;
        # a later run asking for REAL content inspection over the same
        # project set/batch size must never silently treat that checkpoint
        # as already-done content-inspection work.
        rows = self._rows(n_projects=5)
        self._run(batch_size=2, rows=rows, enable_content_inspection=False)
        exit_code, output, _conn = self._run(
            batch_size=2, resume=True, rows=rows, enable_content_inspection=True
        )
        self.assertEqual(exit_code, 1)  # refused, never silently reused as a completed content-inspection run

    def test_metadata_only_checkpoint_mismatch_message_is_specific(self):
        rows = self._rows(n_projects=5)
        self._run(batch_size=2, rows=rows, enable_content_inspection=False)
        fake_conn = MagicMock()
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(cdc, "_connect", return_value=fake_conn), \
             patch.object(cdc, "_fetch_archive_file_rows_with_root_path", return_value=rows), \
             patch.object(cdc, "_fetch_technical_categories", return_value={}), \
             redirect_stderr(io.StringIO()) as err, redirect_stdout(io.StringIO()):
            exit_code = cdc.run_full_corpus_mode(
                dry_run=True, persist=False, idempotent_run=False, batch_size=2, resume=True,
                checkpoint_file=self.checkpoint_file, enable_content_inspection=True,
            )
        self.assertEqual(exit_code, 1)
        self.assertIn("enable_content_inspection", err.getvalue())

    def test_failed_batch_is_isolated_and_recorded(self):
        rows = self._rows(n_projects=4)
        call_count = {"n": 0}
        real_run = cdc.run_technical_source_discovery_for_projects

        def flaky_run(rows_arg, folders, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 2:
                raise RuntimeError("synthetic batch failure")
            return real_run(rows_arg, folders, **kwargs)

        with patch.object(cdc, "run_technical_source_discovery_for_projects", side_effect=flaky_run):
            exit_code, output, _conn = self._run(batch_size=1, rows=rows)

        self.assertEqual(exit_code, 1)  # a failed batch is reflected in the exit code
        checkpoint = cdc.load_checkpoint(Path(self.checkpoint_file))
        self.assertEqual(len(checkpoint.failed_batches), 1)
        self.assertEqual(len(checkpoint.completed_batches), 3)  # the other 3 batches still succeeded

    def test_resume_retries_only_the_failed_batch(self):
        rows = self._rows(n_projects=4)
        call_count = {"n": 0}
        real_run = cdc.run_technical_source_discovery_for_projects

        def flaky_run(rows_arg, folders, **kwargs):
            call_count["n"] += 1
            if call_count["n"] == 2:
                raise RuntimeError("synthetic batch failure")
            return real_run(rows_arg, folders, **kwargs)

        with patch.object(cdc, "run_technical_source_discovery_for_projects", side_effect=flaky_run):
            self._run(batch_size=1, rows=rows)  # one batch fails

        exit_code, output, _conn = self._run(batch_size=1, resume=True, rows=rows)
        self.assertEqual(exit_code, 0)
        checkpoint = cdc.load_checkpoint(Path(self.checkpoint_file))
        self.assertEqual(checkpoint.failed_batches, [])
        self.assertEqual(len(checkpoint.completed_batches), 4)

    def test_dry_run_never_constructs_a_repository(self):
        mock_repo_cls = MagicMock()
        exit_code, output, _conn = self._run(batch_size=2, dry_run=True, persist=False, mock_repo_cls=mock_repo_cls)
        self.assertEqual(exit_code, 0)
        mock_repo_cls.assert_not_called()

    def test_persist_mode_constructs_a_repository(self):
        mock_repo_cls = MagicMock()
        with patch.object(
            cdc, "persist_technical_source_candidates", return_value=cdc.PersistResult(inserted=1, updated=0)
        ):
            exit_code, output, _conn = self._run(
                batch_size=2, dry_run=False, persist=True, mock_repo_cls=mock_repo_cls
            )
        self.assertEqual(exit_code, 0)
        mock_repo_cls.assert_called()

    def test_persist_mode_commits_after_each_successful_batch(self):
        # Regression test for a real bug found against a live database:
        # _connect() never sets autocommit=True, so conn.transaction()
        # alone never durably commits a batch once the connection is
        # already inside an ambient transaction (started by the earlier
        # read queries) - an explicit conn.commit() is required per batch,
        # or every persisted row is silently discarded on conn.close().
        mock_repo_cls = MagicMock()
        with patch.object(
            cdc, "persist_technical_source_candidates", return_value=cdc.PersistResult(inserted=1, updated=0)
        ):
            exit_code, output, fake_conn = self._run(
                batch_size=2, dry_run=False, persist=True, rows=self._rows(n_projects=5),
                mock_repo_cls=mock_repo_cls,
            )
        self.assertEqual(exit_code, 0)
        self.assertEqual(fake_conn.commit.call_count, 3)  # 5 projects / batch_size=2 -> 3 batches

    def test_dry_run_never_calls_commit(self):
        exit_code, output, fake_conn = self._run(batch_size=2, dry_run=True, persist=False)
        self.assertEqual(exit_code, 0)
        fake_conn.commit.assert_not_called()

    def test_failed_batch_never_calls_commit_for_that_batch(self):
        with patch.object(
            cdc, "persist_technical_source_candidates",
            return_value=cdc.PersistResult(inserted=0, updated=0, failed_batch=True),
        ):
            exit_code, output, fake_conn = self._run(
                batch_size=2, dry_run=False, persist=True, rows=self._rows(n_projects=2),
                mock_repo_cls=MagicMock(),
            )
        fake_conn.commit.assert_not_called()

    def test_persist_prefilter_only_never_persists_a_non_candidate_row(self):
        # The exact regression this mode exists to prevent: a full corpus
        # of mostly-irrelevant files must persist ONLY the rows that match
        # the Stage A prefilter, never all of them.
        rows = [
            synthetic_row(1, "OFFRES 2020/PROJECT-1/dao avec tdr.pdf", "dao avec tdr.pdf"),
            synthetic_row(2, "OFFRES 2020/PROJECT-1/rapport.pdf", "rapport.pdf"),
            synthetic_row(3, "OFFRES 2020/PROJECT-2/photo.jpg", "photo.jpg", extension="jpg"),
            synthetic_row(4, "OFFRES 2020/PROJECT-3/notes.txt", "notes.txt", extension="txt"),
        ]
        persisted = []

        class FakeRepo:
            def __init__(self, _conn):
                pass

            def begin_batch(self):
                pass

            def commit_batch(self):
                pass

            def rollback_batch(self):
                pass

            def upsert(self, candidate):
                persisted.append(candidate.archive_file_id)
                return "inserted"

        exit_code, output, _conn = self._run(
            batch_size=10, dry_run=False, persist=True, rows=rows,
            mock_repo_cls=FakeRepo, persist_prefilter_only=True,
        )
        self.assertEqual(exit_code, 0)
        self.assertEqual(persisted, [1])  # only the prefilter match, never all 4 rows
        self.assertIn("files_metadata_inspected: 4", output)
        self.assertIn("prefilter_candidates: 1", output)

    def test_persist_prefilter_only_rejects_enable_content_inspection(self):
        with redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--full-corpus", "--dry-run", "--batch-size", "25",
                    "--persist-prefilter-only", "--enable-content-inspection",
                ])
        self.assertNotEqual(ctx.exception.code, 0)

    def test_persist_prefilter_only_checkpoint_is_never_resumed_as_ordinary_run(self):
        # persist_prefilter_only is its own scope dimension - a checkpoint
        # from that mode must never be silently treated as compatible with
        # (or resumable as) an ordinary full-discovery run, even with the
        # same project set, batch size, and enable_content_inspection=False.
        rows = self._rows(n_projects=5)
        self._run(batch_size=2, rows=rows, persist_prefilter_only=True)
        exit_code, output, _conn = self._run(batch_size=2, resume=True, rows=rows, persist_prefilter_only=False)
        self.assertEqual(exit_code, 1)

    def test_no_confidential_project_name_in_aggregate_output(self):
        rows = [
            synthetic_row(1, "OFFRES 2020/SECRET-CLIENT-PROJECT-548/cahier des charges.pdf", "cahier des charges.pdf"),
        ]
        exit_code, output, _conn = self._run(batch_size=5, rows=rows)
        self.assertNotIn("SECRET-CLIENT-PROJECT", output)
        self.assertNotIn("cahier des charges.pdf", output)

    def test_external_calls_remains_zero_in_output(self):
        exit_code, output, _conn = self._run(batch_size=2)
        self.assertIn("external_calls: 0", output)


# =====================================================================
# --process-persisted-candidates: the controlled content-processing pilot
# over the already-persisted metadata prefilter queue. SYNTHETIC DATA
# ONLY - no live PostgreSQL connection, no real archive_file_id/path.
# =====================================================================


class FakeQueueCursor:
    """Minimal synthetic double for a psycopg cursor - records every
    executed query text and its bound params (so tests can assert on the
    EXACT filter/order/limit used, never a filename/path), and replays a
    scripted sequence of fetchone()/fetchall() results, one per execute()."""

    def __init__(self, plan):
        self.plan = list(plan)
        self.index = 0
        self.queries: list[str] = []
        self.params: list = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, query, params=None):
        self.queries.append(" ".join(query.split()))
        self.params.append(params)

    def fetchone(self):
        result = self.plan[self.index]
        self.index += 1
        return result

    def fetchall(self):
        result = self.plan[self.index]
        self.index += 1
        return result


class TestCountAndFetchPersistedPrefilterCandidates(unittest.TestCase):
    def test_count_uses_the_exact_required_filter(self):
        conn = MagicMock()
        cursor = FakeQueueCursor([(750,)])
        conn.cursor.return_value = cursor
        count = cdc._count_persisted_prefilter_candidates(conn)
        self.assertEqual(count, 750)
        self.assertIn("extraction_status", cursor.queries[0])
        self.assertIn("validation_status", cursor.queries[0])
        self.assertEqual(cursor.params[0], ("NOT_ATTEMPTED", "MACHINE_CLASSIFIED"))

    def test_fetch_orders_by_archive_file_id_asc_and_applies_limit(self):
        conn = MagicMock()
        cursor = FakeQueueCursor([[(1, "OFFRES 2020/P/a.pdf", "a.pdf", "pdf", None, "root", "/mnt/concept-archives-readonly")]])
        conn.cursor.return_value = cursor
        rows = cdc._fetch_persisted_prefilter_candidate_rows(conn, limit=25)
        self.assertIn("order by c.archive_file_id asc", cursor.queries[0])
        self.assertEqual(cursor.params[0], ("NOT_ATTEMPTED", "MACHINE_CLASSIFIED", 25))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].id, 1)

    def test_fetch_joins_via_archive_file_id_only(self):
        conn = MagicMock()
        cursor = FakeQueueCursor([[]])
        conn.cursor.return_value = cursor
        cdc._fetch_persisted_prefilter_candidate_rows(conn, limit=25)
        query = cursor.queries[0]
        self.assertIn("f.id = c.archive_file_id", query)
        self.assertIn("r.id = f.source_root_id", query)


class TestNormalizeExtensionsFilter(unittest.TestCase):
    def test_none_and_empty_both_mean_no_filter(self):
        self.assertIsNone(cdc.normalize_extensions_filter(None))
        self.assertIsNone(cdc.normalize_extensions_filter([]))
        self.assertIsNone(cdc.normalize_extensions_filter(["", "  "]))

    def test_case_is_normalized_to_lowercase(self):
        self.assertEqual(cdc.normalize_extensions_filter(["PDF", "DocX"]), ("docx", "pdf"))

    def test_whitespace_is_stripped(self):
        self.assertEqual(cdc.normalize_extensions_filter([" pdf ", "docx"]), ("docx", "pdf"))

    def test_duplicates_are_removed(self):
        self.assertEqual(cdc.normalize_extensions_filter(["pdf", "PDF", "pdf"]), ("pdf",))

    def test_result_is_sorted_deterministically(self):
        self.assertEqual(cdc.normalize_extensions_filter(["docx", "pdf"]), cdc.normalize_extensions_filter(["pdf", "docx"]))


class TestExtensionsFilterInSelectionQueries(unittest.TestCase):
    """The --extensions filter must be applied IN SQL (never fetched then
    filtered in Python), case-insensitively, without disturbing ordering
    or the exact-limit contract."""

    def test_count_applies_extensions_filter_in_sql(self):
        conn = MagicMock()
        cursor = FakeQueueCursor([(12,)])
        conn.cursor.return_value = cursor
        count = cdc._count_persisted_prefilter_candidates(conn, extensions=["PDF", "DocX"])
        self.assertEqual(count, 12)
        query = cursor.queries[0]
        self.assertIn("lower(f.extension) = any(", query)
        self.assertIn("f.id = c.archive_file_id", query)  # now joined to archive_files for the filter
        self.assertEqual(cursor.params[0][-1], ["docx", "pdf"])  # normalized, sorted

    def test_fetch_applies_extensions_filter_case_insensitively(self):
        conn = MagicMock()
        cursor = FakeQueueCursor([[
            (1, "OFFRES 2020/P/a.pdf", "a.pdf", "pdf", None, "root", "/mnt/concept-archives-readonly"),
            (2, "OFFRES 2020/P/b.docx", "b.docx", "docx", None, "root", "/mnt/concept-archives-readonly"),
        ]])
        conn.cursor.return_value = cursor
        rows = cdc._fetch_persisted_prefilter_candidate_rows(conn, limit=50, extensions=["PDF", "DOCX"])
        self.assertEqual(len(rows), 2)
        query = cursor.queries[0]
        self.assertIn("lower(f.extension) = any(", query)
        self.assertIn("order by c.archive_file_id asc", query)
        self.assertEqual(cursor.params[0], ("NOT_ATTEMPTED", "MACHINE_CLASSIFIED", ["docx", "pdf"], 50))

    def test_no_extensions_argument_preserves_original_unfiltered_query(self):
        conn = MagicMock()
        cursor = FakeQueueCursor([[]])
        conn.cursor.return_value = cursor
        cdc._fetch_persisted_prefilter_candidate_rows(conn, limit=25, extensions=None)
        query = cursor.queries[0]
        self.assertNotIn("lower(f.extension)", query)
        self.assertEqual(cursor.params[0], ("NOT_ATTEMPTED", "MACHINE_CLASSIFIED", 25))


class TestBuildProcessPersistedScopeConfigAndSignature(unittest.TestCase):
    def test_config_includes_all_required_dimensions(self):
        config = cdc.build_process_persisted_scope_config(25, 5, "abc123")
        self.assertEqual(config["selection_mode"], "persisted_prefilter_queue")
        self.assertEqual(config["extraction_status_filter"], "NOT_ATTEMPTED")
        self.assertEqual(config["validation_status_filter"], "MACHINE_CLASSIFIED")
        self.assertEqual(config["order_by"], "archive_file_id ASC")
        self.assertEqual(config["limit"], 25)
        self.assertEqual(config["batch_size"], 5)
        self.assertIn("classifier_version", config)
        self.assertIn("extraction_config_version", config)
        self.assertEqual(config["archive_source_root_identity"], "abc123")
        self.assertTrue(config["content_inspection_enabled"])
        self.assertFalse(config["local_ai_enabled"])  # Ollama never enabled in this pilot

    def test_signature_changes_when_selected_ids_change(self):
        config = cdc.build_process_persisted_scope_config(25, 5, "abc123")
        sig_a = cdc.compute_process_persisted_scope_signature([1, 2, 3], config)
        sig_b = cdc.compute_process_persisted_scope_signature([1, 2, 4], config)
        self.assertNotEqual(sig_a, sig_b)

    def test_signature_changes_when_limit_changes(self):
        sig_a = cdc.compute_process_persisted_scope_signature(
            [1, 2, 3], cdc.build_process_persisted_scope_config(25, 5, "abc123")
        )
        sig_b = cdc.compute_process_persisted_scope_signature(
            [1, 2, 3], cdc.build_process_persisted_scope_config(50, 5, "abc123")
        )
        self.assertNotEqual(sig_a, sig_b)

    def test_archive_source_root_identity_never_contains_the_raw_path(self):
        rows = [synthetic_row(1, "OFFRES 2020/P/a.pdf", "a.pdf", source_root_label="MAIN_ARCHIVE")]
        identity = cdc._archive_source_root_identity(rows)
        self.assertNotIn("OFFRES", identity)
        self.assertNotIn("MAIN_ARCHIVE", identity)
        self.assertEqual(len(identity), 16)  # a short hash, never the raw label

    def test_config_records_extensions_filter_normalized(self):
        config = cdc.build_process_persisted_scope_config(25, 5, "abc123", extensions=["PDF", "DocX"])
        self.assertEqual(config["extensions_filter"], ["docx", "pdf"])

    def test_config_records_none_when_no_extensions_filter_given(self):
        config = cdc.build_process_persisted_scope_config(25, 5, "abc123")
        self.assertIsNone(config["extensions_filter"])

    def test_signature_changes_when_extensions_filter_changes(self):
        sig_no_filter = cdc.compute_process_persisted_scope_signature(
            [1, 2, 3], cdc.build_process_persisted_scope_config(25, 5, "abc123")
        )
        sig_pdf_docx = cdc.compute_process_persisted_scope_signature(
            [1, 2, 3], cdc.build_process_persisted_scope_config(25, 5, "abc123", extensions=["pdf", "docx"])
        )
        sig_pdf_only = cdc.compute_process_persisted_scope_signature(
            [1, 2, 3], cdc.build_process_persisted_scope_config(25, 5, "abc123", extensions=["pdf"])
        )
        self.assertNotEqual(sig_no_filter, sig_pdf_docx)
        self.assertNotEqual(sig_pdf_docx, sig_pdf_only)

    def test_signature_is_the_same_regardless_of_extensions_argument_order(self):
        sig_a = cdc.compute_process_persisted_scope_signature(
            [1, 2, 3], cdc.build_process_persisted_scope_config(25, 5, "abc123", extensions=["pdf", "docx"])
        )
        sig_b = cdc.compute_process_persisted_scope_signature(
            [1, 2, 3], cdc.build_process_persisted_scope_config(25, 5, "abc123", extensions=["DOCX", "Pdf"])
        )
        self.assertEqual(sig_a, sig_b)


class TestRunPersistedCandidateContentProcessing(unittest.TestCase):
    """Synthetic-only unit tests for run_persisted_candidate_content_processing
    - the Stage B step of the controlled pilot. Every row here is already
    treated as a confirmed prefilter candidate (no Stage A re-applied)."""

    def _rows(self):
        return [
            synthetic_row(1, "OFFRES 2020/PROJECT-ALPHA/dao avec tdr.pdf", "dao avec tdr.pdf"),
            synthetic_row(2, "OFFRES 2020/PROJECT-BETA/rapport.pdf", "rapport.pdf"),
        ]

    def test_every_row_is_inspected_no_prefilter_reapplied(self):
        rows = self._rows()
        inspector = FakeTechnicalSourceContentInspector(
            {1: _technical_outcome("DAO_WITH_TDR"), 2: _technical_outcome("REPORT")}
        )
        candidates, counters = cdc.run_persisted_candidate_content_processing(rows, inspector)
        self.assertEqual(inspector.calls, 2)
        self.assertEqual(len(candidates), 2)
        self.assertEqual(counters.prefilter_candidates, 2)

    def test_never_calls_ollama(self):
        # LocalContentInspector() with no ai_adapter never increments
        # local_ai_calls - verified here at the orchestration level too.
        rows = self._rows()
        inspector = FakeTechnicalSourceContentInspector({1: _technical_outcome("DAO_WITH_TDR")})
        _candidates, counters = cdc.run_persisted_candidate_content_processing(rows, inspector)
        self.assertEqual(counters.extraction.local_ai_calls, 0)

    def test_external_calls_remains_zero(self):
        rows = self._rows()
        inspector = FakeTechnicalSourceContentInspector({1: _technical_outcome("DAO_WITH_TDR")})
        _candidates, counters = cdc.run_persisted_candidate_content_processing(rows, inspector)
        self.assertEqual(counters.extraction.external_calls, 0)

    def test_extraction_failure_is_never_blocking(self):
        rows = self._rows()
        failed_outcome = cdc.ContentInspectionOutcome(attempted=True, failed=True, reason_code="pdf_path_missing")
        inspector = FakeTechnicalSourceContentInspector({1: failed_outcome})
        candidates, _counters = cdc.run_persisted_candidate_content_processing(rows, inspector)
        by_id = {c.archive_file_id: c for c in candidates}
        self.assertEqual(by_id[1].extraction_status, "FAILED")
        self.assertEqual(by_id[1].review_priority, "EXTRACTION_FAILED")
        self.assertNotEqual(by_id[1].detected_role, "NOT_CDC")  # failed extraction never becomes NOT_CDC


class TestRunProcessPersistedCandidatesModeIntegration(unittest.TestCase):
    """End-to-end (mocked DB) integration tests: selection filters,
    dry-run never opens a document, persist commits per batch, checkpoint
    scope isolation, and human validation is never touched."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp(prefix="cdc-process-persisted-test-")
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)
        self.checkpoint_file = str(Path(self.tmp_dir) / "checkpoint.json")

    def _row(self, archive_file_id):
        return synthetic_row(archive_file_id, f"OFFRES 2020/PROJECT-{archive_file_id}/doc.pdf", "doc.pdf")

    def _patches(self, available=25, selected_rows=None, mock_repo_cls=None):
        fake_conn = MagicMock()
        selected_rows = selected_rows if selected_rows is not None else [self._row(i) for i in range(1, 26)]
        patches = [
            patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}),
            patch.object(cdc, "_connect", return_value=fake_conn),
            patch.object(cdc, "_count_persisted_prefilter_candidates", return_value=available),
            patch.object(cdc, "_fetch_persisted_prefilter_candidate_rows", return_value=selected_rows),
        ]
        if mock_repo_cls is not None:
            patches.append(patch.object(cdc, "PostgresTechnicalSourceCandidateRepository", mock_repo_cls))
        return patches, fake_conn

    def test_extensions_are_forwarded_normalized_to_count_and_fetch(self):
        fake_conn = MagicMock()
        mock_count = MagicMock(return_value=12)
        mock_fetch = MagicMock(return_value=[self._row(i) for i in range(1, 4)])
        with patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             patch.object(cdc, "_connect", return_value=fake_conn), \
             patch.object(cdc, "_count_persisted_prefilter_candidates", mock_count), \
             patch.object(cdc, "_fetch_persisted_prefilter_candidate_rows", mock_fetch), \
             redirect_stdout(io.StringIO()):
            exit_code = cdc.run_process_persisted_candidates_mode(
                limit=3, batch_size=5, dry_run=True, persist=False, resume=False,
                checkpoint_file=self.checkpoint_file, extensions=["PDF", "DocX"],
            )
        self.assertEqual(exit_code, 0)
        mock_count.assert_called_once_with(fake_conn, extensions=("docx", "pdf"))
        mock_fetch.assert_called_once_with(fake_conn, 3, extensions=("docx", "pdf"))

    def test_dry_run_reports_extensions_in_selection_filters(self):
        patches, _fake_conn = self._patches(available=12, selected_rows=[self._row(i) for i in range(1, 4)])
        buffer = io.StringIO()
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with redirect_stdout(buffer):
            cdc.run_process_persisted_candidates_mode(
                limit=3, batch_size=5, dry_run=True, persist=False, resume=False,
                checkpoint_file=self.checkpoint_file, extensions=["pdf", "docx"],
            )
        self.assertIn("extensions=docx,pdf", buffer.getvalue())

    def test_no_extensions_selection_filters_unchanged(self):
        # Backward compatibility: omitting --extensions must not change the
        # printed selection_filters line at all.
        patches, _fake_conn = self._patches()
        buffer = io.StringIO()
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with redirect_stdout(buffer):
            cdc.run_process_persisted_candidates_mode(
                limit=25, batch_size=5, dry_run=True, persist=False, resume=False,
                checkpoint_file=self.checkpoint_file,
            )
        self.assertIn(
            "selection_filters: extraction_status=NOT_ATTEMPTED,validation_status=MACHINE_CLASSIFIED",
            buffer.getvalue(),
        )
        self.assertNotIn("extensions=", buffer.getvalue())

    def test_checkpoint_created_with_extensions_fails_closed_without_them(self):
        rows = [self._row(i) for i in range(1, 3)]
        patches, _fake_conn = self._patches(selected_rows=rows, mock_repo_cls=MagicMock())
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with patch("cdc_content_inspector.LocalContentInspector", return_value=FakeTechnicalSourceContentInspector({})), \
             patch.object(cdc, "resolve_archive_file_path", return_value=None), \
             patch.object(
                 cdc, "persist_technical_source_candidates",
                 return_value=cdc.PersistResult(inserted=2, updated=0),
             ), \
             redirect_stdout(io.StringIO()):
            cdc.run_process_persisted_candidates_mode(
                limit=2, batch_size=5, dry_run=False, persist=True, resume=False,
                checkpoint_file=self.checkpoint_file, extensions=["pdf", "docx"],
            )

        patches2, _fake_conn2 = self._patches(selected_rows=rows, mock_repo_cls=MagicMock())
        for p in patches2:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches2])
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            exit_code = cdc.run_process_persisted_candidates_mode(
                limit=2, batch_size=5, dry_run=False, persist=True, resume=True,
                checkpoint_file=self.checkpoint_file,  # no extensions this time
            )
        self.assertEqual(exit_code, 1)  # scope mismatch -> refuses rather than silently resuming

    def test_checkpoint_created_with_different_extensions_fails_closed(self):
        rows = [self._row(i) for i in range(1, 3)]
        patches, _fake_conn = self._patches(selected_rows=rows, mock_repo_cls=MagicMock())
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with patch("cdc_content_inspector.LocalContentInspector", return_value=FakeTechnicalSourceContentInspector({})), \
             patch.object(cdc, "resolve_archive_file_path", return_value=None), \
             patch.object(
                 cdc, "persist_technical_source_candidates",
                 return_value=cdc.PersistResult(inserted=2, updated=0),
             ), \
             redirect_stdout(io.StringIO()):
            cdc.run_process_persisted_candidates_mode(
                limit=2, batch_size=5, dry_run=False, persist=True, resume=False,
                checkpoint_file=self.checkpoint_file, extensions=["pdf"],
            )

        patches2, _fake_conn2 = self._patches(selected_rows=rows, mock_repo_cls=MagicMock())
        for p in patches2:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches2])
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            exit_code = cdc.run_process_persisted_candidates_mode(
                limit=2, batch_size=5, dry_run=False, persist=True, resume=True,
                checkpoint_file=self.checkpoint_file, extensions=["pdf", "docx"],
            )
        self.assertEqual(exit_code, 1)

    def test_dry_run_selects_exactly_the_requested_limit(self):
        patches, fake_conn = self._patches(available=750, selected_rows=[self._row(i) for i in range(1, 26)])
        buffer = io.StringIO()
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with redirect_stdout(buffer):
            exit_code = cdc.run_process_persisted_candidates_mode(
                limit=25, batch_size=5, dry_run=True, persist=False, resume=False,
                checkpoint_file=self.checkpoint_file,
            )
        self.assertEqual(exit_code, 0)
        output = buffer.getvalue()
        self.assertIn("persisted_candidates_available: 750", output)
        self.assertIn("candidates_selected: 25", output)

    def test_dry_run_never_constructs_a_content_inspector_or_resolves_a_path(self):
        patches, fake_conn = self._patches()
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with patch.object(cdc, "resolve_archive_file_path") as mock_resolve, \
             redirect_stdout(io.StringIO()):
            exit_code = cdc.run_process_persisted_candidates_mode(
                limit=25, batch_size=5, dry_run=True, persist=False, resume=False,
                checkpoint_file=self.checkpoint_file,
            )
        self.assertEqual(exit_code, 0)
        mock_resolve.assert_not_called()
        fake_conn.transaction.assert_not_called()
        fake_conn.commit.assert_not_called()

    def test_dry_run_never_touches_the_checkpoint_file(self):
        patches, _fake_conn = self._patches()
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with redirect_stdout(io.StringIO()):
            cdc.run_process_persisted_candidates_mode(
                limit=25, batch_size=5, dry_run=True, persist=False, resume=False,
                checkpoint_file=self.checkpoint_file,
            )
        self.assertFalse(Path(self.checkpoint_file).exists())

    def test_dry_run_reports_all_extraction_and_write_counters_as_zero(self):
        patches, _fake_conn = self._patches()
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            cdc.run_process_persisted_candidates_mode(
                limit=25, batch_size=5, dry_run=True, persist=False, resume=False,
                checkpoint_file=self.checkpoint_file,
            )
        output = buffer.getvalue()
        for key in (
            "content_extraction_calls", "docling_calls", "libreoffice_calls", "ocr_calls",
            "ollama_calls", "external_calls", "database_inserts", "database_updates",
            "human_decisions_modified",
        ):
            self.assertIn(f"{key}: 0", output)

    def test_persist_commits_after_each_successful_batch(self):
        patches, fake_conn = self._patches(
            selected_rows=[self._row(i) for i in range(1, 11)], mock_repo_cls=MagicMock(),
        )
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with patch("cdc_content_inspector.LocalContentInspector", return_value=FakeTechnicalSourceContentInspector({})), \
             patch.object(cdc, "resolve_archive_file_path", return_value=None), \
             patch.object(
                 cdc, "persist_technical_source_candidates",
                 return_value=cdc.PersistResult(inserted=2, updated=0),
             ), \
             redirect_stdout(io.StringIO()):
            exit_code = cdc.run_process_persisted_candidates_mode(
                limit=10, batch_size=2, dry_run=False, persist=True, resume=False,
                checkpoint_file=self.checkpoint_file,
            )
        self.assertEqual(exit_code, 0)
        self.assertEqual(fake_conn.commit.call_count, 5)  # 10 rows / batch_size 2 -> 5 batches

    def test_commit_failure_is_a_failed_batch_never_silent_success(self):
        patches, fake_conn = self._patches(
            selected_rows=[self._row(i) for i in range(1, 3)], mock_repo_cls=MagicMock(),
        )
        fake_conn.commit.side_effect = RuntimeError("connection lost")
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with patch("cdc_content_inspector.LocalContentInspector", return_value=FakeTechnicalSourceContentInspector({})), \
             patch.object(cdc, "resolve_archive_file_path", return_value=None), \
             patch.object(
                 cdc, "persist_technical_source_candidates",
                 return_value=cdc.PersistResult(inserted=2, updated=0),
             ), \
             redirect_stdout(io.StringIO()):
            exit_code = cdc.run_process_persisted_candidates_mode(
                limit=2, batch_size=2, dry_run=False, persist=True, resume=False,
                checkpoint_file=self.checkpoint_file,
            )
        self.assertEqual(exit_code, 1)

    def test_resume_skips_already_completed_batches(self):
        rows = [self._row(i) for i in range(1, 5)]
        patches, _fake_conn = self._patches(selected_rows=rows, mock_repo_cls=MagicMock())
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with patch("cdc_content_inspector.LocalContentInspector", return_value=FakeTechnicalSourceContentInspector({})), \
             patch.object(cdc, "resolve_archive_file_path", return_value=None), \
             patch.object(
                 cdc, "persist_technical_source_candidates",
                 return_value=cdc.PersistResult(inserted=2, updated=0),
             ), \
             redirect_stdout(io.StringIO()):
            cdc.run_process_persisted_candidates_mode(
                limit=4, batch_size=2, dry_run=False, persist=True, resume=False,
                checkpoint_file=self.checkpoint_file,
            )
        with patch.object(cdc, "run_persisted_candidate_content_processing") as mock_run, \
             redirect_stdout(io.StringIO()):
            mock_run.side_effect = AssertionError("must not reprocess a completed batch")
            exit_code = cdc.run_process_persisted_candidates_mode(
                limit=4, batch_size=2, dry_run=False, persist=True, resume=True,
                checkpoint_file=self.checkpoint_file,
            )
        self.assertEqual(exit_code, 0)
        mock_run.assert_not_called()

    def test_checkpoint_is_never_reused_across_a_different_limit(self):
        rows = [self._row(i) for i in range(1, 5)]
        patches, _fake_conn = self._patches(selected_rows=rows, mock_repo_cls=MagicMock())
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with patch("cdc_content_inspector.LocalContentInspector", return_value=FakeTechnicalSourceContentInspector({})), \
             patch.object(cdc, "resolve_archive_file_path", return_value=None), \
             patch.object(
                 cdc, "persist_technical_source_candidates",
                 return_value=cdc.PersistResult(inserted=2, updated=0),
             ), \
             redirect_stdout(io.StringIO()):
            cdc.run_process_persisted_candidates_mode(
                limit=4, batch_size=2, dry_run=False, persist=True, resume=False,
                checkpoint_file=self.checkpoint_file,
            )
            exit_code = cdc.run_process_persisted_candidates_mode(
                limit=4, batch_size=2, dry_run=False, persist=True, resume=True,
                checkpoint_file=self.checkpoint_file,
            )
        # Different selected rows (a "different limit's worth" scenario) -
        # same checkpoint path - must refuse rather than silently resume.
        rows2 = [self._row(i) for i in range(100, 102)]
        patches2, _fake_conn2 = self._patches(selected_rows=rows2, mock_repo_cls=MagicMock())
        for p in patches2:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches2])
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            exit_code2 = cdc.run_process_persisted_candidates_mode(
                limit=2, batch_size=2, dry_run=False, persist=True, resume=True,
                checkpoint_file=self.checkpoint_file,
            )
        self.assertEqual(exit_code2, 1)

    def test_upsert_sql_never_references_human_validation_columns(self):
        # Structural guarantee, exercised end-to-end through this mode: the
        # real PostgresTechnicalSourceCandidateRepository.upsert() SQL text
        # itself (never the surrounding comments) never mentions
        # validation_status/reviewed_at/reviewed_by, so a machine rerun
        # through this mode can never overwrite a human decision.
        conn = MagicMock()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchone.return_value = (True,)
        conn.cursor.return_value = cursor
        repo = cdc.PostgresTechnicalSourceCandidateRepository(conn)
        candidate = cdc.TechnicalSourceCandidate(
            archive_file_id=1, year=None, project_reference=None, detected_role="UNKNOWN",
            technical_source_candidate=False, structural_score=0, structural_max=0,
            structural_ratio=0.0, structural_band="WEAK_TECHNICAL_SOURCE", confidence=None,
            extraction_status="NOT_ATTEMPTED", review_priority=None,
            classification_method="PREFILTER_SKIPPED", duplicate_of_archive_file_id=None,
            is_primary_candidate=True,
        )
        repo.upsert(candidate)
        executed_sql = cursor.execute.call_args[0][0]
        self.assertNotIn("validation_status", executed_sql)
        self.assertNotIn("reviewed_at", executed_sql)
        self.assertNotIn("reviewed_by", executed_sql)


class TestRunRetryFailedCandidatesModeIntegration(unittest.TestCase):
    """End-to-end (mocked DB) integration tests for --retry-failed: exact
    selection filter (FAILED + one category), dry-run never opens a
    document, persist commits per batch, checkpoint scope isolation from
    --process-persisted-candidates, and human validation is never touched."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp(prefix="cdc-retry-failed-test-")
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)
        self.checkpoint_file = str(Path(self.tmp_dir) / "checkpoint.json")

    def _row(self, archive_file_id):
        return synthetic_row(archive_file_id, f"OFFRES 2020/PROJECT-{archive_file_id}/doc.doc", "doc.doc", extension="doc")

    def _patches(self, available=17, selected_rows=None, mock_repo_cls=None):
        fake_conn = MagicMock()
        selected_rows = selected_rows if selected_rows is not None else [self._row(i) for i in range(1, 4)]
        patches = [
            patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}),
            patch.object(cdc, "_connect", return_value=fake_conn),
            patch.object(cdc, "_count_failed_candidates_by_category", return_value=available),
            patch.object(cdc, "_fetch_failed_candidate_rows", return_value=selected_rows),
        ]
        if mock_repo_cls is not None:
            patches.append(patch.object(cdc, "PostgresTechnicalSourceCandidateRepository", mock_repo_cls))
        return patches, fake_conn

    def test_dry_run_selects_exactly_the_requested_limit(self):
        patches, _fake_conn = self._patches(available=17, selected_rows=[self._row(i) for i in range(1, 4)])
        buffer = io.StringIO()
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with redirect_stdout(buffer):
            exit_code = cdc.run_retry_failed_candidates_mode(
                failure_category="EMPTY_EXTRACTED_TEXT", limit=3, batch_size=5,
                dry_run=True, persist=False, resume=False, checkpoint_file=self.checkpoint_file,
            )
        self.assertEqual(exit_code, 0)
        output = buffer.getvalue()
        self.assertIn("failed_candidates_available: 17", output)
        self.assertIn("candidates_selected: 3", output)
        self.assertIn("selection_filter: FAILED + EMPTY_EXTRACTED_TEXT", output)

    def test_dry_run_never_constructs_a_content_inspector_or_resolves_a_path(self):
        patches, fake_conn = self._patches()
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with patch.object(cdc, "resolve_archive_file_path") as mock_resolve, \
             redirect_stdout(io.StringIO()):
            exit_code = cdc.run_retry_failed_candidates_mode(
                failure_category="EMPTY_EXTRACTED_TEXT", limit=3, batch_size=5,
                dry_run=True, persist=False, resume=False, checkpoint_file=self.checkpoint_file,
            )
        self.assertEqual(exit_code, 0)
        mock_resolve.assert_not_called()
        fake_conn.transaction.assert_not_called()
        fake_conn.commit.assert_not_called()

    def test_dry_run_never_touches_the_checkpoint_file(self):
        patches, _fake_conn = self._patches()
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with redirect_stdout(io.StringIO()):
            cdc.run_retry_failed_candidates_mode(
                failure_category="EMPTY_EXTRACTED_TEXT", limit=3, batch_size=5,
                dry_run=True, persist=False, resume=False, checkpoint_file=self.checkpoint_file,
            )
        self.assertFalse(Path(self.checkpoint_file).exists())

    def test_dry_run_reports_all_extraction_and_write_counters_as_zero(self):
        patches, _fake_conn = self._patches()
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            cdc.run_retry_failed_candidates_mode(
                failure_category="EMPTY_EXTRACTED_TEXT", limit=3, batch_size=5,
                dry_run=True, persist=False, resume=False, checkpoint_file=self.checkpoint_file,
            )
        output = buffer.getvalue()
        for key in (
            "content_extraction_calls", "docling_calls", "libreoffice_calls", "ocr_calls",
            "ollama_calls", "external_calls", "database_inserts", "database_updates",
            "human_decisions_modified",
        ):
            self.assertIn(f"{key}: 0", output)

    def test_persist_commits_after_each_successful_batch(self):
        patches, fake_conn = self._patches(
            selected_rows=[self._row(i) for i in range(1, 4)], mock_repo_cls=MagicMock(),
        )
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with patch("cdc_content_inspector.LocalContentInspector", return_value=FakeTechnicalSourceContentInspector({})), \
             patch.object(cdc, "resolve_archive_file_path", return_value=None), \
             patch.object(
                 cdc, "persist_technical_source_candidates",
                 return_value=cdc.PersistResult(inserted=0, updated=1),
             ), \
             redirect_stdout(io.StringIO()):
            exit_code = cdc.run_retry_failed_candidates_mode(
                failure_category="EMPTY_EXTRACTED_TEXT", limit=3, batch_size=1,
                dry_run=False, persist=True, resume=False, checkpoint_file=self.checkpoint_file,
            )
        self.assertEqual(exit_code, 0)
        self.assertEqual(fake_conn.commit.call_count, 3)

    def test_retry_checkpoint_is_never_reused_by_process_persisted_candidates(self):
        # The two modes must never share a checkpoint scope even if they
        # happened to select the exact same archive_file_id set.
        rows = [self._row(i) for i in range(1, 3)]
        patches, _fake_conn = self._patches(selected_rows=rows, mock_repo_cls=MagicMock())
        for p in patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches])
        with patch("cdc_content_inspector.LocalContentInspector", return_value=FakeTechnicalSourceContentInspector({})), \
             patch.object(cdc, "resolve_archive_file_path", return_value=None), \
             patch.object(
                 cdc, "persist_technical_source_candidates",
                 return_value=cdc.PersistResult(inserted=0, updated=1),
             ), \
             redirect_stdout(io.StringIO()):
            cdc.run_retry_failed_candidates_mode(
                failure_category="EMPTY_EXTRACTED_TEXT", limit=2, batch_size=5,
                dry_run=False, persist=True, resume=False, checkpoint_file=self.checkpoint_file,
            )

        patches2, _fake_conn2 = self._patches(selected_rows=rows, mock_repo_cls=MagicMock())
        for p in patches2:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in patches2])
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            exit_code = cdc.run_process_persisted_candidates_mode(
                limit=2, batch_size=5, dry_run=False, persist=True, resume=True,
                checkpoint_file=self.checkpoint_file,
            )
        self.assertEqual(exit_code, 1)  # different mode -> scope mismatch, never silently resumed

    def test_never_selects_not_attempted_or_success_rows(self):
        # Structural guarantee exercised via the real SQL text: the SELECT
        # always filters on extraction_status = 'FAILED', never
        # NOT_ATTEMPTED or SUCCESS.
        conn = MagicMock()
        cursor = FakeQueueCursor([[]])
        conn.cursor.return_value = cursor
        cdc._fetch_failed_candidate_rows(conn, "EMPTY_EXTRACTED_TEXT", limit=3)
        query = cursor.queries[0]
        self.assertIn("extraction_status = 'FAILED'", query)
        self.assertNotIn("NOT_ATTEMPTED", query)
        self.assertNotIn("SUCCESS", query)
        self.assertEqual(cursor.params[0], ("EMPTY_EXTRACTED_TEXT", 3))


class TestProcessPersistedCandidatesCliGating(unittest.TestCase):
    def _connect_should_never_be_called(self):
        mock_connect = MagicMock(side_effect=AssertionError("DB connect must not be attempted"))
        return patch.object(cdc, "_connect", mock_connect), mock_connect

    def test_extensions_accepted_with_valid_value(self):
        mock_connect = MagicMock(side_effect=RuntimeError("stop right after arg validation"))
        with patch.object(cdc, "_connect", mock_connect), \
             patch.dict(os.environ, {"DATABASE_URL": FAKE_DATABASE_URL}), \
             redirect_stderr(io.StringIO()):
            with self.assertRaises(RuntimeError):
                cdc.main([
                    "--process-persisted-candidates", "--dry-run", "--limit", "25",
                    "--batch-size", "5", "--extensions", "pdf,docx",
                ])
        self.assertEqual(mock_connect.call_count, 1)

    def test_extensions_rejected_outside_process_persisted_candidates(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--pilot-limit", "5", "--dry-run", "--extensions", "pdf,docx"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_extensions_rejected_when_all_empty(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--process-persisted-candidates", "--dry-run", "--limit", "25",
                    "--batch-size", "5", "--extensions", " , ",
                ])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_requires_limit(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--process-persisted-candidates", "--dry-run", "--batch-size", "5"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_requires_batch_size(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--process-persisted-candidates", "--dry-run", "--limit", "25"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_requires_dry_run_or_persist(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--process-persisted-candidates", "--limit", "25", "--batch-size", "5"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_limit_rejected_outside_process_persisted_candidates(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--pilot-limit", "5", "--dry-run", "--limit", "25"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_enable_content_inspection_rejected(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--process-persisted-candidates", "--dry-run", "--limit", "25",
                    "--batch-size", "5", "--enable-content-inspection",
                ])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_negative_limit_rejected(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--process-persisted-candidates", "--dry-run", "--limit", "-5", "--batch-size", "5",
                ])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)


class TestRetryFailedCliGating(unittest.TestCase):
    def _connect_should_never_be_called(self):
        mock_connect = MagicMock(side_effect=AssertionError("DB connect must not be attempted"))
        return patch.object(cdc, "_connect", mock_connect), mock_connect

    def test_requires_failure_category(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main(["--retry-failed", "--dry-run", "--limit", "3", "--batch-size", "5"])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_requires_limit(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--retry-failed", "--dry-run", "--failure-category", "EMPTY_EXTRACTED_TEXT",
                    "--batch-size", "5",
                ])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_requires_batch_size(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--retry-failed", "--dry-run", "--failure-category", "EMPTY_EXTRACTED_TEXT",
                    "--limit", "3",
                ])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_requires_dry_run_or_persist(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--retry-failed", "--failure-category", "EMPTY_EXTRACTED_TEXT",
                    "--limit", "3", "--batch-size", "5",
                ])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_rejects_unknown_failure_category(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--retry-failed", "--dry-run", "--failure-category", "NOT_A_REAL_CATEGORY",
                    "--limit", "3", "--batch-size", "5",
                ])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_failure_category_rejected_outside_retry_failed(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--pilot-limit", "5", "--dry-run", "--failure-category", "EMPTY_EXTRACTED_TEXT",
                ])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)

    def test_enable_content_inspection_rejected(self):
        patcher, mock_connect = self._connect_should_never_be_called()
        with patcher, redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as ctx:
                cdc.main([
                    "--retry-failed", "--dry-run", "--failure-category", "EMPTY_EXTRACTED_TEXT",
                    "--limit", "3", "--batch-size", "5", "--enable-content-inspection",
                ])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(mock_connect.call_count, 0)


if __name__ == "__main__":
    unittest.main()
