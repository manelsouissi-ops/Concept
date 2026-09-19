#!/usr/bin/env python3
"""Controlled, dry-run-by-default PostgreSQL import layer for Youssef's
validated "CDC utilisable ?" review decisions.

This module builds on the already-verified, read-only parser
(cdc_review_import_preview.py) as its read layer and adds a write plan,
a fail-closed database-target guard, and a transaction orchestrator. It
NEVER connects to PostgreSQL and NEVER reads DATABASE_URL/TEST_DATABASE_URL
on its own - the only way this module ever touches a real database is if a
caller supplies --execute plus every one of a long list of explicit safety
flags (see EXECUTE_REQUIRED_FLAGS below), at which point main() itself
resolves the dedicated env var, constructs PostgresDatabaseGateway (which
imports the database driver lazily, inside its own __init__), verifies the
connected database's identity, calls the existing execute_import(), and
always closes the connection in a finally block - this CLI is sufficient
on its own; no external driver script is required.

OPERATIONAL NOTE: the first real import against GONOGO (2026-09-18) ran
through a temporary one-off scratchpad driver, written outside this repo,
because this file's --execute path deliberately stopped short of opening a
real connection at that time. That driver called this module's own
already-tested functions/classes verbatim (ReviewerSpec,
build_confirmation_token, build_expected_deployment_ack,
resolve_database_target, parse_and_validate_database_target,
parse_workbook_for_import, build_import_plan, PostgresDatabaseGateway,
execute_import) - it added no logic of its own beyond the connection
wiring this file now provides directly. It was never part of this
repository and is not required for any future run.

DECISION MAPPING (see the accompanying report for the schema evidence):
  OUI       -> validation_status = 'HUMAN_VALIDATED_CDC'
  NON       -> validation_status = 'HUMAN_REJECTED_CDC'
  INCERTAIN -> no update at all. Not written as HUMAN_UNCERTAIN, not
               touched in any column, not linked to the import batch.

REVIEWER MODEL: Youssef is an external human reviewer with no app_users
account, and one must never be fabricated to satisfy a NOT NULL foreign
key. This module supports two mutually exclusive reviewer types:
  - INTERNAL_USER: reviewed_by is set to a real, existing app_users.id.
  - EXTERNAL_HUMAN: reviewed_by stays NULL (truthfully - no internal
    account performed the review); a short external_reviewer_label is
    recorded once, at the import-batch level only, and every updated
    candidate is linked back to that batch via
    human_review_import_batch_id so it stays traceable without repeating
    the label onto every row.
Both modes are validated before any connection is used, and never fall
back into each other.

CONFIDENTIALITY: never prints a candidate identifier, a workbook cell
value, or a database credential. Every printed line is a fixed label, a
sanitized host/database name (never credentials), or an aggregate count.
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Protocol
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cdc_review_import_preview as preview  # noqa: E402  (sys.path set above, matches repo convention)

IMPORTER_VERSION = "v2"

# ---------------------------------------------------------------------
# Decision -> validation_status mapping
# ---------------------------------------------------------------------
# OUI/NON map onto values already present in the ORIGINAL (un-widened)
# validation_status vocabulary (scripts/sql/create_historical_technical_
# source_candidates_table.sql) - this import does not depend on the
# separate v3-widening migration. The mapping is not a guess: the
# workbook's own column is literally named "CDC utilisable ?" (a binary
# yes/no about CDC usability), and the enum has an exact, dedicated pair
# for that exact question - HUMAN_VALIDATED_CDC and its negative
# counterpart HUMAN_REJECTED_CDC - not a multi-way role choice that would
# require guessing which one applies.
DECISION_TO_VALIDATION_STATUS = {
    "OUI": "HUMAN_VALIDATED_CDC",
    "NON": "HUMAN_REJECTED_CDC",
}
# INCERTAIN is deliberately absent from this mapping - see module docstring.

# A candidate whose current validation_status is one of these has not yet
# received a human decision; only these may be safely updated. Any other
# current value is an existing human decision and updating it would be an
# unreviewed overwrite - the exact case this importer must reject.
NOT_YET_HUMAN_DECIDED_STATUSES = frozenset({"MACHINE_CLASSIFIED", "NEEDS_HUMAN_REVIEW"})

FORBIDDEN_DATABASE_URL_ENV_NAMES = frozenset({"DATABASE_URL", "TEST_DATABASE_URL"})

REVIEWER_TYPES = ("INTERNAL_USER", "EXTERNAL_HUMAN")

EXECUTE_REQUIRED_FLAGS = (
    "expected_total",
    "expected_usable",
    "expected_excluded",
    "expected_skipped_uncertain",
    "expected_source_sha256",
    "confirm_token",
    "expected_database_name",
    "deployment_ack",
)


class ImportGuardError(RuntimeError):
    """Raised by any fail-closed safety guard, precheck, or verification
    step before/during a write. Every raise site of this exception is a
    point where the caller must stop and, inside a transaction, roll back."""


class ImportPlanError(RuntimeError):
    """Raised when the parsed workbook cannot be turned into a safe plan."""


# ---------------------------------------------------------------------
# Reviewer identity - mutually exclusive INTERNAL_USER / EXTERNAL_HUMAN
# ---------------------------------------------------------------------

@dataclass(frozen=True)
class ReviewerSpec:
    reviewer_type: str
    reviewer_user_id: Optional[int] = None
    external_reviewer_label: Optional[str] = None
    imported_by_user_id: Optional[int] = None  # always optional, either mode


def validate_reviewer_spec(spec: ReviewerSpec) -> None:
    """Mirrors the database CHECK constraint on the application side too -
    defense in depth, and lets the CLI fail closed before ever touching a
    connection. Never allows both modes at once; never silently falls back
    from one to the other."""
    if spec.reviewer_type not in REVIEWER_TYPES:
        raise ImportGuardError(f"--reviewer-type must be one of {REVIEWER_TYPES}.")

    if spec.reviewer_type == "INTERNAL_USER":
        if spec.reviewer_user_id is None:
            raise ImportGuardError("--reviewer-type INTERNAL_USER requires --reviewer-id.")
        if spec.external_reviewer_label is not None:
            raise ImportGuardError("--reviewer-type INTERNAL_USER forbids --external-reviewer-label.")
    else:  # EXTERNAL_HUMAN
        if not spec.external_reviewer_label or not spec.external_reviewer_label.strip():
            raise ImportGuardError("--reviewer-type EXTERNAL_HUMAN requires --external-reviewer-label.")
        if spec.reviewer_user_id is not None:
            raise ImportGuardError("--reviewer-type EXTERNAL_HUMAN forbids --reviewer-id.")
        if len(spec.external_reviewer_label) > 100:
            raise ImportGuardError("--external-reviewer-label must be 100 characters or fewer.")


# ---------------------------------------------------------------------
# Import plan (pure - no database, no I/O beyond the already-verified
# read-only workbook parse)
# ---------------------------------------------------------------------

@dataclass(frozen=True)
class PlannedUpdate:
    identifier: str        # -> historical_technical_source_candidates.id (UUID)
    archive_file_id: str   # -> historical_technical_source_candidates.archive_file_id (BIGINT)
    new_validation_status: str


@dataclass(frozen=True)
class ImportPlan:
    total: int
    usable: int
    excluded: int
    skipped_uncertain: int
    updates: "tuple[PlannedUpdate, ...]"           # OUI/NON rows only; len == usable + excluded
    skipped_identifiers: "tuple[str, ...]"         # INCERTAIN rows; never appear in `updates`
    skipped_pairs: "tuple[tuple[str, str], ...]"   # INCERTAIN rows' (id, archive_file_id) pairs


def extract_identifier_pairs(technical_ws) -> "list[tuple[str, str]]":
    """Returns (primary_id, secondary_id) pairs in row order, re-validating
    completeness and uniqueness of BOTH technical-sheet identifier columns.
    The read-only preview module only ever returns the primary column (its
    contract is proving uniqueness, not handing back a dual-key list for a
    future write) - the importer needs both: primary -> candidates.id,
    secondary -> candidates.archive_file_id, used together as the match
    key so a row is only ever touched when both agree."""
    primary_col, secondary_col = preview.TECHNICAL_IDENTIFIER_COLUMNS
    pairs = []
    primary_seen: set = set()
    secondary_seen: set = set()
    for row in preview._iter_data_row_values(technical_ws, technical_ws.max_column):
        primary_value = row[primary_col - 1]
        secondary_value = row[secondary_col - 1]
        if not preview._non_blank(primary_value) or not preview._non_blank(secondary_value):
            raise ImportPlanError("a technical-sheet row is missing an identifier.")
        primary = str(primary_value).strip()
        secondary = str(secondary_value).strip()
        if primary in primary_seen or secondary in secondary_seen:
            raise ImportPlanError("duplicate identifier found on the technical sheet.")
        primary_seen.add(primary)
        secondary_seen.add(secondary)
        pairs.append((primary, secondary))
    return pairs


def parse_workbook_for_import(source_path: Path, expected_sha256: str):
    """Full validated read pass (hash -> structure -> identifiers -> row
    alignment -> decisions/years), reusing the already-verified parser for
    every step, then adds the dual-identifier extraction the importer
    needs. Raises WorkbookValidationError/ImportPlanError - never returns
    a plan for an invalid workbook."""
    preview.verify_source_hash(source_path, expected_sha256)
    wb = preview.load_workbook_readonly(source_path)
    main_ws, technical_ws = preview.validate_structure(wb)
    primary_ids = preview.validate_identifiers(technical_ws)
    preview.validate_row_alignment(main_ws, technical_ws, None)
    pairs = extract_identifier_pairs(technical_ws)
    if [p for p, _ in pairs] != primary_ids:
        raise ImportPlanError("identifier extraction mismatch between the preview and importer passes.")
    candidates = preview.extract_candidate_rows(main_ws, primary_ids)
    return candidates, pairs


def build_import_plan(candidates, pairs) -> ImportPlan:
    secondary_by_primary = dict(pairs)
    updates = []
    skipped_ids = []
    skipped_pairs = []
    usable = excluded = skipped_uncertain = 0

    for candidate in candidates:
        secondary = secondary_by_primary[candidate.identifier]
        if candidate.decision == "INCERTAIN":
            skipped_ids.append(candidate.identifier)
            skipped_pairs.append((candidate.identifier, secondary))
            skipped_uncertain += 1
            continue

        new_status = DECISION_TO_VALIDATION_STATUS[candidate.decision]
        updates.append(
            PlannedUpdate(identifier=candidate.identifier, archive_file_id=secondary, new_validation_status=new_status)
        )
        if candidate.decision == "OUI":
            usable += 1
        else:
            excluded += 1

    return ImportPlan(
        total=len(candidates),
        usable=usable,
        excluded=excluded,
        skipped_uncertain=skipped_uncertain,
        updates=tuple(updates),
        skipped_identifiers=tuple(skipped_ids),
        skipped_pairs=tuple(skipped_pairs),
    )


# ---------------------------------------------------------------------
# Database gateway abstraction - a real implementation and a fully
# in-memory fake used by tests. No PostgreSQL anywhere in this file except
# inside PostgresDatabaseGateway.__init__'s lazy `import psycopg`, which
# this task never triggers.
# ---------------------------------------------------------------------

@dataclass(frozen=True)
class CandidateState:
    id: str
    archive_file_id: str
    validation_status: str
    review_priority: Optional[str]
    detected_role: str
    structural_band: str
    reviewed_by: Optional[int] = None
    reviewed_at_is_set: bool = False
    human_review_import_batch_id: Optional[int] = None


@dataclass(frozen=True)
class DatabaseIdentity:
    host: str
    port: Optional[int]
    database: str


class DatabaseGateway(Protocol):
    def verify_target(self, expected_database_name: str) -> DatabaseIdentity: ...
    def reviewer_exists(self, reviewer_id: int) -> bool: ...
    def begin(self) -> None: ...
    def commit(self) -> None: ...
    def rollback(self) -> None: ...
    def lock_and_fetch_candidates(self, keys) -> "dict[tuple[str, str], CandidateState]": ...
    def update_candidate(self, id_: str, archive_file_id: str, new_validation_status: str, reviewed_by: Optional[int], batch_id: int) -> int: ...
    def record_import_batch(self, source_workbook_sha256: str, reviewer: ReviewerSpec, importer_version: str, plan: ImportPlan) -> int: ...
    def finalize_import_batch(self, batch_id: int, status: str, updated_count: int, error_message: Optional[str] = None) -> None: ...
    def find_completed_batch(self, source_workbook_sha256: str) -> Optional[int]: ...
    def find_in_progress_batch(self, source_workbook_sha256: str) -> Optional[int]: ...
    def close(self) -> None: ...


class FakeDatabaseGateway:
    """Entirely in-memory. No socket, no file, no PostgreSQL. Used by
    tests to exercise every write-semantics requirement without a
    database."""

    def __init__(self, seed_candidates, reviewer_ids=(), database_name="concept_test", host="fake-host", port=5432, now_fn=None):
        self._candidates = dict(seed_candidates)
        self._reviewer_ids = set(reviewer_ids)
        self._database_name = database_name
        self._host = host
        self._port = port
        self._now_fn = now_fn or (lambda: datetime.now(timezone.utc))
        self._in_transaction = False
        self._snapshot = None
        self.committed = False
        self.rolled_back = False
        self.closed = False
        self.import_batches: "list[dict]" = []
        self.update_calls: "list[tuple]" = []

    def verify_target(self, expected_database_name: str) -> DatabaseIdentity:
        if expected_database_name != self._database_name:
            raise ImportGuardError("current_database() does not match --expected-database-name.")
        return DatabaseIdentity(host=self._host, port=self._port, database=self._database_name)

    def reviewer_exists(self, reviewer_id: int) -> bool:
        return reviewer_id in self._reviewer_ids

    def begin(self) -> None:
        if self._in_transaction:
            raise RuntimeError("nested transaction.")
        self._in_transaction = True
        self._snapshot = dict(self._candidates)

    def commit(self) -> None:
        if not self._in_transaction:
            raise RuntimeError("commit without begin.")
        self._in_transaction = False
        self.committed = True

    def rollback(self) -> None:
        if not self._in_transaction:
            raise RuntimeError("rollback without begin.")
        self._candidates = self._snapshot
        self._in_transaction = False
        self.rolled_back = True

    def lock_and_fetch_candidates(self, keys):
        if not self._in_transaction:
            raise RuntimeError("lock_and_fetch_candidates must run inside a transaction.")
        return {key: self._candidates[key] for key in keys if key in self._candidates}

    def update_candidate(self, id_, archive_file_id, new_validation_status, reviewed_by, batch_id) -> int:
        if not self._in_transaction:
            raise RuntimeError("update_candidate must run inside a transaction.")
        key = (id_, archive_file_id)
        if key not in self._candidates:
            return 0
        current = self._candidates[key]
        self._candidates[key] = replace(
            current,
            validation_status=new_validation_status,
            reviewed_by=reviewed_by,
            reviewed_at_is_set=True,
            human_review_import_batch_id=batch_id,
        )
        self.update_calls.append((id_, archive_file_id, new_validation_status, reviewed_by, batch_id, self._now_fn()))
        return 1

    def record_import_batch(self, source_workbook_sha256, reviewer: ReviewerSpec, importer_version, plan) -> int:
        batch_id = len(self.import_batches) + 1
        self.import_batches.append({
            "id": batch_id,
            "source_workbook_sha256": source_workbook_sha256,
            "reviewer_type": reviewer.reviewer_type,
            "reviewer_user_id": reviewer.reviewer_user_id,
            "external_reviewer_label": reviewer.external_reviewer_label,
            "imported_by_user_id": reviewer.imported_by_user_id,
            "importer_version": importer_version,
            "status": "IN_PROGRESS",
            "total_count": plan.total,
            "usable_count": plan.usable,
            "excluded_count": plan.excluded,
            "skipped_uncertain_count": plan.skipped_uncertain,
            "updated_count": 0,
        })
        return batch_id

    def finalize_import_batch(self, batch_id, status, updated_count, error_message=None) -> None:
        self.import_batches[batch_id - 1]["status"] = status
        self.import_batches[batch_id - 1]["updated_count"] = updated_count
        self.import_batches[batch_id - 1]["error_message"] = error_message

    def find_completed_batch(self, source_workbook_sha256) -> Optional[int]:
        for batch in self.import_batches:
            if batch["source_workbook_sha256"] == source_workbook_sha256 and batch["status"] == "COMPLETED":
                return batch["id"]
        return None

    def find_in_progress_batch(self, source_workbook_sha256) -> Optional[int]:
        for batch in self.import_batches:
            if batch["source_workbook_sha256"] == source_workbook_sha256 and batch["status"] == "IN_PROGRESS":
                return batch["id"]
        return None

    def close(self) -> None:
        self.closed = True


class PostgresDatabaseGateway:
    """Real gateway. Only ever instantiated from main()'s --execute path,
    after every safety guard (flags, hash, counts, confirm token,
    deployment ack, database-target validation) has already passed. The
    database driver is imported lazily, inside __init__, so merely
    importing this module - or running dry-run/any synthetic test - never
    requires psycopg to be installed and never touches a database. Callers
    must always call close() (main() does so in a finally block)."""

    def __init__(self, connection_string: str):
        import psycopg  # lazy: only reached once every guard above has passed
        self._conn = psycopg.connect(connection_string)
        self._conn.autocommit = False

    def verify_target(self, expected_database_name: str) -> DatabaseIdentity:
        with self._conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            (actual,) = cur.fetchone()
        if actual != expected_database_name:
            raise ImportGuardError("current_database() does not match --expected-database-name.")
        info = self._conn.info
        return DatabaseIdentity(host=info.host, port=info.port, database=actual)

    def reviewer_exists(self, reviewer_id: int) -> bool:
        with self._conn.cursor() as cur:
            cur.execute("SELECT 1 FROM public.app_users WHERE id = %s", (reviewer_id,))
            return cur.fetchone() is not None

    def begin(self) -> None:
        pass  # psycopg opens a transaction implicitly on the first statement

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def lock_and_fetch_candidates(self, keys):
        results = {}
        with self._conn.cursor() as cur:
            for id_, archive_file_id in keys:
                cur.execute(
                    """
                    SELECT id, archive_file_id, validation_status, review_priority,
                           detected_role, structural_band, reviewed_by,
                           (reviewed_at IS NOT NULL), human_review_import_batch_id
                    FROM knowledge_base.historical_technical_source_candidates
                    WHERE id = %s AND archive_file_id = %s
                    FOR UPDATE
                    """,
                    (id_, archive_file_id),
                )
                row = cur.fetchone()
                if row:
                    results[(id_, archive_file_id)] = CandidateState(*row)
        return results

    def update_candidate(self, id_, archive_file_id, new_validation_status, reviewed_by, batch_id) -> int:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                UPDATE knowledge_base.historical_technical_source_candidates
                SET validation_status = %s, reviewed_by = %s, reviewed_at = now(),
                    human_review_import_batch_id = %s
                WHERE id = %s AND archive_file_id = %s
                """,
                (new_validation_status, reviewed_by, batch_id, id_, archive_file_id),
            )
            return cur.rowcount

    def record_import_batch(self, source_workbook_sha256, reviewer: ReviewerSpec, importer_version, plan) -> int:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO knowledge_base.historical_technical_source_import_batches
                    (source_workbook_sha256, reviewer_type, reviewer_user_id, external_reviewer_label,
                     imported_by_user_id, importer_version, status,
                     total_count, usable_count, excluded_count, skipped_uncertain_count)
                VALUES (%s, %s, %s, %s, %s, %s, 'IN_PROGRESS', %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    source_workbook_sha256, reviewer.reviewer_type, reviewer.reviewer_user_id,
                    reviewer.external_reviewer_label, reviewer.imported_by_user_id, importer_version,
                    plan.total, plan.usable, plan.excluded, plan.skipped_uncertain,
                ),
            )
            (batch_id,) = cur.fetchone()
            return batch_id

    def finalize_import_batch(self, batch_id, status, updated_count, error_message=None) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                UPDATE knowledge_base.historical_technical_source_import_batches
                SET status = %s, updated_count = %s, completed_at = now(), error_message = %s
                WHERE id = %s
                """,
                (status, updated_count, error_message, batch_id),
            )

    def find_completed_batch(self, source_workbook_sha256) -> Optional[int]:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM knowledge_base.historical_technical_source_import_batches
                WHERE source_workbook_sha256 = %s AND status = 'COMPLETED'
                """,
                (source_workbook_sha256,),
            )
            row = cur.fetchone()
            return row[0] if row else None

    def find_in_progress_batch(self, source_workbook_sha256) -> Optional[int]:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT id FROM knowledge_base.historical_technical_source_import_batches
                WHERE source_workbook_sha256 = %s AND status = 'IN_PROGRESS'
                """,
                (source_workbook_sha256,),
            )
            row = cur.fetchone()
            return row[0] if row else None

    def close(self) -> None:
        self._conn.close()


# ---------------------------------------------------------------------
# Transaction orchestration - the "required write semantics"
# ---------------------------------------------------------------------

def execute_import(gateway, plan: ImportPlan, reviewer: ReviewerSpec, expected_counts: dict, source_workbook_sha256: str) -> dict:
    """One transaction, start to finish. Every failure raises
    ImportGuardError from inside the try block below, which always
    triggers rollback() before re-raising - there is no path that commits
    without every precheck and post-update verification having passed."""
    validate_reviewer_spec(reviewer)

    if (
        expected_counts.get("total") != plan.total
        or expected_counts.get("usable") != plan.usable
        or expected_counts.get("excluded") != plan.excluded
        or expected_counts.get("skipped_uncertain") != plan.skipped_uncertain
    ):
        raise ImportGuardError("expected counts do not match the computed import plan - aborting before any connection use.")

    if len(plan.updates) > 748:
        raise ImportGuardError("import plan would update more than 748 rows - aborting.")

    gateway.begin()
    try:
        if reviewer.reviewer_type == "INTERNAL_USER" and not gateway.reviewer_exists(reviewer.reviewer_user_id):
            raise ImportGuardError("reviewer id is not a known app_users id.")

        in_progress = gateway.find_in_progress_batch(source_workbook_sha256)
        if in_progress is not None:
            raise ImportGuardError(
                "an IN_PROGRESS import batch already exists for this exact workbook hash - aborting "
                "rather than silently reusing an incomplete run."
            )

        existing_completed = gateway.find_completed_batch(source_workbook_sha256)
        if existing_completed is not None:
            # Idempotent: this exact workbook was already fully imported.
            gateway.commit()
            return {"status": "IDEMPOTENT_NOOP", "batch_id": existing_completed, "updated": 0}

        batch_id = gateway.record_import_batch(source_workbook_sha256, reviewer, IMPORTER_VERSION, plan)

        keys = [(u.identifier, u.archive_file_id) for u in plan.updates]
        if len(set(keys)) != len(keys):
            raise ImportGuardError("duplicate candidate identifiers in the import plan.")

        locked = gateway.lock_and_fetch_candidates(keys)
        missing = [key for key in keys if key not in locked]
        if missing:
            raise ImportGuardError(
                f"{len(missing)} candidate identifier(s) from the workbook were not found in the "
                "database - aborting (partial match)."
            )

        conflicts = 0
        rows_needing_update = []
        for update in plan.updates:
            key = (update.identifier, update.archive_file_id)
            current = locked[key]
            if current.validation_status == update.new_validation_status:
                continue  # already correct - idempotent no-op for this row
            if current.validation_status not in NOT_YET_HUMAN_DECIDED_STATUSES:
                conflicts += 1
                continue
            rows_needing_update.append(update)
        if conflicts:
            raise ImportGuardError(f"{conflicts} candidate(s) already carry a conflicting human decision - aborting.")

        reviewed_by_value = reviewer.reviewer_user_id  # None for EXTERNAL_HUMAN, a real id for INTERNAL_USER
        updated_count = 0
        for update in rows_needing_update:
            rc = gateway.update_candidate(update.identifier, update.archive_file_id, update.new_validation_status, reviewed_by_value, batch_id)
            if rc != 1:
                raise ImportGuardError("an update affected an unexpected number of rows - aborting.")
            updated_count += 1

        if updated_count != len(rows_needing_update) or updated_count > len(plan.updates):
            raise ImportGuardError("updated row count does not match the planned update count - aborting.")

        post = gateway.lock_and_fetch_candidates(keys)
        for update in plan.updates:
            key = (update.identifier, update.archive_file_id)
            before, after = locked[key], post[key]
            if after.validation_status != update.new_validation_status:
                raise ImportGuardError("post-update verification failed: validation_status not applied.")
            if after.review_priority != before.review_priority:
                raise ImportGuardError("post-update verification failed: review_priority was modified.")
            if after.detected_role != before.detected_role or after.structural_band != before.structural_band:
                raise ImportGuardError("post-update verification failed: a machine-classification field was modified.")
            if reviewer.reviewer_type == "EXTERNAL_HUMAN" and after.reviewed_by is not None:
                raise ImportGuardError("post-update verification failed: reviewed_by must stay NULL for EXTERNAL_HUMAN.")
            if reviewer.reviewer_type == "INTERNAL_USER" and after.reviewed_by != reviewer.reviewer_user_id:
                raise ImportGuardError("post-update verification failed: reviewed_by does not match the internal reviewer.")
            if not after.reviewed_at_is_set:
                raise ImportGuardError("post-update verification failed: reviewed_at was not set.")
            if after.human_review_import_batch_id != batch_id:
                raise ImportGuardError("post-update verification failed: human_review_import_batch_id was not linked.")

        # The 2 INCERTAIN rows must remain completely untouched and unlinked.
        if plan.skipped_pairs:
            skipped_state = gateway.lock_and_fetch_candidates(list(plan.skipped_pairs))
            for key in plan.skipped_pairs:
                state = skipped_state.get(key)
                if state is not None and state.human_review_import_batch_id is not None:
                    raise ImportGuardError("post-update verification failed: an INCERTAIN row was linked to the batch.")

        gateway.finalize_import_batch(batch_id, "COMPLETED", updated_count)
        gateway.commit()
        return {"status": "COMMITTED", "batch_id": batch_id, "updated": updated_count}
    except Exception:
        gateway.rollback()
        raise


# ---------------------------------------------------------------------
# Database target guard (task 6) - pure validation, no connection
# ---------------------------------------------------------------------

def resolve_database_target(database_url: Optional[str], database_url_env: Optional[str]) -> str:
    """Resolves the raw connection string from EXACTLY one explicit
    source. Never reads DATABASE_URL or TEST_DATABASE_URL, even if a
    caller tries to name one of them via --database-url-env - that name is
    rejected outright."""
    if database_url and database_url_env:
        raise ImportGuardError("specify either --database-url or --database-url-env, not both.")
    if database_url_env:
        if database_url_env in FORBIDDEN_DATABASE_URL_ENV_NAMES:
            raise ImportGuardError(
                f"--database-url-env may not be '{database_url_env}' - this importer never falls "
                "back to the application's own DATABASE_URL/TEST_DATABASE_URL."
            )
        import os
        value = os.environ.get(database_url_env)
        if not value:
            raise ImportGuardError(f"environment variable '{database_url_env}' is not set.")
        return value
    if database_url:
        return database_url
    raise ImportGuardError("no database target supplied: use --database-url or --database-url-env.")


def parse_and_validate_database_target(raw_url: str, expected_database_name: str) -> DatabaseIdentity:
    """Parses the URL far enough to sanity-check it BEFORE any connection
    attempt, and returns only sanitized host/port/database metadata -
    never the raw URL (which may carry a password) and never printed by
    this function itself."""
    if not raw_url or not raw_url.strip():
        raise ImportGuardError("database target is empty.")
    if not expected_database_name or not expected_database_name.strip():
        raise ImportGuardError("--expected-database-name is required.")

    try:
        parsed = urlparse(raw_url)
    except ValueError as error:
        raise ImportGuardError("database target could not be parsed.") from error

    if parsed.scheme not in ("postgres", "postgresql"):
        raise ImportGuardError("database target must be a postgres:// or postgresql:// URL.")

    dbname = (parsed.path or "").lstrip("/")
    if not dbname:
        raise ImportGuardError("database target URL has no database name.")
    if dbname != expected_database_name:
        raise ImportGuardError("database target's own database name does not match --expected-database-name.")
    if not parsed.hostname:
        raise ImportGuardError("database target URL has no host.")

    return DatabaseIdentity(host=parsed.hostname, port=parsed.port, database=dbname)


def build_confirmation_token(expected_total: int, expected_usable: int, expected_excluded: int, expected_skipped_uncertain: int) -> str:
    """Derived only from fixed, non-confidential integer counts - never
    from a hash, an identifier, or any cell content."""
    return f"CONFIRM-{expected_total}-{expected_usable}-{expected_excluded}-{expected_skipped_uncertain}"


def build_expected_deployment_ack(expected_database_name: str) -> str:
    return f"I_CONFIRM_TARGET_{expected_database_name}"


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cdc_review_importer.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--source", required=True, metavar="PATH")
    parser.add_argument("--expected-sha256", required=True, metavar="HEX")
    parser.add_argument("--reviewer-type", required=True, choices=REVIEWER_TYPES)
    parser.add_argument("--reviewer-id", type=int, default=None, metavar="APP_USERS_ID", help="Required (and only valid) for --reviewer-type INTERNAL_USER.")
    parser.add_argument("--external-reviewer-label", default=None, metavar="LABEL", help="Required (and only valid) for --reviewer-type EXTERNAL_HUMAN.")
    parser.add_argument("--imported-by-user-id", type=int, default=None, metavar="APP_USERS_ID", help="Optional, either reviewer type: the internal operator who ran the import, if known.")
    parser.add_argument("--dry-run", action="store_true", help="Default behavior. Always safe.")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Required, in addition to every flag below, to write anything. Never used by this task.",
    )
    parser.add_argument("--expected-total", type=int, default=None)
    parser.add_argument("--expected-usable", type=int, default=None)
    parser.add_argument("--expected-excluded", type=int, default=None)
    parser.add_argument("--expected-skipped-uncertain", type=int, default=None)
    parser.add_argument("--expected-source-sha256", default=None, metavar="HEX")
    parser.add_argument("--confirm-token", default=None, metavar="TOKEN")
    parser.add_argument("--database-url", default=None, metavar="URL")
    parser.add_argument("--database-url-env", default=None, metavar="ENV_VAR_NAME")
    parser.add_argument("--expected-database-name", default=None, metavar="NAME")
    parser.add_argument("--deployment-ack", default=None, metavar="PHRASE")
    return parser


def _reviewer_spec_from_args(args) -> ReviewerSpec:
    return ReviewerSpec(
        reviewer_type=args.reviewer_type,
        reviewer_user_id=args.reviewer_id,
        external_reviewer_label=args.external_reviewer_label,
        imported_by_user_id=args.imported_by_user_id,
    )


def main(argv: Optional["list[str]"] = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    try:
        reviewer = _reviewer_spec_from_args(args)
        validate_reviewer_spec(reviewer)
    except ImportGuardError as error:
        print(f"REVIEWER_SPEC=FAIL: {error}", file=sys.stderr)
        print("DATABASE_ACCESSED=NO")
        print("DRY_RUN_RESULT=FAIL")
        return 1

    source_path = Path(args.source).expanduser()
    if not source_path.is_file():
        print("cdc_review_importer: source workbook not found.", file=sys.stderr)
        return 2

    try:
        candidates, pairs = parse_workbook_for_import(source_path, args.expected_sha256)
        plan = build_import_plan(candidates, pairs)
    except (preview.WorkbookValidationError, ImportPlanError):
        print("IMPORT_PLAN=FAIL")
        print("DATABASE_ACCESSED=NO")
        print("DRY_RUN_RESULT=FAIL")
        return 1

    print("IMPORT_PLAN=PASS")
    print(f"REVIEWER_TYPE={reviewer.reviewer_type}")
    print(f"TOTAL={plan.total}")
    print(f"USABLE={plan.usable}")
    print(f"EXCLUDED={plan.excluded}")
    print(f"SKIPPED_UNCERTAIN={plan.skipped_uncertain}")
    print(f"PLANNED_UPDATES={len(plan.updates)}")

    if not args.execute:
        print("MODE=DRY_RUN")
        print("DATABASE_ACCESSED=NO")
        print("DRY_RUN_RESULT=PASS")
        return 0

    # --execute path. Every guard below runs, and must pass, before any
    # connection is ever opened.
    try:
        missing_flags = [name for name in EXECUTE_REQUIRED_FLAGS if getattr(args, name) is None]
        if missing_flags:
            raise ImportGuardError(f"--execute requires all safety flags; missing: {', '.join(missing_flags)}.")

        if args.expected_source_sha256.lower() != args.expected_sha256.lower():
            raise ImportGuardError("--expected-source-sha256 does not match --expected-sha256.")

        expected_token = build_confirmation_token(
            args.expected_total, args.expected_usable, args.expected_excluded, args.expected_skipped_uncertain
        )
        if args.confirm_token != expected_token:
            raise ImportGuardError("--confirm-token does not match the expected value for the supplied counts.")

        expected_ack = build_expected_deployment_ack(args.expected_database_name)
        if args.deployment_ack != expected_ack:
            raise ImportGuardError("--deployment-ack does not match the expected acknowledgement phrase.")

        # Resolves ONLY the explicitly named dedicated env var (or an
        # explicit --database-url) - never DATABASE_URL/TEST_DATABASE_URL,
        # rejected outright by resolve_database_target() itself.
        raw_target = resolve_database_target(args.database_url, args.database_url_env)
        identity = parse_and_validate_database_target(raw_target, args.expected_database_name)
        print(f"DATABASE_TARGET_HOST={identity.host}")
        print(f"DATABASE_TARGET_NAME={identity.database}")

        expected_counts = {
            "total": args.expected_total,
            "usable": args.expected_usable,
            "excluded": args.expected_excluded,
            "skipped_uncertain": args.expected_skipped_uncertain,
        }
    except ImportGuardError as error:
        print(f"EXECUTE_GUARD=FAIL: {error}", file=sys.stderr)
        print("DATABASE_ACCESSED=NO")
        print("DRY_RUN_RESULT=FAIL")
        return 1

    # Every pre-connection guard passed. Only now is a real connection ever
    # opened, and it is always closed - success or failure - in the
    # finally block below.
    connection_attempted = False
    gateway = None
    try:
        connection_attempted = True
        gateway = PostgresDatabaseGateway(raw_target)
        verified_identity = gateway.verify_target(args.expected_database_name)
        print(f"VERIFIED_DATABASE={verified_identity.database}")

        result = execute_import(gateway, plan, reviewer, expected_counts, source_workbook_sha256=args.expected_sha256)
        print(f"IMPORT_RESULT_STATUS={result['status']}")
        print(f"IMPORT_RESULT_UPDATED={result['updated']}")
        print(f"IMPORT_RESULT_BATCH_ID={result['batch_id']}")
        print("DATABASE_ACCESSED=YES")
        print("EXECUTE_RESULT=PASS")
        return 0
    except ImportGuardError as error:
        # Covers both a target-identity mismatch from verify_target() and
        # any precheck/verification failure raised from inside
        # execute_import() itself - execute_import() has already rolled
        # back its own transaction before this exception ever reaches here.
        print(f"EXECUTE_GUARD=FAIL: {error}", file=sys.stderr)
        print(f"DATABASE_ACCESSED={'YES' if connection_attempted else 'NO'}")
        print("EXECUTE_RESULT=FAIL")
        return 1
    except Exception as error:
        # Never print the raw exception text here: a connection-level
        # failure (bad host, refused, authentication) could otherwise echo
        # back fragments of the connection string on some drivers. Only
        # the exception type name is safe to surface.
        print(f"EXECUTE_FAILED={type(error).__name__}", file=sys.stderr)
        print(f"DATABASE_ACCESSED={'YES' if connection_attempted else 'NO'}")
        print("EXECUTE_RESULT=FAIL")
        return 1
    finally:
        if gateway is not None:
            gateway.close()


if __name__ == "__main__":
    raise SystemExit(main())
