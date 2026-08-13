import test, { after } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import nextEnv from "@next/env";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { serializeFiche } from "../../fiche-xml.ts";
import {
  DATA_ROOT,
  createDraftBundle,
  markFicheValidated,
  projectDir
} from "../../storage.ts";
import type { FichePayload } from "../../types.ts";
import {
  EVALUATION_FIELD_DEFINITIONS,
  EXTRACTION_FIELD_DEFINITIONS
} from "../../types.ts";
import {
  closeAppelsOffresPool,
  createAppelOffres,
  ensureAppelsOffresSchema
} from "../repository.ts";
import {
  closeFciPool,
  ensureFciSchema,
  getFciDetailByAppelOffresCode,
  listFciModulesByAppelOffresCode,
  upsertFciModuleData,
  updateFciModule
} from "../fci/repository.ts";
import { getFciModule, initializeFciWorkspace } from "../fci/service.ts";
import { getSeededActors } from "../test-actors.ts";
import {
  closeUsersPool,
  createUser
} from "../../users/repository.ts";
import {
  closeNotificationsPool,
  listAppNotificationsForUser
} from "../../notifications/repository.ts";
import type { UserMutationInput } from "../../users/types.ts";
import {
  assignFciModule,
  deriveTenderWorkflowState,
  emitReadyForGoNoGoNotifications,
  sendAssignmentReminder,
  getAssignmentsForTender,
  prepareGoNoGo,
  reassignFciModule,
  submitGoNoGoToDg,
  WorkflowServiceError
} from "./service.ts";
import { closeWorkflowPool } from "./repository.ts";
import {
  generateGoNoGoReport,
  saveGoNoGoReportDraft
} from "../go-no-go-report/service.ts";
import { assignCommercialOwner } from "../ownership.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const cleanupPool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;
const cleanupCodes = new Set<string>();
const cleanupUserIds = new Set<number>();

function hasDatabase() {
  return Boolean(databaseUrl && cleanupPool);
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

async function createWorkflowTender() {
  const code = `AO-WF-${randomUUID().slice(0, 8).toUpperCase()}`;
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
    responsableCommercial: "Claire Martin",
    status: "ready",
    businessStatus: "fiche_validee",
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

  const actors = await getSeededActors();
  await initializeFciWorkspace(code, actors.commercial);
  await assignCommercialOwner({
    code,
    newOwnerUserId: Number(actors.commercial.id),
    currentUser: actors.commercial,
    reason: "workflow_test_setup"
  });

  return { code, actors };
}

async function createTempUser(input: UserMutationInput) {
  const user = await createUser(input);
  assert.ok(user, "Expected temporary user to be created.");
  cleanupUserIds.add(user.id);
  return user;
}

async function markContributingModulesValidated(code: string) {
  const modules = await listFciModulesByAppelOffresCode(code);
  const now = new Date().toISOString();

  for (const module of modules) {
    if (module.moduleCode === "A" || module.moduleCode === "B" || module.moduleCode === "C" || module.moduleCode === "D") {
      await upsertFciModuleData(module.id, {
        dataJson: {
          summary: {
            status: "complete",
            completion_percentage: 100
          },
          module_code: module.moduleCode,
          generated_for_test: true
        },
        sourceSummaryJson: null,
        confidenceJson: null,
        aiNotesJson: null,
        version: 1,
        generatedFromFicheVersion: "validated:test",
        generatedFromFicheHash: "test-hash"
      });
      await updateFciModule(module.id, {
        status: "validated",
        validatedAt: now,
        validatedBy: "Workflow test"
      });
    }
  }
}

async function prepareMinimalGoNoGoReport(
  code: string,
  actor: Awaited<ReturnType<typeof getSeededActors>>["commercial"]
) {
  const report = await generateGoNoGoReport(code, actor);
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
    actor
  );
}

