import type {
  FciAiField,
  FciAiFieldValue,
  FciFinancePayload
} from "./ai-contracts.ts";

export type FciFinanceGroundingIssue = {
  path: string;
  reason: "unsupported_ai_inference" | "missing_source_excerpt" | "ungrounded_financial_input";
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
 * persistence. Mirrors commercial-quality.ts's pattern for FCI A: current/
 * internal financial policy inputs can never come from the model, regardless
 * of what it returned.
 */
export function applyFinanceGenerationGuardrails(
  payload: FciFinancePayload
): FciFinancePayload {
  return {
    ...payload,
    data: {
      ...payload.data,
      elements_financiers_internes: {
        ...payload.data.elements_financiers_internes,
        taux_de_change_applique_et_source: humanField(
          "Le taux de change et sa source doivent être confirmés par la Direction Financière."
        ),
        coefficient_de_charges_de_structure: humanField(
          "Le coefficient de charges de structure relève de la politique financière interne."
        ),
        marge_cible_visee: humanField(
          "La marge cible visée relève exclusivement de la stratégie financière interne."
        )
      }
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

/** Numeric substrings (amounts, percentages, coefficients) present in a value. */
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

/**
 * Reject financial claims that cannot be tied back to the exact launch
 * evidence. Unlike FCI A, `ai_inference` is a legitimate category here (the
 * Finance prompt explicitly permits "une lecture prudente du risque
 * financier" — a qualitative cash-flow/guarantee risk signal) so it is not
 * rejected outright. It is rejected only when it smuggles in a hard number
 * (an amount, percentage, or coefficient) that evidence does not support —
 * a plausible-but-invented figure dressed up as a cautious inference.
 * `fiche_cdc` claims keep the same excerpt/value grounding check FCI A uses,
 * plus the same numeric check.
 *
 * `calculs_financiers` is handled separately: its `result` is expected to be
 * genuinely computed rather than quoted, so it is not held to the literal
 * evidence-match bar; instead every non-null `inputs[]` value that fed the
 * calculation must itself be grounded, since a calculation is only as
 * trustworthy as its operands.
 */
export function validateFinanceGrounding(
  payload: FciFinancePayload,
  sourceEvidence: unknown
): FciFinanceGroundingIssue[] {
  const evidence = JSON.stringify(sourceEvidence).toLocaleLowerCase("fr-FR");
  const issues: FciFinanceGroundingIssue[] = [];
  const { calculs_financiers: calculations, ...groundedData } = payload.data;

  for (const [path, field] of collectFields(groundedData)) {
    if (field.value == null) continue;
    if (field.source_type === "ai_inference") {
      if (hasUngroundedNumber(field.value, evidence)) {
        issues.push({ path, reason: "unsupported_ai_inference" });
      }
      continue;
    }
    if (field.source_type !== "fiche_cdc") continue;
    const normalizedValue = String(field.value).trim().toLocaleLowerCase("fr-FR");
    const valueIsPresent = normalizedValue.length > 0 && evidence.includes(normalizedValue);
    const excerptsArePresent = excerptsAreGrounded(field.source_references, evidence);
    if (!valueIsPresent && !excerptsArePresent) {
      issues.push({ path, reason: "missing_source_excerpt" });
      continue;
    }
    if (hasUngroundedNumber(field.value, evidence)) {
      issues.push({ path, reason: "ungrounded_financial_input" });
    }
  }

  calculations.forEach((calculation, calculationIndex) => {
    calculation.inputs.forEach((input, inputIndex) => {
      if (input.value == null) return;
      const normalizedValue = String(input.value).trim().toLocaleLowerCase("fr-FR");
      const valueIsPresent = normalizedValue.length > 0 && evidence.includes(normalizedValue);
      const excerptsArePresent = excerptsAreGrounded(input.source_references, evidence);
      if (!valueIsPresent && !excerptsArePresent) {
        issues.push({
          path: `data.calculs_financiers[${calculationIndex}].inputs[${inputIndex}]`,
          reason: "ungrounded_financial_input"
        });
      }
    });
  });

  return issues;
}
