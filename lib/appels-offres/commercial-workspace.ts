import { getLatestGoNoGoDecisionByAppelOffresId } from "./go-no-go/repository.ts";
import type { GoNoGoDecisionRecord } from "./go-no-go/types.ts";
import { getFciDetailByAppelOffresCode } from "./fci/repository.ts";
import type { FciDetail, FciModuleRecord } from "./fci/types.ts";
import { buildAppelOffresSummary, isTestTenderCode, type BadgeTone } from "./presentation.ts";
import { listAppelOffresDetails } from "./repository.ts";
import type { AppelOffresDetail } from "./types.ts";
import { buildWorkspaceIdentity } from "./workspace.ts";
import type { CurrentUser } from "../auth/rbac.ts";
import type { FciModuleAssignmentDetail } from "./workflow/types.ts";
import type { TenderWorkflowStateView } from "./workflow/service.ts";
import { deriveTenderWorkflowState } from "./workflow/service.ts";
import { buildHistoryWorkspace, type HistoryWorkspaceRow } from "./commercial-secondary-workspaces.ts";
import { buildTenderWorkspaceHref } from "./tender-routes.ts";

export type CommercialWorkspaceKpi = {
  key: string;
  label: string;
  value: number;
  description: string;
  tone: "default" | "success" | "warning" | "danger";
};

export type CommercialActionItem = {
  key: string;
  code: string;
  title: string;
  client: string;
  deadlineLabel: string;
  taskType: "FICHE CDC" | "FCI A · COMMERCIAL" | "GO/NO-GO" | "SUIVI";
  summary: string;
  statusLabel: string;
  statusTone: BadgeTone;
  actionLabel: string;
  actionHref: string;
};

export type CommercialUnownedItem = Omit<CommercialActionItem, "deadlineLabel" | "taskType">;

export type CommercialTrackingRow = {
  code: string;
  title: string;
  client: string;
  deadlineLabel: string;
  cdcComplete: boolean;
  fciValidatedCount: number;
  goNoGoComplete: boolean;
  dgComplete: boolean;
  commercialLabel: string;
  financeLabel: string;
  operationsLabel: string;
  overallStateLabel: string;
  overallStateTone: BadgeTone;
  latestActivity: string;
  actionHref: string;
  actionLabel: string;
};

export type CommercialDecisionRow = {
  code: string;
  title: string;
  client: string;
  statusLabel: string;
  statusTone: BadgeTone;
  detailLabel: string;
  actionHref: string;
  actionLabel: string;
};

// A single derived, presentation-ready "next action" for the simplified
// landing page - built from summary counts rather than individual tenders,
// so the page never grows back into a work-management table. The shape is
// role-agnostic on purpose: Finance/Operations/DG can populate the same
// field later with their own counts.
export type CommercialNextAction = {
  key: string;
  title: string;
  description: string;
  linkLabel: string;
  href: string;
};

export type CommercialWorkspacePresentation = {
  currentUser: {
    firstName: string;
    name: string;
    roleTitle: string;
  };
  heroTitle: string;
  heroSummary: string;
  kpis: CommercialWorkspaceKpi[];
  nextActions: CommercialNextAction[];
  unownedQueue: CommercialUnownedItem[];
  actionsRequired: CommercialActionItem[];
  tracking: CommercialTrackingRow[];
  awaitingDg: CommercialDecisionRow[];
  recentDecisions: CommercialDecisionRow[];
  recentActivity: HistoryWorkspaceRow[];
};

type CommercialWorkspaceRecord = {
  detail: AppelOffresDetail;
  fciDetail: FciDetail | null;
  workflow: TenderWorkflowStateView;
  latestDecision: GoNoGoDecisionRecord | null;
};

function isOwnedByCurrentUser(record: CommercialWorkspaceRecord, currentUser: CurrentUser) {
  const actorUserId = Number(currentUser.id);
  return Number.isInteger(actorUserId) && record.detail.commercialOwnerUserId === actorUserId;
}

function isUnownedOrRecoveryRequired(record: CommercialWorkspaceRecord) {
  return (
    record.detail.commercialOwnerUserId == null
    || record.detail.commercialOwnerStatus === "INACTIVE"
    || record.detail.commercialOwnerStatus === "LOCKED"
  );
}

