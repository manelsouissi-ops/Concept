import type {
  AppelOffresDetail,
  DocumentKind,
  ProcessingJobRecord
} from "./types.ts";

export type BadgeTone =
  | "neutral"
  | "ai"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type BusinessStatusKey =
  | "brouillon"
  | "cdc_importe"
  | "en_attente_analyse"
  | "analyse_en_cours"
  | "fiche_a_valider"
  | "fiche_validee"
  | "erreur"
  | "archive";

export type ProgressStep = {
  key: string;
  label: string;
  completed: boolean;
  current: boolean;
  disabled?: boolean;
};

export type AppelOffresSummaryView = {
  code: string;
  title: string;
  client: string;
  country: string;
  reference: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  statusKey: BusinessStatusKey;
  statusLabel: string;
  statusTone: BadgeTone;
  statusDescription: string;
  priorityLabel: string;
  ownerLabel: string;
  progressValue: number;
  progressLabel: string;
  nextAction: string;
  currentStep: string;
  ficheStatusLabel: string;
  processingStateLabel: string;
  documentsCount: number;
  hasSourcePdf: boolean;
  hasStructuredFiche: boolean;
  latestJobLabel: string | null;
  latestJobStatusLabel: string | null;
  daysUntilDeadline: number | null;
  isOverdue: boolean;
  archivedAt: string | null;
  isArchived: boolean;
};

const STATUS_LABELS: Record<BusinessStatusKey, string> = {
  brouillon: "Brouillon",
  cdc_importe: "CDC importe",
  en_attente_analyse: "En attente d'analyse",
  analyse_en_cours: "Analyse en cours",
  fiche_a_valider: "Fiche CDC a valider",
  fiche_validee: "Fiche CDC validee",
  erreur: "Erreur",
  archive: "Archive"
};

const STATUS_TONES: Record<BusinessStatusKey, BadgeTone> = {
  brouillon: "neutral",
  cdc_importe: "info",
  en_attente_analyse: "warning",
  analyse_en_cours: "ai",
  fiche_a_valider: "warning",
  fiche_validee: "success",
  erreur: "danger",
  archive: "neutral"
};

const PROCESSING_JOB_LABELS: Record<ProcessingJobRecord["jobType"], string> = {
  appel_offres_upload: "Creation du dossier",
  appel_offres_update: "Mise a jour du CDC",
  fiche_generation: "Analyse et generation de la Fiche CDC"
};

const PROCESSING_JOB_STATUS_LABELS: Record<ProcessingJobRecord["status"], string> = {
  created: "Cree",
  queued: "En attente",
  running: "En cours",
  completed: "Termine",
  failed: "Echoue",
  cancelled: "Annule",
  retrying: "Nouvelle tentative"
};

const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  source_pdf: "CDC PDF",
  fiche_xml: "Fiche CDC structuree",
  fiche_markdown: "Markdown du CDC",
  status_json: "Statut de traitement"
};

function hasAnalysisStarted(appel: AppelOffresDetail) {
  return appel.processingJobs.some((job) => job.jobType === "fiche_generation");
}

function getRawBusinessStatus(appel: AppelOffresDetail): BusinessStatusKey {
  const ficheStatus = appel.ficheStatus?.status ?? null;

  if (appel.status === "archived" || appel.archivedAt) {
    return "archive";
  }

  if (appel.businessStatus != null) {
    return appel.businessStatus;
  }

  if (
    appel.status === "error" ||
    ficheStatus === "error" ||
    appel.processingJobs.some((job) => job.status === "failed")
  ) {
    return "erreur";
  }

  if (ficheStatus === "validated") {
    return "fiche_validee";
  }

  if (ficheStatus === "draft" || appel.artifacts.hasFicheXml) {
    return "fiche_a_valider";
  }

  if (
    ficheStatus === "processing" ||
    appel.status === "processing" ||
    appel.processingJobs.some((job) =>
      ["created", "queued", "running", "retrying"].includes(job.status)
    )
  ) {
    return "analyse_en_cours";
  }

  if (appel.artifacts.hasSourcePdf && hasAnalysisStarted(appel)) {
    return "en_attente_analyse";
  }

  if (appel.artifacts.hasSourcePdf) {
    return "cdc_importe";
  }

  return appel.status === "draft" ? "brouillon" : "en_attente_analyse";
}

function getStatusDescription(status: BusinessStatusKey) {
  switch (status) {
    case "brouillon":
      return "Le dossier est cree mais encore incomplet.";
    case "cdc_importe":
      return "Le CDC est stocke et pret pour l'analyse.";
    case "en_attente_analyse":
      return "L'analyse peut etre lancee des que l'equipe est prete.";
    case "analyse_en_cours":
      return "Le traitement du CDC est en cours.";
    case "fiche_a_valider":
      return "La Fiche CDC est disponible pour revue commerciale.";
    case "fiche_validee":
      return "La Fiche CDC a ete validee et le dossier peut avancer.";
    case "erreur":
      return "Une erreur bloque actuellement le traitement.";
    case "archive":
      return "Le dossier est archive et hors du circuit actif.";
  }
}

function getCurrentStep(status: BusinessStatusKey) {
  switch (status) {
    case "brouillon":
      return "Appel d'offres cree";
    case "cdc_importe":
    case "en_attente_analyse":
      return "CDC importe";
    case "analyse_en_cours":
      return "Analyse du contenu";
    case "fiche_a_valider":
      return "Fiche CDC generee";
    case "fiche_validee":
      return "Fiche CDC validee";
    case "erreur":
      return "Traitement en erreur";
    case "archive":
      return "Appel d'offres archive";
  }
}

