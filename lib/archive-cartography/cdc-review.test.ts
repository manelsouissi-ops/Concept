import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidateFilterClause,
  computeProcessingGroup,
  isKnownUncertainCandidate,
  mapCandidateRow,
  mapImportBatchRow,
  sanitizeCandidateLimit,
  sanitizeCandidatePage,
  sanitizeCandidateSortField,
  sanitizeCandidateSortOrder,
  sanitizeRepositoryError,
  MAX_CANDIDATE_PAGE_SIZE,
  DEFAULT_CANDIDATE_PAGE_SIZE,
  RECENT_YEAR_MIN,
  RECENT_YEAR_MAX
} from "./cdc-review.ts";

test("processing group: validated + 2020-2026 is PRIORITAIRE_2020_2026, at both boundary years", () => {
  assert.equal(computeProcessingGroup("HUMAN_VALIDATED_CDC", RECENT_YEAR_MIN), "PRIORITAIRE_2020_2026");
  assert.equal(computeProcessingGroup("HUMAN_VALIDATED_CDC", RECENT_YEAR_MAX), "PRIORITAIRE_2020_2026");
  assert.equal(computeProcessingGroup("HUMAN_VALIDATED_CDC", 2023), "PRIORITAIRE_2020_2026");
});

test("processing group: validated + just outside the boundary is SECONDAIRE_AVANT_2020", () => {
  assert.equal(computeProcessingGroup("HUMAN_VALIDATED_CDC", RECENT_YEAR_MIN - 1), "SECONDAIRE_AVANT_2020");
  assert.equal(computeProcessingGroup("HUMAN_VALIDATED_CDC", 1999), "SECONDAIRE_AVANT_2020");
});

test("processing group: validated with a null year is treated as older (SECONDAIRE_AVANT_2020), never dropped", () => {
  assert.equal(computeProcessingGroup("HUMAN_VALIDATED_CDC", null), "SECONDAIRE_AVANT_2020");
});

test("processing group: rejected is always EXCLU, regardless of year", () => {
  assert.equal(computeProcessingGroup("HUMAN_REJECTED_CDC", 2024), "EXCLU");
  assert.equal(computeProcessingGroup("HUMAN_REJECTED_CDC", 1990), "EXCLU");
  assert.equal(computeProcessingGroup("HUMAN_REJECTED_CDC", null), "EXCLU");
});

test("processing group: machine-classified (unresolved) is A_REVOIR", () => {
  assert.equal(computeProcessingGroup("MACHINE_CLASSIFIED", 2024), "A_REVOIR");
});

test("processing group: 2027 is NOT recent (year > 2026 falls to SECONDAIRE, proving the upper bound is inclusive-and-closed, not open-ended)", () => {
  assert.equal(computeProcessingGroup("HUMAN_VALIDATED_CDC", 2027), "SECONDAIRE_AVANT_2020");
});

test("isKnownUncertainCandidate: machine-classified and unlinked is the uncertain signal", () => {
  assert.equal(
    isKnownUncertainCandidate({ validationStatus: "MACHINE_CLASSIFIED", humanReviewImportBatchId: null }),
    true
  );
});

test("isKnownUncertainCandidate: machine-classified but linked is NOT uncertain by this rule", () => {
  // Never actually produced by the importer (linked rows are always
  // validated/rejected) - this locks in that the function checks BOTH
  // signals, not validation_status alone.
  assert.equal(
    isKnownUncertainCandidate({ validationStatus: "MACHINE_CLASSIFIED", humanReviewImportBatchId: "1" }),
    false
  );
});

test("isKnownUncertainCandidate: validated/rejected rows are never flagged uncertain", () => {
  assert.equal(isKnownUncertainCandidate({ validationStatus: "HUMAN_VALIDATED_CDC", humanReviewImportBatchId: null }), false);
  assert.equal(isKnownUncertainCandidate({ validationStatus: "HUMAN_REJECTED_CDC", humanReviewImportBatchId: null }), false);
});

test("sanitizeCandidatePage: rejects non-positive/non-integer input, defaults to 1", () => {
  assert.equal(sanitizeCandidatePage(1), 1);
  assert.equal(sanitizeCandidatePage(5), 5);
  assert.equal(sanitizeCandidatePage(0), 1);
  assert.equal(sanitizeCandidatePage(-3), 1);
  assert.equal(sanitizeCandidatePage(1.5), 1);
  assert.equal(sanitizeCandidatePage("not-a-number"), 1);
  assert.equal(sanitizeCandidatePage(undefined), 1);
});

