import { createHash } from "node:crypto";
import path from "node:path";
import {
  type CdcExtractionLaunchRequest,
  type DocumentProcessingCallback,
  type DocumentProcessingLaunchRequest
} from "@/lib/integrations/cdc-split-contract.ts";
import { validateLaunchAcceptance, type N8nLaunchAcceptance } from "@/lib/integrations/n8n-contract.ts";
import {
  buildCanonicalCallbackUrl,
  getN8nIntegrationConfig,
  getSplitN8nWebhookUrls
} from "@/lib/integrations/n8n-config.ts";
import {
  appendAuditLog,
  getAppelOffresDetailByCode,
  getLatestProcessingJobByCode,
  getProcessingJobByPublicId,
  setAppelOffresBusinessStatus,
  syncStoredDocumentsMetadata,
  updateProcessingJobByPublicId
} from "./repository.ts";
import { storeGeneratedMarkdown } from "./storage.ts";
import { markProcessingActive, markProcessingError } from "@/lib/storage.ts";
import { assertCdcAiLaunchAllowed } from "@/lib/integrations/cdc-ai-provider.ts";

export type SplitCallbackResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

function acknowledgement(payload: DocumentProcessingCallback, applied: boolean, reason?: string) {
  return {
    httpStatus: 200,
    body: {
      acknowledged: true,
      processing_job_id: payload.processing_job_id,
      correlation_id: payload.correlation_id,
      applied,
      ...(reason ? { reason } : {})
    }
  } satisfies SplitCallbackResult;
}

function callbackKey(payload: DocumentProcessingCallback) {
  return [payload.processing_job_id, payload.correlation_id, payload.execution_id, payload.event].join(":");
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function requestStageLaunch(
  webhookUrl: string,
  payload: DocumentProcessingLaunchRequest | CdcExtractionLaunchRequest,
  stage: "document-processing" | "cdc-extraction"
): Promise<N8nLaunchAcceptance> {
  const config = getN8nIntegrationConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.launchTimeoutMs);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.webhookToken}`,
        "Content-Type": "application/json",
        "X-Contract-Version": config.contractVersion,
        "Idempotency-Key": `${payload.correlation_id}:${stage}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (response.status !== 202) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      throw new Error(`Le webhook ${stage} a repondu ${response.status}${detail ? `: ${detail}` : ""}.`);
    }
    const acceptance = validateLaunchAcceptance(await response.json(), config.contractVersion);
    if (
      acceptance.processing_job_id !== payload.processing_job_id ||
      acceptance.correlation_id !== payload.correlation_id
    ) {
      throw new Error(`L'acceptation ${stage} ne correspond pas au job envoye.`);
    }
    return acceptance;
  } finally {
    clearTimeout(timeout);
  }
}

export async function launchDocumentProcessing(input: {
  processingJobId: string;
  appelOffreId: string;
  codeInterne: string;
  correlationId: string;
  pdfPath: string;
  retryOfProcessingJobId?: string | null;
  requestedParser?: "marker" | "docling";
}) {
  const config = getN8nIntegrationConfig();
  const urls = getSplitN8nWebhookUrls();
  const payload: DocumentProcessingLaunchRequest = {
    contract_version: config.contractVersion,
    processing_job_id: input.processingJobId,
    appel_offre_id: input.appelOffreId,
    code_interne: input.codeInterne,
    correlation_id: input.correlationId,
    callback_url: `${config.platformPublicBaseUrl}/api/documents/callbacks/n8n`,
    pdf_path: input.pdfPath,
    requested_at: new Date().toISOString(),
    ...(input.retryOfProcessingJobId
      ? { retry_of_processing_job_id: input.retryOfProcessingJobId }
      : {}),
    ...(input.requestedParser ? { requested_parser: input.requestedParser } : {})
  };
  const acceptance = await requestStageLaunch(urls.documentProcessingUrl, payload, "document-processing");
  return { payload, acceptance };
}

export async function launchPersistedCdcExtraction(input: {
  processingJobId: string;
  appelOffreId: string;
  codeInterne: string;
  correlationId: string;
  sourceProcessingJobId: string;
  documentId: string;
  markdownPath: string;
  contentHash: string;
  byteSize: number;
}) {
  // Re-resolve immediately before W2 so an in-flight local document conversion
  // cannot cross into external CDC extraction after confidentiality is enabled.
  assertCdcAiLaunchAllowed(process.env, input.codeInterne);
  const config = getN8nIntegrationConfig();
  const urls = getSplitN8nWebhookUrls();
  const payload: CdcExtractionLaunchRequest = {
    contract_version: config.contractVersion,
    processing_job_id: input.processingJobId,
    appel_offre_id: input.appelOffreId,
    code_interne: input.codeInterne,
    correlation_id: input.correlationId,
    source_processing_job_id: input.sourceProcessingJobId,
    markdown_document_id: input.documentId,
    markdown_path: path.resolve(input.markdownPath),
    markdown_content_hash: input.contentHash,
    markdown_byte_size: input.byteSize,
    callback_url: buildCanonicalCallbackUrl(config.platformPublicBaseUrl),
    requested_at: new Date().toISOString()
  };
  const acceptance = await requestStageLaunch(urls.cdcExtractionUrl, payload, "cdc-extraction");
  return { payload, acceptance };
}

