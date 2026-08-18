import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import nextEnv from "@next/env";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { EVALUATION_FIELD_DEFINITIONS, EXTRACTION_FIELD_DEFINITIONS, type FichePayload } from "../../types.ts";
import { serializeFiche } from "../../fiche-xml.ts";
import { DATA_ROOT, createDraftBundle, markFicheValidated, projectDir } from "../../storage.ts";
import {
  closeAppelsOffresPool,
  createAppelOffres,
  ensureAppelsOffresSchema,
  getAppelOffresRecordByCode,
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
  closeGoNoGoPool,
  insertGoNoGoDecisionVersion
} from "../go-no-go/repository.ts";
import {
  decideGoNoGo,
  reopenGoNoGo
} from "../go-no-go/service.ts";
import {
  closeGoNoGoReportPool,
  getLatestGoNoGoReportByAppelOffresId,
  listGoNoGoReportsByAppelOffresId
} from "./repository.ts";
import {
  generateGoNoGoReport,
  getGoNoGoReportWorkspace,
  GoNoGoReportServiceError,
  prepareGoNoGoReportForWorkflow,
  regenerateGoNoGoReport,
  saveGoNoGoReportDraft,
  submitGoNoGoReportForWorkflow
} from "./service.ts";
import {
  generateGoNoGoReportExportArtifact,
  GoNoGoReportExportError
} from "./export.ts";
import type { CurrentUser } from "../../auth/rbac.ts";
import { getSeededActors } from "../test-actors.ts";
import {
  assignFciModule,
  prepareGoNoGo,
  submitGoNoGoToDg
} from "../workflow/service.ts";
import { closeWorkflowPool } from "../workflow/repository.ts";
import { getDecisionWorkspacePresentation } from "../decision-workspace.ts";
import { FciPdfConversionError } from "../fci/export/pdf-converter.ts";
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

function getActorByModule(moduleCode: "A" | "B" | "C" | "D") {
  switch (moduleCode) {
    case "A":
      return COMMERCIAL_USER;
    case "B":
      return FINANCE_USER;
    case "C":
      return OPERATIONS_USER;
    case "D":
      return DIRECTION_GENERALE_USER;
  }
}

function readJsonFixture(relativePath: string) {
  return JSON.parse(readFileSync(path.join(process.cwd(), relativePath), "utf8")) as Record<string, unknown>;
}

