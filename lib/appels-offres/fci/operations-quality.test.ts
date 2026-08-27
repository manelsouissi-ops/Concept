import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FciOperationsPayload } from "./ai-contracts.ts";
import {
  applyOperationsGenerationGuardrails,
  validateOperationsGrounding
} from "./operations-quality.ts";

function sampleOperations() {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "ai/examples/fci-operations.sample.json"), "utf8")
  ) as FciOperationsPayload;
}

test("current resource/assignment fields always stay null and human-required regardless of model output", () => {
  const payload = sampleOperations();
  payload.data.capacite_absorption_globale[0].quantite_disponible = {
    value: "3 véhicules disponibles",
    source_type: "ai_inference",
    confidence: "high",
    requires_human_input: false,
    justification: "Estime disponible",
    source_references: []
  };
  payload.data.capacite_absorption_globale[0].membre_du_groupement_qui_lapporte = {
    value: "SOCIETE X",
    source_type: "ai_inference",
    confidence: "medium",
    requires_human_input: false,
    justification: "Partenaire suppose",
    source_references: []
  };
  payload.data.capacite_absorption_globale[0].disponible_au_demarrage = {
    value: "Oui",
    source_type: "ai_inference",
    confidence: "high",
    requires_human_input: false,
    justification: "Suppose disponible",
    source_references: []
  };
  payload.data.repartition_des_composantes_techniques[0].membre_responsable = {
    value: "Chef de mission",
    source_type: "ai_inference",
    confidence: "medium",
    requires_human_input: false,
    justification: "Role suppose",
    source_references: []
  };
  payload.data.repartition_des_composantes_techniques[0].experts_affectes = {
    value: "Expert Hydraulicien",
    source_type: "ai_inference",
    confidence: "medium",
    requires_human_input: false,
    justification: "Affectation supposee",
    source_references: []
  };

  const guarded = applyOperationsGenerationGuardrails(payload);
  const capacity = guarded.data.capacite_absorption_globale[0];
  const role = guarded.data.repartition_des_composantes_techniques[0];
  for (const field of [
    capacity.quantite_disponible,
    capacity.membre_du_groupement_qui_lapporte,
    capacity.disponible_au_demarrage,
    role.membre_responsable,
    role.experts_affectes
  ]) {
    assert.equal(field.value, null);
    assert.equal(field.source_type, "internal_required");
    assert.equal(field.confidence, "none");
    assert.equal(field.requires_human_input, true);
  }
});

test("guardrails do not touch fields outside the five protected current-state columns", () => {
  const payload = sampleOperations();
  const guarded = applyOperationsGenerationGuardrails(payload);
  assert.deepEqual(guarded.data.disponibilite_des_experts_cles, payload.data.disponibilite_des_experts_cles);
  assert.deepEqual(guarded.data.disponibilite_des_experts_non_cles, payload.data.disponibilite_des_experts_non_cles);
  assert.equal(
    guarded.data.capacite_absorption_globale[0].designation_du_moyen,
    payload.data.capacite_absorption_globale[0].designation_du_moyen
  );
  assert.equal(
    guarded.data.repartition_des_composantes_techniques[0].composante_ou_tache,
    payload.data.repartition_des_composantes_techniques[0].composante_ou_tache
  );
});

test("grounding allows qualitative ai_inference risk/complexity signals with no hard numbers or confirmed facts", () => {
  const payload = sampleOperations();
  const issues = validateOperationsGrounding(payload, {
    fiche_cdc: { duree_totale: "24 mois", nombre_sites: "12" }
  });
  assert.equal(
    issues.some((issue) => issue.path === "data.synthese_operations.niveau_complexite_operationnelle"),
    false
  );
  assert.equal(
    issues.some((issue) => issue.path === "data.risques_coordination_mitigation.frequence_reunions_coordination"),
    false
  );
});

