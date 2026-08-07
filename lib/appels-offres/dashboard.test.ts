import test, { after } from "node:test";
import assert from "node:assert/strict";
import nextEnv from "@next/env";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import {
  closeAppelsOffresPool,
  createAppelOffres,
  ensureAppelsOffresSchema
} from "./repository.ts";
import {
  closeFciPool,
  ensureFciSchema,
  initializeFciSetByAppelOffresCode,
  listFciModulesByAppelOffresCode,
  updateFciModule
} from "./fci/repository.ts";
import { getDepartmentFciQueue } from "./dashboard.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const cleanupPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const cleanupCodes = new Set<string>();

function hasDatabase() {
  return Boolean(databaseUrl && cleanupPool);
}

async function createScopedTestTender() {
  const code = `DASH-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
  cleanupCodes.add(code);

  await ensureAppelsOffresSchema();
  await ensureFciSchema();

  await createAppelOffres({
    code,
    title: `AO ${code}`,
    reference: "",
    buyer: "Client test",
    country: "SN",
    dueDate: null,
    notes: "",
    priorite: "normale",
    responsableCommercial: "Bob Durand",
    status: "ready",
    businessStatus: "fiche_validee",
    source: "manual"
  });

  await initializeFciSetByAppelOffresCode(code, {
    sourceFicheVersion: `validated:${new Date().toISOString()}`,
    sourceFicheHash: randomUUID(),
    sourceFicheUpdatedAt: new Date().toISOString()
  });

  return code;
}

test("each department's dashboard FCI queue is scoped to its own module, not another department's", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createScopedTestTender();
  const modules = await listFciModulesByAppelOffresCode(code);
  const moduleB = modules.find((module) => module.moduleCode === "B");
  const moduleC = modules.find((module) => module.moduleCode === "C");
  assert.ok(moduleB && moduleC, "expected modules B and C to exist after FCI initialization");

  // FINANCE (module B) has validated their module; OPERATIONS (module C) has not
  // touched theirs yet. Same tender, two different departments, two different states.
  await updateFciModule(moduleB!.id, {
    status: "validated",
    validatedAt: new Date().toISOString(),
    validatedBy: "Sophie Bernard"
  });
  await updateFciModule(moduleC!.id, { status: "needs_review" });

  const financeQueue = await getDepartmentFciQueue("B");
  const operationsQueue = await getDepartmentFciQueue("C");

  assert.equal(
    financeQueue.pending.some((item) => item.code === code),
    false,
    "Finance's own validated module must not appear in Finance's pending queue"
  );
  assert.ok(financeQueue.validatedCount >= 1);

  assert.equal(
    operationsQueue.pending.some((item) => item.code === code),
    true,
    "Operations' own not-yet-validated module must appear in Operations' pending queue"
  );
  assert.equal(
    operationsQueue.pending.find((item) => item.code === code)?.title,
    `AO ${code}`
  );

  // The core scoping guarantee this query exists for: Finance being done with their
  // module must not hide the same tender from Operations' queue, and vice versa.
  assert.notEqual(
    financeQueue.pending.some((item) => item.code === code),
    operationsQueue.pending.some((item) => item.code === code)
  );
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
