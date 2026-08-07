import test, { after } from "node:test";
import assert from "node:assert/strict";
import nextEnv from "@next/env";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  closeAppelsOffresPool,
  createAppelOffres,
  ensureAppelsOffresSchema
} from "../repository.ts";
import {
  closeFciPool,
  createFciGenerationJob,
  ensureFciSchema,
  getFciSetByAppelOffresCode,
  initializeFciSetByAppelOffresCode,
  listFciModulesByAppelOffresCode,
  reapStaleFciGenerationJobs,
  updateFciModule
} from "./repository.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const cleanupPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const cleanupCodes = new Set<string>();

function hasDatabase() {
  return Boolean(databaseUrl && cleanupPool);
}

async function createTenderWithGeneratingModuleA(startedMinutesAgo: number) {
  const code = `FCI-TIMEOUT-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
  cleanupCodes.add(code);

  await ensureAppelsOffresSchema();
  await ensureFciSchema();

  await createAppelOffres({
    code,
    title: `AO ${code}`,
    reference: "",
    buyer: "",
    country: "",
    dueDate: null,
    notes: "",
    priorite: "normale",
    responsableCommercial: "",
    status: "ready",
    businessStatus: "fiche_validee",
    source: "manual"
  });

  await initializeFciSetByAppelOffresCode(code, {
    sourceFicheVersion: `validated:${new Date().toISOString()}`,
    sourceFicheHash: randomUUID(),
    sourceFicheUpdatedAt: new Date().toISOString()
  });

  const modules = await listFciModulesByAppelOffresCode(code);
  const moduleA = modules.find((module) => module.moduleCode === "A");
  assert.ok(moduleA, "expected module A to exist after FCI initialization");

  const startedAt = new Date(Date.now() - startedMinutesAgo * 60_000).toISOString();

  // Mirrors what launchFciGenerationJob actually persists: the module's status
  // right before this attempt is captured on the job itself, precisely so a
  // failure/timeout can restore it instead of leaving the module stuck.
  const job = await createFciGenerationJob(moduleA!.id, {
    triggerType: "regeneration",
    provider: "gemini",
    model: "gemini-3.6-flash",
    status: "running",
    contractVersion: "1.0",
    startedAt,
    generationParameters: { previous_module_status: "needs_review" }
  });

  await updateFciModule(moduleA!.id, { status: "generating" });

  return { code, moduleAId: moduleA!.id, jobId: job.id };
}

test("a stuck FCI generation job past PROCESSING_JOB_TIMEOUT_MINUTES is reaped: job fails, module leaves 'generating', overall_status recomputed", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const previousTimeout = process.env.PROCESSING_JOB_TIMEOUT_MINUTES;
  process.env.PROCESSING_JOB_TIMEOUT_MINUTES = "15";

  try {
    const { code, jobId } = await createTenderWithGeneratingModuleA(20);

    const reaped = await reapStaleFciGenerationJobs();
    const reapedEntry = reaped.find((entry) => entry.jobId === jobId);
    assert.ok(reapedEntry, "expected the stuck job to be reported as reaped");
    assert.equal(reapedEntry?.moduleCode, "A");
    assert.equal(reapedEntry?.appelOffresCode, code);
    assert.equal(
      reapedEntry?.restoredStatus,
      "needs_review",
      "should restore the module to its pre-generation status, not a guessed one"
    );

    const jobRow = await cleanupPool!.query(
      `select status, error_code, error_message, completed_at
       from public.fci_generation_jobs where id = $1`,
      [jobId]
    );
    assert.equal(jobRow.rows[0]?.status, "failed");
    assert.equal(jobRow.rows[0]?.error_code, "FCI_GENERATION_TIMEOUT");
    assert.ok(jobRow.rows[0]?.completed_at);

    const modules = await listFciModulesByAppelOffresCode(code);
    const moduleA = modules.find((module) => module.moduleCode === "A");
    assert.equal(moduleA?.status, "needs_review");
    assert.equal(moduleA?.errorCode, "FCI_GENERATION_TIMEOUT");
    assert.notEqual(moduleA?.status, "generating");

    const set = await getFciSetByAppelOffresCode(code);
    assert.notEqual(
      set?.overallStatus,
      "in_progress",
      "the set must leave in_progress once its only generating module is reaped"
    );
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.PROCESSING_JOB_TIMEOUT_MINUTES;
    } else {
      process.env.PROCESSING_JOB_TIMEOUT_MINUTES = previousTimeout;
    }
  }
});

test("an FCI generation job still within the timeout window is left generating", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const { code, jobId } = await createTenderWithGeneratingModuleA(2);

  await reapStaleFciGenerationJobs();

  const jobRow = await cleanupPool!.query(
    `select status from public.fci_generation_jobs where id = $1`,
    [jobId]
  );
  assert.equal(jobRow.rows[0]?.status, "running");

  const modules = await listFciModulesByAppelOffresCode(code);
  const moduleA = modules.find((module) => module.moduleCode === "A");
  assert.equal(moduleA?.status, "generating");
});

after(async () => {
  if (cleanupPool) {
    for (const code of cleanupCodes) {
      await cleanupPool.query("delete from public.appels_offres where code = $1", [code]);
    }

    await cleanupPool.end();
  }

  await Promise.all([closeFciPool(), closeAppelsOffresPool()]);
});
