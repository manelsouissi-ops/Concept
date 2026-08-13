import test from "node:test";
import assert from "node:assert/strict";
import {
  formatFciClientErrorMessage,
  formatFciSourceLabel,
  getFciContributionStatusKey,
  getFciFormStatusPresentation,
  getFciGenerationFailurePresentation,
  getOtherContributionStatusPresentation,
  getOwnContributionActionLabel,
  getOwnContributionStatusPresentation,
  isFciTransientProviderFailure,
  shouldDisplayFciConfidenceBadge
} from "./ui.ts";

test("form status labels stay aligned with the simplified French workflow", () => {
  assert.equal(getFciFormStatusPresentation("not_started").label, "Non commencé");
  assert.equal(getFciFormStatusPresentation("draft").label, "Brouillon");
  assert.equal(getFciFormStatusPresentation("ready_for_review").label, "À vérifier");
  assert.equal(getFciFormStatusPresentation("completed").label, "Terminé");
});

test("PDF unavailable errors are mapped to a controlled user-facing message", () => {
  assert.equal(
    formatFciClientErrorMessage({
      code: "FCI_EXPORT_PDF_UNAVAILABLE",
      message: "technical"
    }),
    "L’export PDF n’est pas disponible sur cet environnement. Le téléchargement Word reste disponible."
  );
});

test("contribution status key covers not_started/in_progress/ready/validated/stale", () => {
  assert.equal(
    getFciContributionStatusKey({
      status: "not_started",
      hasData: false,
      readyForCompletion: false,
      staleSource: false,
      hasFailedGeneration: false
    }),
    "not_started"
  );
  assert.equal(
    getFciContributionStatusKey({
      status: "generated",
      hasData: true,
      readyForCompletion: false,
      staleSource: false,
      hasFailedGeneration: false
    }),
    "in_progress"
  );
  assert.equal(
    getFciContributionStatusKey({
      status: "needs_review",
      hasData: true,
      readyForCompletion: true,
      staleSource: false,
      hasFailedGeneration: false
    }),
    "ready_to_validate"
  );
  assert.equal(
    getFciContributionStatusKey({
      status: "validated",
      hasData: true,
      readyForCompletion: true,
      staleSource: false,
      hasFailedGeneration: false
    }),
    "validated"
  );
  // A validated module whose source Fiche CDC has since changed must read as
  // needing re-verification, not as a clean "Validée" - this is the same
  // signal the canonical readiness gate uses to avoid the FCI/Go-No-Go
  // contradiction (see tender-stage.test.ts).
  assert.equal(
    getFciContributionStatusKey({
      status: "validated",
      hasData: true,
      readyForCompletion: true,
      staleSource: true,
      hasFailedGeneration: false
    }),
    "stale_validated"
  );
});

// A. A Gemini 503 (or any unresolved generation failure) with no usable data
// must read as "generation_failed", never silently as "not_started" - this
// is the exact bug from AO-20260812-0840/FCI A: module.status reverts to
// "not_started" on failure, so hasFailedGeneration (module.error_code != null)
// is the only signal left that distinguishes "never touched" from "just failed".
test("a module with an unresolved generation failure never reads as a plain not_started/in_progress module", () => {
  assert.equal(
    getFciContributionStatusKey({
      status: "not_started",
      hasData: false,
      readyForCompletion: false,
      staleSource: false,
      hasFailedGeneration: true
    }),
    "generation_failed"
  );

  // Same for a failed regeneration on top of an existing draft: the failure
  // still wins over stale "ready to validate" data, per spec section 4.
  assert.equal(
    getFciContributionStatusKey({
      status: "needs_review",
      hasData: true,
      readyForCompletion: true,
      staleSource: false,
      hasFailedGeneration: true
    }),
    "generation_failed"
  );

  // But a validated module must never be knocked out of "validated" by a
  // failed regeneration attempt on top of it - validation is authoritative.
  assert.equal(
    getFciContributionStatusKey({
      status: "validated",
      hasData: true,
      readyForCompletion: true,
      staleSource: false,
      hasFailedGeneration: true
    }),
    "validated"
  );
});