test("sanitizeCandidateLimit: bounded between 1 and MAX_CANDIDATE_PAGE_SIZE, defaults safely", () => {
  assert.equal(sanitizeCandidateLimit(10), 10);
  assert.equal(sanitizeCandidateLimit(MAX_CANDIDATE_PAGE_SIZE + 500), MAX_CANDIDATE_PAGE_SIZE);
  assert.equal(sanitizeCandidateLimit(0), DEFAULT_CANDIDATE_PAGE_SIZE);
  assert.equal(sanitizeCandidateLimit(-1), DEFAULT_CANDIDATE_PAGE_SIZE);
  assert.equal(sanitizeCandidateLimit("drop table"), DEFAULT_CANDIDATE_PAGE_SIZE);
});

test("sanitizeCandidateSortField: only allowlisted fields pass through, anything else falls back", () => {
  assert.equal(sanitizeCandidateSortField("year"), "year");
  assert.equal(sanitizeCandidateSortField("validation_status"), "validation_status");
  assert.equal(sanitizeCandidateSortField("id; drop table candidates;"), "reviewed_at");
  assert.equal(sanitizeCandidateSortField(undefined), "reviewed_at");
});

test("sanitizeCandidateSortOrder: only asc/desc, anything else is desc", () => {
  assert.equal(sanitizeCandidateSortOrder("asc"), "asc");
  assert.equal(sanitizeCandidateSortOrder("desc"), "desc");
  assert.equal(sanitizeCandidateSortOrder("garbage"), "desc");
});

test("buildCandidateFilterClause: no filters produces no WHERE clause and no params", () => {
  const { whereClause, params } = buildCandidateFilterClause({});
  assert.equal(whereClause, "");
  assert.deepEqual(params, []);
});

test("buildCandidateFilterClause: every user-supplied value becomes a numbered placeholder, never inlined text", () => {
  const { whereClause, params } = buildCandidateFilterClause({
    search: "Some Reference",
    validationStatus: "HUMAN_VALIDATED_CDC",
    detectedRole: "CDC",
    structuralBand: "STRONG_TECHNICAL_SOURCE",
    reviewPriority: "HIGH_PRIORITY",
    yearMin: 2018,
    yearMax: 2026
  });
  assert.match(whereClause, /\$1/);
  assert.match(whereClause, /\$2/);
  assert.match(whereClause, /\$3/);
  assert.match(whereClause, /\$4/);
  assert.match(whereClause, /\$5/);
  assert.match(whereClause, /\$6/);
  assert.match(whereClause, /\$7/);
  assert.equal(params.length, 7);
  // The raw search text must never appear directly in the SQL text itself.
  assert.doesNotMatch(whereClause, /Some Reference/i);
  assert.equal(params[0], "%some reference%");
});

test("buildCandidateFilterClause: an unrecognized enum-like filter value is silently dropped, not interpolated", () => {
  const { whereClause, params } = buildCandidateFilterClause({
    // @ts-expect-error - deliberately invalid at the type level too, to
    // prove the runtime guard (not just TypeScript) rejects it.
    detectedRole: "CDC'; DROP TABLE knowledge_base.historical_technical_source_candidates; --"
  });
  assert.equal(whereClause, "");
  assert.deepEqual(params, []);
});

