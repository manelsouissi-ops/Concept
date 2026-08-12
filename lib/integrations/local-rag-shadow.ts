import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getAppelOffresDetailByCode, getProcessingJobByPublicId } from "../appels-offres/repository.ts";
import { markdownPath, projectDir, readStoredFicheXml } from "../storage.ts";

export type LocalRagShadowStatus =
  | "SUCCESS"
  | "VALIDATION_FAILED"
  | "TIMEOUT"
  | "SERVICE_UNAVAILABLE"
  | "ERROR";

export type LocalRagShadowExecutionResult =
  | LocalRagShadowArtifact
  | { status: "DISABLED" | "DUPLICATE" };

export type LocalRagShadowIdentity = {
  appelOffreId: number;
  codeInterne: string;
  documentId: number;
  documentHash: string;
  markdownPath: string;
  processingJobId: string;
  correlationId: string;
  authoritativeXml: string;
};

export type LocalRagShadowArtifact = {
  mode: "shadow";
  authoritative_provider: "gemini";
  authoritative_persisted: true;
  official_state_mutated_by_shadow: false;
  status: LocalRagShadowStatus;
  appel_offre_id: number;
  code_interne: string;
  document_id: number;
  document_hash: string;
  processing_job_id: string;
  correlation_id: string;
  shadow_started_at: string;
  shadow_finished_at: string;
  local_model: string | null;
  embedding_model: string | null;
  local_validation_status: "SUCCESS" | "VALIDATION_FAILED" | "NOT_AVAILABLE";
  metrics: {
    node_count: number | null;
    embedding_time: number | null;
    retrieval_time: number | null;
    generation_time: number | null;
    total_time: number | null;
    fields_total: number;
    exact_matches: number;
    normalized_matches: number;
    differences: number;
    gemini_only: number;
    local_only: number;
    both_null: number;
  } | null;
  comparison: Record<string, unknown> | null;
  shadow_error: { code: string; message: string } | null;
};

type ShadowDependencies = {
  fetchImpl?: typeof fetch;
  now?: () => string;
  persist?: (artifact: LocalRagShadowArtifact) => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 120_000;

function positiveInteger(raw: string | undefined, fallback: number) {
  if (!raw?.trim()) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("LOCAL_RAG_SHADOW_TIMEOUT_MS doit etre un entier positif.");
  }
  return value;
}

export function isLocalRagShadowEnabled() {
  return process.env.LOCAL_RAG_SHADOW_ENABLED?.trim().toLowerCase() === "true";
}

export function getLocalRagShadowConfig() {
  return {
    enabled: isLocalRagShadowEnabled(),
    serviceUrl: (process.env.LOCAL_RAG_SERVICE_URL?.trim() || "http://127.0.0.1:8091").replace(/\/+$/, ""),
    serviceToken: process.env.LOCAL_RAG_SERVICE_TOKEN?.trim() || "",
    contractVersion: process.env.LOCAL_RAG_CONTRACT_VERSION?.trim() || "local-cdc-shadow.v1",
    timeoutMs: positiveInteger(process.env.LOCAL_RAG_SHADOW_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  };
}

function artifactPath(identity: Pick<LocalRagShadowIdentity, "codeInterne" | "documentId" | "documentHash">) {
  const digest = identity.documentHash.replace(/^sha256:/, "");
  return path.join(projectDir(identity.codeInterne), "shadow", `local-rag-${identity.documentId}-${digest}.json`);
}

export function buildLocalRagShadowIdempotencyKey(
  identity: Pick<LocalRagShadowIdentity, "appelOffreId" | "documentId" | "documentHash">
) {
  return `${identity.appelOffreId}:${identity.documentId}:${identity.documentHash}`;
}

async function persistArtifact(artifact: LocalRagShadowArtifact) {
  const target = artifactPath({
    codeInterne: artifact.code_interne,
    documentId: artifact.document_id,
    documentHash: artifact.document_hash
  });
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  await fs.writeFile(temporary, JSON.stringify(artifact, null, 2), "utf8");
  await fs.rename(temporary, target);
}

async function claim(identity: LocalRagShadowIdentity) {
  const target = artifactPath(identity);
  const lock = `${target}.lock`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.access(target);
    return { acquired: false, lock, target };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    const handle = await fs.open(lock, "wx");
    await handle.writeFile(JSON.stringify({ processing_job_id: identity.processingJobId, claimed_at: new Date().toISOString() }));
    await handle.close();
    return { acquired: true, lock, target };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { acquired: false, lock, target };
    throw error;
  }
}

