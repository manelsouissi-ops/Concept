import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthoritativeSourceFiche, computeFciModuleSummary } from "./callback-derivation.ts";

test("buildAuthoritativeSourceFiche derives status and validated_at from the job's source_fiche version", () => {
  const sourceFiche = buildAuthoritativeSourceFiche("AO-20260806-0951", {
    sourceFicheVersion: "validated:2026-08-06T09:07:44.808Z",
    sourceFicheHash: "abc123"
  });

  assert.deepEqual(sourceFiche, {
    code_interne: "AO-20260806-0951",
    version: "validated:2026-08-06T09:07:44.808Z",
    hash: "abc123",
    status: "validated",
    validated_at: "2026-08-06T09:07:44.808Z"
  });
});

function field(requiresHumanInput: boolean) {
  return {
    value: "x",
    source_type: "fiche_cdc",
    confidence: "high",
    requires_human_input: requiresHumanInput,
    justification: "test",
    source_references: []
  };
}

test("computeFciModuleSummary counts requires_human_input leaves across nested arrays and objects", () => {
  const data = {
    section_one: [
      { a: field(false), b: field(true) },
      { a: field(false), b: field(false) }
    ],
    section_two: {
      c: field(true)
    }
  };

  const summary = computeFciModuleSummary(data);

  assert.equal(summary.human_inputs_required, 2);
  assert.equal(summary.completion_percentage, 60);
  assert.equal(summary.status, "partial");
  assert.deepEqual(summary.warnings, [
    'La section "section_one" contient des champs necessitant une saisie humaine.',
    'La section "section_two" contient des champs necessitant une saisie humaine.'
  ]);
});

test("computeFciModuleSummary reports complete when nothing requires human input", () => {
  const data = { section: [{ a: field(false), b: field(false) }] };
  const summary = computeFciModuleSummary(data);

  assert.equal(summary.status, "complete");
  assert.equal(summary.completion_percentage, 100);
  assert.equal(summary.human_inputs_required, 0);
  assert.deepEqual(summary.warnings, []);
});

test("computeFciModuleSummary reports insufficient_data when everything requires human input", () => {
  const data = { section: [{ a: field(true), b: field(true) }] };
  const summary = computeFciModuleSummary(data);

  assert.equal(summary.status, "insufficient_data");
  assert.equal(summary.completion_percentage, 0);
  assert.equal(summary.human_inputs_required, 2);
});

test("computeFciModuleSummary reports insufficient_data and no warnings for data with no field leaves", () => {
  const summary = computeFciModuleSummary({ empty_section: {} });

  assert.equal(summary.status, "insufficient_data");
  assert.equal(summary.completion_percentage, 0);
  assert.equal(summary.human_inputs_required, 0);
  assert.deepEqual(summary.warnings, []);
});

test("computeFciModuleSummary does not mistake finance_calculation_input for a field leaf", () => {
  // finance_calculation_input has {label, value, unit, source_references} -
  // no requires_human_input/source_type/confidence - must not be counted.
  const data = {
    calculs_financiers: [
      {
        label: "Cash flow",
        formula: "a + b",
        inputs: [{ label: "a", value: 10, unit: "EUR", source_references: [] }],
        result: field(false),
        justification: "test",
        source_references: []
      }
    ]
  };

  const summary = computeFciModuleSummary(data);
  assert.equal(summary.human_inputs_required, 0);
  assert.equal(summary.completion_percentage, 100);
});
