import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import {
  LOCAL_EMBEDDING_URL,
  LOCAL_QDRANT_URL,
  HISTORICAL_PROJECTS_QDRANT_COLLECTION,
  embedTextLocally
} from "./rex-project-rag.ts";

/**
 * Controlled local ingestion for FCI C's historical project-reference RAG
 * pilot. See docs/HISTORICAL_PROJECT_INGESTION_PILOT.md for the full design.
 *
 * Layered exactly like rex-project-rag.ts:
 * - PURE functions (validation, embedding-text, content hash, reconciliation
 *   comparisons) take no I/O dependency and are fully unit-testable.
 * - I/O functions (Postgres upsert, local embedding, local Qdrant upsert)
 *   are injectable, reuse rex-project-rag.ts's loopback-only embedding
 *   client rather than duplicating it, and never call anything external.
 *
 * PostgreSQL (`knowledge_base.historical_project_records`, additive - see
 * scripts/sql/20260827_historical_project_records.sql) is the SOURCE OF
 * TRUTH for canonical metadata, approval state, and indexing state. Qdrant
 * is a retrieval index only: it can always be rebuilt from Postgres, never
 * the other way around.
 */

// ---------------------------------------------------------------------------
// Canonical record
// ---------------------------------------------------------------------------

export type HistoricalProjectReuseStatus =
  | "approved_for_rag"
  | "pending_review"
  | "rejected"
  | "archived";

export type HistoricalProjectIndexStatus = "pending" | "indexed" | "failed";

/**
 * Required: identity of the approved source document/file plus the one
 * piece of free text ever embedded. Everything else is optional business
 * metadata that must never be fabricated when unknown - `null`/omitted only.
 * There is deliberately no field here that could hold consultant/CV/PII or
 * current-resource-availability content; the schema itself is the guard.
 */
export type HistoricalProjectRecordInput = {
  sourceDocumentFilename: string;
  /** Local filesystem path, used only to compute sha256 and never stored in Qdrant payloads or exposed as provenance. */
  sourceDocumentSourcePath: string;
  /** Safe, human-readable label shown as provenance - never a raw filesystem path. */
  sourceReference: string;
  sourceSection?: string | null;
  /** The ONLY free text ever embedded. Must already be an approved, human-reviewable project/business summary. */
  approvedSummaryText: string;
  reuseStatus: HistoricalProjectReuseStatus;

  projectCode?: string | null;
  title?: string | null;
  year?: string | null;
  country?: string | null;
  sector?: string | null;
  subsector?: string | null;
  projectType?: string | null;
  client?: string | null;
  fundingInstitution?: string | null;
  natureOfServices?: string | null;
  technicalScope?: string | null;
  technicalComponents?: string[] | null;
  keyDeliverables?: string[] | null;
};

export type HistoricalProjectValidationIssue = { field: string; reason: string };

const REUSE_STATUSES: readonly HistoricalProjectReuseStatus[] = [
  "approved_for_rag",
  "pending_review",
  "rejected",
  "archived"
];

/**
 * Rejects a malformed record rather than silently guessing/coercing it
 * (Step 25). Also rejects a `sourceReference` that is transparently just the
 * raw local source path repeated, so a caller cannot accidentally defeat the
 * "no raw filesystem paths in provenance" rule by passing the same string
 * twice.
 */