function errorStatus(error: unknown): { status: LocalRagShadowStatus; code: string; message: string } {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { status: "TIMEOUT", code: "TIMEOUT", message: "Local RAG shadow request timed out." };
  }
  if (error instanceof TypeError) {
    return { status: "SERVICE_UNAVAILABLE", code: "SERVICE_UNAVAILABLE", message: error.message };
  }
  const message = error instanceof Error ? error.message : "Local RAG shadow request failed.";
  return { status: "ERROR", code: "ERROR", message };
}

function numeric(record: Record<string, unknown> | null, key: string) {
  return typeof record?.[key] === "number" ? record[key] as number : null;
}

function successfulMetrics(body: Record<string, unknown>) {
  const local = body.local_metrics && typeof body.local_metrics === "object"
    ? body.local_metrics as Record<string, unknown>
    : null;
  const comparison = body.comparison && typeof body.comparison === "object"
    ? body.comparison as Record<string, unknown>
    : null;
  return {
    node_count: numeric(local, "chunk_count"),
    embedding_time: numeric(local, "embedding_ms"),
    retrieval_time: numeric(local, "retrieval_ms"),
    generation_time: numeric(local, "generation_ms"),
    total_time: numeric(local, "total_ms"),
    fields_total: numeric(comparison, "fields_total") ?? 34,
    exact_matches: numeric(comparison, "exact_matches") ?? 0,
    normalized_matches: numeric(comparison, "normalized_matches") ?? 0,
    differences: numeric(comparison, "differences") ?? 0,
    gemini_only: numeric(comparison, "gemini_only") ?? 0,
    local_only: numeric(comparison, "local_only") ?? 0,
    both_null: numeric(comparison, "both_null") ?? 0
  };
}

