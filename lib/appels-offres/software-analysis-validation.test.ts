import test from "node:test";
import assert from "node:assert/strict";
import {
  validateGapMutationInput,
  validateRequirementMutationInput
} from "./software-analysis-validation.ts";

test("validateRequirementMutationInput normalizes required business fields", () => {
  const input = validateRequirementMutationInput({
    requirementText: "  Besoin SIG principal  ",
    explicitness: "explicit",
    softwareNamesRaw: "  QGIS  ",
    necessityLevel: "  Haute  ",
    justification: "  Necessaire au DAO  ",
    riskIfMissing: "  Blocage  ",
    alternativePossible: "  ArcGIS  ",
    sourceExcerpt: "  Extrait  ",
    status: "draft"
  });

  assert.equal(input.requirementText, "Besoin SIG principal");
  assert.equal(input.softwareNamesRaw, "QGIS");
  assert.equal(input.necessityLevel, "Haute");
});

test("validateGapMutationInput rejects empty uncovered needs", () => {
  assert.throws(
    () =>
      validateGapMutationInput({
        requirementId: null,
        missingNeed: "  ",
        softwareTypeNeeded: "",
        whyNeeded: "",
        urgencyLevel: "Haute",
        exampleSoftwareOrCategory: "",
        recommendedAction: "",
        status: "draft"
      }),
    /obligatoire/i
  );
});
