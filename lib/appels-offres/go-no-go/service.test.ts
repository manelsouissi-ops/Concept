import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import nextEnv from "@next/env";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EVALUATION_FIELD_DEFINITIONS, EXTRACTION_FIELD_DEFINITIONS, type FichePayload } from "../../types.ts";
import { serializeFiche } from "../../fiche-xml.ts";
import { DATA_ROOT, createDraftBundle, markFicheValidated, projectDir } from "../../storage.ts";
import {
  closeAppelsOffresPool,
  createAppelOffres,
  ensureAppelsOffresSchema,
  setAppelOffresBusinessStatus
} from "../repository.ts";
import { closeFciPool, ensureFciSchema } from "../fci/repository.ts";
import {
  FciServiceError,
  applyFciN8nCallback,
  getFciModule,
  getFciWorkspace,
  initializeFciWorkspace,
  prepareFciGeneration,
  saveFciModuleEdits,
  validateFciModule
} from "../fci/service.ts";
import type { FciModuleCode } from "../fci/types.ts";
import type { FciN8nSuccessCallback } from "../fci/n8n-contract.ts";
import {
  decideGoNoGo,
  getGoNoGoView,
  GoNoGoServiceError,
  reopenGoNoGo
} from "./service.ts";
import { closeGoNoGoPool } from "./repository.ts";
import {
  generateGoNoGoReport,
  saveGoNoGoReportDraft
} from "../go-no-go-report/service.ts";
import type { CurrentUser } from "../../auth/rbac.ts";
import { getSeededActors } from "../test-actors.ts";
import {
  closeNotificationsPool,
  listAppNotificationsForUser
} from "../../notifications/repository.ts";
import {
  assignFciModule,
  prepareGoNoGo,
  submitGoNoGoToDg,
  WorkflowServiceError
} from "../workflow/service.ts";
import { assignCommercialOwner } from "../ownership.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const cleanupCodes = new Set<string>();
const cleanupPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

function hasDatabase() {
  return Boolean(databaseUrl && cleanupPool);
}

function buildTestCurrentUser(
  id: string,
  name: string,
  role: CurrentUser["role"],
  departmentCode: CurrentUser["departmentCode"]
): CurrentUser {
  return {
    id,
    firstName: name.split(" ")[0] ?? name,
    name,
    email: `${id}@concept.local`,
    role,
    status: "ACTIVE",
    departmentCode,
    departmentLabel: departmentCode,
    jobTitle: role,
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris",
    lastLoginAt: null,
    createdAt: "2026-07-30T00:00:00.000Z",
    isDevelopmentUser: true
  };
}

let COMMERCIAL_USER = buildTestCurrentUser("user-commercial", "Claire Commerciale", "COMMERCIAL", "COMMERCIAL");
let FINANCE_USER = buildTestCurrentUser("user-finance", "Farid Finance", "FINANCE", "FINANCE");
let OPERATIONS_USER = buildTestCurrentUser("user-operations", "Olivia Operations", "OPERATIONS", "OPERATIONS");
let DIRECTION_GENERALE_USER = buildTestCurrentUser("user-dg", "Diane DG", "DIRECTION_GENERALE", "DIRECTION_GENERALE");
const assignedTenderCodes = new Set<string>();

async function loadPersistedActors() {
  const actors = await getSeededActors();
  COMMERCIAL_USER = actors.commercial;
  FINANCE_USER = actors.finance;
  OPERATIONS_USER = actors.operations;
  DIRECTION_GENERALE_USER = actors.dg;
}

function getActorByModule(moduleCode: "A" | "B" | "C") {
  switch (moduleCode) {
    case "A":
      return COMMERCIAL_USER;
    case "B":
      return FINANCE_USER;
    case "C":
      return OPERATIONS_USER;
  }
}

function readJsonFixture(relativePath: string) {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as Record<string, unknown>;
}

function buildFciModulePayloadFixture(input: {
  moduleCode: "A" | "B" | "C";
  sourceVersion: string;
  sourceHash: string;
  code: string;
}) {
  const fixtureByModule = {
    A: "ai/examples/fci-commercial.sample.json",
    B: "ai/examples/fci-finance.sample.json",
    C: "ai/examples/fci-operations.sample.json"
  } as const;

  const payload = readJsonFixture(fixtureByModule[input.moduleCode]);
  payload.generated_at = new Date().toISOString();
  payload.source_fiche = {
    code_interne: input.code,
    version: input.sourceVersion,
    hash: input.sourceHash,
    status: "validated",
    validated_at: new Date().toISOString()
  };

  return payload;
}

