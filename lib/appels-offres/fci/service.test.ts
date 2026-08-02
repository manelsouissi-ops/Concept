import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import nextEnv from "@next/env";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  EVALUATION_FIELD_DEFINITIONS,
  EXTRACTION_FIELD_DEFINITIONS,
  type FichePayload
} from "../../types.ts";
import { serializeFiche } from "../../fiche-xml.ts";
import {
  DATA_ROOT,
  createDraftBundle,
  markFicheValidated,
  projectDir,
  statusPath,
  xmlPath
} from "../../storage.ts";
import {
  closeAppelsOffresPool,
  createAppelOffres,
  ensureAppelsOffresSchema
} from "../repository.ts";
import {
  closeFciPool,
  createFciGenerationJob,
  ensureFciSchema
} from "./repository.ts";
import {
  FciServiceError,
  getFciModule,
  getFciModuleHistory,
  getFciWorkspace,
  initializeFciWorkspace,
  prepareFciGeneration,
  prepareFciRegeneration,
  saveFciModuleEdits,
  applyFciN8nCallback,
  toFciErrorResponse,
  validateFciModule
} from "./service.ts";
import { getFciN8nIntegrationConfig } from "./n8n-config.ts";
import { createEmptyFciModulePayload } from "./rendering.ts";
import {
  buildN8nCallbackSignature,
  N8nCallbackAuthError,
  verifyN8nCallbackAuthentication
} from "../../integrations/n8n-callback-auth.ts";
import type { CurrentUser } from "../../auth/rbac.ts";
import type {
  FciN8nFailureCallback,
  FciN8nSuccessCallback
} from "./n8n-contract.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const cleanupCodes = new Set<string>();
const cleanupPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

function buildTestCurrentUser(
  id: string,
  name: string,
  role: CurrentUser["role"],
  departmentCode: CurrentUser["departmentCode"]
): CurrentUser {
  return {
    id,
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

const ADMIN_USER = buildTestCurrentUser("user-admin", "Bob Durand", "ADMIN", "ADMINISTRATION");
const COMMERCIAL_USER = buildTestCurrentUser(
  "user-commercial",
  "Claire Commerciale",
  "COMMERCIAL",
  "COMMERCIAL"
);
const FINANCE_USER = buildTestCurrentUser("user-finance", "Farid Finance", "FINANCE", "FINANCE");
const OPERATIONS_USER = buildTestCurrentUser(
  "user-operations",
  "Olivia Operations",
  "OPERATIONS",
  "OPERATIONS"
);
const DIRECTION_GENERALE_USER = buildTestCurrentUser(
  "user-dg",
  "Diane DG",
  "DIRECTION_GENERALE",
  "DIRECTION_GENERALE"
);

function hasDatabase() {
  return Boolean(databaseUrl && cleanupPool);
}

function readJsonFixture(relativePath: string) {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), relativePath), "utf8")
  ) as Record<string, unknown>;
}

