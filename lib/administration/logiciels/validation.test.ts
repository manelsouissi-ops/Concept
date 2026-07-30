import test from "node:test";
import assert from "node:assert/strict";
import { validateSoftwareMutationInput } from "./validation.ts";

test("validateSoftwareMutationInput rejects blank names", () => {
  assert.throws(
    () =>
      validateSoftwareMutationInput({
        name: "   ",
        descriptionRaw: "",
        aliases: []
      }),
    /nom du logiciel est obligatoire/i
  );
});

test("validateSoftwareMutationInput deduplicates aliases and removes alias identical to the software name", () => {
  const result = validateSoftwareMutationInput({
    name: "AutoCAD",
    descriptionRaw: "Dessin",
    aliases: ["Autocad", " AutoCAD ", "Autocad", "Autodesk AutoCAD"]
  });

  assert.equal(result.name, "AutoCAD");
  assert.deepEqual(result.aliases, ["Autodesk AutoCAD"]);
});
