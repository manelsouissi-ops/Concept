import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTechnicalBucket,
  buildClassificationReviewEvent,
  decideTechnicalBackfillWrite
} from "./classification.ts";

// All filenames/extensions below are synthetic examples for testing only -
// none reference real CONCEPT archive content.

test("business document extensions classify as BUSINESS_DOCUMENT", () => {
  assert.equal(classifyTechnicalBucket("pdf"), "BUSINESS_DOCUMENT");
  assert.equal(classifyTechnicalBucket("docx"), "BUSINESS_DOCUMENT");
  assert.equal(classifyTechnicalBucket("xlsx"), "BUSINESS_DOCUMENT");
  assert.equal(classifyTechnicalBucket("txt"), "BUSINESS_DOCUMENT");
});

test("engineering/GIS extensions classify as TECHNICAL_FILE", () => {
  assert.equal(classifyTechnicalBucket("dwg"), "TECHNICAL_FILE");
  assert.equal(classifyTechnicalBucket("shp"), "TECHNICAL_FILE");
});

test("image extensions classify as IMAGE", () => {
  assert.equal(classifyTechnicalBucket("jpg"), "IMAGE");
  assert.equal(classifyTechnicalBucket("png"), "IMAGE");
});

test("compressed archive extensions classify as ARCHIVE", () => {
  assert.equal(classifyTechnicalBucket("zip"), "ARCHIVE");
  assert.equal(classifyTechnicalBucket("7z"), "ARCHIVE");
});

test("application/system extensions classify as SOFTWARE_SYSTEM", () => {
  assert.equal(classifyTechnicalBucket("dll"), "SOFTWARE_SYSTEM");
  assert.equal(classifyTechnicalBucket("exe"), "SOFTWARE_SYSTEM");
});

test("unrecognized extension classifies as UNKNOWN", () => {
  assert.equal(classifyTechnicalBucket("xyzabc"), "UNKNOWN");
});

test("null/undefined/empty extension classifies as UNKNOWN", () => {
  assert.equal(classifyTechnicalBucket(null), "UNKNOWN");
  assert.equal(classifyTechnicalBucket(undefined), "UNKNOWN");
  assert.equal(classifyTechnicalBucket(""), "UNKNOWN");
  assert.equal(classifyTechnicalBucket("   "), "UNKNOWN");
});

test("extension matching is case-insensitive", () => {
  assert.equal(classifyTechnicalBucket("PDF"), "BUSINESS_DOCUMENT");
  assert.equal(classifyTechnicalBucket("Dwg"), "TECHNICAL_FILE");
  assert.equal(classifyTechnicalBucket("JPG"), "IMAGE");
});

test("a leading dot is normalized away", () => {
  assert.equal(classifyTechnicalBucket(".pdf"), "BUSINESS_DOCUMENT");
  assert.equal(classifyTechnicalBucket(".ZIP"), "ARCHIVE");
});

test("realistic synthetic filenames end-to-end via their extension", () => {
  const cases: Array<[string, string]> = [
    ["project-specification.pdf", "BUSINESS_DOCUMENT"],
    ["drawing.dwg", "TECHNICAL_FILE"],
    ["photo.jpg", "IMAGE"],
    ["application.dll", "SOFTWARE_SYSTEM"],
    ["archive.zip", "ARCHIVE"],
    ["unknown.xyzabc", "UNKNOWN"]
  ];

  for (const [filename, expected] of cases) {
    const extension = filename.split(".").pop() ?? "";
    assert.equal(classifyTechnicalBucket(extension), expected, filename);
  }
});

// --- Classification review event (synthetic transitions only) ---

test("UNKNOWN -> CDC + VALIDATED produces one event with the expected shape", () => {
  const event = buildClassificationReviewEvent({
    archiveFileId: 101,
    previousKnowledgeCategory: "UNKNOWN",
    previousClassificationState: "UNCLASSIFIED",
    newKnowledgeCategory: "CDC",
    newClassificationState: "VALIDATED",
    reason: "synthetic test reason",
    reviewedByUserId: 7
  });

  assert.deepEqual(event, {
    archiveFileId: 101,
    previousKnowledgeCategory: "UNKNOWN",
    newKnowledgeCategory: "CDC",
    previousClassificationState: "UNCLASSIFIED",
    newClassificationState: "VALIDATED",
    classificationMethod: "HUMAN",
    reason: "synthetic test reason",
    reviewedByUserId: 7
  });
});

test("CDC -> METHODOLOGY + VALIDATED preserves the previous CDC value in the event", () => {
  const event = buildClassificationReviewEvent({
    archiveFileId: 202,
    previousKnowledgeCategory: "CDC",
    previousClassificationState: "VALIDATED",
    newKnowledgeCategory: "METHODOLOGY",
    newClassificationState: "VALIDATED",
    reviewedByUserId: 7
  });

  assert.equal(event.previousKnowledgeCategory, "CDC");
  assert.equal(event.newKnowledgeCategory, "METHODOLOGY");
});