test("Commercial can assign B/C/D, but cannot assign module A", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const { code, actors } = await createWorkflowTender();

  const assignmentB = await assignFciModule({
    code,
    moduleCode: "B",
    assignedUserId: Number(actors.finance.id),
    currentUser: actors.commercial
  });
  const assignmentC = await assignFciModule({
    code,
    moduleCode: "C",
    assignedUserId: Number(actors.operations.id),
    currentUser: actors.commercial
  });
  const assignmentD = await assignFciModule({
    code,
    moduleCode: "D",
    assignedUserId: Number(actors.dg.id),
    currentUser: actors.commercial
  });

  assert.equal(assignmentB.moduleCode, "B");
  assert.equal(assignmentC.moduleCode, "C");
  assert.equal(assignmentD.moduleCode, "D");

  const assignments = await getAssignmentsForTender(code);
  assert.equal(assignments.length, 3);
  assert.deepEqual(
    assignments.map((assignment) => assignment.moduleCode),
    ["B", "C", "D"]
  );

  const workflow = await deriveTenderWorkflowState(code);
  assert.equal(workflow.explicit_state, "FCI_ASSIGNED");
  assert.equal(workflow.assignments_complete, true);

  await assert.rejects(
    () =>
      assignFciModule({
        code,
        moduleCode: "A" as never,
        assignedUserId: Number(actors.commercial.id),
        currentUser: actors.commercial
      }),
    (error: unknown) =>
      error instanceof WorkflowServiceError
      && error.code === "FCI_MODULE_NOT_ASSIGNABLE"
      && error.status === 422
  );
});

test("assignment targets must match module role and stay active", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const { code, actors } = await createWorkflowTender();
  const inactiveFinance = await createTempUser({
    firstName: "Ines",
    lastName: "Finance",
    email: `ines.finance.${randomUUID().slice(0, 8)}@concept.local`,
    jobTitle: "Analyste finance inactive",
    departmentCode: "FINANCE",
    role: "FINANCE",
    status: "INACTIVE",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris"
  });

  await assert.rejects(
    () =>
      assignFciModule({
        code,
        moduleCode: "B",
        assignedUserId: Number(actors.operations.id),
        currentUser: actors.commercial
      }),
    (error: unknown) =>
      error instanceof WorkflowServiceError
      && error.code === "ASSIGNMENT_INVALID_TARGET"
      && error.status === 422
  );

  await assert.rejects(
    () =>
      assignFciModule({
        code,
        moduleCode: "C",
        assignedUserId: Number(actors.finance.id),
        currentUser: actors.commercial
      }),
    (error: unknown) =>
      error instanceof WorkflowServiceError
      && error.code === "ASSIGNMENT_INVALID_TARGET"
      && error.status === 422
  );

  await assert.rejects(
    () =>
      assignFciModule({
        code,
        moduleCode: "B",
        assignedUserId: inactiveFinance.id,
        currentUser: actors.commercial
      }),
    (error: unknown) =>
      error instanceof WorkflowServiceError
      && error.code === "ASSIGNMENT_TARGET_INACTIVE"
      && error.status === 422
  );
});

test("Finance and Operations cannot access unassigned departmental modules", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const { code, actors } = await createWorkflowTender();

  await assert.rejects(
    () => getFciModule(code, "B", actors.finance),
    (error: unknown) =>
      error instanceof WorkflowServiceError
      && error.code === "ASSIGNMENT_FORBIDDEN"
      && error.status === 403
  );

  await assert.rejects(
    () => getFciModule(code, "C", actors.operations),
    (error: unknown) =>
      error instanceof WorkflowServiceError
      && error.code === "ASSIGNMENT_FORBIDDEN"
      && error.status === 403
  );
});

test("reassignment is audited and updates the assignee", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const { code, actors } = await createWorkflowTender();
  const secondFinance = await createTempUser({
    firstName: "Fatou",
    lastName: "Finance",
    email: `fatou.finance.${randomUUID().slice(0, 8)}@concept.local`,
    jobTitle: "Controleuse financiere",
    departmentCode: "FINANCE",
    role: "FINANCE",
    status: "ACTIVE",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris"
  });

  await assignFciModule({
    code,
    moduleCode: "B",
    assignedUserId: Number(actors.finance.id),
    currentUser: actors.commercial
  });

  const reassigned = await reassignFciModule({
    code,
    moduleCode: "B",
    assignedUserId: secondFinance.id,
    currentUser: actors.commercial
  });

  assert.equal(reassigned.assignedUserId, secondFinance.id);
  assert.ok(reassigned.reassignedAt);

  const detail = await getFciDetailByAppelOffresCode(code);
  assert.ok(detail);
  assert.equal(
    detail?.auditEvents.some((event) => event.eventType === "fci.assignment.changed"),
    true
  );
});