function formatDateLabel(value: string | null) {
  if (!value) {
    return "Date non renseignee";
  }

  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getModule(detail: FciDetail | null, moduleCode: "A" | "B" | "C" | "D") {
  return detail?.modules.find((module) => module.moduleCode === moduleCode) ?? null;
}

function getAssignment(
  workflow: TenderWorkflowStateView,
  moduleCode: "B" | "C" | "D"
) {
  return workflow.assignments.find((assignment) => assignment.moduleCode === moduleCode) ?? null;
}

function getModuleStatusLabel(module: FciModuleRecord | null) {
  if (!module) {
    return "En attente";
  }

  switch (module.status) {
    case "validated":
      return "Validee";
    case "failed":
      return "Bloquee";
    case "needs_review":
    case "generated":
      return "A relire";
    case "generating":
      return "Generation";
    default:
      return "En attente";
  }
}

function getModuleTone(module: FciModuleRecord | null): BadgeTone {
  if (!module) {
    return "neutral";
  }

  switch (module.status) {
    case "validated":
      return "success";
    case "failed":
      return "danger";
    case "needs_review":
    case "generated":
      return "warning";
    case "generating":
      return "info";
    default:
      return "neutral";
  }
}

function getAssignmentLaneLabel(
  workflow: TenderWorkflowStateView,
  detail: FciDetail | null,
  moduleCode: "B" | "C" | "D"
) {
  const assignment = getAssignment(workflow, moduleCode);
  const module = getModule(detail, moduleCode);
  if (!assignment) {
    return "A affecter";
  }

  const statusLabel = getModuleStatusLabel(module);
  return `${assignment.assignedUserName} · ${statusLabel}`;
}

function hasLegacyAssignmentGap(record: CommercialWorkspaceRecord) {
  if (record.detail.archivedAt) {
    return false;
  }

  if (record.workflow.assignments_complete) {
    return false;
  }

  const summary = buildAppelOffresSummary(record.detail);
  if (summary.statusKey !== "fiche_validee" && !record.fciDetail) {
    return false;
  }

  return !getAssignment(record.workflow, "B") || !getAssignment(record.workflow, "C") || !getAssignment(record.workflow, "D");
}

function isBlocked(record: CommercialWorkspaceRecord) {
  return ["A", "B", "C", "D"].some((moduleCode) => {
    const module = getModule(record.fciDetail, moduleCode as "A" | "B" | "C" | "D");
    return module?.status === "failed";
  });
}

function isReadyForPreparation(record: CommercialWorkspaceRecord) {
  return record.workflow.ready_for_gonogo
    && record.workflow.explicit_state !== "GONOGO_PREPARED"
    && record.workflow.explicit_state !== "SUBMITTED_TO_DG"
    && record.workflow.explicit_state !== "UNDER_DG_REVIEW"
    && record.workflow.explicit_state !== "GO_DECIDED"
    && record.workflow.explicit_state !== "NO_GO_DECIDED"
    && record.workflow.explicit_state !== "ARCHIVED";
}

function isAwaitingDg(record: CommercialWorkspaceRecord) {
  return (
    record.workflow.explicit_state === "SUBMITTED_TO_DG"
    || record.workflow.explicit_state === "UNDER_DG_REVIEW"
  );
}

function isRecentDecision(record: CommercialWorkspaceRecord) {
  return record.latestDecision != null
    && (record.latestDecision.status === "go" || record.latestDecision.status === "no_go");
}

function getOverallState(record: CommercialWorkspaceRecord) {
  if (hasLegacyAssignmentGap(record)) {
    return {
      label: "A affecter",
      tone: "warning" as BadgeTone
    };
  }

  if (isAwaitingDg(record)) {
    return {
      label: "En attente DG",
      tone: "info" as BadgeTone
    };
  }

  if (record.workflow.ready_for_gonogo) {
    return {
      label: "Pret pour Go/No-Go",
      tone: "success" as BadgeTone
    };
  }

  if (isBlocked(record)) {
    return {
      label: "Bloque",
      tone: "danger" as BadgeTone
    };
  }

  return {
    label: "FCI en cours",
    tone: "warning" as BadgeTone
  };
}

function buildActionItem(record: CommercialWorkspaceRecord): CommercialActionItem | null {
  const identity = buildWorkspaceIdentity(record.detail);
  const href = `/appels-offres/${encodeURIComponent(record.detail.code)}`;
  const summary = buildAppelOffresSummary(record.detail);
  const common = {
    code: record.detail.code,
    title: identity.displayTitle,
    client: identity.clientLabel,
    deadlineLabel: formatDateLabel(record.detail.dueDate)
  };

  if (record.detail.ficheStatus?.status === "draft" || summary.statusKey === "fiche_a_valider") {
    return {
      ...common,
      key: `${record.detail.code}-fiche-review`,
      taskType: "FICHE CDC",
      summary: "La fiche générée attend votre relecture et votre validation.",
      statusLabel: "À vérifier",
      statusTone: "warning",
      actionLabel: "Vérifier la fiche",
      actionHref: `${href}/fiche-cdc`
    };
  }

  const moduleA = getModule(record.fciDetail, "A");
  if (moduleA && !["validated", "generating"].includes(moduleA.status)) {
    return {
      ...common,
      key: `${record.detail.code}-fci-a`,
      taskType: "FCI A · COMMERCIAL",
      summary: "Votre contribution commerciale doit être complétée puis validée.",
      statusLabel: moduleA.status === "failed" ? "À reprendre" : "À compléter",
      statusTone: moduleA.status === "failed" ? "danger" : "warning",
      actionLabel: "Compléter ma FCI",
      actionHref: `${href}/fci?fciModule=A`
    };
  }

  if (isBlocked(record)) {
    return {
      key: `${record.detail.code}-blocked`,
      ...common,
      taskType: "SUIVI",
      summary: "Une contribution FCI demande une reprise ou une verification.",
      statusLabel: "Bloque",
      statusTone: "danger",
      actionLabel: "Suivre",
      actionHref: `${href}/fci`
    };
  }

  if (isReadyForPreparation(record)) {
    return {
      key: `${record.detail.code}-ready`,
      ...common,
      taskType: "GO/NO-GO",
      summary: "Les quatre contributions départementales sont validées. Le dossier peut être préparé.",
      statusLabel: "Prêt à préparer",
      statusTone: "success",
      actionLabel: "Préparer le dossier",
      actionHref: `${href}/go-no-go`
    };
  }

  return null;
}

function buildTrackingRow(record: CommercialWorkspaceRecord): CommercialTrackingRow {
  const identity = buildWorkspaceIdentity(record.detail);
  const overallState = getOverallState(record);
  const moduleA = getModule(record.fciDetail, "A");
  const validatedCount = (["A", "B", "C", "D"] as const).filter(
    (moduleCode) => getModule(record.fciDetail, moduleCode)?.status === "validated"
  ).length;
  const goNoGoComplete = ["GONOGO_PREPARED", "SUBMITTED_TO_DG", "UNDER_DG_REVIEW", "GO_DECIDED", "NO_GO_DECIDED"].includes(record.workflow.explicit_state ?? "");
  const dgComplete = record.workflow.explicit_state === "GO_DECIDED" || record.workflow.explicit_state === "NO_GO_DECIDED";

  return {
    code: record.detail.code,
    title: identity.displayTitle,
    client: identity.clientLabel,
    deadlineLabel: formatDateLabel(record.detail.dueDate),
    cdcComplete: record.detail.ficheStatus?.status === "validated" || buildAppelOffresSummary(record.detail).statusKey === "fiche_validee",
    fciValidatedCount: validatedCount,
    goNoGoComplete,
    dgComplete,
    commercialLabel: getModuleStatusLabel(moduleA),
    financeLabel: getAssignmentLaneLabel(record.workflow, record.fciDetail, "B"),
    operationsLabel: getAssignmentLaneLabel(record.workflow, record.fciDetail, "C"),
    overallStateLabel: overallState.label,
    overallStateTone: overallState.tone,
    latestActivity: formatDateLabel(record.detail.updatedAt),
    actionHref: `/appels-offres/${encodeURIComponent(record.detail.code)}/overview`,
    actionLabel: "Ouvrir"
  };
}

function buildAwaitingDgRow(record: CommercialWorkspaceRecord): CommercialDecisionRow {
  const identity = buildWorkspaceIdentity(record.detail);
  return {
    code: record.detail.code,
    title: identity.displayTitle,
    client: identity.clientLabel,
    statusLabel: "En attente DG",
    statusTone: "info",
    detailLabel: record.workflow.explicit_state === "UNDER_DG_REVIEW"
      ? "En cours de relecture DG"
      : "Soumis a la Direction generale",
    actionHref: `/appels-offres/${encodeURIComponent(record.detail.code)}?view=overview`,
    actionLabel: "Suivre"
  };
}

function buildRecentDecisionRow(record: CommercialWorkspaceRecord): CommercialDecisionRow {
  const identity = buildWorkspaceIdentity(record.detail);
  const isGo = record.latestDecision?.status === "go";
  return {
    code: record.detail.code,
    title: identity.displayTitle,
    client: identity.clientLabel,
    statusLabel: isGo ? "Go" : "No-Go",
    statusTone: isGo ? "success" : "neutral",
    detailLabel: record.latestDecision?.decidedAt
      ? `Decision du ${formatDateLabel(record.latestDecision.decidedAt)}`
      : "Decision enregistree",
    actionHref: buildTenderWorkspaceHref(record.detail.code, "go-no-go"),
    actionLabel: "Consulter"
  };
}

export function buildCommercialWorkspacePresentation(input: {
  currentUser: CurrentUser;
  records: CommercialWorkspaceRecord[];
}): CommercialWorkspacePresentation {
  const visibleRecords = input.records.filter((record) => !isTestTenderCode(record.detail.code));
  const ownedVisibleRecords = visibleRecords.filter((record) =>
    isOwnedByCurrentUser(record, input.currentUser)
  );
  const activeRecords = visibleRecords.filter((record) => !record.detail.archivedAt);
  const ownedRecords = activeRecords.filter((record) => isOwnedByCurrentUser(record, input.currentUser));
  const unownedQueue = activeRecords
    .filter(isUnownedOrRecoveryRequired)
    .sort((left, right) => right.detail.updatedAt.localeCompare(left.detail.updatedAt))
    .map((record) => ({
      key: `${record.detail.code}-ownership`,
      code: record.detail.code,
      title: buildWorkspaceIdentity(record.detail).displayTitle,
      client: buildWorkspaceIdentity(record.detail).clientLabel,
      summary:
        record.detail.commercialOwnerUserId == null
          ? "Attribuez un responsable commercial avant toute coordination."
          : "Le responsable commercial actuel est inactif. Une reaffectation est requise.",
      statusLabel:
        record.detail.commercialOwnerUserId == null
          ? "Sans responsable"
          : "Reaffectation requise",
      statusTone: "warning" as BadgeTone,
      actionLabel: "Attribuer",
      actionHref: `/appels-offres/${encodeURIComponent(record.detail.code)}`,
    }));

  const actionsRequired = ownedRecords
    .map(buildActionItem)
    .filter((item): item is CommercialActionItem => item != null)
    .sort((left, right) => {
      const leftRecord = ownedRecords.find((record) => record.detail.code === left.code);
      const rightRecord = ownedRecords.find((record) => record.detail.code === right.code);
      const leftOverdue = leftRecord ? buildAppelOffresSummary(leftRecord.detail).isOverdue : false;
      const rightOverdue = rightRecord ? buildAppelOffresSummary(rightRecord.detail).isOverdue : false;
      if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
      const rank = { "FICHE CDC": 1, "FCI A · COMMERCIAL": 2, "GO/NO-GO": 3, "SUIVI": 4 };
      return rank[left.taskType] - rank[right.taskType] || left.code.localeCompare(right.code);
    });

  const tracking = ownedRecords
    .filter((record) => !isRecentDecision(record))
    .sort((left, right) => right.detail.updatedAt.localeCompare(left.detail.updatedAt))
    .map(buildTrackingRow);

  const awaitingDg = ownedRecords
    .filter(isAwaitingDg)
    .sort((left, right) => right.detail.updatedAt.localeCompare(left.detail.updatedAt))
    .map(buildAwaitingDgRow);

  // Final outcomes are historical records, not active-work items. A NO-GO
  // archives its tender immediately, so restricting this list to active
  // dossiers would erase precisely the decision Commercial needs to follow.
  const recentDecisions = ownedVisibleRecords
    .filter(isRecentDecision)
    .sort((left, right) =>
      (right.latestDecision?.decidedAt ?? "").localeCompare(left.latestDecision?.decidedAt ?? "")
    )
    .map(buildRecentDecisionRow)
    .slice(0, 8);
  const recentActivity = buildHistoryWorkspace(
    ownedRecords.map((record) => ({
      detail: record.detail,
      fci: record.fciDetail,
      workflow: record.workflow,
      decision: record.latestDecision
    }))
  )
    .filter((event) => event.category !== "general")
    .slice(0, 5);

  const fichesToReview = actionsRequired.filter((item) => item.taskType === "FICHE CDC").length;
  const fciAToComplete = actionsRequired.filter((item) => item.taskType === "FCI A · COMMERCIAL").length;
  const dossiersReady = ownedRecords.filter(isReadyForPreparation).length;
  const dossiersAwaitingDg = ownedRecords.filter(isAwaitingDg).length;
  const dossiersInProgress = ownedRecords.filter((record) => {
    if (hasLegacyAssignmentGap(record) || isAwaitingDg(record) || isReadyForPreparation(record)) {
      return false;
    }

    return !isRecentDecision(record);
  }).length;

  const nextActions: CommercialNextAction[] = [
    fichesToReview > 0
      ? {
          key: "fiche-review",
          title: "Vérifier une Fiche CDC",
          description: `${fichesToReview} fiche${fichesToReview > 1 ? "s" : ""} nécessite${fichesToReview > 1 ? "nt" : ""} votre validation`,
          linkLabel: "Voir mes Fiches CDC",
          href: "/fiches-cdc"
        }
      : null,
    fciAToComplete > 0
      ? {
          key: "fci-a",
          title: "Compléter ma FCI A",
          description: `${fciAToComplete} analyse${fciAToComplete > 1 ? "s" : ""} commerciale${fciAToComplete > 1 ? "s" : ""} à terminer`,
          linkLabel: "Voir mes FCI",
          href: "/mes-fci"
        }
      : null,
    dossiersReady > 0
      ? {
          key: "ready",
          title: "Préparer un Go/No-Go",
          description: `${dossiersReady} dossier${dossiersReady > 1 ? "s" : ""} prêt${dossiersReady > 1 ? "s" : ""}`,
          linkLabel: "Go/No-Go",
          href: "/go-no-go"
        }
      : null
  ].filter((item): item is CommercialNextAction => item != null).slice(0, 3);

  return {
    currentUser: {
      firstName: input.currentUser.firstName,
      name: input.currentUser.name,
      roleTitle: input.currentUser.jobTitle || "Responsable commerciale"
    },
    heroTitle: "Pilotage des appels d'offres",
    heroSummary:
      "Suivez uniquement les dossiers dont vous etes responsable commercial.",
    kpis: [
      {
        key: "active",
        label: "Appels d'offres actifs",
        value: ownedRecords.length,
        description: "Dossiers dont vous etes responsable commercial.",
        tone: "default"
      },
      {
        key: "fiche-review",
        label: "Fiches CDC à vérifier",
        value: fichesToReview,
        description: "Fiches en brouillon qui attendent votre validation.",
        tone: fichesToReview > 0 ? "warning" : "success"
      },
      {
        key: "fci-a",
        label: "FCI A à compléter",
        value: fciAToComplete,
        description: "Contributions commerciales à compléter ou reprendre.",
        tone: fciAToComplete > 0 ? "warning" : "success"
      },
      {
        key: "ready",
        label: "Prêts pour Go/No-Go",
        value: dossiersReady,
        description: "Dossiers dont les quatre contributions sont validées et attendent la préparation.",
        tone: dossiersReady > 0 ? "success" : "default"
      },
      {
        key: "awaiting-dg",
        label: "En attente DG",
        value: dossiersAwaitingDg,
        description: "Dossiers soumis a la Direction generale.",
        tone: dossiersAwaitingDg > 0 ? "warning" : "default"
      }
    ],
    nextActions,
    unownedQueue,
    actionsRequired,
    tracking,
    awaitingDg,
    recentDecisions,
    recentActivity
  };
}

export async function getCommercialWorkspacePresentation(currentUser: CurrentUser) {
  const details = await listAppelOffresDetails({ archived: "all" });
  const records = await Promise.all(
    details
      .filter((detail) => !isTestTenderCode(detail.code))
      .map(async (detail) => ({
        detail,
        fciDetail: await getFciDetailByAppelOffresCode(detail.code),
        workflow: await deriveTenderWorkflowState(detail.code),
        latestDecision: await getLatestGoNoGoDecisionByAppelOffresId(detail.id)
      }))
  );

  return buildCommercialWorkspacePresentation({
    currentUser,
    records
  });
}
