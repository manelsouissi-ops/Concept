import type { FichePayload, FicheStatus } from "@/lib/types.ts";
import type { FciAiModulePayload, FciAiSupportedModuleCode } from "./ai-contracts.ts";
import type { FciCommercialSourceContext } from "./commercial-quality.ts";
import type { FciStrategicSourceContext } from "./strategy-quality.ts";
import { getFciModuleTypeFromCode } from "./validation.ts";

export const DEFAULT_FCI_N8N_CONTRACT_VERSION = "1.0";

export const FCI_N8N_ACCEPTANCE_PROCESSING_STATUSES = [
  "QUEUED",
  "RUNNING"
] as const;

export const FCI_N8N_CALLBACK_STATUSES = [
  "completed",
  "failed",
  "cancelled"
] as const;

export const FCI_N8N_ERROR_STAGES = [
  "request_validation",
  "module_selection",
  "prompt_loading",
  "gemini_request",
  "gemini_response",
  "json_parse",
  "schema_validation",
  "callback_delivery",
  "internal"
] as const;

export type FciN8nAcceptanceProcessingStatus =
  (typeof FCI_N8N_ACCEPTANCE_PROCESSING_STATUSES)[number];

export type FciN8nCallbackStatus = (typeof FCI_N8N_CALLBACK_STATUSES)[number];
export type FciN8nErrorStage = (typeof FCI_N8N_ERROR_STAGES)[number];

export type FciN8nLaunchRequest = {
  contract_version: string;
  generation_job_id: number;
  fci_set_id: number;
  fci_module_id: number;
  appel_offre_id: number;
  code_interne: string;
  module_code: FciAiSupportedModuleCode;
  module_type: ReturnType<typeof getFciModuleTypeFromCode>;
  trigger_type: "manual" | "automatic" | "regeneration";
  correlation_id: string;
  callback_url: string;
  source_fiche: {
    code_interne: string;
    version: string;
    hash: string;
    status: FicheStatus;
    validated_at: string | null;
  };
  fiche_cdc: FichePayload;
  generation_metadata: {
    schema_version: string;
    prompt_version: string;
    requested_at: string;
    requested_by: string | null;
    provider: string;
    model: string;
    commercial_context?: FciCommercialSourceContext;
    strategic_context?: FciStrategicSourceContext;
  };
  prompt: {
    text: string;
    version: string;
  };
  output_schema: {
    version: string;
    json_schema: Record<string, unknown>;
  };
};

export type FciN8nLaunchAcceptance = {
  contract_version: string;
  accepted: true;
  generation_job_id: number;
  correlation_id: string;
  execution_id: string | null;
  received_at: string;
  processing_status: FciN8nAcceptanceProcessingStatus;
};

export type FciN8nCallbackEnvelope = {
  event: "fci.generation.completed" | "fci.generation.failed";
  contract_version: string;
  generation_job_id: number;
  fci_set_id: number;
  fci_module_id: number;
  appel_offre_id: number;
  code_interne: string;
  module_code: FciAiSupportedModuleCode;
  correlation_id: string;
  execution_id: string | null;
  status: FciN8nCallbackStatus;
  provider: string;
  model: string;
  prompt_version: string;
  schema_version: string;
  source_fiche: {
    version: string;
    hash: string;
  };
  generated_at: string;
  generation_parameters: Record<string, unknown>;
};

export type FciN8nSuccessCallback = FciN8nCallbackEnvelope & {
  event: "fci.generation.completed";
  status: "completed";
  payload: FciAiModulePayload | Record<string, unknown>;
};

export type FciN8nFailureCallback = FciN8nCallbackEnvelope & {
  event: "fci.generation.failed";
  status: "failed" | "cancelled";
  error: {
    code: string;
    message: string;
    stage: FciN8nErrorStage;
    retryable: boolean;
    validation_errors?: Array<{
      path: string;
      keyword: string;
      message: string;
    }>;
  };
};

export type FciN8nCallbackPayload =
  | FciN8nSuccessCallback
  | FciN8nFailureCallback;

export class FciN8nContractValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FciN8nContractValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new FciN8nContractValidationError(message);
  }

  return value;
}

function assertNonEmptyString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new FciN8nContractValidationError(`Champ invalide ou manquant: ${key}`);
  }

  return value.trim();
}

