import test from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs } from "./backfill_technical_buckets.ts";

// Pure CLI-argument parsing only - no database, no filesystem, no AI.
// Importing this module does NOT connect to any database: main() only runs
// when the file is executed directly (see the import.meta.url guard at the
// bottom of backfill_technical_buckets.ts), never on import.

test("defaults to batch size 500 and dry-run disabled", () => {
  const options = parseCliArgs([]);
  assert.equal(options.dryRun, false);
  assert.equal(options.batchSize, 500);
});

test("--dry-run enables dry-run mode", () => {
  const options = parseCliArgs(["--dry-run"]);
  assert.equal(options.dryRun, true);
});

test("--batch-size <n> sets a custom batch size", () => {
  const options = parseCliArgs(["--batch-size", "250"]);
  assert.equal(options.batchSize, 250);
});

test("--batch-size=<n> form is also accepted", () => {
  const options = parseCliArgs(["--batch-size=100"]);
  assert.equal(options.batchSize, 100);
});

test("--dry-run and --batch-size can be combined in either order", () => {
  assert.equal(parseCliArgs(["--dry-run", "--batch-size", "10"]).batchSize, 10);
  assert.equal(parseCliArgs(["--batch-size", "10", "--dry-run"]).dryRun, true);
});

test("a non-numeric --batch-size value throws rather than silently defaulting", () => {
  assert.throws(() => parseCliArgs(["--batch-size", "not-a-number"]));
});

test("a zero or negative --batch-size value throws", () => {
  assert.throws(() => parseCliArgs(["--batch-size", "0"]));
  assert.throws(() => parseCliArgs(["--batch-size", "-5"]));
});
