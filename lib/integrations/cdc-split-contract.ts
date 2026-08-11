import { N8nContractValidationError } from "./n8n-contract.ts";

export type DocumentProcessingLaunchRequest = {
  contract_version: string;
  processing_job_id: string;
  appel_offre_id: string;
  code_interne: string;
  correlation_id: string;
  callback_url: string;
  pdf_path: string;
  requested_at: string;
  retry_of_processing_job_id?: string;
  requested_parser?: "marker" | "docling";
};

export type CdcExtractionLaunchRequest = {
  contract_version: string;
  processing_job_id: string;
  appel_offre_id: string;
  code_interne: string;
  correlation_id: string;
  source_processing_job_id: string;
  markdown_document_id: string;
  markdown_path: string;
  markdown_content_hash: string;
  markdown_byte_size: number;
  callback_url: string;
  requested_at: string;
};

type DocumentCallbackEnvelope = {
  event: "document.processing.completed" | "document.processing.failed";
  contract_version: string;
  processing_job_id: string;
  appel_offre_id: string;
  code_interne: string;
  correlation_id: string;
  execution_id: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  started_at: string;
  finished_at: string;
  duration_ms: number;
  metadata: Record<string, unknown>;
};

export type DocumentProcessingSuccessCallback = DocumentCallbackEnvelope & {
  event: "document.processing.completed";
  status: "COMPLETED";
  parser: { provider: "marker" | "docling"; job_id: string };
  result: {
    markdown: string;
    byte_size: number;
    content_hash: string;
    mime_type: "text/markdown";
  };
};

export type DocumentProcessingFailureCallback = DocumentCallbackEnvelope & {
  event: "document.processing.failed";
  status: "FAILED" | "CANCELLED";
  error: {
    stage: "WEBHOOK" | "UPLOAD" | "PARSER" | "MARKDOWN" | "CALLBACK" | "UNKNOWN";
    code: string;
    message: string;
    retryable: boolean;
  };
};

export type DocumentProcessingCallback =
  | DocumentProcessingSuccessCallback
  | DocumentProcessingFailureCallback;

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new N8nContractValidationError(`Champ invalide ou manquant: ${name}`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new N8nContractValidationError(`Champ invalide ou manquant: ${name}`);
  }
  return value.trim();
}

function numberValue(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new N8nContractValidationError(`Champ invalide ou manquant: ${name}`);
  }
  return value;
}

export function validateDocumentProcessingCallback(
  value: unknown,
  expectedVersion: string
): DocumentProcessingCallback {
  const body = record(value, "callback");
  const contractVersion = stringValue(body.contract_version, "contract_version");
  if (contractVersion !== expectedVersion) {
    throw new N8nContractValidationError("Version de contrat inattendue.");
  }
  const event = stringValue(body.event, "event");
  const status = stringValue(body.status, "status");
  const startedAt = stringValue(body.started_at, "started_at");
  const finishedAt = stringValue(body.finished_at, "finished_at");
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(finishedAt))) {
    throw new N8nContractValidationError("Timestamp de callback invalide.");
  }
  const base = {
    contract_version: contractVersion,
    processing_job_id: stringValue(body.processing_job_id, "processing_job_id"),
    appel_offre_id: stringValue(body.appel_offre_id, "appel_offre_id"),
    code_interne: stringValue(body.code_interne, "code_interne"),
    correlation_id: stringValue(body.correlation_id, "correlation_id"),
    execution_id: stringValue(body.execution_id, "execution_id"),
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: numberValue(body.duration_ms, "duration_ms"),
    metadata: record(body.metadata, "metadata")
  };
  if (event === "document.processing.completed" && status === "COMPLETED") {
    const parser = record(body.parser, "parser");
    const provider = stringValue(parser.provider, "parser.provider");
    if (provider !== "marker" && provider !== "docling") {
      throw new N8nContractValidationError("parser.provider invalide.");
    }
    const result = record(body.result, "result");
    const contentHash = stringValue(result.content_hash, "result.content_hash");
    if (!/^sha256:[a-f0-9]{64}$/.test(contentHash)) {
      throw new N8nContractValidationError("result.content_hash invalide.");
    }
    if (stringValue(result.mime_type, "result.mime_type") !== "text/markdown") {
      throw new N8nContractValidationError("result.mime_type invalide.");
    }
    return {
      ...base,
      event,
      status,
      parser: { provider, job_id: stringValue(parser.job_id, "parser.job_id") },
      result: {
        markdown: stringValue(result.markdown, "result.markdown"),
        byte_size: numberValue(result.byte_size, "result.byte_size"),
        content_hash: contentHash,
        mime_type: "text/markdown"
      }
    };
  }
  if (event === "document.processing.failed" && (status === "FAILED" || status === "CANCELLED")) {
    const error = record(body.error, "error");
    const stage = stringValue(error.stage, "error.stage");
    const stages = ["WEBHOOK", "UPLOAD", "PARSER", "MARKDOWN", "CALLBACK", "UNKNOWN"] as const;
    if (!stages.includes(stage as (typeof stages)[number]) || typeof error.retryable !== "boolean") {
      throw new N8nContractValidationError("Erreur de traitement documentaire invalide.");
    }
    return {
      ...base,
      event,
      status,
      error: {
        stage: stage as (typeof stages)[number],
        code: stringValue(error.code, "error.code"),
        message: stringValue(error.message, "error.message"),
        retryable: error.retryable
      }
    };
  }
  throw new N8nContractValidationError("event/status de callback incoherent.");
}
