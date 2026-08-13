import assert from "node:assert/strict";
import test from "node:test";
import { deriveTenderStage } from "./tender-stage.ts";
import type { AppelOffresDetail } from "./types.ts";
import type { TenderWorkflowStateView } from "./workflow/service.ts";
import type { GoNoGoDecisionRecord } from "./go-no-go/types.ts";
import type { FciDetail } from "./fci/types.ts";

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
    commercialOwnerUserId: overrides.commercialOwnerUserId ?? 2,
    commercialOwnerAssignedAt: overrides.commercialOwnerAssignedAt ?? "2026-08-01T09:00:00.000Z",
    commercialOwnerAssignedByUserId: overrides.commercialOwnerAssignedByUserId ?? 2,
    commercialOwnerPreviousUserId: overrides.commercialOwnerPreviousUserId ?? null,
    commercialOwnerReason: overrides.commercialOwnerReason ?? null,
    commercialOwnerUpdatedAt: overrides.commercialOwnerUpdatedAt ?? "2026-08-02T09:00:00.000Z",
    commercialOwnerStatus: overrides.commercialOwnerStatus ?? "ACTIVE",
    status: overrides.status ?? "ready",
    businessStatus: overrides.businessStatus ?? "fiche_a_valider",
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

function buildWorkflow(overrides: Partial<TenderWorkflowStateView>): TenderWorkflowStateView {
  return {
    appel_offres_id: overrides.appel_offres_id ?? 1,
    code: overrides.code ?? "AO-TEST",
    explicit_state: overrides.explicit_state ?? "FCI_GENERATED",
    derived_state: overrides.derived_state ?? "FCI_IN_PROGRESS",
    current_state: overrides.current_state ?? "FCI_GENERATED",
    ready_for_gonogo: overrides.ready_for_gonogo ?? false,
    submitted_to_dg: overrides.submitted_to_dg ?? false,
    under_dg_review: overrides.under_dg_review ?? false,
    assignments_complete: overrides.assignments_complete ?? true,
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
    rationale: overrides.rationale ?? null,
    reserves: overrides.reserves ?? null,
    decidedBy: overrides.decidedBy ?? "Isabelle Moreau",
    decidedAt: overrides.decidedAt ?? "2026-08-03T10:00:00.000Z",
    createdAt: overrides.createdAt ?? "2026-08-03T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-08-03T10:00:00.000Z"
  };
}

test("CDC not yet uploaded reads as a created dossier awaiting the document", () => {
  const stage = deriveTenderStage({
    detail: buildDetail({
      businessStatus: "brouillon",
      artifacts: { hasSourcePdf: false, hasFicheXml: false, hasFicheMarkdown: false, hasStatusJson: false }
    })
  });

  assert.equal(stage.stage, "CDC_PROCESSING");
  assert.equal(stage.progressSteps[0].state, "current");
});

test("analysis in progress is distinguished from analysis failure", () => {
  const running = deriveTenderStage({
    detail: buildDetail({
      businessStatus: "analyse_en_cours",
      artifacts: { hasSourcePdf: true, hasFicheXml: false, hasFicheMarkdown: false, hasStatusJson: true },
      processingJobs: [
        {
          id: 1,
          publicId: "job-1",
          appelOffresId: 1,
          jobType: "fiche_generation",
          status: "running",
          startedAt: "2026-08-01T09:00:00.000Z",
          finishedAt: null,
          contractVersion: null,
          correlationId: null,
          executionId: null,
          launchAcceptedAt: null,
          callbackReceivedAt: null,
          callbackStatus: null,
          callbackIdempotencyKey: null,
          retryOfJobId: null,
          errorStage: null,
          errorCode: null,
          errorMessage: null,
          metadata: null
        }
      ]
    })
  });
  assert.equal(running.stage, "CDC_PROCESSING");
  assert.equal(running.blockingReason, null);
  assert.equal(running.nextAction, null);

  const failed = deriveTenderStage({
    detail: buildDetail({ businessStatus: "erreur", status: "error" })
  });
  assert.equal(failed.stage, "CDC_PROCESSING");
  assert.ok(failed.blockingReason);
  assert.equal(failed.tone, "danger");
});

test("fiche generated but not validated => FICHE_REVIEW with a single next action", () => {
  const stage = deriveTenderStage({
    detail: buildDetail({
      businessStatus: "fiche_a_valider",
      ficheStatus: {
        status: "draft",
        createdAt: "2026-08-01T09:00:00.000Z",
        validatedAt: null,
        modifiedAt: "2026-08-01T09:30:00.000Z",
        n8nExecutionId: null,
        processingStartedAt: null,
        errorReason: null,
        errorStage: null
      }
    })
  });

  assert.equal(stage.stage, "FICHE_REVIEW");
  assert.equal(stage.label, "Fiche CDC à vérifier");
  assert.equal(stage.nextAction?.label, "Réviser la Fiche CDC");
  assert.equal(stage.nextAction?.href, "/appels-offres/AO-TEST/fiche-cdc");
});

