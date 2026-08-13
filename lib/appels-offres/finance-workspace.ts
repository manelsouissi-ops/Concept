import {
  buildFciModuleSummary,
  indexLatestGenerationJobs,
  indexLatestModuleData,
  isModuleSourceStale
} from "./fci/presentation.ts";
import { getFciDetailByAppelOffresCode } from "./fci/repository.ts";
import { readSourceFicheSnapshot, type SourceFicheSnapshot } from "./fci/source-fiche.ts";
import type { FciDetail, FciModuleCode, FciModuleRecord } from "./fci/types.ts";
import { isKnowledgeBaseEnabled } from "./fci/validation.ts";
import { buildAppelOffresSummary, isTestTenderCode, type BadgeTone } from "./presentation.ts";
import { listAppelOffresDetails } from "./repository.ts";
import type { AppelOffresDetail, AppelOffresPriorite } from "./types.ts";
import { getAssignmentsForUser } from "./workflow/service.ts";
import { listNotificationsForUser } from "../notifications/service.ts";
import {
  buildWorkspaceActivityFeed,
  buildWorkspaceIdentity,
  type WorkspaceActivityItem,
  type WorkspaceActivityTone
} from "./workspace.ts";
import type { CurrentUser } from "../auth/rbac.ts";

export type FinanceWorkspaceKpi = {
  key: string;
  label: string;
  value: number;
  description: string;
  tone: "default" | "success" | "warning" | "danger";
};

export type FinanceDossierRow = {
  code: string;
  title: string;
  client: string;
  moduleLabel: string;
  moduleDetail: string;
  priorityLabel: string;
  priorityTone: BadgeTone;
  deadlineLabel: string;
  deadlineAt: string | null;
  deadlineMeta: string;
  statusLabel: string;
  statusTone: BadgeTone;
  actionLabel: string;
  actionHref: string;
  isOverdue: boolean;
  validatedAt: string | null;
  validatedAtLabel: string;
  requiresAttention: boolean;
  lastUpdatedAt: string;
};

export type FinanceQuickAction = {
  key: string;
  label: string;
  description: string;
  href: string | null;
};

export type FinanceWorkspacePresentation = {
  currentUser: {
    firstName: string;
    name: string;
    roleTitle: string;
  };
  moduleCode: FciModuleCode;
  departmentLabel: string;
  attentionCount: number;
  heroSummary: string;
  kpis: FinanceWorkspaceKpi[];
  dossiers: FinanceDossierRow[];
  todo: FinanceDossierRow[];
  inProgress: FinanceDossierRow[];
  blocked: FinanceDossierRow[];
  validated: FinanceDossierRow[];
  tasks: FinanceDossierRow[];
  history: FinanceDossierRow[];
  quickActions: FinanceQuickAction[];
  notifications: WorkspaceActivityItem[];
};

type FinanceWorkspaceRecord = {
  detail: AppelOffresDetail;
  fciDetail: FciDetail | null;
  sourceFiche: SourceFicheSnapshot | null;
};

