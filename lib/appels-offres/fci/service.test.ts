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
  ensureAppelsOffresSchema,
  getAppelOffresRecordByCode
} from "../repository.ts";
import {
  closeFciPool,
  createFciGenerationJob,
  ensureFciSchema,
  upsertFciModuleData
} from "./repository.ts";
import {
  FciServiceError,
  initializeFciWorkspaceForValidatedFiche,
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
import {
  closeNotificationsPool,
  listAppNotificationsForUser
} from "../../notifications/repository.ts";
import type { CurrentUser } from "../../auth/rbac.ts";
import type {
  FciN8nFailureCallback,
  FciN8nSuccessCallback
} from "./n8n-contract.ts";
import { getSeededActors } from "../test-actors.ts";
import {
  assignFciModule,
  prepareGoNoGo,
  submitGoNoGoToDg,
  WorkflowServiceError
} from "../workflow/service.ts";
import { upsertWorkflowState } from "../workflow/repository.ts";
import { assignCommercialOwner } from "../ownership.ts";

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

let ADMIN_USER = buildTestCurrentUser("user-admin", "Bob Durand", "ADMIN", "ADMINISTRATION");
let COMMERCIAL_USER = buildTestCurrentUser(
  "user-commercial",
  "Claire Commerciale",
  "COMMERCIAL",
  "COMMERCIAL"
);
let FINANCE_USER = buildTestCurrentUser("user-finance", "Farid Finance", "FINANCE", "FINANCE");
let OPERATIONS_USER = buildTestCurrentUser(
  "user-operations",
  "Olivia Operations",
  "OPERATIONS",
  "OPERATIONS"
);
let DIRECTION_GENERALE_USER = buildTestCurrentUser(
  "user-dg",
  "Diane DG",
  "DIRECTION_GENERALE",
  "DIRECTION_GENERALE"
);
const assignedTenderCodes = new Set<string>();

async function loadPersistedActors() {
  const actors = await getSeededActors();
  ADMIN_USER = actors.admin;
  COMMERCIAL_USER = actors.commercial;
  FINANCE_USER = actors.finance;
  OPERATIONS_USER = actors.operations;
  DIRECTION_GENERALE_USER = actors.dg;
}

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
  moduleCode: "A" | "B" | "C"
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

  if (moduleCode === "A") {
    const positioning = payload.data.a2_positionnement as Record<string, Record<string, unknown>>;
    positioning.avantage_differentiel = fillField(positioning.avantage_differentiel, "Reference interne validee par la direction commerciale.");
    positioning.vulnerabilite_principale = fillField(positioning.vulnerabilite_principale, "Charge de travail concurrente sur la periode.");
    positioning.niveau_prix_cible = fillField(positioning.niveau_prix_cible, 1200000000);

    const logistics = payload.data.a3_logistique_interne as Record<string, Record<string, unknown>>;
    logistics.responsable_depot = fillField(logistics.responsable_depot, "Bob Durand");
    logistics.representation_locale_existante = fillField(logistics.representation_locale_existante, false);
  }

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

  await loadPersistedActors();
  await assignCommercialOwner({
    code,
    newOwnerUserId: Number(COMMERCIAL_USER.id),
    currentUser: COMMERCIAL_USER,
    reason: "fci_test_setup"
  });

  return code;
}

async function ensureAssignedDepartmentModules(code: string) {
  await loadPersistedActors();
  if (assignedTenderCodes.has(code)) {
    return;
  }

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

async function initializeAssignedFciWorkspace(code: string) {
  await loadPersistedActors();
  await initializeFciWorkspace(code, COMMERCIAL_USER);
  await ensureAssignedDepartmentModules(code);
}

async function markWorkflowSubmittedForDgAccess(code: string) {
  const appelOffres = await getAppelOffresRecordByCode(code, { includeArchived: true });
  assert.ok(appelOffres, "Expected tender to exist before marking workflow state.");
  await upsertWorkflowState(appelOffres.id, "SUBMITTED_TO_DG");
}

function isForbiddenWorkflowOrFciError(error: unknown) {
  return (
    (
      error instanceof FciServiceError
      || error instanceof WorkflowServiceError
    )
    && error.status === 403
    && (
      error.code === "RBAC_FORBIDDEN"
      || error.code === "ASSIGNMENT_FORBIDDEN"
    )
  );
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

  if (input.moduleCode === "A") {
    const identification = (payload.data as Record<string, unknown>)
      .identification_opportunite as Record<string, Record<string, unknown>>;
    for (const key of [
      "reference_interne_code_dossier",
      "intitule_offre",
      "date_depot"
    ]) {
      identification[key] = {
        ...identification[key],
        value: null,
        source_type: "unavailable",
        confidence: "none",
        requires_human_input: false,
        source_references: []
      };
    }
  }

  if (input.moduleCode === "B") {
    // The finance sample's fiche_cdc-sourced claims and calculation inputs
    // are written against a realistic Fiche and will not be grounded in this
    // synthetic test tender's minimal content; neutralize them the same way
    // module A's header fields are neutralized above, so tests that reuse
    // this fixture for unrelated behavior (notifications, lifecycle, RBAC)
    // are not incidentally exercising grounding rejection.
    const cashFlowRows = (payload.data as Record<string, unknown>)
      .cash_flow_par_jalon as Array<Record<string, Record<string, unknown>>>;
    for (const row of cashFlowRows) {
      row.jalon_livrable = {
        ...row.jalon_livrable,
        value: null,
        source_type: "unavailable",
        confidence: "none",
        requires_human_input: false,
        source_references: []
      };
    }

    const calculations = (payload.data as Record<string, unknown>)
      .calculs_financiers as Array<{ inputs: Array<Record<string, unknown>> }>;
    for (const calculation of calculations) {
      for (const calculationInput of calculation.inputs) {
        calculationInput.value = null;
        calculationInput.source_references = [];
      }
    }
  }

  if (input.moduleCode === "C") {
    // Same rationale as module B above: neutralize the sample's fiche_cdc/
    // ai_inference claims that are written against a realistic Fiche and
    // will not be grounded in this synthetic test tender's minimal content.
    const keyExperts = (payload.data as Record<string, unknown>)
      .disponibilite_des_experts_cles as Array<Record<string, Record<string, unknown>>>;
    for (const row of keyExperts) {
      row.poste_ou_expert = {
        ...row.poste_ou_expert,
        value: null,
        source_type: "unavailable",
        confidence: "none",
        requires_human_input: false,
        source_references: []
      };
      row.volume_travail_reel_previsionnel = {
        ...row.volume_travail_reel_previsionnel,
        value: null,
        source_type: "unavailable",
        confidence: "none",
        requires_human_input: false,
        source_references: []
      };
    }

    const capacities = (payload.data as Record<string, unknown>)
      .capacite_absorption_globale as Array<Record<string, Record<string, unknown>>>;
    for (const row of capacities) {
      row.designation_du_moyen = {
        ...row.designation_du_moyen,
        value: null,
        source_type: "unavailable",
        confidence: "none",
        requires_human_input: false,
        source_references: []
      };
    }
  }

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
  await closeNotificationsPool();
  await closeAppelsOffresPool();
});

