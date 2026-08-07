import assert from "node:assert/strict";
import test from "node:test";
import { buildDecisionWorkspacePresentation } from "./decision-workspace.ts";
import type { GoNoGoDecisionRecord } from "./go-no-go/types.ts";
import type { FciDetail } from "./fci/types.ts";
import type { AppelOffresDetail } from "./types.ts";
import type { CurrentUser } from "../auth/rbac.ts";

function buildUser(): CurrentUser {
  return {
    id: "user-dg",
    firstName: "Isabelle",
    name: "Isabelle Moreau",
    email: "isabelle.moreau@concept.local",
    role: "DIRECTION_GENERALE",
    status: "ACTIVE",
    departmentCode: "DIRECTION_GENERALE",
    departmentLabel: "Direction generale",
    jobTitle: "Direction generale",
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

function buildFciDetail(statusByModule: Record<"A" | "B" | "C" | "D", FciDetail["modules"][number]["status"]>): FciDetail {
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
    modules: ([
      ["A", "commercial"],
      ["B", "finance"],
      ["C", "operations"],
      ["D", "strategy"]
    ] as const).map(([moduleCode, moduleType], index) => ({
      id: 200 + index,
      fciSetId: 100,
      moduleCode,
      moduleType,
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

function buildDecision(
  overrides: Partial<GoNoGoDecisionRecord>
): GoNoGoDecisionRecord {
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

test("buildDecisionWorkspacePresentation queues dossiers on A/B/C readiness and excludes module D from the gate", () => {
  const workspace = buildDecisionWorkspacePresentation({
    currentUser: buildUser(),
    records: [
      {
        detail: buildDetail({ id: 1, code: "AO-QUEUE", buyer: "Ville A" }),
        fciDetail: buildFciDetail({
          A: "validated",
          B: "validated",
          C: "validated",
          D: "not_started"
        }),
        latestDecision: null,
        workflow: {
          explicit_state: "SUBMITTED_TO_DG",
          submitted_to_dg: true,
          under_dg_review: false
        },
        submittedReport: {
          id: 501,
          isStale: false
        }
      },
      {
        detail: buildDetail({ id: 2, code: "AO-HISTORY", buyer: "Ville B" }),
        fciDetail: buildFciDetail({
          A: "validated",
          B: "validated",
          C: "validated",
          D: "needs_review"
        }),
        latestDecision: buildDecision({
          appelOffresId: 2,
          status: "no_go",
          decision: "no_go"
        }),
        workflow: {
          explicit_state: "UNDER_DG_REVIEW",
          submitted_to_dg: true,
          under_dg_review: true
        },
        submittedReport: {
          id: 502,
          isStale: false
        }
      },
      {
        detail: buildDetail({ id: 3, code: "AO-BLOCKED", buyer: "Ville C" }),
        fciDetail: buildFciDetail({
          A: "validated",
          B: "validated",
          C: "needs_review",
          D: "validated"
        }),
        latestDecision: null,
        workflow: {
          explicit_state: "FCI_ASSIGNED",
          submitted_to_dg: false,
          under_dg_review: false
        },
        submittedReport: {
          id: null,
          isStale: false
        }
      }
    ]
  });

  assert.equal(workspace.attentionCount, 1);
  assert.equal(workspace.queue.length, 1);
  assert.equal(workspace.queue[0]?.code, "AO-QUEUE");
  assert.equal(workspace.queue[0]?.statusLabel, "À décider");
  assert.equal(workspace.history.length, 1);
  assert.equal(workspace.history[0]?.code, "AO-HISTORY");
});

test("validated dossiers stay out of the DG queue until they are submitted", () => {
  const workspace = buildDecisionWorkspacePresentation({
    currentUser: buildUser(),
    records: [
      {
        detail: buildDetail({ id: 10, code: "AO-PREPARED", buyer: "Ville D" }),
        fciDetail: buildFciDetail({
          A: "validated",
          B: "validated",
          C: "validated",
          D: "not_started"
        }),
        latestDecision: null,
        workflow: {
          explicit_state: "GONOGO_PREPARED",
          submitted_to_dg: false,
          under_dg_review: false
        },
        submittedReport: {
          id: null,
          isStale: false
        }
      }
    ]
  });

  assert.equal(workspace.attentionCount, 0);
  assert.equal(workspace.queue.length, 0);
});
