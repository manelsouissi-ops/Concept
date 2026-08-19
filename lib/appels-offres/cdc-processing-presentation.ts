import type { AppelOffresDetail, ProcessingJobRecord } from "./types.ts";

export const LONG_CDC_PROCESSING_THRESHOLD_MS = 10 * 60 * 1000;

export type CdcProcessingPresentation = {
  state: "processing" | "ready" | "failed" | "received";
  step: string;
  startedAt: string | null;
  indeterminate: boolean;
  percentage: null;
  isLongRunning: boolean;
};

export function formatElapsedDuration(startedAt: string | null, nowMs: number) {
  if (!startedAt) return "00:00";
  const startedMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs)) return "00:00";
  const seconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function latestJob(detail: AppelOffresDetail): ProcessingJobRecord | null {
  return detail.latestJob ?? detail.processingJobs[0] ?? null;
}

export function getPersistedProcessingStartedAt(detail: AppelOffresDetail) {
  const job = latestJob(detail);
  return (
    detail.ficheStatus?.processingStartedAt ??
    job?.launchAcceptedAt ??
    job?.startedAt ??
    null
  );
}

function pipelineStage(job: ProcessingJobRecord | null) {
  return typeof job?.metadata?.pipelineStage === "string"
    ? job.metadata.pipelineStage
    : null;
}

export function deriveCdcProcessingPresentation(
  detail: AppelOffresDetail,
  nowMs = Date.now()
): CdcProcessingPresentation {
  const job = latestJob(detail);
  const startedAt = getPersistedProcessingStartedAt(detail);
  const elapsedMs = startedAt ? Math.max(0, nowMs - new Date(startedAt).getTime()) : 0;
  const hasAuthoritativeFiche =
    detail.artifacts.hasFicheXml &&
    (detail.ficheStatus?.status === "draft" || detail.ficheStatus?.status === "validated");

  if (hasAuthoritativeFiche) {
    return {
      state: "ready",
      step: "Prête pour vérification",
      startedAt,
      indeterminate: false,
      percentage: null,
      isLongRunning: false
    };
  }

  if (detail.ficheStatus?.status === "error" || job?.status === "failed" || job?.status === "cancelled") {
    return {
      state: "failed",
      step: "Traitement interrompu",
      startedAt,
      indeterminate: false,
      percentage: null,
      isLongRunning: false
    };
  }

  const stage = pipelineStage(job);
  let step = "CDC reçu";
  if (stage?.startsWith("document_processing")) {
    step = stage === "document_processing_running" ? "Analyse du document" : "Extraction des informations et génération de la Fiche CDC";
  } else if (stage?.startsWith("cdc_extraction")) {
    step = "Extraction des informations et génération de la Fiche CDC";
  } else if (job && ["queued", "running"].includes(job.status)) {
    step = "Analyse et extraction des informations";
  }

  const processing =
    detail.ficheStatus?.status === "processing" ||
    Boolean(job && ["queued", "running", "completed"].includes(job.status));

  return {
    state: processing ? "processing" : "received",
    step,
    startedAt,
    indeterminate: processing,
    percentage: null,
    isLongRunning: processing && elapsedMs >= LONG_CDC_PROCESSING_THRESHOLD_MS
  };
}
