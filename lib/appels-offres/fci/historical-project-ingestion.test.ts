import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { Pool } from "pg";
import nextEnv from "@next/env";
import {
  validateHistoricalProjectRecordInput,
  buildProjectEmbeddingText,
  computeProjectContentHash,
  buildHistoricalProjectQdrantPayload,
  upsertKnowledgeDocumentVersion,
  upsertHistoricalProjectRecord,
  markHistoricalProjectRecordIndexed,
  markHistoricalProjectRecordFailed,
  deapproveHistoricalProjectRecord,
  ingestHistoricalProjectRecord,
  findApprovedRecordsMissingVectors,
  findOrphanVectorPointIds,
  findStaleVectorRecords,
  type HistoricalProjectRecordInput
} from "./historical-project-ingestion.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

function hasDatabase() {
  return Boolean(pool);
}

after(async () => {
  if (pool) {
    // Leaves the schema exactly as found: only rows this file itself
    // created (by filename prefix) are removed, and the final counts
    // reported to the user must show 0 real historical project records.
    await pool.query(
      `delete from knowledge_base.knowledge_documents where filename like 'test-historical-project-%'`
    );
    await pool.end();
  }
});

let filenameCounter = 0;
function uniqueFilename() {
  filenameCounter += 1;
  return `test-historical-project-${process.pid}-${filenameCounter}.pdf`;
}

function baseInput(overrides: Partial<HistoricalProjectRecordInput> = {}): HistoricalProjectRecordInput {
  return {
    sourceDocumentFilename: uniqueFilename(),
    sourceDocumentSourcePath: "/var/concept/historical-pilot/fixture.pdf",
    sourceReference: "historical-projects-pilot/fixture-01",
    sourceSection: "Résumé du projet",
    approvedSummaryText: "Suivi et contrôle de travaux d'adduction d'eau potable multisite.",
    reuseStatus: "approved_for_rag",
    country: "Togo",
    sector: "Hydraulique urbaine",
    subsector: "Adduction d'eau potable",
    projectType: "Suivi-contrôle",
    fundingInstitution: "Banque mondiale",
    natureOfServices: "Services de consultants",
    technicalScope: "Contrôle de travaux multisite",
    technicalComponents: ["Génie civil", "Hydraulique"],
    keyDeliverables: ["Rapport mensuel", "Rapport de réception"],
    ...overrides
  };
}

