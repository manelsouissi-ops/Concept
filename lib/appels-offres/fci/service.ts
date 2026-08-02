import { createHash, randomUUID } from "node:crypto";
import { getAppelOffresRecordByCode } from "../repository.ts";
import type { AppelOffresRecord } from "../types.ts";
import {
  appendFciAuditEvent,
  createFciGenerationJob,
  getFciDetailByAppelOffresCode,
  getFciGenerationJobContextById,
  getFciSetByAppelOffresCode,
  initializeFciSetByAppelOffresCode,
  listFciGenerationJobsForModule,
  listFciModuleDataVersions,
  updateFciGenerationJob,
  updateFciModule,
  updateFciSet,
  upsertFciModuleData
} from "./repository.ts";
import type {
  FciDetail,
  FciGenerationJobRecord,
  FciJsonObject,
  FciModuleCode,
  FciModuleDataRecord,
  FciModuleRecord
} from "./types.ts";
import { getFciAiRuntimeContract } from "./ai-runtime.ts";
import { validateFciAiPayload } from "./ai-validation.ts";
import { getFciN8nIntegrationConfig, buildFciCallbackUrl, type FciN8nIntegrationConfig } from "./n8n-config.ts";
import {
  buildFciCallbackIdempotencyKey,
  type FciN8nCallbackPayload,
  type FciN8nFailureCallback,
  type FciN8nLaunchRequest,
  type FciN8nSuccessCallback,
  validateFciLaunchAcceptance
} from "./n8n-contract.ts";
import { parseFciModuleCode } from "./validation.ts";
import { isKnowledgeBaseEnabled, isFciModuleGeneratable } from "./validation.ts";
import {
  buildFciModulePresentation,
  buildFciWorkspacePresentation,
  calculateFciOverallStatus,
  groupGenerationJobs,
  groupModuleAuditEvents,
  groupModuleDataVersions,
  indexLatestModuleData,
  isModuleSourceStale
} from "./presentation.ts";
import { readSourceFicheSnapshot, type SourceFicheSnapshot } from "./source-fiche.ts";
import {
  calculateFciPayloadCompletion,
  markFciPayloadReviewed,
  normalizeStoredFciModulePayload,
  validateFciModulePayloadForCompletion,
  type FciFormField,
  type FciFormPayload,
  type FciPayloadDefaults
} from "./rendering.ts";
import type { FicheStatus } from "../../types.ts";
import {
  canEditFciModule,
  canGenerateFciModule,
  canValidateFciModule,
  getFciEditDeniedMessage,
  getFciGenerateDeniedMessage,
  type CurrentUser
} from "../../auth/rbac.ts";
import { getFallbackDevelopmentUser } from "../../auth/current-user.ts";

export type FciServiceErrorCode =
  | "AO_NOT_FOUND"
  | "FCI_NOT_INITIALIZED"
  | "FCI_MODULE_NOT_FOUND"
  | "FCI_MODULE_DISABLED"
  | "FCI_MODULE_NOT_GENERATABLE"
  | "FICHE_CDC_NOT_FOUND"
  | "FICHE_CDC_NOT_VALIDATED"
  | "FCI_ALREADY_GENERATING"
  | "FCI_DATA_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "SOURCE_OUTDATED"
  | "INVALID_MODULE"
  | "INVALID_PAYLOAD"
  | "FCI_CONFIGURATION_ERROR"
  | "FCI_LAUNCH_FAILED"
  | "FCI_CALLBACK_CONFLICT"
  | "RBAC_FORBIDDEN";

export class FciServiceError extends Error {
  code: FciServiceErrorCode;
  status: number;
  details: Record<string, unknown> | null;