async function withFciEnv<T>(callback: () => Promise<T>) {
  const keys = [
    "FCI_N8N_WEBHOOK_URL",
    "FCI_N8N_WEBHOOK_TOKEN",
    "FCI_CALLBACK_BEARER_TOKEN",
    "FCI_CALLBACK_HMAC_SECRET",
    "FCI_GENERATION_PROVIDER",
    "FCI_GENERATION_MODEL",
    "FCI_N8N_CONTRACT_VERSION",
    "FCI_N8N_LAUNCH_TIMEOUT_MS",
    "PLATFORM_PUBLIC_BASE_URL"
  ] as const;

  const defaults: Record<(typeof keys)[number], string> = {
    FCI_N8N_WEBHOOK_URL: "http://127.0.0.1:5678/webhook/fci-module-generation",
    FCI_N8N_WEBHOOK_TOKEN: "test-fci-launch-token",
    FCI_CALLBACK_BEARER_TOKEN: "test-fci-callback-token",
    FCI_CALLBACK_HMAC_SECRET: "test-fci-callback-secret",
    FCI_GENERATION_PROVIDER: "gemini",
    FCI_GENERATION_MODEL: "gemini-3.6-flash",
    FCI_N8N_CONTRACT_VERSION: "1.0",
    FCI_N8N_LAUNCH_TIMEOUT_MS: "1000",
    PLATFORM_PUBLIC_BASE_URL: "http://127.0.0.1:3000"
  };

  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    process.env[key] = defaults[key];
  }

  try {
    return await callback();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withMockFetch<T>(implementation: typeof fetch, callback: () => Promise<T>) {
  const originalFetch = global.fetch;
  global.fetch = implementation;

  try {
    return await callback();
  } finally {
    global.fetch = originalFetch;
  }
}

const acceptingFetch: typeof fetch = (async (_input, init) => {
  const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  return new Response(
    JSON.stringify({
      contract_version: "1.0",
      accepted: true,
      generation_job_id: requestBody.generation_job_id,
      correlation_id: requestBody.correlation_id,
      execution_id: `exec-${randomUUID().slice(0, 8)}`,
      received_at: new Date().toISOString(),
      processing_status: "RUNNING"
    }),
    { status: 202, headers: { "Content-Type": "application/json" } }
  );
}) as typeof fetch;

function buildFichePayload(code: string): FichePayload {
  return {
    codeInterne: code,
    extraction: EXTRACTION_FIELD_DEFINITIONS.map((field) => ({
      key: field.key,
      label: field.label,
      value: `${field.label} ${code}`,
      source: "test"
    })),
    evaluation: EVALUATION_FIELD_DEFINITIONS.map((field, index) => ({
      key: field.key,
      label: field.label,
      score: 3 + (index % 2),
      justification: `${field.label} justification`,
      chargeEstimee: field.key === "risque_sous_dimensionnement" ? "Charge test" : undefined
    })),
    controle: {
      champsNonTrouves: [],
      incoherences: [],
      aVerifier: [],
      resolutions: []
    }
  };
}

async function createTestAppelOffres() {
  const code = `GNG-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
  cleanupCodes.add(code);

  await ensureAppelsOffresSchema();
  await ensureFciSchema();
  await fs.mkdir(DATA_ROOT, { recursive: true });

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
    businessStatus: "fiche_a_valider",
    source: "manual"
  });

  const payload = buildFichePayload(code);
  const xml = serializeFiche(payload, { referenceInterne: code });
  await createDraftBundle({
    codeInterne: code,
    pdfFile: new File(["%PDF-1.7 test"], "cdc.pdf", { type: "application/pdf" }),
    xml,
    markdown: `# ${code}`
  });
  await markFicheValidated(code);
  // Mirrors the real /api/fiche/[code]/validate route, which flips both the
  // file-based fiche status and the DB businessStatus column together.
  await setAppelOffresBusinessStatus(code, "fiche_validee");

  await loadPersistedActors();
  await assignCommercialOwner({
    code,
    newOwnerUserId: Number(COMMERCIAL_USER.id),
    currentUser: COMMERCIAL_USER,
    reason: "go_no_go_test_setup"
  });

  return code;
}