test("initialize is idempotent and exposes all four departmental FCI modules", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    const first = await initializeFciWorkspace(code, COMMERCIAL_USER);
    const second = await initializeFciWorkspace(code, COMMERCIAL_USER);

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
    const workspace = await initializeFciWorkspace(code, COMMERCIAL_USER);
    assert.deepEqual(workspace.enabled_modules, ["A", "B", "C", "D"]);
    assert.equal(
      workspace.module_summaries.some((module) => module.module_code === "E"),
      false
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
    await initializeFciWorkspace(code, COMMERCIAL_USER);

    const firstSave = await saveFciModuleEdits(code, "A", {
      data: { section: "v1" },
      sourceSummary: { items: 1 },
      confidence: null,
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: null
    }, COMMERCIAL_USER);
    assert.equal(firstSave.latest_data?.version, 1);

    const secondSave = await saveFciModuleEdits(code, "A", {
      data: { section: "v2" },
      sourceSummary: null,
      confidence: { score: 0.9 },
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: 1
    }, COMMERCIAL_USER);
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
        }, COMMERCIAL_USER),
      (error: unknown) =>
        error instanceof FciServiceError && error.code === "VERSION_CONFLICT"
    );
  });
});

test("FCI cannot be initialized before the Fiche CDC is validated, and generation rejects module E", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const draftCode = await createTestAppelOffres({ validated: false });
  const validatedCode = await createTestAppelOffres({ validated: true });

  await withKnowledgeBaseEnabled(true, async () => {
    // FCI must not become actionable before the Fiche CDC is validated - this
    // is the earliest, root-cause gate (initialization itself), not just a
    // later check on generation.
    await assert.rejects(
      () => initializeFciWorkspace(draftCode, COMMERCIAL_USER),
      (error: unknown) =>
        error instanceof FciServiceError && error.code === "FICHE_CDC_NOT_VALIDATED"
    );

    await initializeFciWorkspace(validatedCode, COMMERCIAL_USER);

    await assert.rejects(
      () => prepareFciGeneration(validatedCode, "E", COMMERCIAL_USER),
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
    await initializeAssignedFciWorkspace(code);
    await saveFciModuleEdits(code, "B", {
      data: buildCompletedDepartmentPayload("B"),
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: null
    }, FINANCE_USER);

    await rewriteValidatedSourceFiche(code, "UPDATED");

    await assert.rejects(
      () =>
        validateFciModule(code, "B", {
          validatedBy: "Bob Durand",
          comment: null,
          expectedVersion: 1,
          acknowledgeStaleSource: false
        }, FINANCE_USER),
      (error: unknown) =>
        error instanceof FciServiceError && error.code === "SOURCE_OUTDATED"
    );

    const validated = await validateFciModule(code, "B", {
      validatedBy: "Bob Durand",
      comment: "Validation forcee",
      expectedVersion: 1,
      acknowledgeStaleSource: true
    }, FINANCE_USER);
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
          const regen = await prepareFciRegeneration(code, "B", FINANCE_USER);
          assert.equal(regen.job.status, "running");

          const history = await getFciModuleHistory(code, "B", COMMERCIAL_USER);
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
    await initializeAssignedFciWorkspace(code);
    await saveFciModuleEdits(code, "C", {
      data: buildCompletedDepartmentPayload("C"),
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: null
    }, OPERATIONS_USER);
    await validateFciModule(code, "C", {
      validatedBy: "Bob Durand",
      comment: null,
      expectedVersion: 1,
      acknowledgeStaleSource: false
    }, OPERATIONS_USER);

    const workspace = await getFciWorkspace(code, COMMERCIAL_USER);
    assert.equal(workspace.progress.total_modules, 4);
    assert.equal(workspace.progress.validated_modules, 1);
    assert.equal(workspace.progress.percentage, 25);
  });
});

test("validating an assigned departmental module notifies Commercial", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);
    await saveFciModuleEdits(code, "B", {
      data: buildCompletedDepartmentPayload("B"),
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: FINANCE_USER.name,
      expectedVersion: null
    }, FINANCE_USER);
    await validateFciModule(code, "B", {
      validatedBy: FINANCE_USER.name,
      comment: null,
      expectedVersion: 1,
      acknowledgeStaleSource: false
    }, FINANCE_USER);

    const notifications = await listAppNotificationsForUser(Number(COMMERCIAL_USER.id), 20);
    assert.equal(
      notifications.some((notification) =>
        notification.appelOffreCode === code
        && notification.eventType === "FCI_VALIDATED"
        && notification.moduleCode === "B"
      ),
      true
    );
  });
});