function assertNullableString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value == null) {
    return null;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new FciN8nContractValidationError(`Champ invalide: ${key}`);
  }

  return value.trim();
}

function assertBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new FciN8nContractValidationError(`Champ invalide ou manquant: ${key}`);
  }

  return value;
}

function assertPositiveInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new FciN8nContractValidationError(`Champ invalide ou manquant: ${key}`);
  }

  return Number(value);
}

function assertIsoDateString(value: string, key: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new FciN8nContractValidationError(`Date invalide: ${key}`);
  }
}

function assertStringEnum<T extends readonly string[]>(
  value: string,
  allowedValues: T,
  key: string
): T[number] {
  if (!allowedValues.includes(value)) {
    throw new FciN8nContractValidationError(`Valeur invalide pour ${key}: ${value}`);
  }

  return value as T[number];
}

const FCI_CALLBACK_ERROR_MESSAGE_MAX_LENGTH = 300;
const FCI_CALLBACK_HTML_ERROR_FALLBACK =
  "Le service appelé a retourné une réponse HTTP inattendue.";

function looksLikeHtmlErrorMessage(message: string, contentType?: string | null) {
  if (contentType && contentType.toLowerCase().includes("text/html")) {
    return true;
  }

  return (
    /^<!DOCTYPE\s+html/i.test(message)
    || /^<html[\s>]/i.test(message)
    || /<\/?[a-z][\s\S]{0,20}>/i.test(message.slice(0, 200))
  );
}

/**
 * Defense in depth: n8n should already normalize error.message before sending
 * the callback, but Concept must not persist or render a raw HTML error body
 * (e.g. a Next.js 404 page) even if a misbehaving caller forwards one.
 */
export function sanitizeFciCallbackErrorMessage(
  rawMessage: string,
  contentType?: string | null
) {
  const trimmed = rawMessage.trim();
  if (!trimmed) {
    return "Erreur inconnue.";
  }

  if (looksLikeHtmlErrorMessage(trimmed, contentType)) {
    console.error(
      "[fci-callback] rejected HTML-looking error.message from n8n callback",
      { rawMessagePreview: trimmed.slice(0, 500) }
    );
    return FCI_CALLBACK_HTML_ERROR_FALLBACK;
  }

  if (trimmed.length > FCI_CALLBACK_ERROR_MESSAGE_MAX_LENGTH) {
    console.warn("[fci-callback] truncated long error.message from n8n callback", {
      length: trimmed.length
    });
    return `${trimmed.slice(0, FCI_CALLBACK_ERROR_MESSAGE_MAX_LENGTH - 1)}…`;
  }

  return trimmed;
}

function validateContractVersion(value: string, expectedVersion: string) {
  if (value !== expectedVersion) {
    throw new FciN8nContractValidationError(
      `Version de contrat inattendue: ${value} (attendue: ${expectedVersion})`
    );
  }
}

export function buildFciCallbackIdempotencyKey(
  payload: Pick<
    FciN8nCallbackEnvelope,
    "generation_job_id" | "correlation_id" | "execution_id" | "status" | "event"
  >
) {
  return [
    payload.generation_job_id,
    payload.correlation_id,
    payload.execution_id ?? "null",
    payload.status,
    payload.event
  ].join(":");
}

export function validateFciLaunchAcceptance(
  value: unknown,
  expectedVersion: string
): FciN8nLaunchAcceptance {
  const record = assertRecord(value, "Payload d'acceptation FCI n8n invalide.");
  const contractVersion = assertNonEmptyString(record, "contract_version");
  validateContractVersion(contractVersion, expectedVersion);

  const accepted = assertBoolean(record, "accepted");
  if (!accepted) {
    throw new FciN8nContractValidationError("La reponse n8n n'a pas accepte la generation FCI.");
  }

  const receivedAt = assertNonEmptyString(record, "received_at");
  assertIsoDateString(receivedAt, "received_at");

  const executionId = assertNullableString(record, "execution_id");

  return {
    contract_version: contractVersion,
    accepted: true,
    generation_job_id: assertPositiveInteger(record, "generation_job_id"),
    correlation_id: assertNonEmptyString(record, "correlation_id"),
    execution_id: executionId,
    received_at: receivedAt,
    processing_status: assertStringEnum(
      assertNonEmptyString(record, "processing_status"),
      FCI_N8N_ACCEPTANCE_PROCESSING_STATUSES,
      "processing_status"
    )
  };
}

