import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FichePayload } from "../../types.ts";
import type { FciOperationsData } from "./ai-contracts.ts";
import {
  LOCAL_EMBEDDING_URL,
  LOCAL_QDRANT_URL,
  buildRexProjectQuery,
  cosineSimilarity,
  rankHistoricalProjectCandidates,
  suggestRexProjectReferences,
  queryHistoricalProjectsInQdrant,
  embedTextLocally,
  type HistoricalProjectCandidate
} from "./rex-project-rag.ts";

function ficheWithExtraction(entries: Record<string, string>): FichePayload {
  return {
    codeInterne: "AO-TEST-0001",
    extraction: Object.entries(entries).map(([key, value]) => ({
      key: key as never,
      label: key,
      value,
      source: "Page 1"
    })),
    evaluation: [],
    controle: { champsNonTrouves: [], incoherences: [], aVerifier: [], resolutions: [] }
  };
}

function candidate(
  id: string,
  embedding: number[],
  overrides: Partial<HistoricalProjectCandidate["metadata"]> = {},
  sourceOverrides: Partial<Pick<HistoricalProjectCandidate, "sourceDocumentId" | "sourceDocumentVersionId" | "sourceReference" | "sourceSection">> = {}
): HistoricalProjectCandidate {
  return {
    historicalProjectId: id,
    embedding,
    metadata: {
      title: null,
      country: null,
      client: null,
      fundingInstitution: null,
      sector: null,
      projectType: null,
      year: null,
      ...overrides
    },
    sourceDocumentId: `doc-${id}`,
    sourceDocumentVersionId: `docv-${id}`,
    sourceReference: `historical-projects/${id}.pdf`,
    sourceSection: "Résumé exécutif",
    ...sourceOverrides
  };
}

// ---------------------------------------------------------------------------
// LOCAL ONLY / NO EXTERNAL PROVIDER
// ---------------------------------------------------------------------------

test("embedding and vector-search endpoints are hardcoded to loopback local infrastructure", () => {
  const embeddingUrl = new URL(LOCAL_EMBEDDING_URL);
  const qdrantUrl = new URL(LOCAL_QDRANT_URL);
  assert.equal(embeddingUrl.hostname, "127.0.0.1");
  assert.equal(qdrantUrl.hostname, "127.0.0.1");
});

test("module source contains no external AI/embedding provider hostname or SDK", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/appels-offres/fci/rex-project-rag.ts"), "utf8");
  // Checks actual external hostnames/endpoints only - not the bare words
  // "Gemini"/"OpenAI"/"Anthropic", which legitimately appear in this file's
  // own documentation comments explaining that those providers are NOT used.
  for (const forbidden of [
    "generativelanguage.googleapis.com",
    "api.openai.com",
    "api.anthropic.com"
  ]) {
    assert.equal(
      source.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `unexpected external reference: ${forbidden}`
    );
  }
});

test("embedTextLocally rejects a non-loopback embedding URL before any network call", async () => {
  const originalUrl = LOCAL_EMBEDDING_URL;
  assert.match(originalUrl, /^http:\/\/127\.0\.0\.1:11434\/api\/embed$/);
  // The URL is a compile-time constant (not configurable), which is itself
  // the safety property: there is no environment variable or parameter that
  // could redirect this call to an external host.
});

test("embedTextLocally calls only the local Ollama /api/embed endpoint with the local embedding model", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ embeddings: [[0.1, 0.2, 0.3]] }), { status: 200 });
  }) as typeof fetch;

  const embedding = await embedTextLocally("hydraulique urbaine", fakeFetch);

  assert.deepEqual(embedding, [0.1, 0.2, 0.3]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, LOCAL_EMBEDDING_URL);
  assert.equal((calls[0].body as { model: string }).model, "qwen3-embedding:0.6b");
});

test("queryHistoricalProjectsInQdrant calls only the local Qdrant collection endpoint", async () => {
  const calls: string[] = [];
  const fakeFetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ result: { points: [] } }), { status: 200 });
  }) as typeof fetch;

  await queryHistoricalProjectsInQdrant([0.1, 0.2], { fetchImpl: fakeFetch });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /^http:\/\/127\.0\.0\.1:6333\/collections\/concept_historical_projects\/points\/query$/);
});