  constructor(
    code: FciServiceErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "FciServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type FciSaveModulePayload = {
  data: FciJsonObject;
  sourceSummary: FciJsonObject | null;
  confidence: FciJsonObject | null;
  aiNotes: FciJsonObject | null;
  editor: string | null;
  expectedVersion: number | null;
};

export type FciValidateModulePayload = {
  validatedBy: string;
  comment: string | null;
  expectedVersion: number | null;
  acknowledgeStaleSource: boolean;
};

function normalizeCurrentUser(currentUser?: CurrentUser | null) {
  return currentUser ?? getFallbackDevelopmentUser();
}

function assertCanEditModule(currentUser: CurrentUser, moduleCode: FciModuleCode) {
  if (canEditFciModule(currentUser.role, moduleCode)) {
    return;
  }

  throw new FciServiceError(
    "RBAC_FORBIDDEN",
    getFciEditDeniedMessage(moduleCode),
    403,
    {
      module_code: moduleCode,
      role: currentUser.role
    }
  );
}

function assertCanGenerateModule(currentUser: CurrentUser, moduleCode: FciModuleCode) {
  if (canGenerateFciModule(currentUser.role, moduleCode)) {
    return;
  }

  throw new FciServiceError(
    "RBAC_FORBIDDEN",
    getFciGenerateDeniedMessage(moduleCode),
    403,
    {
      module_code: moduleCode,
      role: currentUser.role
    }
  );
}

function assertCanValidateModule(currentUser: CurrentUser, moduleCode: FciModuleCode) {
  if (canValidateFciModule(currentUser.role, moduleCode)) {
    return;
  }

  throw new FciServiceError(
    "RBAC_FORBIDDEN",
    getFciEditDeniedMessage(moduleCode),
    403,
    {
      module_code: moduleCode,
      role: currentUser.role
    }
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function requirePlainObject(
  value: unknown,
  fieldName: string
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new FciServiceError(
      "INVALID_PAYLOAD",
      `Le champ ${fieldName} doit etre un objet JSON.`,
      422,
      { field: fieldName }
    );
  }

  return value;
}

function parseOptionalPlainObject(
  value: unknown,
  fieldName: string
): Record<string, unknown> | null {
  if (value == null) {
    return null;
  }

  return requirePlainObject(value, fieldName);
}

function parseOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function parseExpectedVersion(value: unknown) {
  if (value == null) {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new FciServiceError(
      "INVALID_PAYLOAD",
      "La version attendue est invalide.",
      422,
      { field: "expected_version" }
    );
  }

  return numeric;
}

function parseBooleanFlag(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  }

  return false;
}

function buildFciPayloadDefaults(
  appelOffres: AppelOffresRecord,
  sourceFiche: SourceFicheSnapshot | null,
  detail?: FciDetail | null
): FciPayloadDefaults {
  return {
    codeInterne: appelOffres.code,
    intituleOffre: appelOffres.title,
    dateDepot: appelOffres.dueDate,
    preparedByName: null,
    validatedByName: null,
    sourceFiche: {
      code_interne: appelOffres.code,
      version:
        sourceFiche?.version ??
        detail?.set.sourceFicheVersion ??
        `unavailable:${appelOffres.updatedAt}`,
      hash: sourceFiche?.hash ?? detail?.set.sourceFicheHash ?? null,
      status: (sourceFiche?.status.status ?? "draft") as FicheStatus,
      validated_at: sourceFiche?.status.validatedAt ?? null
    }
  };
}

function buildStoredAuxiliaryPayload(payload: FciFormPayload) {
  return {
    sourceSummary: {
      source_fiche_version: payload.source_fiche.version,
      source_fiche_hash: payload.source_fiche.hash
    } satisfies FciJsonObject,
    confidence: {
      completion_percentage: payload.summary.completion_percentage,
      human_inputs_required: payload.summary.human_inputs_required
    } satisfies FciJsonObject,
    aiNotes: {
      ai_notes: payload.ai_notes,
      validation_warnings: payload.validation_warnings
    } satisfies FciJsonObject
  };
}

function buildValidatedByField(
  value: string,
  current?: FciFormField | null
): FciFormField<string> {
  return {
    value,
    source: "human",
    review_status: "reviewed",
    confidence: "high",
    justification: "Validation finale du module FCI.",
    source_references: [],
    original_ai_value:
      typeof current?.original_ai_value === "string"
        ? current.original_ai_value
        : undefined
  };
}

function isDepartmentalModuleCode(
  moduleCode: FciModuleCode
): moduleCode is "A" | "B" | "C" | "D" {
  return moduleCode === "A" || moduleCode === "B" || moduleCode === "C" || moduleCode === "D";
}

function buildUnavailableSourceMetadata(appelOffres: AppelOffresRecord) {
  return {
    sourceFicheVersion: `unavailable:${appelOffres.updatedAt}`,
    sourceFicheHash: "unavailable",
    sourceFicheUpdatedAt: appelOffres.updatedAt
  };
}

function mapVersionConflictDetails(
  expectedVersion: number | null,
  actualVersion: number | null
) {
  return {
    expected_version: expectedVersion,
    actual_version: actualVersion
  };
}

async function requireAppelOffres(code: string) {
  const appelOffres = await getAppelOffresRecordByCode(code, { includeArchived: true });
  if (!appelOffres) {
    throw new FciServiceError(
      "AO_NOT_FOUND",
      "Appel d'offres introuvable.",
      404,
      { code }
    );
  }

  return appelOffres;
}

async function requireInitializedDetail(code: string) {
  const appelOffres = await requireAppelOffres(code);
  const detail = await getFciDetailByAppelOffresCode(code);

  if (!detail) {
    throw new FciServiceError(
      "FCI_NOT_INITIALIZED",
      "Le workspace FCI n'est pas initialise pour cet appel d'offres.",
      404,
      { code }
    );
  }

  return { appelOffres, detail };
}

function ensureModuleAccessible(
  detail: FciDetail,
  moduleCode: FciModuleCode,
  knowledgeBaseEnabled: boolean
) {
  if (moduleCode === "E" && !knowledgeBaseEnabled) {
    throw new FciServiceError(
      "FCI_MODULE_DISABLED",
      "Le module E est desactive tant que la base de connaissances n'est pas activee.",
      404,
      { module_code: moduleCode }
    );
  }

  const module = detail.modules.find((item) => item.moduleCode === moduleCode);
  if (!module) {
    throw new FciServiceError(
      "FCI_MODULE_NOT_FOUND",
      "Module FCI introuvable.",
      404,
      { module_code: moduleCode }
    );
  }

  return module;
}

async function readCurrentSourceForWorkspace(code: string) {
  return readSourceFicheSnapshot(code, { allowDraft: true });
}

async function requireValidatedSourceFiche(code: string) {
  const validatedSource = await readSourceFicheSnapshot(code);
  if (validatedSource) {
    return validatedSource;
  }

  const draftSource = await readSourceFicheSnapshot(code, { allowDraft: true });
  if (draftSource) {
    throw new FciServiceError(
      "FICHE_CDC_NOT_VALIDATED",
      "La Fiche CDC doit etre validee avant de lancer la generation FCI.",
      409,
      {
        fiche_status: draftSource.status.status,
        fiche_version: draftSource.version
      }
    );
  }

  throw new FciServiceError(
    "FICHE_CDC_NOT_FOUND",
    "Aucune Fiche CDC exploitable n'est disponible pour cet appel d'offres.",
    404,
    { code }
  );
}

async function recalculateAndPersistOverallStatus(code: string) {
  const detail = await getFciDetailByAppelOffresCode(code);
  if (!detail) {
    return null;
  }

  const latestDataByModuleId = indexLatestModuleData(detail.moduleData);
  const overallStatus = calculateFciOverallStatus({
    modules: detail.modules,
    latestDataByModuleId
  });

  if (overallStatus !== detail.set.overallStatus) {
    await updateFciSet(detail.set.id, { overallStatus });
    return getFciDetailByAppelOffresCode(code);
  }

  return detail;
}

function getLatestVersion(
  versions: FciModuleDataRecord[],
  expectedVersion: number | null
) {
  const latest = versions[0] ?? null;
  const latestVersion = latest?.version ?? null;

  if (expectedVersion != null && expectedVersion !== latestVersion) {
    throw new FciServiceError(
      "VERSION_CONFLICT",
      "La version du module a change depuis votre derniere lecture.",
      409,
      mapVersionConflictDetails(expectedVersion, latestVersion)
    );
  }

  return latest;
}

function getLatestJob(jobs: FciGenerationJobRecord[]) {
  return jobs[0] ?? null;
}

function hasBlockingGenerationJob(job: FciGenerationJobRecord | null) {
  if (!job) {
    return false;
  }

  return [
    "created",
    "queued",
    "running"
  ].includes(job.status);
}

async function buildModulePresentationOrThrow(
  code: string,
  moduleCode: FciModuleCode,
  currentUser: CurrentUser
) {
  const knowledgeBaseEnabled = isKnowledgeBaseEnabled();
  const { appelOffres, detail } = await requireInitializedDetail(code);
  const module = ensureModuleAccessible(detail, moduleCode, knowledgeBaseEnabled);
  const versions = await listFciModuleDataVersions(module.id);
  const jobs = await listFciGenerationJobsForModule(module.id);
  const sourceFiche = await readCurrentSourceForWorkspace(code);
  const auditEvents = detail.auditEvents.filter(
    (event) => event.fciModuleId === module.id
  );

  return buildFciModulePresentation({
    appelOffres,
    module,
    latestData: versions[0] ?? null,
    versions,
    latestJob: jobs[0] ?? null,
    jobs,
    auditEvents,
    sourceFiche,
    knowledgeBaseEnabled,
    currentUser
  });
}

export function parseRequestedModule(rawModule: unknown) {
  try {
    return parseFciModuleCode(rawModule);
  } catch {
    throw new FciServiceError(
      "INVALID_MODULE",
      "Le code module FCI est invalide.",
      400,
      { module_code: rawModule }
    );
  }
}

export function parseFciSavePayload(body: unknown): FciSaveModulePayload {
  const payload = requirePlainObject(body, "body");

  return {
    data: requirePlainObject(payload.data, "data"),
    sourceSummary: parseOptionalPlainObject(payload.source_summary, "source_summary"),
    confidence: parseOptionalPlainObject(payload.confidence, "confidence"),
    aiNotes: parseOptionalPlainObject(payload.ai_notes, "ai_notes"),
    editor: parseOptionalString(payload.editor),
    expectedVersion: parseExpectedVersion(payload.expected_version)
  };
}

export function parseFciValidatePayload(body: unknown): FciValidateModulePayload {
  const payload = requirePlainObject(body, "body");
  const validatedBy = parseOptionalString(payload.validated_by);

  if (!validatedBy) {
    throw new FciServiceError(
      "INVALID_PAYLOAD",
      "Le validateur est obligatoire.",
      422,
      { field: "validated_by" }
    );
  }

  return {
    validatedBy,
    comment: parseOptionalString(payload.comment),
    expectedVersion: parseExpectedVersion(payload.expected_version),
    acknowledgeStaleSource: parseBooleanFlag(payload.acknowledge_stale_source)
  };
}

export function toFciErrorResponse(error: unknown) {
  if (error instanceof FciServiceError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? {}
        }
      }
    };
  }

  const message =
    error instanceof Error ? error.message : "Erreur FCI inattendue.";

  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: "FCI_INTERNAL_ERROR",
        message,
        details: {}
      }
    }
  };
}

