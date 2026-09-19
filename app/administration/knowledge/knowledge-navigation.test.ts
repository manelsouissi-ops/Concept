// Database-free regression tests for the URL-backed knowledge-base views.
// They inspect the server-page structure so neither archive nor CDC loaders
// are invoked while these tests run.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveKnowledgeView } from "./knowledge-view.ts";

const knowledgeDir = path.join(process.cwd(), "app", "administration", "knowledge");
const pageSource = readFileSync(path.join(knowledgeDir, "page.tsx"), "utf8");
const tabsSource = readFileSync(path.join(knowledgeDir, "knowledge-view-tabs.tsx"), "utf8");
const navigationSource = readFileSync(
  path.join(process.cwd(), "lib", "administration", "navigation.ts"),
  "utf8"
);

test("knowledge view defaults to CDC when the view parameter is absent", () => {
  assert.equal(resolveKnowledgeView(undefined), "cdc");
});

test("knowledge view selects CDC explicitly", () => {
  assert.equal(resolveKnowledgeView("cdc"), "cdc");
});

test("knowledge view selects archives explicitly", () => {
  assert.equal(resolveKnowledgeView("archives"), "archives");
});

test("unknown knowledge views fall back to CDC", () => {
  assert.equal(resolveKnowledgeView("unknown"), "cdc");
  assert.equal(resolveKnowledgeView(["archives"]), "cdc");
});

test("tabs use shareable URLs and visually identify the active view", () => {
  assert.match(tabsSource, /href=\{`\/administration\/knowledge\?view=\$\{tab\.key\}`\}/);
  assert.match(tabsSource, /aria-selected=\{active === tab\.key\}/);
  assert.match(tabsSource, /tab-button active/);
  assert.match(tabsSource, /CDC validés/);
  assert.match(tabsSource, /Cartographie des archives/);
});

test("page resolves the URL after the RBAC gate and renders exactly one view", () => {
  const gateIndex = pageSource.indexOf('await requireAreaAccessForPage("archive")');
  const resolveIndex = pageSource.indexOf("resolveKnowledgeView(");
  const branchIndex = pageSource.indexOf('{view === "cdc" ? <CdcView /> : <ArchivesView />}');

  assert.ok(gateIndex >= 0 && gateIndex < resolveIndex, "RBAC must run before view resolution or data loading");
  assert.ok(branchIndex >= 0, "the page must select one view rather than render both");
});

test("CDC and archive loaders are isolated to their selected server view", () => {
  const cdcStart = pageSource.indexOf("async function CdcView()");
  const archivesStart = pageSource.indexOf("async function ArchivesView()");
  const cdcSource = pageSource.slice(cdcStart, archivesStart);
  const archivesSource = pageSource.slice(archivesStart);

  assert.ok(cdcStart >= 0 && archivesStart > cdcStart, "expected separate CDC and archive server views");
  assert.match(cdcSource, /loadCdcReviewSummary\(\)/);
  assert.match(cdcSource, /loadCdcImportBatches\(\)/);
  assert.doesNotMatch(cdcSource, /loadArchiveSummary\(|loadArchiveScanRuns\(|loadExtensionOptions\(/);
  assert.match(archivesSource, /loadArchiveSummary\(\)/);
  assert.match(archivesSource, /loadArchiveScanRuns\(\)/);
  assert.match(archivesSource, /loadExtensionOptions\(\)/);
  assert.doesNotMatch(archivesSource, /loadCdcReviewSummary\(|loadCdcImportBatches\(/);
});

test("knowledge page presents the requested title, description, and read-only indicator", () => {
  assert.match(pageSource, /Base de connaissances CDC & Archives/);
  assert.match(pageSource, /Suivi des CDC validés, de l’extraction locale de leurs 21 critères et de la cartographie des archives historiques\./);
  assert.match(pageSource, /LECTURE SEULE/);
});

test("sidebar uses CDC & Archives and no longer exposes the old label", () => {
  assert.match(navigationSource, /label: "CDC & Archives"/);
  assert.doesNotMatch(navigationSource, /label: "Archive Cartography"/);
});