test("validated fiche initializes FCI modules without launching generation and stays idempotent", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    let launchCount = 0;

    await withFciEnv({}, async () => {
      await withMockFetch(
        (async (_input, init) => {
          launchCount += 1;
          const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

          return new Response(
            JSON.stringify({
              contract_version: "1.0",
              accepted: true,
              generation_job_id: requestBody.generation_job_id,
              correlation_id: requestBody.correlation_id,
              execution_id: `exec-fci-auto-${launchCount}`,
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
          await initializeFciWorkspaceForValidatedFiche(code);
          assert.equal(launchCount, 0);

          const workspaceAfterFirstLaunch = await getFciWorkspace(code, COMMERCIAL_USER);
          assert.deepEqual(workspaceAfterFirstLaunch.enabled_modules, ["A", "B", "C", "D"]);
          assert.equal(
            workspaceAfterFirstLaunch.module_summaries.every(
              (module) => module.status === "not_started"
            ),
            true
          );

          await initializeFciWorkspaceForValidatedFiche(code);
          assert.equal(launchCount, 0);
        }
      );
    });
  });
});

test("re-validating a Fiche CDC after an edit never disturbs a module already validated or in progress", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    let launchCount = 0;

    await withFciEnv({}, async () => {
      await withMockFetch(
        (async (_input, init) => {
          launchCount += 1;
          const requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

          return new Response(
            JSON.stringify({
              contract_version: "1.0",
              accepted: true,
              generation_job_id: requestBody.generation_job_id,
              correlation_id: requestBody.correlation_id,
              execution_id: `exec-fci-revalidate-${launchCount}`,
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
          // Module B is already completed and validated by Finance before the
          // tender's Fiche CDC ever gets re-validated (e.g. Commercial edited
          // and re-validated the Fiche after Finance had already finished).
          await initializeAssignedFciWorkspace(code);
          await saveFciModuleEdits(
            code,
            "B",
            {
              data: buildCompletedDepartmentPayload("B"),
              sourceSummary: null,
              confidence: null,
              aiNotes: null,
              editor: "Farid Finance",
              expectedVersion: null
            },
            FINANCE_USER
          );
          await validateFciModule(
            code,
            "B",
            {
              validatedBy: "Farid Finance",
              comment: null,
              expectedVersion: 1,
              acknowledgeStaleSource: false
            },
            FINANCE_USER
          );

          const moduleBBeforeRevalidation = await getFciModule(code, "B", FINANCE_USER);
          assert.equal(moduleBBeforeRevalidation.module.status, "validated");
          const validatedAtBeforeRevalidation = moduleBBeforeRevalidation.module.validated_at;

          await initializeFciWorkspaceForValidatedFiche(code);
          assert.equal(launchCount, 0, "re-initialization must never launch generation");

          const moduleBAfterRevalidation = await getFciModule(code, "B", FINANCE_USER);
          assert.equal(moduleBAfterRevalidation.module.status, "validated");
          assert.equal(moduleBAfterRevalidation.module.validated_at, validatedAtBeforeRevalidation);
          assert.equal(
            moduleBAfterRevalidation.latest_data?.version,
            moduleBBeforeRevalidation.latest_data?.version,
            "module B's data must not be wiped or regenerated by re-validation"
          );

          const workspace = await getFciWorkspace(code, COMMERCIAL_USER);
          const moduleA = workspace.module_summaries.find((module) => module.module_code === "A");
          const moduleC = workspace.module_summaries.find((module) => module.module_code === "C");
          assert.equal(moduleA?.status, "not_started");
          assert.equal(moduleC?.status, "not_started");
        }
      );
    });
  });
});

test("module without data no longer exposes initial generate and module with data exposes regenerate", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);

    const moduleA = await getFciModule(code, "A", COMMERCIAL_USER);
    assert.equal(moduleA.latest_data, null);
    assert.deepEqual(moduleA.allowed_actions, ["view_history"]);

    await saveFciModuleEdits(code, "B", {
      data: { section: "draft" },
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: null
    }, FINANCE_USER);

    const moduleB = await getFciModule(code, "B", FINANCE_USER);
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
    await initializeFciWorkspace(code, COMMERCIAL_USER);

    const moduleA = await getFciModule(code, "A", COMMERCIAL_USER);
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

    const moduleAfterLegacyJob = await getFciModule(code, "A", COMMERCIAL_USER);
    assert.equal(moduleAfterLegacyJob.generation_job?.id, legacyJob.id);
    assert.equal(moduleAfterLegacyJob.generation_job?.status, "pending_integration");
    assert.deepEqual(moduleAfterLegacyJob.allowed_actions, ["view_history"]);
    assert.equal(moduleAfterLegacyJob.latest_data, null);

    const historyBeforeLaunch = await getFciModuleHistory(code, "A", COMMERCIAL_USER);
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
          const launch = await prepareFciGeneration(code, "A", COMMERCIAL_USER);
          assert.equal(launch.accepted, true);
          assert.equal(launch.job.status, "running");
        }
      );
    });

    const historyAfterLaunch = await getFciModuleHistory(code, "A", COMMERCIAL_USER);
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
    await initializeFciWorkspace(code, COMMERCIAL_USER);

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
          const result = await prepareFciGeneration(code, "A", COMMERCIAL_USER);
          assert.equal(result.accepted, true);
          assert.equal(result.orchestration_connected, true);
          assert.equal(result.job.status, "running");
          assert.equal(result.job.execution_id, "exec-fci-accepted-1");

          const module = await getFciModule(code, "A", COMMERCIAL_USER);
          assert.equal(module.module.status, "generating");
          assert.equal(module.generation_job?.status, "running");
          assert.equal(module.generation_job?.execution_id, "exec-fci-accepted-1");

          await assert.rejects(
            () => prepareFciGeneration(code, "A", COMMERCIAL_USER),
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
    await initializeFciWorkspace(code, COMMERCIAL_USER);

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
          const result = await prepareFciGeneration(code, "A", COMMERCIAL_USER);
          assert.equal(result.job.status, "queued");

          const module = await getFciModule(code, "A", COMMERCIAL_USER);
          assert.equal(module.module.status, "generating");
          assert.equal(module.generation_job?.status, "queued");

          await assert.rejects(
            () => prepareFciGeneration(code, "A", COMMERCIAL_USER),
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
    await initializeAssignedFciWorkspace(code);
    await saveFciModuleEdits(code, "B", {
      data: buildCompletedDepartmentPayload("B"),
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: null
    }, FINANCE_USER);
    await validateFciModule(code, "B", {
      validatedBy: "Bob Durand",
      comment: null,
      expectedVersion: 1,
      acknowledgeStaleSource: false
    }, FINANCE_USER);

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
            () => prepareFciRegeneration(code, "B", FINANCE_USER),
            (error: unknown) =>
              error instanceof FciServiceError && error.code === "FCI_LAUNCH_FAILED"
          );

          const module = await getFciModule(code, "B", COMMERCIAL_USER);
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
    await initializeFciWorkspace(code, COMMERCIAL_USER);

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
          launchResult = await prepareFciGeneration(code, "A", COMMERCIAL_USER);
        }
      );

      assert.ok(launchResult);
      if (!launchResult) {
        throw new Error("Expected FCI launch result.");
      }
      const moduleBeforeCallback = await getFciModule(code, "A", COMMERCIAL_USER);
      const workspace = await getFciWorkspace(code, COMMERCIAL_USER);
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
        provider: launchResult.job.provider,
        model: launchResult.job.model,
        prompt_version: "1.1",
        schema_version: "1.1",
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

      const moduleAfterCallback = await getFciModule(code, "A", COMMERCIAL_USER);
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

