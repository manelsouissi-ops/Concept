import { getLatestGoNoGoDecisionByAppelOffresId } from "./go-no-go/repository.ts";
import type { GoNoGoDecisionRecord } from "./go-no-go/types.ts";
import {
  calculateFciOverallStatus,
  indexLatestModuleData
} from "./fci/presentation.ts";
import { getFciDetailByAppelOffresCode } from "./fci/repository.ts";
import type { FciDetail } from "./fci/types.ts";
import { buildAppelOffresSummary, isTestTenderCode, type BadgeTone } from "./presentation.ts";
import { listAppelOffresDetails } from "./repository.ts";
import type { AppelOffresDetail } from "./types.ts";
import { buildWorkspaceIdentity } from "./workspace.ts";
import type { CurrentUser } from "../auth/rbac.ts";
import type { TenderWorkflowStateView } from "./workflow/service.ts";
import { deriveTenderWorkflowState } from "./workflow/service.ts";
import { getSubmittedGoNoGoReportForDecision } from "./go-no-go-report/service.ts";
import { buildTenderWorkspaceHref } from "./tender-routes.ts";

export type DecisionWorkspaceRow = {
  code: string;
  title: string;
  client: string;
  deadlineLabel: string;
  deadlineMeta: string;
  statusLabel: string;
  statusTone: BadgeTone;
  decisionAtLabel: string;
  decidedByLabel: string;
  rationale: string | null;
  reserves: string | null;
  actionHref: string;
  actionLabel: string;
};

export type DecisionWorkspacePresentation = {
  currentUser: {
    firstName: string;
    name: string;
    roleTitle: string;
  };
  attentionCount: number;
  goCount: number;
  noGoCount: number;
  heroSummary: string;
  queue: DecisionWorkspaceRow[];
  history: DecisionWorkspaceRow[];
};

type DecisionWorkspaceRecord = {
  detail: AppelOffresDetail;
  fciDetail: FciDetail | null;
  latestDecision: GoNoGoDecisionRecord | null;
  submittedReport: {
    id: number | null;
    isStale: boolean;
  };
  workflow: Pick<
    TenderWorkflowStateView,
    "explicit_state" | "submitted_to_dg" | "under_dg_review"
  >;
};

function formatDateLabel(value: string | null) {
  if (!value) {
    return "Non renseignee";
  }

  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function isReadyForDecision(fciDetail: FciDetail | null) {
  if (!fciDetail) {
    return false;
  }

  return (
    calculateFciOverallStatus({
      modules: fciDetail.modules,
      latestDataByModuleId: indexLatestModuleData(fciDetail.moduleData)
    }) === "validated"
  );
}

function buildQueueRow(record: DecisionWorkspaceRecord): DecisionWorkspaceRow {
  const identity = buildWorkspaceIdentity(record.detail);
  const summary = buildAppelOffresSummary(record.detail);

  return {
    code: record.detail.code,
    title: identity.displayTitle,
    client: identity.clientLabel,
    deadlineLabel: formatDateLabel(record.detail.dueDate),
    deadlineMeta: summary.isOverdue
      ? "Echeance depassee"
      : record.detail.dueDate
        ? "Pret pour arbitrage"
        : "Sans deadline",
    statusLabel: "À décider",
    statusTone: summary.isOverdue ? "danger" : "warning",
    decisionAtLabel: "En attente",
    decidedByLabel: "En attente",
    rationale: null,
    reserves: null,
    actionHref: buildTenderWorkspaceHref(record.detail.code, "go-no-go"),
    actionLabel: "Ouvrir la décision"
  };
}

function buildHistoryRow(record: DecisionWorkspaceRecord): DecisionWorkspaceRow {
  const identity = buildWorkspaceIdentity(record.detail);
  const decision = record.latestDecision;

  return {
    code: record.detail.code,
    title: identity.displayTitle,
    client: identity.clientLabel,
    deadlineLabel: formatDateLabel(record.detail.dueDate),
    deadlineMeta: decision?.decidedAt ? `Décidée le ${formatDateLabel(decision.decidedAt)}` : "Décision enregistrée",
    statusLabel: decision?.status === "go" ? "Go" : "No-Go",
    statusTone: decision?.status === "go" ? "success" : "neutral",
    decisionAtLabel: formatDateLabel(decision?.decidedAt ?? null),
    decidedByLabel: decision?.decidedBy ?? "Non renseigné",
    rationale: decision?.rationale ?? null,
    reserves: decision?.reserves ?? null,
    actionHref: buildTenderWorkspaceHref(record.detail.code, "go-no-go"),
    actionLabel: "Consulter"
  };
}

export function buildDecisionWorkspacePresentation(input: {
  currentUser: CurrentUser;
  records: DecisionWorkspaceRecord[];
}): DecisionWorkspacePresentation {
  const queue = input.records
    .filter(
      (record) =>
        record.detail.archivedAt == null
        && isReadyForDecision(record.fciDetail)
        && record.submittedReport.id != null
        && !record.submittedReport.isStale
        && (
          record.workflow.explicit_state === "SUBMITTED_TO_DG"
          || record.workflow.explicit_state === "UNDER_DG_REVIEW"
        )
        && (
          record.latestDecision == null
          || record.latestDecision.status === "reouvert"
        )
    )
    .sort((left, right) => right.detail.updatedAt.localeCompare(left.detail.updatedAt))
    .map(buildQueueRow);

  const history = input.records
    .filter(
      (record) =>
        record.latestDecision != null
        && (record.latestDecision.status === "go" || record.latestDecision.status === "no_go")
    )
    .sort((left, right) =>
      (right.latestDecision?.decidedAt ?? right.latestDecision?.createdAt ?? "").localeCompare(
        left.latestDecision?.decidedAt ?? left.latestDecision?.createdAt ?? ""
      )
    )
    .map(buildHistoryRow);

  const attentionCount = queue.length;

  return {
    currentUser: {
      firstName: input.currentUser.firstName,
      name: input.currentUser.name,
      roleTitle: input.currentUser.jobTitle || "Direction generale"
    },
    attentionCount,
    goCount: history.filter((row) => row.statusLabel === "Go").length,
    noGoCount: history.filter((row) => row.statusLabel === "No-Go").length,
    heroSummary:
      attentionCount > 0
        ? `${attentionCount} decision${attentionCount > 1 ? "s" : ""} en attente d'arbitrage.`
        : "Aucune decision Go/No-Go en attente pour le moment.",
    queue,
    history
  };
}

export async function getDecisionWorkspacePresentation(currentUser: CurrentUser) {
  const details = await listAppelOffresDetails({ archived: "all" });
  const records = await Promise.all(
    details
      .filter((detail) => !isTestTenderCode(detail.code))
      .map(async (detail) => ({
        detail,
        fciDetail: await getFciDetailByAppelOffresCode(detail.code),
        latestDecision: await getLatestGoNoGoDecisionByAppelOffresId(detail.id),
        submittedReport: await getSubmittedGoNoGoReportForDecision(detail.code).then((result) => ({
          id: result.report?.id ?? null,
          isStale: result.isStale
        })),
        workflow: await deriveTenderWorkflowState(detail.code)
      }))
  );

  return buildDecisionWorkspacePresentation({
    currentUser,
    records
  });
}
