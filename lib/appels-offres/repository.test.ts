import test, { after } from "node:test";
import assert from "node:assert/strict";
import nextEnv from "@next/env";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  applyValidatedExtractionIdentity,
  closeAppelsOffresPool,
  createAppelOffres,
  createProcessingJobByCode,
  ensureAppelsOffresSchema,
  getAppelOffresRecordByCode,
  parseExtractedDeadline,
  reapStaleProcessingJobs
} from "./repository.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const cleanupPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const cleanupCodes = new Set<string>();

function hasDatabase() {
  return Boolean(databaseUrl && cleanupPool);
}

async function createTenderStuckInAnalysis(startedMinutesAgo: number) {
  const code = `TIMEOUT-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
  cleanupCodes.add(code);

  await ensureAppelsOffresSchema();
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
    status: "processing",
    businessStatus: "analyse_en_cours",
    source: "manual"
  });

  const job = await createProcessingJobByCode(code, "fiche_generation", null, "running");

  // Simulate a job that has been silently running (no callback ever arrived)
  // well past the timeout, exactly like a callback sent to the wrong port would
  // produce: the launch was accepted, but nothing ever came back.
  await cleanupPool!.query(
    `update public.processing_jobs set started_at = now() - (interval '1 minute' * $1) where id = $2`,
    [startedMinutesAgo, job.id]
  );

  return { code, jobId: job.id };
}

test("a processing job stuck past PROCESSING_JOB_TIMEOUT_MINUTES is reaped: job fails, tender moves out of analyse_en_cours", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const previousTimeout = process.env.PROCESSING_JOB_TIMEOUT_MINUTES;
  process.env.PROCESSING_JOB_TIMEOUT_MINUTES = "15";

  try {
    const { code } = await createTenderStuckInAnalysis(20);

    const reaped = await reapStaleProcessingJobs();
    assert.ok(
      reaped.some((row) => row.public_id !== null || row.appel_offres_id != null),
      "expected the reaper to report at least one reaped job"
    );

    const jobs = await cleanupPool!.query(
      `select status, error_stage, error_code, callback_status
       from public.processing_jobs
       where appel_offres_id = (select id from public.appels_offres where code = $1)`,
      [code]
    );
    assert.equal(jobs.rows[0]?.status, "failed");
    assert.equal(jobs.rows[0]?.error_stage, "callback");
    assert.equal(jobs.rows[0]?.error_code, "PROCESSING_JOB_TIMEOUT");
    assert.equal(jobs.rows[0]?.callback_status, "failed");

    const tender = await getAppelOffresRecordByCode(code);
    assert.equal(tender?.businessStatus, "erreur");
    assert.equal(tender?.status, "error");
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.PROCESSING_JOB_TIMEOUT_MINUTES;
    } else {
      process.env.PROCESSING_JOB_TIMEOUT_MINUTES = previousTimeout;
    }
  }
});

test("a processing job still within the timeout window is left untouched", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const { code, jobId } = await createTenderStuckInAnalysis(2);

  await reapStaleProcessingJobs();

  const jobs = await cleanupPool!.query(
    `select status from public.processing_jobs where id = $1`,
    [jobId]
  );
  assert.equal(jobs.rows[0]?.status, "running");

  const tender = await getAppelOffresRecordByCode(code);
  assert.equal(tender?.businessStatus, "analyse_en_cours");
});

test("applyValidatedExtractionIdentity fills a placeholder title/empty buyer from the validated extraction", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = `IDENTITY-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
  cleanupCodes.add(code);

  await ensureAppelsOffresSchema();
  await createAppelOffres({
    code,
    title: code,
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

  const updated = await applyValidatedExtractionIdentity(code, {
    title: "Etude d'execution RN6",
    buyer: "AGEROUTE Senegal"
  });

  assert.equal(updated?.title, "Etude d'execution RN6");
  assert.equal(updated?.buyer, "AGEROUTE Senegal");
});

test("parseExtractedDeadline parses an ISO-style deadline", () => {
  assert.equal(parseExtractedDeadline("2026-08-01 12:00 GMT"), "2026-08-01");
});

test("parseExtractedDeadline parses a French long-form deadline", () => {
  assert.equal(
    parseExtractedDeadline("Lundi 20 avril 2026 a 12h00 precises, heure de Ouagadougou (GMT)"),
    "2026-04-20"
  );
  assert.equal(
    parseExtractedDeadline("Vendredi 27 mars 2026 a 12h00 precises, heure de Dakar (GMT)"),
    "2026-03-27"
  );
});

test("parseExtractedDeadline returns null for free text with no confident date", () => {
  assert.equal(parseExtractedDeadline("Non trouve"), null);
  assert.equal(parseExtractedDeadline("Des reception du dossier complet"), null);
  assert.equal(parseExtractedDeadline(""), null);
  assert.equal(parseExtractedDeadline(null), null);
});

test("parseExtractedDeadline rejects an impossible calendar date", () => {
  assert.equal(parseExtractedDeadline("2026-02-30"), null);
  assert.equal(parseExtractedDeadline("31 avril 2026"), null);
});

test("applyValidatedExtractionIdentity fills country and a parseable deadline from the validated extraction", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = `IDENTITY-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
  cleanupCodes.add(code);

  await ensureAppelsOffresSchema();
  await createAppelOffres({
    code,
    title: code,
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

  const updated = await applyValidatedExtractionIdentity(code, {
    title: null,
    buyer: null,
    country: "Burkina Faso",
    deadline: "Lundi 20 avril 2026 a 12h00 precises, heure de Ouagadougou (GMT)"
  });

  assert.equal(updated?.country, "Burkina Faso");
  assert.equal(updated?.dueDate, "2026-04-20");
});

test("applyValidatedExtractionIdentity never overwrites a confirmed country/due date with an empty or unparseable extraction", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = `IDENTITY-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
  cleanupCodes.add(code);

  await ensureAppelsOffresSchema();
  await createAppelOffres({
    code,
    title: code,
    reference: "",
    buyer: "",
    country: "Senegal",
    dueDate: "2026-08-01",
    notes: "",
    priorite: "normale",
    responsableCommercial: "",
    status: "ready",
    businessStatus: "fiche_validee",
    source: "manual"
  });

  const updated = await applyValidatedExtractionIdentity(code, {
    title: null,
    buyer: null,
    country: "",
    deadline: "Non trouve"
  });

  assert.equal(updated?.country, "Senegal");
  assert.equal(updated?.dueDate, "2026-08-01");
});

test("applyValidatedExtractionIdentity never blanks an existing title/buyer when extraction found nothing", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = `IDENTITY-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
  cleanupCodes.add(code);

  await ensureAppelsOffresSchema();
  await createAppelOffres({
    code,
    title: "Titre deja confirme",
    reference: "",
    buyer: "Client deja confirme",
    country: "",
    dueDate: null,
    notes: "",
    priorite: "normale",
    responsableCommercial: "",
    status: "ready",
    businessStatus: "fiche_validee",
    source: "manual"
  });

  const updated = await applyValidatedExtractionIdentity(code, {
    title: "",
    buyer: null
  });

  assert.equal(updated?.title, "Titre deja confirme");
  assert.equal(updated?.buyer, "Client deja confirme");
});

after(async () => {
  if (cleanupPool) {
    for (const code of cleanupCodes) {
      await cleanupPool.query("delete from public.appels_offres where code = $1", [code]);
    }

    await cleanupPool.end();
  }

  await closeAppelsOffresPool();
});