test("FCI B resolves the local provider, enforces financial guardrails end to end, and lands on needs_review", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);

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
              execution_id: "exec-fci-b-success-1",
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
          launchResult = await prepareFciGeneration(code, "B", FINANCE_USER);
        }
      );

      assert.ok(launchResult);
      if (!launchResult) {
        throw new Error("Expected FCI launch result.");
      }
      // FCI B must resolve the same local-first policy as FCI A: no
      // environment override was set, so the default applies.
      assert.equal(launchResult.job.provider, "local");
      assert.equal(launchResult.job.model, "qwen3:14b");

      const moduleBeforeCallback = await getFciModule(code, "B", FINANCE_USER);
      const workspace = await getFciWorkspace(code, FINANCE_USER);
      const payload = buildFciModulePayloadFixture({
        moduleCode: "B",
        sourceVersion: moduleBeforeCallback.source_fiche.version ?? "validated:missing",
        sourceHash: moduleBeforeCallback.source_fiche.hash ?? "missing",
        code
      });

      // Simulate a non-compliant local model response that tried to invent a
      // current internal margin figure; the guardrail must overwrite it
      // regardless of what the callback claims.
      const financeData = (payload.data as Record<string, unknown>)
        .elements_financiers_internes as Record<string, Record<string, unknown>>;
      financeData.marge_cible_visee = {
        value: "18%",
        source_type: "ai_inference",
        confidence: "medium",
        requires_human_input: false,
        justification: "Marge supposee par le modele",
        source_references: []
      };

      const successEnvelope: FciN8nSuccessCallback = {
        event: "fci.generation.completed",
        contract_version: "1.0",
        generation_job_id: launchResult.job.id,
        fci_set_id: workspace.fci_set.id,
        fci_module_id: moduleBeforeCallback.module.id,
        appel_offre_id: workspace.appel_offres.id,
        code_interne: code,
        module_code: "B",
        correlation_id: launchResult.job.correlation_id ?? "missing",
        execution_id: "exec-fci-b-success-1",
        status: "completed",
        provider: launchResult.job.provider,
        model: launchResult.job.model,
        prompt_version: "1.1",
        schema_version: "1.1",
        source_fiche: {
          version: moduleBeforeCallback.source_fiche.version ?? "validated:missing",
          hash: moduleBeforeCallback.source_fiche.hash ?? "missing"
        },
        generated_at: new Date().toISOString(),
        generation_parameters: {},
        payload
      };

      const signedCallback = buildSignedCallbackEnvelope(successEnvelope);
      verifyN8nCallbackAuthentication({
        authorizationHeader: signedCallback.authorizationHeader,
        expectedToken: "test-fci-callback-token",
        timestampHeader: signedCallback.timestampHeader,
        signatureHeader: signedCallback.signatureHeader,
        rawBody: signedCallback.rawBody,
        secret: "test-fci-callback-secret",
        maxAgeMs: 300_000
      });
      const response = await applyFciN8nCallback(successEnvelope);
      assert.equal(response.httpStatus, 200);

      const moduleAfterCallback = await getFciModule(code, "B", FINANCE_USER);
      assert.equal(moduleAfterCallback.module.status, "needs_review");
      assert.equal(moduleAfterCallback.module.validated_at, null);
      assert.equal(moduleAfterCallback.latest_data?.version, 1);

      // The AI contract shape is rendered into the departmental UI form
      // before persistence (field paths and key names change: e.g.
      // elements_financiers_internes.marge_cible_visee becomes
      // b1_elements_financiers.marge_cible with source/review_status keys),
      // so this checks the actual stored shape rather than the AI envelope.
      const persistedEnvelope = moduleAfterCallback.latest_data?.data as
        | { data?: { b1_elements_financiers?: Record<string, Record<string, unknown>> } }
        | undefined;
      const persistedFinance = persistedEnvelope?.data?.b1_elements_financiers ?? {};
      for (const key of ["taux_change", "coefficient_charges_structure", "marge_cible"]) {
        assert.equal(persistedFinance[key]?.value, null);
        assert.equal(persistedFinance[key]?.source, "human");
        assert.equal(persistedFinance[key]?.review_status, "human_required");
      }
    });
  });
});

test("FCI B generation callback with an ungrounded financial claim fails closed and never falls back to Gemini", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);

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
              execution_id: "exec-fci-b-grounding-1",
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
          launchResult = await prepareFciGeneration(code, "B", FINANCE_USER);
        }
      );

      assert.ok(launchResult);
      if (!launchResult) {
        throw new Error("Expected FCI launch result.");
      }
      assert.equal(launchResult.job.provider, "local");

      const moduleBeforeCallback = await getFciModule(code, "B", FINANCE_USER);
      const workspace = await getFciWorkspace(code, FINANCE_USER);
      const payload = buildFciModulePayloadFixture({
        moduleCode: "B",
        sourceVersion: moduleBeforeCallback.source_fiche.version ?? "validated:missing",
        sourceHash: moduleBeforeCallback.source_fiche.hash ?? "missing",
        code
      });

      // A fabricated cash-pressure figure with no support in the validated
      // Fiche or permitted context: must be rejected, not silently kept.
      const synthese = (payload.data as Record<string, unknown>)
        .synthese_financiere as Record<string, Record<string, unknown>>;
      synthese.pression_tresorerie_preliminaire = {
        value: "Deficit previsionnel de 250000 EUR au T2",
        source_type: "ai_inference",
        confidence: "medium",
        requires_human_input: false,
        justification: "Lecture prudente",
        source_references: []
      };

      const failingEnvelope: FciN8nSuccessCallback = {
        event: "fci.generation.completed",
        contract_version: "1.0",
        generation_job_id: launchResult.job.id,
        fci_set_id: workspace.fci_set.id,
        fci_module_id: moduleBeforeCallback.module.id,
        appel_offre_id: workspace.appel_offres.id,
        code_interne: code,
        module_code: "B",
        correlation_id: launchResult.job.correlation_id ?? "missing",
        execution_id: "exec-fci-b-grounding-1",
        status: "completed",
        provider: launchResult.job.provider,
        model: launchResult.job.model,
        prompt_version: "1.1",
        schema_version: "1.1",
        source_fiche: {
          version: moduleBeforeCallback.source_fiche.version ?? "validated:missing",
          hash: moduleBeforeCallback.source_fiche.hash ?? "missing"
        },
        generated_at: new Date().toISOString(),
        generation_parameters: {},
        payload
      };

      const response = await applyFciN8nCallback(failingEnvelope);
      assert.equal(response.httpStatus, 422);
      assert.equal((response.body as { code?: string }).code, "AI_GROUNDING_VALIDATION_FAILED");

      const moduleAfterFailure = await getFciModule(code, "B", FINANCE_USER);
      // Fail closed: no data persisted, no silent Gemini retry, previous
      // (not-started) state restored rather than a fabricated success.
      assert.equal(moduleAfterFailure.latest_data, null);
      assert.equal(moduleAfterFailure.generation_job?.status, "failed");
      assert.equal(moduleAfterFailure.generation_job?.provider, "local");
    });
  });
});

