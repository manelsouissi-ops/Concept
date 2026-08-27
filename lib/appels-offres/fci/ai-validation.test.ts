import test from "node:test";
import assert from "node:assert/strict";
import { validateFciAiPayload } from "./ai-validation.ts";

function fciField(value: string | null, overrides: Record<string, unknown> = {}) {
  return {
    value,
    source_type: value === null ? "internal_required" : "fiche_cdc",
    confidence: value === null ? "none" : "high",
    requires_human_input: value === null,
    justification: "test",
    source_references: [],
    ...overrides
  };
}

function minimalValidOperationsPayload() {
  return {
    contract_version: "1.0",
    module_code: "C",
    module_type: "operations",
    generated_at: new Date().toISOString(),
    data: {
      disponibilite_des_experts_cles: [],
      disponibilite_des_experts_non_cles: [],
      capacite_absorption_globale: [],
      repartition_des_composantes_techniques: [],
      risques_coordination_mitigation: {
        partenaires_non_encore_eprouves: fciField("Moyen"),
        frequence_reunions_coordination: fciField("Hebdomadaire"),
        risque_penalites_internes_groupement: fciField("Faible"),
        controle_qualite_livrables_partenaires: fciField("Standard"),
        risques_vis_a_vis_partenaires: fciField("Moyen"),
        risques_vis_a_vis_consultants_externes: fciField("Faible")
      },
      synthese_operations: {
        niveau_complexite_operationnelle: fciField("Moyenne"),
        points_blocage_operations: fciField(null, { value: null }),
        informations_internes_requises: fciField(null, { value: null })
      }
    },
    ai_notes: [],
    validation_warnings: []
  };
}

test("validateFciAiPayload tolerates a mis-cased source_references key on one field", () => {
  const payload = minimalValidOperationsPayload();
  const misCasedField = payload.data.risques_coordination_mitigation
    .risques_vis_a_vis_partenaires as Record<string, unknown>;
  delete misCasedField.source_references;
  misCasedField.source_References = [];

  const result = validateFciAiPayload("C", payload);

  assert.equal(result.ok, true);
  if (result.ok) {
    const normalizedField = result.data.data.risques_coordination_mitigation
      .risques_vis_a_vis_partenaires as Record<string, unknown>;
    assert.deepEqual(normalizedField.source_references, []);
    assert.equal(normalizedField.source_References, undefined);
  }
});

test("validateFciAiPayload still rejects a payload with a genuinely missing source_references key", () => {
  const payload = minimalValidOperationsPayload();
  const brokenField = payload.data.risques_coordination_mitigation
    .risques_vis_a_vis_partenaires as Record<string, unknown>;
  delete brokenField.source_references;

  const result = validateFciAiPayload("C", payload);

  assert.equal(result.ok, false);
});

test("validateFciAiPayload does not silently repair an arbitrary unknown/misspelled key", () => {
  const payload = minimalValidOperationsPayload();
  const brokenField = payload.data.risques_coordination_mitigation
    .risques_vis_a_vis_partenaires as Record<string, unknown>;
  // "sources_reference" is not a recognized casing variant of any of the six
  // known wrapper keys - it must be left exactly as-is (not renamed, not
  // dropped) and must still trip additionalProperties/required.
  delete brokenField.source_references;
  brokenField.sources_reference = [];

  const result = validateFciAiPayload("C", payload);

  assert.equal(result.ok, false);
});

function minimalValidStrategyPayload() {
  return {
    contract_version: "1.0",
    module_code: "D",
    module_type: "strategy",
    generated_at: new Date().toISOString(),
    data: {
      contexte_programme_valeur_strategique: {
        inscription_dans_un_programme_pluriannuel: fciField("Oui"),
        valeur_estimee_des_futurs_lots: fciField(null, { value: null }),
        positionnement_geographique_vise: fciField("Cote d'Ivoire"),
        valeur_comme_reference: fciField("Forte")
      },
      enjeux_reputationnels: {
        risque_en_cas_de_sous_performance: fciField("Eleve"),
        risque_en_cas_de_perte: fciField("Modere"),
        valeur_de_test_ou_apprentissage: fciField("Oui")
      },
      decision_strategique_preliminaire: {
        importance_strategique_globale: fciField(null, { value: null }),
        marche_prioritaire_pour_la_direction: fciField(null, { value: null }),
        commentaires_strategiques_de_la_direction_generale: fciField(null, { value: null })
      },
      synthese_direction: {
        statut_revue_preliminaire: fciField("conditional_review", { source_type: "ai_inference", confidence: "medium" }),
        opportunites_majeures: fciField(null, { value: null }),
        menaces_majeures: fciField(null, { value: null }),
        questions_pour_la_direction: fciField(null, { value: null }),
        blocages_non_resolus: fciField(null, { value: null })
      }
    },
    ai_notes: [],
    validation_warnings: []
  };
}

test("validateFciAiPayload's shared key normalization also tolerates a mis-cased source_references key on FCI D", () => {
  const payload = minimalValidStrategyPayload();
  const misCasedField = payload.data.enjeux_reputationnels
    .risque_en_cas_de_sous_performance as Record<string, unknown>;
  delete misCasedField.source_references;
  misCasedField.source_References = [];

  const result = validateFciAiPayload("D", payload);

  assert.equal(result.ok, true);
  if (result.ok) {
    const normalizedField = result.data.data.enjeux_reputationnels
      .risque_en_cas_de_sous_performance as Record<string, unknown>;
    assert.deepEqual(normalizedField.source_references, []);
    assert.equal(normalizedField.source_References, undefined);
  }
});

test("validateFciAiPayload does not alter unrelated business content", () => {
  const payload = minimalValidOperationsPayload();
  payload.data.capacite_absorption_globale = [
    {
      designation_du_moyen: fciField("Vehicules 4x4"),
      quantite_requise: fciField("2"),
      quantite_disponible: fciField(null),
      membre_du_groupement_qui_lapporte: fciField(null),
      disponible_au_demarrage: fciField(null),
      ecart: fciField(null)
    }
  ] as never;

  const result = validateFciAiPayload("C", payload);

  assert.equal(result.ok, true);
  if (result.ok) {
    const row = result.data.data.capacite_absorption_globale[0] as Record<
      string,
      { value: unknown }
    >;
    assert.equal(row.designation_du_moyen.value, "Vehicules 4x4");
  }
});