async function withFciEnv<T>(
  overrides: Record<string, string | null | undefined>,
  callback: () => Promise<T>
) {
  const keys = [
    "FCI_N8N_WEBHOOK_URL",
    "FCI_N8N_WEBHOOK_TOKEN",
    "FCI_CALLBACK_BEARER_TOKEN",
    "FCI_CALLBACK_HMAC_SECRET",
    "FCI_CALLBACK_MAX_AGE_SECONDS",
    "FCI_GENERATION_PROVIDER",
    "FCI_GENERATION_MODEL",
    "FCI_N8N_CONTRACT_VERSION",
    "FCI_N8N_LAUNCH_TIMEOUT_MS",
    "PLATFORM_PUBLIC_BASE_URL",
    "N8N_WEBHOOK_TOKEN",
    "PLATFORM_CALLBACK_TOKEN"
  ] as const;

  const defaults: Record<(typeof keys)[number], string> = {
    FCI_N8N_WEBHOOK_URL: "http://127.0.0.1:5678/webhook/fci-module-generation",
    FCI_N8N_WEBHOOK_TOKEN: "test-fci-launch-token",
    FCI_CALLBACK_BEARER_TOKEN: "test-fci-callback-token",
    FCI_CALLBACK_HMAC_SECRET: "test-fci-callback-secret",
    FCI_CALLBACK_MAX_AGE_SECONDS: "300",
    FCI_GENERATION_PROVIDER: "gemini",
    FCI_GENERATION_MODEL: "gemini-3.6-flash",
    FCI_N8N_CONTRACT_VERSION: "1.0",
    FCI_N8N_LAUNCH_TIMEOUT_MS: "1000",
    PLATFORM_PUBLIC_BASE_URL: "http://127.0.0.1:3000",
    N8N_WEBHOOK_TOKEN: "test-shared-launch-token",
    PLATFORM_CALLBACK_TOKEN: "test-shared-callback-token"
  };

  const previous = new Map<string, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    const override = overrides[key];
    if (override === null) {
      delete process.env[key];
    } else {
      process.env[key] = override ?? defaults[key];
    }
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

test("FCI config falls back to shared CDC tokens when dedicated FCI tokens are absent", async () => {
  await withFciEnv(
    {
      FCI_N8N_WEBHOOK_TOKEN: null,
      FCI_CALLBACK_BEARER_TOKEN: null,
      N8N_WEBHOOK_TOKEN: "shared-launch-token",
      PLATFORM_CALLBACK_TOKEN: "shared-callback-token"
    },
    async () => {
      const config = getFciN8nIntegrationConfig();
      assert.equal(config.webhookToken, "shared-launch-token");
      assert.equal(config.callbackToken, "shared-callback-token");
    }
  );
});

async function withMockFetch<T>(
  implementation: typeof fetch,
  callback: () => Promise<T>
) {
  const originalFetch = global.fetch;
  global.fetch = implementation;

  try {
    return await callback();
  } finally {
    global.fetch = originalFetch;
  }
}

function buildSignedCallbackEnvelope(payload: Record<string, unknown>, overrides?: {
  timestamp?: string;
  token?: string;
  secret?: string;
  contractVersion?: string;
}) {
  const rawBody = JSON.stringify(payload);
  const timestamp = overrides?.timestamp ?? new Date().toISOString();
  const secret = overrides?.secret ?? "test-fci-callback-secret";
  const signature = buildN8nCallbackSignature(secret, timestamp, rawBody);

  return {
    rawBody,
    contractVersion: overrides?.contractVersion ?? "1.0",
    authorizationHeader: `Bearer ${overrides?.token ?? "test-fci-callback-token"}`,
    timestampHeader: timestamp,
    signatureHeader: `sha256=${signature}`
  };
}

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
      chargeEstimee:
        field.key === "risque_sous_dimensionnement" ? "Charge test" : undefined
    })),
    controle: {
      champsNonTrouves: [],
      incoherences: [],
      aVerifier: [],
      resolutions: []
    }
  };
}

function fillField<TValue>(
  field: Record<string, unknown>,
  value: TValue
) {
  return {
    ...field,
    value,
    source: "human",
    review_status: "reviewed",
    confidence: value == null ? "none" : "high"
  };
}

function buildCompletedDepartmentPayload(
  moduleCode: "B" | "C"
) {
  const payload = createEmptyFciModulePayload(moduleCode, {
    codeInterne: "AO-TEST",
    intituleOffre: "Offre test",
    dateDepot: "2026-07-30",
    sourceFiche: {
      code_interne: "AO-TEST",
      version: "validated:test",
      hash: "hash",
      status: "validated",
      validated_at: "2026-07-30T00:00:00.000Z"
    }
  });

  const identification = payload.data.identification_commune as Record<string, Record<string, unknown>>;
  identification.prepared_by_name = fillField(identification.prepared_by_name, "Bob Durand");
  identification.validated_by_name = fillField(identification.validated_by_name, "Bob Durand");

  if (moduleCode === "B") {
    const finance = payload.data.b1_elements_financiers as Record<string, Record<string, unknown>>;
    finance.taux_change = fillField(finance.taux_change, "1 EUR = 655.957 FCFA");
    finance.coefficient_charges_structure = fillField(finance.coefficient_charges_structure, 12);
    finance.marge_cible = fillField(finance.marge_cible, 15);

    const synthese = payload.data.b3_synthese_financiere as Record<string, Record<string, unknown>>;
    synthese.commentaires_generaux = fillField(
      synthese.commentaires_generaux,
      "Synthese financiere prete pour validation."
    );
  }

  if (moduleCode === "C") {
    const coordination = payload.data.c5_risques_coordination as Record<string, Record<string, unknown>>;
    coordination.controle_qualite_livrables = fillField(
      coordination.controle_qualite_livrables,
      "Controle qualite hebdomadaire avec revue croisee."
    );

    const rexProjet = payload.data.rex_projet_reference as Record<string, Record<string, unknown>>;
    rexProjet.identite = fillField(rexProjet.identite, "Projet de reference AO-REF");
    rexProjet.niveau_similitude = fillField(rexProjet.niveau_similitude, "similaire");
    rexProjet.differences_cles = fillField(
      rexProjet.differences_cles,
      "Differences cles documentees pour cadrer les ressources."
    );

    const rexStandards = payload.data.rex_standards_client as Record<string, Record<string, unknown>>;
    rexStandards.standards_techniques = fillField(
      rexStandards.standards_techniques,
      "Respect des standards techniques habituels du client."
    );
    rexStandards.habitudes_validation = fillField(
      rexStandards.habitudes_validation,
      "Validation en deux tours avec observations detaillees."
    );
    rexStandards.risque_methodologie_non_adaptee = fillField(
      rexStandards.risque_methodologie_non_adaptee,
      "Risque eleve si la methodologie n'est pas contextualisee."
    );

    const rexReco = payload.data.rex_recommandations as Record<string, Record<string, unknown>>;
    rexReco.ajustements_dimensionnement = fillField(
      rexReco.ajustements_dimensionnement,
      "Ajuster le dimensionnement des moyens de terrain."
    );
    rexReco.points_vigilance_prioritaires = fillField(
      rexReco.points_vigilance_prioritaires,
      "Disponibilite des experts, coordination groupement, delais de validation."
    );
    rexReco.bonnes_pratiques = fillField(
      rexReco.bonnes_pratiques,
      "Reprendre les routines de coordination qui ont deja fonctionne."
    );
  }

  return payload;
}

