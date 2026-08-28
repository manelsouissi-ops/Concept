import hashlib
import importlib.util
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("scan_archive", HERE / "scan_archive.py")
scanner = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = scanner
SPEC.loader.exec_module(scanner)

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
HAS_DATABASE = bool(DATABASE_URL)

try:
    import psycopg
except ImportError:
    psycopg = None


def connect():
    return psycopg.connect(DATABASE_URL)


@unittest.skipUnless(HAS_DATABASE and psycopg is not None, "DATABASE_URL is not configured.")
class ScanArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory(prefix="archive-cartography-test-")
        self.root = Path(self.tmpdir.name)
        self.conn = connect()
        # A unique label per test run keeps each test's source_root_id
        # isolated even though root_path itself changes per tempdir anyway.
        self.source_root_id = None

    def tearDown(self):
        if self.source_root_id is not None:
            with self.conn.cursor() as cur:
                cur.execute(
                    "delete from knowledge_base.archive_source_roots where id = %s",
                    (self.source_root_id,),
                )
            self.conn.commit()
        self.conn.close()
        self.tmpdir.cleanup()

    def get_root_id(self):
        self.source_root_id = scanner.get_or_create_source_root(self.conn, str(self.root), "test")
        return self.source_root_id

    def write(self, relative: str, content: bytes) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def fetch_file_row(self, root_id: int, relative_path: str):
        with self.conn.cursor() as cur:
            cur.execute(
                """
                select id, sha256, size_bytes, discovery_status, error_message
                from knowledge_base.archive_files
                where source_root_id = %s and relative_path = %s
                """,
                (root_id, relative_path),
            )
            return cur.fetchone()

    # -----------------------------------------------------------------
    # STREAMING SHA256
    # -----------------------------------------------------------------

    def test_sha256_file_streams_correctly_across_multiple_chunks(self):
        content = os.urandom(scanner.HASH_CHUNK_SIZE * 2 + 1234)  # forces 3 read iterations
        path = self.write("big-file.bin", content)
        digest, size = scanner.sha256_file(path)
        self.assertEqual(digest, hashlib.sha256(content).hexdigest())
        self.assertEqual(size, len(content))

    def test_empty_file_hashes_to_the_well_known_empty_sha256(self):
        path = self.write("empty.txt", b"")
        digest, size = scanner.sha256_file(path)
        self.assertEqual(digest, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        self.assertEqual(size, 0)

    # -----------------------------------------------------------------
    # STABLE FILE IDENTITY / DB UPSERT / IDEMPOTENT RESCAN
    # -----------------------------------------------------------------

    def test_rescanning_unchanged_files_is_idempotent_and_does_not_duplicate_rows(self):
        self.write("a.txt", b"hello world")
        self.write("sub/b.txt", b"another file")
        root_id = self.get_root_id()

        tally1, _ = scanner.scan_directory(self.conn, root_id, self.root)
        self.assertEqual(tally1.files_new, 2)
        self.assertEqual(tally1.files_unchanged, 0)

        row_a_first = self.fetch_file_row(root_id, "a.txt")

        tally2, _ = scanner.scan_directory(self.conn, root_id, self.root)
        self.assertEqual(tally2.files_new, 0)
        self.assertEqual(tally2.files_unchanged, 2)
        self.assertEqual(tally2.files_changed, 0)

        row_a_second = self.fetch_file_row(root_id, "a.txt")
        # Same stable identity (same row id) across rescans - no duplicate row.
        self.assertEqual(row_a_first[0], row_a_second[0])

        with self.conn.cursor() as cur:
            cur.execute(
                "select count(*) from knowledge_base.archive_files where source_root_id = %s",
                (root_id,),
            )
            self.assertEqual(cur.fetchone()[0], 2)

    def test_changed_file_content_is_detected_and_updates_the_same_row(self):
        path = self.write("changeable.txt", b"version one")
        root_id = self.get_root_id()
        scanner.scan_directory(self.conn, root_id, self.root)
        row_before = self.fetch_file_row(root_id, "changeable.txt")

        path.write_bytes(b"version two, materially different content")
        tally, _ = scanner.scan_directory(self.conn, root_id, self.root)

        self.assertEqual(tally.files_new, 0)
        self.assertEqual(tally.files_changed, 1)
        row_after = self.fetch_file_row(root_id, "changeable.txt")
        self.assertEqual(row_before[0], row_after[0], "must update the same row, not insert a new one")
        self.assertNotEqual(row_before[1], row_after[1], "sha256 must reflect the new content")

    # -----------------------------------------------------------------
    # DUPLICATE DETECTION
    # -----------------------------------------------------------------

    def test_duplicate_content_across_two_files_is_detected_with_distinct_identities(self):
        self.write("original.txt", b"identical content for dedup test")
        self.write("copy.txt", b"identical content for dedup test")
        self.write("different.txt", b"not the same content at all")
        root_id = self.get_root_id()

        _, duplicate_files = scanner.scan_directory(self.conn, root_id, self.root)
        self.assertEqual(duplicate_files, 2)  # both copies count, not just the "extra" one

        row_original = self.fetch_file_row(root_id, "original.txt")
        row_copy = self.fetch_file_row(root_id, "copy.txt")
        self.assertEqual(row_original[1], row_copy[1])  # same sha256
        self.assertNotEqual(row_original[0], row_copy[0])  # distinct file identity/row

    # -----------------------------------------------------------------
    # SAME FILENAME IN DIFFERENT FOLDERS
    # -----------------------------------------------------------------

    def test_same_filename_in_different_folders_are_cataloged_separately(self):
        self.write("dir-a/notes.txt", b"notes from a")
        self.write("dir-b/notes.txt", b"notes from b")
        root_id = self.get_root_id()

        tally, _ = scanner.scan_directory(self.conn, root_id, self.root)
        self.assertEqual(tally.files_new, 2)

        row_a = self.fetch_file_row(root_id, "dir-a/notes.txt")
        row_b = self.fetch_file_row(root_id, "dir-b/notes.txt")
        self.assertIsNotNone(row_a)
        self.assertIsNotNone(row_b)
        self.assertNotEqual(row_a[0], row_b[0])

    # -----------------------------------------------------------------
    # UNICODE / SPACES / APOSTROPHES
    # -----------------------------------------------------------------

    def test_unicode_and_special_character_filenames_are_cataloged_correctly(self):
        self.write("résumé projet été.txt", b"unicode filename content")
        self.write("it's a report (draft).txt", b"apostrophe and parens content")
        root_id = self.get_root_id()

        tally, _ = scanner.scan_directory(self.conn, root_id, self.root)
        self.assertEqual(tally.files_failed, 0)
        self.assertEqual(tally.files_new, 2)

        row_unicode = self.fetch_file_row(root_id, "résumé projet été.txt")
        row_apostrophe = self.fetch_file_row(root_id, "it's a report (draft).txt")
        self.assertIsNotNone(row_unicode)
        self.assertIsNotNone(row_apostrophe)
        self.assertEqual(row_unicode[3], "hashed")
        self.assertEqual(row_apostrophe[3], "hashed")

    # -----------------------------------------------------------------
    # NESTED FOLDERS
    # -----------------------------------------------------------------

    def test_deeply_nested_folders_are_traversed_with_correct_relative_paths(self):
        self.write("a/b/c/d/deep-file.txt", b"deep content")
        root_id = self.get_root_id()

        tally, _ = scanner.scan_directory(self.conn, root_id, self.root)
        self.assertEqual(tally.files_new, 1)

        row = self.fetch_file_row(root_id, "a/b/c/d/deep-file.txt")
        self.assertIsNotNone(row)

    # -----------------------------------------------------------------
    # ONE-FILE FAILURE ISOLATION
    # -----------------------------------------------------------------

    def test_one_unreadable_file_does_not_abort_the_batch(self):
        if os.geteuid() == 0:
            self.skipTest("Running as root: chmod-based unreadable-file simulation would not actually block reads.")

        good_path = self.write("good.txt", b"this one is fine")
        bad_path = self.write("bad.txt", b"this one will be made unreadable")
        bad_path.chmod(0o000)
        try:
            root_id = self.get_root_id()
            tally, _ = scanner.scan_directory(self.conn, root_id, self.root)

            self.assertEqual(tally.files_seen, 2)
            self.assertEqual(tally.files_failed, 1)
            self.assertEqual(tally.files_new, 1)  # only good.txt succeeded

            row_good = self.fetch_file_row(root_id, "good.txt")
            row_bad = self.fetch_file_row(root_id, "bad.txt")
            self.assertEqual(row_good[3], "hashed")
            self.assertEqual(row_bad[3], "failed")
            self.assertIsNotNone(row_bad[4])  # error_message populated
        finally:
            bad_path.chmod(0o644)  # restore so tempdir cleanup can remove it

    # -----------------------------------------------------------------
    # NO SOURCE MODIFICATION
    # -----------------------------------------------------------------

    def test_scanning_never_modifies_the_source_files(self):
        path = self.write("untouched.txt", b"must not be modified by the scanner")
        before_stat = path.stat()
        before_mode = before_stat.st_mode
        before_mtime = before_stat.st_mtime
        before_content = path.read_bytes()

        root_id = self.get_root_id()
        scanner.scan_directory(self.conn, root_id, self.root)

        after_stat = path.stat()
        self.assertEqual(before_mode, after_stat.st_mode)
        self.assertEqual(before_mtime, after_stat.st_mtime)
        self.assertEqual(before_content, path.read_bytes())

    # -----------------------------------------------------------------
    # SYMLINK CONTAINMENT
    # -----------------------------------------------------------------

    def test_symlink_pointing_outside_root_is_not_traversed(self):
        """Test that directory symlinks pointing outside root are skipped"""
        self.write("good-file.txt", b"content")
        
        # Create a symlink to an external directory (outside our root)
        external_dir = Path("/tmp") 
        symlink_path = self.root / "symlink-to-external"
        symlink_path.symlink_to(external_dir)
        
        root_id = self.get_root_id()
        tally, _ = scanner.scan_directory(self.conn, root_id, self.root)
        
        # Should have detected the broken symlink and skipped it
        self.assertEqual(tally.files_seen, 1)  # Only our good file is scanned
        self.assertEqual(tally.files_failed, 1)  # The symlink was skipped with an error

    def test_file_symlink_pointing_outside_root_is_not_hashed(self):
        """Test that file symlinks pointing outside root are not hashed"""
        self.write("good-file.txt", b"content")
        
        # Create a symlink to an external file (outside our root)  
        external_file = Path("/etc/passwd")
        symlink_path = self.root / "symlink-to-external-file"
        symlink_path.symlink_to(external_file)
        
        root_id = self.get_root_id()
        tally, _ = scanner.scan_directory(self.conn, root_id, self.root)
        
        # Should have detected the broken symlink and skipped it
        self.assertEqual(tally.files_seen, 1)  # Only our good file is scanned
        self.assertEqual(tally.files_failed, 1)  # The symlink was skipped with an error

    def test_broken_symlink_does_not_crash_scan(self):
        """Test that broken symlinks do not crash the scan"""
        self.write("good-file.txt", b"content")
        
        # Create a broken symlink
        symlink_path = self.root / "broken-symlink"
        symlink_path.symlink_to("/nonexistent/path")
        
        root_id = self.get_root_id()
        tally, _ = scanner.scan_directory(self.conn, root_id, self.root)
        
        # Should have detected the broken symlink and skipped it 
        self.assertEqual(tally.files_seen, 1)  # Only our good file is scanned
        self.assertEqual(tally.files_failed, 1)  # The broken symlink was skipped with an error

    def test_normal_nested_files_still_work(self):
        """Test that ordinary nested files still work"""
        self.write("a/b/c/deep-file.txt", b"deep content")
        root_id = self.get_root_id()

        tally, _ = scanner.scan_directory(self.conn, root_id, self.root)
        self.assertEqual(tally.files_new, 1)

        row = self.fetch_file_row(root_id, "a/b/c/deep-file.txt")
        self.assertIsNotNone(row)

    # -----------------------------------------------------------------
    # RUN SUMMARY / REPORT CALCULATIONS
    # -----------------------------------------------------------------

    def test_scan_run_row_and_report_reflect_accurate_tallies(self):
        self.write("report/one.txt", b"AAAA")
        self.write("report/two.txt", b"BBBB")
        self.write("report/dup-a.txt", b"same content")
        self.write("report/dup-b.txt", b"same content")
        root_id = self.get_root_id()

        run_id = scanner.start_scan_run(self.conn, root_id)
        tally, duplicate_files = scanner.scan_directory(self.conn, root_id, self.root)
        scanner.finish_scan_run(self.conn, run_id, tally, duplicate_files, "completed")

        with self.conn.cursor() as cur:
            cur.execute(
                """
                select status, files_seen, files_new, files_failed, total_bytes, duplicate_files, completed_at
                from knowledge_base.archive_scan_runs where id = %s
                """,
                (run_id,),
            )
            run_row = cur.fetchone()

        self.assertEqual(run_row[0], "completed")
        self.assertEqual(run_row[1], 4)
        self.assertEqual(run_row[2], 4)
        self.assertEqual(run_row[3], 0)
        self.assertEqual(run_row[4], len(b"AAAA") + len(b"BBBB") + len(b"same content") * 2)
        self.assertEqual(run_row[5], 2)
        self.assertIsNotNone(run_row[6])

        report = scanner.build_report(self.conn, root_id)
        self.assertEqual(report["total_files"], 4)
        self.assertEqual(report["unique_hashes"], 3)
        self.assertEqual(report["duplicate_files"], 2)
        self.assertEqual(report["failed_files"], 0)
        # Test that extensions are displayed without revealing full paths
        self.assertIn("txt", report["files_by_extension"])
        self.assertEqual(len(report["files_by_extension"]), 1)  # only txt files
        # Test that top_level_folder_counts no longer reveals individual folder names 
        # (implementation details of what to assert here)


if __name__ == "__main__":
    unittest.main()
