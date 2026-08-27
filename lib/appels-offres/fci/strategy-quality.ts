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

function humanField(justification: string): FciAiField<string | null> {
  return {
    value: null,
    source_type: "internal_required",
    confidence: "none",
    requires_human_input: true,
    justification,
    source_references: []
  };
}

/**
 * Deterministic safety net applied after schema validation and before
 * persistence: strips any GO/NO-GO/final-decision language the model might
 * emit despite the prompt's explicit prohibition, mirroring the guardrail
 * pattern already used for module A (applyCommercialGenerationGuardrails).
 *
 * `decision_strategique_preliminaire`'s three fields are additionally
 * force-replaced unconditionally, not just scanned for GO/NO-GO language:
 * "DG's actual strategic priority", "priority market for management", and
 * "DG's own strategic comments" are real DG judgment calls the departmental
 * UI already renders as human-only (`d3_decision_preliminaire`, `sourceLabel:
 * "human"` independently of provider - see rendering.ts). This guardrail
 * makes that the same guarantee at the persistence layer, mirroring how A/B/C
 * force their own current-internal-state columns regardless of model output.
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
        importance_strategique_globale: humanField(
          "L'importance strategique globale releve du jugement de la Direction Generale."
        ),
        marche_prioritaire_pour_la_direction: humanField(
          "La priorisation de marche releve du jugement de la Direction Generale."
        ),
        commentaires_strategiques_de_la_direction_generale: humanField(
          "Les commentaires strategiques de la Direction Generale doivent etre saisis par elle-meme."
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

export type FciStrategyGroundingIssue = {
  path: string;
  reason: "unsupported_ai_inference" | "missing_source_excerpt";
};

export type FciStrategyGroundingEvidence = {
  fiche_cdc: unknown;
  commercial: FciJsonObject | null;
  finance: FciJsonObject | null;
  operations: FciJsonObject | null;
};

function collectFields(value: unknown, path = "data"): Array<[string, FciAiField<FciAiFieldValue>]> {
  if (!value || typeof value !== "object") return [];
  if ("source_type" in value && "source_references" in value && "value" in value) {
    return [[path, value as FciAiField<FciAiFieldValue>]];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    collectFields(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`)
  );
}

// Unlike the equivalent A/B/C helpers (whose evidence is a single Fiche),
// D's evidence is the JSON-serialized concatenation of up to three full
// validated module payloads. Over that much larger corpus, a bare substring
// check is unreliable both ways: lone single digits are near-certain to
// appear somewhere by coincidence (dates, ids, versions), and even a real
// multi-digit token like "20" would falsely "match" merely because it is a
// substring of an unrelated "2026". Require at least two digits and a
// digit-boundary check so a token only counts as grounded when it appears
// in the evidence as its own number, not as a fragment of a bigger one.
function numericTokens(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const matches = String(value).match(/\d[\d\s.,]*\d/g);
  return matches ?? [];
}

function hasUngroundedNumber(value: unknown, evidence: string): boolean {
  return numericTokens(value).some((token) => {
    const escaped = token.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const boundaryPattern = new RegExp(`(?<!\\d)${escaped}(?!\\d)`);
    return !boundaryPattern.test(evidence);
  });
}

function excerptsAreGrounded(references: { excerpt: string | null }[], evidence: string): boolean {
  const excerpts = references
    .map((reference) => reference.excerpt?.trim())
    .filter((excerpt): excerpt is string => Boolean(excerpt));
  return excerpts.length > 0 && excerpts.every((excerpt) => evidence.includes(excerpt.toLocaleLowerCase("fr-FR")));
}

/**
 * Rejects strategic claims that cannot be tied back to validated upstream
 * evidence: the validated Fiche, plus whichever of validated A/B/C were
 * actually available at launch (readFciStrategicSourceContext already
 * guarantees only VALIDATED contributions ever reach this evidence set -
 * this validator does not re-check validation status, only groundedness).
 * `ai_inference` is legitimate here - the strategy prompt explicitly permits
 * qualitative opportunity/threat/reference-value signals and a
 * `statut_revue_preliminaire` classification - so it is rejected only when
 * it smuggles in a hard number the combined evidence does not support,
 * exactly the class of "sounds reasonable but is invented" fact the prompt's
 * non-invention rules forbid. `fiche_cdc` claims keep the same
 * excerpt/value grounding check A/B/C use.
 */
export function validateStrategyGrounding(
  payload: FciStrategyPayload,
  sourceEvidence: FciStrategyGroundingEvidence
): FciStrategyGroundingIssue[] {
  const evidence = JSON.stringify(sourceEvidence).toLocaleLowerCase("fr-FR");
  const issues: FciStrategyGroundingIssue[] = [];

  for (const [path, field] of collectFields(payload.data)) {
    if (field.value == null) continue;
    const text = String(field.value);

    if (field.source_type === "ai_inference") {
      if (hasUngroundedNumber(field.value, evidence)) {
        issues.push({ path, reason: "unsupported_ai_inference" });
      }
      continue;
    }

    if (field.source_type !== "fiche_cdc") continue;
    const normalizedValue = text.trim().toLocaleLowerCase("fr-FR");
    const valueIsPresent = normalizedValue.length > 0 && evidence.includes(normalizedValue);
    const excerptsArePresent = excerptsAreGrounded(field.source_references, evidence);
    if (!valueIsPresent && !excerptsArePresent) {
      issues.push({ path, reason: "missing_source_excerpt" });
      continue;
    }
    if (hasUngroundedNumber(field.value, evidence)) {
      issues.push({ path, reason: "unsupported_ai_inference" });
    }
  }

  return issues;
}
