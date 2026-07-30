import type {
  SoftwareAnalysisDetail,
  SoftwareAnalysisReviewStatus,
  SoftwareAnalysisSummary,
  SoftwareAnalysisTransitionAction,
  TenderSoftwareCoverageStatus,
  TenderSoftwareExplicitness,
  TenderSoftwareMatchType,
  TenderSoftwareRowStatus
} from "./software-analysis-types.ts";

export function getSoftwareAnalysisStatusLabel(status: SoftwareAnalysisReviewStatus) {
  switch (status) {
    case "submitted":
      return "A valider";
    case "validated":
      return "Valide";
    default:
      return "Brouillon";
  }
}

export function getSoftwareAnalysisStatusTone(status: SoftwareAnalysisReviewStatus) {
  switch (status) {
    case "submitted":
      return "warning" as const;
    case "validated":
      return "success" as const;
    default:
      return "neutral" as const;
  }
}

export function getRowStatusLabel(status: TenderSoftwareRowStatus) {
  switch (status) {
    case "reviewed":
      return "Relu";
    case "validated":
      return "Valide";
    case "rejected":
      return "Rejete";
    default:
      return "Brouillon";
  }
}

export function getRowStatusTone(status: TenderSoftwareRowStatus) {
  switch (status) {
    case "reviewed":
      return "info" as const;
    case "validated":
      return "success" as const;
    case "rejected":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}

export function getExplicitnessLabel(explicitness: TenderSoftwareExplicitness) {
  return explicitness === "explicit" ? "Explicite" : "Implicite";
}

export function getCoverageStatusLabel(status: TenderSoftwareCoverageStatus) {
  switch (status) {
    case "covered":
      return "Disponible";
    case "partially_covered":
      return "Partiellement disponible";
    case "not_covered":
      return "Manquant";
    default:
      return "A confirmer";
  }
}

export function getCoverageStatusTone(status: TenderSoftwareCoverageStatus) {
  switch (status) {
    case "covered":
      return "success" as const;
    case "partially_covered":
      return "warning" as const;
    case "not_covered":
      return "danger" as const;
    default:
      return "info" as const;
  }
}

export function getMatchTypeLabel(matchType: TenderSoftwareMatchType) {
  switch (matchType) {
    case "exact":
      return "Exact";
    case "alias":
      return "Alias";
    case "manual":
      return "Manuel";
    case "possible":
      return "Possible";
    default:
      return "Aucune";
  }
}

export function buildSoftwareAnalysisSummary(detail: Omit<SoftwareAnalysisDetail, "summary">): SoftwareAnalysisSummary {
  return {
    requirementsCount: detail.requirements.length,
    coveredCount: detail.matches.filter((match) => match.coverageStatus === "covered").length,
    partiallyCoveredCount: detail.matches.filter(
      (match) => match.coverageStatus === "partially_covered"
    ).length,
    notCoveredCount:
      detail.gaps.length ||
      detail.matches.filter((match) => match.coverageStatus === "not_covered").length,
    toConfirmCount:
      detail.confirmations.filter((item) => item.status === "open").length +
      detail.matches.filter((match) => match.coverageStatus === "to_confirm").length
  };
}

export function canTransitionSoftwareAnalysisStatus(
  currentStatus: SoftwareAnalysisReviewStatus,
  action: SoftwareAnalysisTransitionAction
) {
  switch (action) {
    case "submit":
      return currentStatus === "draft";
    case "validate":
      return currentStatus === "submitted";
    case "reopen":
      return currentStatus === "submitted" || currentStatus === "validated";
    default:
      return false;
  }
}
