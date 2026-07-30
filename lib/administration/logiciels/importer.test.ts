import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  findSoftwareWorkbookHeaders,
  previewSoftwareImportBuffer,
  SOFTWARE_CATALOGUE_WORKSHEET
} from "./importer.ts";

function buildWorkbookBuffer(rows: Array<Array<string | number | null>>) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, SOFTWARE_CATALOGUE_WORKSHEET);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("findSoftwareWorkbookHeaders detects headers by name and ignores the blank layout column", () => {
  const headers = findSoftwareWorkbookHeaders([
    ["", "", ""],
    ["", "Logiciels", "Utilisation"]
  ]);

  assert.deepEqual(headers, {
    headerRowIndex: 1,
    logicielsColumnIndex: 1,
    utilisationColumnIndex: 2
  });
});

test("previewSoftwareImportBuffer ignores blank rows, preserves raw usage, and splits multiple names", async () => {
  const buffer = buildWorkbookBuffer([
    ["", "", ""],
    ["", "Logiciels", "Utilisation"],
    ["", "Autocad", "Dessin"],
    ["", "", ""],
    ["", "CAD Earth, Global Mapper, Google Earth", "Cartographie"]
  ]);

  const preview = await previewSoftwareImportBuffer(buffer, "catalogue.xlsx");

  assert.equal(preview.totalRowsInspected, 3);
  assert.equal(preview.rowsSkipped, 1);
  assert.equal(preview.splitCells, 1);
  assert.equal(preview.validSoftwareCandidates, 4);

  const splitCandidates = preview.candidates.filter((candidate) => candidate.rowNumber === 5);
  assert.deepEqual(
    splitCandidates.map((candidate) => candidate.proposedName),
    ["CAD Earth", "Global Mapper", "Google Earth"]
  );
  assert.ok(splitCandidates.every((candidate) => candidate.rawUsage === "Cartographie"));
});

test("previewSoftwareImportBuffer marks duplicate candidates from the same file as warnings", async () => {
  const buffer = buildWorkbookBuffer([
    ["", "", ""],
    ["", "Logiciels", "Utilisation"],
    ["", "Autocad", "Dessin"],
    ["", "AUTOCAD", "DAO"]
  ]);

  const preview = await previewSoftwareImportBuffer(buffer, "catalogue.xlsx");
  const warningCandidates = preview.candidates.filter((candidate) => candidate.result === "warning");

  assert.equal(preview.possibleDuplicates, 1);
  assert.equal(warningCandidates.length, 1);
  assert.match(warningCandidates[0].messages.join(" "), /doublon/i);
});

test("previewSoftwareImportBuffer marks re-imported software names as existing matches", async () => {
  const buffer = buildWorkbookBuffer([
    ["", "", ""],
    ["", "Logiciels", "Utilisation"],
    ["", "HecRas", "Modelisation hydraulique"]
  ]);

  const preview = await previewSoftwareImportBuffer(
    buffer,
    "catalogue.xlsx",
    new Map([
      [
        "hecras",
        {
          id: 42,
          name: "HECRAS",
          descriptionRaw: ""
        }
      ]
    ])
  );

  assert.equal(preview.existingMatches, 1);
  assert.equal(preview.candidates[0].result, "existing");
  assert.equal(preview.candidates[0].existingSoftwareId, 42);
});

test("previewSoftwareImportBuffer rejects workbooks missing the expected headers", async () => {
  const buffer = buildWorkbookBuffer([
    ["Nom", "Description"],
    ["Autocad", "Dessin"]
  ]);

  await assert.rejects(
    () => previewSoftwareImportBuffer(buffer, "catalogue.xlsx"),
    /en-tetes attendus/i
  );
});

test("previewSoftwareImportBuffer rejects invalid workbooks", async () => {
  assert.throws(
    () => previewSoftwareImportBuffer(Buffer.from("invalid"), "catalogue.xlsx"),
    /n'a pas pu etre lu|introuvable dans le classeur/i
  );
});