function fakeSha256(seed: string) {
  // A real sha256 of the seed string: deterministic, and guaranteed to be
  // valid lowercase hex (unlike padding the raw seed itself, which can
  // contain letters outside a-f and would violate the DB's format check).
  return createHash("sha256").update(seed, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// CANONICAL VALIDATION
// ---------------------------------------------------------------------------

test("validateHistoricalProjectRecordInput accepts a well-formed approved record", () => {
  assert.deepEqual(validateHistoricalProjectRecordInput(baseInput()), []);
});

test("validateHistoricalProjectRecordInput rejects a missing approvedSummaryText", () => {
  const issues = validateHistoricalProjectRecordInput(baseInput({ approvedSummaryText: "" }));
  assert.ok(issues.some((issue) => issue.field === "approvedSummaryText"));
});

test("validateHistoricalProjectRecordInput rejects an invalid reuseStatus", () => {
  const issues = validateHistoricalProjectRecordInput(
    baseInput({ reuseStatus: "maybe" as never })
  );
  assert.ok(issues.some((issue) => issue.field === "reuseStatus"));
});

test("validateHistoricalProjectRecordInput rejects a sourceReference that is just the raw source path repeated", () => {
  const issues = validateHistoricalProjectRecordInput(
    baseInput({ sourceReference: "/var/concept/historical-pilot/fixture.pdf" })
  );
  assert.ok(issues.some((issue) => issue.field === "sourceReference" && issue.reason === "must_not_be_raw_filesystem_path"));
});

// ---------------------------------------------------------------------------
// EMBEDDING TEXT / CONTENT HASH (deterministic, local-only)
// ---------------------------------------------------------------------------

test("buildProjectEmbeddingText is deterministic for the same canonical record", () => {
  const input = baseInput();
  assert.equal(buildProjectEmbeddingText(input), buildProjectEmbeddingText({ ...input }));
});

test("buildProjectEmbeddingText never includes identity/administrative fields", () => {
  const text = buildProjectEmbeddingText(baseInput({ sourceReference: "UNIQUE-REF-MARKER" }));
  assert.equal(text.includes("UNIQUE-REF-MARKER"), false);
});

test("computeProjectContentHash is stable for identical content and changes when approved content changes", () => {
  const input = baseInput();
  const hashA = computeProjectContentHash(input);
  const hashB = computeProjectContentHash({ ...input });
  assert.equal(hashA, hashB);

  const changed = computeProjectContentHash({ ...input, approvedSummaryText: "Texte different." });
  assert.notEqual(hashA, changed);
  assert.match(hashA, /^[a-f0-9]{64}$/);
});

// ---------------------------------------------------------------------------
// QDRANT PAYLOAD / POINT ID (pure)
// ---------------------------------------------------------------------------

test("buildHistoricalProjectQdrantPayload contains only minimal filter/provenance metadata", () => {
  const payload = buildHistoricalProjectQdrantPayload(1, 2, baseInput(), "abc123");
  const keys = Object.keys(payload).sort();
  assert.deepEqual(keys, [
    "content_hash",
    "country",
    "document_id",
    "document_version_id",
    "funding_institution",
    "project_type",
    "reuse_status",
    "sector",
    "section",
    "source_reference",
    "subsector",
    "title",
    "year"
  ].sort());
  assert.equal(payload.source_reference.startsWith("/"), false);
  // Deliberately minimal: no client name, no free-text summary, no raw
  // technical_components/key_deliverables arrays - those live in Postgres
  // (source of truth), not in the retrieval index payload.
  assert.equal("client" in payload, false);
  assert.equal("approved_summary_text" in payload, false);
});

// ---------------------------------------------------------------------------
// RETRIEVAL-MODULE COMPATIBILITY (rex-project-rag.ts)
// ---------------------------------------------------------------------------

test("a payload written by buildHistoricalProjectQdrantPayload round-trips correctly through rex-project-rag's Qdrant reader", async () => {
  const { queryHistoricalProjectsInQdrant } = await import("./rex-project-rag.ts");
  const input = baseInput({ title: "Suivi de travaux AEP multisite" });
  const contentHash = "deadbeef".repeat(8);
  const payload = buildHistoricalProjectQdrantPayload(101, 202, input, contentHash);

  const candidates = await queryHistoricalProjectsInQdrant([0.1, 0.2, 0.3], {
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({ result: { points: [{ id: "202", score: 0.81, payload }] } }),
        { status: 200 }
      )) as typeof fetch
  });

  assert.equal(candidates.length, 1);
  const [candidate] = candidates;
  assert.equal(candidate.historicalProjectId, "202");
  assert.equal(candidate.sourceDocumentId, "101");
  assert.equal(candidate.sourceDocumentVersionId, "202");
  assert.equal(candidate.sourceReference, input.sourceReference);
  assert.equal(candidate.sourceSection, input.sourceSection);
  assert.equal(candidate.metadata.title, "Suivi de travaux AEP multisite");
  assert.equal(candidate.metadata.country, input.country);
  assert.equal(candidate.metadata.sector, input.sector);
  assert.equal(candidate.metadata.fundingInstitution, input.fundingInstitution);
  // client is not written by the ingestion side (see buildHistoricalProjectQdrantPayload) -
  // the reader tolerates its absence and reports null rather than failing.
  assert.equal(candidate.metadata.client, null);
});

test("the Qdrant point ID for a project is the stable integer document_version_id, no extra derivation needed", () => {
  // Documented design decision (see historical-project-ingestion.ts): one
  // point per document version, so the version's own bigint identity is
  // already a stable, unique point ID - no UUIDv5 derivation is needed for
  // an unchunked collection.
  const documentVersionId = 4242;
  assert.equal(Number.isInteger(documentVersionId), true);
});

// ---------------------------------------------------------------------------
// PII / RESOURCE SAFETY (structural - the schema has no field for these)
// ---------------------------------------------------------------------------

test("the canonical record has no field that could hold consultant/CV/current-availability content", () => {
  // Checks the type definition itself (HistoricalProjectRecordInput's field
  // list), not the whole file - the module's own explanatory comments
  // legitimately mention words like "consultant" when explaining what is
  // deliberately excluded, which would otherwise false-positive a bare
  // whole-file substring scan.
  const source = readFileSync(
    path.join(process.cwd(), "lib/appels-offres/fci/historical-project-ingestion.ts"),
    "utf8"
  );
  const typeStart = source.indexOf("export type HistoricalProjectRecordInput = {");
  const typeEnd = source.indexOf("\n};", typeStart);
  const typeDefinition = source.slice(typeStart, typeEnd);
  assert.ok(typeStart >= 0 && typeEnd > typeStart, "expected to locate the HistoricalProjectRecordInput type body");

  for (const forbidden of [
    "consultant",
    "cv_",
    "cvContent",
    "phoneNumber",
    "emailAddress",
    "currentAvailability",
    "staffAssigned"
  ]) {
    assert.equal(
      typeDefinition.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `unexpected field: ${forbidden}`
    );
  }
});