export async function applyDocumentProcessingCallback(
  payload: DocumentProcessingCallback
): Promise<SplitCallbackResult> {
  const job = await getProcessingJobByPublicId(payload.processing_job_id);
  if (!job?.publicId) return { httpStatus: 404, body: { error: "Processing Job introuvable." } };
  if (job.correlationId !== payload.correlation_id) return { httpStatus: 409, body: { error: "correlation_id inattendu." } };

  const documentMetadata = metadataRecord(job.metadata?.documentProcessing);
  const knownW1Execution = typeof documentMetadata.executionId === "string"
    ? documentMetadata.executionId
    : job.executionId;
  if (knownW1Execution !== payload.execution_id) return { httpStatus: 409, body: { error: "execution_id W1 inattendu." } };

  const appel = await getAppelOffresDetailByCode(payload.code_interne, { includeArchived: true });
  if (!appel || job.appelOffresId !== appel.id || payload.appel_offre_id !== `ao_${appel.id}`) {
    return { httpStatus: 409, body: { error: "Le callback ne correspond pas a l'appel d'offres attendu." } };
  }
  const key = callbackKey(payload);
  if (documentMetadata.callbackIdempotencyKey === key) {
    return acknowledgement(payload, false, "duplicate_callback");
  }
  const latest = await getLatestProcessingJobByCode(payload.code_interne, "fiche_generation");
  if (latest?.publicId !== job.publicId) return acknowledgement(payload, false, "stale_attempt");
  if (!["queued", "running"].includes(job.status)) return acknowledgement(payload, false, "callback_not_applicable");

  if (payload.status !== "COMPLETED") {
    await updateProcessingJobByPublicId(job.publicId, {
      status: payload.status === "CANCELLED" ? "cancelled" : "failed",
      finishedAt: payload.finished_at,
      errorStage: payload.error.stage === "PARSER" ? "marker" : payload.error.stage.toLowerCase() as "webhook",
      errorCode: payload.error.code,
      errorMessage: payload.error.message,
      metadata: {
        pipelineStage: "document_processing_failed",
        documentProcessing: { ...documentMetadata, status: payload.status, executionId: payload.execution_id, callbackIdempotencyKey: key, retryable: payload.error.retryable }
      }
    });
    await markProcessingError(payload.code_interne, payload.error.message, payload.error.stage === "PARSER" ? "marker" : "webhook").catch(() => undefined);
    await setAppelOffresBusinessStatus(payload.code_interne, "erreur", { processingJobId: job.publicId }).catch(() => undefined);
    return acknowledgement(payload, true);
  }

  const markdownBuffer = Buffer.from(payload.result.markdown, "utf8");
  const actualHash = `sha256:${createHash("sha256").update(markdownBuffer).digest("hex")}`;
  if (markdownBuffer.byteLength !== payload.result.byte_size || actualHash !== payload.result.content_hash) {
    return { httpStatus: 422, body: { error: "Le Markdown ne correspond pas a sa taille/empreinte declaree." } };
  }
  const stored = await storeGeneratedMarkdown(payload.code_interne, payload.result.markdown);
  const documents = await syncStoredDocumentsMetadata(payload.code_interne);
  const markdownDocument = documents.find((document) => document.kind === "fiche_markdown");
  if (!markdownDocument) throw new Error("Le document Markdown persiste est introuvable.");

  await updateProcessingJobByPublicId(job.publicId, {
    status: "running",
    metadata: {
      pipelineStage: "document_processing_completed",
      documentProcessing: {
        status: "COMPLETED",
        executionId: payload.execution_id,
        parser: payload.parser,
        startedAt: payload.started_at,
        finishedAt: payload.finished_at,
        durationMs: payload.duration_ms,
        documentId: String(markdownDocument.id),
        markdownPath: stored.storagePath,
        byteSize: stored.sizeBytes,
        contentHash: actualHash,
        callbackIdempotencyKey: key,
        ...payload.metadata
      }
    }
  });
  await appendAuditLog(payload.code_interne, "document_processing_completed", {
    processingJobId: job.publicId,
    executionId: payload.execution_id,
    parser: payload.parser.provider
  }).catch(() => undefined);

  try {
    const launched = await launchPersistedCdcExtraction({
      processingJobId: payload.processing_job_id,
      appelOffreId: payload.appel_offre_id,
      codeInterne: payload.code_interne,
      correlationId: payload.correlation_id,
      sourceProcessingJobId: payload.processing_job_id,
      documentId: String(markdownDocument.id),
      markdownPath: stored.storagePath,
      contentHash: payload.result.content_hash,
      byteSize: payload.result.byte_size
    });
    await updateProcessingJobByPublicId(job.publicId, {
      status: "running",
      executionId: launched.acceptance.execution_id,
      launchAcceptedAt: launched.acceptance.received_at,
      metadata: {
        pipelineStage: "cdc_extraction_running",
        cdcExtraction: { status: "RUNNING", executionId: launched.acceptance.execution_id, launchPayload: launched.payload }
      }
    });
    await markProcessingActive(payload.code_interne, launched.acceptance.execution_id);
    await appendAuditLog(payload.code_interne, "cdc_extraction_launch_accepted", {
      processingJobId: job.publicId,
      executionId: launched.acceptance.execution_id
    }).catch(() => undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lancement W2 impossible.";
    await updateProcessingJobByPublicId(job.publicId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      errorStage: "webhook",
      errorCode: "CDC_EXTRACTION_LAUNCH_FAILED",
      errorMessage: message,
      metadata: { pipelineStage: "cdc_extraction_launch_failed" }
    });
    await setAppelOffresBusinessStatus(payload.code_interne, "erreur", { processingJobId: job.publicId }).catch(() => undefined);
  }
  return acknowledgement(payload, true);
}