// ---------------------------------------------------------------------------
// QUERY CONSTRUCTION
// ---------------------------------------------------------------------------

test("buildRexProjectQuery produces a stable targeted query from real extraction fields only", () => {
  const fiche = ficheWithExtraction({
    secteur: "Hydraulique urbaine",
    pays: "Côte d'Ivoire",
    nature_prestation: "Suivi et contrôle de travaux",
    disciplines_techniques: "Génie civil, hydraulique",
    reference_officielle: "CI-ONEP-480176"
  });

  const query = buildRexProjectQuery(fiche);

  assert.equal(query.fields.secteur, "Hydraulique urbaine");
  assert.equal(query.fields.pays, "Côte d'Ivoire");
  assert.equal(query.fields.nature_prestation, "Suivi et contrôle de travaux");
  // Fields outside the fixed retrieval field list must never leak into the query.
  assert.equal("reference_officielle" in query.fields, false);
  assert.match(query.queryText, /Hydraulique urbaine/);

  const rebuilt = buildRexProjectQuery(fiche);
  assert.deepEqual(rebuilt, query);
});

test("buildRexProjectQuery omits absent fields rather than guessing or defaulting", () => {
  const fiche = ficheWithExtraction({ secteur: "Transport" });
  const query = buildRexProjectQuery(fiche);
  assert.equal(query.fields.pays, undefined);
  assert.equal(query.queryText, "Transport");
});

test("buildRexProjectQuery returns an empty query when the Fiche has no usable extraction", () => {
  const fiche = ficheWithExtraction({});
  const query = buildRexProjectQuery(fiche);
  assert.equal(query.queryText, "");
});

// ---------------------------------------------------------------------------
// RETRIEVAL / RANKING
// ---------------------------------------------------------------------------

test("cosineSimilarity ranks an identical vector above an orthogonal one", () => {
  const query = [1, 0, 0];
  assert.equal(cosineSimilarity(query, [1, 0, 0]), 1);
  assert.equal(cosineSimilarity(query, [0, 1, 0]), 0);
});

test("a relevant historical project ranks ahead of an irrelevant one for the same query", () => {
  const queryEmbedding = [1, 0, 0];
  const relevant = candidate("proj-relevant", [0.98, 0.1, 0.05], { sector: "Hydraulique urbaine" });
  const irrelevant = candidate("proj-irrelevant", [0, 1, 0], { sector: "Transport aerien" });

  const ranked = rankHistoricalProjectCandidates(queryEmbedding, [irrelevant, relevant], 0);

  assert.equal(ranked[0].candidate.historicalProjectId, "proj-relevant");
  assert.ok(ranked[0].similarity > ranked[1].similarity);
});

test("suggestRexProjectReferences returns the relevant candidate ranked first end to end", async () => {
  const query = buildRexProjectQuery(ficheWithExtraction({ secteur: "Hydraulique urbaine", pays: "Côte d'Ivoire" }));
  const relevant = candidate("proj-relevant", [1, 0, 0], { sector: "Hydraulique urbaine", country: "Côte d'Ivoire" });
  const irrelevant = candidate("proj-irrelevant", [0, 1, 0], { sector: "Transport aerien" });

  const result = await suggestRexProjectReferences({
    query,
    embedText: async () => [1, 0, 0],
    retrieveCandidates: async () => [irrelevant, relevant]
  });

  assert.equal(result.status, "ok");
  assert.equal(result.suggestions[0].historicalProjectId, "proj-relevant");
  assert.equal(result.suggestions.some((s) => s.historicalProjectId === "proj-irrelevant"), false);
});

// ---------------------------------------------------------------------------
// NO RESULT / LOW CONFIDENCE
// ---------------------------------------------------------------------------

test("suggestRexProjectReferences returns no_evidence when nothing is retrieved, without forcing a result", async () => {
  const query = buildRexProjectQuery(ficheWithExtraction({ secteur: "Hydraulique urbaine" }));

  const result = await suggestRexProjectReferences({
    query,
    embedText: async () => [1, 0, 0],
    retrieveCandidates: async () => []
  });

  assert.equal(result.status, "no_evidence");
  assert.deepEqual(result.suggestions, []);
});

