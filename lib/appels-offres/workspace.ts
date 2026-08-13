import type { AppelOffresDetail, AuditLogRecord, DocumentRecord, ProcessingJobRecord } from "./types.ts";
import { toBusinessSafeAnalysisError } from "./user-errors.ts";

export type WorkspaceTabKey =
  | "overview"
  | "processing"
  | "fiche"
  | "fci"
  | "go-no-go"
  | "documents"
  | "history";

export type WorkspaceIdentity = {
  displayTitle: string;
  isTitlePendingExtraction: boolean;
  clientLabel: string;
  countryLabel: string;
  dueDateLabel: string;
  responsibleLabel: string;
  priorityLabel: string;
};

export type WorkspaceTimelineStepState = "complete" | "active" | "waiting" | "failed";

export type WorkspaceTimelineStep = {
  key: string;
  label: string;
  state: WorkspaceTimelineStepState;
  timestamp: string | null;
  detail: string | null;
};

export type WorkspaceActivityTone = "default" | "success" | "warning" | "danger" | "ai";

export type WorkspaceActivityKind =
  | "created"
  | "cdc_received"
  | "cdc_replaced"
  | "analysis_started"
  | "analysis_completed"
  | "analysis_failed"
  | "fiche_generated"
  | "fiche_modified"
  | "fiche_validated"
  | "archived"
  | "reopened";

export type WorkspaceActivityItem = {
  id: string;
  kind: WorkspaceActivityKind;
  label: string;
  description: string | null;
  actor: string | null;
  createdAt: string;
  tone: WorkspaceActivityTone;
};

type WorkspaceActivityDraft = WorkspaceActivityItem & {
  dedupeKey: string;
};

export type WorkspaceActionKind =
  | "launch-analysis"
  | "open-processing"
  | "open-fiche"
  | "validate-fiche"
  | "download-cdc"
  | "edit-overview"
  | "archive"
  | "unarchive";

export type WorkspaceAction = {
  kind: WorkspaceActionKind;
  label: string;
  tone: "primary" | "ai" | "secondary" | "ghost";
  disabled?: boolean;
};

export type WorkspaceActions = {
  primary: WorkspaceAction | null;
  secondary: WorkspaceAction[];
};

export type WorkspaceFailureSummary = {
  stageLabel: string;
  message: string;
  failedAt: string | null;
  failedStep: number | null;
  reason: string | null;
  recommendation: string | null;
  technicalDetails: string | null;
  retryAvailable: boolean;
};

const HIDDEN_AUDIT_ACTIONS = new Set([
  "appel_offres.create.failed",
  "appel_offres.status_changed",
  "callback_received",
  "duplicate_callback_ignored",
  "late_callback_ignored",
  "n8n_launch_accepted"
]);

