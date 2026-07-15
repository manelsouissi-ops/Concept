import path from "path";
import { parseFiche, serializeFiche } from "@/lib/fiche-xml";
import { syncFicheIndexSafely } from "@/lib/db";
import {
  buildCallbackIdempotencyKey,
  generateCorrelationId,
  generateProcessingJobPublicId,
  type N8nCallbackPayload,
  type N8nFailureCallback,
  type N8nLaunchAcceptance,
  type N8nLaunchRequest,
  type N8nSuccessCallback,
  toInternalErrorStage,
  validateLaunchAcceptance
} from "@/lib/integrations/n8n-contract";
import {
  buildCanonicalCallbackUrl,
  getN8nIntegrationConfig
} from "@/lib/integrations/n8n-config";
import {
  createContractProcessingJobByCode,
  getActiveProcessingJobByCode,
  getAppelOffresDetailByCode,
  getLatestProcessingJobByCode,
  getProcessingJobByPublicId,
  setAppelOffresBusinessStatus,
  syncStoredDocumentsMetadata,
  updateProcessingJobByPublicId,
  appendAuditLog
} from "@/lib/appels-offres/repository.ts";
import type {
  AppelOffresBusinessStatus,
  ProcessingJobCallbackStatus,
  ProcessingJobErrorStage,
  ProcessingJobRecord
} from "@/lib/appels-offres/types.ts";
import { storeSourcePdf } from "@/lib/appels-offres/storage.ts";
import {
  DATA_ROOT,
  finalizeProcessingSuccess,
  getStoredPdfPath,
  markProcessingActive,
  markProcessingError,
  readExistingStatus,
  readFicheIndexSourceForSync
} from "@/lib/storage";

type LaunchAnalysisOptions = {
  code: string;
  pdfFile?: File | null;
  forceRegenerate?: boolean;
  source?: string;
};

type LaunchAnalysisResult = {
  code: string;
  processingJobId: string;
  correlationId: string;
  executionId: string;
  callbackUrl: string;
};

type CallbackResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

export class AnalysisRequestError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.name = "AnalysisRequestError";
    this.status = status;
    this.body = {
      error: message,
      ...body
    };
  }
}

function assertPdfFile(file: File, maxBytes: number) {
  if (file.type && file.type !== "application/pdf") {
    throw new AnalysisRequestError(400, "Seuls les fichiers PDF sont acceptes.");
  }

  if (file.size > maxBytes) {
    throw new AnalysisRequestError(
      413,
      `Le PDF depasse la taille maximale autorisee (${maxBytes} octets).`
    );
  }
}

function getPdfPathForLaunch(filePath: string) {
  const normalized = path.resolve(filePath);
  const dataRoot = path.resolve(DATA_ROOT);
  const relative = path.relative(dataRoot, normalized);

  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    normalized === dataRoot
  ) {
    throw new AnalysisRequestError(
      500,
      "Le chemin PDF n'est pas autorise pour le contrat n8n."
    );
  }

  return normalized;
}

function calculateDurationMs(startedAt: string, finishedAt: string) {
  const start = Date.parse(startedAt);
  const finish = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) {
    return 0;
  }

  return finish - start;
}

async function syncFicheIndexFromStorage(code: string, context: string) {
  const indexed = await readFicheIndexSourceForSync(code);
  await syncFicheIndexSafely(code, indexed.xml, indexed.fiche, indexed.status, context);
}

