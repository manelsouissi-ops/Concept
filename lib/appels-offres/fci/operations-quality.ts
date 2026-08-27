import type {
  FciAiField,
  FciAiFieldValue,
  FciOperationsPayload
} from "./ai-contracts.ts";

export type FciOperationsGroundingIssue = {
  path: string;
  reason:
    | "unsupported_ai_inference"
    | "missing_source_excerpt"
    | "unsupported_historical_claim"
    | "unsupported_availability_claim";
};

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
 * Deterministic safety layer applied after schema validation and before
 * persistence. Mirrors the FCI A/B pattern: current internal operational
 * state — what CONCEPT actually has available or has already committed
 * right now — can never come from the model, regardless of what it
 * returned. This matches how the departmental UI already renders these
 * exact fields as human-sourced (rendering.ts's `mapAiPayloadToFciModulePayload`
 * already labels them `sourceLabel: "human"" independently of provider);
 * this guardrail makes that the same guarantee at the persistence layer.
 *
 * Deliberately NOT forced here: `probabilite_disponibilite_experts` and
 * `action_requise`/`commentaire_ou_risque`-style fields. The Operations
 * prompt explicitly permits a cautious probability/risk *signal* for those
 * ("inférer qu'un profil sera probablement requis", "signaler un risque de
 * coordination ou de mobilisation") — grounding validation below still
 * catches a fabricated hard number or an outright availability/historical
 * assertion hiding inside one.
 */
export function applyOperationsGenerationGuardrails(
  payload: FciOperationsPayload
): FciOperationsPayload {
  return {
    ...payload,
    data: {
      ...payload.data,
      capacite_absorption_globale: payload.data.capacite_absorption_globale.map((row) => ({
        ...row,
        quantite_disponible: humanField(
          "La quantité actuellement disponible relève de la logistique interne CONCEPT."
        ),
        membre_du_groupement_qui_lapporte: humanField(
          "L'engagement ferme d'un membre du groupement doit être confirmé en interne."
        ),
        disponible_au_demarrage: humanField(
          "La disponibilité réelle au démarrage doit être confirmée en interne."
        )
      })),
      repartition_des_composantes_techniques: payload.data.repartition_des_composantes_techniques.map(
        (row) => ({
          ...row,
          membre_responsable: humanField(
            "L'attribution interne d'un responsable relève de la coordination du groupement."
          ),
          experts_affectes: humanField(
            "L'affectation réelle des experts doit être confirmée en interne."
          )
        })
      )
    }
  };
}

function collectFields(value: unknown, path = "data"): Array<[string, FciAiField<FciAiFieldValue>]> {
  if (!value || typeof value !== "object") return [];
  if ("source_type" in value && "source_references" in value && "value" in value) {
    return [[path, value as FciAiField<FciAiFieldValue>]];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    collectFields(child, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`)
  );
}

function numericTokens(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const matches = String(value).match(/\d[\d\s.,]*\d|\d/g);
  return matches ?? [];
}

function hasUngroundedNumber(value: unknown, evidence: string): boolean {
  return numericTokens(value).some((token) => !evidence.includes(token.toLowerCase()));
}

function excerptsAreGrounded(references: { excerpt: string | null }[], evidence: string): boolean {
  const excerpts = references
    .map((reference) => reference.excerpt?.trim())
    .filter((excerpt): excerpt is string => Boolean(excerpt));
  return excerpts.length > 0 && excerpts.every((excerpt) => evidence.includes(excerpt.toLocaleLowerCase("fr-FR")));
}

// A confirmed-availability assertion about a current internal resource —
// exactly what the Operations prompt's non-invention rules forbid — stated
// as fact rather than as the cautious probability/risk signal the prompt
// permits.
// Not \b-delimited: JS's default word-boundary treats accented letters as
// non-word characters, so \b silently fails to match at the end of French
// words like "disponible" or "passé". These phrases are specific multi-word
// sequences, so plain substring alternation is precise enough on its own.
const AVAILABILITY_CLAIM_PATTERN =
  /(est disponible|sera disponible|disponibilit[ée] confirm[ée]e|confirm[ée]e? disponible|capacit[ée] confirm[ée]e|accord ferme|engagement ferme|is available|has confirmed availability)/i;

// A claim that CONCEPT (or the client) already has a track record — a
// historical/precedent fact — rather than a reading of the current CDC.
// This is precisely the class of claim a future targeted-RAG pass over
// historical projects would support with real evidence; today there is no
// such evidence, so the claim must be grounded in the current input or
// rejected.
const HISTORICAL_CLAIM_PATTERN =
  /(a d[ée]j[àa] [ée]t[ée]|d[ée]j[àa] r[ée]alis[ée]|pr[ée]c[ée]demment r[ée]alis[ée]|par le pass[ée]|habituellement|d'ordinaire|a fait ses preuves|projets? ant[ée]rieurs?|exp[ée]rience ant[ée]rieure|avait d[ée]j[àa]|d[ée]j[àa] travaill[ée])/i;

/**
 * Reject operational claims that cannot be tied back to the exact launch
 * evidence. `ai_inference` is a legitimate category here — the Operations
 * prompt explicitly permits inferring resource *categories* and cautious
 * risk/mobilization signals — so it is not rejected outright. It is rejected
 * when it smuggles in a hard number evidence does not support, an outright
 * current-availability assertion, or a historical/precedent claim: all three
 * are exactly the facts the prompt's non-invention rules forbid, dressed up
 * as a "cautious inference". `fiche_cdc` claims keep the same excerpt/value
 * grounding check FCI A and B use, plus the same three checks.
 */
export function validateOperationsGrounding(
  payload: FciOperationsPayload,
  sourceEvidence: unknown
): FciOperationsGroundingIssue[] {
  const evidence = JSON.stringify(sourceEvidence).toLocaleLowerCase("fr-FR");
  const issues: FciOperationsGroundingIssue[] = [];

  for (const [path, field] of collectFields(payload.data)) {
    if (field.value == null) continue;
    const text = String(field.value);

    if (field.source_type === "ai_inference") {
      if (hasUngroundedNumber(field.value, evidence)) {
        issues.push({ path, reason: "unsupported_ai_inference" });
        continue;
      }
      if (AVAILABILITY_CLAIM_PATTERN.test(text) && !evidence.includes(text.toLocaleLowerCase("fr-FR"))) {
        issues.push({ path, reason: "unsupported_availability_claim" });
        continue;
      }
      if (HISTORICAL_CLAIM_PATTERN.test(text) && !evidence.includes(text.toLocaleLowerCase("fr-FR"))) {
        issues.push({ path, reason: "unsupported_historical_claim" });
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
