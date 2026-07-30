import test from "node:test";
import assert from "node:assert/strict";
import {
  formatFciClientErrorMessage,
  getFciFormStatusPresentation,
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