export async function executeLocalRagShadow(
  identity: LocalRagShadowIdentity,
  dependencies: ShadowDependencies = {}
): Promise<LocalRagShadowExecutionResult> {
  const config = getLocalRagShadowConfig();
  if (!config.enabled) return { status: "DISABLED" };

  const persistence = dependencies.persist ?? persistArtifact;
  const runClaim = dependencies.persist ? { acquired: true, lock: "", target: "" } : await claim(identity);
  if (!runClaim.acquired) return { status: "DUPLICATE" };

  const now = dependencies.now ?? (() => new Date().toISOString());
  const startedAt = now();
  let artifact: LocalRagShadowArtifact;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await (dependencies.fetchImpl ?? fetch)(`${config.serviceUrl}/v1/shadow`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.serviceToken}`,
        "Content-Type": "application/json",
        "X-Contract-Version": config.contractVersion,
        "Idempotency-Key": buildLocalRagShadowIdempotencyKey(identity)
      },
      body: JSON.stringify({
        contract_version: config.contractVersion,
        appel_offre_id: identity.appelOffreId,
        code_interne: identity.codeInterne,
        document_id: identity.documentId,
        markdown_path: identity.markdownPath,
        markdown_content_hash: identity.documentHash,
        processing_job_id: identity.processingJobId,
        correlation_id: identity.correlationId,
        authoritative_xml: identity.authoritativeXml
      }),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const code = typeof body.code === "string" ? body.code : `HTTP_${response.status}`;
      const message = typeof body.error === "string" ? body.error : `Local RAG returned HTTP ${response.status}.`;
      artifact = {
        mode: "shadow", authoritative_provider: "gemini", authoritative_persisted: true,
        official_state_mutated_by_shadow: false,
        status: response.status === 422 ? "VALIDATION_FAILED" : "ERROR",
        appel_offre_id: identity.appelOffreId, code_interne: identity.codeInterne,
        document_id: identity.documentId, document_hash: identity.documentHash,
        processing_job_id: identity.processingJobId, correlation_id: identity.correlationId,
        shadow_started_at: startedAt, shadow_finished_at: now(), local_model: null,
        embedding_model: null,
        local_validation_status: response.status === 422 ? "VALIDATION_FAILED" : "NOT_AVAILABLE",
        metrics: null, comparison: null, shadow_error: { code, message }
      };
    } else {
      artifact = {
        mode: "shadow", authoritative_provider: "gemini", authoritative_persisted: true,
        official_state_mutated_by_shadow: false, status: "SUCCESS",
        appel_offre_id: identity.appelOffreId, code_interne: identity.codeInterne,
        document_id: identity.documentId, document_hash: identity.documentHash,
        processing_job_id: identity.processingJobId, correlation_id: identity.correlationId,
        shadow_started_at: startedAt, shadow_finished_at: now(),
        local_model: typeof body.local_model === "string" ? body.local_model : null,
        embedding_model: typeof body.embedding_model === "string" ? body.embedding_model : null,
        local_validation_status: "SUCCESS", metrics: successfulMetrics(body),
        comparison: body.comparison && typeof body.comparison === "object" ? body.comparison as Record<string, unknown> : null,
        shadow_error: null
      };
    }
  } catch (error) {
    const classified = errorStatus(error);
    artifact = {
      mode: "shadow", authoritative_provider: "gemini", authoritative_persisted: true,
      official_state_mutated_by_shadow: false, status: classified.status,
      appel_offre_id: identity.appelOffreId, code_interne: identity.codeInterne,
      document_id: identity.documentId, document_hash: identity.documentHash,
      processing_job_id: identity.processingJobId, correlation_id: identity.correlationId,
      shadow_started_at: startedAt, shadow_finished_at: now(), local_model: null,
      embedding_model: null, local_validation_status: "NOT_AVAILABLE", metrics: null,
      comparison: null, shadow_error: { code: classified.code, message: classified.message }
    };
  } finally {
    clearTimeout(timeout);
  }
  try {
    await persistence(artifact);
  } finally {
    if (runClaim.lock) await fs.rm(runClaim.lock, { force: true }).catch(() => undefined);
  }
  return artifact;
}

export async function resolveLocalRagShadowIdentity(input: {
  codeInterne: string;
  processingJobId: string;
  correlationId: string;
}): Promise<LocalRagShadowIdentity> {
  const [appel, job, authoritativeXml, markdown] = await Promise.all([
    getAppelOffresDetailByCode(input.codeInterne, { includeArchived: true }),
    getProcessingJobByPublicId(input.processingJobId),
    readStoredFicheXml(input.codeInterne),
    fs.readFile(markdownPath(input.codeInterne), "utf8")
  ]);
  if (!appel || !job || job.appelOffresId !== appel.id || job.correlationId !== input.correlationId) {
    throw new Error("SHADOW_IDENTITY_MISMATCH");
  }
  const document = appel.documents.find((item) => item.kind === "fiche_markdown");
  if (!document || path.resolve(document.storagePath) !== path.resolve(markdownPath(input.codeInterne))) {
    throw new Error("SHADOW_DOCUMENT_MISMATCH");
  }
  const hash = `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;
  return {
    appelOffreId: appel.id,
    codeInterne: input.codeInterne,
    documentId: document.id,
    documentHash: hash,
    markdownPath: path.resolve(document.storagePath),
    processingJobId: input.processingJobId,
    correlationId: input.correlationId,
    authoritativeXml
  };
}

export async function runLocalRagShadowAfterOfficialSuccess(input: {
  codeInterne: string;
  processingJobId: string;
  correlationId: string;
}) {
  if (!isLocalRagShadowEnabled()) return { status: "DISABLED" as const };
  try {
    const identity = await resolveLocalRagShadowIdentity(input);
    return await executeLocalRagShadow(identity);
  } catch (error) {
    console.error("[local-rag-shadow] fail-open shadow execution error", {
      codeInterne: input.codeInterne,
      processingJobId: input.processingJobId,
      error: error instanceof Error ? error.message : "unknown"
    });
    return { status: "ERROR" as const };
  }
}