test("FCI C resolves the local provider, enforces operational guardrails end to end, and lands on needs_review", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);

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
              execution_id: "exec-fci-c-success-1",
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
          launchResult = await prepareFciGeneration(code, "C", OPERATIONS_USER);
        }
      );

      assert.ok(launchResult);
      if (!launchResult) {
        throw new Error("Expected FCI launch result.");
      }
      // FCI C must resolve the same local-first policy as FCI A and B: no
      // environment override was set, so the default applies.
      assert.equal(launchResult.job.provider, "local");
      assert.equal(launchResult.job.model, "qwen3:14b");

      const moduleBeforeCallback = await getFciModule(code, "C", OPERATIONS_USER);
      const workspace = await getFciWorkspace(code, OPERATIONS_USER);
      const payload = buildFciModulePayloadFixture({
        moduleCode: "C",
        sourceVersion: moduleBeforeCallback.source_fiche.version ?? "validated:missing",
        sourceHash: moduleBeforeCallback.source_fiche.hash ?? "missing",
        code
      });

      // Simulate a non-compliant local model response that tried to invent
      // a confirmed current-resource fact; the guardrail must overwrite it
      // regardless of what the callback claims.
      const capacityRows = (payload.data as Record<string, unknown>)
        .capacite_absorption_globale as Array<Record<string, Record<string, unknown>>>;
      if (capacityRows[0]) {
        capacityRows[0].disponible_au_demarrage = {
          value: "Oui, confirmé",
          source_type: "ai_inference",
          confidence: "high",
          requires_human_input: false,
          justification: "Suppose disponible par le modele",
          source_references: []
        };
      }

      const successEnvelope: FciN8nSuccessCallback = {
        event: "fci.generation.completed",
        contract_version: "1.0",
        generation_job_id: launchResult.job.id,
        fci_set_id: workspace.fci_set.id,
        fci_module_id: moduleBeforeCallback.module.id,
        appel_offre_id: workspace.appel_offres.id,
        code_interne: code,
        module_code: "C",
        correlation_id: launchResult.job.correlation_id ?? "missing",
        execution_id: "exec-fci-c-success-1",
        status: "completed",
        provider: launchResult.job.provider,
        model: launchResult.job.model,
        prompt_version: "1.1",
        schema_version: "1.1",
        source_fiche: {
          version: moduleBeforeCallback.source_fiche.version ?? "validated:missing",
          hash: moduleBeforeCallback.source_fiche.hash ?? "missing"
        },
        generated_at: new Date().toISOString(),
        generation_parameters: {},
        payload
      };

      const signedCallback = buildSignedCallbackEnvelope(successEnvelope);
      verifyN8nCallbackAuthentication({
        authorizationHeader: signedCallback.authorizationHeader,
        expectedToken: "test-fci-callback-token",
        timestampHeader: signedCallback.timestampHeader,
        signatureHeader: signedCallback.signatureHeader,
        rawBody: signedCallback.rawBody,
        secret: "test-fci-callback-secret",
        maxAgeMs: 300_000
      });
      const response = await applyFciN8nCallback(successEnvelope);
      assert.equal(response.httpStatus, 200);

      const moduleAfterCallback = await getFciModule(code, "C", OPERATIONS_USER);
      assert.equal(moduleAfterCallback.module.status, "needs_review");
      assert.equal(moduleAfterCallback.module.validated_at, null);
      assert.equal(moduleAfterCallback.latest_data?.version, 1);

      // The AI contract shape is rendered into the departmental UI form
      // before persistence (c3_moyens_capacite rows use different field
      // names than capacite_absorption_globale), so this checks the actual
      // stored shape rather than the AI envelope.
      const persistedEnvelope = moduleAfterCallback.latest_data?.data as
        | { data?: { c3_moyens_capacite?: Array<Record<string, Record<string, unknown>>> } }
        | undefined;
      const persistedCapacityRow = persistedEnvelope?.data?.c3_moyens_capacite?.[0];
      assert.ok(persistedCapacityRow);
      assert.equal(persistedCapacityRow.disponible_demarrage?.value, null);
      assert.equal(persistedCapacityRow.disponible_demarrage?.source, "human");
      assert.equal(persistedCapacityRow.disponible_demarrage?.review_status, "human_required");
    });
  });
});

test("FCI C generation callback with an unsupported historical claim fails closed and never falls back to Gemini", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);

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
              execution_id: "exec-fci-c-grounding-1",
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
          launchResult = await prepareFciGeneration(code, "C", OPERATIONS_USER);
        }
      );

      assert.ok(launchResult);
      if (!launchResult) {
        throw new Error("Expected FCI launch result.");
      }
      assert.equal(launchResult.job.provider, "local");

      const moduleBeforeCallback = await getFciModule(code, "C", OPERATIONS_USER);
      const workspace = await getFciWorkspace(code, OPERATIONS_USER);
      const payload = buildFciModulePayloadFixture({
        moduleCode: "C",
        sourceVersion: moduleBeforeCallback.source_fiche.version ?? "validated:missing",
        sourceHash: moduleBeforeCallback.source_fiche.hash ?? "missing",
        code
      });

      // A fabricated precedent claim with no support in the validated Fiche
      // or permitted context: exactly what future targeted RAG would need
      // to support with real evidence. Today it must be rejected, not kept.
      const roleRows = (payload.data as Record<string, unknown>)
        .repartition_des_composantes_techniques as Array<Record<string, Record<string, unknown>>>;
      if (roleRows[0]) {
        roleRows[0].commentaire_ou_risque = {
          value: "CONCEPT a déjà réalisé une mission très similaire avec ce client par le passé.",
          source_type: "ai_inference",
          confidence: "medium",
          requires_human_input: false,
          justification: "Signal de risque",
          source_references: []
        };
      }

      const failingEnvelope: FciN8nSuccessCallback = {
        event: "fci.generation.completed",
        contract_version: "1.0",
        generation_job_id: launchResult.job.id,
        fci_set_id: workspace.fci_set.id,
        fci_module_id: moduleBeforeCallback.module.id,
        appel_offre_id: workspace.appel_offres.id,
        code_interne: code,
        module_code: "C",
        correlation_id: launchResult.job.correlation_id ?? "missing",
        execution_id: "exec-fci-c-grounding-1",
        status: "completed",
        provider: launchResult.job.provider,
        model: launchResult.job.model,
        prompt_version: "1.1",
        schema_version: "1.1",
        source_fiche: {
          version: moduleBeforeCallback.source_fiche.version ?? "validated:missing",
          hash: moduleBeforeCallback.source_fiche.hash ?? "missing"
        },
        generated_at: new Date().toISOString(),
        generation_parameters: {},
        payload
      };

      const response = await applyFciN8nCallback(failingEnvelope);
      assert.equal(response.httpStatus, 422);
      assert.equal((response.body as { code?: string }).code, "AI_GROUNDING_VALIDATION_FAILED");

      const moduleAfterFailure = await getFciModule(code, "C", OPERATIONS_USER);
      // Fail closed: no data persisted, no silent Gemini retry, previous
      // (not-started) state restored rather than a fabricated success.
      assert.equal(moduleAfterFailure.latest_data, null);
      assert.equal(moduleAfterFailure.generation_job?.status, "failed");
      assert.equal(moduleAfterFailure.generation_job?.provider, "local");
    });
  });
});

async function assertNoModuleEventNotification(
  userId: number,
  code: string,
  eventType: string,
  moduleCode: string
) {
  const notifications = await listAppNotificationsForUser(userId, 50);
  assert.equal(
    notifications.some((notification) =>
      notification.appelOffreCode === code
      && notification.eventType === eventType
      && notification.moduleCode === moduleCode
    ),
    false
  );
}

