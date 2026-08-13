import type { BadgeTone } from "../presentation.ts";
import type { FciAiConfidence, FciAiSourceType } from "./ai-contracts.ts";
import type {
  FciGenerationJobStatus,
  FciModuleStatus,
  FciSetOverallStatus
} from "./types.ts";
import type {
  FciFieldReviewStatus,
  FciFieldSource,
  FciFormStatus
} from "./rendering.ts";

export function formatFciDateTime(value: string | null | undefined) {
  if (!value) {
    return "Non disponible";
  }

  return new Date(value).toLocaleString("fr-FR");
}

// "12/08/2026 à 08:47" - used for both the source-fiche label and the
// "last attempt" line on a failed generation, so both read consistently.
function formatFciFrenchTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const datePart = date.toLocaleDateString("fr-FR");
  const timePart = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${datePart} à ${timePart}`;
}

const FCI_SOURCE_STATUS_LABELS: Record<string, string> = {
  validated: "Fiche CDC validée",
  draft: "Fiche CDC (brouillon)",
  processing: "Fiche CDC en cours de traitement",
  error: "Fiche CDC en erreur"
};

// Turns the internal "status:ISO-timestamp" source-fiche version marker
// (e.g. "validated:2026-08-12T08:47:18.660Z") into a business-facing label.
// That raw string is a cache-busting/traceability key, not something a
// normal user should ever read.
export function formatFciSourceLabel(version: string | null | undefined) {
  if (!version) {
    return "Source indisponible";
  }

  const separatorIndex = version.indexOf(":");
  if (separatorIndex === -1) {
    return "Source : Fiche CDC validée";
  }

  const status = version.slice(0, separatorIndex);
  const timestamp = version.slice(separatorIndex + 1);
  const label = FCI_SOURCE_STATUS_LABELS[status] ?? "Fiche CDC";
  const formattedTimestamp = formatFciFrenchTimestamp(timestamp);

  return formattedTimestamp ? `${label} le ${formattedTimestamp}` : label;
}

export function formatFciDate(value: string | null | undefined) {
  if (!value) {
    return "Non disponible";
  }

  return new Date(value).toLocaleDateString("fr-FR");
}

export function shortenFciHash(value: string | null | undefined) {
  if (!value) {
    return "Inconnu";
  }

  return value.length <= 12 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export function getFciModuleStatusPresentation(status: FciModuleStatus): {
  label: string;
  tone: BadgeTone;
} {
  switch (status) {
    case "not_started":
      return { label: "Non commencé", tone: "neutral" };
    case "generating":
      return { label: "Génération en cours", tone: "ai" };
    case "generated":
      return { label: "Brouillon", tone: "info" };
    case "needs_review":
      return { label: "À vérifier", tone: "warning" };
    case "validated":
      return { label: "Terminé", tone: "success" };
    case "failed":
      return { label: "Erreur", tone: "danger" };
    case "unavailable":
      return { label: "Indisponible", tone: "neutral" };
  }
}

export function getFciOverallStatusPresentation(status: FciSetOverallStatus): {
  label: string;
  tone: BadgeTone;
} {
  switch (status) {
    case "not_started":
      return { label: "Non commencé", tone: "neutral" };
    case "in_progress":
      return { label: "En cours", tone: "ai" };
    case "needs_review":
      return { label: "À vérifier", tone: "warning" };
    case "validated":
      return { label: "Terminé", tone: "success" };
    case "failed":
      return { label: "Bloqué", tone: "danger" };
  }
}

export function getFciGenerationJobStatusPresentation(
  status: FciGenerationJobStatus
): { label: string; tone: BadgeTone } {
  switch (status) {
    case "pending_integration":
      return { label: "Intégration à reprendre", tone: "warning" };
    case "created":
    case "queued":
      return { label: "En attente", tone: "warning" };
    case "running":
      return { label: "Génération en cours", tone: "ai" };
    case "completed":
      return { label: "Terminée", tone: "success" };
    case "failed":
      return { label: "Erreur", tone: "danger" };
    case "cancelled":
      return { label: "Annulée", tone: "neutral" };
  }
}

export function getFciFormStatusPresentation(
  status: FciFormStatus
): { label: string; tone: BadgeTone } {
  switch (status) {
    case "not_started":
      return { label: "Non commencé", tone: "neutral" };
    case "draft":
      return { label: "Brouillon", tone: "info" };
    case "ready_for_review":
      return { label: "À vérifier", tone: "warning" };
    case "completed":
      return { label: "Terminé", tone: "success" };
  }
}

export function getFciFieldSourcePresentation(
  source: FciFieldSource
): { label: string; tone: BadgeTone } {
  switch (source) {
    case "ai":
      return { label: "Pré-rempli par l’IA", tone: "ai" };
    case "human":
      return { label: "Révisé", tone: "info" };
    case "tender":
      return { label: "Donnée du dossier", tone: "neutral" };
    case "cdc":
      return { label: "Extrait de la Fiche CDC", tone: "info" };
    case "system":
      return { label: "Valeur système", tone: "neutral" };
  }
}

export function getFciFieldReviewStatusPresentation(
  status: FciFieldReviewStatus
): { label: string; tone: BadgeTone } {
  switch (status) {
    case "to_review":
      return { label: "À vérifier", tone: "warning" };
    case "reviewed":
      return { label: "Révisé", tone: "success" };
    case "human_required":
      return { label: "À compléter", tone: "warning" };
  }
}

export function getFciSourceTypePresentation(sourceType: FciAiSourceType): {
  label: string;
  tone: BadgeTone;
} {
  switch (sourceType) {
    case "fiche_cdc":
      return { label: "Fiche CDC", tone: "info" };
    case "ai_inference":
      return { label: "Inférence IA", tone: "ai" };
    case "internal_required":
      return { label: "Saisie interne requise", tone: "warning" };
    case "unavailable":
      return { label: "Information indisponible", tone: "neutral" };
    case "not_applicable":
      return { label: "Non applicable", tone: "neutral" };
  }
}

export function getFciConfidencePresentation(confidence: FciAiConfidence) {
  switch (confidence) {
    case "high":
      return { label: "Élevée", tone: "success" as BadgeTone };
    case "medium":
      return { label: "Moyenne", tone: "info" as BadgeTone };
    case "low":
      return { label: "Faible", tone: "warning" as BadgeTone };
    case "none":
      return { label: "Aucune", tone: "neutral" as BadgeTone };
  }
}

export function getFciSourceFreshnessPresentation(
  freshness: "current" | "stale" | "missing"
) {
  switch (freshness) {
    case "current":
      return { label: "Source actuelle", tone: "success" as BadgeTone };
    case "stale":
      return { label: "Source à mettre à jour", tone: "warning" as BadgeTone };
    case "missing":
      return { label: "Fiche CDC indisponible", tone: "danger" as BadgeTone };
  }
}

export function getFciNullPlaceholder(sourceType?: FciAiSourceType) {
  if (sourceType === "internal_required") {
    return "Saisie interne requise";
  }

  return "Information non renseignée";
}

const FCI_UI_ERROR_MESSAGE_MAX_LENGTH = 300;
const FCI_UI_ERROR_MESSAGE_FALLBACK = "Une erreur est survenue lors de la génération FCI.";

/**
 * Last-resort UI guard: even though Concept sanitizes error.message before
 * persisting it (see n8n-contract.ts), this keeps the card/module view from
 * ever rendering raw markup or an unbounded string for older stored rows.
 */
export function formatFciSafeErrorMessage(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const looksLikeHtml =
    /^<!DOCTYPE\s+html/i.test(trimmed)
    || /^<html[\s>]/i.test(trimmed)
    || /<\/?[a-z][\s\S]{0,20}>/i.test(trimmed.slice(0, 200));

  if (looksLikeHtml) {
    return FCI_UI_ERROR_MESSAGE_FALLBACK;
  }

  return trimmed.length > FCI_UI_ERROR_MESSAGE_MAX_LENGTH
    ? `${trimmed.slice(0, FCI_UI_ERROR_MESSAGE_MAX_LENGTH - 1)}…`
    : trimmed;
}

export function formatFciClientErrorMessage(input: {
  code?: string | null;
  message?: string | null;
}) {
  if (input.code === "FCI_EXPORT_PDF_UNAVAILABLE") {
    return "L’export PDF n’est pas disponible sur cet environnement. Le téléchargement Word reste disponible.";
  }

  if (input.code === "FCI_EXPORT_PDF_FAILED") {
    return "L’export PDF a échoué. Le téléchargement Word reste disponible.";
  }

  const safeMessage = formatFciSafeErrorMessage(input.message);
  return safeMessage ?? "Une erreur est survenue sur le module FCI.";
}

// Provider/network failures that are worth an automatic "try again" nudge:
// rate limiting, server-side unavailability, and timeouts. n8n's generic
// legacy error code (GEMINI_REQUEST_FAILED, sent for every kind of Gemini
// failure before the workflow started classifying by HTTP status) is sniffed
// from the sanitized message text as a best-effort fallback, so historical
// rows persisted before that classification existed still read correctly.
const TRANSIENT_PROVIDER_ERROR_CODES = new Set([
  "GEMINI_TEMPORARILY_UNAVAILABLE",
  "GEMINI_RATE_LIMITED",
  "GEMINI_TIMEOUT"
]);

const TRANSIENT_PROVIDER_MESSAGE_PATTERN =
  /\b(429|500|502|503|504)\b|unavailable|overloaded|high demand|rate.?limit|quota|time.?out/i;

export function isFciTransientProviderFailure(input: {
  errorCode: string | null | undefined;
  errorMessage: string | null | undefined;
}) {
  if (!input.errorCode) {
    return false;
  }

  if (TRANSIENT_PROVIDER_ERROR_CODES.has(input.errorCode)) {
    return true;
  }

  if (input.errorCode === "GEMINI_REQUEST_FAILED" && input.errorMessage) {
    return TRANSIENT_PROVIDER_MESSAGE_PATTERN.test(input.errorMessage);
  }

  return false;
}

export type FciGenerationFailurePresentation = {
  title: string;
  message: string;
  lastAttemptLabel: string | null;
};

// Single source of truth for the business-facing failed-generation card:
// never let a raw provider/HTTP error reach this far - every branch returns
// a fixed, French, non-technical string.
export function getFciGenerationFailurePresentation(input: {
  errorCode: string | null | undefined;
  errorMessage: string | null | undefined;
  lastAttemptAt: string | null | undefined;
}): FciGenerationFailurePresentation {
  const formattedAttempt = input.lastAttemptAt ? formatFciFrenchTimestamp(input.lastAttemptAt) : null;
  const lastAttemptLabel = formattedAttempt ? `Dernière tentative : ${formattedAttempt}` : null;

  if (isFciTransientProviderFailure(input)) {
    return {
      title: "Génération temporairement indisponible",
      message: "Le service d'IA est momentanément indisponible. Réessayez dans quelques instants.",
      lastAttemptLabel
    };
  }

  if (input.errorCode === "AI_SCHEMA_VALIDATION_FAILED") {
    return {
      title: "Génération interrompue",
      message:
        "La réponse générée n'a pas pu être validée. Réessayez la génération ou complétez le formulaire manuellement.",
      lastAttemptLabel
    };
  }

  return {
    title: "Génération interrompue",
    message: "La génération n'a pas pu être terminée. Réessayez ou complétez le formulaire manuellement.",
    lastAttemptLabel
  };
}

export function shouldDisplayFciConfidenceBadge(input: {
  source: FciFieldSource;
  confidence: FciAiConfidence;
  originalAiValue?: unknown;
}) {
  return (
    input.source === "ai"
    || input.originalAiValue != null
    || (input.confidence !== "none" && input.source !== "system")
  );
}

// Centralized FCI contribution status vocabulary. Every place that shows a
// module's business status (Commercial's own FCI, the cross-department
// tracking rows, DG's read-only view) derives from the same key here, so the
// same persisted module state always reads the same way everywhere - no page
// invents its own "is this done" logic.
export type FciContributionStatusKey =
  | "not_started"
  | "in_progress"
  | "generation_failed"
  | "ready_to_validate"
  | "validated"
  | "stale_validated";

export function getFciContributionStatusKey(input: {
  status: FciModuleStatus;
  hasData: boolean;
  readyForCompletion: boolean;
  staleSource: boolean;
  // Authoritative "unresolved failure" signal: fci_modules.error_code, set on
  // every failed generation and cleared on the next successful launch or
  // completion (see service.ts). Reusing that persisted field here is what
  // lets a failed generation surface as "Génération interrompue" instead of
  // silently reading identically to a genuinely empty/not-started module.
  hasFailedGeneration: boolean;
}): FciContributionStatusKey {
  if (input.status === "validated") {
    return input.staleSource ? "stale_validated" : "validated";
  }

  if (input.hasFailedGeneration) {
    return "generation_failed";
  }

  if (input.readyForCompletion) {
    return "ready_to_validate";
  }

  if (input.hasData || input.status !== "not_started") {
    return "in_progress";
  }

  return "not_started";
}

// First-person vocabulary, for the Commercial/Finance/Operations user's own
// contribution ("Ma FCI").
export function getOwnContributionStatusPresentation(
  key: FciContributionStatusKey
): { label: string; tone: BadgeTone } {
  switch (key) {
    case "not_started":
      return { label: "À compléter", tone: "neutral" };
    case "in_progress":
      return { label: "En cours", tone: "info" };
    case "generation_failed":
      return { label: "Génération interrompue", tone: "danger" };
    case "ready_to_validate":
      return { label: "Prête à valider", tone: "warning" };
    case "validated":
      return { label: "Validée", tone: "success" };
    case "stale_validated":
      return { label: "À revérifier", tone: "warning" };
  }
}

export function getOwnContributionActionLabel(key: FciContributionStatusKey) {
  switch (key) {
    case "not_started":
      return "Commencer ma FCI";
    case "generation_failed":
      return "Réessayer la génération";
    case "validated":
      return "Revoir ma FCI";
    default:
      return "Continuer ma FCI";
  }
}

// Third-person vocabulary, for tracking another department's contribution.
export function getOtherContributionStatusPresentation(
  key: FciContributionStatusKey
): { label: string; tone: BadgeTone } {
  switch (key) {
    case "not_started":
      return { label: "Non commencée", tone: "neutral" };
    case "in_progress":
      return { label: "En cours", tone: "info" };
    case "generation_failed":
      return { label: "Génération interrompue", tone: "danger" };
    case "ready_to_validate":
      return { label: "À valider", tone: "warning" };
    case "validated":
      return { label: "Validée", tone: "success" };
    case "stale_validated":
      return { label: "À revérifier", tone: "warning" };
  }
}

export function mapFciHistoryEventLabel(eventType: string) {
  switch (eventType) {
    case "fci.initialized":
      return "FCI initialisée";
    case "fci.source_metadata_refreshed":
      return "Source Fiche CDC actualisée";
    case "fci.module_data.saved":
      return "Version enregistrée";
    case "fci.module.validated":
      return "Module validé";
    case "fci.generation.requested":
      return "Génération de la FCI démarrée";
    case "fci.generation.regeneration_requested":
      return "Nouvelle tentative de génération";
    case "fci.generation.launch_accepted":
      return "Génération lancée";
    case "fci.generation.completed":
      return "Génération terminée";
    case "fci.generation.failed":
      return "Génération interrompue";
    case "fci.generation.cancelled":
      return "Génération annulée";
    case "fci.generation.launch_failed":
      return "Lancement échoué";
    case "fci.manual_completion_started":
      return "Ouverte en saisie manuelle";
    default:
      return eventType.replaceAll("_", " ");
  }
}
