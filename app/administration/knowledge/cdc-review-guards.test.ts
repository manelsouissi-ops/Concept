// Structural, database-free tests for the CDC human-review dashboard's
// safety guarantees: RBAC gating (page and every server action), read-only
// SQL, and absence of any write action / extraction-trigger control in the
// UI. These assert on source text, the same pattern already used by
// lib/auth/page-gate.test.ts for route-segment gating - no database
// connection, no rendering, no PostgreSQL involved anywhere in this file.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "app", "administration", "knowledge");
const pageSource = readFileSync(path.join(DIR, "page.tsx"), "utf8");
const actionsSource = readFileSync(path.join(DIR, "cdc-review-actions.ts"), "utf8");
const tableSource = readFileSync(path.join(DIR, "cdc-candidates-table.tsx"), "utf8");
const summarySource = readFileSync(path.join(DIR, "cdc-review-summary.tsx"), "utf8");
const batchesSource = readFileSync(path.join(DIR, "cdc-import-batches.tsx"), "utf8");
const ALL_NEW_SOURCES = [pageSource, actionsSource, tableSource, summarySource, batchesSource];

// Several source files correctly DOCUMENT, in comments, that they never
// call Ollama/Docling/n8n/Qdrant - a bare case-insensitive word match
// against the whole file would false-positive on that honest documentation.
// Strip // line comments before scanning for actual usage.
function withoutLineComments(source: string): string {
  return source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

test("page.tsx gates the whole page with requireAreaAccessForPage(\"archive\") before returning JSX", () => {
  assert.match(pageSource, /await requireAreaAccessForPage\(\s*["']archive["']\s*\)/);
  const gateIndex = pageSource.indexOf('requireAreaAccessForPage("archive")');
  const renderIndex = pageSource.indexOf("return (");
  assert.ok(gateIndex >= 0 && renderIndex > gateIndex, "the RBAC gate must run before any JSX is returned");
});

test("no loading.tsx sibling exists for this segment, so the page-level gate above is sufficient (matches lib/auth/page-gate.test.ts's rule)", () => {
  assert.throws(() => readFileSync(path.join(DIR, "loading.tsx"), "utf8"));
});

test("every exported CDC server action re-checks requireAreaAccessForPage(\"archive\") independently, before any query", () => {
  const exportedFunctionNames = [...actionsSource.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
  assert.deepEqual(
    exportedFunctionNames.sort(),
    ["loadCdcCandidateDetail", "loadCdcCandidates", "loadCdcImportBatches", "loadCdcReviewSummary"].sort()
  );

  for (const name of exportedFunctionNames) {
    const start = actionsSource.indexOf(`export async function ${name}(`);
    const nextExportIndex = actionsSource.indexOf("\nexport async function", start + 1);
    const body = actionsSource.slice(start, nextExportIndex === -1 ? actionsSource.length : nextExportIndex);

    const gateIndex = body.indexOf('await requireAreaAccessForPage("archive")');
    assert.ok(gateIndex >= 0, `${name} must call requireAreaAccessForPage("archive")`);

    const firstPoolQueryIndex = body.indexOf(".query(");
    if (firstPoolQueryIndex >= 0) {
      assert.ok(gateIndex < firstPoolQueryIndex, `${name} must authorize before its first query`);
    }
  }
});

test("cdc-review-actions.ts contains no write-capable SQL anywhere", () => {
  // Comments in this file correctly document that there is no write SQL -
  // that documentation itself contains the words INSERT/UPDATE/DELETE/
  // TRUNCATE, so it must be excluded before scanning for actual usage.
  const code = withoutLineComments(actionsSource);
  for (const forbidden of [
    /\binsert\s+into\b/i,
    /\bupdate\s+knowledge_base/i,
    /\bdelete\s+from\b/i,
    /\btruncate\b/i,
    /\bcreate\s+table\b/i,
    /\balter\s+table\b/i,
    /\bdrop\s+table\b/i,
    /\bupsert\b/i
  ]) {
    assert.doesNotMatch(code, forbidden);
  }
  // Every query in this file must be a SELECT.
  const queryBodies = [...actionsSource.matchAll(/\.query(?:<[\s\S]*?>)?\s*\(\s*`([^`]*)`/g)].map((m) => m[1]);
  assert.ok(queryBodies.length >= 4, `expected at least 4 query bodies to check, found ${queryBodies.length}`);
  for (const body of queryBodies) {
    assert.match(body.trim(), /^select\b/i, `every query must start with SELECT: ${body.slice(0, 40)}`);
  }
});

test("no file in the new CDC dashboard actually calls Ollama, Docling, n8n, Qdrant, or opens an archive document (comments documenting their absence are excluded)", () => {
  for (const source of ALL_NEW_SOURCES) {
    const code = withoutLineComments(source);
    for (const forbidden of [
      /ollama/i,
      /docling/i,
      /\bn8n\b/i,
      /qdrant/i,
      /readFile\(/,
      /fs\.readFile/,
      /\.pdf["'`]/i,
      /\.docx?["'`]/i
    ]) {
      assert.doesNotMatch(code, forbidden);
    }
  }
});

test("no mutation form, decision button, or extraction-trigger control exists anywhere in the new CDC dashboard UI", () => {
  for (const source of [pageSource, tableSource, summarySource, batchesSource]) {
    for (const forbidden of [
      />\s*Valider\s*</,
      />\s*Rejeter\s*</,
      />\s*Approuver\s*</,
      />\s*Lancer l'extraction\s*</i,
      />\s*Demarrer l'extraction\s*</i,
      /type="submit"/,
      /reviewArchiveFileClassification/,
      /onClick=\{[^}]*update/i,
      /onClick=\{[^}]*delete/i,
      /onClick=\{[^}]*insert/i
    ]) {
      assert.doesNotMatch(source, forbidden);
    }
  }
});

test("no download link or absolute filesystem path field is rendered anywhere in the candidate table/detail view", () => {
  assert.doesNotMatch(tableSource, /download=/);
  assert.doesNotMatch(tableSource, /relative_path/);
  assert.doesNotMatch(tableSource, /\bfilename\b/i);
});

test("the page shows a visible read-only indicator", () => {
  assert.match(pageSource, /LECTURE SEULE/);
});