type FinanceWorkspaceLoaders = {
  listDetails: typeof listAppelOffresDetails;
  getFciDetail: typeof getFciDetailByAppelOffresCode;
  readSourceFiche: typeof readSourceFicheSnapshot;
  getAssignmentsForUser: typeof getAssignmentsForUser;
  listNotificationsForUser: typeof listNotificationsForUser;
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

function getPriorityTone(priority: AppelOffresPriorite): BadgeTone {
  switch (priority) {
    case "critique":
      return "danger";
    case "haute":
      return "warning";
    case "normale":
      return "info";
    case "basse":
    default:
      return "neutral";
  }
}

function getOwnedModule(fciDetail: FciDetail | null, moduleCode: FciModuleCode) {
  return fciDetail?.modules.find((item) => item.moduleCode === moduleCode) ?? null;
}

function hasOwnedModuleActivity(record: FinanceWorkspaceRecord, moduleCode: FciModuleCode) {
  const ownedModule = getOwnedModule(record.fciDetail, moduleCode);

  if (!ownedModule) {
    return false;
  }

  if (ownedModule.status !== "not_started") {
    return true;
  }

  const latestDataByModuleId = indexLatestModuleData(record.fciDetail?.moduleData ?? []);
  const latestJobsByModuleId = indexLatestGenerationJobs(record.fciDetail?.generationJobs ?? []);

  return (
    latestDataByModuleId.has(ownedModule.id)
    || latestJobsByModuleId.has(ownedModule.id)
    || ownedModule.errorCode != null
    || ownedModule.errorMessage != null
  );
}

function getModuleHref(code: string, moduleCode: FciModuleCode) {
  return `/appels-offres/${encodeURIComponent(code)}?view=fci&fciModule=${moduleCode}`;
}

function buildSyntheticRow(
  record: FinanceWorkspaceRecord,
  moduleCode: FciModuleCode,
  departmentLabel: string
): FinanceDossierRow | null {
  const summary = buildAppelOffresSummary(record.detail);
  if (summary.statusKey !== "fiche_validee") {
    return null;
  }

  const identity = buildWorkspaceIdentity(record.detail);
  const isOverdue = summary.isOverdue;
  // FCI modules are now pre-filled automatically as soon as the Fiche CDC is
  // validated (see autoInitializeAndLaunchFciModulesForValidatedFiche). This
  // branch - the module row not existing at all yet - should only ever be a
  // brief transient state, not something the department manually "generates".
  return {
    code: record.detail.code,
    title: identity.displayTitle,
    client: identity.clientLabel,
    moduleLabel: "Pre-remplissage en attente",
    moduleDetail: `Le module ${departmentLabel} va etre pre-rempli automatiquement par l'IA.`,
    priorityLabel: summary.priorityLabel,
    priorityTone: getPriorityTone(record.detail.priorite),
    deadlineLabel: formatDateLabel(record.detail.dueDate),
    deadlineAt: record.detail.dueDate,
    deadlineMeta: isOverdue
      ? "Echeance depassee"
      : record.detail.dueDate
        ? "A surveiller"
        : "Sans deadline",
    statusLabel: "À compléter",
    statusTone: isOverdue ? "danger" : "ai",
    actionLabel: "Commencer",
    actionHref: getModuleHref(record.detail.code, moduleCode),
    isOverdue,
    validatedAt: null,
    validatedAtLabel: "Non validee",
    requiresAttention: true,
    lastUpdatedAt: record.detail.updatedAt
  };
}

function buildRowFromModule(
  record: FinanceWorkspaceRecord,
  ownedModule: FciModuleRecord,
  moduleCode: FciModuleCode,
  departmentLabel: string,
  currentUser: CurrentUser,
  nowIso: string
): FinanceDossierRow {
  const latestDataByModuleId = indexLatestModuleData(record.fciDetail?.moduleData ?? []);
  const latestJobsByModuleId = indexLatestGenerationJobs(record.fciDetail?.generationJobs ?? []);
  const latestData = latestDataByModuleId.get(ownedModule.id) ?? null;
  const latestJob = latestJobsByModuleId.get(ownedModule.id) ?? null;
  const moduleSummary = buildFciModuleSummary({
    appelOffres: record.detail,
    module: ownedModule,
    latestData,
    latestJob,
    sourceFiche: record.sourceFiche,
    knowledgeBaseEnabled: isKnowledgeBaseEnabled(),
    currentUser
  });
  const dossierSummary = buildAppelOffresSummary(record.detail);
  const identity = buildWorkspaceIdentity(record.detail);
  const staleSource = isModuleSourceStale(latestData, record.sourceFiche);
  const isOverdue = dossierSummary.isOverdue && ownedModule.status !== "validated";

  let moduleLabel = "Module a completer";
  let moduleDetail = `Le module ${departmentLabel} attend votre intervention.`;
  let statusLabel = "À compléter";
  let statusTone: BadgeTone = "warning";
  let actionLabel = "Commencer";
  let requiresAttention = true;

  if (ownedModule.status === "validated") {
    moduleLabel = "Module valide";
    moduleDetail = ownedModule.validatedAt
      ? `Valide le ${formatDateLabel(ownedModule.validatedAt)}.`
      : `Le module ${departmentLabel} est pret pour export.`;
    statusLabel = "Validée";
    statusTone = "success";
    actionLabel = "Consulter";
    requiresAttention = false;
  } else if (ownedModule.status === "generating" || latestJob?.status === "queued" || latestJob?.status === "running") {
    moduleLabel = "Generation en cours";
    moduleDetail = `L'IA prepare le module ${departmentLabel} pour votre relecture.`;
    statusLabel = "En cours";
    statusTone = "ai";
    actionLabel = "Continuer";
  } else if (ownedModule.status === "failed" || moduleSummary.current_error?.code) {
    moduleLabel = "Module en erreur";
    moduleDetail = moduleSummary.current_error?.message ?? "Une verification est necessaire avant reprise.";
    statusLabel = "Bloquée";
    statusTone = "danger";
    actionLabel = "Réviser";
  } else if (staleSource) {
    moduleLabel = "Source a relire";
    moduleDetail = `La Fiche CDC a change depuis la derniere version du module ${departmentLabel}.`;
    statusLabel = "À régénérer";
    statusTone = "warning";
    actionLabel = "Mettre a jour";
  } else if (ownedModule.status === "needs_review" || ownedModule.status === "generated") {
    moduleLabel = "Pret pour validation";
    moduleDetail = "Les informations generees doivent etre revisees et validees.";
    statusLabel = "Validation requise";
    statusTone = isOverdue ? "danger" : "warning";
    actionLabel = "Réviser";
  } else if (latestData) {
    moduleLabel = "Brouillon en cours";
    moduleDetail = `Un brouillon ${departmentLabel} existe deja et peut etre finalise.`;
    statusLabel = "En cours";
    statusTone = isOverdue ? "danger" : "info";
    actionLabel = "Continuer";
  } else {
    // not_started with no job and no data: auto-launch (fired at Fiche CDC
    // validation) should move this to "generating" almost immediately. This
    // is a brief pending state, never a manual "Generer" trigger.
    moduleLabel = "Pre-remplissage en attente";
    moduleDetail = `Le module ${departmentLabel} va etre pre-rempli automatiquement par l'IA.`;
    statusLabel = "À compléter";
    statusTone = isOverdue ? "danger" : "ai";
    actionLabel = "Commencer";
  }

  return {
    code: record.detail.code,
    title: identity.displayTitle,
    client: identity.clientLabel,
    moduleLabel,
    moduleDetail,
    priorityLabel: dossierSummary.priorityLabel,
    priorityTone: getPriorityTone(record.detail.priorite),
    deadlineLabel: formatDateLabel(record.detail.dueDate),
    deadlineAt: record.detail.dueDate,
    deadlineMeta: record.detail.dueDate
      ? isOverdue
        ? "Echeance depassee"
        : "Date limite en cours"
      : "Sans deadline",
    statusLabel,
    statusTone,
    actionLabel,
    actionHref: getModuleHref(record.detail.code, moduleCode),
    isOverdue,
    validatedAt: ownedModule.validatedAt,
    validatedAtLabel: ownedModule.validatedAt ? formatDateLabel(ownedModule.validatedAt) : "Non validee",
    requiresAttention,
    lastUpdatedAt: latestData?.updatedAt ?? ownedModule.updatedAt ?? nowIso
  };
}

function buildNotificationItem(
  label: string,
  description: string,
  createdAt: string,
  tone: WorkspaceActivityTone,
  kind: WorkspaceActivityItem["kind"],
  id: string
): WorkspaceActivityItem {
  return {
    id,
    kind,
    label,
    description,
    actor: null,
    createdAt,
    tone
  };
}

// The lane-leak bug lived here: audit events for a tender's FCI set cover the
// whole FCI set, not just this user's owned module. Only events whose payload
// module_code matches the current department's owned module may become a
// notification here - everything else is silently skipped, not just relabeled,
// so Finance never sees "Direction commerciale" events and so on for
// Operations.
function mapOwnedModuleNotifications(
  record: FinanceWorkspaceRecord,
  moduleCode: FciModuleCode,
  departmentLabel: string
) {
  if (!record.fciDetail) {
    return [] as WorkspaceActivityItem[];
  }

  const identity = buildWorkspaceIdentity(record.detail);
  const description = `${record.detail.code} · ${identity.clientLabel}`;

  return record.fciDetail.auditEvents
    .filter((event) => event.payloadJson?.moduleCode === moduleCode)
    .flatMap<WorkspaceActivityItem>((event) => {
      switch (event.eventType) {
        case "fci.generation.completed":
          return [
            buildNotificationItem(
              `Le module ${departmentLabel} est pret pour relecture.`,
              description,
              event.createdAt,
              "ai",
              "fiche_generated",
              `fci-audit-${event.id}`
            )
          ];
        case "fci.generation.failed":
        case "fci.generation.cancelled":
          return [
            buildNotificationItem(
              `La generation du module ${departmentLabel} a echoue.`,
              description,
              event.createdAt,
              "danger",
              "analysis_failed",
              `fci-audit-${event.id}`
            )
          ];
        case "fci.module.validated":
          return [
            buildNotificationItem(
              `Votre module ${departmentLabel} a ete valide.`,
              description,
              event.createdAt,
              "success",
              "fiche_validated",
              `fci-audit-${event.id}`
            )
          ];
        case "fci.source_metadata_refreshed":
          return [
            buildNotificationItem(
              "La Fiche CDC source a ete mise a jour.",
              description,
              event.createdAt,
              "warning",
              "fiche_modified",
              `fci-audit-${event.id}`
            )
          ];
        default:
          return [];
      }
    });
}

function buildFallbackNotifications(record: FinanceWorkspaceRecord) {
  const identity = buildWorkspaceIdentity(record.detail);

  return buildWorkspaceActivityFeed(record.detail)
    .filter((item) =>
      [
        "fiche_validated",
        "analysis_failed",
        "fiche_generated",
        "analysis_completed"
      ].includes(item.kind)
    )
    .map((item) => ({
      ...item,
      description: `${record.detail.code} · ${identity.clientLabel}`
    }));
}

function dedupeNotifications(items: WorkspaceActivityItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.label}|${item.description}|${item.createdAt}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function categorizeRow(row: FinanceDossierRow) {
  if (row.statusTone === "danger" && row.statusLabel === "Bloquée") {
    return "blocked" as const;
  }

  if (row.moduleLabel === "Module valide") {
    return "validated" as const;
  }

  if (
    row.moduleLabel === "Generation en cours"
    || row.moduleLabel === "Brouillon en cours"
    || row.statusLabel === "En cours"
    || row.statusLabel === "En cours"
  ) {
    return "in_progress" as const;
  }

  return "todo" as const;
}

// The #finance-modules/#finance-history anchor ids are stable internal DOM
// hooks shared across departments (not user-visible); the hrefs and copy that
// actually vary per department are already module-scoped via row.actionHref
// and departmentLabel.
function buildQuickActions(rows: FinanceDossierRow[], departmentLabel: string) {
  const latestAttention = rows.find((row) => row.requiresAttention) ?? null;
  const latestValidated = rows.find((row) => row.moduleLabel === "Module valide") ?? null;

  return [
    {
      key: "view-modules",
      label: "Voir mes modules",
      description: `Acceder directement a la file ${departmentLabel}.`,
      href: `/dashboard?section=modules#finance-modules`
    },
    {
      key: "continue-latest",
      label: "Continuer le dernier module",
      description: latestAttention
        ? `${latestAttention.code} · ${latestAttention.client}`
        : "Aucun module en attente immediate.",
      href: latestAttention?.actionHref ?? null
    },
    {
      key: "history",
      label: "Historique",
      description: `Relire les derniers evenements utiles a ${departmentLabel}.`,
      href: `/dashboard?section=history#finance-history`
    },
    {
      key: "export",
      label: "Exporter",
      description: latestValidated
        ? `${latestValidated.code} est pret a etre consulte.`
        : `Disponible des qu'un module ${departmentLabel} est valide.`,
      href: latestValidated?.actionHref ?? null
    }
  ] satisfies FinanceQuickAction[];
}

// FINANCE/OPERATIONS have exactly one job in the BPMN: complete and validate their
// own pre-filled FCI module. They never touch the Fiche CDC, Go/No-Go, or tender
// lifecycle, so their dashboard is reduced to a minimal task shell (see
// components/department-task-workspace.tsx). DIRECTION_GENERALE now uses the
// dedicated decision workspace and no longer routes through this presentation.
function isMinimalDepartmentRole(role: CurrentUser["role"]) {
  return role === "FINANCE" || role === "OPERATIONS";
}

export function buildFinanceWorkspacePresentation(input: {
  currentUser: CurrentUser;
  moduleCode: FciModuleCode;
  records: FinanceWorkspaceRecord[];
  nowIso?: string;
}): FinanceWorkspacePresentation {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const moduleCode = input.moduleCode;
  const departmentLabel = input.currentUser.departmentLabel;
  const minimal = isMinimalDepartmentRole(input.currentUser.role);

  const candidateRecords = input.records.filter((record) => {
    if (record.detail.archivedAt) {
      return false;
    }

    if (isTestTenderCode(record.detail.code)) {
      return false;
    }

    const dossierSummary = buildAppelOffresSummary(record.detail);
    return dossierSummary.statusKey === "fiche_validee" || hasOwnedModuleActivity(record, moduleCode);
  });

  const rows = candidateRecords
    .map((record) => {
      const ownedModule = getOwnedModule(record.fciDetail, moduleCode);
      if (!ownedModule) {
        return buildSyntheticRow(record, moduleCode, departmentLabel);
      }

      return buildRowFromModule(record, ownedModule, moduleCode, departmentLabel, input.currentUser, nowIso);
    })
    .filter((row): row is FinanceDossierRow => row != null)
    .sort((left, right) => {
      if (left.requiresAttention !== right.requiresAttention) {
        return left.requiresAttention ? -1 : 1;
      }

      const rank = (row: FinanceDossierRow) => {
        if (row.statusLabel === "Bloquée") return 0;
        if (row.statusLabel === "À régénérer") return 1;
        if (row.statusLabel === "Validation requise") return 2;
        if (row.statusLabel === "À compléter") return 3;
        if (row.statusLabel === "En cours") return 4;
        return 5;
      };
      const priorityDifference = rank(left) - rank(right);
      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      if (left.deadlineAt && right.deadlineAt && left.deadlineAt !== right.deadlineAt) {
        return left.deadlineAt.localeCompare(right.deadlineAt);
      }
      if (left.deadlineAt !== right.deadlineAt) {
        return left.deadlineAt ? -1 : 1;
      }

      return right.lastUpdatedAt.localeCompare(left.lastUpdatedAt);
    });

  const tasks = rows.filter((row) => row.requiresAttention);
  const history = rows.filter((row) => !row.requiresAttention);
  const todo = rows.filter((row) => categorizeRow(row) === "todo");
  const inProgress = rows.filter((row) => categorizeRow(row) === "in_progress");
  const blocked = rows.filter((row) => categorizeRow(row) === "blocked");
  const validated = rows
    .filter((row) => categorizeRow(row) === "validated")
    .sort((left, right) => (right.validatedAt ?? "").localeCompare(left.validatedAt ?? ""));

  const attentionCount = tasks.length;
  const notifications = dedupeNotifications(
    candidateRecords
      .flatMap((record) => {
        const mapped = mapOwnedModuleNotifications(record, moduleCode, departmentLabel);
        if (mapped.length > 0) {
          return mapped;
        }
        // Fiche CDC / tender-lifecycle events (fiche_generated, fiche_validated,
        // analysis_completed, analysis_failed) are Commercial's world, not
        // Finance/Operations'. The minimal shell never falls back to them.
        return minimal ? [] : buildFallbackNotifications(record);
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  ).slice(0, 5);

  const heroSummary = minimal
    ? attentionCount > 0
      ? `${attentionCount} FCI nécessite${attentionCount > 1 ? "nt" : ""} votre attention.`
      : "Aucune FCI ne nécessite votre attention."
    : attentionCount > 0
      ? `${attentionCount} dossier${attentionCount > 1 ? "s necessitent votre intervention." : " necessite votre intervention."}`
      : "Aucun dossier ne necessite votre intervention immediate.";

  return {
    currentUser: {
      firstName: input.currentUser.firstName,
      name: input.currentUser.name,
      roleTitle: input.currentUser.jobTitle || `Responsable ${departmentLabel}`
    },
    moduleCode,
    departmentLabel,
    attentionCount,
    heroSummary,
    kpis: [
      {
        key: "attention",
        label: "À traiter",
        value: attentionCount,
        description: "FCI nécessitant votre action",
        tone: attentionCount > 0 ? "warning" : "success"
      },
      {
        key: "in_progress",
        label: "En cours",
        value: inProgress.length,
        description: "Contributions commencées",
        tone: "default"
      },
      {
        key: "completed",
        label: "Validées",
        value: validated.length,
        description: "Contributions terminées",
        tone: "success"
      }
    ],
    dossiers: rows,
    todo,
    inProgress,
    blocked,
    validated,
    tasks,
    history,
    quickActions: buildQuickActions(rows, departmentLabel),
    notifications
  };
}

export async function getFinanceWorkspacePresentation(
  currentUser: CurrentUser,
  moduleCode: FciModuleCode,
  loaders: Partial<FinanceWorkspaceLoaders> = {}
) {
  const effectiveLoaders: FinanceWorkspaceLoaders = {
    listDetails: loaders.listDetails ?? listAppelOffresDetails,
    getFciDetail: loaders.getFciDetail ?? getFciDetailByAppelOffresCode,
    readSourceFiche: loaders.readSourceFiche ?? readSourceFicheSnapshot,
    getAssignmentsForUser: loaders.getAssignmentsForUser ?? getAssignmentsForUser,
    listNotificationsForUser: loaders.listNotificationsForUser ?? listNotificationsForUser
  };
  const assignments = await effectiveLoaders.getAssignmentsForUser(currentUser);
  const assignmentByCode = new Map(
    assignments
      .filter((assignment) => assignment.moduleCode === moduleCode)
      .map((assignment) => [assignment.appelOffresCode, assignment])
  );
  const details = await effectiveLoaders.listDetails({ archived: "all" });

  const records = await Promise.all(
    details
      .filter(
        (detail) =>
          detail.archivedAt == null
          && !isTestTenderCode(detail.code)
          && assignmentByCode.has(detail.code)
      )
      .map(async (detail) => ({
        detail,
        fciDetail: await effectiveLoaders.getFciDetail(detail.code),
        sourceFiche: await effectiveLoaders.readSourceFiche(detail.code, {
          allowDraft: true
        })
      }))
  );

  const workspace = buildFinanceWorkspacePresentation({
    currentUser,
    moduleCode,
    records
  });
  const notifications = await effectiveLoaders.listNotificationsForUser(currentUser, 5);

  const notificationItems: WorkspaceActivityItem[] = notifications.map((notification) => ({
    id: `notification-${notification.id}`,
    kind: "fiche_modified",
    label: notification.title,
    description: notification.message,
    actor: null,
    createdAt: notification.createdAt,
    tone: notification.isRead ? "default" : "warning"
  }));

  return {
    ...workspace,
    notifications: notificationItems
  };
}
