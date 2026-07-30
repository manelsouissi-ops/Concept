import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkspaceActivityFeed,
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
  assert.equal(identity.clientLabel, "En attente d'extraction");
  assert.equal(identity.countryLabel, "En attente d'extraction");
  assert.equal(identity.responsibleLabel, "Non renseigne");
});

test("buildProcessingTimeline exposes four business stages and maps webhook failures to Analyse IA", () => {
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

  assert.deepEqual(
    timeline.map((step) => step.label),
    [
      "Dossier cree",
      "Document recu",
      "Analyse IA",
      "Fiche CDC prete pour revision"
    ]
  );

  const analysisStep = timeline.find((step) => step.key === "analysis_ai");
  assert.equal(analysisStep?.state, "failed");
});

test("buildWorkspaceActions hides fake running CTAs while a processing job is active", () => {
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

  assert.equal(actions.primary, null);
  assert.equal(
    actions.secondary.some((action) => action.label === "Reviser la Fiche CDC"),
    false
  );
});

test("buildWorkspaceActivityFeed keeps only business events, standardizes labels, and orders equal timestamps deterministically", () => {
  const activity = buildWorkspaceActivityFeed(
    buildDetail({
      auditLogs: [
        {
          id: 1,
          appelOffresId: 1,
          action: "appel_offres.create.requested",
          details: { hasSourcePdf: true },
          actor: "system",
          createdAt: "2026-07-15T08:00:00.000Z"
        },
        {
          id: 2,
          appelOffresId: 1,
          action: "appel_offres.created",
          details: null,
          actor: "system",
          createdAt: "2026-07-15T08:00:00.000Z"
        },
        {
          id: 3,
          appelOffresId: 1,
          action: "appel_offres.cdc_uploaded",
          details: { fileName: "cdc-initial.pdf" },
          actor: "system",
          createdAt: "2026-07-15T08:00:00.000Z"
        },
        {
          id: 4,
          appelOffresId: 1,
          action: "appel_offres.business_status_changed",
          details: { nextStatus: "analyse_en_cours" },
          actor: "system",
          createdAt: "2026-07-15T08:01:10.000Z"
        },
        {
          id: 5,
          appelOffresId: 1,
          action: "analysis_requested",
          details: null,
          actor: "system",
          createdAt: "2026-07-15T08:00:00.000Z"
        },
        {
          id: 10,
          appelOffresId: 1,
          action: "analysis_completed",
          details: null,
          actor: "system",
          createdAt: "2026-07-15T08:02:00.000Z"
        },
        {
          id: 6,
          appelOffresId: 1,
          action: "analysis_failed",
          details: { error: "Workflow configuration error." },
          actor: "system",
          createdAt: "2026-07-15T08:03:00.000Z"
        },
        {
          id: 7,
          appelOffresId: 1,
          action: "appel_offres.updated",
          details: { replacedSourcePdf: true },
          actor: "Bob Durand",
          createdAt: "2026-07-15T08:04:00.000Z"
        },
        {
          id: 8,
          appelOffresId: 1,
          action: "appel_offres.cdc_uploaded",
          details: { fileName: "cdc-remplacement.pdf" },
          actor: "Bob Durand",
          createdAt: "2026-07-15T08:04:02.000Z"
        },
        {
          id: 9,
          appelOffresId: 1,
          action: "fiche_cdc.validated",
          details: null,
          actor: "Bob Durand",
          createdAt: "2026-07-15T08:05:00.000Z"
        }
      ]
    })
  );

  assert.deepEqual(
    activity.map((item) => item.label),
    [
      "Fiche CDC validee",
      "CDC remplace",
      "Dossier a verifier",
      "Analyse terminee",
      "Dossier cree",
      "CDC recu",
      "Traitement du CDC demarre",
    ]
  );
  assert.equal(activity.some((item) => item.label === "Statut modifie"), false);
  assert.equal(activity.some((item) => item.label === "Informations du dossier modifiees"), false);
  assert.equal(activity[1]?.description, "Fichier : cdc-remplacement.pdf");
  assert.equal(activity[5]?.description, "Fichier : cdc-initial.pdf");
});