async function rewriteValidatedSourceFiche(code: string, suffix: string) {
  const payload = buildFichePayload(code);
  payload.extraction[0] = {
    ...payload.extraction[0],
    value: `${payload.extraction[0].value} ${suffix}`
  };
  const xml = serializeFiche(payload, { referenceInterne: code });
  const now = new Date().toISOString();

  await fs.writeFile(xmlPath(code), xml, "utf8");
  await fs.writeFile(
    statusPath(code),
    JSON.stringify(
      {
        status: "validated",
        createdAt: now,
        validatedAt: now,
        modifiedAt: now,
        n8nExecutionId: null,
        processingStartedAt: null,
        errorReason: null,
        errorStage: null
      },
      null,
      2
    ),
    "utf8"
  );
}

async function createTestAppelOffres({
  validated = true
}: {
  validated?: boolean;
}) {
  const code = `FCI-TEST-${randomUUID().slice(0, 8).toUpperCase()}`;
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
    businessStatus: validated ? "fiche_validee" : "fiche_a_valider",
    source: "manual"
  });

  const payload = buildFichePayload(code);
  const xml = serializeFiche(payload, { referenceInterne: code });
  await createDraftBundle({
    codeInterne: code,
    pdfFile: new File(["%PDF-1.7 test"], "cdc.pdf", {
      type: "application/pdf"
    }),
    xml,
    markdown: `# ${code}`
  });

  if (validated) {
    await markFicheValidated(code);
  }

  return code;
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

async function withKnowledgeBaseEnabled<T>(
  enabled: boolean,
  callback: () => Promise<T>
) {
  const previous = process.env.KNOWLEDGE_BASE_ENABLED;
  process.env.KNOWLEDGE_BASE_ENABLED = enabled ? "true" : "false";

  try {
    return await callback();
  } finally {
    if (previous == null) {
      delete process.env.KNOWLEDGE_BASE_ENABLED;
    } else {
      process.env.KNOWLEDGE_BASE_ENABLED = previous;
    }
  }
}

after(async () => {
  if (cleanupPool) {
    for (const code of cleanupCodes) {
      await cleanupPool.query("delete from public.appels_offres where code = $1", [code]);
      await fs.rm(projectDir(code), { recursive: true, force: true });
    }

    await cleanupPool.end();
  }

  await closeFciPool();
  await closeAppelsOffresPool();
});

test("initialize is idempotent and creates only A-D when knowledge base is disabled", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    const first = await initializeFciWorkspace(code);
    const second = await initializeFciWorkspace(code);

    assert.equal(first.fci_set.id, second.fci_set.id);
    assert.deepEqual(
      first.enabled_modules,
      ["A", "B", "C", "D"]
    );
    assert.equal(first.module_summaries.length, 4);
  });
});

test("initialize creates module E only when knowledge base is enabled", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(true, async () => {
    const workspace = await initializeFciWorkspace(code);
    assert.deepEqual(workspace.enabled_modules, ["A", "B", "C", "D", "E"]);
    assert.equal(
      workspace.module_summaries.some((module) => module.module_code === "E"),
      true
    );
  });
});

test("manual edits create versions and enforce optimistic concurrency", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code);

    const firstSave = await saveFciModuleEdits(code, "A", {
      data: { section: "v1" },
      sourceSummary: { items: 1 },
      confidence: null,
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: null
    });
    assert.equal(firstSave.latest_data?.version, 1);

    const secondSave = await saveFciModuleEdits(code, "A", {
      data: { section: "v2" },
      sourceSummary: null,
      confidence: { score: 0.9 },
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: 1
    });
    assert.equal(secondSave.latest_data?.version, 2);

    await assert.rejects(
      () =>
        saveFciModuleEdits(code, "A", {
          data: { section: "stale" },
          sourceSummary: null,
          confidence: null,
          aiNotes: null,
          editor: "Bob Durand",
          expectedVersion: 1
        }),
      (error: unknown) =>
        error instanceof FciServiceError && error.code === "VERSION_CONFLICT"
    );
  });
});

