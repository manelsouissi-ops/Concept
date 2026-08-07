import assert from "node:assert/strict";
import test from "node:test";
import { buildCommercialWorkspacePresentation } from "./commercial-workspace.ts";
import type { FciDetail } from "./fci/types.ts";
import type { GoNoGoDecisionRecord } from "./go-no-go/types.ts";
import type { CurrentUser } from "../auth/rbac.ts";
import type { AppelOffresDetail } from "./types.ts";
import type { TenderWorkflowStateView } from "./workflow/service.ts";

function buildUser(): CurrentUser {
  return {
    id: "2",
    firstName: "Claire",
    name: "Claire Martin",
    email: "claire.martin@concept.local",
    role: "COMMERCIAL",
    status: "ACTIVE",
    departmentCode: "COMMERCIAL",
    departmentLabel: "Commercial",
    jobTitle: "Responsable commerciale",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris",
    lastLoginAt: null,
    createdAt: "2026-08-01T08:00:00.000Z",
    isDevelopmentUser: true
  };
}

function buildDetail(overrides: Partial<AppelOffresDetail>): AppelOffresDetail {
  return {
    id: overrides.id ?? 1,
    code: overrides.code ?? "AO-TEST",
    title: overrides.title ?? "AO de test",
    reference: overrides.reference ?? "",
    buyer: overrides.buyer ?? "Client test",
    country: overrides.country ?? "SN",
    dueDate: overrides.dueDate ?? "2026-08-20T00:00:00.000Z",
    notes: overrides.notes ?? "",
    priorite: overrides.priorite ?? "normale",
    responsableCommercial: overrides.responsableCommercial ?? "Claire Martin",
    commercialOwnerUserId:
      overrides.commercialOwnerUserId !== undefined ? overrides.commercialOwnerUserId : 2,
    commercialOwnerAssignedAt:
      overrides.commercialOwnerAssignedAt !== undefined
        ? overrides.commercialOwnerAssignedAt
        : "2026-08-01T09:00:00.000Z",
    commercialOwnerAssignedByUserId:
      overrides.commercialOwnerAssignedByUserId !== undefined
        ? overrides.commercialOwnerAssignedByUserId
        : 2,
    commercialOwnerPreviousUserId:
      overrides.commercialOwnerPreviousUserId !== undefined
        ? overrides.commercialOwnerPreviousUserId
        : null,
    commercialOwnerReason:
      overrides.commercialOwnerReason !== undefined ? overrides.commercialOwnerReason : null,
    commercialOwnerUpdatedAt:
      overrides.commercialOwnerUpdatedAt !== undefined
        ? overrides.commercialOwnerUpdatedAt
        : "2026-08-02T09:00:00.000Z",
    commercialOwnerStatus:
      overrides.commercialOwnerStatus !== undefined ? overrides.commercialOwnerStatus : "ACTIVE",
    status: overrides.status ?? "ready",
    businessStatus: overrides.businessStatus ?? "fiche_validee",
    source: overrides.source ?? "manual",
    createdAt: overrides.createdAt ?? "2026-08-01T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-08-02T09:00:00.000Z",
    archivedAt: overrides.archivedAt ?? null,
    documents: overrides.documents ?? [],
    latestJob: overrides.latestJob ?? null,
    processingJobs: overrides.processingJobs ?? [],
    auditLogs: overrides.auditLogs ?? [],
    artifacts: overrides.artifacts ?? {
      hasSourcePdf: true,
      hasFicheXml: true,
      hasFicheMarkdown: false,
      hasStatusJson: true
    },
    ficheStatus: overrides.ficheStatus ?? null
  };
}

function buildFciDetail(statusByModule: Record<"A" | "B" | "C", FciDetail["modules"][number]["status"]>): FciDetail {
  return {
    set: {
      id: 100,
      appelOffresId: 1,
      sourceFicheVersion: "validated:2026-08-01T08:00:00.000Z",
      sourceFicheHash: "hash-1",
      sourceFicheUpdatedAt: "2026-08-01T08:00:00.000Z",
      overallStatus: "in_progress",
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-02T09:00:00.000Z"
    },
    modules: (["A", "B", "C"] as const).map((moduleCode, index) => ({
      id: 200 + index,
      fciSetId: 100,
      moduleCode,
      moduleType: moduleCode === "A" ? "commercial" : moduleCode === "B" ? "finance" : "operations",
      status: statusByModule[moduleCode],
      aiGeneratedAt: null,
      validatedAt: statusByModule[moduleCode] === "validated" ? "2026-08-02T14:00:00.000Z" : null,
      validatedBy: statusByModule[moduleCode] === "validated" ? "Equipe" : null,
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-02T10:00:00.000Z"
    })),
    moduleData: [],
    generationJobs: [],
    auditEvents: []
  };
}

function buildWorkflow(
  overrides: Partial<TenderWorkflowStateView>
): TenderWorkflowStateView {
  return {
    appel_offres_id: overrides.appel_offres_id ?? 1,
    code: overrides.code ?? "AO-TEST",
    explicit_state: overrides.explicit_state ?? "FCI_GENERATED",
    derived_state: overrides.derived_state ?? "FCI_IN_PROGRESS",
    current_state: overrides.current_state ?? "FCI_GENERATED",
    ready_for_gonogo: overrides.ready_for_gonogo ?? false,
    submitted_to_dg: overrides.submitted_to_dg ?? false,
    under_dg_review: overrides.under_dg_review ?? false,
    assignments_complete: overrides.assignments_complete ?? false,
    assignments: overrides.assignments ?? []
  };
}

