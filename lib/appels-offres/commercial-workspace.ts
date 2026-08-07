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
  summary: string;
  statusLabel: string;
  statusTone: BadgeTone;
  actionLabel: string;
  actionHref: string;
};

export type CommercialTrackingRow = {
  code: string;
  title: string;
  client: string;
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

export type CommercialWorkspacePresentation = {
  currentUser: {
    firstName: string;
    name: string;
    roleTitle: string;
  };
  heroTitle: string;
  heroSummary: string;
  kpis: CommercialWorkspaceKpi[];
  unownedQueue: CommercialActionItem[];
  actionsRequired: CommercialActionItem[];
  tracking: CommercialTrackingRow[];
  awaitingDg: CommercialDecisionRow[];
  recentDecisions: CommercialDecisionRow[];
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

function getModule(detail: FciDetail | null, moduleCode: "A" | "B" | "C") {
  return detail?.modules.find((module) => module.moduleCode === moduleCode) ?? null;
}

function getAssignment(
  workflow: TenderWorkflowStateView,
  moduleCode: "B" | "C"
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
  moduleCode: "B" | "C"
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

  return !getAssignment(record.workflow, "B") || !getAssignment(record.workflow, "C");
}

function isBlocked(record: CommercialWorkspaceRecord) {
  return ["A", "B", "C"].some((moduleCode) => {
    const module = getModule(record.fciDetail, moduleCode as "A" | "B" | "C");
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

  if (hasLegacyAssignmentGap(record)) {
    return {
      key: `${record.detail.code}-assign`,
      code: record.detail.code,
      title: identity.displayTitle,
      client: identity.clientLabel,
      summary: "Affectez les contributions Finance et Operations avant leur traitement.",
      statusLabel: "A affecter",
      statusTone: "warning",
      actionLabel: "Affecter",
      actionHref: href
    };
  }

  if (isBlocked(record)) {
    return {
      key: `${record.detail.code}-blocked`,
      code: record.detail.code,
      title: identity.displayTitle,
      client: identity.clientLabel,
      summary: "Une contribution FCI demande une reprise ou une verification.",
      statusLabel: "Bloque",
      statusTone: "danger",
      actionLabel: "Suivre",
      actionHref: href
    };
  }

  if (isReadyForPreparation(record)) {
    return {
      key: `${record.detail.code}-ready`,
      code: record.detail.code,
      title: identity.displayTitle,
      client: identity.clientLabel,
      summary: "Le dossier peut etre prepare puis soumis a la Direction generale.",
      statusLabel: "Pret pour Go/No-Go",
      statusTone: "success",
      actionLabel: "Preparer",
      actionHref: `${href}?view=overview`
    };
  }

  return null;
}

function buildTrackingRow(record: CommercialWorkspaceRecord): CommercialTrackingRow {
  const identity = buildWorkspaceIdentity(record.detail);
  const overallState = getOverallState(record);
  const moduleA = getModule(record.fciDetail, "A");

  return {
    code: record.detail.code,
    title: identity.displayTitle,
    client: identity.clientLabel,
    commercialLabel: getModuleStatusLabel(moduleA),
    financeLabel: getAssignmentLaneLabel(record.workflow, record.fciDetail, "B"),
    operationsLabel: getAssignmentLaneLabel(record.workflow, record.fciDetail, "C"),
    overallStateLabel: overallState.label,
    overallStateTone: overallState.tone,
    latestActivity: formatDateLabel(record.detail.updatedAt),
    actionHref: `/appels-offres/${encodeURIComponent(record.detail.code)}`,
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
    actionHref: `/appels-offres/${encodeURIComponent(record.detail.code)}?view=go-no-go`,
    actionLabel: "Consulter"
  };
}

export function buildCommercialWorkspacePresentation(input: {
  currentUser: CurrentUser;
  records: CommercialWorkspaceRecord[];
}): CommercialWorkspacePresentation {
  const activeRecords = input.records.filter((record) =>
    !record.detail.archivedAt && !isTestTenderCode(record.detail.code)
  );
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
    .sort((left, right) => left.code.localeCompare(right.code));

  const tracking = ownedRecords
    .filter((record) => {
      const summary = buildAppelOffresSummary(record.detail);
      return summary.statusKey === "fiche_validee" || record.fciDetail != null;
    })
    .sort((left, right) => right.detail.updatedAt.localeCompare(left.detail.updatedAt))
    .map(buildTrackingRow);

  const awaitingDg = ownedRecords
    .filter(isAwaitingDg)
    .sort((left, right) => right.detail.updatedAt.localeCompare(left.detail.updatedAt))
    .map(buildAwaitingDgRow);

  const recentDecisions = ownedRecords
    .filter(isRecentDecision)
    .sort((left, right) =>
      (right.latestDecision?.decidedAt ?? "").localeCompare(left.latestDecision?.decidedAt ?? "")
    )
    .map(buildRecentDecisionRow)
    .slice(0, 8);

  const dossiersAAffecter = unownedQueue.length;
  const dossiersReady = ownedRecords.filter(isReadyForPreparation).length;
  const dossiersAwaitingDg = ownedRecords.filter(isAwaitingDg).length;
  const dossiersInProgress = ownedRecords.filter((record) => {
    if (hasLegacyAssignmentGap(record) || isAwaitingDg(record) || isReadyForPreparation(record)) {
      return false;
    }

    return !isRecentDecision(record);
  }).length;
  const ownedActiveCount = ownedRecords.filter((record) => !isRecentDecision(record)).length;

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
        key: "my-active",
        label: "Mes dossiers actifs",
        value: ownedActiveCount,
        description: "Dossiers dont vous etes le responsable commercial courant.",
        tone: ownedActiveCount > 0 ? "default" : "success"
      },
      {
        key: "to-assign",
        label: "A affecter",
        value: dossiersAAffecter,
        description: "Dossiers sans responsable commercial actif.",
        tone: dossiersAAffecter > 0 ? "warning" : "success"
      },
      {
        key: "ready",
        label: "Prets pour Go/No-Go",
        value: dossiersReady,
        description: "Dossiers dont A, B et C sont valides et attendent la preparation.",
        tone: dossiersReady > 0 ? "success" : "default"
      },
      {
        key: "awaiting-dg",
        label: "En attente de decision DG",
        value: dossiersAwaitingDg,
        description: "Dossiers soumis a la Direction generale.",
        tone: dossiersAwaitingDg > 0 ? "warning" : "default"
      }
    ],
    unownedQueue,
    actionsRequired,
    tracking,
    awaitingDg,
    recentDecisions
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