test("generation requires a validated fiche CDC and rejects module E generation", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const draftCode = await createTestAppelOffres({ validated: false });
  const validatedCode = await createTestAppelOffres({ validated: true });

  await withKnowledgeBaseEnabled(true, async () => {
    await initializeFciWorkspace(draftCode);
    await initializeFciWorkspace(validatedCode);

    await assert.rejects(
      () => prepareFciGeneration(draftCode, "A"),
      (error: unknown) =>
        error instanceof FciServiceError && error.code === "FICHE_CDC_NOT_VALIDATED"
    );

    await assert.rejects(
      () => prepareFciGeneration(validatedCode, "E"),
      (error: unknown) =>
        error instanceof FciServiceError && error.code === "FCI_MODULE_NOT_GENERATABLE"
    );
  });
});

test("stale-source validation requires explicit acknowledgement and history stays ordered", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code);
    await saveFciModuleEdits(code, "B", {
      data: buildCompletedDepartmentPayload("B"),
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: null
    });

    await rewriteValidatedSourceFiche(code, "UPDATED");

    await assert.rejects(
      () =>
        validateFciModule(code, "B", {
          validatedBy: "Bob Durand",
          comment: null,
          expectedVersion: 1,
          acknowledgeStaleSource: false
        }),
      (error: unknown) =>
        error instanceof FciServiceError && error.code === "SOURCE_OUTDATED"
    );

    const validated = await validateFciModule(code, "B", {
      validatedBy: "Bob Durand",
      comment: "Validation forcee",
      expectedVersion: 1,
      acknowledgeStaleSource: true
    });
    assert.equal(validated.module.status, "validated");

    await withFciEnv({}, async () => {
      await withMockFetch(
        (async (_input, init) => {
          const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              contract_version: "1.0",
              accepted: true,
              generation_job_id: requestBody.generation_job_id,
              correlation_id: requestBody.correlation_id,
              execution_id: "exec-fci-stale-1",
              received_at: new Date().toISOString(),
              processing_status: "RUNNING"
            }),
            {
              status: 202,
              headers: { "Content-Type": "application/json" }
            }
          );
        }) as typeof fetch,
        async () => {
          const regen = await prepareFciRegeneration(code, "B");
          assert.equal(regen.job.status, "running");

          const history = await getFciModuleHistory(code, "B");
          assert.equal(history.versions[0]?.version, 2);
          assert.equal(history.generation_jobs[0]?.status, "running");
        }
      );
    });
  });
});

test("workspace progress excludes disabled knowledge-base module", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code);
    await saveFciModuleEdits(code, "C", {
      data: buildCompletedDepartmentPayload("C"),
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: null
    });
    await validateFciModule(code, "C", {
      validatedBy: "Bob Durand",
      comment: null,
      expectedVersion: 1,
      acknowledgeStaleSource: false
    });

    const workspace = await getFciWorkspace(code);
    assert.equal(workspace.progress.total_modules, 4);
    assert.equal(workspace.progress.validated_modules, 1);
    assert.equal(workspace.progress.percentage, 25);
  });
});

test("module without data exposes generate and module with data exposes regenerate", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code);

    const moduleA = await getFciModule(code, "A");
    assert.equal(moduleA.latest_data, null);
    assert.deepEqual(moduleA.allowed_actions, ["generate", "view_history"]);

    await saveFciModuleEdits(code, "B", {
      data: { section: "draft" },
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: null
    });

    const moduleB = await getFciModule(code, "B");
    assert.equal(moduleB.latest_data?.version, 1);
    assert.ok(moduleB.allowed_actions.includes("regenerate"));
    assert.ok(moduleB.allowed_actions.includes("edit"));
    assert.ok(moduleB.allowed_actions.includes("validate"));
  });
});

test("legacy pending_integration jobs remain in history and do not block generation actions", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code);

    const moduleA = await getFciModule(code, "A");
    const legacyJob = await createFciGenerationJob(moduleA.module.id, {
      triggerType: "manual",
      provider: "planned",
      model: "pending-integration",
      status: "pending_integration",
      executionId: null,
      correlationId: `corr_${randomUUID().replace(/-/g, "")}`,
      errorCode: "GENERATION_NOT_CONNECTED",
      errorMessage:
        "Legacy Phase 2 generation request created before n8n orchestration was connected."
    });

    const moduleAfterLegacyJob = await getFciModule(code, "A");
    assert.equal(moduleAfterLegacyJob.generation_job?.id, legacyJob.id);
    assert.equal(moduleAfterLegacyJob.generation_job?.status, "pending_integration");
    assert.deepEqual(moduleAfterLegacyJob.allowed_actions, ["generate", "view_history"]);
    assert.equal(moduleAfterLegacyJob.latest_data, null);

    const historyBeforeLaunch = await getFciModuleHistory(code, "A");
    assert.equal(historyBeforeLaunch.generation_jobs.length, 1);
    assert.equal(historyBeforeLaunch.generation_jobs[0]?.id, legacyJob.id);
    assert.equal(historyBeforeLaunch.versions.length, 0);

    await withFciEnv({}, async () => {
      await withMockFetch(
        (async (_input, init) => {
          const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

          return new Response(
            JSON.stringify({
              contract_version: "1.0",
              accepted: true,
              generation_job_id: requestBody.generation_job_id,
              correlation_id: requestBody.correlation_id,
              execution_id: "exec-fci-legacy-1",
              received_at: new Date().toISOString(),
              processing_status: "RUNNING"
            }),
            {
              status: 202,
              headers: { "Content-Type": "application/json" }
            }
          );
        }) as typeof fetch,
        async () => {
          const launch = await prepareFciGeneration(code, "A");
          assert.equal(launch.accepted, true);
          assert.equal(launch.job.status, "running");
        }
      );
    });

    const historyAfterLaunch = await getFciModuleHistory(code, "A");
    assert.equal(historyAfterLaunch.generation_jobs.length, 2);
    assert.ok(
      historyAfterLaunch.generation_jobs.some(
        (job) => job.id === legacyJob.id && job.status === "pending_integration"
      )
    );
    assert.equal(historyAfterLaunch.versions.length, 0);
  });
});