export async function initializeFciWorkspace(code: string, currentUser?: CurrentUser | null) {
  const actor = normalizeCurrentUser(currentUser);
  const knowledgeBaseEnabled = isKnowledgeBaseEnabled();
  const appelOffres = await requireAppelOffres(code);
  const existingSet = await getFciSetByAppelOffresCode(code);
  const sourceFiche = await readCurrentSourceForWorkspace(code);

  const sourceMetadata = sourceFiche
    ? {
        sourceFicheVersion: sourceFiche.version,
        sourceFicheHash: sourceFiche.hash,
        sourceFicheUpdatedAt: sourceFiche.updatedAt
      }
    : existingSet
      ? {
          sourceFicheVersion: existingSet.sourceFicheVersion,
          sourceFicheHash: existingSet.sourceFicheHash,
          sourceFicheUpdatedAt: existingSet.sourceFicheUpdatedAt
        }
      : buildUnavailableSourceMetadata(appelOffres);

  const initialized = await initializeFciSetByAppelOffresCode(code, {
    ...sourceMetadata,
    overallStatus: existingSet?.overallStatus ?? "not_started",
    knowledgeBaseEnabled
  });

  if (!existingSet) {
    await appendFciAuditEvent({
      appelOffresId: appelOffres.id,
      eventType: "fci.initialized",
      payloadJson: {
        modules: initialized.modules.map((module) => module.moduleCode),
        sourceVersion: sourceMetadata.sourceFicheVersion,
        sourceAvailable: sourceFiche != null
      }
    });
  } else if (
    sourceFiche &&
    (existingSet.sourceFicheVersion !== sourceFiche.version ||
      existingSet.sourceFicheHash !== sourceFiche.hash)
  ) {
    await appendFciAuditEvent({
      appelOffresId: appelOffres.id,
      eventType: "fci.source_metadata_refreshed",
      payloadJson: {
        previousVersion: existingSet.sourceFicheVersion,
        nextVersion: sourceFiche.version
      }
    });
  }

  const detail = await recalculateAndPersistOverallStatus(code);
  if (!detail) {
    throw new FciServiceError(
      "FCI_NOT_INITIALIZED",
      "Impossible de relire le workspace FCI apres initialisation.",
      404,
      { code }
    );
  }

  return buildFciWorkspacePresentation({
    appelOffres,
    detail,
    sourceFiche,
    knowledgeBaseEnabled,
    currentUser: actor
  });
}

export async function getFciWorkspace(code: string, currentUser?: CurrentUser | null) {
  const actor = normalizeCurrentUser(currentUser);
  const knowledgeBaseEnabled = isKnowledgeBaseEnabled();
  const { appelOffres, detail } = await requireInitializedDetail(code);
  const sourceFiche = await readCurrentSourceForWorkspace(code);

  return buildFciWorkspacePresentation({
    appelOffres,
    detail,
    sourceFiche,
    knowledgeBaseEnabled,
    currentUser: actor
  });
}

export async function getFciModule(
  code: string,
  moduleCode: FciModuleCode,
  currentUser?: CurrentUser | null
) {
  return buildModulePresentationOrThrow(
    code,
    moduleCode,
    normalizeCurrentUser(currentUser)
  );
}

export async function saveFciModuleEdits(
  code: string,
  moduleCode: FciModuleCode,
  payload: FciSaveModulePayload,
  currentUser?: CurrentUser | null
) {
  const actor = normalizeCurrentUser(currentUser);
  const knowledgeBaseEnabled = isKnowledgeBaseEnabled();
  const { appelOffres, detail } = await requireInitializedDetail(code);
  const module = ensureModuleAccessible(detail, moduleCode, knowledgeBaseEnabled);
  const versions = await listFciModuleDataVersions(module.id);
  const latestData = getLatestVersion(versions, payload.expectedVersion);
  const latestJob = getLatestJob(await listFciGenerationJobsForModule(module.id));

  if (module.status === "generating" || hasBlockingGenerationJob(latestJob)) {
    throw new FciServiceError(
      "FCI_ALREADY_GENERATING",
      "Le module est deja en cours de generation et ne peut pas etre edite pour le moment.",
      409,
      { module_code: moduleCode }
    );
  }

  if (!isDepartmentalModuleCode(moduleCode)) {
    throw new FciServiceError(
      "FCI_MODULE_DISABLED",
      "Le module demande n'est pas editable dans cette phase.",
      404,
      { module_code: moduleCode }
    );
  }

  assertCanEditModule(actor, moduleCode);

  const sourceFiche = await readCurrentSourceForWorkspace(code);
  const normalizedPayload = normalizeStoredFciModulePayload(
    moduleCode,
    payload.data,
    buildFciPayloadDefaults(appelOffres, sourceFiche, detail)
  );
  const storedAuxiliaryPayload = buildStoredAuxiliaryPayload(normalizedPayload);
  const nextVersion = (latestData?.version ?? 0) + 1;
  const sourceVersion =
    latestData?.generatedFromFicheVersion ??
    sourceFiche?.version ??
    detail.set.sourceFicheVersion;
  const sourceHash =
    latestData?.generatedFromFicheHash ??
    sourceFiche?.hash ??
    detail.set.sourceFicheHash;

  await upsertFciModuleData(module.id, {
    dataJson: normalizedPayload,
    sourceSummaryJson: payload.sourceSummary ?? storedAuxiliaryPayload.sourceSummary,
    confidenceJson: payload.confidence ?? storedAuxiliaryPayload.confidence,
    aiNotesJson: payload.aiNotes ?? storedAuxiliaryPayload.aiNotes,
    version: nextVersion,
    generatedFromFicheVersion: sourceVersion,
    generatedFromFicheHash: sourceHash
  });
  const nextModuleStatus = module.status === "validated" ? "validated" : "needs_review";
  await updateFciModule(module.id, {
    status: nextModuleStatus,
    validatedAt: nextModuleStatus === "validated" ? module.validatedAt : null,
    validatedBy: nextModuleStatus === "validated" ? module.validatedBy : null,
    errorCode: null,
    errorMessage: null
  });
  await appendFciAuditEvent({
    appelOffresId: appelOffres.id,
    fciModuleId: module.id,
    eventType: "fci.module_data.saved",
    actor: actor.name,
    payloadJson: {
      moduleCode,
      version: nextVersion,
      sourceVersion
    }
  });

  await recalculateAndPersistOverallStatus(code);
  return buildModulePresentationOrThrow(code, moduleCode, actor);
}

