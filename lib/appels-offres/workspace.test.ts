import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProcessingTimeline,
  buildWorkspaceActions,
  buildWorkspaceIdentity,
  isPlaceholderProjectTitle
} from "./workspace.ts";
import type { AppelOffresDetail } from "./types.ts";

function buildDetail(overrides: Partial<AppelOffresDetail> = {}): AppelOffresDetail {
  return {
    id: 1,
    code: "INT-2026-045",
    title: "INT-2026-045",
    reference: "",
    buyer: "",
    country: "",
    dueDate: null,
    notes: "",
    priorite: "normale",
    responsableCommercial: "",
    status: "draft",
    businessStatus: null,
    source: "manual",
    createdAt: "2026-07-15T08:00:00.000Z",
    updatedAt: "2026-07-15T08:00:00.000Z",
    archivedAt: null,
    documents: [],
    latestJob: null,
    processingJobs: [],
    auditLogs: [],
    artifacts: {
      hasSourcePdf: false,
      hasFicheXml: false,
      hasFicheMarkdown: false,
      hasStatusJson: true
    },
    ficheStatus: null,
    ...overrides
  };
}

test("isPlaceholderProjectTitle detects compatibility titles equal to code", () => {
  assert.equal(isPlaceholderProjectTitle("INT-2026-045", "INT-2026-045"), true);
  assert.equal(isPlaceholderProjectTitle("Mission SENELEC", "INT-2026-045"), false);
});

test("buildWorkspaceIdentity exposes a pending extraction title and safe fallbacks", () => {
  const identity = buildWorkspaceIdentity(
    buildDetail({
      artifacts: {
        hasSourcePdf: true,
        hasFicheXml: false,
        hasFicheMarkdown: false,
        hasStatusJson: true
      }
    })
  );

  assert.equal(identity.displayTitle, "Intitule en attente d'extraction");
  assert.equal(identity.clientLabel, "A extraire");
  assert.equal(identity.countryLabel, "A extraire");
  assert.equal(identity.responsibleLabel, "Non renseigne");
});

test("buildProcessingTimeline marks launch failure on the launch stage", () => {
  const timeline = buildProcessingTimeline(
    buildDetail({
      artifacts: {
        hasSourcePdf: true,
        hasFicheXml: false,
        hasFicheMarkdown: false,
        hasStatusJson: true
      },
      documents: [
        {
          id: 1,
          appelOffresId: 1,
          kind: "source_pdf",
          fileName: "cdc.pdf",
          storagePath: "data/INT-2026-045/cdc.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
          createdAt: "2026-07-15T08:10:00.000Z",
          updatedAt: "2026-07-15T08:10:00.000Z"
        }
      ],
      processingJobs: [
        {
          id: 99,
          appelOffresId: 1,
          publicId: "pj_1",
          jobType: "fiche_generation",
          status: "failed",
          startedAt: "2026-07-15T08:11:00.000Z",
          finishedAt: "2026-07-15T08:12:00.000Z",
          contractVersion: "v1",
          correlationId: "corr-1",
          executionId: null,
          launchAcceptedAt: null,
          callbackReceivedAt: null,
          callbackStatus: null,
          callbackIdempotencyKey: null,
          retryOfJobId: null,
          errorStage: "webhook",
          errorCode: "N8N_LAUNCH_FAILED",
          errorMessage: "Launch failed",
          metadata: null
        }
      ],
      latestJob: null
    })
  );

  const launchStep = timeline.find((step) => step.key === "analysis_requested");
  assert.equal(launchStep?.state, "failed");
});

test("buildWorkspaceActions hides relaunch when a processing job is already active", () => {
  const actions = buildWorkspaceActions(
    buildDetail({
      artifacts: {
        hasSourcePdf: true,
        hasFicheXml: false,
        hasFicheMarkdown: false,
        hasStatusJson: true
      },
      processingJobs: [
        {
          id: 99,
          appelOffresId: 1,
          publicId: "pj_1",
          jobType: "fiche_generation",
          status: "running",
          startedAt: "2026-07-15T08:11:00.000Z",
          finishedAt: null,
          contractVersion: "v1",
          correlationId: "corr-1",
          executionId: "exec-1",
          launchAcceptedAt: "2026-07-15T08:11:30.000Z",
          callbackReceivedAt: null,
          callbackStatus: null,
          callbackIdempotencyKey: null,
          retryOfJobId: null,
          errorStage: null,
          errorCode: null,
          errorMessage: null,
          metadata: null
        }
      ],
      ficheStatus: {
        status: "processing",
        createdAt: "2026-07-15T08:11:00.000Z",
        validatedAt: null,
        modifiedAt: null,
        n8nExecutionId: "exec-1",
        processingStartedAt: "2026-07-15T08:11:30.000Z",
        errorReason: null,
        errorStage: null
      }
    })
  );

  assert.notEqual(actions.primary?.kind, "launch-analysis");
});