test("generation launch is accepted and blocks duplicate active launches", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code);

    await withFciEnv({}, async () => {
      await withMockFetch(
        (async (_input, init) => {
          const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          assert.equal(typeof requestBody.prompt, "object");
          assert.equal(typeof requestBody.output_schema, "object");
          assert.equal(requestBody.module_code, "A");
          assert.deepEqual(requestBody.source_fiche, {
            code_interne: code,
            version: String((requestBody.source_fiche as Record<string, unknown>)?.version ?? ""),
            hash: String((requestBody.source_fiche as Record<string, unknown>)?.hash ?? ""),
            status: "validated",
            validated_at: (requestBody.source_fiche as Record<string, unknown>)?.validated_at ?? null
          });
          assert.equal(
            Object.prototype.hasOwnProperty.call(
              requestBody.source_fiche as Record<string, unknown>,
              "updated_at"
            ),
            false
          );

          return new Response(
            JSON.stringify({
              contract_version: "1.0",
              accepted: true,
              generation_job_id: requestBody.generation_job_id,
              correlation_id: requestBody.correlation_id,
              execution_id: "exec-fci-accepted-1",
              received_at: new Date().toISOString(),
              processing_status: "RUNNING"
            }),
            {
              status: 202,
              headers: { "Content-Type": "application/json" }
            }
          );
        }) as typeof fetch,
        async () => {
          const result = await prepareFciGeneration(code, "A");
          assert.equal(result.accepted, true);
          assert.equal(result.orchestration_connected, true);
          assert.equal(result.job.status, "running");
          assert.equal(result.job.execution_id, "exec-fci-accepted-1");

          const module = await getFciModule(code, "A");
          assert.equal(module.module.status, "generating");
          assert.equal(module.generation_job?.status, "running");
          assert.equal(module.generation_job?.execution_id, "exec-fci-accepted-1");

          await assert.rejects(
            () => prepareFciGeneration(code, "A"),
            (error: unknown) =>
              error instanceof FciServiceError && error.code === "FCI_ALREADY_GENERATING"
          );
        }
      );
    });
  });
});

test("queued launches still block duplicate generation", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code);

    await withFciEnv({}, async () => {
      await withMockFetch(
        (async (_input, init) => {
          const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

          return new Response(
            JSON.stringify({
              contract_version: "1.0",
              accepted: true,
              generation_job_id: requestBody.generation_job_id,
              correlation_id: requestBody.correlation_id,
              execution_id: "exec-fci-queued-1",
              received_at: new Date().toISOString(),
              processing_status: "QUEUED"
            }),
            {
              status: 202,
              headers: { "Content-Type": "application/json" }
            }
          );
        }) as typeof fetch,
        async () => {
          const result = await prepareFciGeneration(code, "A");
          assert.equal(result.job.status, "queued");

          const module = await getFciModule(code, "A");
          assert.equal(module.module.status, "generating");
          assert.equal(module.generation_job?.status, "queued");

          await assert.rejects(
            () => prepareFciGeneration(code, "A"),
            (error: unknown) =>
              error instanceof FciServiceError && error.code === "FCI_ALREADY_GENERATING"
          );
        }
      );
    });
  });
});