test("own vs. other contribution vocabulary never leaks raw enum values", () => {
  for (const key of [
    "not_started",
    "in_progress",
    "generation_failed",
    "ready_to_validate",
    "validated",
    "stale_validated"
  ] as const) {
    const own = getOwnContributionStatusPresentation(key);
    const other = getOtherContributionStatusPresentation(key);
    for (const label of [own.label, other.label]) {
      assert.doesNotMatch(label, /_/, `"${label}" for ${key} must not contain a raw enum value`);
      assert.notEqual(label.toLowerCase(), "unknown");
    }
  }

  assert.equal(getOwnContributionActionLabel("not_started"), "Commencer ma FCI");
  assert.equal(getOwnContributionActionLabel("in_progress"), "Continuer ma FCI");
  assert.equal(getOwnContributionActionLabel("generation_failed"), "Réessayer la génération");
  assert.equal(getOwnContributionActionLabel("ready_to_validate"), "Continuer ma FCI");
  assert.equal(getOwnContributionActionLabel("validated"), "Revoir ma FCI");

  assert.equal(getOtherContributionStatusPresentation("not_started").label, "Non commencée");
  assert.equal(getOtherContributionStatusPresentation("generation_failed").label, "Génération interrompue");
  assert.equal(getOtherContributionStatusPresentation("ready_to_validate").label, "À valider");
  assert.equal(getOtherContributionStatusPresentation("validated").label, "Validée");
});

// G. Provider errors must never leak raw JSON/HTTP text to business users.
test("getFciGenerationFailurePresentation maps a Gemini 503 to the exact business copy", () => {
  const presentation = getFciGenerationFailurePresentation({
    errorCode: "GEMINI_REQUEST_FAILED",
    errorMessage:
      'HTTP 503 "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later." status: UNAVAILABLE',
    lastAttemptAt: "2026-08-12T08:47:18.660Z"
  });

  assert.equal(presentation.title, "Génération temporairement indisponible");
  assert.equal(
    presentation.message,
    "Le service d'IA est momentanément indisponible. Réessayez dans quelques instants."
  );
  assert.equal(presentation.lastAttemptLabel, "Dernière tentative : 12/08/2026 à 08:47");
  assert.doesNotMatch(presentation.title, /503|UNAVAILABLE|gemini/i);
  assert.doesNotMatch(presentation.message, /503|UNAVAILABLE|gemini/i);
});

test("getFciGenerationFailurePresentation never leaks a correlationId/executionId/raw JSON error", () => {
  const presentation = getFciGenerationFailurePresentation({
    errorCode: "AI_SCHEMA_VALIDATION_FAILED",
    errorMessage: '{"errorCode":"GEMINI_REQUEST_FAILED","executionId":"309","correlationId":"corr_abc"}',
    lastAttemptAt: null
  });

  assert.doesNotMatch(presentation.title, /correlationId|executionId|\{/);
  assert.doesNotMatch(presentation.message, /correlationId|executionId|\{/);
  assert.equal(presentation.lastAttemptLabel, null);
});

test("isFciTransientProviderFailure classifies status-specific and legacy error codes", () => {
  assert.equal(
    isFciTransientProviderFailure({ errorCode: "GEMINI_RATE_LIMITED", errorMessage: null }),
    true
  );
  assert.equal(
    isFciTransientProviderFailure({
      errorCode: "GEMINI_REQUEST_FAILED",
      errorMessage: "HTTP 503 UNAVAILABLE"
    }),
    true
  );
  assert.equal(
    isFciTransientProviderFailure({
      errorCode: "GEMINI_REQUEST_FAILED",
      errorMessage: "HTTP 401 Unauthorized: invalid API key"
    }),
    false
  );
  assert.equal(
    isFciTransientProviderFailure({ errorCode: "AI_SCHEMA_VALIDATION_FAILED", errorMessage: null }),
    false
  );
});

test("formatFciSourceLabel turns the internal version marker into a business-facing label", () => {
  assert.equal(
    formatFciSourceLabel("validated:2026-08-12T08:47:18.660Z"),
    "Fiche CDC validée le 12/08/2026 à 08:47"
  );
  assert.equal(formatFciSourceLabel(null), "Source indisponible");
  assert.doesNotMatch(formatFciSourceLabel("validated:2026-08-12T08:47:18.660Z"), /validated:/);
});

test("confidence badge noise is reduced for system-only values", () => {
  assert.equal(
    shouldDisplayFciConfidenceBadge({
      source: "system",
      confidence: "high"
    }),
    false
  );
  assert.equal(
    shouldDisplayFciConfidenceBadge({
      source: "ai",
      confidence: "medium"
    }),
    true
  );
});
