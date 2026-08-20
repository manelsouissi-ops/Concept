import type { FciAiField, FciAiFieldValue, FciStrategyPayload } from "./ai-contracts.ts";
import type { FciDetail, FciJsonObject } from "./types.ts";
import { indexLatestModuleData } from "./presentation.ts";

export type FciStrategicContributionContext = {
  available: boolean;
  validated_at: string | null;
  data: FciJsonObject | null;
};

export type FciStrategicSourceContext = {
  commercial: FciStrategicContributionContext;
  finance: FciStrategicContributionContext;
  operations: FciStrategicContributionContext;
};

const CONTRIBUTION_KEY_BY_MODULE = {
  A: "commercial",
  B: "finance",
  C: "operations"
} as const satisfies Record<"A" | "B" | "C", keyof FciStrategicSourceContext>;

/**
 * Builds FCI D's AI input context from the currently VALIDATED A/B/C
 * contributions only (never a draft/needs_review artifact). A module's
 * latest data version is authoritative for its validated content because
 * saveFciModuleEdits keeps status "validated" only when an edit is applied
 * to an already-validated module, and any AI regeneration always resets
 * status back to "needs_review" - so "status === validated" and "latest
 * version" never diverge in practice.
 */
export function readFciStrategicSourceContext(detail: FciDetail): FciStrategicSourceContext {
  const latestByModuleId = indexLatestModuleData(detail.moduleData);
  const context: FciStrategicSourceContext = {
    commercial: { available: false, validated_at: null, data: null },
    finance: { available: false, validated_at: null, data: null },
    operations: { available: false, validated_at: null, data: null }
  };

  for (const moduleCode of ["A", "B", "C"] as const) {
    const module = detail.modules.find((item) => item.moduleCode === moduleCode);
    if (!module || module.status !== "validated") {
      continue;
    }

    const latestData = latestByModuleId.get(module.id);
    if (!latestData) {
      continue;
    }

    const key = CONTRIBUTION_KEY_BY_MODULE[moduleCode];
    const rawData = (latestData.dataJson as { data?: FciJsonObject } | null)?.data ?? null;
    context[key] = {
      available: true,
      validated_at: module.validatedAt,
      data: rawData
    };
  }

  return context;
}

const GO_NO_GO_PATTERN = /\b(no[- ]?go)\b|\bgo\b|d[ée]cision\s+finale|acceptation\s+finale|refus\s+final/i;

function containsGoNoGoLanguage(value: string) {
  return GO_NO_GO_PATTERN.test(value);
}

function fieldContainsGoNoGo(value: FciAiFieldValue): boolean {
  if (typeof value === "string") {
    return containsGoNoGoLanguage(value);
  }
  if (Array.isArray(value)) {
    return value.some((item) => typeof item === "string" && containsGoNoGoLanguage(item));
  }
  return false;
}

const GO_NO_GO_LEAK_REASON =
  "Contenu neutralise : une decision finale Go/No-Go ne peut pas etre emise par la contribution strategique D, elle releve de la decision finale ulterieure de la Direction Generale.";

function guardField<TValue extends FciAiFieldValue>(
  field: FciAiField<TValue>
): FciAiField<TValue | null> {
  if (!fieldContainsGoNoGo(field.value)) {
    return field;
  }

  return {
    value: null,
    source_type: "internal_required",
    confidence: "none",
    requires_human_input: true,
    justification: GO_NO_GO_LEAK_REASON,
    source_references: []
  };
}

/**
 * Deterministic safety net applied after schema validation and before
 * persistence: strips any GO/NO-GO/final-decision language the model might
 * emit despite the prompt's explicit prohibition, mirroring the guardrail
 * pattern already used for module A (applyCommercialGenerationGuardrails).
 */
export function applyStrategyGenerationGuardrails(
  payload: FciStrategyPayload
): FciStrategyPayload {
  const { data } = payload;

  return {
    ...payload,
    data: {
      contexte_programme_valeur_strategique: {
        inscription_dans_un_programme_pluriannuel: guardField(
          data.contexte_programme_valeur_strategique.inscription_dans_un_programme_pluriannuel
        ),
        valeur_estimee_des_futurs_lots: guardField(
          data.contexte_programme_valeur_strategique.valeur_estimee_des_futurs_lots
        ),
        positionnement_geographique_vise: guardField(
          data.contexte_programme_valeur_strategique.positionnement_geographique_vise
        ),
        valeur_comme_reference: guardField(
          data.contexte_programme_valeur_strategique.valeur_comme_reference
        )
      },
      enjeux_reputationnels: {
        risque_en_cas_de_sous_performance: guardField(
          data.enjeux_reputationnels.risque_en_cas_de_sous_performance
        ),
        risque_en_cas_de_perte: guardField(data.enjeux_reputationnels.risque_en_cas_de_perte),
        valeur_de_test_ou_apprentissage: guardField(
          data.enjeux_reputationnels.valeur_de_test_ou_apprentissage
        )
      },
      decision_strategique_preliminaire: {
        importance_strategique_globale: guardField(
          data.decision_strategique_preliminaire.importance_strategique_globale
        ),
        marche_prioritaire_pour_la_direction: guardField(
          data.decision_strategique_preliminaire.marche_prioritaire_pour_la_direction
        ),
        commentaires_strategiques_de_la_direction_generale: guardField(
          data.decision_strategique_preliminaire.commentaires_strategiques_de_la_direction_generale
        )
      },
      synthese_direction: {
        statut_revue_preliminaire: data.synthese_direction.statut_revue_preliminaire,
        opportunites_majeures: guardField(data.synthese_direction.opportunites_majeures),
        menaces_majeures: guardField(data.synthese_direction.menaces_majeures),
        questions_pour_la_direction: guardField(data.synthese_direction.questions_pour_la_direction),
        blocages_non_resolus: guardField(data.synthese_direction.blocages_non_resolus)
      }
    }
  };
}