export function validateHistoricalProjectRecordInput(
  input: HistoricalProjectRecordInput
): HistoricalProjectValidationIssue[] {
  const issues: HistoricalProjectValidationIssue[] = [];

  if (!input.sourceDocumentFilename?.trim()) {
    issues.push({ field: "sourceDocumentFilename", reason: "required" });
  }
  if (!input.sourceDocumentSourcePath?.trim()) {
    issues.push({ field: "sourceDocumentSourcePath", reason: "required" });
  }
  if (!input.sourceReference?.trim()) {
    issues.push({ field: "sourceReference", reason: "required" });
  } else if (input.sourceDocumentSourcePath && input.sourceReference === input.sourceDocumentSourcePath) {
    issues.push({ field: "sourceReference", reason: "must_not_be_raw_filesystem_path" });
  }
  if (!input.approvedSummaryText?.trim()) {
    issues.push({ field: "approvedSummaryText", reason: "required" });
  }
  if (!REUSE_STATUSES.includes(input.reuseStatus)) {
    issues.push({ field: "reuseStatus", reason: "invalid_enum_value" });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Deterministic embedding-text and content-hash contracts
// ---------------------------------------------------------------------------

/**
 * Fixed field order so the same canonical record version always produces
 * the same embedding input (Step 10). Deliberately excludes
 * `sourceDocumentSourcePath`, `sourceReference`, `projectCode`, `title`,
 * `client`, and `year` - identity/administrative fields carry no retrieval
 * signal and would only add noise to the embedding.
 */
export function buildProjectEmbeddingText(record: HistoricalProjectRecordInput): string {
  const parts = [
    record.sector,
    record.subsector,
    record.projectType,
    record.country,
    record.natureOfServices,
    record.technicalScope,
    record.technicalComponents?.length ? record.technicalComponents.join(", ") : null,
    record.keyDeliverables?.length ? record.keyDeliverables.join(", ") : null,
    record.approvedSummaryText
  ];
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" | ");
}

/**
 * Stable hash over the embedding text plus the metadata fields that could
 * legitimately change between re-ingestions (Step 11). Same canonical
 * content -> same hash -> idempotent no-op on re-ingestion. Changed
 * approved content -> new hash -> deterministic re-embed/upsert.
 */
export function computeProjectContentHash(record: HistoricalProjectRecordInput): string {
  const canonical = {
    embeddingText: buildProjectEmbeddingText(record),
    projectCode: record.projectCode ?? null,
    title: record.title ?? null,
    year: record.year ?? null,
    country: record.country ?? null,
    sector: record.sector ?? null,
    subsector: record.subsector ?? null,
    projectType: record.projectType ?? null,
    client: record.client ?? null,
    fundingInstitution: record.fundingInstitution ?? null,
    sourceReference: record.sourceReference,
    sourceSection: record.sourceSection ?? null
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export async function computeFileSha256(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

// ---------------------------------------------------------------------------
// Postgres: knowledge_documents / knowledge_document_versions (reused, not
// duplicated) + knowledge_base.historical_project_records (new, additive)
// ---------------------------------------------------------------------------

export type KnowledgeDocumentVersionIdentity = {
  documentId: number;
  documentVersionId: number;
  versionNumber: number;
  isNewVersion: boolean;
};

/**
 * Mirrors the existing historical-CDC service's idempotent document/version
 * upsert convention against the SAME two tables it already uses (Step 4/5):
 * same document_key + same sha256 as the current version -> no-op, reuse
 * the existing version; same document_key + different sha256 -> new
 * version row. Never touches any column the CDC service relies on.
 */
export async function upsertKnowledgeDocumentVersion(
  client: PoolClient | Pool,
  input: { filename: string; sourcePath: string; sha256: string; fileSize: number }
): Promise<KnowledgeDocumentVersionIdentity> {
  const documentKey = createHash("sha256").update(input.filename.trim().toLowerCase()).digest("hex");

  const existingDocument = await client.query<{
    id: number;
    current_version_id: number | null;
  }>(
    `select id, current_version_id from knowledge_base.knowledge_documents where document_key = $1`,
    [documentKey]
  );

  if (existingDocument.rows.length > 0) {
    const documentId = existingDocument.rows[0].id;
    const currentVersionId = existingDocument.rows[0].current_version_id;
    if (currentVersionId) {
      const currentVersion = await client.query<{ id: number; sha256: string; version_number: number }>(
        `select id, sha256, version_number from knowledge_base.knowledge_document_versions where id = $1`,
        [currentVersionId]
      );
      if (currentVersion.rows[0]?.sha256 === input.sha256) {
        return {
          documentId,
          documentVersionId: currentVersion.rows[0].id,
          versionNumber: currentVersion.rows[0].version_number,
          isNewVersion: false
        };
      }
    }

    const nextVersion = await client.query<{ max: number | null }>(
      `select max(version_number) as max from knowledge_base.knowledge_document_versions where document_id = $1`,
      [documentId]
    );
    const versionNumber = (nextVersion.rows[0]?.max ?? 0) + 1;
    const inserted = await client.query<{ id: number }>(
      `insert into knowledge_base.knowledge_document_versions
         (document_id, version_number, filename, source_path, sha256, file_size, status, qdrant_collection, processing_version)
       values ($1, $2, $3, $4, $5, $6, 'SUCCESS', $7, 'historical-project-v1')
       returning id`,
      [documentId, versionNumber, input.filename, input.sourcePath, input.sha256, input.fileSize, HISTORICAL_PROJECTS_QDRANT_COLLECTION]
    );
    const documentVersionId = inserted.rows[0].id;
    await client.query(
      `update knowledge_base.knowledge_documents set current_version_id = $1, updated_at = now() where id = $2`,
      [documentVersionId, documentId]
    );
    return { documentId, documentVersionId, versionNumber, isNewVersion: true };
  }

  const insertedDocument = await client.query<{ id: number }>(
    `insert into knowledge_base.knowledge_documents (document_key, filename, source_path)
     values ($1, $2, $3)
     returning id`,
    [documentKey, input.filename, input.sourcePath]
  );
  const documentId = insertedDocument.rows[0].id;
  const insertedVersion = await client.query<{ id: number }>(
    `insert into knowledge_base.knowledge_document_versions
       (document_id, version_number, filename, source_path, sha256, file_size, status, qdrant_collection, processing_version)
     values ($1, 1, $2, $3, $4, $5, 'SUCCESS', $6, 'historical-project-v1')
     returning id`,
    [documentId, input.filename, input.sourcePath, input.sha256, input.fileSize, HISTORICAL_PROJECTS_QDRANT_COLLECTION]
  );
  const documentVersionId = insertedVersion.rows[0].id;
  await client.query(
    `update knowledge_base.knowledge_documents set current_version_id = $1 where id = $2`,
    [documentVersionId, documentId]
  );
  return { documentId, documentVersionId, versionNumber: 1, isNewVersion: true };
}

export type HistoricalProjectRecordRow = {
  id: number;
  documentId: number;
  documentVersionId: number;
  reuseStatus: HistoricalProjectReuseStatus;
  contentHash: string;
  indexStatus: HistoricalProjectIndexStatus;
  qdrantPointId: string | null;
  qdrantCollection: string | null;
};

/**
 * Upserts the canonical project record keyed by document_version_id (one
 * project record per document version - Step 9's retrieval-unit rule,
 * enforced here at the persistence layer too via the table's UNIQUE
 * constraint). Never sets index_status to 'indexed' itself - that only
 * happens after a real, successful embedding + Qdrant upsert.
 */
export async function upsertHistoricalProjectRecord(
  client: PoolClient | Pool,
  documentId: number,
  documentVersionId: number,
  input: HistoricalProjectRecordInput,
  contentHash: string
): Promise<HistoricalProjectRecordRow> {
  const existing = await client.query<{ id: number; content_hash: string; index_status: HistoricalProjectIndexStatus }>(
    `select id, content_hash, index_status from knowledge_base.historical_project_records where document_version_id = $1`,
    [documentVersionId]
  );

  const technicalComponents = input.technicalComponents ?? null;
  const keyDeliverables = input.keyDeliverables ?? null;

  if (existing.rows.length > 0) {
    // The SET clause's CASE expression below compares the new hash ($18)
    // against the pre-update `content_hash` column value - standard SQL
    // UPDATE semantics evaluate all SET expressions against the row as it
    // was before this statement, so this is the same comparison as
    // `previous.content_hash !== contentHash` without needing a second
    // round trip or a separate branch here.
    const result = await client.query<{
      id: number;
      document_id: number;
      document_version_id: number;
      reuse_status: HistoricalProjectReuseStatus;
      content_hash: string;
      index_status: HistoricalProjectIndexStatus;
      qdrant_point_id: string | null;
      qdrant_collection: string | null;
    }>(
      `update knowledge_base.historical_project_records set
         project_code = $1, title = $2, year = $3, country = $4, sector = $5, subsector = $6,
         project_type = $7, client = $8, funding_institution = $9, nature_of_services = $10,
         technical_scope = $11, technical_components = $12::jsonb, key_deliverables = $13::jsonb,
         source_reference = $14, source_section = $15, approved_summary_text = $16,
         reuse_status = $17, content_hash = $18,
         index_status = case when $18 <> content_hash then 'pending' else index_status end,
         updated_at = now()
       where document_version_id = $19
       returning id, document_id, document_version_id, reuse_status, content_hash, index_status, qdrant_point_id, qdrant_collection`,
      [
        input.projectCode ?? null,
        input.title ?? null,
        input.year ?? null,
        input.country ?? null,
        input.sector ?? null,
        input.subsector ?? null,
        input.projectType ?? null,
        input.client ?? null,
        input.fundingInstitution ?? null,
        input.natureOfServices ?? null,
        input.technicalScope ?? null,
        technicalComponents ? JSON.stringify(technicalComponents) : null,
        keyDeliverables ? JSON.stringify(keyDeliverables) : null,
        input.sourceReference,
        input.sourceSection ?? null,
        input.approvedSummaryText,
        input.reuseStatus,
        contentHash,
        documentVersionId
      ]
    );
    const row = result.rows[0];
    return {
      id: row.id,
      documentId: row.document_id,
      documentVersionId: row.document_version_id,
      reuseStatus: row.reuse_status,
      contentHash: row.content_hash,
      indexStatus: row.index_status,
      qdrantPointId: row.qdrant_point_id,
      qdrantCollection: row.qdrant_collection
    };
  }

  const inserted = await client.query<{
    id: number;
    document_id: number;
    document_version_id: number;
    reuse_status: HistoricalProjectReuseStatus;
    content_hash: string;
    index_status: HistoricalProjectIndexStatus;
    qdrant_point_id: string | null;
    qdrant_collection: string | null;
  }>(
    `insert into knowledge_base.historical_project_records
       (document_id, document_version_id, project_code, title, year, country, sector, subsector,
        project_type, client, funding_institution, nature_of_services, technical_scope,
        technical_components, key_deliverables, source_reference, source_section,
        approved_summary_text, reuse_status, content_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17, $18, $19, $20)
     returning id, document_id, document_version_id, reuse_status, content_hash, index_status, qdrant_point_id, qdrant_collection`,
    [
      documentId,
      documentVersionId,
      input.projectCode ?? null,
      input.title ?? null,
      input.year ?? null,
      input.country ?? null,
      input.sector ?? null,
      input.subsector ?? null,
      input.projectType ?? null,
      input.client ?? null,
      input.fundingInstitution ?? null,
      input.natureOfServices ?? null,
      input.technicalScope ?? null,
      technicalComponents ? JSON.stringify(technicalComponents) : null,
      keyDeliverables ? JSON.stringify(keyDeliverables) : null,
      input.sourceReference,
      input.sourceSection ?? null,
      input.approvedSummaryText,
      input.reuseStatus,
      contentHash
    ]
  );
  const row = inserted.rows[0];
  return {
    id: row.id,
    documentId: row.document_id,
    documentVersionId: row.document_version_id,
    reuseStatus: row.reuse_status,
    contentHash: row.content_hash,
    indexStatus: row.index_status,
    qdrantPointId: row.qdrant_point_id,
    qdrantCollection: row.qdrant_collection
  };
}

export async function markHistoricalProjectRecordIndexed(
  client: PoolClient | Pool,
  documentVersionId: number,
  info: { qdrantPointId: string; qdrantCollection: string; embeddingDimension: number }
): Promise<void> {
  await client.query(
    `update knowledge_base.historical_project_records set
       index_status = 'indexed', qdrant_point_id = $1, qdrant_collection = $2,
       embedding_dimension = $3, index_error_code = null, index_error_message = null,
       indexed_at = now(), updated_at = now()
     where document_version_id = $4`,
    [info.qdrantPointId, info.qdrantCollection, info.embeddingDimension, documentVersionId]
  );
}

export async function markHistoricalProjectRecordFailed(
  client: PoolClient | Pool,
  documentVersionId: number,
  error: { code: string; message: string }
): Promise<void> {
  await client.query(
    `update knowledge_base.historical_project_records set
       index_status = 'failed', index_error_code = $1, index_error_message = $2, updated_at = now()
     where document_version_id = $3`,
    [error.code, error.message, documentVersionId]
  );
}

/**
 * De-approval (Step 27/14): stops a record from appearing in retrieval
 * while preserving its full canonical audit history in Postgres. This
 * function performs BOTH halves of that guarantee itself - it does not
 * leave Qdrant cleanup to a separate caller step that could be forgotten:
 * Postgres is updated first (source of truth reflects de-approval even if
 * the Qdrant call that follows fails), then the vector is actually deleted
 * from Qdrant if one existed. A Qdrant deletion failure does not roll back
 * the Postgres change (de-approval must not silently fail) - it is instead
 * exactly the kind of drift `findOrphanVectorPointIds` is built to catch on
 * a later reconciliation pass, since a de-approved record's
 * document_version_id no longer appears in the "approved + indexed" set.
 */
export async function deapproveHistoricalProjectRecord(
  client: PoolClient | Pool,
  documentVersionId: number,
  newStatus: Extract<HistoricalProjectReuseStatus, "rejected" | "archived" | "pending_review">,
  options: { fetchImpl?: typeof fetch; collection?: string } = {}
): Promise<{ hadIndexedVector: boolean; vectorDeleted: boolean; qdrantPointId: string | null; qdrantCollection: string | null }> {
  const existing = await client.query<{ qdrant_point_id: string | null; qdrant_collection: string | null; index_status: HistoricalProjectIndexStatus }>(
    `select qdrant_point_id, qdrant_collection, index_status from knowledge_base.historical_project_records where document_version_id = $1`,
    [documentVersionId]
  );
  const row = existing.rows[0];
  const hadIndexedVector = row?.index_status === "indexed" && Boolean(row.qdrant_point_id);

  await client.query(
    `update knowledge_base.historical_project_records set
       reuse_status = $1,
       index_status = case when index_status = 'indexed' then 'pending' else index_status end,
       updated_at = now()
     where document_version_id = $2`,
    [newStatus, documentVersionId]
  );

  let vectorDeleted = false;
  if (hadIndexedVector) {
    try {
      await deleteHistoricalProjectVector(documentVersionId, options);
      vectorDeleted = true;
    } catch {
      vectorDeleted = false;
    }
  }

  return {
    hadIndexedVector,
    vectorDeleted,
    qdrantPointId: row?.qdrant_point_id ?? null,
    qdrantCollection: row?.qdrant_collection ?? null
  };
}

// ---------------------------------------------------------------------------
// Local Qdrant upsert / delete (loopback-only, reuses rex-project-rag.ts's
// URL constants and enforcement pattern)
// ---------------------------------------------------------------------------

function assertLoopbackUrl(rawUrl: string, label: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    throw new Error(`${label} doit rester en loopback (http://127.0.0.1 ou http://localhost).`);
  }
  return url;
}

/**
 * Field names and shape are deliberately compatible with what
 * rex-project-rag.ts's `queryHistoricalProjectsInQdrant` already reads back
 * out of a Qdrant point payload (see historical-project-ingestion.test.ts,
 * "retrieval-module compatibility"). `title` is included because a human
 * reviewer needs a readable label for a suggestion and it carries no
 * PII/current-resource risk. `client` is deliberately NOT written here even
 * though the retrieval reader can accept one - rex-project-rag.ts's own
 * suggestion-building logic never reads it today, and a client name is more
 * business-sensitive than the other filter fields, so the minimal-payload
 * rule (Step 13) keeps it out until a concrete need and access-control
 * review justify adding it.
 */
export type HistoricalProjectQdrantPayload = {
  document_id: number;
  document_version_id: number;
  source_reference: string;
  section: string | null;
  title: string | null;
  year: string | null;
  country: string | null;
  sector: string | null;
  subsector: string | null;
  project_type: string | null;
  funding_institution: string | null;
  reuse_status: HistoricalProjectReuseStatus;
  content_hash: string;
};

export function buildHistoricalProjectQdrantPayload(
  documentId: number,
  documentVersionId: number,
  input: HistoricalProjectRecordInput,
  contentHash: string
): HistoricalProjectQdrantPayload {
  return {
    document_id: documentId,
    document_version_id: documentVersionId,
    source_reference: input.sourceReference,
    section: input.sourceSection ?? null,
    title: input.title ?? null,
    year: input.year ?? null,
    country: input.country ?? null,
    sector: input.sector ?? null,
    subsector: input.subsector ?? null,
    project_type: input.projectType ?? null,
    funding_institution: input.fundingInstitution ?? null,
    reuse_status: input.reuseStatus,
    content_hash: contentHash
  };
}

/**
 * One point per document version (Step 9/12): document_version_id is
 * already a unique, stable bigint identity from Postgres, so it is used
 * directly as the Qdrant point ID. Unlike the chunked CDC collection (which
 * needs a UUIDv5 over document-version + chunk index to disambiguate
 * multiple chunks per version), a single project-level point per version
 * needs no extra derivation - simpler and equally stable.
 */
export async function upsertHistoricalProjectVector(
  documentVersionId: number,
  embedding: number[],
  payload: HistoricalProjectQdrantPayload,
  options: { fetchImpl?: typeof fetch; collection?: string } = {}
): Promise<void> {
  const collection = options.collection ?? HISTORICAL_PROJECTS_QDRANT_COLLECTION;
  const url = assertLoopbackUrl(`${LOCAL_QDRANT_URL}/collections/${collection}/points`, "LOCAL_QDRANT_URL");
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ points: [{ id: documentVersionId, vector: embedding, payload }] })
  });
  if (!response.ok) {
    throw new Error(`Qdrant local a refuse l'upsert (HTTP ${response.status}).`);
  }
}

