import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPreImportSummary,
  canConfirmImport,
  getCandidatePresentation,
  getImportSteps,
  shouldShowDevelopmentImportOptions
} from "./import-presentation.ts";
import type { SoftwareImportCandidate, SoftwareImportPreview } from "./types.ts";

function createCandidate(
  patch: Partial<SoftwareImportCandidate> = {}
): SoftwareImportCandidate {
  return {
    rowNumber: 3,
    originalCellValue: "Autocad",
    sourceName: "Autocad",
    proposedName: "Autocad",
    normalizedName: "autocad",
    rawUsage: "Dessin",
    result: "new",
    messages: [],
    splitFromMultiNameCell: false,
    existingSoftwareId: null,
    existingSoftwareName: null,
    ...patch
  };
}

function createPreview(
  patch: Partial<SoftwareImportPreview> = {}
): SoftwareImportPreview {
  return {
    sourceFileName: "catalogue.xlsx",
    worksheetName: "Feuil2",
    totalRowsInspected: 10,
    validSoftwareCandidates: 3,
    newRecords: 1,
    existingMatches: 1,
    possibleDuplicates: 0,
    rowsSkipped: 1,
    splitCells: 0,
    warnings: [],
    candidates: [createCandidate()],
    ...patch
  };
}

test("shouldShowDevelopmentImportOptions hides local option in production", () => {
  assert.equal(shouldShowDevelopmentImportOptions("production"), false);
  assert.equal(shouldShowDevelopmentImportOptions("development"), true);
});

test("getImportSteps highlights selection, verification, then confirmation", () => {
  assert.equal(getImportSteps({ preview: null, summary: null })[0].active, true);
  assert.equal(
    getImportSteps({ preview: createPreview(), summary: null })[1].active,
    true
  );
  assert.equal(
    getImportSteps({ preview: createPreview(), summary: {
      sourceFileName: "catalogue.xlsx",
      worksheetName: "Feuil2",
      totalRowsInspected: 10,
      validSoftwareCandidates: 3,
      createdRecords: 1,
      existingMatches: 1,
      updatedDescriptions: 0,
      addedAliases: 1,
      skippedRows: 1,
      duplicateCandidates: 0,
      warnings: []
    } })[2].active,
    true
  );
});

test("getCandidatePresentation maps new, existing, alias, warning, and skipped labels", () => {
  assert.equal(getCandidatePresentation(createCandidate()).resultLabel, "Nouveau");
  assert.equal(
    getCandidatePresentation(createCandidate({ result: "existing", existingSoftwareId: 4, existingSoftwareName: "Autocad" })).resultLabel,
    "Déjà enregistré"
  );
  assert.equal(
    getCandidatePresentation(
      createCandidate({
        result: "existing",
        sourceName: "AutoCAD",
        existingSoftwareId: 4,
        existingSoftwareName: "Autocad"
      })
    ).resultLabel,
    "Alias reconnu"
  );
  assert.equal(
    getCandidatePresentation(createCandidate({ result: "warning" })).resultLabel,
    "À vérifier"
  );
  assert.equal(
    getCandidatePresentation(
      createCandidate({
        result: "skipped",
        proposedName: null,
        normalizedName: null,
        sourceName: null,
        existingSoftwareName: null
      })
    ).resultLabel,
    "Ignoré"
  );
});

test("canConfirmImport requires a preview and at least one non-skipped candidate", () => {
  assert.equal(canConfirmImport(null), false);
  assert.equal(
    canConfirmImport(
      createPreview({
        validSoftwareCandidates: 0,
        candidates: [
          createCandidate({
            result: "skipped",
            proposedName: null,
            normalizedName: null,
            sourceName: null
          })
        ]
      })
    ),
    false
  );
  assert.equal(canConfirmImport(createPreview()), true);
});

test("buildPreImportSummary reports new software, existing software, and aliases", () => {
  const preview = createPreview({
    newRecords: 3,
    existingMatches: 9,
    candidates: [
      createCandidate({ result: "new" }),
      createCandidate({
        rowNumber: 4,
        result: "existing",
        sourceName: "AutoCAD",
        existingSoftwareId: 7,
        existingSoftwareName: "Autocad"
      })
    ]
  });

  assert.equal(
    buildPreImportSummary(preview),
    "La mise à jour créera 3 nouveau(x) logiciel(s), conservera 9 logiciel(s) existant(s) et ajoutera 1 alias."
  );
});