function isEnvironmentConfigurationError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("La variable d'environnement ");
}

function sanitizeUrlForLogs(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return rawUrl.split("?")[0];
  }
}

function summarizeResponseBody(bodyText: string) {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const error =
      parsed.error && typeof parsed.error === "object"
        ? (parsed.error as Record<string, unknown>)
        : parsed;

    return JSON.stringify({
      code: typeof error.code === "string" ? error.code : null,
      status: typeof error.status === "string" ? error.status : null,
      message: typeof error.message === "string" ? error.message : null
    });
  } catch {
    return trimmed.replace(/\s+/g, " ").slice(0, 240);
  }
}

function resolveWebhookMode(webhookUrl: string): "production" | "test" | "unknown" {
  try {
    const pathname = new URL(webhookUrl).pathname;
    if (pathname.startsWith("/webhook-test/")) {
      return "test";
    }
    if (pathname.startsWith("/webhook/")) {
      return "production";
    }
  } catch {
    return "unknown";
  }

  return "unknown";
}

function assertFciWebhookUrl(webhookUrl: string) {
  const mode = resolveWebhookMode(webhookUrl);
  if (mode === "unknown") {
    throw new FciServiceError(
      "FCI_CONFIGURATION_ERROR",
      "FCI_N8N_WEBHOOK_URL doit pointer vers l'URL complete du webhook FCI n8n.",
      500,
      {
        target: sanitizeUrlForLogs(webhookUrl)
      }
    );
  }

  return mode;
}

function getStableModuleStatusForFailure(
  module: FciModuleRecord,
  latestData: FciModuleDataRecord | null
) {
  if (module.status === "validated") {
    return "validated" as const;
  }

  if (module.status === "needs_review" || module.status === "generated") {
    return "needs_review" as const;
  }

  if (latestData) {
    return "needs_review" as const;
  }

  return "not_started" as const;
}

function mergeGenerationParameters(
  current: FciJsonObject | null | undefined,
  patch: Record<string, unknown>
) {
  return {
    ...(current ?? {}),
    ...patch
  } satisfies FciJsonObject;
}

function getFciLaunchRequestedBy() {
  return null;
}

function computePayloadHash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function toModuleStatusFromJobStatus(
  status: FciGenerationJobRecord["status"],
  fallback: FciModuleRecord["status"]
) {
  if (status === "completed") {
    return "needs_review" as const;
  }
  if (status === "cancelled") {
    return fallback;
  }
  if (status === "failed") {
    return fallback;
  }

  return "generating" as const;
}

