import type { AppelOffresDetail } from "./types.ts";
import type { FciDetail, FciSetOverallStatus } from "./fci/types.ts";
import { calculateFciOverallStatus, indexLatestModuleData } from "./fci/presentation.ts";
import type { GoNoGoDecisionRecord } from "./go-no-go/types.ts";
import type { TenderWorkflowStateView } from "./workflow/service.ts";
import type { BadgeTone } from "./presentation.ts";

// Centralized, presentation-only read model for "what stage is this tender
// at, visibly, right now". Every page that shows a tender's status/next
// action/progress should derive it from here instead of inventing its own
// notion of "current state" - that duplication (badge vs. processing
// timeline vs. workflow panel vs. FCI overview) is what produced
// contradictory screens (e.g. badge "Fiche CDC a verifier" while the FCI tab
// showed "Termine" and the overview counter read "4/4 etapes"). This module
// does not persist anything and does not change any business rule; it only
// reads already-derived signals (businessStatus, ficheStatus, FCI overall
// status, workflow state, decision) and reconciles them into one view.
export type TenderStageKey =
  | "CDC_PROCESSING"
  | "FICHE_REVIEW"
  | "FCI_IN_PROGRESS"
  | "READY_FOR_GONOGO"
  | "GONOGO_PREPARATION"
  | "SUBMITTED_TO_DG"
  | "DECIDED";

export type TenderStageStepKey = "cdc" | "fiche" | "fci" | "gonogo" | "dg";
export type TenderStageStepState = "complete" | "current" | "upcoming" | "blocked";

export type TenderStageProgressStep = {
  key: TenderStageStepKey;
  label: string;
  state: TenderStageStepState;
};

export type TenderStageAction = {
  label: string;
  href: string;
};

export type TenderStageView = {
  stage: TenderStageKey;
  label: string;
  tone: BadgeTone;
  nextAction: TenderStageAction | null;
  blockingReason: string | null;
  progressSteps: TenderStageProgressStep[];
  decision: "go" | "no_go" | null;
};

export type TenderStageInput = {
  detail: AppelOffresDetail;
  // Optional: precise stage resolution (FCI/Go-No-Go/DG substages) requires
  // these. When omitted (e.g. list pages that only load a lightweight FCI
  // overall-status map to avoid N+1 queries), the helper still returns a
  // coherent view - it just cannot distinguish GONOGO_PREPARATION from
  // READY_FOR_GONOGO, or SUBMITTED_TO_DG/DECIDED beyond what businessStatus
  // already encodes (offre_autorisee / offre_rejetee).
  fciDetail?: FciDetail | null;
  // Fallback for callers that only have the persisted (and possibly stale -
  // it's refreshed reactively on FCI actions, not on every read) overall
  // status, e.g. list pages using a bulk-fetched map to avoid N+1 queries.
  // Ignored when fciDetail is provided, since that lets this module compute
  // a live, staleness-aware status itself.
  fciOverallStatus?: FciSetOverallStatus | null;
  workflow?: TenderWorkflowStateView | null;
  decision?: GoNoGoDecisionRecord | null;
};

function hrefFor(code: string, view: "" | "documents" | "fiche-cdc" | "fci" | "go-no-go" | "history") {
  const base = `/appels-offres/${encodeURIComponent(code)}`;
  return view ? `${base}/${view}` : base;
}

function hasFailedAnalysis(detail: AppelOffresDetail) {
  return (
    detail.status === "error"
    || detail.ficheStatus?.status === "error"
    || detail.processingJobs.some((job) => job.status === "failed")
  );
}

function isAnalysisRunning(detail: AppelOffresDetail) {
  return Boolean(
    detail.ficheStatus?.status === "processing"
    || detail.processingJobs.some((job) =>
      ["created", "queued", "running", "retrying"].includes(job.status)
    )
  );
}

function hasReviewableFiche(detail: AppelOffresDetail) {
  const ficheIsDraftOrValidated =
    detail.ficheStatus?.status === "draft" || detail.ficheStatus?.status === "validated";

  if (ficheIsDraftOrValidated) {
    return true;
  }

  // artifacts.hasFicheXml can be a stale leftover from an earlier successful
  // attempt (e.g. a later regeneration failed without producing a new
  // reviewable fiche) - don't treat it as reviewable when the tender's
  // current signals say the latest attempt errored.
  if (hasFailedAnalysis(detail)) {
    return false;
  }

  return detail.artifacts.hasFicheXml;
}

function resolveFciOverallStatus(input: TenderStageInput): FciSetOverallStatus | null {
  if (input.fciDetail) {
    const ficheCurrentlyValidated =
      input.detail.businessStatus === "fiche_validee"
      || input.detail.businessStatus === "offre_autorisee"
      || input.detail.businessStatus === "offre_rejetee";

    return calculateFciOverallStatus({
      modules: input.fciDetail.modules,
      latestDataByModuleId: indexLatestModuleData(input.fciDetail.moduleData),
      ficheCurrentlyValidated
    });
  }

  if (input.fciOverallStatus !== undefined) {
    return input.fciOverallStatus;
  }

  return null;
}

function buildProgressSteps(
  currentIndex: number,
  blockedAtCdc: boolean
): TenderStageProgressStep[] {
  const definitions: Array<{ key: TenderStageStepKey; label: string }> = [
    { key: "cdc", label: "CDC" },
    { key: "fiche", label: "Fiche CDC" },
    { key: "fci", label: "FCI" },
    { key: "gonogo", label: "Go/No-Go" },
    { key: "dg", label: "Direction Générale" }
  ];

  return definitions.map((definition, index) => {
    let state: TenderStageStepState;
    if (index < currentIndex) {
      state = "complete";
    } else if (index === currentIndex) {
      state = blockedAtCdc && definition.key === "cdc" ? "blocked" : "current";
    } else {
      state = "upcoming";
    }
    return { ...definition, state };
  });
}