function buildDecision(overrides: Partial<GoNoGoDecisionRecord>): GoNoGoDecisionRecord {
  return {
    id: overrides.id ?? 1,
    appelOffresId: overrides.appelOffresId ?? 1,
    version: overrides.version ?? 1,
    status: overrides.status ?? "go",
    decision: overrides.decision ?? "go",
    rationale: overrides.rationale ?? "Rationale",
    reserves: overrides.reserves ?? null,
    decidedBy: overrides.decidedBy ?? "Isabelle Moreau",
    decidedAt: overrides.decidedAt ?? "2026-08-03T10:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-08-03T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-08-03T10:00:00.000Z"
  };
}

test("commercial workspace categorizes legacy, ready, awaiting-DG and decided dossiers", () => {
  const workspace = buildCommercialWorkspacePresentation({
    currentUser: buildUser(),
    records: [
      {
        detail: buildDetail({
          id: 1,
          code: "AO-LEGACY",
          buyer: "Client legacy",
          commercialOwnerUserId: null,
          commercialOwnerAssignedAt: null,
          commercialOwnerAssignedByUserId: null,
          commercialOwnerStatus: null
        }),
        fciDetail: buildFciDetail({ A: "validated", B: "generated", C: "generated" }),
        workflow: buildWorkflow({
          appel_offres_id: 1,
          code: "AO-LEGACY",
          explicit_state: "FCI_GENERATED",
          assignments_complete: false,
          assignments: []
        }),
        latestDecision: null
      },
      {
        detail: buildDetail({ id: 2, code: "AO-READY", buyer: "Client pret" }),
        fciDetail: buildFciDetail({ A: "validated", B: "validated", C: "validated" }),
        workflow: buildWorkflow({
          appel_offres_id: 2,
          code: "AO-READY",
          explicit_state: "FCI_ASSIGNED",
          derived_state: "READY_FOR_GONOGO",
          current_state: "READY_FOR_GONOGO",
          ready_for_gonogo: true,
          assignments_complete: true,
          assignments: [
            {
              id: 1,
              appelOffresId: 2,
              appelOffresCode: "AO-READY",
              moduleCode: "B",
              assignedUserId: 11,
              assignedRole: "FINANCE",
              assignedDepartmentCode: "FINANCE",
              assignedUserStatus: "ACTIVE",
              assignedByUserId: 2,
              assignedAt: "2026-08-02T10:00:00.000Z",
              reassignedAt: null,
              assignmentStatus: "validated",
              createdAt: "2026-08-02T10:00:00.000Z",
              updatedAt: "2026-08-02T10:00:00.000Z",
              assignedUserName: "Sophie Bernard",
              assignedUserEmail: "sophie.bernard@concept.local",
              assignedByName: "Claire Martin"
            },
            {
              id: 2,
              appelOffresId: 2,
              appelOffresCode: "AO-READY",
              moduleCode: "C",
              assignedUserId: 12,
              assignedRole: "OPERATIONS",
              assignedDepartmentCode: "OPERATIONS",
              assignedUserStatus: "ACTIVE",
              assignedByUserId: 2,
              assignedAt: "2026-08-02T10:00:00.000Z",
              reassignedAt: null,
              assignmentStatus: "validated",
              createdAt: "2026-08-02T10:00:00.000Z",
              updatedAt: "2026-08-02T10:00:00.000Z",
              assignedUserName: "Marc Leroy",
              assignedUserEmail: "marc.leroy@concept.local",
              assignedByName: "Claire Martin"
            }
          ]
        }),
        latestDecision: null
      },
      {
        detail: buildDetail({ id: 3, code: "AO-DG", buyer: "Client DG" }),
        fciDetail: buildFciDetail({ A: "validated", B: "validated", C: "validated" }),
        workflow: buildWorkflow({
          appel_offres_id: 3,
          code: "AO-DG",
          explicit_state: "SUBMITTED_TO_DG",
          derived_state: "READY_FOR_GONOGO",
          ready_for_gonogo: true,
          submitted_to_dg: true,
          assignments_complete: true,
          assignments: []
        }),
        latestDecision: null
      },
      {
        detail: buildDetail({ id: 4, code: "AO-HISTORY", buyer: "Client history" }),
        fciDetail: buildFciDetail({ A: "validated", B: "validated", C: "validated" }),
        workflow: buildWorkflow({
          appel_offres_id: 4,
          code: "AO-HISTORY",
          explicit_state: "GO_DECIDED",
          derived_state: "READY_FOR_GONOGO",
          ready_for_gonogo: true,
          assignments_complete: true,
          assignments: []
        }),
        latestDecision: buildDecision({ appelOffresId: 4, status: "go", decision: "go" })
      }
    ]
  });

  assert.equal(workspace.kpis.find((item) => item.key === "to-assign")?.value, 1);
  assert.equal(workspace.kpis.find((item) => item.key === "ready")?.value, 1);
  assert.equal(workspace.kpis.find((item) => item.key === "awaiting-dg")?.value, 1);
  assert.equal(workspace.unownedQueue.some((item) => item.code === "AO-LEGACY"), true);
  assert.equal(workspace.actionsRequired.some((item) => item.code === "AO-READY"), true);
  assert.equal(workspace.awaitingDg[0]?.code, "AO-DG");
  assert.equal(workspace.recentDecisions[0]?.code, "AO-HISTORY");
  assert.equal(workspace.tracking.some((row) => row.code === "AO-LEGACY"), false);
});