function buildFciModulePayloadFixture(input: {
  moduleCode: "A" | "B" | "C" | "D";
  sourceVersion: string;
  sourceHash: string;
  code: string;
}) {
  const fixtureByModule = {
    A: "ai/examples/fci-commercial.sample.json",
    B: "ai/examples/fci-finance.sample.json",
    C: "ai/examples/fci-operations.sample.json",
    D: "ai/examples/fci-strategy.sample.json"
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
  const code = `GNR-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
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
  // Mirrors what the real /api/fiche/[code]/validate route does: it flips
  // both the file-based fiche status AND the DB businessStatus column
  // together. Fixtures that only did the former left FCI modules readable
  // as "validated" for readiness purposes while businessStatus stayed
  // "fiche_a_valider" - the exact contradiction this whole change fixes.
  await setAppelOffresBusinessStatus(code, "fiche_validee");

  await loadPersistedActors();
  await assignCommercialOwner({
    code,
    newOwnerUserId: Number(COMMERCIAL_USER.id),
    currentUser: COMMERCIAL_USER,
    reason: "go_no_go_report_test_setup"
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
    await assignFciModule({
      code,
      moduleCode: "D",
      assignedUserId: Number(DIRECTION_GENERALE_USER.id),
      currentUser: COMMERCIAL_USER
    });
    assignedTenderCodes.add(code);
  }
}

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

async function completeAndValidateModule(code: string, moduleCode: "A" | "B" | "C" | "D") {
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
  assert.equal(callbackResult.httpStatus, 200);

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
    for (const moduleCode of ["A", "B", "C", "D"] as const) {
      await completeAndValidateModule(code, moduleCode);
    }
  });
}

async function prepareCommercialReportDraft(code: string, decision: "go" | "no_go" = "go") {
  const report = await generateGoNoGoReport(code, COMMERCIAL_USER);
  return saveGoNoGoReportDraft(
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
      recommended_decision: decision,
      expectedVersion: report.version
    },
    COMMERCIAL_USER
  );
}

async function revalidateModuleAAfterReportGeneration(code: string) {
  const moduleView = await getFciModule(code, "A", COMMERCIAL_USER);
  const wrapper = moduleView.latest_data?.data as { data: Record<string, unknown> } & Record<string, unknown>;
  const innerData = { ...wrapper.data };
  setFciFieldValue(innerData, "identification_opportunite.prepare_par", "Maj Commercial test");
  await saveFciModuleEdits(
    code,
    "A",
    {
      data: { ...wrapper, data: innerData },
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: COMMERCIAL_USER.name,
      expectedVersion: moduleView.latest_data?.version ?? null
    },
    COMMERCIAL_USER
  );
  const refreshed = await getFciModule(code, "A", COMMERCIAL_USER);
  await validateFciModule(
    code,
    "A",
    {
      validatedBy: COMMERCIAL_USER.name,
      comment: "refresh",
      expectedVersion: refreshed.latest_data?.version ?? null,
      acknowledgeStaleSource: false
    },
    COMMERCIAL_USER
  );
}

function inspectDocx(docxPath: string) {
  const script = [
    "import sys, zipfile",
    "with zipfile.ZipFile(sys.argv[1], 'r') as archive:",
    "    print(archive.read('word/document.xml').decode('utf-8'))"
  ].join("\n");
  const result = spawnSync("python3", ["-c", script, docxPath], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "DOCX inspection failed.");
  }
  return result.stdout;
}

test("report generation requires validated A/B/C/D", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await initializeAssignedFciWorkspace(code);

  await assert.rejects(
    () => generateGoNoGoReport(code, COMMERCIAL_USER),
    (error: unknown) =>
      error instanceof GoNoGoReportServiceError
      && error.code === "FCI_NOT_VALIDATED"
      && error.status === 409
  );
});

test("report generation persists snapshot versions and marks unavailable data explicitly", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await validateAllFciModules(code);

  const report = await generateGoNoGoReport(code, COMMERCIAL_USER);
  assert.equal(report.version, 1);
  assert.match(report.unresolvedPoints ?? "", /Information non disponible|A confirmer/i);
  const snapshotModules = report.sourceSnapshotJson?.modules as Record<string, { version: number }>;
  assert.ok(snapshotModules.A.version >= 1);
  assert.ok(snapshotModules.B.version >= 1);
  assert.ok(snapshotModules.C.version >= 1);
});

test("duplicate generation is idempotent and regenerate creates a superseding version", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await validateAllFciModules(code);

  const first = await generateGoNoGoReport(code, COMMERCIAL_USER);
  const duplicate = await generateGoNoGoReport(code, COMMERCIAL_USER);
  assert.equal(first.id, duplicate.id);
  assert.equal(first.version, duplicate.version);

  const regenerated = await regenerateGoNoGoReport(code, COMMERCIAL_USER);
  assert.equal(regenerated.version, 2);
  const appelOffres = await getAppelOffresRecordByCode(code, { includeArchived: true });
  const reports = await listGoNoGoReportsByAppelOffresId(appelOffres!.id);
  assert.equal(reports.some((report) => report.version === 1 && report.status === "SUPERSEDED"), true);
});

test("Commercial can edit/save a draft and required-field validation blocks PREPARED", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await validateAllFciModules(code);

  const report = await generateGoNoGoReport(code, COMMERCIAL_USER);
  const updated = await saveGoNoGoReportDraft(
    code,
    {
      executive_summary: "Synthese revue.",
      project_overview: report.projectOverview ?? "Projet valide.",
      commercial_summary: "",
      financial_summary: report.financialSummary ?? "Finance validee.",
      operational_summary: report.operationalSummary ?? "Operations validees.",
      key_strengths: report.keyStrengths ?? "Point fort.",
      key_risks: report.keyRisks ?? "Risque suivi.",
      reservations: report.reservations ?? "Aucune reserve.",
      assumptions: report.assumptions ?? "A confirmer.",
      unresolved_points: report.unresolvedPoints ?? "Aucun point non resolu.",
      commercial_recommendation: report.commercialRecommendation ?? "Recommandation commerciale.",
      ai_recommendation: report.aiRecommendation ?? null,
      recommended_decision: null,
      expectedVersion: report.version
    },
    COMMERCIAL_USER
  );
  assert.equal(updated.executiveSummary, "Synthese revue.");

  await assert.rejects(
    () => prepareGoNoGoReportForWorkflow(code, COMMERCIAL_USER),
    (error: unknown) =>
      error instanceof GoNoGoReportServiceError
      && error.code === "REPORT_VALIDATION_FAILED"
      && error.status === 422
  );
});

test("stale source snapshot blocks report submission", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await validateAllFciModules(code);
  await prepareCommercialReportDraft(code);
  await prepareGoNoGoReportForWorkflow(code, COMMERCIAL_USER);
  await revalidateModuleAAfterReportGeneration(code);

  await assert.rejects(
    () => submitGoNoGoReportForWorkflow(code, COMMERCIAL_USER),
    (error: unknown) =>
      error instanceof GoNoGoReportServiceError
      && error.code === "REPORT_SOURCE_STALE"
      && error.status === 409
  );

  await assert.rejects(
    () => generateGoNoGoReportExportArtifact(code, "docx", COMMERCIAL_USER),
    (error: unknown) =>
      error instanceof GoNoGoReportExportError
      && error.code === "GO_NO_GO_REPORT_EXPORT_NOT_AVAILABLE"
      && error.status === 409
  );
});

test("workflow prepare/submit now require a valid report", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await validateAllFciModules(code);

  await assert.rejects(
    () => prepareGoNoGo(code, COMMERCIAL_USER),
    (error: unknown) =>
      error instanceof GoNoGoReportServiceError
      && error.code === "REPORT_NOT_FOUND"
      && error.status === 404
  );

  await prepareCommercialReportDraft(code);
  await assert.rejects(
    () => submitGoNoGoToDg(code, COMMERCIAL_USER),
    (error: unknown) =>
      error instanceof GoNoGoReportServiceError
      && error.code === "REPORT_INVALID_STATE"
      && error.status === 409
  );
});

test("DG queue excludes non-submitted reports and includes submitted ones", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await validateAllFciModules(code);
  await prepareCommercialReportDraft(code);

  let workspace = await getDecisionWorkspacePresentation(DIRECTION_GENERALE_USER);
  assert.equal(workspace.queue.some((entry) => entry.code === code), false);

  await prepareGoNoGo(code, COMMERCIAL_USER);
  await submitGoNoGoToDg(code, COMMERCIAL_USER);

  workspace = await getDecisionWorkspacePresentation(DIRECTION_GENERALE_USER);
  assert.equal(workspace.queue.some((entry) => entry.code === code), true);
});

test("DG sees the submitted report read-only and cannot edit it", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await validateAllFciModules(code);
  await prepareCommercialReportDraft(code);
  await prepareGoNoGo(code, COMMERCIAL_USER);
  await submitGoNoGoToDg(code, COMMERCIAL_USER);

  const workspace = await getGoNoGoReportWorkspace(code, DIRECTION_GENERALE_USER);
  assert.equal(workspace.report.editable_payload != null, true);
  assert.equal(workspace.permissions.can_edit, false);
  assert.equal(workspace.permissions.can_view_submitted, true);

  await assert.rejects(
    () =>
      saveGoNoGoReportDraft(
        code,
        {
          ...workspace.report.editable_payload!,
          expectedVersion: workspace.report.version
        },
        DIRECTION_GENERALE_USER
      ),
    (error: unknown) =>
      error instanceof GoNoGoReportServiceError
      && error.code === "RBAC_FORBIDDEN"
      && error.status === 403
  );
});

test("historical final decisions remain readable without a report", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await validateAllFciModules(code);

  const appelOffres = await getAppelOffresRecordByCode(code, { includeArchived: true });
  assert.ok(appelOffres);
  await insertGoNoGoDecisionVersion(appelOffres!.id, {
    status: "go",
    decision: "go",
    rationale: "Legacy decision",
    reserves: null,
    decidedBy: "Legacy DG",
    decidedAt: new Date().toISOString()
  });

  const workspace = await getGoNoGoReportWorkspace(code, DIRECTION_GENERALE_USER);
  assert.equal(workspace.report.legacy_notice, "Rapport consolide non disponible pour cette ancienne decision.");
});

test("DOCX export uses the branded FOR-COM-02 template", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await validateAllFciModules(code);
  await prepareCommercialReportDraft(code);

  const artifact = await generateGoNoGoReportExportArtifact(code, "docx", COMMERCIAL_USER);
  const tempDir = await fs.mkdtemp(path.join(DATA_ROOT, "report-export-test-"));
  const outputPath = path.join(tempDir, artifact.fileName);
  try {
    await fs.writeFile(outputPath, artifact.buffer);
    const documentXml = inspectDocx(outputPath);
    assert.match(documentXml, new RegExp(code));
    assert.match(documentXml, /ANALYSE SWOT/);
    assert.match(documentXml, /DIRECTION GENERALE/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("PDF export fails safely when no converter is available", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await validateAllFciModules(code);
  await prepareCommercialReportDraft(code);

  await assert.rejects(
    () =>
      generateGoNoGoReportExportArtifact(code, "pdf", COMMERCIAL_USER, {
        pdfConverter: async () => {
          throw new FciPdfConversionError(
            "PDF_CONVERTER_UNAVAILABLE",
            "Aucun convertisseur PDF n'est disponible."
          );
        }
      }),
    (error: unknown) =>
      error instanceof GoNoGoReportExportError
      && error.code === "GO_NO_GO_REPORT_EXPORT_NOT_AVAILABLE"
      && error.status === 503
  );
});

test("reopening a DG decision keeps the submitted report immutable", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres();
  await validateAllFciModules(code);
  await prepareCommercialReportDraft(code);
  await prepareGoNoGo(code, COMMERCIAL_USER);
  await submitGoNoGoToDg(code, COMMERCIAL_USER);

  const appelOffres = await getAppelOffresRecordByCode(code, { includeArchived: true });
  assert.ok(appelOffres);

  const submittedReport = await getLatestGoNoGoReportByAppelOffresId(appelOffres.id);
  assert.ok(submittedReport);
  assert.equal(submittedReport.status, "SUBMITTED_TO_DG");

  const decision = await decideGoNoGo(
    code,
    {
      decision: "go",
      rationale: "Decision DG pour test de reouverture.",
      reserves: "A surveiller.",
      expectedVersion: null
    },
    DIRECTION_GENERALE_USER
  );
  assert.equal(decision.decision.status, "go");

  const reopened = await reopenGoNoGo(
    code,
    {
      reason: "Reouverture sans modification du rapport soumis.",
      expectedVersion: decision.decision.version
    },
    DIRECTION_GENERALE_USER
  );
  assert.equal(reopened.decision.status, "reouvert");

  const reportAfterReopen = await getLatestGoNoGoReportByAppelOffresId(appelOffres.id);
  assert.ok(reportAfterReopen);
  assert.equal(reportAfterReopen.id, submittedReport.id);
  assert.equal(reportAfterReopen.version, submittedReport.version);
  assert.equal(reportAfterReopen.status, "SUBMITTED_TO_DG");
  assert.equal(reportAfterReopen.submittedAt, submittedReport.submittedAt);
  assert.deepEqual(reportAfterReopen.editablePayloadJson, submittedReport.editablePayloadJson);
});

after(async () => {
  if (cleanupPool) {
    for (const code of cleanupCodes) {
      await cleanupPool.query("delete from public.appels_offres where code = $1", [code]);
      await fs.rm(projectDir(code), { recursive: true, force: true });
    }

    await cleanupPool.end();
  }

  await closeGoNoGoReportPool();
  await closeGoNoGoPool();
  await closeWorkflowPool();
  await closeFciPool();
  await closeAppelsOffresPool();
});
