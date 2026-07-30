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
      return "Génération demandée";
    case "fci.generation.regeneration_requested":
      return "Régénération demandée";
    case "fci.generation.launch_accepted":
      return "Génération lancée";
    case "fci.generation.completed":
      return "Génération terminée";
    case "fci.generation.failed":
      return "Génération en erreur";
    case "fci.generation.cancelled":
      return "Génération annulée";
    case "fci.generation.launch_failed":
      return "Lancement échoué";
    default:
      return eventType.replaceAll("_", " ");
  }
}