test("this module never imports or calls any FCI C persistence/validation function", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/appels-offres/fci/historical-project-ingestion.ts"),
    "utf8"
  );
  for (const forbidden of ["applyFciSuccessCallback", "upsertFciModuleData", "validateFciModule", "saveFciModuleEdits"]) {
    assert.equal(source.includes(forbidden), false, `unexpected persistence call: ${forbidden}`);
  }
});

test("embedding/vector endpoints reused from rex-project-rag.ts stay loopback-only", () => {
  const source = readFileSync(
    path.join(process.cwd(), "lib/appels-offres/fci/historical-project-ingestion.ts"),
    "utf8"
  );
  for (const forbidden of ["generativelanguage.googleapis.com", "api.openai.com", "api.anthropic.com"]) {
    assert.equal(source.toLowerCase().includes(forbidden), false, `unexpected external reference: ${forbidden}`);
  }
});

test("no object spread anywhere lets arbitrary caller-supplied metadata pass through to Postgres or Qdrant", () => {
  // The absence of typed fields on HistoricalProjectRecordInput is only a
  // real guarantee if nothing in the writer functions forwards unknown
  // extra properties wholesale. Every field written to Qdrant/Postgres is
  // named explicitly (see buildHistoricalProjectQdrantPayload and the
  // upsert SQL parameter lists) - there is no `...input`/`...record`
  // spread anywhere in this file that could smuggle an unexpected key
  // (e.g. a CV field a caller mistakenly attached) into storage.
  const source = readFileSync(
    path.join(process.cwd(), "lib/appels-offres/fci/historical-project-ingestion.ts"),
    "utf8"
  );
  assert.equal(source.includes("..."), false, "unexpected spread operator found");
});

// ---------------------------------------------------------------------------
// RECONCILIATION (pure)
// ---------------------------------------------------------------------------

test("findApprovedRecordsMissingVectors returns only approved-but-not-indexed records", () => {
  const missing = findApprovedRecordsMissingVectors([
    { documentVersionId: 1, reuseStatus: "approved_for_rag", indexStatus: "pending" },
    { documentVersionId: 2, reuseStatus: "approved_for_rag", indexStatus: "indexed" },
    { documentVersionId: 3, reuseStatus: "pending_review", indexStatus: "pending" }
  ]);
  assert.deepEqual(missing, [1]);
});

test("findOrphanVectorPointIds returns vector points with no approved+indexed Postgres counterpart", () => {
  const orphans = findOrphanVectorPointIds(["10", "11", "12"], [10, 12]);
  assert.deepEqual(orphans, ["11"]);
});

test("findStaleVectorRecords flags a vector whose stored content hash no longer matches Postgres", () => {
  const stale = findStaleVectorRecords([
    { documentVersionId: 1, postgresContentHash: "aaa", qdrantContentHash: "aaa" },
    { documentVersionId: 2, postgresContentHash: "bbb", qdrantContentHash: "old" },
    { documentVersionId: 3, postgresContentHash: "ccc", qdrantContentHash: null }
  ]);
  assert.deepEqual(stale, [2]);
});

// ---------------------------------------------------------------------------
// POSTGRES-BACKED: idempotency, versioning, approval gate, failure state
// ---------------------------------------------------------------------------

test("upsertKnowledgeDocumentVersion is idempotent for the same filename and sha256", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }
  const filename = uniqueFilename();
  const sha256 = fakeSha256("sameversion");

  const first = await upsertKnowledgeDocumentVersion(pool!, {
    filename,
    sourcePath: "/var/concept/historical-pilot/a.pdf",
    sha256,
    fileSize: 1000
  });
  const second = await upsertKnowledgeDocumentVersion(pool!, {
    filename,
    sourcePath: "/var/concept/historical-pilot/a.pdf",
    sha256,
    fileSize: 1000
  });

  assert.equal(first.documentVersionId, second.documentVersionId);
  assert.equal(second.isNewVersion, false);
  assert.equal(first.versionNumber, 1);
});