test("METHODOLOGY -> METHODOLOGY + NEEDS_REVIEW records the state transition even when the category is unchanged", () => {
  const event = buildClassificationReviewEvent({
    archiveFileId: 303,
    previousKnowledgeCategory: "METHODOLOGY",
    previousClassificationState: "VALIDATED",
    newKnowledgeCategory: "METHODOLOGY",
    newClassificationState: "NEEDS_REVIEW",
    reviewedByUserId: 7
  });

  assert.equal(event.newKnowledgeCategory, event.previousKnowledgeCategory);
  assert.equal(event.previousClassificationState, "VALIDATED");
  assert.equal(event.newClassificationState, "NEEDS_REVIEW");
});

test("a file with no prior classification row defaults previous state to UNCLASSIFIED, not null", () => {
  const event = buildClassificationReviewEvent({
    archiveFileId: 404,
    previousKnowledgeCategory: null,
    previousClassificationState: null,
    newKnowledgeCategory: "OTHER",
    newClassificationState: "VALIDATED",
    reviewedByUserId: null
  });

  assert.equal(event.previousKnowledgeCategory, null);
  assert.equal(event.previousClassificationState, "UNCLASSIFIED");
});

test("an empty/whitespace-only reason is normalized to null", () => {
  const event = buildClassificationReviewEvent({
    archiveFileId: 505,
    previousKnowledgeCategory: "OTHER",
    previousClassificationState: "AI_PROPOSED",
    newKnowledgeCategory: "OTHER",
    newClassificationState: "VALIDATED",
    reason: "   ",
    reviewedByUserId: 3
  });

  assert.equal(event.reason, null);
});

// --- Technical bucket backfill decision (synthetic snapshots only) ---

test("first-time confident bucket advances UNCLASSIFIED to AUTO_FILTERED/RULE", () => {
  const decision = decideTechnicalBackfillWrite("pdf", null);
  assert.equal(decision.technicalBucket, "BUSINESS_DOCUMENT");
  assert.equal(decision.classificationState, "AUTO_FILTERED");
  assert.equal(decision.classificationMethod, "RULE");
  assert.equal(decision.classifiedAtShouldBeSet, true);
  assert.equal(decision.changed, true);
});

test("DLL, DWG, JPG, ZIP all advance UNCLASSIFIED the same way", () => {
  for (const [extension, expectedBucket] of [
    ["dll", "SOFTWARE_SYSTEM"],
    ["dwg", "TECHNICAL_FILE"],
    ["jpg", "IMAGE"],
    ["zip", "ARCHIVE"]
  ] as const) {
    const decision = decideTechnicalBackfillWrite(extension, null);
    assert.equal(decision.technicalBucket, expectedBucket, extension);
    assert.equal(decision.classificationState, "AUTO_FILTERED", extension);
    assert.equal(decision.classificationMethod, "RULE", extension);
  }
});

test("an unknown extension never advances classification_state past UNCLASSIFIED", () => {
  const decision = decideTechnicalBackfillWrite("xyzabc", null);
  assert.equal(decision.technicalBucket, "UNKNOWN");
  assert.equal(decision.classificationState, "UNCLASSIFIED");
  assert.equal(decision.classificationMethod, null);
  assert.notEqual(decision.classificationState, "VALIDATED");
});

test("an existing HUMAN-validated classification is preserved when technical_bucket is recomputed", () => {
  const decision = decideTechnicalBackfillWrite("pdf", {
    technicalBucket: "BUSINESS_DOCUMENT",
    classificationState: "VALIDATED",
    classificationMethod: "HUMAN",
    classifiedAt: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(decision.classificationState, "VALIDATED");
  assert.equal(decision.classificationMethod, "HUMAN");
  assert.equal(decision.changed, false);
});

test("an existing NEEDS_REVIEW state set by a human is not reset by a technical rerun", () => {
  const decision = decideTechnicalBackfillWrite("zip", {
    technicalBucket: "ARCHIVE",
    classificationState: "NEEDS_REVIEW",
    classificationMethod: "HUMAN",
    classifiedAt: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(decision.classificationState, "NEEDS_REVIEW");
  assert.equal(decision.classificationMethod, "HUMAN");
});

test("an existing AI_PROPOSED knowledge classification is preserved", () => {
  const decision = decideTechnicalBackfillWrite("docx", {
    technicalBucket: "BUSINESS_DOCUMENT",
    classificationState: "AI_PROPOSED",
    classificationMethod: "LOCAL_AI",
    classifiedAt: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(decision.classificationState, "AI_PROPOSED");
  assert.equal(decision.classificationMethod, "LOCAL_AI");
  assert.equal(decision.changed, false);
});

test("running the decision twice in a row is idempotent (second run is a no-op)", () => {
  const first = decideTechnicalBackfillWrite("dwg", null);
  const second = decideTechnicalBackfillWrite("dwg", {
    technicalBucket: first.technicalBucket,
    classificationState: first.classificationState,
    classificationMethod: first.classificationMethod,
    classifiedAt: first.classifiedAtShouldBeSet ? "2026-01-01T00:00:00.000Z" : null
  });
  assert.equal(second.changed, false);
});

test("an UNKNOWN bucket is idempotent across reruns too", () => {
  const first = decideTechnicalBackfillWrite("xyzabc", null);
  const second = decideTechnicalBackfillWrite("xyzabc", {
    technicalBucket: first.technicalBucket,
    classificationState: first.classificationState,
    classificationMethod: first.classificationMethod,
    classifiedAt: null
  });
  assert.equal(second.changed, false);
  assert.equal(second.classificationState, "UNCLASSIFIED");
});