async function runModuleLifecycleNotificationScenario(
  moduleCode: "A" | "B" | "C",
  actor: CurrentUser,
  recipient: CurrentUser,
  unrelated: CurrentUser[],
  expectPriorAssignedNotification: boolean
) {
  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);

    if (expectPriorAssignedNotification) {
      const assignedBefore = await listAppNotificationsForUser(Number(recipient.id), 50);
      assert.equal(
        assignedBefore.filter((notification) =>
          notification.appelOffreCode === code
          && notification.eventType === "FCI_ASSIGNED"
          && notification.moduleCode === moduleCode
        ).length,
        1
      );
    }

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
              execution_id: `exec-lifecycle-${moduleCode}`,
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
          launchResult = await prepareFciGeneration(code, moduleCode, actor);
        }
      );

      assert.ok(launchResult);
      if (!launchResult) {
        throw new Error("Expected FCI launch result.");
      }

      const startedDedupeKey =
        `fci-started:${code}:${moduleCode}:${launchResult.job.id}:${Number(recipient.id)}`;
      const afterStart = await listAppNotificationsForUser(Number(recipient.id), 50);
      const startedForRecipient = afterStart.filter((notification) =>
        notification.appelOffreCode === code
        && notification.eventType === "FCI_STARTED"
        && notification.moduleCode === moduleCode
      );
      assert.equal(startedForRecipient.length, 1);
      assert.equal(startedForRecipient[0]?.dedupeKey, startedDedupeKey);

      for (const other of unrelated) {
        await assertNoModuleEventNotification(Number(other.id), code, "FCI_STARTED", moduleCode);
      }

      const moduleBeforeCallback = await getFciModule(code, moduleCode, actor);
      const workspace = await getFciWorkspace(code, actor);
      const payload = buildFciModulePayloadFixture({
        moduleCode,
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
        module_code: moduleCode,
        correlation_id: launchResult.job.correlation_id ?? "missing",
        execution_id: `exec-lifecycle-${moduleCode}`,
        status: "completed",
        provider: launchResult.job.provider,
        model: launchResult.job.model,
        prompt_version: "1.1",
        schema_version: "1.1",
        source_fiche: {
          version: moduleBeforeCallback.source_fiche.version ?? "validated:missing",
          hash: moduleBeforeCallback.source_fiche.hash ?? "missing"
        },
        generated_at: new Date().toISOString(),
        generation_parameters: {},
        payload
      };

      const firstResponse = await applyFciN8nCallback(successEnvelope);
      assert.equal(firstResponse.httpStatus, 200);

      const completedDedupeKey =
        `fci-completed:${code}:${moduleCode}:${launchResult.job.id}:${Number(recipient.id)}`;
      const afterCompletion = await listAppNotificationsForUser(Number(recipient.id), 50);
      const completedForRecipient = afterCompletion.filter((notification) =>
        notification.appelOffreCode === code
        && notification.eventType === "FCI_COMPLETED"
        && notification.moduleCode === moduleCode
      );
      assert.equal(completedForRecipient.length, 1);
      assert.equal(completedForRecipient[0]?.dedupeKey, completedDedupeKey);

      for (const other of unrelated) {
        await assertNoModuleEventNotification(Number(other.id), code, "FCI_COMPLETED", moduleCode);
      }

      const duplicateResponse = await applyFciN8nCallback(successEnvelope);
      assert.equal(duplicateResponse.httpStatus, 200);
      assert.equal(duplicateResponse.body.idempotent, true);

      const afterDuplicate = await listAppNotificationsForUser(Number(recipient.id), 50);
      assert.equal(
        afterDuplicate.filter((notification) =>
          notification.appelOffreCode === code
          && notification.eventType === "FCI_COMPLETED"
          && notification.moduleCode === moduleCode
        ).length,
        1
      );
      assert.equal(
        afterDuplicate.filter((notification) =>
          notification.appelOffreCode === code
          && notification.eventType === "FCI_STARTED"
          && notification.moduleCode === moduleCode
        ).length,
        1
      );
      if (expectPriorAssignedNotification) {
        assert.equal(
          afterDuplicate.filter((notification) =>
            notification.appelOffreCode === code
            && notification.eventType === "FCI_ASSIGNED"
            && notification.moduleCode === moduleCode
          ).length,
          1
        );
      }
    });
  });
}

test("FCI_STARTED/FCI_COMPLETED notify the Commercial owner for module A exactly once and stay isolated from other roles", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  await loadPersistedActors();
  await runModuleLifecycleNotificationScenario(
    "A",
    COMMERCIAL_USER,
    COMMERCIAL_USER,
    [FINANCE_USER, OPERATIONS_USER, DIRECTION_GENERALE_USER],
    false
  );
});

test("FCI_STARTED/FCI_COMPLETED notify the assigned Finance user for module B exactly once and stay isolated from other roles", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  await loadPersistedActors();
  await runModuleLifecycleNotificationScenario(
    "B",
    FINANCE_USER,
    FINANCE_USER,
    [COMMERCIAL_USER, OPERATIONS_USER, DIRECTION_GENERALE_USER],
    true
  );
});

test("FCI_STARTED/FCI_COMPLETED notify the assigned Operations user for module C exactly once and stay isolated from other roles", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  await loadPersistedActors();
  await runModuleLifecycleNotificationScenario(
    "C",
    OPERATIONS_USER,
    OPERATIONS_USER,
    [COMMERCIAL_USER, FINANCE_USER, DIRECTION_GENERALE_USER],
    true
  );
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
        prompt_version: "1.1",
        schema_version: "1.1",
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
    await initializeFciWorkspace(code, COMMERCIAL_USER);
    const workspace = await getFciWorkspace(code, COMMERCIAL_USER);
    const module = await getFciModule(code, "D", COMMERCIAL_USER);
    const generationJob = await createFciGenerationJob(module.module.id, {
      triggerType: "automatic",
      provider: "gemini",
      model: "gemini-3.6-flash",
      status: "running",
      contractVersion: "1.0",
      schemaVersion: "1.1",
      promptVersion: "1.1",
      generationParameters: {
        previous_module_status: "not_started"
      },
      sourceFicheVersion: module.source_fiche.version ?? "validated:missing",
      sourceFicheHash: module.source_fiche.hash ?? "missing",
      executionId: "exec-fci-invalid-payload-1",
      correlationId: "corr-fci-invalid-payload-1",
      startedAt: new Date().toISOString()
    });

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
      generation_job_id: generationJob.id,
      fci_set_id: workspace.fci_set.id,
      fci_module_id: module.module.id,
      appel_offre_id: workspace.appel_offres.id,
      code_interne: code,
      module_code: "D",
      correlation_id: generationJob.correlationId ?? "missing",
      execution_id: "exec-fci-invalid-payload-1",
      status: "completed",
      provider: "gemini",
      model: "gemini-3.6-flash",
      prompt_version: "1.1",
      schema_version: "1.1",
      source_fiche: {
        version: module.source_fiche.version ?? "validated:missing",
        hash: module.source_fiche.hash ?? "missing"
      },
      generated_at: new Date().toISOString(),
      generation_parameters: {
        finish_reason: "length",
        usage: { completion_tokens: 12000, prompt_tokens: 500 }
      },
      payload: invalidPayload
    } satisfies FciN8nSuccessCallback);

    assert.equal(response.httpStatus, 422);

    const moduleAfterFailure = await getFciModule(code, "D", COMMERCIAL_USER);
    assert.equal(moduleAfterFailure.module.status, "not_started");
    assert.equal(moduleAfterFailure.generation_job?.status, "failed");
    assert.equal(moduleAfterFailure.latest_data, null);

    // Gemini's finish_reason/usage must survive into our stored
    // generation_parameters so a real truncation (finish_reason: "length")
    // can be told apart from a genuine malformed-response failure without
    // re-running generation.
    if (cleanupPool) {
      const jobRow = await cleanupPool.query(
        "select generation_parameters from public.fci_generation_jobs where id = $1",
        [moduleAfterFailure.generation_job?.id]
      );
      assert.equal(jobRow.rows[0]?.generation_parameters?.callback_finish_reason, "length");
      assert.equal(
        jobRow.rows[0]?.generation_parameters?.callback_usage?.completion_tokens,
        12000
      );
    }
  });
});