export async function deleteHistoricalProjectVector(
  documentVersionId: number,
  options: { fetchImpl?: typeof fetch; collection?: string } = {}
): Promise<void> {
  const collection = options.collection ?? HISTORICAL_PROJECTS_QDRANT_COLLECTION;
  const url = assertLoopbackUrl(
    `${LOCAL_QDRANT_URL}/collections/${collection}/points/delete`,
    "LOCAL_QDRANT_URL"
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ points: [documentVersionId] })
  });
  if (!response.ok) {
    throw new Error(`Qdrant local a refuse la suppression (HTTP ${response.status}).`);
  }
}

// ---------------------------------------------------------------------------
// Orchestration: one approved record in, indexed (or safely failed) out
// ---------------------------------------------------------------------------

export type IngestHistoricalProjectResult =
  | { status: "invalid"; issues: HistoricalProjectValidationIssue[] }
  | { status: "not_approved"; documentVersionId: number; reuseStatus: HistoricalProjectReuseStatus }
  | { status: "unchanged"; documentVersionId: number }
  | { status: "indexed"; documentVersionId: number; qdrantPointId: number; embeddingDimension: number }
  | { status: "failed"; documentVersionId: number; errorCode: string; errorMessage: string };

/**
 * The full controlled ingestion flow (Step 16): validate -> upsert
 * document/version identity -> upsert canonical record -> stop if not
 * approved_for_rag -> skip if content unchanged and already indexed ->
 * embed locally -> upsert Qdrant point -> mark indexed, or mark failed
 * without losing the canonical Postgres record (Step 17).
 */
