import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateFciPayloadCompletion,
  createEmptyFciModulePayload,
  getFciFieldDefinition,
  getFciModuleDefinition,
  getFciModuleDefinitions
} from "./rendering.ts";

test("A-D rendering definitions exist", () => {
  const definitions = getFciModuleDefinitions();
  assert.deepEqual(
    definitions.map((item) => item.moduleCode),
    ["A", "B", "C", "D"]
  );
});

test("E has no active editable definition", () => {
  assert.equal(getFciModuleDefinition("A")?.moduleCode, "A");
  assert.deepEqual(
    getFciModuleDefinitions().map((item) => item.moduleCode),
    ["A", "B", "C", "D"]
  );
});

test("all sections are ordered and section-field paths are unique per module", () => {
  for (const definition of getFciModuleDefinitions()) {
    const orders = definition.sections.map((section) => section.order);
    assert.deepEqual(orders, [...orders].sort((left, right) => left - right));

    const fieldPaths = definition.sections.flatMap((section) =>
      section.fields.map((field) => `${section.key}.${field.key}`)
    );
    assert.equal(new Set(fieldPaths).size, fieldPaths.length);
  }
});

test("known field definitions can be looked up safely", () => {
  assert.equal(
    getFciFieldDefinition("A", "reference_interne_code_dossier")?.label,
    "Reference interne / code dossier"
  );
  assert.equal(getFciFieldDefinition("A", "unknown_field"), null);
});

test("empty payloads can be created for every supported module", () => {
  for (const moduleCode of ["A", "B", "C", "D"] as const) {
    const payload = createEmptyFciModulePayload(moduleCode, {
      codeInterne: "AO-TEST",
      intituleOffre: "Offre test",
      dateDepot: "2026-07-27",
      sourceFiche: {
        code_interne: "AO-TEST",
        version: "validated:now",
        hash: "hash",
        status: "validated",
        validated_at: "2026-07-27T12:00:00.000Z"
      }
    });
    assert.equal(payload.module_code, moduleCode);
    assert.equal(typeof payload.data, "object");
  }
});

test("payload completion is calculated without crashing", () => {
  const payload = createEmptyFciModulePayload("A", {
    codeInterne: "AO-TEST",
    intituleOffre: "Offre test",
    dateDepot: "2026-07-27",
    sourceFiche: {
      code_interne: "AO-TEST",
      version: "validated:now",
      hash: "hash",
      status: "validated",
      validated_at: "2026-07-27T12:00:00.000Z"
    }
  });
  const completion = calculateFciPayloadCompletion(payload, "A");
  assert.equal(completion.filled, 0);
  assert.equal(completion.total > 0, true);
});