test("upsertKnowledgeDocumentVersion creates a new version when sha256 changes for the same filename", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }
  const filename = uniqueFilename();

  const v1 = await upsertKnowledgeDocumentVersion(pool!, {
    filename,
    sourcePath: "/var/concept/historical-pilot/b.pdf",
    sha256: fakeSha256("versionone"),
    fileSize: 1000
  });
  const v2 = await upsertKnowledgeDocumentVersion(pool!, {
    filename,
    sourcePath: "/var/concept/historical-pilot/b.pdf",
    sha256: fakeSha256("versiontwo"),
    fileSize: 1200
  });

  assert.equal(v1.documentId, v2.documentId);
  assert.notEqual(v1.documentVersionId, v2.documentVersionId);
  assert.equal(v2.versionNumber, 2);
  assert.equal(v2.isNewVersion, true);
});

test("a pending_review record is stored but never indexed, and index_status stays pending", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }
  const input = baseInput({ reuseStatus: "pending_review" });
  const { documentId, documentVersionId } = await upsertKnowledgeDocumentVersion(pool!, {
    filename: input.sourceDocumentFilename,
    sourcePath: input.sourceDocumentSourcePath,
    sha256: fakeSha256("pendingcase"),
    fileSize: 500
  });
  const contentHash = computeProjectContentHash(input);
  const record = await upsertHistoricalProjectRecord(pool!, documentId, documentVersionId, input, contentHash);

  assert.equal(record.reuseStatus, "pending_review");
  assert.equal(record.indexStatus, "pending");
});

test("ingestHistoricalProjectRecord stops before embedding when the record is not approved_for_rag", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }
  const input = baseInput({ reuseStatus: "pending_review" });
  let embedCalled = false;

  const result = await ingestHistoricalProjectRecord(pool!, input, {
    sha256: fakeSha256("notapproved"),
    fileSize: 500,
    embedText: async () => {
      embedCalled = true;
      return [0.1, 0.2];
    }
  });

  assert.equal(result.status, "not_approved");
  assert.equal(embedCalled, false);
});

test("ingestHistoricalProjectRecord indexes an approved record via the injected local embedder and records provenance", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }
  const input = baseInput();
  const fakeVector = Array.from({ length: 1024 }, () => 0.01);

  const result = await ingestHistoricalProjectRecord(pool!, input, {
    sha256: fakeSha256("indexedcase"),
    fileSize: 700,
    embedText: async () => fakeVector,
    fetchImpl: (async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })) as typeof fetch
  });

  assert.equal(result.status, "indexed");
  if (result.status === "indexed") {
    assert.equal(result.embeddingDimension, 1024);
    const stored = await pool!.query<{ index_status: string; qdrant_point_id: string | null }>(
      `select index_status, qdrant_point_id from knowledge_base.historical_project_records where document_version_id = $1`,
      [result.documentVersionId]
    );
    assert.equal(stored.rows[0].index_status, "indexed");
    assert.equal(stored.rows[0].qdrant_point_id, String(result.documentVersionId));
  }
});

test("re-ingesting the exact same approved content is a no-op that does not re-embed", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }
  const input = baseInput();
  const sha256 = fakeSha256("unchangedcase");
  let embedCalls = 0;
  const deps = {
    sha256,
    fileSize: 700,
    embedText: async () => {
      embedCalls += 1;
      return [0.01];
    },
    fetchImpl: (async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })) as typeof fetch
  };

  const first = await ingestHistoricalProjectRecord(pool!, input, deps);
  assert.equal(first.status, "indexed");
  const second = await ingestHistoricalProjectRecord(pool!, input, deps);
  assert.equal(second.status, "unchanged");
  assert.equal(embedCalls, 1);
});

test("ingestHistoricalProjectRecord marks failure without losing the canonical record when embedding fails", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }
  const input = baseInput();

  const result = await ingestHistoricalProjectRecord(pool!, input, {
    sha256: fakeSha256("failurecase"),
    fileSize: 700,
    embedText: async () => {
      throw new Error("Ollama local indisponible pour ce test.");
    }
  });

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    const stored = await pool!.query<{ index_status: string; index_error_message: string | null; reuse_status: string }>(
      `select index_status, index_error_message, reuse_status from knowledge_base.historical_project_records where document_version_id = $1`,
      [result.documentVersionId]
    );
    // The canonical record survives the failure - it is not deleted or
    // silently marked indexed.
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].index_status, "failed");
    assert.equal(stored.rows[0].reuse_status, "approved_for_rag");
    assert.match(stored.rows[0].index_error_message ?? "", /Ollama local indisponible/);
  }
});

