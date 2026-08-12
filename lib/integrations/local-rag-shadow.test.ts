import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalRagShadowIdempotencyKey,
  executeLocalRagShadow,
  getLocalRagShadowConfig,
  isLocalRagShadowEnabled,
  type LocalRagShadowArtifact,
  type LocalRagShadowIdentity
} from "./local-rag-shadow.ts";

const identity: LocalRagShadowIdentity = {
  appelOffreId: 101,
  codeInterne: "AO-SHADOW-TEST",
  documentId: 202,
  documentHash: `sha256:${"a".repeat(64)}`,
  markdownPath: "/tmp/AO-SHADOW-TEST/cdc.md",
  processingJobId: "job_shadow",
  correlationId: "corr_shadow",
  authoritativeXml: "<fiche_projet />"
};

function withShadowEnv<T>(callback: () => Promise<T> | T) {
  const previous = {
    enabled: process.env.LOCAL_RAG_SHADOW_ENABLED,
    token: process.env.LOCAL_RAG_SERVICE_TOKEN,
    timeout: process.env.LOCAL_RAG_SHADOW_TIMEOUT_MS
  };
  process.env.LOCAL_RAG_SHADOW_ENABLED = "true";
  process.env.LOCAL_RAG_SERVICE_TOKEN = "test-token";
  process.env.LOCAL_RAG_SHADOW_TIMEOUT_MS = "120000";
  return Promise.resolve(callback()).finally(() => {
    if (previous.enabled === undefined) delete process.env.LOCAL_RAG_SHADOW_ENABLED;
    else process.env.LOCAL_RAG_SHADOW_ENABLED = previous.enabled;
    if (previous.token === undefined) delete process.env.LOCAL_RAG_SERVICE_TOKEN;
    else process.env.LOCAL_RAG_SERVICE_TOKEN = previous.token;
    if (previous.timeout === undefined) delete process.env.LOCAL_RAG_SHADOW_TIMEOUT_MS;
    else process.env.LOCAL_RAG_SHADOW_TIMEOUT_MS = previous.timeout;
  });
}

test("shadow is disabled by default and makes no request", async () => {
  const previous = process.env.LOCAL_RAG_SHADOW_ENABLED;
  delete process.env.LOCAL_RAG_SHADOW_ENABLED;
  let calls = 0;
  const result = await executeLocalRagShadow(identity, {
    fetchImpl: async () => { calls += 1; return new Response(); }
  });
  assert.equal(isLocalRagShadowEnabled(), false);
  assert.equal(getLocalRagShadowConfig().enabled, false);
  assert.equal(calls, 0);
  assert.deepEqual(result, { status: "DISABLED" });
  if (previous !== undefined) process.env.LOCAL_RAG_SHADOW_ENABLED = previous;
});

test("Gemini success plus local success stores a separate 34-field comparison", () => withShadowEnv(async () => {
  const persisted: LocalRagShadowArtifact[] = [];
  const comparison = { fields_total: 34, exact_matches: 10, normalized_matches: 5, differences: 10, gemini_only: 3, local_only: 2, both_null: 4 };
  const result = await executeLocalRagShadow(identity, {
    fetchImpl: async () => Response.json({
      comparison,
      local_metrics: { chunk_count: 42, embedding_ms: 1, retrieval_ms: 2, generation_ms: 3, total_ms: 6 },
      local_model: "qwen3:14b",
      embedding_model: "qwen3-embedding:0.6b"
    }),
    persist: async (artifact) => { persisted.push(artifact); }
  });
  assert.equal(result.status, "SUCCESS");
  assert.equal(persisted[0].authoritative_persisted, true);
  assert.equal(persisted[0].official_state_mutated_by_shadow, false);
  assert.deepEqual(persisted[0].comparison, comparison);
  assert.equal(persisted[0].metrics?.fields_total, 34);
  assert.equal(persisted[0].metrics?.node_count, 42);
}));

test("local timeout is recorded and does not throw into the official flow", () => withShadowEnv(async () => {
  process.env.LOCAL_RAG_SHADOW_TIMEOUT_MS = "1";
  const persisted: LocalRagShadowArtifact[] = [];
  const result = await executeLocalRagShadow(identity, {
    fetchImpl: async (_url, init) => {
      await new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
      return new Response();
    },
    persist: async (artifact) => { persisted.push(artifact); }
  });
  assert.equal(result.status, "TIMEOUT");
  assert.equal(persisted[0].status, "TIMEOUT");
}));

test("local validation failure is recorded without changing authoritative state", () => withShadowEnv(async () => {
  const persisted: LocalRagShadowArtifact[] = [];
  const result = await executeLocalRagShadow(identity, {
    fetchImpl: async () => Response.json({ code: "LOCAL_VALIDATION_FAILED", error: "invalid" }, { status: 422 }),
    persist: async (artifact) => { persisted.push(artifact); }
  });
  assert.equal(result.status, "VALIDATION_FAILED");
  assert.equal(persisted[0].local_validation_status, "VALIDATION_FAILED");
  assert.equal(persisted[0].official_state_mutated_by_shadow, false);
}));

test("unavailable local service remains fail-open", () => withShadowEnv(async () => {
  const result = await executeLocalRagShadow(identity, {
    fetchImpl: async () => { throw new TypeError("fetch failed"); },
    persist: async () => undefined
  });
  assert.equal(result.status, "SERVICE_UNAVAILABLE");
}));

test("request contains exact identity and authoritative XML but no mutation callback", () => withShadowEnv(async () => {
  let requestBody: Record<string, unknown> = {};
  await executeLocalRagShadow(identity, {
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ comparison: { fields_total: 34 }, local_metrics: {} });
    },
    persist: async () => undefined
  });
  assert.equal(requestBody.appel_offre_id, identity.appelOffreId);
  assert.equal(requestBody.document_id, identity.documentId);
  assert.equal(requestBody.markdown_content_hash, identity.documentHash);
  assert.equal(requestBody.authoritative_xml, identity.authoritativeXml);
  assert.equal("fiche_status" in requestBody, false);
  assert.equal("fci" in requestBody, false);
}));

test("idempotency and isolation keys bind tender, document, and hash", () => {
  const first = buildLocalRagShadowIdempotencyKey(identity);
  assert.equal(first, buildLocalRagShadowIdempotencyKey(identity));
  assert.notEqual(first, buildLocalRagShadowIdempotencyKey({ ...identity, appelOffreId: 102 }));
  assert.notEqual(first, buildLocalRagShadowIdempotencyKey({ ...identity, documentId: 203 }));
  assert.notEqual(first, buildLocalRagShadowIdempotencyKey({ ...identity, documentHash: `sha256:${"b".repeat(64)}` }));
});