function getNextAction(status: BusinessStatusKey) {
  switch (status) {
    case "brouillon":
      return "Completer le dossier et importer le CDC";
    case "cdc_importe":
    case "en_attente_analyse":
      return "Lancer l'analyse";
    case "analyse_en_cours":
      return "Suivre l'avancement du traitement";
    case "fiche_a_valider":
      return "Valider la Fiche CDC";
    case "fiche_validee":
      return "Preparer les FCI";
    case "erreur":
      return "Relancer l'analyse";
    case "archive":
      return "Consulter l'historique";
  }
}

function buildProgressSteps(appel: AppelOffresDetail, status: BusinessStatusKey): ProgressStep[] {
  const cdcImported = appel.artifacts.hasSourcePdf;
  const analysisStarted = hasAnalysisStarted(appel) || appel.ficheStatus?.status === "processing";
  const ficheGenerated = appel.artifacts.hasFicheXml || appel.ficheStatus?.status === "draft";
  const ficheValidated = appel.ficheStatus?.status === "validated";

  return [
    {
      key: "created",
      label: "Appel d'offres cree",
      completed: true,
      current: status === "brouillon"
    },
    {
      key: "cdc",
      label: "CDC importe",
      completed: cdcImported,
      current: !cdcImported && status !== "brouillon"
    },
    {
      key: "analysis",
      label: "Analyse lancee",
      completed: analysisStarted,
      current: status === "analyse_en_cours"
    },
    {
      key: "fiche",
      label: "Fiche CDC generee",
      completed: ficheGenerated,
      current: status === "fiche_a_valider"
    },
    {
      key: "validated",
      label: "Fiche CDC validee",
      completed: ficheValidated,
      current: status === "fiche_validee"
    },
    {
      key: "fci",
      label: "FCI distribuees",
      completed: false,
      current: false,
      disabled: true
    },
    {
      key: "decision",
      label: "Decision Go / No-Go",
      completed: false,
      current: false,
      disabled: true
    }
  ];
}

function getProgressValue(status: BusinessStatusKey) {
  switch (status) {
    case "brouillon":
      return 20;
    case "cdc_importe":
    case "en_attente_analyse":
      return 40;
    case "analyse_en_cours":
      return 60;
    case "fiche_a_valider":
      return 80;
    case "fiche_validee":
      return 100;
    case "erreur":
      return 60;
    case "archive":
      return 100;
  }
}

function getDaysUntilDeadline(value: string | null) {
  if (!value) {
    return null;
  }

  const today = new Date();
  const deadline = new Date(value);
  const msPerDay = 1000 * 60 * 60 * 24;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDeadline = new Date(
    deadline.getFullYear(),
    deadline.getMonth(),
    deadline.getDate()
  ).getTime();

  return Math.round((startOfDeadline - startOfToday) / msPerDay);
}

function capitalize(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function getDocumentLabel(kind: DocumentKind) {
  return DOCUMENT_LABELS[kind];
}

export function buildAppelOffresSummary(appel: AppelOffresDetail): AppelOffresSummaryView {
  const statusKey = getRawBusinessStatus(appel);
  const latestJob = appel.processingJobs[0] ?? null;
  const daysUntilDeadline = getDaysUntilDeadline(appel.dueDate);

  return {
    code: appel.code,
    title: appel.title,
    client: appel.buyer || "Non renseigne",
    country: appel.country || "Non renseigne",
    reference: appel.reference || "Non renseignee",
    dueDate: appel.dueDate,
    createdAt: appel.createdAt,
    updatedAt: appel.updatedAt,
    statusKey,
    statusLabel: STATUS_LABELS[statusKey],
    statusTone: STATUS_TONES[statusKey],
    statusDescription: getStatusDescription(statusKey),
    priorityLabel: capitalize(appel.priorite),
    ownerLabel: appel.responsableCommercial || "Non renseigne",
    progressValue: getProgressValue(statusKey),
    progressLabel: `${getProgressValue(statusKey)} %`,
    nextAction: getNextAction(statusKey),
    currentStep: getCurrentStep(statusKey),
    ficheStatusLabel:
      appel.ficheStatus?.status === "validated"
        ? "Validee"
        : appel.ficheStatus?.status === "draft"
          ? "A valider"
          : appel.ficheStatus?.status === "processing"
            ? "En cours"
            : appel.ficheStatus?.status === "error"
              ? "En erreur"
              : "Non generee",
    processingStateLabel:
      latestJob == null
        ? "Aucun traitement lance"
        : PROCESSING_JOB_STATUS_LABELS[latestJob.status],
    documentsCount: appel.documents.length,
    hasSourcePdf: appel.artifacts.hasSourcePdf,
    hasStructuredFiche: appel.artifacts.hasFicheXml,
    latestJobLabel: latestJob ? PROCESSING_JOB_LABELS[latestJob.jobType] : null,
    latestJobStatusLabel: latestJob ? PROCESSING_JOB_STATUS_LABELS[latestJob.status] : null,
    daysUntilDeadline,
    isOverdue: daysUntilDeadline != null && daysUntilDeadline < 0,
    archivedAt: appel.archivedAt,
    isArchived: appel.archivedAt != null
  };
}

export function buildProgressStepper(appel: AppelOffresDetail) {
  return buildProgressSteps(appel, getRawBusinessStatus(appel));
}

export function isAnalysisRunning(appel: AppelOffresDetail) {
  return getRawBusinessStatus(appel) === "analyse_en_cours";
}

export function isNearDeadline(appel: AppelOffresDetail, thresholdDays = 14) {
  const days = getDaysUntilDeadline(appel.dueDate);
  return days != null && days >= 0 && days <= thresholdDays;
}