test("grounding rejects a fabricated availability count smuggled in as a cautious ai_inference", () => {
  const payload = sampleOperations();
  payload.data.capacite_absorption_globale[0].quantite_requise = {
    value: "7 véhicules nécessaires",
    source_type: "ai_inference",
    confidence: "medium",
    requires_human_input: false,
    justification: "Estimation prudente",
    source_references: []
  };
  const issues = validateOperationsGrounding(payload, { fiche_cdc: {} });
  assert.equal(
    issues.some((issue) =>
      issue.path === "data.capacite_absorption_globale[0].quantite_requise"
      && issue.reason === "unsupported_ai_inference"
    ),
    true
  );
});

test("grounding rejects a confirmed-availability assertion dressed up as an inference", () => {
  const payload = sampleOperations();
  payload.data.disponibilite_des_experts_cles[0].probabilite_disponibilite_experts = {
    value: "L'expert est disponible et confirme.",
    source_type: "ai_inference",
    confidence: "high",
    requires_human_input: false,
    justification: "Lecture du CDC",
    source_references: []
  };
  const issues = validateOperationsGrounding(payload, { fiche_cdc: {} });
  assert.equal(
    issues.some((issue) =>
      issue.path === "data.disponibilite_des_experts_cles[0].probabilite_disponibilite_experts"
      && issue.reason === "unsupported_availability_claim"
    ),
    true
  );
});

test("grounding rejects an unsupported historical/precedent claim", () => {
  const payload = sampleOperations();
  payload.data.repartition_des_composantes_techniques[0].commentaire_ou_risque = {
    value: "CONCEPT a déjà réalisé ce type de mission avec succès par le passé.",
    source_type: "ai_inference",
    confidence: "medium",
    requires_human_input: false,
    justification: "Signal de risque",
    source_references: []
  };
  const issues = validateOperationsGrounding(payload, { fiche_cdc: {} });
  assert.equal(
    issues.some((issue) =>
      issue.path === "data.repartition_des_composantes_techniques[0].commentaire_ou_risque"
      && issue.reason === "unsupported_historical_claim"
    ),
    true
  );
});

test("grounding rejects a fiche_cdc claim whose value is not actually in the evidence", () => {
  const payload = sampleOperations();
  payload.data.capacite_absorption_globale[0].designation_du_moyen = {
    value: "Drone topographique",
    source_type: "fiche_cdc",
    confidence: "high",
    requires_human_input: false,
    justification: "Materiel indique dans le CDC",
    source_references: [{ section: "Site & contraintes", field: "moyens_materiels", excerpt: null }]
  };
  const issues = validateOperationsGrounding(payload, { fiche_cdc: { moyens_materiels: "Véhicules" } });
  assert.equal(
    issues.some((issue) =>
      issue.path === "data.capacite_absorption_globale[0].designation_du_moyen"
      && issue.reason === "missing_source_excerpt"
    ),
    true
  );
});

test("active FCI C contract contains no GO/NO-GO or final DG decision field", () => {
  const prompt = readFileSync(path.join(process.cwd(), "ai/prompts/fci-operations.md"), "utf8");
  const schema = readFileSync(path.join(process.cwd(), "ai/schemas/fci-operations.schema.json"), "utf8");
  assert.equal(schema.includes("decision_finale"), false);
  assert.equal(schema.includes("go_no_go"), false);
  assert.equal(schema.includes("recommandation_finale"), false);
  assert.match(prompt, /disponibilité réelle d.experts/i);
});

test("rex/project-reference UI sections are not part of the AI contract and cannot be AI-populated", () => {
  const schema = JSON.parse(
    readFileSync(path.join(process.cwd(), "ai/schemas/fci-operations.schema.json"), "utf8")
  );
  const dataSchema = JSON.stringify(schema.properties?.data ?? {});
  // These are pure human-entry UI sections (rendering.ts), reserved for a
  // future targeted-RAG pass over historical projects. They must remain
  // absent from the raw AI schema so the model is never even asked to
  // produce them, regardless of provider.
  for (const key of ["rex_projet_reference", "rex_ecarts_couts", "rex_standards_client", "rex_recommandations"]) {
    assert.equal(dataSchema.includes(key), false);
  }
});
