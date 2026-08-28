#!/usr/bin/env python3
"""Archive Cartography V1: read-only filesystem scan + catalog into Postgres.

Phase 1 only. No document-content analysis, no AI, no classification.
See docs/ARCHIVE_CARTOGRAPHY_V1.md for the full design and safety guarantees.

Usage:
    .venv-archive-cartography/bin/python scan_archive.py --source-root /path/to/dir [--label "some label"]
    .venv-archive-cartography/bin/python scan_archive.py --source-root /path/to/dir --report-only

Reads DATABASE_URL from the environment (same convention as the rest of the
application). Requires an explicit --source-root every time - there is no
env-var default that could silently point at the wrong directory.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import psycopg

HASH_CHUNK_SIZE = 1024 * 1024  # 1 MiB, matches services/knowledge-base/service.py's sha256_file convention


@dataclass
class ScanTally:
    files_seen: int = 0
    files_new: int = 0
    files_unchanged: int = 0
    files_changed: int = 0
    files_failed: int = 0
    total_bytes: int = 0
    errors: list[str] = field(default_factory=list)


def sha256_file(path: Path) -> tuple[str, int]:
    """Streams the file in fixed-size chunks; never loads it fully into
    memory, so this is safe for multi-GB files (Step 6)."""
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(HASH_CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def relative_parent_folder(relative_path: Path) -> str:
    parent = relative_path.parent
    return "." if str(parent) in ("", ".") else str(parent)


def get_or_create_source_root(conn: psycopg.Connection, root_path: str, label: Optional[str]) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into knowledge_base.archive_source_roots (root_path, label)
            values (%s, %s)
            on conflict (root_path) do update set label = coalesce(excluded.label, knowledge_base.archive_source_roots.label)
            returning id
            """,
            (root_path, label),
        )
        row = cur.fetchone()
        conn.commit()
        return row[0]


def start_scan_run(conn: psycopg.Connection, source_root_id: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into knowledge_base.archive_scan_runs (source_root_id, status)
            values (%s, 'running')
            returning id
            """,
            (source_root_id,),
        )
        row = cur.fetchone()
        conn.commit()
        return row[0]


def finish_scan_run(conn: psycopg.Connection, run_id: int, tally: ScanTally, duplicate_files: int, status: str, error_message: Optional[str] = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            update knowledge_base.archive_scan_runs set
              status = %s,
              completed_at = now(),
              files_seen = %s,
              files_new = %s,
              files_unchanged = %s,
              files_changed = %s,
              files_failed = %s,
              total_bytes = %s,
              duplicate_files = %s,
              error_message = %s
            where id = %s
            """,
            (
                status,
                tally.files_seen,
                tally.files_new,
                tally.files_unchanged,
                tally.files_changed,
                tally.files_failed,
                tally.total_bytes,
                duplicate_files,
                error_message,
                run_id,
            ),
        )
        conn.commit()


def upsert_file_hashed(
    conn: psycopg.Connection,
    source_root_id: int,
    relative_path: str,
    filename: str,
    extension: Optional[str],
    parent_folder: str,
    size_bytes: int,
    modified_at: Optional[datetime],
    sha256: str,
) -> str:
    """Returns 'new', 'unchanged', or 'changed' relative to any existing row."""
    with conn.cursor() as cur:
        cur.execute(
            "select sha256, size_bytes from knowledge_base.archive_files where source_root_id = %s and relative_path = %s",
            (source_root_id, relative_path),
        )
        existing = cur.fetchone()

        cur.execute(
            """
            insert into knowledge_base.archive_files
              (source_root_id, relative_path, filename, extension, parent_folder, size_bytes, modified_at,
               sha256, discovery_status, error_message, last_seen_at, updated_at)
            values (%s, %s, %s, %s, %s, %s, %s, %s, 'hashed', null, now(), now())
            on conflict (source_root_id, relative_path) do update set
              filename = excluded.filename,
              extension = excluded.extension,
              parent_folder = excluded.parent_folder,
              size_bytes = excluded.size_bytes,
              modified_at = excluded.modified_at,
              sha256 = excluded.sha256,
              discovery_status = 'hashed',
              error_message = null,
              last_seen_at = now(),
              updated_at = case
                when knowledge_base.archive_files.sha256 is distinct from excluded.sha256
                  or knowledge_base.archive_files.size_bytes is distinct from excluded.size_bytes
                then now()
                else knowledge_base.archive_files.updated_at
              end
            """,
            (source_root_id, relative_path, filename, extension, parent_folder, size_bytes, modified_at, sha256),
        )
        conn.commit()

        if existing is None:
            return "new"
        existing_sha256, existing_size = existing
        if existing_sha256 == sha256 and existing_size == size_bytes:
            return "unchanged"
        return "changed"


