import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FciFinancePayload } from "./ai-contracts.ts";
import {
  applyFinanceGenerationGuardrails,
  validateFinanceGrounding
} from "./finance-quality.ts";

function sampleFinance() {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "ai/examples/fci-finance.sample.json"), "utf8")
  ) as FciFinancePayload;
}

test("financial human-only fields always stay null and human-required regardless of model output", () => {
  const payload = sampleFinance();
  payload.data.elements_financiers_internes.taux_de_change_applique_et_source = {
    value: "1 EUR = 655,957 XOF",
    source_type: "ai_inference",
    confidence: "high",
    requires_human_input: false,
    justification: "Taux usuel suppose",
    source_references: []
  };
  payload.data.elements_financiers_internes.coefficient_de_charges_de_structure = {
    value: "12%",
    source_type: "ai_inference",
    confidence: "medium",
    requires_human_input: false,
    justification: "Coefficient suppose",
    source_references: []
  };
  payload.data.elements_financiers_internes.marge_cible_visee = {
    value: "15%",
    source_type: "ai_inference",
    confidence: "medium",
    requires_human_input: false,
    justification: "Marge supposee",
    source_references: []
  };

  const guarded = applyFinanceGenerationGuardrails(payload);
  for (const field of [
    guarded.data.elements_financiers_internes.taux_de_change_applique_et_source,
    guarded.data.elements_financiers_internes.coefficient_de_charges_de_structure,
    guarded.data.elements_financiers_internes.marge_cible_visee
  ]) {
    assert.equal(field.value, null);
    assert.equal(field.source_type, "internal_required");
    assert.equal(field.confidence, "none");
    assert.equal(field.requires_human_input, true);
  }
});

test("guardrails do not touch fields outside the three protected internal inputs", () => {
  const payload = sampleFinance();
  const guarded = applyFinanceGenerationGuardrails(payload);
  assert.deepEqual(
    guarded.data.elements_financiers_internes.budget_estime_du_marche,
    payload.data.elements_financiers_internes.budget_estime_du_marche
  );
  assert.deepEqual(guarded.data.cash_flow_par_jalon, payload.data.cash_flow_par_jalon);
  assert.deepEqual(guarded.data.calculs_financiers, payload.data.calculs_financiers);
});

test("grounding allows qualitative ai_inference risk signals with no hard numbers", () => {
  const payload = sampleFinance();
  const issues = validateFinanceGrounding(payload, {
    fiche_cdc: { livrables_principaux: "Rapport de démarrage" },
    controle: { champsNonTrouves: "Modalités détaillées de paiement, Cautions exactes" }
  });
  assert.equal(
    issues.some((issue) => issue.path === "data.synthese_financiere.pression_tresorerie_preliminaire"),
    false
  );
  assert.equal(
    issues.some((issue) => issue.path === "data.cash_flow_par_jalon[0].risque_cash_flow"),
    false
  );
});

test("grounding rejects a fabricated number smuggled in as a cautious ai_inference", () => {
  const payload = sampleFinance();
  payload.data.synthese_financiere.pression_tresorerie_preliminaire = {
    value: "Deficit de tresorerie estime a 45000 EUR sur le premier trimestre",
    source_type: "ai_inference",
    confidence: "medium",
    requires_human_input: false,
    justification: "Lecture prudente",
    source_references: []
  };
  const issues = validateFinanceGrounding(payload, { fiche_cdc: {} });
  assert.equal(
    issues.some((issue) =>
      issue.path === "data.synthese_financiere.pression_tresorerie_preliminaire"
      && issue.reason === "unsupported_ai_inference"
    ),
    true
  );
});

test("grounding rejects a fiche_cdc claim whose value is not actually in the evidence", () => {
  const payload = sampleFinance();
  payload.data.elements_financiers_internes.budget_estime_du_marche = {
    value: "1 200 000 EUR",
    source_type: "fiche_cdc",
    confidence: "high",
    requires_human_input: false,
    justification: "Budget indique dans le CDC",
    source_references: [{ section: "Financement", field: "source_financement", excerpt: null }]
  };
  const issues = validateFinanceGrounding(payload, { fiche_cdc: { source_financement: "IDA" } });
  assert.equal(
    issues.some((issue) =>
      issue.path === "data.elements_financiers_internes.budget_estime_du_marche"
      && issue.reason === "missing_source_excerpt"
    ),
    true
  );
});

test("grounding rejects an ungrounded calculation input regardless of the arithmetic", () => {
  const payload = sampleFinance();
  payload.data.calculs_financiers[0].inputs[0] = {
    label: "jalons_documentes",
    value: 7,
    unit: "jalon",
    source_references: [{ section: "Livrables & profils", field: "livrables_principaux", excerpt: "Sept jalons distincts" }]
  };
  const issues = validateFinanceGrounding(payload, { fiche_cdc: { livrables_principaux: "Rapport de démarrage" } });
  assert.equal(
    issues.some((issue) => issue.path === "data.calculs_financiers[0].inputs[0]"),
    true
  );
});

test("grounding does not require the computed result itself to be a literal quote", () => {
  const payload = sampleFinance();
  const issues = validateFinanceGrounding(payload, {
    fiche_cdc: { livrables_principaux: "Rapport de démarrage" },
    controle: { champsNonTrouves: "Modalités détaillées de paiement" }
  });
  assert.equal(
    issues.some((issue) => issue.path.startsWith("data.calculs_financiers[0].result")),
    false
  );
});

test("active FCI B contract contains no GO/NO-GO or final financial approval field", () => {
  const prompt = readFileSync(path.join(process.cwd(), "ai/prompts/fci-finance.md"), "utf8");
  const schema = readFileSync(path.join(process.cwd(), "ai/schemas/fci-finance.schema.json"), "utf8");
  assert.equal(schema.includes("decision_finale"), false);
  assert.equal(schema.includes("validation_finale"), false);
  assert.equal(schema.includes("go_no_go"), false);
  assert.match(prompt, /validation finale de la direction financière/i);
});
