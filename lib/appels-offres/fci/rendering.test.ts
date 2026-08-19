import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateFciPayloadCompletion,
  createEmptyFciModulePayload,
  getFciFieldDefinition,
  getFciModuleDefinition,
  getFciModuleDefinitions,
  normalizeStoredFciModulePayload
} from "./rendering.ts";

test("all four departmental contributions are human-visible", () => {
  const definitions = getFciModuleDefinitions();
  assert.deepEqual(
    definitions.map((item) => item.moduleCode),
    ["A", "B", "C", "D"]
  );
});

test("A-D rendering definitions all exist, including the hidden DG module D", () => {
  const definitions = getFciModuleDefinitions({ includeHidden: true });
  assert.deepEqual(
    definitions.map((item) => item.moduleCode),
    ["A", "B", "C", "D"]
  );
});

test("E has no active editable definition", () => {
  assert.equal(getFciModuleDefinition("A")?.moduleCode, "A");
  assert.equal(getFciModuleDefinition("E" as never), null);
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

function deadlineDefaults(sourceDeadline: string | null, dateDepot: string | null = null) {
  return {
    codeInterne: "AO-DEADLINE",
    intituleOffre: "Offre deadline",
    dateDepot,
    sourceDeadline,
    sourceFiche: {
      code_interne: "AO-DEADLINE",
      version: "validated:now",
      hash: "hash",
      status: "validated" as const,
      validated_at: "2026-07-27T12:00:00.000Z"
    }
  };
}

test("validated Fiche deadline wins when dossier due date is blank", () => {
  const payload = createEmptyFciModulePayload(
    "A",
    deadlineDefaults("16/10/2025 à 10 heures 00 mn GMT")
  );
  const identification = payload.data.identification_commune as Record<string, { value: unknown }>;
  assert.equal(identification.date_depot.value, "2025-10-16");
});

test("pending, ambiguous and not-found deadline states never fabricate a date", () => {
  for (const [raw, expected] of [
    ["Date communiquée ultérieurement", "Date communiquée ultérieurement"],
    ["16/10/2025 ou 23/10/2025", "16/10/2025 ou 23/10/2025"],
    ["Non trouvé", null]
  ] as const) {
    const payload = createEmptyFciModulePayload("A", deadlineDefaults(raw));
    const identification = payload.data.identification_commune as Record<string, { value: unknown }>;
    assert.equal(identification.date_depot.value, expected);
  }
});

test("legacy transit prose is normalized blank while integer days are preserved", () => {
  const legacyBase = {
    contract_version: "1.0",
    module_code: "A",
    module_type: "commercial",
    generated_at: null,
    source_fiche: deadlineDefaults(null).sourceFiche,
    summary: { status: "partial", completion_percentage: 0, human_inputs_required: 0, warnings: [] },
    ai_notes: [],
    validation_warnings: [],
    data: {
      identification_opportunite: {},
      concurrents_premiere_lecture: [],
      positionnement_offre: {},
      points_logistiques_internes: {
        delai_de_transit_necessaire: {
          value: "Déposer avant le 16/10/2025 à Abidjan",
          source_type: "ai_inference",
          confidence: "low",
          requires_human_input: true,
          justification: "test",
          source_references: []
        }
      }
    }
  };
  const prose = normalizeStoredFciModulePayload("A", legacyBase, deadlineDefaults(null));
  const proseLogistics = prose.data.a3_logistique_interne as Record<string, { value: unknown }>;
  assert.equal(proseLogistics.delai_transit_jours.value, null);

  const integerLegacy = structuredClone(legacyBase);
  integerLegacy.data.points_logistiques_internes.delai_de_transit_necessaire.value = "4";
  const integer = normalizeStoredFciModulePayload("A", integerLegacy, deadlineDefaults(null));
  const integerLogistics = integer.data.a3_logistique_interne as Record<string, { value: unknown }>;
  assert.equal(integerLogistics.delai_transit_jours.value, 4);
});

test("legacy GO and operations-only fields remain readable but are not active A UI fields", () => {
  const legacy = {
    contract_version: "1.0",
    module_code: "A",
    module_type: "commercial",
    generated_at: null,
    source_fiche: deadlineDefaults(null).sourceFiche,
    summary: { status: "partial", completion_percentage: 0, human_inputs_required: 0, warnings: [] },
    ai_notes: [],
    validation_warnings: [],
    data: {
      identification_opportunite: {},
      concurrents_premiere_lecture: [],
      positionnement_offre: {},
      points_logistiques_internes: {
        autres_contraintes_internes: {
          value: "Plan opérationnel",
          source_type: "ai_inference",
          confidence: "low",
          requires_human_input: false,
          justification: "legacy",
          source_references: []
        }
      },
      synthese_commerciale: {
        recommandation_revue_commerciale: {
          value: "GO",
          source_type: "ai_inference",
          confidence: "high",
          requires_human_input: false,
          justification: "legacy",
          source_references: []
        }
      }
    }
  };
  const normalized = normalizeStoredFciModulePayload("A", legacy, deadlineDefaults(null));
  assert.equal("synthese_commerciale" in normalized.data, false);
  const logistics = normalized.data.a3_logistique_interne as Record<string, unknown>;
  assert.equal("autres_contraintes_internes" in logistics, false);
});
