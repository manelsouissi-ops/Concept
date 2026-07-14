import { randomUUID } from "node:crypto";

export const DEFAULT_N8N_CONTRACT_VERSION = "1.0";

export const N8N_ACCEPTANCE_PROCESSING_STATUSES = [
  "QUEUED",
  "RUNNING"
] as const;

export const N8N_CALLBACK_STATUSES = [
  "COMPLETED",
  "FAILED",
  "CANCELLED"
] as const;

export const N8N_ERROR_STAGES = [
  "WEBHOOK",
  "UPLOAD",
  "MARKER",
  "MARKDOWN",
  "ANONYMIZATION",
  "LLM",
  "XML",
  "CALLBACK",
  "UNKNOWN"
] as const;

export type N8nAcceptanceProcessingStatus =
  (typeof N8N_ACCEPTANCE_PROCESSING_STATUSES)[number];

export type N8nCallbackStatus = (typeof N8N_CALLBACK_STATUSES)[number];
export type N8nErrorStage = (typeof N8N_ERROR_STAGES)[number];

export type N8nLaunchRequest = {
  contract_version: string;
  processing_job_id: string;
  appel_offre_id: string;
  code_interne: string;
  correlation_id: string;
  callback_url: string;
  pdf_path: string;
  requested_at: string;
};

export type N8nLaunchAcceptance = {
  contract_version: string;
  accepted: true;
  processing_job_id: string;
  correlation_id: string;
  execution_id: string;
  received_at: string;
  processing_status: N8nAcceptanceProcessingStatus;
};

export type N8nCallbackEnvelope = {
  contract_version: string;
  processing_job_id: string;
  appel_offre_id: string;
  code_interne: string;
  correlation_id: string;
  execution_id: string;
  status: N8nCallbackStatus;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  metadata: Record<string, unknown>;
};

export type N8nSuccessCallback = N8nCallbackEnvelope & {
  status: "COMPLETED";
  result: {
    markdown: string;
    xml: string;
  };
};

export type N8nFailureCallback = N8nCallbackEnvelope & {
  status: "FAILED" | "CANCELLED";
  error: {
    stage: N8nErrorStage;
    code: string;
    message: string;
    retryable: boolean;
    provider?: string | null;
  };
};

export type N8nCallbackPayload = N8nSuccessCallback | N8nFailureCallback;

export class N8nContractValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "N8nContractValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new N8nContractValidationError(message);
  }

  return value;
}

function assertNonEmptyString(
  record: Record<string, unknown>,
  key: string
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new N8nContractValidationError(`Champ invalide ou manquant: ${key}`);
  }

  return value.trim();
}

function assertBoolean(
  record: Record<string, unknown>,
  key: string
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new N8nContractValidationError(`Champ invalide ou manquant: ${key}`);
  }

  return value;
}

function assertNumber(
  record: Record<string, unknown>,
  key: string
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new N8nContractValidationError(`Champ invalide ou manquant: ${key}`);
  }

  return value;
}

function assertIsoDateString(value: string, key: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new N8nContractValidationError(`Date invalide: ${key}`);
  }
}

function assertStringEnum<T extends readonly string[]>(
  value: string,
  values: T,
  key: string
): T[number] {
  if (!values.includes(value)) {
    throw new N8nContractValidationError(`Valeur invalide pour ${key}: ${value}`);
  }

  return value as T[number];
}

function assertMetadata(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new N8nContractValidationError(`Champ invalide ou manquant: ${key}`);
  }

  return value;
}

function validateContractVersion(value: string, expectedVersion: string) {
  if (value !== expectedVersion) {
    throw new N8nContractValidationError(
      `Version de contrat inattendue: ${value} (attendue: ${expectedVersion})`
    );
  }
}

export function generateProcessingJobPublicId() {
  return `pj_${randomUUID().replace(/-/g, "")}`;
}

export function generateCorrelationId() {
  return `corr_${randomUUID().replace(/-/g, "")}`;
}

export function buildCallbackIdempotencyKey(payload: Pick<
  N8nCallbackEnvelope,
  "processing_job_id" | "correlation_id" | "execution_id" | "status"
>) {
  return [
    payload.processing_job_id,
    payload.correlation_id,
    payload.execution_id,
    payload.status
  ].join(":");
}