async function requestN8nLaunch(
  payload: N8nLaunchRequest
): Promise<N8nLaunchAcceptance> {
  const config = getN8nIntegrationConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.launchTimeoutMs);

  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.webhookToken}`,
        "Content-Type": "application/json",
        "X-Contract-Version": config.contractVersion,
        "Idempotency-Key": payload.correlation_id
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (response.status !== 202) {
      const bodyText = await response.text().catch(() => "");
      throw new AnalysisRequestError(
        502,
        `Le webhook n8n a refuse le lancement (${response.status}).`,
        bodyText ? { detail: bodyText.slice(0, 500) } : {}
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AnalysisRequestError(
        502,
        "La reponse d'acceptation n8n n'est pas un JSON valide."
      );
    }

    const acceptance = validateLaunchAcceptance(body, config.contractVersion);
    if (
      acceptance.processing_job_id !== payload.processing_job_id ||
      acceptance.correlation_id !== payload.correlation_id
    ) {
      throw new AnalysisRequestError(
        502,
        "La reponse d'acceptation n8n ne correspond pas au job envoye."
      );
    }

    return acceptance;
  } catch (error) {
    if (error instanceof AnalysisRequestError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new AnalysisRequestError(
        504,
        "Le webhook n8n n'a pas confirme le lancement dans le delai autorise."
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new AnalysisRequestError(
      502,
      `Impossible de contacter le webhook n8n. Detail: ${message}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function persistLaunchFailure(
  code: string,
  processingJobId: string,
  message: string
) {
  await updateProcessingJobByPublicId(processingJobId, {
    status: "failed",
    callbackStatus: null,
    errorStage: "webhook",
    errorCode: "N8N_LAUNCH_FAILED",
    errorMessage: message,
    finishedAt: new Date().toISOString(),
    callbackReceivedAt: null
  });
  await setAppelOffresBusinessStatus(code, "erreur", {
    processingJobId
  }).catch(() => undefined);
  await markProcessingError(code, message, "webhook").catch(() => undefined);
  await syncFicheIndexFromStorage(code, "analysis:launch-failed").catch(() => undefined);
  await appendAuditLog(code, "n8n_launch_failed", {
    processingJobId,
    error: message
  }).catch(() => undefined);
}

function buildAcknowledgement(
  payload: Pick<N8nCallbackPayload, "processing_job_id" | "correlation_id">,
  applied: boolean,
  reason?: string
): CallbackResult {
  return {
    httpStatus: 200,
    body: {
      acknowledged: true,
      processing_job_id: payload.processing_job_id,
      correlation_id: payload.correlation_id,
      applied,
      ...(reason ? { reason } : {})
    }
  };
}

async function resolveProtectedValidatedFiche(
  code: string,
  job: ProcessingJobRecord,
  payload: N8nSuccessCallback
) {
  await updateProcessingJobByPublicId(job.publicId!, {
    status: "failed",
    callbackReceivedAt: new Date().toISOString(),
    callbackStatus: "failed",
    callbackIdempotencyKey: buildCallbackIdempotencyKey(payload),
    errorStage: "callback",
    errorCode: "VALIDATED_FICHE_PROTECTED",
    errorMessage:
      "Le callback a ete refuse pour proteger une Fiche CDC deja validee.",
    finishedAt: payload.finished_at,
    metadata: {
      remoteStartedAt: payload.started_at,
      remoteFinishedAt: payload.finished_at,
      durationMs: payload.duration_ms,
      callbackProtection: "validated-fiche"
    }
  });
  await appendAuditLog(code, "analysis_failed", {
    processingJobId: job.publicId,
    reason: "validated_fiche_protected"
  }).catch(() => undefined);

  return {
    httpStatus: 409,
    body: {
      error:
        "Le callback ne peut pas ecraser une Fiche CDC deja validee sans regeneration autorisee."
    }
  } satisfies CallbackResult;
}

async function applyFailureState(
  code: string,
  job: ProcessingJobRecord,
  payload: N8nFailureCallback | N8nSuccessCallback,
  input: {
    stage: ProcessingJobErrorStage;
    code: string;
    message: string;
    callbackStatus?: ProcessingJobCallbackStatus;
    keepBusinessStatus?: boolean;
    metadata?: Record<string, unknown>;
  }
) {
  const callbackStatus = input.callbackStatus ?? "failed";
  const callbackKey = buildCallbackIdempotencyKey({
    processing_job_id: payload.processing_job_id,
    correlation_id: payload.correlation_id,
    execution_id: payload.execution_id,
    status: callbackStatus.toUpperCase() as N8nCallbackPayload["status"]
  });

  await updateProcessingJobByPublicId(job.publicId!, {
    status: callbackStatus === "cancelled" ? "cancelled" : "failed",
    callbackReceivedAt: new Date().toISOString(),
    callbackStatus,
    callbackIdempotencyKey: callbackKey,
    errorStage: input.stage,
    errorCode: input.code,
    errorMessage: input.message,
    finishedAt: payload.finished_at,
    metadata: {
      remoteStartedAt: payload.started_at,
      remoteFinishedAt: payload.finished_at,
      durationMs: payload.duration_ms,
      ...(input.metadata ?? {})
    }
  });

  await markProcessingError(code, input.message, input.stage).catch(() => undefined);
  if (!input.keepBusinessStatus) {
    await setAppelOffresBusinessStatus(code, "erreur", {
      processingJobId: job.publicId,
      errorStage: input.stage,
      errorCode: input.code
    }).catch(() => undefined);
  }
  await syncFicheIndexFromStorage(code, "analysis:callback-failed").catch(() => undefined);
  await appendAuditLog(code, "analysis_failed", {
    processingJobId: job.publicId,
    errorStage: input.stage,
    errorCode: input.code,
    error: input.message
  }).catch(() => undefined);
}