test("failure callbacks preserve the previously validated version during regeneration", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);
    await saveFciModuleEdits(code, "C", {
      data: buildCompletedDepartmentPayload("C"),
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: "Bob Durand",
      expectedVersion: null
    }, OPERATIONS_USER);
    await validateFciModule(code, "C", {
      validatedBy: "Bob Durand",
      comment: null,
      expectedVersion: 1,
      acknowledgeStaleSource: false
    }, OPERATIONS_USER);

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
          launchResult = await prepareFciRegeneration(code, "C", OPERATIONS_USER);
        }
      );

      assert.ok(launchResult);
      if (!launchResult) {
        throw new Error("Expected FCI regeneration launch result.");
      }
      const workspace = await getFciWorkspace(code, COMMERCIAL_USER);
      const module = await getFciModule(code, "C", OPERATIONS_USER);
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
        prompt_version: "1.1",
        schema_version: "1.1",
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

      const moduleAfterFailure = await getFciModule(code, "C", COMMERCIAL_USER);
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

test("DG edits FCI D and keeps final decision rights", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);
    await markWorkflowSubmittedForDgAccess(code);

    const commercialModule = await getFciModule(code, "A", COMMERCIAL_USER);
    const financeReadonlyModule = await getFciModule(code, "B", COMMERCIAL_USER);
    const operationsModule = await getFciModule(code, "C", OPERATIONS_USER);
    const dgModule = await getFciModule(code, "D", DIRECTION_GENERALE_USER);

    assert.equal(commercialModule.permissions.can_edit, true);
    assert.equal(commercialModule.permissions.read_only, false);
    assert.deepEqual(commercialModule.allowed_actions, ["view_history"]);

    assert.equal(financeReadonlyModule.permissions.can_edit, false);
    assert.equal(financeReadonlyModule.permissions.read_only, true);
    assert.deepEqual(financeReadonlyModule.allowed_actions, ["view_history"]);
    assert.match(financeReadonlyModule.permissions.read_only_message ?? "", /Lecture seule/i);

    assert.equal(operationsModule.permissions.can_edit, true);
    assert.equal(dgModule.permissions.can_edit, true);
    // D generation stays blocked here: A/B/C are freshly initialized
    // (not_started), not human-validated yet - see the dedicated
    // "FCI D generation prerequisites" tests below for the full gate.
    assert.equal(dgModule.permissions.can_generate, false);
    assert.deepEqual(dgModule.missing_prerequisite_modules, ["A", "B", "C"]);
    assert.equal(dgModule.permissions.can_validate, true);
    assert.equal(dgModule.permissions.read_only, false);
    assert.equal(dgModule.permissions.can_make_final_decision, true);
  });
});

async function bringModuleToNeedsReview(
  code: string,
  moduleCode: "A" | "B" | "C",
  actor: CurrentUser
) {
  await saveFciModuleEdits(code, moduleCode, {
    data: buildCompletedDepartmentPayload(moduleCode),
    sourceSummary: null,
    confidence: null,
    aiNotes: null,
    editor: actor.name,
    expectedVersion: null
  }, actor);
}

async function validateDepartmentModule(
  code: string,
  moduleCode: "A" | "B" | "C",
  actor: CurrentUser
) {
  await validateFciModule(code, moduleCode, {
    validatedBy: actor.name,
    comment: null,
    expectedVersion: 1,
    acknowledgeStaleSource: false
  }, actor);
}

async function completeAndValidateModule(
  code: string,
  moduleCode: "A" | "B" | "C",
  actor: CurrentUser
) {
  await bringModuleToNeedsReview(code, moduleCode, actor);
  await validateDepartmentModule(code, moduleCode, actor);
}

test("FCI D generation is blocked when only Commercial (A) is not yet validated", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  await loadPersistedActors();
  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);
    await bringModuleToNeedsReview(code, "A", COMMERCIAL_USER);
    await completeAndValidateModule(code, "B", FINANCE_USER);
    await completeAndValidateModule(code, "C", OPERATIONS_USER);

    await assert.rejects(
      () => prepareFciGeneration(code, "D", DIRECTION_GENERALE_USER),
      (error: unknown) => {
        assert.ok(error instanceof FciServiceError);
        assert.equal(error.code, "FCI_D_PREREQUISITES_NOT_VALIDATED");
        assert.deepEqual(error.details?.missing_modules, ["A"]);
        return true;
      }
    );

    const dModule = await getFciModule(code, "D", DIRECTION_GENERALE_USER);
    assert.equal(dModule.permissions.can_generate, false);
    assert.deepEqual(dModule.missing_prerequisite_modules, ["A"]);
    assert.match(dModule.permissions.generation_blocked_reason ?? "", /Commerciale/);
  });
});

test("FCI D generation is blocked when only Finance (B) is not yet validated", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  await loadPersistedActors();
  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);
    await completeAndValidateModule(code, "A", COMMERCIAL_USER);
    await bringModuleToNeedsReview(code, "B", FINANCE_USER);
    await completeAndValidateModule(code, "C", OPERATIONS_USER);

    await assert.rejects(
      () => prepareFciGeneration(code, "D", DIRECTION_GENERALE_USER),
      (error: unknown) =>
        error instanceof FciServiceError
        && error.code === "FCI_D_PREREQUISITES_NOT_VALIDATED"
        && Array.isArray((error.details as { missing_modules?: unknown[] } | null)?.missing_modules)
        && JSON.stringify((error.details as { missing_modules: unknown[] }).missing_modules) === JSON.stringify(["B"])
    );
  });
});