test("launch failure marks the job failed and restores the previous validated module state", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code);
    await saveFciModuleEdits(code, "B", {
      data: buildCompletedDepartmentPayload("B"),
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: null
    });
    await validateFciModule(code, "B", {
      validatedBy: "Bob Durand",
      comment: null,
      expectedVersion: 1,
      acknowledgeStaleSource: false
    });

    await withFciEnv({}, async () => {
      await withMockFetch(
        (async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "WEBHOOK_NOT_FOUND",
                message: "Missing webhook"
              }
            }),
            {
              status: 404,
              headers: { "Content-Type": "application/json" }
            }
          )) as typeof fetch,
        async () => {
          await assert.rejects(
            () => prepareFciRegeneration(code, "B"),
            (error: unknown) =>
              error instanceof FciServiceError && error.code === "FCI_LAUNCH_FAILED"
          );

          const module = await getFciModule(code, "B");
          assert.equal(module.module.status, "validated");
          assert.equal(module.module.error_code, "FCI_N8N_LAUNCH_FAILED");
          assert.equal(module.latest_data?.version, 2);
          assert.equal(module.generation_job?.status, "failed");
        }
      );
    });
  });
});

test("signed success callbacks persist one version, remain idempotent, and reject conflicting duplicates", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code);

    let launchResult: Awaited<ReturnType<typeof prepareFciGeneration>> | null = null;

    await withFciEnv({}, async () => {
      await withMockFetch(
        (async (_input, init) => {
          const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              contract_version: "1.0",
              accepted: true,
              generation_job_id: requestBody.generation_job_id,
              correlation_id: requestBody.correlation_id,
              execution_id: "exec-fci-success-1",
              received_at: new Date().toISOString(),
              processing_status: "RUNNING"
            }),
            {
              status: 202,
              headers: { "Content-Type": "application/json" }
            }
          );
        }) as typeof fetch,
        async () => {
          launchResult = await prepareFciGeneration(code, "A");
        }
      );

      assert.ok(launchResult);
      if (!launchResult) {
        throw new Error("Expected FCI launch result.");
      }
      const moduleBeforeCallback = await getFciModule(code, "A");
      const workspace = await getFciWorkspace(code);
      const payload = buildFciModulePayloadFixture({
        moduleCode: "A",
        sourceVersion: moduleBeforeCallback.source_fiche.version ?? "validated:missing",
        sourceHash: moduleBeforeCallback.source_fiche.hash ?? "missing",
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
        module_code: "A",
        correlation_id: launchResult.job.correlation_id ?? "missing",
        execution_id: "exec-fci-success-1",
        status: "completed",
        provider: "gemini",
        model: "gemini-3.6-flash",
        prompt_version: "1.0",
        schema_version: "1.0",
        source_fiche: {
          version: moduleBeforeCallback.source_fiche.version ?? "validated:missing",
          hash: moduleBeforeCallback.source_fiche.hash ?? "missing"
        },
        generated_at: new Date().toISOString(),
        generation_parameters: {},
        payload
      };

      const firstSignedCallback = buildSignedCallbackEnvelope(successEnvelope);
      verifyN8nCallbackAuthentication({
        authorizationHeader: firstSignedCallback.authorizationHeader,
        expectedToken: "test-fci-callback-token",
        timestampHeader: firstSignedCallback.timestampHeader,
        signatureHeader: firstSignedCallback.signatureHeader,
        rawBody: firstSignedCallback.rawBody,
        secret: "test-fci-callback-secret",
        maxAgeMs: 300_000
      });
      const firstResponse = await applyFciN8nCallback(successEnvelope);
      assert.equal(firstResponse.httpStatus, 200);

      const moduleAfterCallback = await getFciModule(code, "A");
      assert.equal(moduleAfterCallback.module.status, "needs_review");
      assert.equal(moduleAfterCallback.latest_data?.version, 1);
      assert.equal(moduleAfterCallback.generation_job?.status, "completed");

      const duplicateResponse = await applyFciN8nCallback(successEnvelope);
      assert.equal(duplicateResponse.httpStatus, 200);
      assert.equal(duplicateResponse.body.idempotent, true);

      const conflictingEnvelope: FciN8nSuccessCallback = {
        ...successEnvelope,
        generation_parameters: {
          changed: true
        }
      };
      const conflictResponse = await applyFciN8nCallback(conflictingEnvelope);
      assert.equal(conflictResponse.httpStatus, 409);
    });
  });
});

test("callback authentication rejects invalid signatures before callback processing", async () => {
  await withFciEnv({}, async () => {
    const signed = buildSignedCallbackEnvelope(
      {
        event: "fci.generation.failed",
        contract_version: "1.0",
        generation_job_id: 999999,
        fci_set_id: 1,
        fci_module_id: 1,
        appel_offre_id: 1,
        code_interne: "AO-TEST",
        module_code: "A",
        correlation_id: "corr_invalid_signature",
        execution_id: "exec-invalid",
        status: "failed",
        provider: "gemini",
        model: "gemini-3.6-flash",
        prompt_version: "1.0",
        schema_version: "1.0",
        source_fiche: {
          version: "validated:test",
          hash: "hash"
        },
        generated_at: new Date().toISOString(),
        generation_parameters: {},
        error: {
          code: "TEST",
          message: "Invalid signature",
          stage: "callback_delivery",
          retryable: true
        }
      },
      {
        secret: "wrong-secret"
      }
    );

    assert.throws(
      () =>
        verifyN8nCallbackAuthentication({
          authorizationHeader: signed.authorizationHeader,
          expectedToken: "test-fci-callback-token",
          timestampHeader: signed.timestampHeader,
          signatureHeader: signed.signatureHeader,
          rawBody: signed.rawBody,
          secret: "test-fci-callback-secret",
          maxAgeMs: 300_000
        }),
      (error: unknown) => error instanceof N8nCallbackAuthError
    );
  });
});