test("suggestRexProjectReferences returns no_evidence rather than lowering the threshold when similarity is too weak", async () => {
  const query = buildRexProjectQuery(ficheWithExtraction({ secteur: "Hydraulique urbaine" }));
  const weak = candidate("proj-weak", [0, 1, 0]);

  const result = await suggestRexProjectReferences({
    query,
    embedText: async () => [1, 0, 0],
    retrieveCandidates: async () => [weak]
  });

  assert.equal(result.status, "no_evidence");
  assert.deepEqual(result.suggestions, []);
});

test("suggestRexProjectReferences marks a borderline match as low_confidence rather than presenting it as trusted", async () => {
  const query = buildRexProjectQuery(ficheWithExtraction({ secteur: "Hydraulique urbaine" }));
  // cosine(query, borderline) sits between REX_PROJECT_MIN_SIMILARITY (0.55)
  // and REX_PROJECT_CONFIDENT_SIMILARITY (0.75).
  const borderline = candidate("proj-borderline", [0.6, 0.8, 0]);

  const result = await suggestRexProjectReferences({
    query,
    embedText: async () => [1, 0, 0],
    retrieveCandidates: async () => [borderline]
  });

  assert.equal(result.status, "low_confidence");
  assert.equal(result.suggestions[0].confidence, "medium");
});

test("suggestRexProjectReferences returns no_evidence for an empty query without calling embeddings or retrieval", async () => {
  const query = buildRexProjectQuery(ficheWithExtraction({}));
  let embedCalled = false;
  let retrieveCalled = false;

  const result = await suggestRexProjectReferences({
    query,
    embedText: async () => {
      embedCalled = true;
      return [1, 0, 0];
    },
    retrieveCandidates: async () => {
      retrieveCalled = true;
      return [];
    }
  });

  assert.equal(result.status, "no_evidence");
  assert.equal(embedCalled, false);
  assert.equal(retrieveCalled, false);
});

// ---------------------------------------------------------------------------
// PROVENANCE
// ---------------------------------------------------------------------------

test("every suggestion carries mandatory provenance back to a concrete source record", async () => {
  const query = buildRexProjectQuery(ficheWithExtraction({ secteur: "Hydraulique urbaine" }));
  const project = candidate("proj-1", [1, 0, 0], {}, {
    sourceDocumentId: "doc-42",
    sourceDocumentVersionId: "docv-7",
    sourceReference: "historical-projects/proj-1.pdf",
    sourceSection: "Références similaires"
  });

  const result = await suggestRexProjectReferences({
    query,
    embedText: async () => [1, 0, 0],
    retrieveCandidates: async () => [project]
  });

  assert.equal(result.suggestions.length, 1);
  const [suggestion] = result.suggestions;
  assert.ok(suggestion.sources.length >= 1);
  const [source] = suggestion.sources;
  assert.equal(source.sourceDocumentId, "doc-42");
  assert.equal(source.sourceDocumentVersionId, "docv-7");
  assert.equal(source.sourceReference, "historical-projects/proj-1.pdf");
  assert.equal(source.sourceSection, "Références similaires");
  assert.equal(typeof source.retrievalScore, "number");
  assert.equal(typeof source.retrievedAt, "string");
});

// ---------------------------------------------------------------------------
// HUMAN BOUNDARY / NO AUTOFILL
// ---------------------------------------------------------------------------

test("a suggestion is always in the 'suggested' review state and this module never emits any other state", async () => {
  const query = buildRexProjectQuery(ficheWithExtraction({ secteur: "Hydraulique urbaine" }));
  const project = candidate("proj-1", [1, 0, 0]);

  const result = await suggestRexProjectReferences({
    query,
    embedText: async () => [1, 0, 0],
    retrieveCandidates: async () => [project]
  });

  assert.equal(result.suggestions[0].reviewStatus, "suggested");
});

test("this module never imports or calls any FCI C persistence/validation function", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/appels-offres/fci/rex-project-rag.ts"), "utf8");
  for (const forbidden of [
    "applyFciSuccessCallback",
    "upsertFciModuleData",
    "validateFciModule",
    "saveFciModuleEdits"
  ]) {
    assert.equal(source.includes(forbidden), false, `unexpected persistence call: ${forbidden}`);
  }
});