function toContractAppelOffreId(id: number) {
  return `ao_${id}`;
}

export async function launchAnalysisForAppelOffres(
  options: LaunchAnalysisOptions
): Promise<LaunchAnalysisResult> {
  const config = getN8nIntegrationConfig();
  const code = options.code.trim();

  const appel = await getAppelOffresDetailByCode(code, { includeArchived: true });
  if (!appel) {
    throw new AnalysisRequestError(404, "Appel d'offres introuvable.");
  }

  if (appel.archivedAt || appel.status === "archived" || appel.businessStatus === "archive") {
    throw new AnalysisRequestError(409, "Impossible de lancer l'analyse sur un appel archive.");
  }

  if (options.pdfFile) {
    assertPdfFile(options.pdfFile, config.maxCdcUploadBytes);
    await storeSourcePdf(code, options.pdfFile);
    await syncStoredDocumentsMetadata(code);
    await appendAuditLog(code, "appel_offres.cdc_uploaded", {
      fileName: options.pdfFile.name || "cdc.pdf",
      source: options.source ?? "analysis-launch"
    }).catch(() => undefined);
  }

  const hasSourcePdf = appel.artifacts.hasSourcePdf || Boolean(options.pdfFile);
  if (!hasSourcePdf) {
    throw new AnalysisRequestError(400, "Aucun CDC PDF n'est disponible pour cette analyse.");
  }

  const currentFicheStatus = await readExistingStatus(code);
  if (currentFicheStatus?.status === "validated" && !options.forceRegenerate) {
    throw new AnalysisRequestError(
      409,
      "Cette Fiche CDC est deja validee. Une regeneration explicite est requise.",
      {
        requiresConfirmation: true,
        reason: "already_validated"
      }
    );
  }

  if (currentFicheStatus?.modifiedAt && !options.forceRegenerate) {
    throw new AnalysisRequestError(
      409,
      "Cette Fiche CDC a ete modifiee depuis sa generation. Une regeneration explicite est requise.",
      {
        requiresConfirmation: true,
        reason: "draft_modified"
      }
    );
  }

  const activeJob = await getActiveProcessingJobByCode(code, "fiche_generation");
  if (activeJob) {
    throw new AnalysisRequestError(
      409,
      "Une analyse est deja en cours pour cet appel d'offres.",
      { reason: "concurrent_create" }
    );
  }

  const latestJob = await getLatestProcessingJobByCode(code, "fiche_generation");
  const processingJobId = generateProcessingJobPublicId();
  const correlationId = generateCorrelationId();
  const callbackUrl = buildCanonicalCallbackUrl(config.platformPublicBaseUrl);
  const pdfPath = getPdfPathForLaunch(await getStoredPdfPath(code));

  const job = await createContractProcessingJobByCode(code, {
    publicId: processingJobId,
    jobType: "fiche_generation",
    status: "created",
    contractVersion: config.contractVersion,
    correlationId,
    retryOfJobId:
      latestJob && ["failed", "cancelled"].includes(latestJob.status)
        ? latestJob.id
        : null,
    metadata: {
      source: options.source ?? "appels-offres-analyse",
      allowValidatedOverwrite: Boolean(options.forceRegenerate)
    }
  });

  await appendAuditLog(code, "analysis_requested", {
    processingJobId,
    correlationId,
    source: options.source ?? "appels-offres-analyse",
    retryOfJobId: job.retryOfJobId
  }).catch(() => undefined);

  await setAppelOffresBusinessStatus(code, "en_attente_analyse", {
    processingJobId
  }).catch(() => undefined);

  const launchPayload = {
    contract_version: config.contractVersion,
    processing_job_id: processingJobId,
    appel_offre_id: toContractAppelOffreId(appel.id),
    code_interne: code,
    correlation_id: correlationId,
    callback_url: callbackUrl,
    pdf_path: pdfPath,
    requested_at: new Date().toISOString()
  } satisfies N8nLaunchRequest;

  await updateProcessingJobByPublicId(processingJobId, {
    status: "queued",
    metadata: {
      launchPayload
    }
  });

  try {
    const acceptance = await requestN8nLaunch(launchPayload);
    await updateProcessingJobByPublicId(processingJobId, {
      status: "running",
      executionId: acceptance.execution_id,
      contractVersion: acceptance.contract_version,
      launchAcceptedAt: acceptance.received_at,
      metadata: {
        acceptanceProcessingStatus: acceptance.processing_status
      }
    });
    await markProcessingActive(code, acceptance.execution_id);
    await syncFicheIndexFromStorage(code, "analysis:launch-accepted").catch(() => undefined);
    await setAppelOffresBusinessStatus(code, "analyse_en_cours", {
      processingJobId,
      executionId: acceptance.execution_id
    }).catch(() => undefined);
    await appendAuditLog(code, "n8n_launch_accepted", {
      processingJobId,
      correlationId,
      executionId: acceptance.execution_id
    }).catch(() => undefined);

    return {
      code,
      processingJobId,
      correlationId,
      executionId: acceptance.execution_id,
      callbackUrl
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lancement n8n echoue.";
    await persistLaunchFailure(code, processingJobId, message);
    throw error;
  }
}

export async function getCurrentFicheStatusForApi(code: string) {
  const activeJob = await getActiveProcessingJobByCode(code, "fiche_generation");
  if (activeJob) {
    return {
      status: "processing" as const,
      processingStartedAt: activeJob.launchAcceptedAt ?? activeJob.startedAt,
      errorReason: activeJob.errorMessage,
      errorStage: activeJob.errorStage,
      n8nExecutionId: activeJob.executionId
    };
  }

  const latestJob = await getLatestProcessingJobByCode(code, "fiche_generation");
  if (latestJob?.status === "failed") {
    return {
      status: "error" as const,
      processingStartedAt: null,
      errorReason: latestJob.errorMessage,
      errorStage: latestJob.errorStage,
      n8nExecutionId: latestJob.executionId
    };
  }

  return readExistingStatus(code);
}

function isJobStaleForPayload(
  job: ProcessingJobRecord,
  latestJob: ProcessingJobRecord | null
) {
  if (!latestJob || latestJob.publicId === job.publicId) {
    return false;
  }

  return latestJob.startedAt.localeCompare(job.startedAt) >= 0;
}

async function applySuccessCallback(
  code: string,
  job: ProcessingJobRecord,
  payload: N8nSuccessCallback
): Promise<CallbackResult> {
  const markdown = payload.result.markdown.trim();
  if (!markdown) {
    await applyFailureState(code, job, payload, {
      stage: "markdown",
      code: "MARKDOWN_EMPTY",
      message: "Le callback de succes n8n ne contient aucun Markdown exploitable."
    });
    return {
      httpStatus: 422,
      body: { error: "Le Markdown retourne par n8n est vide." }
    };
  }

  let normalizedXml: string;
  try {
    const parsed = parseFiche(payload.result.xml);
    normalizedXml = serializeFiche(parsed, { referenceInterne: "" });
  } catch {
    await applyFailureState(code, job, payload, {
      stage: "xml",
      code: "XML_INVALID",
      message: "Le callback de succes n8n contient un XML invalide."
    });
    return {
      httpStatus: 422,
      body: { error: "Le XML retourne par n8n est invalide." }
    };
  }

  const currentStatus = await readExistingStatus(code);
  const allowValidatedOverwrite = Boolean(job.metadata?.allowValidatedOverwrite);
  if (currentStatus?.status === "validated" && !allowValidatedOverwrite) {
    return resolveProtectedValidatedFiche(code, job, payload);
  }

  await finalizeProcessingSuccess({
    codeInterne: code,
    xml: normalizedXml,
    markdown
  });
  await syncStoredDocumentsMetadata(code);
  await syncFicheIndexFromStorage(code, "analysis:callback-success").catch(() => undefined);
  await updateProcessingJobByPublicId(job.publicId!, {
    status: "completed",
    callbackReceivedAt: new Date().toISOString(),
    callbackStatus: "completed",
    callbackIdempotencyKey: buildCallbackIdempotencyKey(payload),
    finishedAt: payload.finished_at,
    errorStage: null,
    errorCode: null,
    errorMessage: null,
    metadata: {
      remoteStartedAt: payload.started_at,
      remoteFinishedAt: payload.finished_at,
      durationMs: payload.duration_ms,
      ...payload.metadata
    }
  });
  await setAppelOffresBusinessStatus(code, "fiche_a_valider", {
    processingJobId: job.publicId,
    executionId: payload.execution_id
  }).catch(() => undefined);
  await appendAuditLog(code, "analysis_completed", {
    processingJobId: job.publicId,
    executionId: payload.execution_id
  }).catch(() => undefined);
  await appendAuditLog(code, "fiche_cdc_generated", {
    processingJobId: job.publicId
  }).catch(() => undefined);

  return buildAcknowledgement(payload, true);
}

async function applyFailureCallback(
  code: string,
  job: ProcessingJobRecord,
  payload: N8nFailureCallback
): Promise<CallbackResult> {
  const stage = toInternalErrorStage(payload.error.stage);
  const callbackStatus: ProcessingJobCallbackStatus =
    payload.status === "CANCELLED" ? "cancelled" : "failed";

  await updateProcessingJobByPublicId(job.publicId!, {
    status: payload.status === "CANCELLED" ? "cancelled" : "failed",
    callbackReceivedAt: new Date().toISOString(),
    callbackStatus,
    callbackIdempotencyKey: buildCallbackIdempotencyKey(payload),
    finishedAt: payload.finished_at,
    errorStage: stage,
    errorCode: payload.error.code,
    errorMessage: payload.error.message,
    metadata: {
      remoteStartedAt: payload.started_at,
      remoteFinishedAt: payload.finished_at,
      durationMs: payload.duration_ms,
      retryable: payload.error.retryable,
      provider: payload.error.provider ?? null,
      ...payload.metadata
    }
  });
  await markProcessingError(code, payload.error.message, stage).catch(() => undefined);
  await syncFicheIndexFromStorage(code, "analysis:callback-failure").catch(() => undefined);
  await setAppelOffresBusinessStatus(code, "erreur", {
    processingJobId: job.publicId,
    errorStage: stage,
    errorCode: payload.error.code
  }).catch(() => undefined);
  await appendAuditLog(code, "analysis_failed", {
    processingJobId: job.publicId,
    executionId: payload.execution_id,
    errorStage: stage,
    errorCode: payload.error.code,
    error: payload.error.message
  }).catch(() => undefined);

  return buildAcknowledgement(payload, true);
}

export async function applyCanonicalN8nCallback(
  payload: N8nCallbackPayload
): Promise<CallbackResult> {
  const job = await getProcessingJobByPublicId(payload.processing_job_id);
  if (!job?.publicId) {
    return {
      httpStatus: 404,
      body: { error: "Processing Job introuvable." }
    };
  }

  if (job.correlationId !== payload.correlation_id) {
    return {
      httpStatus: 409,
      body: { error: "correlation_id inattendu." }
    };
  }

  if (job.executionId !== payload.execution_id) {
    return {
      httpStatus: 409,
      body: { error: "execution_id inattendu." }
    };
  }

  const appel = await getAppelOffresDetailByCode(payload.code_interne, {
    includeArchived: true
  });
  if (!appel || job.appelOffresId !== appel.id || payload.appel_offre_id !== toContractAppelOffreId(appel.id)) {
    return {
      httpStatus: 409,
      body: { error: "Le callback ne correspond pas a l'appel d'offres attendu." }
    };
  }

  const callbackKey = buildCallbackIdempotencyKey(payload);
  const normalizedCallbackStatus =
    payload.status.toLowerCase() as ProcessingJobCallbackStatus;

  if (
    job.callbackIdempotencyKey === callbackKey &&
    job.callbackStatus === normalizedCallbackStatus
  ) {
    await appendAuditLog(payload.code_interne, "duplicate_callback_ignored", {
      processingJobId: job.publicId,
      callbackStatus: payload.status
    }).catch(() => undefined);
    return buildAcknowledgement(payload, false, "duplicate_callback");
  }

  const latestJob = await getLatestProcessingJobByCode(payload.code_interne, "fiche_generation");
  if (isJobStaleForPayload(job, latestJob)) {
    await appendAuditLog(payload.code_interne, "late_callback_ignored", {
      processingJobId: job.publicId,
      latestProcessingJobId: latestJob?.publicId
    }).catch(() => undefined);
    return buildAcknowledgement(payload, false, "stale_attempt");
  }

  if (!["queued", "running"].includes(job.status)) {
    return buildAcknowledgement(payload, false, "callback_not_applicable");
  }

  await appendAuditLog(payload.code_interne, "callback_received", {
    processingJobId: job.publicId,
    callbackStatus: payload.status,
    executionId: payload.execution_id
  }).catch(() => undefined);

  if (payload.status === "COMPLETED") {
    return applySuccessCallback(payload.code_interne, job, payload);
  }

  return applyFailureCallback(payload.code_interne, job, payload);
}