test("assignment and reminder create persisted notifications for the assignee", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const { code, actors } = await createWorkflowTender();
  await assignFciModule({
    code,
    moduleCode: "B",
    assignedUserId: Number(actors.finance.id),
    currentUser: actors.commercial
  });

  let notifications = await listAppNotificationsForUser(Number(actors.finance.id), 10);
  assert.equal(
    notifications.some((notification) => notification.eventType === "FCI_ASSIGNED"),
    true
  );

  await sendAssignmentReminder({
    code,
    moduleCode: "B",
    currentUser: actors.commercial
  });

  notifications = await listAppNotificationsForUser(Number(actors.finance.id), 10);
  assert.equal(
    notifications.some((notification) => notification.eventType === "REMINDER_SENT"),
    true
  );

  const detail = await getFciDetailByAppelOffresCode(code);
  assert.equal(
    detail?.auditEvents.some((event) => event.eventType === "fci.reminder.sent"),
    true
  );
});

test("READY_FOR_GONOGO requires A/B/C/D, then Commercial prepares and submits to DG", async (t) => {
  if (!hasDatabase()) {
    t.skip("DATABASE_URL is not configured.");
    return;
  }

  const { code, actors } = await createWorkflowTender();
  await assignFciModule({
    code,
    moduleCode: "B",
    assignedUserId: Number(actors.finance.id),
    currentUser: actors.commercial
  });
  await assignFciModule({
    code,
    moduleCode: "C",
    assignedUserId: Number(actors.operations.id),
    currentUser: actors.commercial
  });
  await assignFciModule({
    code,
    moduleCode: "D",
    assignedUserId: Number(actors.dg.id),
    currentUser: actors.commercial
  });

  let workflow = await deriveTenderWorkflowState(code);
  assert.equal(workflow.ready_for_gonogo, false);
  assert.equal(workflow.derived_state, "FCI_IN_PROGRESS");

  const modules = await listFciModulesByAppelOffresCode(code);
  const moduleC = modules.find((module) => module.moduleCode === "C");
  assert.ok(moduleC, "Expected module C to exist.");
  await updateFciModule(moduleC!.id, {
    status: "validated",
    validatedAt: new Date().toISOString(),
    validatedBy: "Workflow test"
  });

  workflow = await deriveTenderWorkflowState(code);
  assert.equal(workflow.ready_for_gonogo, false);

  await markContributingModulesValidated(code);
  await emitReadyForGoNoGoNotifications(code, actors.commercial);
  workflow = await deriveTenderWorkflowState(code);
  assert.equal(workflow.ready_for_gonogo, true);
  assert.equal(workflow.derived_state, "READY_FOR_GONOGO");

  await prepareMinimalGoNoGoReport(code, actors.commercial);
  await prepareGoNoGo(code, actors.commercial);
  workflow = await deriveTenderWorkflowState(code);
  assert.equal(workflow.explicit_state, "GONOGO_PREPARED");

  let commercialNotifications = await listAppNotificationsForUser(Number(actors.commercial.id), 20);
  assert.equal(
    commercialNotifications.some((notification) =>
      notification.eventType === "READY_FOR_GONOGO" && notification.appelOffreCode === code
    ),
    true
  );
  assert.equal(
    commercialNotifications.filter((notification) =>
      notification.eventType === "READY_FOR_GONOGO" && notification.appelOffreCode === code
    ).length,
    1
  );

  await submitGoNoGoToDg(code, actors.commercial);
  workflow = await deriveTenderWorkflowState(code);
  assert.equal(workflow.explicit_state, "SUBMITTED_TO_DG");
  assert.equal(workflow.submitted_to_dg, true);

  const dgNotifications = await listAppNotificationsForUser(Number(actors.dg.id), 20);
  assert.equal(
    dgNotifications.filter((notification) =>
      (
        notification.eventType === "SUBMITTED_TO_DG"
        || notification.eventType === "GONOGO_REPORT_SUBMITTED"
      )
      && notification.appelOffreCode === code
    ).length,
    1
  );

  await submitGoNoGoToDg(code, actors.commercial);
  commercialNotifications = await listAppNotificationsForUser(Number(actors.commercial.id), 20);
  assert.equal(
    commercialNotifications.filter((notification) =>
      notification.eventType === "READY_FOR_GONOGO" && notification.appelOffreCode === code
    ).length,
    1
  );
});

after(async () => {
  if (cleanupPool) {
    for (const code of cleanupCodes) {
      await cleanupPool.query("delete from public.appels_offres where code = $1", [code]);
      await fs.rm(projectDir(code), { recursive: true, force: true });
    }

    for (const userId of cleanupUserIds) {
      await cleanupPool.query("delete from public.app_users where id = $1", [userId]);
    }

    await cleanupPool.end();
  }

  await Promise.all([
    closeNotificationsPool(),
    closeWorkflowPool(),
    closeFciPool(),
    closeAppelsOffresPool(),
    closeUsersPool()
  ]);
});