def upsert_file_failed(
    conn: psycopg.Connection,
    source_root_id: int,
    relative_path: str,
    filename: str,
    extension: Optional[str],
    parent_folder: str,
    size_bytes: Optional[int],
    modified_at: Optional[datetime],
    error_message: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into knowledge_base.archive_files
              (source_root_id, relative_path, filename, extension, parent_folder, size_bytes, modified_at,
               sha256, discovery_status, error_message, last_seen_at, updated_at)
            values (%s, %s, %s, %s, %s, %s, %s, null, 'failed', %s, now(), now())
            on conflict (source_root_id, relative_path) do update set
              filename = excluded.filename,
              extension = excluded.extension,
              parent_folder = excluded.parent_folder,
              size_bytes = coalesce(excluded.size_bytes, knowledge_base.archive_files.size_bytes),
              modified_at = coalesce(excluded.modified_at, knowledge_base.archive_files.modified_at),
              discovery_status = 'failed',
              error_message = excluded.error_message,
              last_seen_at = now(),
              updated_at = now()
            """,
            (source_root_id, relative_path, filename, extension, parent_folder, size_bytes or 0, modified_at, error_message),
        )
        conn.commit()


def scan_directory(conn: psycopg.Connection, source_root_id: int, root: Path) -> tuple[ScanTally, int]:
    tally = ScanTally()

    def on_walk_error(err: OSError) -> None:
        # A directory-level error (e.g. permission denied on one subfolder)
        # must not abort the whole scan (Step 4/6) - record and continue.
        tally.files_failed += 1
        tally.errors.append(f"walk error at {err.filename}: {err}")

    for dirpath, dirnames, filenames in os.walk(root, onerror=on_walk_error, followlinks=False):
        # Check if directory is a symlink that points outside the root - skip it
        current_dir = Path(dirpath)
        if current_dir.is_symlink():
            try:
                target = current_dir.resolve()
                if not target.is_relative_to(root):
                    tally.files_failed += 1
                    tally.errors.append(f"skipped symlink outside source-root: {current_dir}")
                    continue
            except OSError:
                tally.files_failed += 1
                tally.errors.append(f"broken symlink encountered: {current_dir}")
                continue
        
        dirnames.sort(key=str.casefold)
        for name in sorted(filenames, key=str.casefold):
            full_path = Path(dirpath) / name
            relative_path = full_path.relative_to(root)
            relative_path_str = str(relative_path)
            parent_folder = relative_parent_folder(relative_path)
            extension = full_path.suffix.casefold().lstrip(".") or None

            tally.files_seen += 1

            # Check if file is a symlink that points outside the root - skip it
            if full_path.is_symlink():
                try:
                    target = full_path.resolve()
                    if not target.is_relative_to(root):
                        tally.files_failed += 1
                        tally.errors.append(f"skipped symlink outside source-root: {full_path}")
                        continue
                except OSError:
                    tally.files_failed += 1
                    tally.errors.append(f"broken symlink encountered: {full_path}")
                    continue

            try:
                stat_result = full_path.stat()
                size_bytes = stat_result.st_size
                modified_at = datetime.fromtimestamp(stat_result.st_mtime, tz=timezone.utc)
            except OSError as error:
                tally.files_failed += 1
                tally.errors.append(f"{relative_path_str}: stat failed: {error}")
                upsert_file_failed(
                    conn, source_root_id, relative_path_str, name, extension, parent_folder,
                    None, None, f"stat failed: {error}"
                )
                continue

            try:
                sha256, hashed_size = sha256_file(full_path)
            except OSError as error:
                tally.files_failed += 1
                tally.errors.append(f"{relative_path_str}: hash failed: {error}")
                upsert_file_failed(
                    conn, source_root_id, relative_path_str, name, extension, parent_folder,
                    size_bytes, modified_at, f"hash failed: {error}"
                )
                continue

            outcome = upsert_file_hashed(
                conn, source_root_id, relative_path_str, name, extension, parent_folder,
                hashed_size, modified_at, sha256
            )
            tally.total_bytes += hashed_size
            if outcome == "new":
                tally.files_new += 1
            elif outcome == "unchanged":
                tally.files_unchanged += 1
            else:
                tally.files_changed += 1

    return tally, count_duplicate_files(conn, source_root_id)


def count_duplicate_files(conn: psycopg.Connection, source_root_id: int) -> int:
    """Every file that belongs to a hash group with more than one member
    (i.e. all copies, not just the extras beyond the first)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select count(*) from knowledge_base.archive_files
            where source_root_id = %s
              and sha256 in (
                select sha256 from knowledge_base.archive_files
                where source_root_id = %s and sha256 is not null
                group by sha256
                having count(*) > 1
              )
            """,
            (source_root_id, source_root_id),
        )
        return cur.fetchone()[0]


def build_report(conn: psycopg.Connection, source_root_id: int) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            "select count(*), coalesce(sum(size_bytes), 0) from knowledge_base.archive_files where source_root_id = %s",
            (source_root_id,),
        )
        total_files, total_bytes = cur.fetchone()

        cur.execute(
            """
            select coalesce(extension, '(none)'), count(*) from knowledge_base.archive_files
            where source_root_id = %s group by extension order by count(*) desc
            """,
            (source_root_id,),
        )
        files_by_extension = {row[0]: row[1] for row in cur.fetchall()}

        cur.execute(
            "select count(distinct sha256) from knowledge_base.archive_files where source_root_id = %s and sha256 is not null",
            (source_root_id,),
        )
        unique_hashes = cur.fetchone()[0]

        cur.execute(
            "select count(*) from knowledge_base.archive_files where source_root_id = %s and discovery_status = 'failed'",
            (source_root_id,),
        )
        failed_files = cur.fetchone()[0]

        cur.execute(
            """
            select split_part(relative_path, '/', 1) as top_level, count(*)
            from knowledge_base.archive_files where source_root_id = %s
            group by top_level order by count(*) desc
            """,
            (source_root_id,),
        )
        top_level_folder_counts = {row[0]: row[1] for row in cur.fetchall()}

    duplicate_files = count_duplicate_files(conn, source_root_id)

    return {
        "total_files": total_files,
        "total_bytes": total_bytes,
        "files_by_extension": files_by_extension,
        "unique_hashes": unique_hashes,
        "duplicate_files": duplicate_files,
        "failed_files": failed_files,
        "top_level_folder_counts": top_level_folder_counts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", required=True, help="Directory to scan (read-only).")
    parser.add_argument("--label", default=None, help="Optional human label for this source root.")
    parser.add_argument("--report-only", action="store_true", help="Skip scanning; print the aggregate report for an already-scanned root.")
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required.", file=sys.stderr)
        return 1

    root = Path(args.source_root).expanduser().resolve(strict=True)
    if not root.is_dir():
        print(f"--source-root must be a directory: {root}", file=sys.stderr)
        return 1

    with psycopg.connect(database_url) as conn:
        source_root_id = get_or_create_source_root(conn, str(root), args.label)

        if args.report_only:
            report = build_report(conn, source_root_id)
            print_report(str(root), report)
            return 0

        run_id = start_scan_run(conn, source_root_id)
        try:
            tally, duplicate_files = scan_directory(conn, source_root_id, root)
        except Exception as error:  # a fatal, non-per-file error (e.g. root vanished mid-scan)
            finish_scan_run(conn, run_id, ScanTally(), 0, "failed", str(error))
            print(f"Scan run {run_id} failed: {error}", file=sys.stderr)
            return 1

        finish_scan_run(conn, run_id, tally, duplicate_files, "completed")

        print(f"Scan run {run_id} completed.")
        print(
            f"  seen={tally.files_seen} new={tally.files_new} unchanged={tally.files_unchanged} "
            f"changed={tally.files_changed} failed={tally.files_failed} total_bytes={tally.total_bytes} "
            f"duplicate_files={duplicate_files}"
        )
        if tally.errors:
            print("  errors:")
            for message in tally.errors:
                print(f"    - {message}")

        report = build_report(conn, source_root_id)
        print_report(str(root), report)

    return 0


def print_report(root: str, report: dict) -> None:
    # Confidential output protection: only show aggregate stats, not individual paths/filenames
    print(f"\nArchive cartography report for {root}:")
    print(f"  total_files            = {report['total_files']}")
    print(f"  total_bytes             = {report['total_bytes']}")
    print(f"  unique_hashes           = {report['unique_hashes']}")
    print(f"  duplicate_files         = {report['duplicate_files']}")
    print(f"  failed_files            = {report['failed_files']}")
    # Show extension counts but hide individual file paths - display as dict of extension -> count
    extensions_display = {ext: count for ext, count in report['files_by_extension'].items()}
    print(f"  files_by_extension      = {extensions_display}")
    # Hide top_level_folder_counts to prevent revelation of directory structure
    print("  top_level_folder_counts = <hidden - aggregate counts only, no individual paths revealed>")


if __name__ == "__main__":
    raise SystemExit(main())
