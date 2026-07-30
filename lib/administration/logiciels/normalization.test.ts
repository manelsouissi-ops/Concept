import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSoftwareComparisonName,
  normalizeSoftwareDisplayName,
  splitSoftwareNameCandidates
} from "./normalization.ts";

test("normalizeSoftwareDisplayName trims and collapses whitespace", () => {
  assert.equal(
    normalizeSoftwareDisplayName("  Global   Mapper  "),
    "Global Mapper"
  );
});

test("normalizeSoftwareComparisonName ignores capitalization but keeps accented text comparable", () => {
  assert.equal(
    normalizeSoftwareComparisonName("  HéC-RAS  "),
    "héc-ras"
  );
});

test("splitSoftwareNameCandidates splits clear comma-separated software names", () => {
  assert.deepEqual(
    splitSoftwareNameCandidates("CAD Earth, Global Mapper, Google Earth"),
    ["CAD Earth", "Global Mapper", "Google Earth"]
  );
});

test("splitSoftwareNameCandidates stays conservative on long descriptive text", () => {
  assert.deepEqual(
    splitSoftwareNameCandidates(
      "Logiciel de modelisation hydraulique, a utiliser pour les etudes complexes avec validation detaillee"
    ),
    [
      "Logiciel de modelisation hydraulique, a utiliser pour les etudes complexes avec validation detaillee"
    ]
  );
});