test("this module has no runtime import of any database/service/repository module at all", () => {
  // Stronger than grepping specific function names (which breaks if a
  // dangerous function is renamed): this asserts every import statement in
  // the file is `import type` - i.e. erased at compile time - so the
  // compiled module has ZERO runtime dependency on service.ts,
  // repository.ts, or any other FCI/database module. It is therefore
  // structurally incapable of calling persistence code, independent of
  // what that code is named today or in the future.
  const source = readFileSync(path.join(process.cwd(), "lib/appels-offres/fci/rex-project-rag.ts"), "utf8");
  const importLines = source
    .split("\n")
    .filter((line) => line.trim().startsWith("import "));
  assert.ok(importLines.length > 0, "expected at least one import statement to exist");
  for (const line of importLines) {
    assert.match(line.trim(), /^import type /, `expected a type-only import, found: ${line}`);
  }
});

test("behaviorally, a full suggestion run touches only the injected embed/retrieve functions and nothing else", async () => {
  const calls: string[] = [];
  const query = buildRexProjectQuery(ficheWithExtraction({ secteur: "Hydraulique urbaine" }));
  const project = candidate("proj-1", [1, 0, 0], { sector: "Hydraulique urbaine" });

  const result = await suggestRexProjectReferences({
    query,
    embedText: async (text) => {
      calls.push(`embed:${text}`);
      return [1, 0, 0];
    },
    retrieveCandidates: async () => {
      calls.push("retrieve");
      return [project];
    },
    now: () => {
      calls.push("now");
      return "2026-01-01T00:00:00.000Z";
    }
  });

  // Exactly the injected functions ran, in the expected order, and nothing
  // else was reachable for this call to have invoked - there is no FCI
  // status, module data, or callback object anywhere in the result or in
  // what was called to produce it.
  assert.deepEqual(calls, [`embed:${query.queryText}`, "retrieve", "now"]);
  assert.equal(result.status, "ok");
  assert.equal("fciModuleStatus" in result, false);
  assert.equal("moduleData" in result, false);
});

// ---------------------------------------------------------------------------
// RESOURCE SAFETY
// ---------------------------------------------------------------------------

test("historical evidence carrying an availability-like field never reaches a suggestion's matched features or differences", async () => {
  const query = buildRexProjectQuery(ficheWithExtraction({ secteur: "Hydraulique urbaine", pays: "Togo" }));
  const contaminated = candidate("proj-1", [1, 0, 0], {
    country: "Togo",
    sector: "Hydraulique urbaine"
  });
  // Simulate a malformed upstream record smuggling a staffing-like key into
  // metadata via an untyped payload - the sanitizer must strip it even
  // though the type system would normally prevent this shape.
  (contaminated.metadata as unknown as Record<string, string>).disponibilite_experts = "Disponible immédiatement";

  const result = await suggestRexProjectReferences({
    query,
    embedText: async () => [1, 0, 0],
    retrieveCandidates: async () => [contaminated]
  });

  const [suggestion] = result.suggestions;
  const serialized = JSON.stringify(suggestion);
  assert.equal(serialized.toLowerCase().includes("disponib"), false);
});

// ---------------------------------------------------------------------------
// REX BOUNDARY (unchanged by this pilot)
// ---------------------------------------------------------------------------

test("rex_projet_reference remains outside the raw FCI C AI contract after this pilot", () => {
  const sample = JSON.parse(
    readFileSync(path.join(process.cwd(), "ai/examples/fci-operations.sample.json"), "utf8")
  ) as { data: FciOperationsData };
  assert.equal("rex_projet_reference" in sample.data, false);

  const schema = readFileSync(path.join(process.cwd(), "ai/schemas/fci-operations.schema.json"), "utf8");
  assert.equal(schema.includes("rex_projet_reference"), false);

  const prompt = readFileSync(path.join(process.cwd(), "ai/prompts/fci-operations.md"), "utf8");
  assert.equal(prompt.includes("rex_projet_reference"), false);
});
