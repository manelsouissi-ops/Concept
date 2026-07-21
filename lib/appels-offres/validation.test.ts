import test from "node:test";
import assert from "node:assert/strict";
import { parseAppelOffresFormData } from "./validation.ts";

test("parseAppelOffresFormData accepts the minimal create payload when title is optional", () => {
  const formData = new FormData();
  formData.append("code", "AO-20260715-1234");
  formData.append(
    "file",
    new File(["%PDF-1.7"], "cdc.pdf", { type: "application/pdf" })
  );

  const { input, file } = parseAppelOffresFormData(formData, {
    requireCode: true,
    requirePdf: true,
    requireTitle: false
  });

  assert.equal(input.code, "AO-20260715-1234");
  assert.equal(input.title, "");
  assert.equal(file?.name, "cdc.pdf");
});

test("parseAppelOffresFormData still requires a title when requested", () => {
  const formData = new FormData();
  formData.append("code", "AO-20260715-1234");

  assert.throws(
    () =>
      parseAppelOffresFormData(formData, {
        requireCode: true,
        requirePdf: false,
        requireTitle: true
      }),
    /L'intitule est obligatoire\./
  );
});

test("parseAppelOffresFormData rejects a non-PDF upload", () => {
  const formData = new FormData();
  formData.append("code", "AO-20260715-1234");
  formData.append(
    "file",
    new File(["not a pdf"], "cdc.txt", { type: "text/plain" })
  );

  assert.throws(
    () =>
      parseAppelOffresFormData(formData, {
        requireCode: true,
        requirePdf: true,
        requireTitle: false
      }),
    /Seuls les fichiers PDF sont acceptes\./
  );
});