async function initializeAssignedFciWorkspace(code: string) {
  await loadPersistedActors();
  await initializeFciWorkspace(code, COMMERCIAL_USER);

  if (!assignedTenderCodes.has(code)) {
    await assignFciModule({
      code,
      moduleCode: "B",
      assignedUserId: Number(FINANCE_USER.id),
      currentUser: COMMERCIAL_USER
    });
    await assignFciModule({
      code,
      moduleCode: "C",
      assignedUserId: Number(OPERATIONS_USER.id),
      currentUser: COMMERCIAL_USER
    });
    assignedTenderCodes.add(code);
  }
}

// Sets an FciFormField's value at a dotted/indexed path (e.g.
// "identification_commune.prepared_by_name" or "a1_concurrents[0].nom"),
// marking it human-reviewed - mirrors what saving an edited form field does.
function setFciFieldValue(data: Record<string, unknown>, fieldPath: string, value: unknown) {
  const parts = fieldPath.split(/\.|\[|\]/).filter(Boolean);
  let cursor: Record<string, unknown> = data;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor?.[parts[index]] as Record<string, unknown>;
  }

  const lastKey = parts[parts.length - 1];
  const field = cursor?.[lastKey];
  if (field && typeof field === "object") {
    cursor[lastKey] = {
      ...(field as Record<string, unknown>),
      value,
      source: "human",
      review_status: "reviewed",
      confidence: "high"
    };
  }
}

// Drives a module through the same path production uses (launch -> n8n
// success callback -> human validation) using the known-complete AI sample
// fixtures, so "validated" here means what it means for a real dossier.
async function completeAndValidateModule(code: string, moduleCode: "A" | "B" | "C") {
  const actor = getActorByModule(moduleCode);

  const launchResult = await withMockFetch(acceptingFetch, () =>
    prepareFciGeneration(code, moduleCode, actor)
  );

  const moduleBeforeCallback = await getFciModule(code, moduleCode, actor);
  const workspace = await getFciWorkspace(code, actor);
  const sourceVersion = moduleBeforeCallback.source_fiche.version ?? launchResult.source_version;
  const sourceHash = moduleBeforeCallback.source_fiche.hash ?? "missing";

  const payload = buildFciModulePayloadFixture({
    moduleCode,
    sourceVersion,
    sourceHash,
    code
  });

  const successEnvelope: FciN8nSuccessCallback = {
    event: "fci.generation.completed",
    contract_version: "1.0",
    generation_job_id: launchResult.job.id,
    fci_set_id: workspace.fci_set.id,
    fci_module_id: moduleBeforeCallback.module.id,
    appel_offre_id: workspace.appel_offres.id,
    code_interne: code,
    module_code: moduleCode,
    correlation_id: launchResult.job.correlation_id ?? "missing",
    execution_id: launchResult.job.execution_id ?? "missing",
    status: "completed",
    provider: "gemini",
    model: "gemini-3.6-flash",
    prompt_version: "1.0",
    schema_version: "1.0",
    source_fiche: {
      version: sourceVersion,
      hash: sourceHash
    },
    generated_at: new Date().toISOString(),
    generation_parameters: {},
    payload
  };

  const callbackResult = await applyFciN8nCallback(successEnvelope);
  assert.equal(callbackResult.httpStatus, 200, `callback for module ${moduleCode} should be accepted`);

  // The AI sample fixtures deliberately leave "internal_required" fields null
  // (source_type: internal_required) - that is the platform's "never invent
  // missing data" rule at work, not a broken fixture. A human has to fill
  // those before a module can be validated, so mirror that here: keep
  // retrying validate, and each time it reports missing required fields,
  // patch exactly those paths and resubmit - same as a department completing
  // its FCI in the UI.
  let moduleView = await getFciModule(code, moduleCode, actor);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await validateFciModule(
        code,
        moduleCode,
        {
          validatedBy: actor.name,
          comment: null,
          expectedVersion: moduleView.latest_data?.version ?? null,
          acknowledgeStaleSource: false
        },
        actor
      );
      return;
    } catch (error) {
      if (!(error instanceof FciServiceError) || error.code !== "INVALID_PAYLOAD") {
        throw error;
      }

      const validationErrors = error.details?.validation_errors as Array<{ path: string }> | undefined;
      if (!validationErrors?.length) {
        throw error;
      }

      // moduleView.latest_data.data is the full FciFormPayload wrapper
      // (payload_kind/contract_version/module_code/.../data) that the
      // presentation layer round-trips as-is - the canonical field paths
      // reported by validation errors live under its .data sub-object.
      const wrapper = moduleView.latest_data?.data as { data: Record<string, unknown> } & Record<string, unknown>;
      const innerData = { ...wrapper.data };
      for (const validationError of validationErrors) {
        setFciFieldValue(innerData, validationError.path, "Renseigne pour les besoins du test.");
      }

      await saveFciModuleEdits(
        code,
        moduleCode,
        {
          data: { ...wrapper, data: innerData },
          sourceSummary: null,
          confidence: null,
          aiNotes: null,
          editor: actor.name,
          expectedVersion: moduleView.latest_data?.version ?? null
        },
        actor
      );
      moduleView = await getFciModule(code, moduleCode, actor);
    }
  }

  throw new Error(`Could not complete required fields for module ${moduleCode}.`);
}