test("invalid AI payload callbacks are rejected and mark the generation as failed", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code);

    let launchResult: Awaited<ReturnType<typeof prepareFciGeneration>> | null = null;

    await withFciEnv({}, async () => {
      await withMockFetch(
        (async (_input, init) => {
          const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              contract_version: "1.0",
              accepted: true,
              generation_job_id: requestBody.generation_job_id,
              correlation_id: requestBody.correlation_id,
              execution_id: "exec-fci-invalid-payload-1",
              received_at: new Date().toISOString(),
              processing_status: "RUNNING"
            }),
            {
              status: 202,
              headers: { "Content-Type": "application/json" }
            }
          );
        }) as typeof fetch,
        async () => {
          launchResult = await prepareFciGeneration(code, "D");
        }
      );

      assert.ok(launchResult);
      if (!launchResult) {
        throw new Error("Expected FCI launch result.");
      }

      const workspace = await getFciWorkspace(code);
      const module = await getFciModule(code, "D");
      const invalidPayload = buildFciModulePayloadFixture({
        moduleCode: "D",
        sourceVersion: module.source_fiche.version ?? "validated:missing",
        sourceHash: module.source_fiche.hash ?? "missing",
        code
      });
      delete (invalidPayload as Record<string, unknown>).data;

      const response = await applyFciN8nCallback({
        event: "fci.generation.completed",
        contract_version: "1.0",
        generation_job_id: launchResult.job.id,
        fci_set_id: workspace.fci_set.id,
        fci_module_id: module.module.id,
        appel_offre_id: workspace.appel_offres.id,
        code_interne: code,
        module_code: "D",
        correlation_id: launchResult.job.correlation_id ?? "missing",
        execution_id: "exec-fci-invalid-payload-1",
        status: "completed",
        provider: "gemini",
        model: "gemini-3.6-flash",
        prompt_version: "1.0",
        schema_version: "1.0",
        source_fiche: {
          version: module.source_fiche.version ?? "validated:missing",
          hash: module.source_fiche.hash ?? "missing"
        },
        generated_at: new Date().toISOString(),
        generation_parameters: {},
        payload: invalidPayload
      } satisfies FciN8nSuccessCallback);

      assert.equal(response.httpStatus, 422);

      const moduleAfterFailure = await getFciModule(code, "D");
      assert.equal(moduleAfterFailure.module.status, "not_started");
      assert.equal(moduleAfterFailure.generation_job?.status, "failed");
      assert.equal(moduleAfterFailure.latest_data, null);
    });
  });
});

test("failure callbacks preserve the previously validated version during regeneration", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code);
    await saveFciModuleEdits(code, "C", {
      data: buildCompletedDepartmentPayload("C"),
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: null
    });
    await validateFciModule(code, "C", {
      validatedBy: "Bob Durand",
      comment: null,
      expectedVersion: 1,
      acknowledgeStaleSource: false
    });

    let launchResult: Awaited<ReturnType<typeof prepareFciRegeneration>> | null = null;

    await withFciEnv({}, async () => {
      await withMockFetch(
        (async (_input, init) => {
          const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              contract_version: "1.0",
              accepted: true,
              generation_job_id: requestBody.generation_job_id,
              correlation_id: requestBody.correlation_id,
              execution_id: "exec-fci-failure-1",
              received_at: new Date().toISOString(),
              processing_status: "RUNNING"
            }),
            {
              status: 202,
              headers: { "Content-Type": "application/json" }
            }
          );
        }) as typeof fetch,
        async () => {
          launchResult = await prepareFciRegeneration(code, "C");
        }
      );

      assert.ok(launchResult);
      if (!launchResult) {
        throw new Error("Expected FCI regeneration launch result.");
      }
      const workspace = await getFciWorkspace(code);
      const module = await getFciModule(code, "C");
      const failureResult = await applyFciN8nCallback({
        event: "fci.generation.failed",
        contract_version: "1.0",
        generation_job_id: launchResult.job.id,
        fci_set_id: workspace.fci_set.id,
        fci_module_id: module.module.id,
        appel_offre_id: workspace.appel_offres.id,
        code_interne: code,
        module_code: "C",
        correlation_id: launchResult.job.correlation_id ?? "missing",
        execution_id: "exec-fci-failure-1",
        status: "failed",
        provider: "gemini",
        model: "gemini-3.6-flash",
        prompt_version: "1.0",
        schema_version: "1.0",
        source_fiche: {
          version: module.source_fiche.version ?? "validated:missing",
          hash: module.source_fiche.hash ?? "missing"
        },
        generated_at: new Date().toISOString(),
        generation_parameters: {},
        error: {
          code: "GEMINI_REQUEST_FAILED",
          message: "Generation interrompue pendant l'appel Gemini.",
          stage: "gemini_request",
          retryable: true
        }
      } satisfies FciN8nFailureCallback);

      assert.equal(failureResult.httpStatus, 200);

      const moduleAfterFailure = await getFciModule(code, "C");
      assert.equal(moduleAfterFailure.module.status, "validated");
      assert.equal(moduleAfterFailure.latest_data?.version, 2);
      assert.equal(moduleAfterFailure.generation_job?.status, "failed");
      assert.equal(
        moduleAfterFailure.module.error_code,
        "GEMINI_REQUEST_FAILED"
      );
    });
  });
});