function validateCallbackEnvelope(
  value: unknown,
  expectedVersion: string
): FciN8nCallbackEnvelope {
  const record = assertRecord(value, "Payload de callback FCI invalide.");
  const contractVersion = assertNonEmptyString(record, "contract_version");
  validateContractVersion(contractVersion, expectedVersion);

  const event = assertStringEnum(
    assertNonEmptyString(record, "event"),
    ["fci.generation.completed", "fci.generation.failed"] as const,
    "event"
  );
  const status = assertStringEnum(
    assertNonEmptyString(record, "status"),
    FCI_N8N_CALLBACK_STATUSES,
    "status"
  );

  const generatedAt = assertNonEmptyString(record, "generated_at");
  assertIsoDateString(generatedAt, "generated_at");

  const sourceFiche = assertRecord(record.source_fiche, "Champ invalide ou manquant: source_fiche");
  const generationParameters = assertRecord(
    record.generation_parameters,
    "Champ invalide ou manquant: generation_parameters"
  );

  return {
    event,
    contract_version: contractVersion,
    generation_job_id: assertPositiveInteger(record, "generation_job_id"),
    fci_set_id: assertPositiveInteger(record, "fci_set_id"),
    fci_module_id: assertPositiveInteger(record, "fci_module_id"),
    appel_offre_id: assertPositiveInteger(record, "appel_offre_id"),
    code_interne: assertNonEmptyString(record, "code_interne"),
    module_code: assertStringEnum(
      assertNonEmptyString(record, "module_code"),
      ["A", "B", "C", "D"] as const,
      "module_code"
    ),
    correlation_id: assertNonEmptyString(record, "correlation_id"),
    execution_id: assertNullableString(record, "execution_id"),
    status,
    provider: assertNonEmptyString(record, "provider"),
    model: assertNonEmptyString(record, "model"),
    prompt_version: assertNonEmptyString(record, "prompt_version"),
    schema_version: assertNonEmptyString(record, "schema_version"),
    source_fiche: {
      version: assertNonEmptyString(sourceFiche, "version"),
      hash: assertNonEmptyString(sourceFiche, "hash")
    },
    generated_at: generatedAt,
    generation_parameters: generationParameters
  };
}

export function validateFciCallbackPayload(
  value: unknown,
  expectedVersion: string
): FciN8nCallbackPayload {
  const envelope = validateCallbackEnvelope(value, expectedVersion);
  const record = assertRecord(value, "Payload de callback FCI invalide.");

  if (envelope.status === "completed") {
    const payload = assertRecord(record.payload, "Champ invalide ou manquant: payload");
    return {
      ...envelope,
      event: "fci.generation.completed",
      status: "completed",
      payload
    };
  }

  const error = assertRecord(record.error, "Champ invalide ou manquant: error");
  const validationErrorsRaw = error.validation_errors;

  let validationErrors:
    | Array<{ path: string; keyword: string; message: string; }>
    | undefined;

  if (validationErrorsRaw != null) {
    if (!Array.isArray(validationErrorsRaw)) {
      throw new FciN8nContractValidationError("Champ invalide: error.validation_errors");
    }

    validationErrors = validationErrorsRaw.map((entry, index) => {
      const item = assertRecord(
        entry,
        `Champ invalide: error.validation_errors[${index}]`
      );
      return {
        path: assertNonEmptyString(item, "path"),
        keyword: assertNonEmptyString(item, "keyword"),
        message: assertNonEmptyString(item, "message")
      };
    });
  }

  return {
    ...envelope,
    event: "fci.generation.failed",
    status: envelope.status,
    error: {
      code: assertNonEmptyString(error, "code"),
      message: sanitizeFciCallbackErrorMessage(assertNonEmptyString(error, "message")),
      stage: assertStringEnum(
        assertNonEmptyString(error, "stage"),
        FCI_N8N_ERROR_STAGES,
        "error.stage"
      ),
      retryable: assertBoolean(error, "retryable"),
      ...(validationErrors ? { validation_errors: validationErrors } : {})
    }
  };
}