async function validateAllFciModules(code: string) {
  await withFciEnv(async () => {
    await initializeAssignedFciWorkspace(code);
    for (const moduleCode of ["A", "B", "C"] as FciModuleCode[]) {
      await completeAndValidateModule(code, moduleCode as "A" | "B" | "C");
    }
  });
}

async function submitValidatedDossierToDg(code: string) {
  const report = await generateGoNoGoReport(code, COMMERCIAL_USER);
  await saveGoNoGoReportDraft(
    code,
    {
      executive_summary: report.executiveSummary ?? "Synthese validee.",
      project_overview: report.projectOverview ?? "Projet valide.",
      commercial_summary: report.commercialSummary ?? "Commercial valide.",
      financial_summary: report.financialSummary ?? "Finance validee.",
      operational_summary: report.operationalSummary ?? "Operations validees.",
      key_strengths: report.keyStrengths ?? "Point fort.",
      key_risks: report.keyRisks ?? "Risque suivi.",
      reservations: report.reservations ?? "Aucune reserve.",
      assumptions: report.assumptions ?? "A confirmer.",
      unresolved_points: report.unresolvedPoints ?? "Aucun point non resolu.",
      commercial_recommendation: report.commercialRecommendation ?? "Recommandation commerciale.",
      ai_recommendation: report.aiRecommendation ?? null,
      recommended_decision: "go",
      expectedVersion: report.version
    },
    COMMERCIAL_USER
  );
  await prepareGoNoGo(code, COMMERCIAL_USER);
  await submitGoNoGoToDg(code, COMMERCIAL_USER);
}

after(async () => {
  if (cleanupPool) {
    for (const code of cleanupCodes) {
      await cleanupPool.query("delete from public.appels_offres where code = $1", [code]);
      await fs.rm(projectDir(code), { recursive: true, force: true });
    }

    await cleanupPool.end();
  }

  await closeGoNoGoPool();
  await closeNotificationsPool();
  await closeFciPool();
  await closeAppelsOffresPool();
});

test("DG cannot open or decide Go/No-Go before Commercial submission", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();

  const commercialView = await getGoNoGoView(code, COMMERCIAL_USER);
  assert.notEqual(commercialView.fci.overall_status, "validated");
  assert.equal(commercialView.permissions.can_decide, false);

  await assert.rejects(
    () => getGoNoGoView(code, DIRECTION_GENERALE_USER),
    (error: unknown) =>
      error instanceof WorkflowServiceError
      && error.code === "RBAC_FORBIDDEN"
      && error.status === 403
  );

  await assert.rejects(
    () =>
      decideGoNoGo(
        code,
        { decision: "go", rationale: "Pret a signer", reserves: null, expectedVersion: null },
        DIRECTION_GENERALE_USER
      ),
    (error: unknown) =>
      error instanceof GoNoGoServiceError
      && error.code === "RBAC_FORBIDDEN"
      && error.status === 403
  );
});

test("only Direction Generale may decide the Go/No-Go", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();

  for (const actor of [COMMERCIAL_USER, FINANCE_USER, OPERATIONS_USER]) {
    await assert.rejects(
      () =>
        decideGoNoGo(
          code,
          { decision: "go", rationale: "Tentative non autorisee", reserves: null, expectedVersion: null },
          actor
        ),
      (error: unknown) =>
        error instanceof GoNoGoServiceError
        && error.code === "RBAC_FORBIDDEN"
        && error.status === 403
    );

    await assert.rejects(
      () => reopenGoNoGo(code, { reason: "Tentative non autorisee", expectedVersion: null }, actor),
      (error: unknown) =>
        error instanceof GoNoGoServiceError
        && error.code === "RBAC_FORBIDDEN"
        && error.status === 403
    );
  }
});

