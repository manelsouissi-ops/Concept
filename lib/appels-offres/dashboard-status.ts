import type { AppelOffresSummaryView } from "./presentation.ts";
import type { FciSetOverallStatus } from "./fci/types.ts";

export type DashboardRowActionKind = "validate" | "processing" | "generate" | "consult" | "retry" | "open";

export type DashboardRowAction = {
  kind: DashboardRowActionKind;
  label: string | null;
  href: string | null;
  tone: "primary" | "secondary" | "ghost" | "subtle";
};

export function isDossierProcessing(summary: AppelOffresSummaryView, fciStatus: FciSetOverallStatus | null) {
  return (
    summary.statusKey === "analyse_en_cours" ||
    (summary.statusKey === "fiche_validee" && fciStatus === "in_progress")
  );
}

export function isDossierBlocked(summary: AppelOffresSummaryView, fciStatus: FciSetOverallStatus | null) {
  return (
    summary.statusKey === "erreur" ||
    (summary.statusKey === "fiche_validee" && fciStatus === "failed")
  );
}

export function isDossierComplete(summary: AppelOffresSummaryView, fciStatus: FciSetOverallStatus | null) {
  return summary.statusKey === "fiche_validee" && fciStatus === "validated";
}

export function buildDashboardRowAction(
  code: string,
  summary: AppelOffresSummaryView,
  fciStatus: FciSetOverallStatus | null
): DashboardRowAction {
  if (isDossierBlocked(summary, fciStatus)) {
    return { kind: "retry", label: "Reessayer", href: `/appels-offres/${code}`, tone: "subtle" };
  }

  if (isDossierProcessing(summary, fciStatus)) {
    return { kind: "processing", label: null, href: null, tone: "ghost" };
  }

  if (summary.statusKey === "fiche_a_valider") {
    return {
      kind: "validate",
      label: "Valider la Fiche CDC",
      href: `/appels-offres/${code}?view=fiche`,
      tone: "primary"
    };
  }

  if (summary.statusKey === "fiche_validee") {
    if (isDossierComplete(summary, fciStatus)) {
      return { kind: "consult", label: "Consulter", href: `/appels-offres/${code}?view=fci`, tone: "ghost" };
    }

    // FCI modules pre-fill automatically once the Fiche CDC is validated
    // (autoInitializeAndLaunchFciModulesForValidatedFiche) - this is no longer
    // a manual "generate" trigger, just a link to go follow/review progress.
    return {
      kind: "generate",
      label: "Suivre les modules",
      href: `/appels-offres/${code}?view=fci`,
      tone: "secondary"
    };
  }

  if (summary.statusKey === "offre_autorisee") {
    return {
      kind: "consult",
      label: "Consulter la decision",
      href: `/appels-offres/${code}?view=go-no-go`,
      tone: "ghost"
    };
  }

  if (summary.statusKey === "archive") {
    return { kind: "consult", label: "Consulter", href: `/appels-offres/${code}`, tone: "ghost" };
  }

  return { kind: "open", label: "Ouvrir", href: `/appels-offres/${code}`, tone: "ghost" };
}
