import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildLocalFciMessages,
  containsFinalDecisionLanguage,
  evaluateLocalFciPayload,
  LOCAL_FCI_OLLAMA_URL,
  requestLocalFci
} from "./local-benchmark.ts";

const field = (value: unknown, source_type = "internal_required", requires_human_input = true, excerpt: string | null = null) => ({
  value,
  source_type,
  confidence: value == null ? "none" : "high",
  requires_human_input,
  justification: "synthetic",
  source_references: excerpt ? [{ section: "synthetic", field: "fact", excerpt }] : []
});

test("benchmark endpoint is fixed to loopback Ollama and messages contain no fallback", () => {
  assert.equal(new URL(LOCAL_FCI_OLLAMA_URL).hostname, "127.0.0.1");
  const messages = buildLocalFciMessages({
    moduleCode: "B",
    moduleType: "finance",
    promptText: "synthetic prompt",
    schemaVersion: "1.0",
    schemaJson: {},
    sourceFiche: {},
    ficheCdc: {}
  });
  const serialized = JSON.stringify(messages).toLowerCase();
  assert.equal(serialized.includes("gemini"), false);
  assert.equal(serialized.includes("fallback"), false);
});

test("local failure makes one loopback request and has no provider fallback", async () => {
  let calls = 0;
  const failingFetch = (async (input: string | URL | Request) => {
    calls += 1;
    assert.equal(new URL(String(input)).hostname, "127.0.0.1");
    return new Response("local failure", { status: 503 });
  }) as typeof fetch;
  await assert.rejects(requestLocalFci({}, failingFetch), /Ollama local.*503/);
  assert.equal(calls, 1);
});

test("benchmark runner has no official persistence, callback, notification, or n8n dependency", () => {
  const source = readFileSync("scripts/rag/benchmark_local_fci.ts", "utf8");
  for (const forbidden of [
    "repository.ts",
    "service.ts",
    "notifications/",
    "callbacks/",
    "n8n",
    "DATABASE_URL",
    "GEMINI"
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("internal finance and operations claims are counted as violations", () => {
  const finance = evaluateLocalFciPayload("B", { data: { elements_financiers_internes: {
    taux_de_change_applique_et_source: field("invented", "ai_inference", false)
  } } }, {});
  assert.equal(finance.internalClaimViolations, 1);
  const operations = evaluateLocalFciPayload("C", { data: { row: {
    quantite_disponible: field("invented", "ai_inference", false)
  } } }, {});
  assert.equal(operations.internalClaimViolations, 1);
});

test("missing internal values remain human-required and grounded excerpts pass", () => {
  const metrics = evaluateLocalFciPayload("A", { data: {
    prepare_par: field(null),
    intitule_offre: field("Mission synthetic", "fiche_cdc", false, "Mission synthetic")
  } }, { title: "Mission synthetic" });
  assert.equal(metrics.humanRequired, 1);
  assert.equal(metrics.unsupportedClaims, 0);
});

test("unsupported source claims and final decision language are rejected by metrics", () => {
  const payload = { data: { x: field("fabricated", "fiche_cdc", false, "absent excerpt") }, ai_notes: ["Recommandation: GO"] };
  const metrics = evaluateLocalFciPayload("B", payload, { fact: "different" });
  assert.equal(metrics.unsupportedClaims, 1);
  assert.equal(metrics.decisionLeakage, true);
  assert.equal(containsFinalDecisionLanguage({ note: "NO-GO" }), true);
});