test("go decision authorizes the tender, is idempotent, and reopen appends a new version", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await validateAllFciModules(code);
  await submitValidatedDossierToDg(code);

  const gatedView = await getGoNoGoView(code, DIRECTION_GENERALE_USER);
  assert.equal(gatedView.fci.overall_status, "validated");
  assert.equal(gatedView.permissions.can_decide, true);
  assert.equal(gatedView.fci.modules.length, 3);

  const firstDecision = await decideGoNoGo(
    code,
    { decision: "go", rationale: "Offre alignee avec la strategie.", reserves: "Confirmer le planning.", expectedVersion: null },
    DIRECTION_GENERALE_USER
  );
  assert.equal(firstDecision.applied, true);
  assert.equal(firstDecision.idempotent, false);
  assert.equal(firstDecision.decision.version, 1);
  assert.equal(firstDecision.decision.status, "go");

  const viewAfterDecision = await getGoNoGoView(code, COMMERCIAL_USER);
  assert.equal(viewAfterDecision.appel_offres.business_status, "offre_autorisee");
  assert.equal(viewAfterDecision.decision?.status, "go");
  assert.equal(viewAfterDecision.permissions.can_decide, false);
  const commercialNotifications = await listAppNotificationsForUser(Number(COMMERCIAL_USER.id), 20);
  assert.equal(
    commercialNotifications.some((notification) =>
      notification.eventType === "DG_DECISION_MADE" && notification.appelOffreCode === code
    ),
    true
  );
  // Only Direction Generale can reopen - a non-DG viewer sees the decision
  // but never gets the reopen affordance.
  assert.equal(viewAfterDecision.permissions.can_reopen, false);

  const dgViewAfterDecision = await getGoNoGoView(code, DIRECTION_GENERALE_USER);
  assert.equal(dgViewAfterDecision.permissions.can_reopen, true);

  // Identical decide call is a no-op, not a new version.
  const duplicateDecision = await decideGoNoGo(
    code,
    { decision: "go", rationale: "Offre alignee avec la strategie.", reserves: "Confirmer le planning.", expectedVersion: 1 },
    DIRECTION_GENERALE_USER
  );
  assert.equal(duplicateDecision.applied, false);
  assert.equal(duplicateDecision.idempotent, true);
  assert.equal(duplicateDecision.decision.version, 1);

  const reopened = await reopenGoNoGo(
    code,
    { reason: "Nouvelles informations financieres a reexaminer.", expectedVersion: 1 },
    DIRECTION_GENERALE_USER
  );
  assert.equal(reopened.decision.version, 2);
  assert.equal(reopened.decision.status, "reouvert");
  assert.equal(reopened.decision.decision, null);

  const viewAfterReopen = await getGoNoGoView(code, DIRECTION_GENERALE_USER);
  assert.equal(viewAfterReopen.decision?.version, 2);
  assert.equal(viewAfterReopen.decision?.status, "reouvert");
  assert.equal(viewAfterReopen.permissions.can_decide, true);
  assert.equal(viewAfterReopen.history.length, 2);
  // Reopen does not silently rewrite the original decision - version 1
  // (the actual Go outcome and its rationale) stays intact in the history.
  const originalVersion = viewAfterReopen.history.find((entry) => entry.version === 1);
  assert.equal(originalVersion?.status, "go");
  assert.equal(originalVersion?.rationale, "Offre alignee avec la strategie.");
  // Reopening the decision does not itself revert business_status / unarchive
  // the tender - that remains a separate, explicit action in this phase.
  assert.equal(viewAfterReopen.appel_offres.business_status, "offre_autorisee");
});

test("no_go decision archives the tender", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await validateAllFciModules(code);
  await submitValidatedDossierToDg(code);

  const decision = await decideGoNoGo(
    code,
    { decision: "no_go", rationale: "Risque financier trop eleve.", reserves: null, expectedVersion: null },
    DIRECTION_GENERALE_USER
  );
  assert.equal(decision.decision.status, "no_go");

  const view = await getGoNoGoView(code, DIRECTION_GENERALE_USER);
  assert.equal(view.appel_offres.business_status, "offre_rejetee");
});