export async function ingestHistoricalProjectRecord(
  client: PoolClient | Pool,
  input: HistoricalProjectRecordInput,
  deps: {
    sha256: string;
    fileSize: number;
    embedText?: (text: string) => Promise<number[]>;
    fetchImpl?: typeof fetch;
  }
): Promise<IngestHistoricalProjectResult> {
  const issues = validateHistoricalProjectRecordInput(input);
  if (issues.length > 0) {
    return { status: "invalid", issues };
  }

  const { documentId, documentVersionId } = await upsertKnowledgeDocumentVersion(client, {
    filename: input.sourceDocumentFilename,
    sourcePath: input.sourceDocumentSourcePath,
    sha256: deps.sha256,
    fileSize: deps.fileSize
  });

  const contentHash = computeProjectContentHash(input);
  const record = await upsertHistoricalProjectRecord(client, documentId, documentVersionId, input, contentHash);

  if (record.reuseStatus !== "approved_for_rag") {
    return { status: "not_approved", documentVersionId, reuseStatus: record.reuseStatus };
  }

  if (record.indexStatus === "indexed" && record.contentHash === contentHash) {
    return { status: "unchanged", documentVersionId };
  }

  const embedText = deps.embedText ?? ((text: string) => embedTextLocally(text, deps.fetchImpl));
  const embeddingText = buildProjectEmbeddingText(input);
  const payload = buildHistoricalProjectQdrantPayload(documentId, documentVersionId, input, contentHash);

  try {
    const embedding = await embedText(embeddingText);
    await upsertHistoricalProjectVector(documentVersionId, embedding, payload, { fetchImpl: deps.fetchImpl });
    await markHistoricalProjectRecordIndexed(client, documentVersionId, {
      qdrantPointId: String(documentVersionId),
      qdrantCollection: HISTORICAL_PROJECTS_QDRANT_COLLECTION,
      embeddingDimension: embedding.length
    });
    return {
      status: "indexed",
      documentVersionId,
      qdrantPointId: documentVersionId,
      embeddingDimension: embedding.length
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await markHistoricalProjectRecordFailed(client, documentVersionId, {
      code: "INDEXING_FAILED",
      message: errorMessage
    });
    return { status: "failed", documentVersionId, errorCode: "INDEXING_FAILED", errorMessage };
  }
}

// ---------------------------------------------------------------------------
// Reconciliation (pure comparisons over already-fetched lists - Step 18)
// ---------------------------------------------------------------------------

export function findApprovedRecordsMissingVectors(
  rows: Array<{ documentVersionId: number; reuseStatus: HistoricalProjectReuseStatus; indexStatus: HistoricalProjectIndexStatus }>
): number[] {
  return rows
    .filter((row) => row.reuseStatus === "approved_for_rag" && row.indexStatus !== "indexed")
    .map((row) => row.documentVersionId);
}

export function findOrphanVectorPointIds(
  qdrantPointIds: string[],
  approvedIndexedDocumentVersionIds: number[]
): string[] {
  const approved = new Set(approvedIndexedDocumentVersionIds.map(String));
  return qdrantPointIds.filter((pointId) => !approved.has(pointId));
}

export function findStaleVectorRecords(
  rows: Array<{ documentVersionId: number; postgresContentHash: string; qdrantContentHash: string | null }>
): number[] {
  return rows
    .filter((row) => row.qdrantContentHash !== null && row.qdrantContentHash !== row.postgresContentHash)
    .map((row) => row.documentVersionId);
}

export {
  LOCAL_EMBEDDING_URL,
  LOCAL_QDRANT_URL,
  HISTORICAL_PROJECTS_QDRANT_COLLECTION
};