test("FCI D generation is blocked when only Operations (C) is not yet validated", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  await loadPersistedActors();
  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);
    await completeAndValidateModule(code, "A", COMMERCIAL_USER);
    await completeAndValidateModule(code, "B", FINANCE_USER);
    await bringModuleToNeedsReview(code, "C", OPERATIONS_USER);

    await assert.rejects(
      () => prepareFciGeneration(code, "D", DIRECTION_GENERALE_USER),
      (error: unknown) =>
        error instanceof FciServiceError
        && error.code === "FCI_D_PREREQUISITES_NOT_VALIDATED"
        && Array.isArray((error.details as { missing_modules?: unknown[] } | null)?.missing_modules)
        && JSON.stringify((error.details as { missing_modules: unknown[] }).missing_modules) === JSON.stringify(["C"])
    );
  });
});

test("FCI D generation is permitted once A, B and C are all validated, and its AI context carries only the validated contributions", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  await loadPersistedActors();
  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);
    await completeAndValidateModule(code, "A", COMMERCIAL_USER);
    await completeAndValidateModule(code, "B", FINANCE_USER);
    await completeAndValidateModule(code, "C", OPERATIONS_USER);

    const dModuleBefore = await getFciModule(code, "D", DIRECTION_GENERALE_USER);
    assert.equal(dModuleBefore.permissions.can_generate, true);
    assert.deepEqual(dModuleBefore.missing_prerequisite_modules, []);
    assert.equal(dModuleBefore.permissions.generation_blocked_reason, null);

    type CapturedLaunchRequest = {
      generation_job_id?: number;
      correlation_id?: string;
      generation_metadata?: {
        strategic_context?: {
          commercial: { available: boolean };
          finance: { available: boolean };
          operations: { available: boolean };
        };
      };
    };
    const captured: { body: CapturedLaunchRequest | null } = { body: null };

    await withFciEnv({}, async () => {
      await withMockFetch(
        (async (_input, init) => {
          captured.body = JSON.parse(String(init?.body ?? "{}")) as CapturedLaunchRequest;
          return new Response(
            JSON.stringify({
              contract_version: "1.0",
              accepted: true,
              generation_job_id: captured.body?.generation_job_id ?? null,
              correlation_id: captured.body?.correlation_id ?? null,
              execution_id: "exec-fci-d-1",
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
          const launchResult = await prepareFciGeneration(code, "D", DIRECTION_GENERALE_USER);
          assert.ok(launchResult);
        }
      );
    });

    assert.ok(captured.body);
    const strategicContext = captured.body?.generation_metadata?.strategic_context;
    assert.ok(strategicContext);
    assert.equal(strategicContext?.commercial.available, true);
    assert.equal(strategicContext?.finance.available, true);
    assert.equal(strategicContext?.operations.available, true);
  });
});

test("unauthorized FCI edits, validations, and reads return RBAC_FORBIDDEN for non-owners and ADMIN", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);

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
      isForbiddenWorkflowOrFciError
    );

    await assert.rejects(
      () =>
        saveFciModuleEdits(code, "D", {
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
        }, ADMIN_USER),
      isForbiddenWorkflowOrFciError
    );

    await assert.rejects(
      () =>
        saveFciModuleEdits(code, "D", {
          data: {
            d1_valeur_strategique: {
              programme_pluriannuel: true
            }
          },
          sourceSummary: null,
          confidence: null,
          aiNotes: null,
          editor: COMMERCIAL_USER.name,
          expectedVersion: null
        }, COMMERCIAL_USER),
      isForbiddenWorkflowOrFciError
    );

    await assert.rejects(
      () =>
        saveFciModuleEdits(code, "A", {
          data: { section: "commercial-cannot-overwrite-after-owner-save" },
          sourceSummary: null,
          confidence: null,
          aiNotes: null,
          editor: FINANCE_USER.name,
          expectedVersion: null
        }, FINANCE_USER),
      isForbiddenWorkflowOrFciError
    );

    await saveFciModuleEdits(code, "A", {
      data: { section: "commercial-owner-draft" },
      sourceSummary: null,
      confidence: null,
      aiNotes: null,
      editor: COMMERCIAL_USER.name,
      expectedVersion: null
    }, COMMERCIAL_USER);

    await assert.rejects(
      () =>
        validateFciModule(code, "A", {
          validatedBy: FINANCE_USER.name,
          comment: null,
          expectedVersion: 1,
          acknowledgeStaleSource: false
        }, FINANCE_USER),
      isForbiddenWorkflowOrFciError
    );

    await assert.rejects(
      () => getFciWorkspace(code, ADMIN_USER),
      (error: unknown) =>
        error instanceof FciServiceError
        && error.code === "RBAC_FORBIDDEN"
        && error.status === 403
    );

    await assert.rejects(
      () => getFciModule(code, "A", ADMIN_USER),
      (error: unknown) =>
        error instanceof FciServiceError
        && error.code === "RBAC_FORBIDDEN"
        && error.status === 403
    );

    await assert.rejects(
      () => getFciModuleHistory(code, "A", ADMIN_USER),
      (error: unknown) =>
        error instanceof FciServiceError
        && error.code === "RBAC_FORBIDDEN"
        && error.status === 403
    );
  });
});

test("unauthorized generation is denied for non-owner business roles and for ADMIN", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);

    await assert.rejects(
      () => prepareFciGeneration(code, "B", COMMERCIAL_USER),
      (error: unknown) =>
        error instanceof FciServiceError
        && error.code === "RBAC_FORBIDDEN"
        && error.status === 403
    );

    await assert.rejects(
      () => prepareFciGeneration(code, "B", ADMIN_USER),
      isForbiddenWorkflowOrFciError
    );
  });
});

test("DG owns FCI D but remains forbidden from mutating FCI A", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const code = await createTestAppelOffres({});

  await withKnowledgeBaseEnabled(false, async () => {
    await initializeAssignedFciWorkspace(code);
    const moduleD = await getFciModule(code, "D", DIRECTION_GENERALE_USER);
    assert.equal(moduleD.permissions.can_edit, true);
    // A/B/C are freshly initialized (not_started, not validated), so D
    // generation stays blocked regardless of DG's RBAC ownership of D.
    assert.equal(moduleD.permissions.can_generate, false);
    assert.equal(moduleD.permissions.can_validate, true);

    await assert.rejects(
      () => prepareFciGeneration(code, "A", DIRECTION_GENERALE_USER),
      isForbiddenWorkflowOrFciError
    );
    await assert.rejects(
      () => prepareFciGeneration(code, "D", COMMERCIAL_USER),
      (error: unknown) =>
        error instanceof FciServiceError
        && error.code === "RBAC_FORBIDDEN"
        && error.status === 403
        && error.details?.module_code === "D"
    );
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
