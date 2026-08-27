import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FciStrategyPayload } from "./ai-contracts.ts";
import {
  applyStrategyGenerationGuardrails,
  validateStrategyGrounding
} from "./strategy-quality.ts";

function sampleStrategy() {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "ai/examples/fci-strategy.sample.json"), "utf8")
  ) as FciStrategyPayload;
}

test("a clean strategic contribution passes through the guardrail unchanged outside decision_strategique_preliminaire", () => {
  const payload = sampleStrategy();
  const guarded = applyStrategyGenerationGuardrails(payload);
  assert.deepEqual(guarded.data.contexte_programme_valeur_strategique, payload.data.contexte_programme_valeur_strategique);
  assert.deepEqual(guarded.data.enjeux_reputationnels, payload.data.enjeux_reputationnels);
  assert.deepEqual(guarded.data.synthese_direction, payload.data.synthese_direction);
});

test("decision_strategique_preliminaire fields are always forced to human-required regardless of model output", () => {
  const payload = sampleStrategy();
  // The fixture itself ships an AI-inferred "Importante" verdict with a
  // source excerpt - exactly the kind of DG judgment call the guardrail must
  // now always overwrite, matching how the departmental UI already renders
  // this entire section as human-only (d3_decision_preliminaire in
  // rendering.ts) independently of what the model produced.
  assert.notEqual(payload.data.decision_strategique_preliminaire.importance_strategique_globale.value, null);

  const guarded = applyStrategyGenerationGuardrails(payload);
  for (const field of [
    guarded.data.decision_strategique_preliminaire.importance_strategique_globale,
    guarded.data.decision_strategique_preliminaire.marche_prioritaire_pour_la_direction,
    guarded.data.decision_strategique_preliminaire.commentaires_strategiques_de_la_direction_generale
  ]) {
    assert.equal(field.value, null);
    assert.equal(field.source_type, "internal_required");
    assert.equal(field.confidence, "none");
    assert.equal(field.requires_human_input, true);
  }
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

function noEvidence() {
  return { fiche_cdc: {}, commercial: null, finance: null, operations: null };
}

test("grounding allows a qualitative ai_inference strategic signal with no unsupported hard numbers", () => {
  const payload = sampleStrategy();
  const issues = validateStrategyGrounding(payload, {
    fiche_cdc: { projet_rattachement: "Programme AEP Urbain 2026-2030" },
    commercial: null,
    finance: null,
    operations: null
  });
  assert.equal(
    issues.some((issue) => issue.path === "data.contexte_programme_valeur_strategique.inscription_dans_un_programme_pluriannuel"),
    false
  );
});

test("grounding rejects a fabricated statistic smuggled in as a cautious ai_inference", () => {
  const payload = sampleStrategy();
  payload.data.contexte_programme_valeur_strategique.valeur_estimee_des_futurs_lots = {
    value: "Environ 12 futurs lots pour 45 millions d'euros.",
    source_type: "ai_inference",
    confidence: "medium",
    requires_human_input: false,
    justification: "Estimation prudente",
    source_references: []
  };
  const issues = validateStrategyGrounding(payload, noEvidence());
  assert.equal(
    issues.some((issue) =>
      issue.path === "data.contexte_programme_valeur_strategique.valeur_estimee_des_futurs_lots"
      && issue.reason === "unsupported_ai_inference"
    ),
    true
  );
});

test("grounding accepts an ai_inference number that is actually present in validated upstream evidence", () => {
  const payload = sampleStrategy();
  payload.data.contexte_programme_valeur_strategique.valeur_estimee_des_futurs_lots = {
    value: "Environ 12 futurs lots.",
    source_type: "ai_inference",
    confidence: "medium",
    requires_human_input: false,
    justification: "Estimation coherente avec la contribution Commerciale validee",
    source_references: []
  };
  const issues = validateStrategyGrounding(payload, {
    fiche_cdc: {},
    commercial: { nombre_lots_futurs: "12" },
    finance: null,
    operations: null
  });
  assert.equal(
    issues.some((issue) => issue.path === "data.contexte_programme_valeur_strategique.valeur_estimee_des_futurs_lots"),
    false
  );
});

test("grounding rejects a fiche_cdc claim whose value is not actually in the evidence", () => {
  const payload = sampleStrategy();
  payload.data.contexte_programme_valeur_strategique.positionnement_geographique_vise = {
    value: "Expansion vers l'Afrique de l'Est",
    source_type: "fiche_cdc",
    confidence: "high",
    requires_human_input: false,
    justification: "Indique dans le CDC",
    source_references: [{ section: "Identification", field: "zone_execution", excerpt: null }]
  };
  const issues = validateStrategyGrounding(payload, {
    fiche_cdc: { zone_execution: "Afrique de l'Ouest" },
    commercial: null,
    finance: null,
    operations: null
  });
  assert.equal(
    issues.some((issue) =>
      issue.path === "data.contexte_programme_valeur_strategique.positionnement_geographique_vise"
      && issue.reason === "missing_source_excerpt"
    ),
    true
  );
});

test("grounding does not reject internal_required placeholders left null by the guardrail", () => {
  const payload = sampleStrategy();
  const guarded = applyStrategyGenerationGuardrails(payload);
  const issues = validateStrategyGrounding(guarded, noEvidence());
  assert.equal(
    issues.some((issue) => issue.path.startsWith("data.decision_strategique_preliminaire")),
    false
  );
});