export function deriveTenderStage(input: TenderStageInput): TenderStageView {
  const { detail, workflow, decision } = input;
  const code = detail.code;
  const explicitState = workflow?.explicit_state ?? null;

  // 1. Decision already made - the most advanced state, always wins.
  if (
    explicitState === "GO_DECIDED"
    || explicitState === "NO_GO_DECIDED"
    || detail.businessStatus === "offre_autorisee"
    || detail.businessStatus === "offre_rejetee"
  ) {
    const isGo = explicitState === "GO_DECIDED" || detail.businessStatus === "offre_autorisee"
      || decision?.status === "go";
    return {
      stage: "DECIDED",
      label: isGo ? "GO" : "NO-GO",
      tone: isGo ? "success" : "neutral",
      nextAction: { label: "Voir la décision", href: hrefFor(code, "go-no-go") },
      blockingReason: null,
      progressSteps: buildProgressSteps(5, false),
      decision: isGo ? "go" : "no_go"
    };
  }

  // 2. Submitted to / under review by the Direction Generale.
  if (explicitState === "SUBMITTED_TO_DG" || explicitState === "UNDER_DG_REVIEW") {
    return {
      stage: "SUBMITTED_TO_DG",
      label: "En attente DG",
      tone: "info",
      nextAction: { label: "Consulter le dossier", href: hrefFor(code, "go-no-go") },
      blockingReason: null,
      progressSteps: buildProgressSteps(4, false),
      decision: null
    };
  }

  // 3. Go/No-Go report prepared, awaiting submission.
  if (explicitState === "GONOGO_PREPARED") {
    return {
      stage: "GONOGO_PREPARATION",
      label: "En préparation Go/No-Go",
      tone: "info",
      nextAction: { label: "Poursuivre la préparation", href: hrefFor(code, "go-no-go") },
      blockingReason: null,
      progressSteps: buildProgressSteps(3, false),
      decision: null
    };
  }

  // 4. Ready for Go/No-Go: fed either by the precise workflow readiness flag
  // (already staleness-aware, see deriveTenderWorkflowState) or, when only
  // the lightweight fciOverallStatus map is available, by requiring the
  // Fiche CDC to be currently validated AND all FCI modules validated.
  const fciOverallStatus = resolveFciOverallStatus(input);
  const readyForGonogo =
    workflow?.ready_for_gonogo
    ?? (detail.businessStatus === "fiche_validee" && fciOverallStatus === "validated");

  if (readyForGonogo) {
    return {
      stage: "READY_FOR_GONOGO",
      label: "Prêt pour Go/No-Go",
      tone: "success",
      nextAction: { label: "Préparer le Go/No-Go", href: hrefFor(code, "go-no-go") },
      blockingReason: null,
      progressSteps: buildProgressSteps(3, false),
      decision: null
    };
  }

  // 5. Fiche CDC validated, FCI phase in progress (or not yet started).
  if (detail.businessStatus === "fiche_validee" || detail.ficheStatus?.status === "validated") {
    const blockingReason =
      fciOverallStatus === "needs_review" && workflow?.ready_for_gonogo === false
        ? "La Fiche CDC a été modifiée depuis la validation de certaines FCI : elles doivent être revérifiées."
        : workflow != null && !workflow.assignments_complete
          ? "En attente d'affectation Finance et Opérations."
          : null;

    return {
      stage: "FCI_IN_PROGRESS",
      label: "FCI en cours",
      tone: "warning",
      nextAction: { label: "Suivre les FCI", href: hrefFor(code, "fci") },
      blockingReason,
      progressSteps: buildProgressSteps(2, false),
      decision: null
    };
  }

  // 6. Fiche CDC generated, awaiting Commercial review/validation.
  if (hasReviewableFiche(detail)) {
    return {
      stage: "FICHE_REVIEW",
      label: "Fiche CDC à vérifier",
      tone: "warning",
      nextAction: { label: "Réviser la Fiche CDC", href: hrefFor(code, "fiche-cdc") },
      blockingReason: null,
      progressSteps: buildProgressSteps(1, false),
      decision: null
    };
  }

  // 7. CDC processing (not yet reviewable): running, failed, or pending.
  if (hasFailedAnalysis(detail)) {
    return {
      stage: "CDC_PROCESSING",
      label: "Analyse du CDC à reprendre",
      tone: "danger",
      nextAction: { label: "Voir le dossier", href: hrefFor(code, "") },
      blockingReason: "L'analyse du CDC a échoué.",
      progressSteps: buildProgressSteps(0, true),
      decision: null
    };
  }

  if (isAnalysisRunning(detail)) {
    return {
      stage: "CDC_PROCESSING",
      label: "Analyse du CDC en cours",
      tone: "ai",
      nextAction: null,
      blockingReason: null,
      progressSteps: buildProgressSteps(0, false),
      decision: null
    };
  }

  return {
    stage: "CDC_PROCESSING",
    label: detail.artifacts.hasSourcePdf ? "CDC importé" : "Dossier créé",
    tone: "neutral",
    nextAction: detail.artifacts.hasSourcePdf
      ? null
      : { label: "Ajouter le CDC", href: hrefFor(code, "documents") },
    blockingReason: null,
    progressSteps: buildProgressSteps(0, false),
    decision: null
  };
}