async function requestFciN8nLaunch(
  config: FciN8nIntegrationConfig,
  payload: FciN8nLaunchRequest
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.launchTimeoutMs);
  const webhookTarget = sanitizeUrlForLogs(config.webhookUrl);

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
      const responseSummary = summarizeResponseBody(bodyText);
      throw new FciServiceError(
        "FCI_LAUNCH_FAILED",
        `Le webhook FCI n8n a renvoye une reponse inattendue (${response.status}).`,
        response.status === 404 ? 502 : response.status === 401 || response.status === 403 ? 502 : 502,
        {
          target: webhookTarget,
          detail: responseSummary,
          status: response.status
        }
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new FciServiceError(
        "FCI_LAUNCH_FAILED",
        "La reponse d'acceptation FCI n8n n'est pas un JSON valide.",
        502,
        { target: webhookTarget }
      );
    }

    const acceptance = validateFciLaunchAcceptance(body, config.contractVersion);
    if (
      acceptance.generation_job_id !== payload.generation_job_id
      || acceptance.correlation_id !== payload.correlation_id
    ) {
      throw new FciServiceError(
        "FCI_LAUNCH_FAILED",
        "La reponse d'acceptation FCI n8n ne correspond pas au job envoye.",
        502,
        { target: webhookTarget }
      );
    }

    return acceptance;
  } catch (error) {
    if (error instanceof FciServiceError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new FciServiceError(
        "FCI_LAUNCH_FAILED",
        "Le webhook FCI n8n n'a pas confirme le lancement dans le delai autorise.",
        504,
        { target: webhookTarget }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new FciServiceError(
      "FCI_LAUNCH_FAILED",
      `Impossible de contacter le webhook FCI n8n. Detail: ${message}`,
      502,
      { target: webhookTarget }
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function launchFciGenerationJob(input: {
  code: string;
  appelOffresId: number;
  fciSetId: number;
  module: FciModuleRecord;
  moduleCode: FciModuleCode;
  triggerType: "manual" | "regeneration";
  sourceFiche: SourceFicheSnapshot;
  requireExistingData?: boolean;
}) {
  const versions = await listFciModuleDataVersions(input.module.id);
  const latestData = versions[0] ?? null;
  const latestJob = getLatestJob(await listFciGenerationJobsForModule(input.module.id));

  if (!isFciModuleGeneratable(input.module.moduleCode)) {
    throw new FciServiceError(
      "FCI_MODULE_NOT_GENERATABLE",
      "Ce module FCI n'est pas generatable dans cette phase.",
      409,
      { module_code: input.moduleCode }
    );
  }

  if (input.requireExistingData && !latestData && !latestJob) {
    throw new FciServiceError(
      "FCI_DATA_NOT_FOUND",
      "Aucune donnee FCI existante n'est disponible pour une regeneration.",
      404,
      { module_code: input.moduleCode }
    );
  }

  if (hasBlockingGenerationJob(latestJob)) {
    throw new FciServiceError(
      "FCI_ALREADY_GENERATING",
      "Une demande de generation FCI est deja en attente pour ce module.",
      409,
      {
        module_code: input.moduleCode,
        job_status: latestJob?.status ?? null
      }
    );
  }

  let config: FciN8nIntegrationConfig;
  try {
    config = getFciN8nIntegrationConfig();
    assertFciWebhookUrl(config.webhookUrl);
  } catch (error) {
    if (error instanceof FciServiceError) {
      throw error;
    }

    if (isEnvironmentConfigurationError(error)) {
      throw new FciServiceError(
        "FCI_CONFIGURATION_ERROR",
        error.message,
        500,
        {}
      );
    }

    throw error;
  }

  const requestedBy = getFciLaunchRequestedBy();
  const generatableModuleCode = input.moduleCode as "A" | "B" | "C" | "D";
  const runtimeContract = getFciAiRuntimeContract(generatableModuleCode);
  const correlationId = `corr_${randomUUID().replace(/-/g, "")}`;
  const previousStableStatus = getStableModuleStatusForFailure(
    input.module,
    latestData
  );
  const baseGenerationParameters = {
    requested_by: requestedBy,
    module_code: generatableModuleCode,
    module_type: runtimeContract.moduleType,
    prompt_version: runtimeContract.promptVersion,
    schema_version: runtimeContract.schemaVersion,
    provider: config.provider,
    model: config.model,
    webhook_target: sanitizeUrlForLogs(config.webhookUrl),
    previous_module_status: previousStableStatus,
    previous_validated_at: input.module.validatedAt,
    previous_validated_by: input.module.validatedBy,
    existing_version: latestData?.version ?? null,
    regeneration: input.triggerType === "regeneration"
  } satisfies FciJsonObject;

  const job = await createFciGenerationJob(input.module.id, {
    triggerType: input.triggerType,
    provider: config.provider,
    model: config.model,
    status: "created",
    contractVersion: config.contractVersion,
    schemaVersion: runtimeContract.schemaVersion,
    promptVersion: runtimeContract.promptVersion,
    generationParameters: baseGenerationParameters,
    sourceFicheVersion: input.sourceFiche.version,
    sourceFicheHash: input.sourceFiche.hash,
    correlationId
  });

  await appendFciAuditEvent({
    appelOffresId: input.appelOffresId,
    fciModuleId: input.module.id,
    eventType:
      input.triggerType === "regeneration"
        ? "fci.generation.regeneration_requested"
        : "fci.generation.requested",
    payloadJson: {
      moduleCode: input.moduleCode,
      generationJobId: job.id,
      correlationId,
      sourceVersion: input.sourceFiche.version,
      sourceHash: input.sourceFiche.hash
    }
  });

  try {
    await updateFciGenerationJob(job.id, {
      status: "queued",
      generationParameters: mergeGenerationParameters(baseGenerationParameters, {
        queued_at: new Date().toISOString()
      })
    });

    const callbackUrl = buildFciCallbackUrl(config.platformPublicBaseUrl);
    const launchPayload = {
      contract_version: config.contractVersion,
      generation_job_id: job.id,
      fci_set_id: input.fciSetId,
      fci_module_id: input.module.id,
      appel_offre_id: input.sourceFiche.appelOffres.id,
      code_interne: input.code,
      module_code: generatableModuleCode,
      module_type: runtimeContract.moduleType,
      trigger_type: input.triggerType,
      correlation_id: correlationId,
      callback_url: callbackUrl,
      source_fiche: {
        code_interne: input.sourceFiche.appelOffres.code,
        version: input.sourceFiche.version,
        hash: input.sourceFiche.hash,
        status: input.sourceFiche.status.status,
        validated_at: input.sourceFiche.status.validatedAt ?? null
      },
      fiche_cdc: input.sourceFiche.fiche,
      generation_metadata: {
        schema_version: runtimeContract.schemaVersion,
        prompt_version: runtimeContract.promptVersion,
        requested_at: new Date().toISOString(),
        requested_by: requestedBy,
        provider: config.provider,
        model: config.model
      },
      prompt: {
        text: runtimeContract.promptText,
        version: runtimeContract.promptVersion
      },
      output_schema: {
        version: runtimeContract.schemaVersion,
        json_schema: runtimeContract.schemaJson
      }
    } satisfies FciN8nLaunchRequest;

    console.info("[fci] Launch source_fiche sent to n8n", {
      code: input.code,
      moduleCode: generatableModuleCode,
      source_fiche: launchPayload.source_fiche
    });

    const acceptance = await requestFciN8nLaunch(config, launchPayload);
    const nextJobStatus = acceptance.processing_status === "RUNNING"
      ? "running"
      : "queued";

    await updateFciGenerationJob(job.id, {
      status: nextJobStatus,
      executionId: acceptance.execution_id,
      startedAt: acceptance.received_at,
      generationParameters: mergeGenerationParameters(baseGenerationParameters, {
        acceptance_received_at: acceptance.received_at,
        acceptance_status: acceptance.processing_status,
        callback_url: callbackUrl
      })
    });
    await updateFciModule(input.module.id, {
      status: toModuleStatusFromJobStatus(nextJobStatus, previousStableStatus),
      errorCode: null,
      errorMessage: null
    });
    await appendFciAuditEvent({
      appelOffresId: input.appelOffresId,
      fciModuleId: input.module.id,
      eventType: "fci.generation.launch_accepted",
      payloadJson: {
        moduleCode: input.moduleCode,
        generationJobId: job.id,
        correlationId,
        executionId: acceptance.execution_id,
        callbackUrl
      }
    });

    await recalculateAndPersistOverallStatus(input.code);

    const refreshedJob = (await getLatestJob(
      await listFciGenerationJobsForModule(input.module.id)
    )) ?? job;

    return {
      orchestration_connected: true,
      accepted: true,
      source_version: input.sourceFiche.version,
      has_existing_data: latestData != null,
      job: {
        id: refreshedJob.id,
        trigger_type: refreshedJob.triggerType,
        provider: refreshedJob.provider,
        model: refreshedJob.model,
        status: refreshedJob.status,
        execution_id: refreshedJob.executionId,
        correlation_id: refreshedJob.correlationId,
        contract_version: refreshedJob.contractVersion,
        schema_version: refreshedJob.schemaVersion,
        prompt_version: refreshedJob.promptVersion,
        created_at: refreshedJob.createdAt,
        started_at: refreshedJob.startedAt,
        error_code: refreshedJob.errorCode,
        error_message: refreshedJob.errorMessage
      }
    };
  } catch (error) {
    const message =
      error instanceof FciServiceError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Le lancement FCI via n8n a echoue.";

    await updateFciGenerationJob(job.id, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorCode: "FCI_N8N_LAUNCH_FAILED",
      errorMessage: message,
      generationParameters: mergeGenerationParameters(baseGenerationParameters, {
        launch_failed_at: new Date().toISOString()
      })
    });
    await updateFciModule(input.module.id, {
      status: previousStableStatus,
      errorCode: "FCI_N8N_LAUNCH_FAILED",
      errorMessage: message
    });
    await appendFciAuditEvent({
      appelOffresId: input.appelOffresId,
      fciModuleId: input.module.id,
      eventType: "fci.generation.launch_failed",
      payloadJson: {
        moduleCode: input.moduleCode,
        generationJobId: job.id,
        correlationId,
        error: message
      }
    });
    await recalculateAndPersistOverallStatus(input.code);

    if (error instanceof FciServiceError) {
      throw error;
    }

    throw new FciServiceError(
      "FCI_LAUNCH_FAILED",
      message,
      502,
      {}
    );
  }
}

export async function prepareFciGeneration(
  code: string,
  moduleCode: FciModuleCode,
  currentUser?: CurrentUser | null
) {
  const actor = normalizeCurrentUser(currentUser);
  const knowledgeBaseEnabled = isKnowledgeBaseEnabled();
  const { appelOffres, detail } = await requireInitializedDetail(code);
  const module = ensureModuleAccessible(detail, moduleCode, knowledgeBaseEnabled);
  const sourceFiche = await requireValidatedSourceFiche(code);
  assertCanGenerateModule(actor, moduleCode);

  return launchFciGenerationJob({
    code,
    appelOffresId: appelOffres.id,
    fciSetId: detail.set.id,
    module,
    moduleCode,
    triggerType: "manual",
    sourceFiche
  });
}

export async function prepareFciRegeneration(
  code: string,
  moduleCode: FciModuleCode,
  currentUser?: CurrentUser | null
) {
  const actor = normalizeCurrentUser(currentUser);
  const knowledgeBaseEnabled = isKnowledgeBaseEnabled();
  const { appelOffres, detail } = await requireInitializedDetail(code);
  const module = ensureModuleAccessible(detail, moduleCode, knowledgeBaseEnabled);
  const sourceFiche = await requireValidatedSourceFiche(code);
  assertCanGenerateModule(actor, moduleCode);

  return launchFciGenerationJob({
    code,
    appelOffresId: appelOffres.id,
    fciSetId: detail.set.id,
    module,
    moduleCode,
    triggerType: "regeneration",
    sourceFiche,
    requireExistingData: true
  });
}

type FciCallbackResult = {
  httpStatus: number;
  body: Record<string, unknown>;
};

function buildFciCallbackAcknowledgement(
  payload: Pick<
    FciN8nCallbackPayload,
    "generation_job_id" | "correlation_id" | "module_code" | "status"
  >,
  input?: {
    applied?: boolean;
    idempotent?: boolean;
    reason?: string;
  }
): FciCallbackResult {
  return {
    httpStatus: 200,
    body: {
      acknowledged: true,
      generation_job_id: payload.generation_job_id,
      correlation_id: payload.correlation_id,
      module_code: payload.module_code,
      status: payload.status,
      applied: input?.applied ?? false,
      idempotent: input?.idempotent ?? false,
      ...(input?.reason ? { reason: input.reason } : {})
    }
  };
}

function getPreviousModuleStatusFromJob(job: FciGenerationJobRecord) {
  const rawStatus = job.generationParameters?.previous_module_status;
  if (
    rawStatus === "not_started"
    || rawStatus === "needs_review"
    || rawStatus === "validated"
    || rawStatus === "generated"
    || rawStatus === "failed"
  ) {
    return rawStatus === "generated" ? "needs_review" : rawStatus;
  }

  return "not_started" as const;
}

function buildCallbackValidationErrorMessage(
  errors: Array<{ path: string; keyword: string; message: string }>
) {
  const first = errors[0];
  if (!first) {
    return "Le payload FCI retourne par n8n ne respecte pas le schema attendu.";
  }

  return `Le payload FCI retourne par n8n est invalide (${first.path}: ${first.message}).`;
}

async function applyFciGenerationFailureState(input: {
  appelOffresId: number;
  code: string;
  module: FciModuleRecord;
  job: FciGenerationJobRecord;
  restoredStatus: FciModuleRecord["status"];
  eventType: string;
  errorCode: string;
  errorMessage: string;
  generatedAt: string;
  callbackPayloadHash: string;
  callbackEvent: string;
  extraParameters?: Record<string, unknown>;
}) {
  await updateFciGenerationJob(input.job.id, {
    status: input.job.status === "cancelled" ? "cancelled" : "failed",
    completedAt: input.generatedAt,
    callbackReceivedAt: new Date().toISOString(),
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    generationParameters: mergeGenerationParameters(input.job.generationParameters, {
      callback_payload_hash: input.callbackPayloadHash,
      callback_event: input.callbackEvent,
      ...(input.extraParameters ?? {})
    })
  });
  await updateFciModule(input.module.id, {
    status: input.restoredStatus,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage
  });
  await appendFciAuditEvent({
    appelOffresId: input.appelOffresId,
    fciModuleId: input.module.id,
    eventType: input.eventType,
    payloadJson: {
      generationJobId: input.job.id,
      moduleCode: input.module.moduleCode,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage
    }
  });
  await recalculateAndPersistOverallStatus(input.code);
}

async function applyFciSuccessCallback(
  payload: FciN8nSuccessCallback
): Promise<FciCallbackResult> {
  const context = await getFciGenerationJobContextById(payload.generation_job_id);
  if (!context) {
    return {
      httpStatus: 404,
      body: {
        error: "Generation job FCI introuvable.",
        code: "FCI_JOB_NOT_FOUND"
      }
    };
  }

  const callbackPayloadHash = computePayloadHash(payload);
  const expectedCallbackKey = buildFciCallbackIdempotencyKey(payload);
  const existingCallbackKey = buildFciCallbackIdempotencyKey({
    generation_job_id: context.job.id,
    correlation_id: context.job.correlationId ?? "",
    execution_id: context.job.executionId,
    status: context.job.status === "cancelled" ? "cancelled" : context.job.status === "completed" ? "completed" : "failed",
    event:
      context.job.status === "completed"
        ? "fci.generation.completed"
        : "fci.generation.failed"
  });

  if (
    context.job.callbackReceivedAt
    && context.job.generationParameters?.callback_payload_hash === callbackPayloadHash
    && context.job.generationParameters?.callback_event === payload.event
    && existingCallbackKey === expectedCallbackKey
  ) {
    return buildFciCallbackAcknowledgement(payload, {
      applied: false,
      idempotent: true,
      reason: "duplicate_callback"
    });
  }

  if (context.job.callbackReceivedAt) {
    return {
      httpStatus: 409,
      body: {
        error: "Un callback different a deja ete applique a ce job FCI.",
        code: "CALLBACK_CONFLICT"
      }
    };
  }

  if (context.module.id !== payload.fci_module_id) {
    return {
      httpStatus: 409,
      body: {
        error: "Le callback FCI ne correspond pas au module attendu.",
        code: "FCI_MODULE_MISMATCH"
      }
    };
  }

  if (context.module.moduleCode !== payload.module_code) {
    return {
      httpStatus: 409,
      body: {
        error: "Le code module du callback FCI est inattendu.",
        code: "FCI_MODULE_CODE_MISMATCH"
      }
    };
  }

  if (context.set.id !== payload.fci_set_id || context.appelOffres.id !== payload.appel_offre_id) {
    return {
      httpStatus: 409,
      body: {
        error: "Le callback FCI ne correspond pas au dossier attendu.",
        code: "FCI_APPEL_OFFRE_MISMATCH"
      }
    };
  }

  if (context.appelOffres.code !== payload.code_interne) {
    return {
      httpStatus: 409,
      body: {
        error: "Le code d'appel d'offres du callback FCI est inattendu.",
        code: "FCI_CODE_MISMATCH"
      }
    };
  }

  if (context.job.correlationId !== payload.correlation_id) {
    return {
      httpStatus: 409,
      body: {
        error: "Le correlation_id du callback FCI est inattendu.",
        code: "FCI_CORRELATION_MISMATCH"
      }
    };
  }

  if (
    context.job.executionId
    && payload.execution_id
    && context.job.executionId !== payload.execution_id
  ) {
    return {
      httpStatus: 409,
      body: {
        error: "Le execution_id du callback FCI est inattendu.",
        code: "FCI_EXECUTION_MISMATCH"
      }
    };
  }

  if (
    context.job.sourceFicheVersion !== payload.source_fiche.version
    || context.job.sourceFicheHash !== payload.source_fiche.hash
  ) {
    return {
      httpStatus: 409,
      body: {
        error: "La source Fiche CDC du callback FCI ne correspond pas au job de generation.",
        code: "FCI_SOURCE_MISMATCH"
      }
    };
  }

  const validatedPayload = validateFciAiPayload(payload.module_code, payload.payload);
  if (!validatedPayload.ok) {
    const restoredStatus = getPreviousModuleStatusFromJob(context.job);
    const message = buildCallbackValidationErrorMessage(validatedPayload.errors);
    await applyFciGenerationFailureState({
      appelOffresId: context.appelOffres.id,
      code: context.appelOffres.code,
      module: context.module,
      job: context.job,
      restoredStatus,
      eventType: "fci.generation.failed",
      errorCode: "AI_SCHEMA_VALIDATION_FAILED",
      errorMessage: message,
      generatedAt: payload.generated_at,
      callbackPayloadHash,
      callbackEvent: payload.event,
      extraParameters: {
        callback_validation_errors: validatedPayload.errors,
        execution_id: payload.execution_id
      }
    });
    return {
      httpStatus: 422,
      body: {
        error: message,
        code: "AI_SCHEMA_VALIDATION_FAILED"
      }
    };
  }

  const versions = await listFciModuleDataVersions(context.module.id);
  const nextVersion = (versions[0]?.version ?? 0) + 1;
  await upsertFciModuleData(context.module.id, {
    dataJson: validatedPayload.data as unknown as FciJsonObject,
    sourceSummaryJson: payload.source_fiche,
    confidenceJson: {
      summary: validatedPayload.data.summary
    },
    aiNotesJson: {
      ai_notes: validatedPayload.data.ai_notes,
      validation_warnings: validatedPayload.data.validation_warnings
    },
    version: nextVersion,
    generatedFromFicheVersion: payload.source_fiche.version,
    generatedFromFicheHash: payload.source_fiche.hash
  });
  await updateFciGenerationJob(context.job.id, {
    status: "completed",
    executionId: payload.execution_id ?? context.job.executionId,
    completedAt: payload.generated_at,
    callbackReceivedAt: new Date().toISOString(),
    errorCode: null,
    errorMessage: null,
    generationParameters: mergeGenerationParameters(context.job.generationParameters, {
      callback_payload_hash: callbackPayloadHash,
      callback_event: payload.event,
      callback_idempotency_key: expectedCallbackKey,
      persisted_version: nextVersion
    })
  });
  await updateFciModule(context.module.id, {
    status: "needs_review",
    aiGeneratedAt: payload.generated_at,
    validatedAt: null,
    validatedBy: null,
    errorCode: null,
    errorMessage: null
  });
  await appendFciAuditEvent({
    appelOffresId: context.appelOffres.id,
    fciModuleId: context.module.id,
    eventType: "fci.generation.completed",
    payloadJson: {
      generationJobId: context.job.id,
      moduleCode: context.module.moduleCode,
      version: nextVersion,
      executionId: payload.execution_id ?? context.job.executionId,
      sourceVersion: payload.source_fiche.version
    }
  });
  await recalculateAndPersistOverallStatus(context.appelOffres.code);

  return buildFciCallbackAcknowledgement(payload, {
    applied: true,
    idempotent: false
  });
}

async function applyFciFailureCallback(
  payload: FciN8nFailureCallback
): Promise<FciCallbackResult> {
  const context = await getFciGenerationJobContextById(payload.generation_job_id);
  if (!context) {
    return {
      httpStatus: 404,
      body: {
        error: "Generation job FCI introuvable.",
        code: "FCI_JOB_NOT_FOUND"
      }
    };
  }

  const callbackPayloadHash = computePayloadHash(payload);
  const expectedCallbackKey = buildFciCallbackIdempotencyKey(payload);

  if (
    context.job.callbackReceivedAt
    && context.job.generationParameters?.callback_payload_hash === callbackPayloadHash
    && context.job.generationParameters?.callback_event === payload.event
  ) {
    return buildFciCallbackAcknowledgement(payload, {
      applied: false,
      idempotent: true,
      reason: "duplicate_callback"
    });
  }

  if (context.job.callbackReceivedAt) {
    return {
      httpStatus: 409,
      body: {
        error: "Un callback different a deja ete applique a ce job FCI.",
        code: "CALLBACK_CONFLICT"
      }
    };
  }

  if (
    context.module.id !== payload.fci_module_id
    || context.set.id !== payload.fci_set_id
    || context.appelOffres.id !== payload.appel_offre_id
    || context.appelOffres.code !== payload.code_interne
    || context.module.moduleCode !== payload.module_code
  ) {
    return {
      httpStatus: 409,
      body: {
        error: "Le callback FCI ne correspond pas au job attendu.",
        code: "FCI_CALLBACK_TARGET_MISMATCH"
      }
    };
  }

  if (context.job.correlationId !== payload.correlation_id) {
    return {
      httpStatus: 409,
      body: {
        error: "Le correlation_id du callback FCI est inattendu.",
        code: "FCI_CORRELATION_MISMATCH"
      }
    };
  }

  if (
    context.job.executionId
    && payload.execution_id
    && context.job.executionId !== payload.execution_id
  ) {
    return {
      httpStatus: 409,
      body: {
        error: "Le execution_id du callback FCI est inattendu.",
        code: "FCI_EXECUTION_MISMATCH"
      }
    };
  }

  if (
    context.job.sourceFicheVersion !== payload.source_fiche.version
    || context.job.sourceFicheHash !== payload.source_fiche.hash
  ) {
    return {
      httpStatus: 409,
      body: {
        error: "La source Fiche CDC du callback FCI ne correspond pas au job de generation.",
        code: "FCI_SOURCE_MISMATCH"
      }
    };
  }

  const restoredStatus = getPreviousModuleStatusFromJob(context.job);
  await updateFciGenerationJob(context.job.id, {
    status: payload.status === "cancelled" ? "cancelled" : "failed",
    executionId: payload.execution_id ?? context.job.executionId,
    completedAt: payload.generated_at,
    callbackReceivedAt: new Date().toISOString(),
    errorCode: payload.error.code,
    errorMessage: payload.error.message,
    generationParameters: mergeGenerationParameters(context.job.generationParameters, {
      callback_payload_hash: callbackPayloadHash,
      callback_event: payload.event,
      callback_idempotency_key: expectedCallbackKey,
      callback_error_stage: payload.error.stage,
      callback_validation_errors: payload.error.validation_errors ?? []
    })
  });
  await updateFciModule(context.module.id, {
    status: restoredStatus,
    errorCode: payload.error.code,
    errorMessage: payload.error.message
  });
  await appendFciAuditEvent({
    appelOffresId: context.appelOffres.id,
    fciModuleId: context.module.id,
    eventType:
      payload.status === "cancelled"
        ? "fci.generation.cancelled"
        : "fci.generation.failed",
    payloadJson: {
      generationJobId: context.job.id,
      moduleCode: context.module.moduleCode,
      errorCode: payload.error.code,
      errorMessage: payload.error.message,
      errorStage: payload.error.stage,
      executionId: payload.execution_id ?? context.job.executionId
    }
  });
  await recalculateAndPersistOverallStatus(context.appelOffres.code);

  return buildFciCallbackAcknowledgement(payload, {
    applied: true,
    idempotent: false
  });
}

export async function applyFciN8nCallback(
  payload: FciN8nCallbackPayload
): Promise<FciCallbackResult> {
  if (payload.status === "completed") {
    return applyFciSuccessCallback(payload);
  }

  return applyFciFailureCallback(payload);
}

export async function validateFciModule(
  code: string,
  moduleCode: FciModuleCode,
  payload: FciValidateModulePayload,
  currentUser?: CurrentUser | null
) {
  const actor = normalizeCurrentUser(currentUser);
  const knowledgeBaseEnabled = isKnowledgeBaseEnabled();
  const { appelOffres, detail } = await requireInitializedDetail(code);
  const module = ensureModuleAccessible(detail, moduleCode, knowledgeBaseEnabled);
  const versions = await listFciModuleDataVersions(module.id);
  const latestData = getLatestVersion(versions, payload.expectedVersion);

  if (!latestData) {
    throw new FciServiceError(
      "FCI_DATA_NOT_FOUND",
      "Le module ne contient encore aucune donnee a valider.",
      404,
      { module_code: moduleCode }
    );
  }

  const latestJob = getLatestJob(await listFciGenerationJobsForModule(module.id));
  if (module.status === "generating" || hasBlockingGenerationJob(latestJob)) {
    throw new FciServiceError(
      "FCI_ALREADY_GENERATING",
      "Le module est en cours de generation et ne peut pas etre valide.",
      409,
      { module_code: moduleCode }
    );
  }

  if (!isDepartmentalModuleCode(moduleCode)) {
    throw new FciServiceError(
      "FCI_MODULE_DISABLED",
      "Le module demande n'est pas validable dans cette phase.",
      404,
      { module_code: moduleCode }
    );
  }

  assertCanValidateModule(actor, moduleCode);

  const sourceFiche = await readCurrentSourceForWorkspace(code);
  const staleSource = isModuleSourceStale(latestData, sourceFiche);

  if (staleSource && !payload.acknowledgeStaleSource) {
    throw new FciServiceError(
      "SOURCE_OUTDATED",
      "Le module repose sur une ancienne version de la Fiche CDC.",
      409,
      {
        module_code: moduleCode,
        current_source_version: sourceFiche?.version ?? null,
        module_source_version: latestData.generatedFromFicheVersion
      }
    );
  }

  const normalizedPayload = normalizeStoredFciModulePayload(
    moduleCode,
    latestData.dataJson,
    buildFciPayloadDefaults(appelOffres, sourceFiche, detail)
  );
  const validationErrors = validateFciModulePayloadForCompletion(
    normalizedPayload,
    moduleCode
  );
  if (validationErrors.length > 0) {
    throw new FciServiceError(
      "INVALID_PAYLOAD",
      "Le formulaire FCI est incomplet. Corrigez les champs obligatoires avant de marquer le module comme termine.",
      422,
      {
        module_code: moduleCode,
        validation_errors: validationErrors
      }
    );
  }

  const reviewedPayload = markFciPayloadReviewed(normalizedPayload);
  const identification = isPlainObject(reviewedPayload.data.identification_commune)
    ? reviewedPayload.data.identification_commune
    : {};
  const nextPayload: FciFormPayload = {
    ...reviewedPayload,
    data: {
      ...reviewedPayload.data,
      identification_commune: {
        ...identification,
        validated_by_name: buildValidatedByField(
          actor.name,
          isPlainObject(identification.validated_by_name)
            ? (identification.validated_by_name as FciFormField)
            : null
        )
      }
    },
    summary: {
      ...reviewedPayload.summary,
      status: "complete",
      completion_percentage: calculateFciPayloadCompletion(
        reviewedPayload,
        moduleCode
      ).percentage
    }
  };
  const storedAuxiliaryPayload = buildStoredAuxiliaryPayload(nextPayload);
  const nextVersion = latestData.version + 1;
  await upsertFciModuleData(module.id, {
    dataJson: nextPayload,
    sourceSummaryJson: storedAuxiliaryPayload.sourceSummary,
    confidenceJson: storedAuxiliaryPayload.confidence,
    aiNotesJson: storedAuxiliaryPayload.aiNotes,
    version: nextVersion,
    generatedFromFicheVersion: latestData.generatedFromFicheVersion,
    generatedFromFicheHash: latestData.generatedFromFicheHash
  });

  const validatedAt = new Date().toISOString();
  await updateFciModule(module.id, {
    status: "validated",
    validatedAt,
    validatedBy: actor.name,
    errorCode: null,
    errorMessage: null
  });
  await appendFciAuditEvent({
    appelOffresId: appelOffres.id,
    fciModuleId: module.id,
    eventType: "fci.module.validated",
    actor: actor.name,
    payloadJson: {
        moduleCode,
        version: nextVersion,
        comment: payload.comment,
        staleSource
      }
    });

  await recalculateAndPersistOverallStatus(code);
  return buildModulePresentationOrThrow(code, moduleCode, actor);
}

export async function getFciModuleHistory(
  code: string,
  moduleCode: FciModuleCode
) {
  const knowledgeBaseEnabled = isKnowledgeBaseEnabled();
  const { detail } = await requireInitializedDetail(code);
  const module = ensureModuleAccessible(detail, moduleCode, knowledgeBaseEnabled);
  const groupedVersions = groupModuleDataVersions(detail.moduleData);
  const groupedJobs = groupGenerationJobs(detail.generationJobs);
  const groupedAuditEvents = groupModuleAuditEvents(detail.auditEvents);

  return {
    module_code: moduleCode,
    versions: (groupedVersions.get(module.id) ?? []).map((version) => ({
      id: version.id,
      version: version.version,
      data: version.dataJson,
      source_summary: version.sourceSummaryJson,
      confidence: version.confidenceJson,
      ai_notes: version.aiNotesJson,
      generated_from_fiche_version: version.generatedFromFicheVersion,
      generated_from_fiche_hash: version.generatedFromFicheHash,
      created_at: version.createdAt,
      updated_at: version.updatedAt
    })),
    generation_jobs: (groupedJobs.get(module.id) ?? []).map((job) => ({
      id: job.id,
      trigger_type: job.triggerType,
      provider: job.provider,
      model: job.model,
      status: job.status,
      contract_version: job.contractVersion,
      schema_version: job.schemaVersion,
      prompt_version: job.promptVersion,
      generation_parameters: job.generationParameters,
      source_fiche_version: job.sourceFicheVersion,
      source_fiche_hash: job.sourceFicheHash,
      execution_id: job.executionId,
      correlation_id: job.correlationId,
      started_at: job.startedAt,
      completed_at: job.completedAt,
      callback_received_at: job.callbackReceivedAt,
      error_code: job.errorCode,
      error_message: job.errorMessage,
      created_at: job.createdAt
    })),
    audit_events: (groupedAuditEvents.get(module.id) ?? []).map((event) => ({
      id: event.id,
      event_type: event.eventType,
      actor: event.actor,
      payload: event.payloadJson,
      created_at: event.createdAt
    }))
  };
}
