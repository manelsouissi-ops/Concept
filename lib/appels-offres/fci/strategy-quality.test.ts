import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FciStrategyPayload } from "./ai-contracts.ts";
import { applyStrategyGenerationGuardrails } from "./strategy-quality.ts";

function sampleStrategy() {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "ai/examples/fci-strategy.sample.json"), "utf8")
  ) as FciStrategyPayload;
}

test("a clean strategic contribution passes through the guardrail unchanged", () => {
  const payload = sampleStrategy();
  const guarded = applyStrategyGenerationGuardrails(payload);
  assert.deepEqual(guarded.data, payload.data);
});

test("a leaked GO/NO-GO recommendation is neutralized to internal_required", () => {
  const payload = sampleStrategy();
  payload.data.decision_strategique_preliminaire.commentaires_strategiques_de_la_direction_generale = {
    value: "Recommandation : GO sur ce dossier compte tenu du potentiel de reference.",
    source_type: "ai_inference",
    confidence: "high",
    requires_human_input: false,
    justification: "Synthese",
    source_references: []
  };

  const guarded = applyStrategyGenerationGuardrails(payload);
  const field = guarded.data.decision_strategique_preliminaire.commentaires_strategiques_de_la_direction_generale;
  assert.equal(field.value, null);
  assert.equal(field.source_type, "internal_required");
  assert.equal(field.requires_human_input, true);
});

test("a leaked NO-GO verdict inside an array field is neutralized", () => {
  const payload = sampleStrategy();
  payload.data.synthese_direction.blocages_non_resolus = {
    value: ["Le dossier devrait recevoir un NO-GO en l'etat."],
    source_type: "ai_inference",
    confidence: "high",
    requires_human_input: false,
    justification: "Synthese",
    source_references: []
  };

  const guarded = applyStrategyGenerationGuardrails(payload);
  const field = guarded.data.synthese_direction.blocages_non_resolus;
  assert.equal(field.value, null);
  assert.equal(field.source_type, "internal_required");
  assert.equal(field.requires_human_input, true);
});

test("statut_revue_preliminaire stays an untouched preliminary-review signal, never a final decision", () => {
  const payload = sampleStrategy();
  const guarded = applyStrategyGenerationGuardrails(payload);
  assert.equal(
    guarded.data.synthese_direction.statut_revue_preliminaire.value,
    payload.data.synthese_direction.statut_revue_preliminaire.value
  );
  assert.notEqual(guarded.data.synthese_direction.statut_revue_preliminaire.value, "GO");
  assert.notEqual(guarded.data.synthese_direction.statut_revue_preliminaire.value, "NO-GO");
});

test("FCI D prompt and schema explicitly prohibit a final GO/NO-GO decision", () => {
  const prompt = readFileSync(path.join(process.cwd(), "ai/prompts/fci-strategy.md"), "utf8");
  const schema = readFileSync(path.join(process.cwd(), "ai/schemas/fci-strategy.schema.json"), "utf8");
  assert.match(prompt, /Ne retournez jamais.*GO.*NO-GO/i);
  assert.equal(schema.includes("\"GO\""), false);
  assert.equal(schema.includes("\"NO-GO\""), false);
});
