#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFicheIndexSource } from "../../lib/storage.ts";
import { getFciAiRuntimeContract } from "../../lib/appels-offres/fci/ai-runtime.ts";
import { validateFciAiPayload } from "../../lib/appels-offres/fci/ai-validation.ts";
import { applyCommercialGenerationGuardrails, readFciCommercialSourceContext } from "../../lib/appels-offres/fci/commercial-quality.ts";
import type { FciCommercialPayload } from "../../lib/appels-offres/fci/ai-contracts.ts";
import {
  buildLocalFciMessages,
  evaluateLocalFciPayload,
  LOCAL_FCI_MODEL,
  requestLocalFci
} from "../../lib/appels-offres/fci/local-benchmark.ts";

const AO_CODE = "AO-20260824-1322";
const MODULES = ["A", "B", "C"] as const;
const OUTPUT_DIR = path.join(process.cwd(), "tmp", "local-fci-benchmark", AO_CODE);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  const indexed = await readFicheIndexSource(AO_CODE);
  if (indexed.status.status !== "validated" || !indexed.status.validatedAt) {
    throw new Error("La Fiche source doit etre humainement validee avant le benchmark.");
  }
  const sourceFiche = {
    code_interne: AO_CODE,
    version: `validated:${indexed.status.validatedAt}`,
    hash: null,
    status: indexed.status.status,
    validated_at: indexed.status.validatedAt
  };
  const commercialContext = await readFciCommercialSourceContext(AO_CODE);
  await mkdir(OUTPUT_DIR, { recursive: true });
  const report: Record<string, unknown> = {
    benchmark: "local_fci_abc",
    authoritative: false,
    official_state_mutated: false,
    code_interne: AO_CODE,
    model: LOCAL_FCI_MODEL,
    endpoint: "loopback_ollama",
    external_ai_calls: 0,
    external_embedding_calls: 0,
    cloud_fallback: false,
    modules: {}
  };

  for (const moduleCode of MODULES) {
    const contract = getFciAiRuntimeContract(moduleCode);
    const messages = buildLocalFciMessages({
      moduleCode,
      moduleType: contract.moduleType,
      promptText: contract.promptText,
      schemaVersion: contract.schemaVersion,
      schemaJson: contract.schemaJson,
      sourceFiche,
      ficheCdc: indexed.fiche,
      commercialContext: moduleCode === "A" ? commercialContext : undefined
    });
    const started = performance.now();
    const response = await requestLocalFci({
      model: LOCAL_FCI_MODEL,
      messages,
      format: contract.schemaJson,
      stream: false,
      think: false,
      options: { temperature: 0, num_ctx: 40960 }
    });
    const content = isRecord(response.message) ? response.message.content : null;
    if (typeof content !== "string" || !content.trim()) throw new Error(`FCI ${moduleCode}: reponse locale vide.`);
    const parsed = JSON.parse(content) as unknown;
    const validation = validateFciAiPayload(moduleCode, parsed);
    const guarded = validation.ok && moduleCode === "A"
      ? applyCommercialGenerationGuardrails(validation.data as FciCommercialPayload, commercialContext)
      : validation.ok ? validation.data : parsed;
    const metrics = evaluateLocalFciPayload(moduleCode, guarded, {
      fiche_cdc: indexed.fiche,
      ...(moduleCode === "A" ? { commercial_context: commercialContext } : {})
    });
    const moduleReport = {
      generation: "PASS",
      schema: validation.ok ? "PASS" : "FAIL",
      schema_errors: validation.ok ? [] : validation.errors,
      duration_ms: Math.round(performance.now() - started),
      metrics,
      quality: validation.ok
        && metrics.unsupportedClaims === 0
        && metrics.internalClaimViolations === 0
        && !metrics.decisionLeakage ? "PASS" : "REVIEW_REQUIRED"
    };
    (report.modules as Record<string, unknown>)[moduleCode] = moduleReport;
    await writeFile(path.join(OUTPUT_DIR, `fci-${moduleCode.toLowerCase()}.json`), `${JSON.stringify({ payload: guarded, evaluation: moduleReport }, null, 2)}\n`, { mode: 0o600 });
  }
  await writeFile(path.join(OUTPUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