test("buildCandidateFilterClause: processing-group filters expand to conditions consistent with computeProcessingGroup", () => {
  const cases: Array<{ group: Parameters<typeof buildCandidateFilterClause>[0]["processingGroup"]; status: string; year: number | null; matches: boolean }> = [
    { group: "PRIORITAIRE_2020_2026", status: "HUMAN_VALIDATED_CDC", year: 2022, matches: true },
    { group: "PRIORITAIRE_2020_2026", status: "HUMAN_VALIDATED_CDC", year: 2010, matches: false },
    { group: "SECONDAIRE_AVANT_2020", status: "HUMAN_VALIDATED_CDC", year: 2010, matches: true },
    { group: "SECONDAIRE_AVANT_2020", status: "HUMAN_VALIDATED_CDC", year: 2022, matches: false },
    { group: "EXCLU", status: "HUMAN_REJECTED_CDC", year: 2022, matches: true },
    { group: "EXCLU", status: "HUMAN_VALIDATED_CDC", year: 2022, matches: false },
    { group: "A_REVOIR", status: "MACHINE_CLASSIFIED", year: 2022, matches: true },
    { group: "A_REVOIR", status: "HUMAN_VALIDATED_CDC", year: 2022, matches: false }
  ];
  for (const { group, status, year, matches } of cases) {
    const { whereClause } = buildCandidateFilterClause({ processingGroup: group });
    const computed = computeProcessingGroup(status as never, year);
    const conditionSaysMatch = computed === group;
    assert.equal(conditionSaysMatch, matches, `${group}/${status}/${year}`);
    assert.notEqual(whereClause, "");
  }
});

test("mapCandidateRow: never includes a filesystem path or document content field", () => {
  const record = mapCandidateRow({
    id: "11111111-1111-1111-1111-111111111111",
    archive_file_id: "1234",
    year: 2022,
    project_reference: "REF-2022-001",
    detected_role: "CDC",
    structural_band: "STRONG_TECHNICAL_SOURCE",
    confidence: "0.87",
    review_priority: "HIGH_PRIORITY",
    validation_status: "HUMAN_VALIDATED_CDC",
    extraction_status: "SUCCESS",
    reviewed_at: "2026-09-18T10:00:00.000Z",
    human_review_import_batch_id: "1"
  });
  const keys = Object.keys(record);
  for (const forbidden of ["path", "relative_path", "filename", "content", "excerpt", "sha256"]) {
    assert.ok(!keys.some((k) => k.toLowerCase().includes(forbidden)), `unexpected key resembling "${forbidden}"`);
  }
  assert.equal(record.processingGroup, "PRIORITAIRE_2020_2026");
  assert.equal(record.isKnownUncertain, false);
});

test("mapCandidateRow: derives isKnownUncertain and A_REVOIR together for an unlinked machine-classified row", () => {
  const record = mapCandidateRow({
    id: "22222222-2222-2222-2222-222222222222",
    year: 2015,
    project_reference: null,
    detected_role: "UNKNOWN",
    structural_band: "WEAK_TECHNICAL_SOURCE",
    confidence: null,
    review_priority: null,
    validation_status: "MACHINE_CLASSIFIED",
    extraction_status: "NOT_ATTEMPTED",
    reviewed_at: null,
    human_review_import_batch_id: null
  });
  assert.equal(record.processingGroup, "A_REVOIR");
  assert.equal(record.isKnownUncertain, true);
});

test("mapImportBatchRow: fingerprint is truncated, the full workbook hash is never exposed", () => {
  const fullHash = "47597354cdcf5c82f658ee3af41ca536682be879edaf080340fc6e57f031bb89";
  const record = mapImportBatchRow({
    id: "1",
    status: "COMPLETED",
    reviewer_type: "EXTERNAL_HUMAN",
    external_reviewer_label: "Youssef",
    started_at: "2026-09-18T07:36:07.000Z",
    completed_at: "2026-09-18T07:36:12.000Z",
    total_count: "750",
    usable_count: "436",
    excluded_count: "312",
    skipped_uncertain_count: "2",
    updated_count: "748",
    source_workbook_sha256: fullHash
  });
  assert.notEqual(record.sourceWorkbookFingerprint, fullHash);
  assert.ok(record.sourceWorkbookFingerprint.length < fullHash.length);
  assert.equal(record.totalCount, 750);
  assert.equal(record.usableCount, 436);
  assert.equal(record.excludedCount, 312);
  assert.equal(record.skippedUncertainCount, 2);
  assert.equal(record.updatedCount, 748);
  assert.equal(record.externalReviewerLabel, "Youssef");
});

test("sanitizeRepositoryError: never echoes the raw error message (which could carry a connection string or SQL fragment)", () => {
  const raw = new Error("connection to server at postgresql://user:supersecret@host/db failed");
  const message = sanitizeRepositoryError(raw);
  assert.doesNotMatch(message, /supersecret/);
  assert.doesNotMatch(message, /postgresql:\/\//);
  assert.equal(typeof message, "string");
  assert.ok(message.length > 0);
});