test("read-only roles can view every FCI module but only their assigned module is editable", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code, ADMIN_USER);

    const commercialModule = await getFciModule(code, "A", COMMERCIAL_USER);
    const financeReadonlyModule = await getFciModule(code, "B", COMMERCIAL_USER);
    const operationsModule = await getFciModule(code, "C", OPERATIONS_USER);
    const dgModule = await getFciModule(code, "D", DIRECTION_GENERALE_USER);

    assert.equal(commercialModule.permissions.can_edit, true);
    assert.equal(commercialModule.permissions.read_only, false);
    assert.equal(commercialModule.allowed_actions.includes("generate"), true);

    assert.equal(financeReadonlyModule.permissions.can_edit, false);
    assert.equal(financeReadonlyModule.permissions.read_only, true);
    assert.equal(financeReadonlyModule.allowed_actions.includes("generate"), false);
    assert.match(financeReadonlyModule.permissions.read_only_message ?? "", /Lecture seule/i);

    assert.equal(operationsModule.permissions.can_edit, true);
    assert.equal(dgModule.permissions.can_make_final_decision, true);
  });
});

test("unauthorized FCI edits and validations return RBAC_FORBIDDEN while admin keeps full access", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code, ADMIN_USER);

    await assert.rejects(
      () =>
        saveFciModuleEdits(code, "A", {
          data: { section: "finance-cannot-edit-commercial" },
          sourceSummary: null,
          confidence: null,
          aiNotes: null,
          editor: FINANCE_USER.name,
          expectedVersion: null
        }, FINANCE_USER),
      (error: unknown) =>
        error instanceof FciServiceError
        && error.code === "RBAC_FORBIDDEN"
        && error.status === 403
    );

    await saveFciModuleEdits(code, "D", {
      data: {
        d1_valeur_strategique: {
          programme_pluriannuel: true
        }
      },
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: ADMIN_USER.name,
      expectedVersion: null
    }, ADMIN_USER);

    await assert.rejects(
      () =>
        validateFciModule(code, "D", {
          validatedBy: COMMERCIAL_USER.name,
          comment: null,
          expectedVersion: 1,
          acknowledgeStaleSource: false
        }, COMMERCIAL_USER),
      (error: unknown) =>
        error instanceof FciServiceError
        && error.code === "RBAC_FORBIDDEN"
        && error.status === 403
    );
  });
});

test("unauthorized generation is denied but admin can still generate any departmental module", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeFciWorkspace(code, ADMIN_USER);

    await assert.rejects(
      () => prepareFciGeneration(code, "B", COMMERCIAL_USER),
      (error: unknown) =>
        error instanceof FciServiceError
        && error.code === "RBAC_FORBIDDEN"
        && error.status === 403
    );

    await withFciEnv({}, async () => {
      await withMockFetch(
        (async (_input, init) => {
          const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              contract_version: "1.0",
              accepted: true,
              generation_job_id: requestBody.generation_job_id,
              correlation_id: requestBody.correlation_id,
              execution_id: "exec-fci-admin-rbac-1",
              received_at: new Date().toISOString(),
              processing_status: "RUNNING"
            }),
            {
              status: 202,
              headers: { "Content-Type": "application/json" }
            }
          );
        }) as typeof fetch,
        async () => {
          const result = await prepareFciGeneration(code, "B", ADMIN_USER);
          assert.equal(result.accepted, true);
          assert.equal(result.job.status, "running");
        }
      );
    });
  });
});

test("RBAC service errors map to a 403 API response payload", () => {
  const response = toFciErrorResponse(
    new FciServiceError(
      "RBAC_FORBIDDEN",
      "Acces refuse : seul finance peut modifier ce module FCI.",
      403,
      { module_code: "B", role: "COMMERCIAL" }
    )
  );

  assert.equal(response.status, 403);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error.code, "RBAC_FORBIDDEN");
  assert.match(String(response.body.error.message), /Acces refuse/i);
});
