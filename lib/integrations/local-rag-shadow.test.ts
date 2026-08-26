import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalRagShadowIdempotencyKey,
  executeLocalRagShadow,
  getLocalRagShadowConfig,
  isLocalRagShadowEnabled,
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

test("legacy shadow flag cannot trigger a post-cutover request", async () => {
  const previous = process.env.LOCAL_RAG_SHADOW_ENABLED;
  process.env.LOCAL_RAG_SHADOW_ENABLED = "true";
  let calls = 0;
  try {
    const result = await executeLocalRagShadow(identity, {
      fetchImpl: async () => { calls += 1; return new Response(); }
    });
    assert.equal(isLocalRagShadowEnabled(), false);
    assert.equal(getLocalRagShadowConfig().enabled, false);
    assert.equal(calls, 0);
    assert.deepEqual(result, { status: "DISABLED" });
  } finally {
    if (previous === undefined) delete process.env.LOCAL_RAG_SHADOW_ENABLED;
    else process.env.LOCAL_RAG_SHADOW_ENABLED = previous;
  }
});

test("idempotency key still binds tender, document, and hash", () => {
  const first = buildLocalRagShadowIdempotencyKey(identity);
  assert.equal(first, buildLocalRagShadowIdempotencyKey(identity));
  assert.notEqual(first, buildLocalRagShadowIdempotencyKey({ ...identity, appelOffreId: 102 }));
  assert.notEqual(first, buildLocalRagShadowIdempotencyKey({ ...identity, documentId: 203 }));
  assert.notEqual(first, buildLocalRagShadowIdempotencyKey({ ...identity, documentHash: `sha256:${"b".repeat(64)}` }));
});
