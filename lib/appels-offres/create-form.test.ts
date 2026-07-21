import test from "node:test";
import assert from "node:assert/strict";
import {
  getPdfFileSelectionError,
  normalizeAppelOffresCodeCandidate,
  suggestNewAppelOffresCode,
  validateCreateAppelOffresDraft
} from "./create-form.ts";

test("suggestNewAppelOffresCode builds a deterministic suggestion", () => {
  assert.equal(
    suggestNewAppelOffresCode(new Date(2026, 6, 15, 12, 34)),
    "AO-20260715-1234"
  );
});

test("normalizeAppelOffresCodeCandidate keeps a storage-safe code", () => {
  assert.equal(normalizeAppelOffresCodeCandidate(" AO 2026 / 045 "), "AO_2026_045");
});

test("validateCreateAppelOffresDraft disables submission for an empty form", () => {
  assert.deepEqual(
    validateCreateAppelOffresDraft({ code: "", file: null }),
    {
      normalizedCode: "",
      isCodeValid: false,
      fileError: null,
      canSubmit: false
    }
  );
});

test("validateCreateAppelOffresDraft disables submission for code only", () => {
  const result = validateCreateAppelOffresDraft({
    code: "AO-20260715-1234",
    file: null
  });

  assert.equal(result.isCodeValid, true);
  assert.equal(result.canSubmit, false);
});

test("validateCreateAppelOffresDraft disables submission for PDF only", () => {
  const result = validateCreateAppelOffresDraft({
    code: "   ",
    file: {
      name: "cdc.pdf",
      type: "application/pdf",
      size: 1024
    }
  });

  assert.equal(result.isCodeValid, false);
  assert.equal(result.canSubmit, false);
});

test("getPdfFileSelectionError rejects a non-PDF file", () => {
  assert.equal(
    getPdfFileSelectionError({
      name: "cdc.docx",
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 1024
    }),
    "Seuls les fichiers PDF sont acceptes pour le CDC."
  );
});

test("validateCreateAppelOffresDraft accepts a valid code and PDF", () => {
  const result = validateCreateAppelOffresDraft({
    code: "AO-20260715-1234",
    file: {
      name: "cdc.pdf",
      type: "application/pdf",
      size: 1024
    }
  });

  assert.equal(result.normalizedCode, "AO-20260715-1234");
  assert.equal(result.isCodeValid, true);
  assert.equal(result.fileError, null);
  assert.equal(result.canSubmit, true);
});