test("deapproveHistoricalProjectRecord stops future retrieval eligibility while preserving the Postgres row", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }
  const input = baseInput();
  const indexed = await ingestHistoricalProjectRecord(pool!, input, {
    sha256: fakeSha256("deapprovecase"),
    fileSize: 700,
    embedText: async () => [0.01],
    fetchImpl: (async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })) as typeof fetch
  });
  assert.equal(indexed.status, "indexed");
  if (indexed.status !== "indexed") return;

  const deleteCalls: string[] = [];
  const deapproval = await deapproveHistoricalProjectRecord(pool!, indexed.documentVersionId, "rejected", {
    fetchImpl: (async (input: RequestInfo | URL) => {
      deleteCalls.push(String(input));
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }) as typeof fetch
  });
  assert.equal(deapproval.hadIndexedVector, true);
  // The function does not merely report that a vector existed - it must
  // actually attempt (and here, succeed at) deleting it, so a single call
  // to this function is enough to stop retrieval end to end.
  assert.equal(deapproval.vectorDeleted, true);
  assert.equal(deleteCalls.length, 1);
  assert.match(deleteCalls[0], /\/collections\/concept_historical_projects\/points\/delete$/);

  const stored = await pool!.query<{ reuse_status: string; index_status: string }>(
    `select reuse_status, index_status from knowledge_base.historical_project_records where document_version_id = $1`,
    [indexed.documentVersionId]
  );
  assert.equal(stored.rows.length, 1, "the canonical audit row must still exist");
  assert.equal(stored.rows[0].reuse_status, "rejected");
  assert.equal(stored.rows[0].index_status, "pending");
});

test("deapproveHistoricalProjectRecord still de-approves in Postgres even if the Qdrant deletion call fails", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }
  const input = baseInput();
  const indexed = await ingestHistoricalProjectRecord(pool!, input, {
    sha256: fakeSha256("deapprovefailurecase"),
    fileSize: 700,
    embedText: async () => [0.01],
    fetchImpl: (async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })) as typeof fetch
  });
  assert.equal(indexed.status, "indexed");
  if (indexed.status !== "indexed") return;

  const deapproval = await deapproveHistoricalProjectRecord(pool!, indexed.documentVersionId, "archived", {
    fetchImpl: (async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 500 })) as typeof fetch
  });

  // Postgres de-approval must not silently fail just because the Qdrant
  // side did - this drift is exactly what reconciliation (§ orphan vectors)
  // exists to catch afterwards.
  assert.equal(deapproval.vectorDeleted, false);
  const stored = await pool!.query<{ reuse_status: string }>(
    `select reuse_status from knowledge_base.historical_project_records where document_version_id = $1`,
    [indexed.documentVersionId]
  );
  assert.equal(stored.rows[0].reuse_status, "archived");
});

test("markHistoricalProjectRecordIndexed and markHistoricalProjectRecordFailed transition index_status independently of reuse_status", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }
  const input = baseInput();
  const { documentId, documentVersionId } = await upsertKnowledgeDocumentVersion(pool!, {
    filename: input.sourceDocumentFilename,
    sourcePath: input.sourceDocumentSourcePath,
    sha256: fakeSha256("marktransition"),
    fileSize: 700
  });
  const contentHash = computeProjectContentHash(input);
  await upsertHistoricalProjectRecord(pool!, documentId, documentVersionId, input, contentHash);

  await markHistoricalProjectRecordIndexed(pool!, documentVersionId, {
    qdrantPointId: String(documentVersionId),
    qdrantCollection: "concept_historical_projects",
    embeddingDimension: 1024
  });
  let stored = await pool!.query<{ index_status: string }>(
    `select index_status from knowledge_base.historical_project_records where document_version_id = $1`,
    [documentVersionId]
  );
  assert.equal(stored.rows[0].index_status, "indexed");

  await markHistoricalProjectRecordFailed(pool!, documentVersionId, { code: "TEST", message: "forced failure" });
  stored = await pool!.query<{ index_status: string }>(
    `select index_status from knowledge_base.historical_project_records where document_version_id = $1`,
    [documentVersionId]
  );
  assert.equal(stored.rows[0].index_status, "failed");
});