// This is the exact contradiction reported: fiche validated + FCI showing as
// "validated" via a stale fciOverallStatus map must NOT read as ready for
// Go/No-Go when the workflow-derived readiness disagrees.
test("workflow.ready_for_gonogo takes precedence and reports the blocking reason for a stale FCI set", () => {
  const stage = deriveTenderStage({
    detail: buildDetail({ businessStatus: "fiche_validee" }),
    fciOverallStatus: "needs_review",
    workflow: buildWorkflow({ ready_for_gonogo: false, assignments_complete: true })
  });

  assert.equal(stage.stage, "FCI_IN_PROGRESS");
  assert.match(stage.blockingReason ?? "", /revérifiées/);
});

test("fiche validated + all FCI validated => READY_FOR_GONOGO", () => {
  const stage = deriveTenderStage({
    detail: buildDetail({ businessStatus: "fiche_validee" }),
    fciOverallStatus: "validated",
    workflow: buildWorkflow({ ready_for_gonogo: true })
  });

  assert.equal(stage.stage, "READY_FOR_GONOGO");
  assert.equal(stage.nextAction?.href, "/appels-offres/AO-TEST/go-no-go");
});

test("explicit workflow state drives GONOGO_PREPARATION / SUBMITTED_TO_DG / DECIDED", () => {
  const prepared = deriveTenderStage({
    detail: buildDetail({ businessStatus: "fiche_validee" }),
    workflow: buildWorkflow({ explicit_state: "GONOGO_PREPARED", ready_for_gonogo: true })
  });
  assert.equal(prepared.stage, "GONOGO_PREPARATION");

  const submitted = deriveTenderStage({
    detail: buildDetail({ businessStatus: "fiche_validee" }),
    workflow: buildWorkflow({ explicit_state: "SUBMITTED_TO_DG", ready_for_gonogo: true })
  });
  assert.equal(submitted.stage, "SUBMITTED_TO_DG");
  assert.equal(submitted.label, "En attente DG");
  assert.equal(submitted.nextAction?.label, "Consulter le dossier");

  const decided = deriveTenderStage({
    detail: buildDetail({ businessStatus: "offre_autorisee" }),
    workflow: buildWorkflow({ explicit_state: "GO_DECIDED" }),
    decision: buildDecision({ status: "go" })
  });
  assert.equal(decided.stage, "DECIDED");
  assert.equal(decided.decision, "go");
  assert.equal(decided.label, "GO");
});

test("NO-GO decision reads as NO_GO with a neutral tone", () => {
  const stage = deriveTenderStage({
    detail: buildDetail({ businessStatus: "offre_rejetee" }),
    decision: buildDecision({ status: "no_go", decision: "no_go" })
  });

  assert.equal(stage.stage, "DECIDED");
  assert.equal(stage.decision, "no_go");
  assert.equal(stage.label, "NO-GO");
});

test("a persisted historical decision dominates an archived workflow and old readiness", () => {
  const stage = deriveTenderStage({
    detail: buildDetail({
      status: "archived",
      businessStatus: "fiche_validee",
      archivedAt: "2026-08-12T12:26:18.271Z"
    }),
    workflow: buildWorkflow({
      explicit_state: "ARCHIVED",
      ready_for_gonogo: false
    }),
    decision: buildDecision({ status: "no_go", decision: "no_go" })
  });

  assert.equal(stage.stage, "DECIDED");
  assert.equal(stage.decision, "no_go");
  assert.equal(stage.label, "NO-GO");
});

test("progress steps always contain exactly the five canonical steps in order", () => {
  const stage = deriveTenderStage({ detail: buildDetail({}) });
  assert.deepEqual(
    stage.progressSteps.map((step) => step.key),
    ["cdc", "fiche", "fci", "gonogo", "dg"]
  );
});

test("degraded mode (no fciDetail/workflow) still resolves READY_FOR_GONOGO from businessStatus + fciOverallStatus", () => {
  const stage = deriveTenderStage({
    detail: buildDetail({ businessStatus: "fiche_validee" }),
    fciOverallStatus: "validated"
  });

  assert.equal(stage.stage, "READY_FOR_GONOGO");
});

test("fciDetail with validated modules but a currently-draft fiche resolves live to needs_review, not READY_FOR_GONOGO", () => {
  const fciDetail: FciDetail = {
    set: {
      id: 1,
      appelOffresId: 1,
      sourceFicheVersion: "validated:2026-08-01T08:00:00.000Z",
      sourceFicheHash: "hash-1",
      sourceFicheUpdatedAt: "2026-08-01T08:00:00.000Z",
      overallStatus: "validated",
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-01T09:00:00.000Z"
    },
    modules: (["A", "B", "C"] as const).map((moduleCode, index) => ({
      id: index + 1,
      fciSetId: 1,
      moduleCode,
      moduleType: moduleCode === "A" ? "commercial" : moduleCode === "B" ? "finance" : "operations",
      status: "validated",
      aiGeneratedAt: null,
      validatedAt: "2026-08-01T10:00:00.000Z",
      validatedBy: "Equipe",
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-08-01T09:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z"
    })),
    moduleData: [],
    generationJobs: [],
    auditEvents: []
  };

  // Fiche CDC has reverted to draft (e.g. after a CDC replacement) after the
  // modules above were validated.
  const stage = deriveTenderStage({
    detail: buildDetail({ businessStatus: "fiche_a_valider" }),
    fciDetail
  });

  assert.notEqual(stage.stage, "READY_FOR_GONOGO");
});
