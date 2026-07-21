import type { AppelOffresDetail, AuditLogRecord, DocumentRecord, ProcessingJobRecord } from "./types.ts";
import { toBusinessSafeAnalysisError } from "./user-errors.ts";

export type WorkspaceTabKey = "overview" | "documents" | "processing" | "fiche" | "history";

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

export type WorkspaceActivityItem = {
  id: string;
  label: string;
  description: string | null;
  actor: string | null;
  createdAt: string;
  tone: WorkspaceActivityTone;
};

export type WorkspaceActionKind =
  | "launch-analysis"
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
};

export type WorkspaceActions = {
  primary: WorkspaceAction | null;
  secondary: WorkspaceAction[];
};

export type WorkspaceFailureSummary = {
  stageLabel: string;
  message: string;
  failedAt: string | null;
  technicalDetails: string | null;
  retryAvailable: boolean;
};

const HIDDEN_AUDIT_ACTIONS = new Set([
  "callback_received",
  "duplicate_callback_ignored",
  "late_callback_ignored"
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

function hasExtractionStarted(appel: AppelOffresDetail) {
  return (
    appel.artifacts.hasSourcePdf ||
    appel.processingJobs.length > 0 ||
    appel.ficheStatus?.status === "processing" ||
    appel.ficheStatus?.status === "draft" ||
    appel.ficheStatus?.status === "validated"
  );
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

function mapFailureStageToTimelineLabel(job: ProcessingJobRecord | null) {
  switch (job?.errorStage) {
    case "webhook":
      return "Analyse lancee";
    case "xml":
    case "callback":
      return "Fiche CDC generee";
    default:
      return "Analyse IA";
  }
}

function mapAuditAction(entry: AuditLogRecord): WorkspaceActivityItem | null {
  if (HIDDEN_AUDIT_ACTIONS.has(entry.action)) {
    return null;
  }

  switch (entry.action) {
    case "appel_offres.create.requested":
    case "appel_offres.created":
      return {
        id: `audit-${entry.id}`,
        label: "Dossier cree",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "default"
      };
    case "appel_offres.updated":
      return {
        id: `audit-${entry.id}`,
        label: "Informations du dossier modifiees",
        description: Array.isArray(entry.details?.changedFields)
          ? `${entry.details.changedFields.length} champ(s) mis a jour`
          : null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "default"
      };
    case "appel_offres.cdc_uploaded":
      return {
        id: `audit-${entry.id}`,
        label: "CDC importe",
        description:
          typeof entry.details?.fileName === "string" ? entry.details.fileName : null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "default"
      };
    case "analysis_requested":
      return {
        id: `audit-${entry.id}`,
        label: "Analyse demandee",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "ai"
      };
    case "n8n_launch_accepted":
      return {
        id: `audit-${entry.id}`,
        label: "Analyse lancee",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "ai"
      };
    case "analysis_completed":
      return {
        id: `audit-${entry.id}`,
        label: "Analyse terminee",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "success"
      };
    case "fiche_cdc_generated":
      return {
        id: `audit-${entry.id}`,
        label: "Fiche CDC generee",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "success"
      };
    case "fiche_cdc.saved":
      return {
        id: `audit-${entry.id}`,
        label: "Fiche CDC enregistree",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "default"
      };
    case "fiche_cdc.validated":
      return {
        id: `audit-${entry.id}`,
        label: "Fiche CDC validee",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "success"
      };
    case "analysis_failed":
    case "n8n_launch_failed":
      return {
        id: `audit-${entry.id}`,
        label: "Analyse en echec",
        description:
          typeof entry.details?.error === "string"
            ? toBusinessSafeAnalysisError(entry.details.error)
            : null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "danger"
      };
    case "appel_offres.archived":
      return {
        id: `audit-${entry.id}`,
        label: "Dossier archive",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "warning"
      };
    case "appel_offres.unarchived":
      return {
        id: `audit-${entry.id}`,
        label: "Dossier reactive",
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "success"
      };
    default:
      return {
        id: `audit-${entry.id}`,
        label: entry.action,
        description: null,
        actor: entry.actor,
        createdAt: entry.createdAt,
        tone: "default"
      };
  }
}

export function isPlaceholderProjectTitle(title: string, code: string) {
  const normalizedTitle = normalizeComparable(title);
  const normalizedCode = normalizeComparable(code);

  return !normalizedTitle || normalizedTitle === normalizedCode;
}

export function buildWorkspaceIdentity(appel: AppelOffresDetail): WorkspaceIdentity {
  const extractionStarted = hasExtractionStarted(appel);

  return {
    displayTitle: isPlaceholderProjectTitle(appel.title, appel.code)
      ? "Intitule en attente d'extraction"
      : appel.title,
    isTitlePendingExtraction: isPlaceholderProjectTitle(appel.title, appel.code),
    clientLabel: isNonEmpty(appel.buyer)
      ? appel.buyer
      : extractionStarted
        ? "A extraire"
        : "Non renseigne",
    countryLabel: isNonEmpty(appel.country)
      ? appel.country
      : extractionStarted
        ? "A extraire"
        : "Non renseigne",
    dueDateLabel: appel.dueDate ? appel.dueDate : "Non renseignee",
    responsibleLabel: isNonEmpty(appel.responsableCommercial)
      ? appel.responsableCommercial
      : "Non renseigne",
    priorityLabel: isNonEmpty(appel.priorite) ? capitalize(appel.priorite) : "Normale"
  };
}

export function buildWorkspaceActions(appel: AppelOffresDetail): WorkspaceActions {
  const latestJob = getLatestProcessingJob(appel);
  const hasFiche = appel.artifacts.hasFicheXml || Boolean(appel.ficheStatus);
  const canLaunchAnalysis =
    appel.archivedAt == null &&
    appel.artifacts.hasSourcePdf &&
    !isActiveProcessingJob(latestJob);
  const canValidateFiche = appel.ficheStatus?.status === "draft";

  const secondary: WorkspaceAction[] = [];

  if (hasFiche) {
    secondary.push({
      kind: "open-fiche",
      label: "Ouvrir la Fiche CDC",
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
    label: "Modifier les informations",
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

  if (canLaunchAnalysis && (latestJob?.status === "failed" || appel.ficheStatus?.status === "error")) {
    return {
      primary: {
        kind: "launch-analysis",
        label: "Relancer l'analyse",
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
        label: "Ouvrir la Fiche CDC",
        tone: "primary"
      },
      secondary
    };
  }

  return {
    primary: {
      kind: "edit-overview",
      label: "Modifier les informations",
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
      label: "CDC recu",
      state: sourcePdf ? "complete" : "waiting",
      timestamp: sourcePdf?.createdAt ?? null,
      detail: sourcePdf ? sourcePdf.fileName : "En attente d'import"
    },
    {
      key: "pdf_stored",
      label: "PDF enregistre",
      state: sourcePdf ? "complete" : "waiting",
      timestamp: sourcePdf?.createdAt ?? null,
      detail: sourcePdf ? "Document disponible dans le workspace" : "En attente"
    },
    {
      key: "analysis_requested",
      label: "Analyse lancee",
      state:
        latestJob == null
          ? "waiting"
          : isFailedJob(latestJob) && failedTimelineLabel === "Analyse lancee"
            ? "failed"
            : isActiveProcessingJob(latestJob)
              ? "active"
              : "complete",
      timestamp:
        latestJob?.launchAcceptedAt ??
        latestJob?.startedAt ??
        analysisRequested?.createdAt ??
        null,
      detail:
        latestJob == null
          ? "En attente"
          : latestJob.executionId
            ? "Traitement accepte par n8n"
            : "Demande transmise"
    },
    {
      key: "analysis_ai",
      label: "Analyse IA",
      state:
        latestJob == null
          ? "waiting"
          : isFailedJob(latestJob) && failedTimelineLabel === "Analyse IA"
            ? "failed"
            : isActiveProcessingJob(latestJob)
              ? "active"
              : "complete",
      timestamp: latestJob?.startedAt ?? null,
      detail:
        latestJob == null
          ? "En attente"
          : latestJob.status === "completed"
            ? "Analyse terminee"
            : latestJob.status === "failed"
              ? "Traitement interrompu"
              : "En cours"
    },
    {
      key: "fiche_generated",
      label: "Fiche CDC generee",
      state:
        ficheXml != null
          ? "complete"
          : isFailedJob(latestJob) && failedTimelineLabel === "Fiche CDC generee"
            ? "failed"
            : isActiveProcessingJob(latestJob)
              ? "waiting"
              : "waiting",
      timestamp: ficheXml?.createdAt ?? ficheGenerated?.createdAt ?? null,
      detail: ficheXml ? "XML et artefacts disponibles" : "En attente"
    },
    {
      key: "result_available",
      label: "Resultat disponible",
      state:
        appel.ficheStatus?.status === "draft" || appel.ficheStatus?.status === "validated"
          ? "complete"
          : latestJob?.status === "failed"
            ? "failed"
            : isActiveProcessingJob(latestJob)
              ? "waiting"
              : "waiting",
      timestamp:
        ficheXml?.createdAt ??
        latestJob?.finishedAt ??
        null,
      detail:
        appel.ficheStatus?.status === "validated"
          ? "Fiche CDC validee"
          : appel.ficheStatus?.status === "draft"
            ? "Fiche CDC a verifier"
            : "En attente"
    }
  ];

  return steps;
}

export function buildWorkspaceActivityFeed(appel: AppelOffresDetail) {
  return appel.auditLogs
    .map(mapAuditAction)
    .filter((item): item is WorkspaceActivityItem => item !== null)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function buildWorkspaceFailureSummary(appel: AppelOffresDetail): WorkspaceFailureSummary | null {
  const latestJob = getLatestProcessingJob(appel);
  if (!latestJob || latestJob.status !== "failed") {
    return null;
  }

  return {
    stageLabel: mapFailureStageToTimelineLabel(latestJob),
    message:
      "L'analyse n'a pas pu etre terminee. Le dossier et le CDC ont ete conserves. Vous pouvez relancer le traitement.",
    failedAt: latestJob.finishedAt ?? latestJob.callbackReceivedAt ?? latestJob.startedAt,
    technicalDetails: latestJob.errorMessage
      ? toBusinessSafeAnalysisError(latestJob.errorMessage) === latestJob.errorMessage
        ? latestJob.errorMessage
        : null
      : null,
    retryAvailable: !isActiveProcessingJob(latestJob)
  };
}
