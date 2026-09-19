// Database-free regression tests for the two distinct CDC dashboard stages:
// discovery-time archive inspection and future extraction of the 21 criteria.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const directory = path.join(process.cwd(), "app", "administration", "knowledge");
const summarySource = readFileSync(path.join(directory, "cdc-review-summary.tsx"), "utf8");
const tableSource = readFileSync(path.join(directory, "cdc-candidates-table.tsx"), "utf8");
const pageSource = readFileSync(path.join(directory, "page.tsx"), "utf8");

test("summary names the future extraction stage as the 21 CDC criteria", () => {
  assert.match(summarySource, /label="Extraction des 21 critères"/);
  assert.match(summarySource, /value="Non démarrée"/);
  assert.match(summarySource, /L'extraction des 21 critères CDC n'a pas encore commencé/);
  assert.doesNotMatch(summarySource, /label="Extraction IA"/);
});

test("candidate status is presented as discovery-time initial inspection", () => {
  assert.match(tableSource, /<th>Inspection initiale<\/th>/);
  assert.match(tableSource, /NOT_ATTEMPTED: "Inspection non réalisée"/);
  assert.match(tableSource, /SUCCESS: "Inspection réussie"/);
  assert.match(tableSource, /FAILED: "Inspection échouée"/);
  assert.match(tableSource, /<h4 className="section-title">Inspection initiale<\/h4>/);
  assert.match(tableSource, /Statut d’inspection/);
  assert.match(tableSource, /EXTRACTION_FAILED: "Échec d’inspection initiale"/);
  assert.doesNotMatch(tableSource, /<th>Extraction<\/th>/);
  assert.doesNotMatch(tableSource, /<h4 className="section-title">Extraction IA<\/h4>/);
});

test("page copy keeps initial inspection distinct from the future 21-criteria extraction", () => {
  assert.match(pageSource, /Inspection initiale,\s*validation humaine et extraction des 21 critères/);
  assert.match(pageSource, /Aucune extraction des 21 critères\s*n&apos;est\s*planifiée/);
});