export function validateLaunchRequest(
  value: unknown,
  expectedVersion: string
): N8nLaunchRequest {
  const record = assertRecord(value, "Payload de lancement invalide.");
  const contractVersion = assertNonEmptyString(record, "contract_version");
  validateContractVersion(contractVersion, expectedVersion);

  const payload: N8nLaunchRequest = {
    contract_version: contractVersion,
    processing_job_id: assertNonEmptyString(record, "processing_job_id"),
    appel_offre_id: assertNonEmptyString(record, "appel_offre_id"),
    code_interne: assertNonEmptyString(record, "code_interne"),
    correlation_id: assertNonEmptyString(record, "correlation_id"),
    callback_url: assertNonEmptyString(record, "callback_url"),
    pdf_path: assertNonEmptyString(record, "pdf_path"),
    requested_at: assertNonEmptyString(record, "requested_at")
  };

  assertIsoDateString(payload.requested_at, "requested_at");

  return payload;
}

export function validateLaunchAcceptance(
  value: unknown,
  expectedVersion: string
): N8nLaunchAcceptance {
  const record = assertRecord(value, "Payload d'acceptation n8n invalide.");
  const contractVersion = assertNonEmptyString(record, "contract_version");
  validateContractVersion(contractVersion, expectedVersion);

  const accepted = assertBoolean(record, "accepted");
  if (!accepted) {
    throw new N8nContractValidationError("La reponse n8n n'a pas accepte le traitement.");
  }

  const receivedAt = assertNonEmptyString(record, "received_at");
  assertIsoDateString(receivedAt, "received_at");

  return {
    contract_version: contractVersion,
    accepted: true,
    processing_job_id: assertNonEmptyString(record, "processing_job_id"),
    correlation_id: assertNonEmptyString(record, "correlation_id"),
    execution_id: assertNonEmptyString(record, "execution_id"),
    received_at: receivedAt,
    processing_status: assertStringEnum(
      assertNonEmptyString(record, "processing_status"),
      N8N_ACCEPTANCE_PROCESSING_STATUSES,
      "processing_status"
    )
  };
}

function validateCallbackEnvelope(
  value: unknown,
  expectedVersion: string
): N8nCallbackEnvelope {
  const record = assertRecord(value, "Payload de callback n8n invalide.");
  const contractVersion = assertNonEmptyString(record, "contract_version");
  validateContractVersion(contractVersion, expectedVersion);

  const startedAt = assertNonEmptyString(record, "started_at");
  const finishedAt = assertNonEmptyString(record, "finished_at");
  assertIsoDateString(startedAt, "started_at");
  assertIsoDateString(finishedAt, "finished_at");

  return {
    contract_version: contractVersion,
    processing_job_id: assertNonEmptyString(record, "processing_job_id"),
    appel_offre_id: assertNonEmptyString(record, "appel_offre_id"),
    code_interne: assertNonEmptyString(record, "code_interne"),
    correlation_id: assertNonEmptyString(record, "correlation_id"),
    execution_id: assertNonEmptyString(record, "execution_id"),
    status: assertStringEnum(
      assertNonEmptyString(record, "status"),
      N8N_CALLBACK_STATUSES,
      "status"
    ),
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: assertNumber(record, "duration_ms"),
    metadata: assertMetadata(record, "metadata")
  };
}

export function validateCallbackPayload(
  value: unknown,
  expectedVersion: string
): N8nCallbackPayload {
  const envelope = validateCallbackEnvelope(value, expectedVersion);
  const record = assertRecord(value, "Payload de callback n8n invalide.");

  if (envelope.status === "COMPLETED") {
    const result = assertRecord(record.result, "Champ invalide ou manquant: result");
    return {
      ...envelope,
      status: "COMPLETED",
      result: {
        markdown: assertNonEmptyString(result, "markdown"),
        xml: assertNonEmptyString(result, "xml")
      }
    };
  }

  const error = assertRecord(record.error, "Champ invalide ou manquant: error");
  return {
    ...envelope,
    status: envelope.status,
    error: {
      stage: assertStringEnum(
        assertNonEmptyString(error, "stage"),
        N8N_ERROR_STAGES,
        "error.stage"
      ),
      code: assertNonEmptyString(error, "code"),
      message: assertNonEmptyString(error, "message"),
      retryable: assertBoolean(error, "retryable"),
      provider:
        typeof error.provider === "string"
          ? error.provider.trim() || null
          : error.provider == null
            ? null
            : (() => {
                throw new N8nContractValidationError(
                  "Champ invalide: error.provider"
                );
              })()
    }
  };
}

export function toInternalErrorStage(stage: N8nErrorStage) {
  return stage.toLowerCase() as
    | "webhook"
    | "upload"
    | "marker"
    | "markdown"
    | "anonymization"
    | "llm"
    | "xml"
    | "callback"
    | "unknown";
}

export function isTerminalCallbackStatus(status: string): status is N8nCallbackStatus {
  return N8N_CALLBACK_STATUSES.includes(status as N8nCallbackStatus);
}