function normalizeComparable(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function isNonEmpty(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function getLatestProcessingJob(appel: AppelOffresDetail) {
  return appel.processingJobs[0] ?? null;
}

function getDocument(appel: AppelOffresDetail, kind: DocumentRecord["kind"]) {
  return appel.documents.find((document) => document.kind === kind) ?? null;
}

function findAuditLog(appel: AppelOffresDetail, ...actions: string[]) {
  return appel.auditLogs.find((entry) => actions.includes(entry.action)) ?? null;
}

function isActiveProcessingJob(job: ProcessingJobRecord | null) {
  return Boolean(job && ["created", "queued", "running", "retrying"].includes(job.status));
}

function isFailedJob(job: ProcessingJobRecord | null) {
  return Boolean(job && job.status === "failed");
}

function hasReviewableFiche(appel: AppelOffresDetail) {
  return (
    appel.artifacts.hasFicheXml ||
    appel.ficheStatus?.status === "draft" ||
    appel.ficheStatus?.status === "validated"
  );
}

function mapFailureStageToTimelineLabel(job: ProcessingJobRecord | null) {
  switch (job?.errorStage) {
    case "upload":
      return "Document recu";
    case "webhook":
      return "Analyse IA";
    case "xml":
    case "callback":
      return "Fiche CDC prete pour revision";
    default:
      return "Analyse IA";
  }
}

function mapFailureStageToStep(stageLabel: string) {
  switch (stageLabel) {
    case "Document recu":
      return 2;
    case "Analyse IA":
      return 3;
    case "Fiche CDC prete pour revision":
      return 4;
    default:
      return null;
  }
}

function trimTrailingPeriod(value: string) {
  return value.trim().replace(/[.]+$/g, "");
}

function buildFailureReason(job: ProcessingJobRecord): string | null {
  const safeMessage = job.errorMessage ? toBusinessSafeAnalysisError(job.errorMessage) : null;

  switch (job.errorCode) {
    case "N8N_EXECUTION_CANCELLED":
      return "execution n8n annulee";
    case "SOURCE_PDF_READ_FAILED":
      return "lecture du CDC impossible";
    case "WORKFLOW_CONFIGURATION_ERROR":
      return "configuration du workflow incomplete";
    case "N8N_LAUNCH_FAILED":
      return safeMessage ? trimTrailingPeriod(safeMessage) : "echec du lancement de l'analyse";
    default:
      return safeMessage ? trimTrailingPeriod(safeMessage) : null;
  }
}

function buildAnalysisFailureDescription() {
  return "La generation de la Fiche CDC n'a pas pu etre terminee.";
}

function formatFileDescription(fileName: string | null | undefined) {
  return typeof fileName === "string" && fileName.trim() ? `Fichier : ${fileName}` : null;
}

function mapAuditAction(
  entry: AuditLogRecord,
  options?: {
    isReplacement?: boolean;
  }
): WorkspaceActivityDraft | null {
  if (HIDDEN_AUDIT_ACTIONS.has(entry.action)) {
    return null;
  }

  switch (entry.action) {
    case "appel_offres.created":
      return {
        id: `audit-${entry.id}`,
        kind: "created",
        label: "Dossier cree",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "default",
        dedupeKey: "dossier-cree"
      };
    case "appel_offres.updated":
    case "appel_offres.business_status_changed":
    case "appel_offres.create.requested":
      return null;
    case "appel_offres.cdc_uploaded":
      return {
        id: `audit-${entry.id}`,
        kind: options?.isReplacement ? "cdc_replaced" : "cdc_received",
        label: options?.isReplacement ? "CDC remplace" : "CDC recu",
        description: formatFileDescription(
          typeof entry.details?.fileName === "string" ? entry.details.fileName : null
        ),
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "default",
        dedupeKey: options?.isReplacement ? "cdc-remplace" : "cdc-importe"
      };
    case "analysis_requested":
      return {
        id: `audit-${entry.id}`,
        kind: "analysis_started",
        label: "Traitement du CDC demarre",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "ai",
        dedupeKey: "analyse-lancee"
      };
    case "analysis_completed":
      return {
        id: `audit-${entry.id}`,
        kind: "analysis_completed",
        label: "Analyse terminee",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "ai",
        dedupeKey: "analyse-terminee"
      };
    case "fiche_cdc_generated":
      return {
        id: `audit-${entry.id}`,
        kind: "fiche_generated",
        label: "Fiche CDC generee",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "ai",
        dedupeKey: "fiche-generee"
      };
    case "fiche_cdc.saved":
      return {
        id: `audit-${entry.id}`,
        kind: "fiche_modified",
        label: "Fiche CDC modifiee",
        description: "Mise a jour apres relecture commerciale.",
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "default",
        dedupeKey: "fiche-modifiee"
      };
    case "fiche_cdc.validated":
      return {
        id: `audit-${entry.id}`,
        kind: "fiche_validated",
        label: "Fiche CDC validee",
        description: "Validation effectuee par le commercial.",
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "success",
        dedupeKey: "fiche-validee"
      };
    case "analysis_failed":
    case "n8n_launch_failed":
      return {
        id: `audit-${entry.id}`,
        kind: "analysis_failed",
        label: "Dossier a verifier",
        description: buildAnalysisFailureDescription(),
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "warning",
        dedupeKey: "analyse-interrompue"
      };
    case "appel_offres.archived":
      return {
        id: `audit-${entry.id}`,
        kind: "archived",
        label: "Dossier archive",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "default",
        dedupeKey: "dossier-archive"
      };
    case "appel_offres.unarchived":
      return {
        id: `audit-${entry.id}`,
        kind: "reopened",
        label: "Dossier reactive",
        description: "Le dossier est de nouveau actif.",
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "success",
        dedupeKey: "dossier-reactive"
      };
    default:
      return null;
  }
}

function dedupeWorkspaceActivity(items: WorkspaceActivityDraft[]): WorkspaceActivityItem[] {
  const seen = new Set<string>();

  return items
    .filter((item) => {
      const minuteBucket = item.createdAt.slice(0, 16);
      const descriptionKey = item.description ? normalizeComparable(item.description) : "";
      const dedupeKey = `${item.dedupeKey}:${minuteBucket}:${descriptionKey}`;

      if (seen.has(dedupeKey)) {
        return false;
      }

      seen.add(dedupeKey);
      return true;
    })
    .map(({ dedupeKey: _dedupeKey, ...item }) => item);
}

const WORKSPACE_ACTIVITY_ORDER: Record<WorkspaceActivityKind, number> = {
  created: 1,
  cdc_received: 2,
  cdc_replaced: 2,
  analysis_started: 3,
  analysis_completed: 4,
  fiche_generated: 5,
  fiche_modified: 6,
  fiche_validated: 7,
  analysis_failed: 8,
  archived: 9,
  reopened: 10
};

function compareWorkspaceActivity(left: WorkspaceActivityDraft, right: WorkspaceActivityDraft) {
  const chronology = right.createdAt.localeCompare(left.createdAt);
  if (chronology !== 0) {
    return chronology;
  }

  const orderDelta = WORKSPACE_ACTIVITY_ORDER[left.kind] - WORKSPACE_ACTIVITY_ORDER[right.kind];
  if (orderDelta !== 0) {
    return orderDelta;
  }

  const leftAuditId = Number(left.id.replace("audit-", ""));
  const rightAuditId = Number(right.id.replace("audit-", ""));

  return leftAuditId - rightAuditId;
}

export function isPlaceholderProjectTitle(title: string, code: string) {
  const normalizedTitle = normalizeComparable(title);
  const normalizedCode = normalizeComparable(code);

  return !normalizedTitle || normalizedTitle === normalizedCode;
}

export function buildWorkspaceIdentity(appel: AppelOffresDetail): WorkspaceIdentity {
  return {
    displayTitle: isPlaceholderProjectTitle(appel.title, appel.code)
      ? "Intitule en attente d'extraction"
      : appel.title,
    isTitlePendingExtraction: isPlaceholderProjectTitle(appel.title, appel.code),
    clientLabel: isNonEmpty(appel.buyer) ? appel.buyer : "En attente d'extraction",
    countryLabel: isNonEmpty(appel.country) ? appel.country : "En attente d'extraction",
    dueDateLabel: appel.dueDate ? appel.dueDate : "Non renseignee",
    responsibleLabel: isNonEmpty(appel.responsableCommercial)
      ? appel.responsableCommercial
      : "Non renseigne",
    priorityLabel: isNonEmpty(appel.priorite) ? capitalize(appel.priorite) : "Normale"
  };
}

export function buildWorkspaceActions(appel: AppelOffresDetail): WorkspaceActions {
  const latestJob = getLatestProcessingJob(appel);
  const hasFiche = hasReviewableFiche(appel);
  const ficheValidated = appel.ficheStatus?.status === "validated";
  const canLaunchAnalysis =
    appel.archivedAt == null &&
    appel.artifacts.hasSourcePdf &&
    !isActiveProcessingJob(latestJob);
  const canValidateFiche = appel.ficheStatus?.status === "draft";

  const secondary: WorkspaceAction[] = [];

  if (hasFiche) {
    secondary.push({
      kind: "open-fiche",
      label: ficheValidated ? "Consulter la Fiche CDC" : "Reviser la Fiche CDC",
      tone: "secondary"
    });
  }

  if (canValidateFiche) {
    secondary.push({
      kind: "validate-fiche",
      label: "Valider la Fiche CDC",
      tone: "secondary"
    });
  }

  if (appel.artifacts.hasSourcePdf) {
    secondary.push({
      kind: "download-cdc",
      label: "Telecharger le CDC",
      tone: "secondary"
    });
  }

  secondary.push({
    kind: "edit-overview",
    label: "Modifier la Fiche CDC",
    tone: "secondary"
  });

  secondary.push(
    appel.archivedAt
      ? { kind: "unarchive", label: "Reactiver", tone: "ghost" }
      : { kind: "archive", label: "Archiver", tone: "ghost" }
  );

  if (appel.archivedAt) {
    return {
      primary: {
        kind: "unarchive",
        label: "Reactiver",
        tone: "secondary"
      },
      secondary
    };
  }

  if (isActiveProcessingJob(latestJob)) {
    const activeSecondary = secondary.filter((action) =>
      ["download-cdc", "edit-overview", "archive"].includes(action.kind)
    );

    return {
      primary: null,
      secondary: activeSecondary
    };
  }

  if (canLaunchAnalysis && (latestJob?.status === "failed" || appel.ficheStatus?.status === "error")) {
    return {
      primary: {
        kind: "launch-analysis",
        label: "Reessayer",
        tone: "ai"
      },
      secondary
    };
  }

  if (canLaunchAnalysis && !hasFiche) {
    return {
      primary: {
        kind: "launch-analysis",
        label: "Lancer l'analyse",
        tone: "ai"
      },
      secondary
    };
  }

  if (hasFiche) {
    return {
      primary: {
        kind: "open-fiche",
        label: ficheValidated ? "Consulter la Fiche CDC" : "Reviser la Fiche CDC",
        tone: "primary"
      },
      secondary
    };
  }

  return {
    primary: {
      kind: "edit-overview",
      label: "Modifier la Fiche CDC",
      tone: "secondary"
    },
    secondary
  };
}

export function buildProcessingTimeline(appel: AppelOffresDetail): WorkspaceTimelineStep[] {
  const latestJob = getLatestProcessingJob(appel);
  const sourcePdf = getDocument(appel, "source_pdf");
  const ficheXml = getDocument(appel, "fiche_xml");
  const analysisRequested = findAuditLog(appel, "analysis_requested", "n8n_launch_accepted");
  const ficheGenerated = findAuditLog(appel, "fiche_cdc_generated", "analysis_completed");
  const ficheReady = hasReviewableFiche(appel);
  const analysisActive =
    isActiveProcessingJob(latestJob) || appel.ficheStatus?.status === "processing";
  const analysisFailed =
    isFailedJob(latestJob) || appel.ficheStatus?.status === "error";
  const failedTimelineLabel = mapFailureStageToTimelineLabel(latestJob);

  const steps: WorkspaceTimelineStep[] = [
    {
      key: "created",
      label: "Dossier cree",
      state: "complete",
      timestamp: appel.createdAt,
      detail: null
    },
    {
      key: "cdc_received",
      label: "Document recu",
      state:
        sourcePdf != null
          ? "complete"
          : latestJob?.errorStage === "upload"
            ? "failed"
            : "waiting",
      timestamp: sourcePdf?.createdAt ?? null,
      detail: sourcePdf ? sourcePdf.fileName : "En attente du CDC PDF"
    },
    {
      key: "analysis_ai",
      label: "Analyse IA",
      state:
        ficheReady || latestJob?.status === "completed"
          ? "complete"
          : analysisFailed && failedTimelineLabel === "Analyse IA"
            ? "failed"
            : analysisActive
              ? "active"
              : "waiting",
      timestamp:
        latestJob?.launchAcceptedAt ??
        latestJob?.startedAt ??
        analysisRequested?.createdAt ??
        null,
      detail:
        ficheReady || latestJob?.status === "completed"
          ? "Analyse terminee"
          : analysisFailed && failedTimelineLabel === "Analyse IA"
            ? "L'analyse n'a pas pu aboutir"
            : analysisActive
              ? "Extraction et generation en cours"
              : sourcePdf
                ? "Prete a etre lancee"
                : "En attente du document"
    },
    {
      key: "fiche_ready",
      label: "Fiche CDC prete pour revision",
      state:
        ficheReady
          ? "complete"
          : analysisFailed && failedTimelineLabel === "Fiche CDC prete pour revision"
            ? "failed"
            : "waiting",
      timestamp:
        ficheXml?.createdAt ??
        ficheGenerated?.createdAt ??
        latestJob?.finishedAt ??
        null,
      detail:
        appel.ficheStatus?.status === "draft" || appel.ficheStatus?.status === "validated"
          ? "Fiche CDC validee"
          : ficheReady
            ? "Prete pour relecture commerciale"
            : analysisFailed && failedTimelineLabel === "Fiche CDC prete pour revision"
              ? "La fiche n'a pas pu etre preparee"
              : "En attente de l'analyse IA"
    }
  ];

  return steps;
}

export function buildWorkspaceActivityFeed(appel: AppelOffresDetail) {
  const orderedCdcUploads = appel.auditLogs
    .filter((entry) => entry.action === "appel_offres.cdc_uploaded")
    .slice()
    .sort((left, right) => {
      const chronology = left.createdAt.localeCompare(right.createdAt);
      if (chronology !== 0) {
        return chronology;
      }

      return left.id - right.id;
    });

  const firstCdcUploadId = orderedCdcUploads[0]?.id ?? null;

  const activity = appel.auditLogs
    .map((entry) => {
      if (entry.action === "appel_offres.cdc_uploaded") {
        const mapped = mapAuditAction(entry, {
          isReplacement: entry.id !== firstCdcUploadId
        });
        return mapped;
      }

      return mapAuditAction(entry);
    })
    .filter((item): item is WorkspaceActivityDraft => item !== null)
    .sort(compareWorkspaceActivity);

  return dedupeWorkspaceActivity(activity);
}

export function buildWorkspaceFailureSummary(appel: AppelOffresDetail): WorkspaceFailureSummary | null {
  const latestJob = getLatestProcessingJob(appel);
  if (!latestJob || latestJob.status !== "failed") {
    return null;
  }

  const stageLabel = mapFailureStageToTimelineLabel(latestJob);
  const reason = buildFailureReason(latestJob);

  return {
    stageLabel,
    message:
      stageLabel === "Document recu"
        ? "Le CDC n'a pas pu etre prepare pour l'analyse."
        : stageLabel === "Fiche CDC prete pour revision"
          ? "L'analyse IA s'est arretee avant la mise a disposition de la Fiche CDC."
          : "L'analyse IA a ete interrompue avant la generation de la Fiche CDC.",
    failedAt: latestJob.finishedAt ?? latestJob.callbackReceivedAt ?? latestJob.startedAt,
    failedStep: mapFailureStageToStep(stageLabel),
    reason,
    recommendation: !isActiveProcessingJob(latestJob) ? "Relancer l'analyse." : null,
    technicalDetails: latestJob.errorMessage
      ? toBusinessSafeAnalysisError(latestJob.errorMessage) === latestJob.errorMessage
        ? latestJob.errorMessage
        : null
      : null,
    retryAvailable: !isActiveProcessingJob(latestJob)
  };
}
