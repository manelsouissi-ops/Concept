import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveCdcProcessingPresentation,
  formatElapsedDuration,
  LONG_CDC_PROCESSING_THRESHOLD_MS
} from "./cdc-processing-presentation.ts";
import type { AppelOffresDetail, ProcessingJobRecord } from "./types.ts";

const NOW = Date.parse("2026-08-18T12:02:34.000Z");

function job(overrides: Partial<ProcessingJobRecord> = {}): ProcessingJobRecord {
  return {
    id: 1,
    appelOffresId: 1,
    publicId: "pj-current",
    jobType: "fiche_generation",
    status: "running",
    startedAt: "2026-08-18T12:00:00.000Z",
    finishedAt: null,
    contractVersion: "v1",
    correlationId: "corr",
    executionId: "exec",
    launchAcceptedAt: "2026-08-18T12:00:00.000Z",
    callbackReceivedAt: null,
    callbackStatus: null,
    callbackIdempotencyKey: null,
    retryOfJobId: null,
    errorStage: null,
    errorCode: null,
    errorMessage: null,
    metadata: { pipelineStage: "document_processing_running" },
    ...overrides
  };
}

function detail(input: {
  latestJob?: ProcessingJobRecord | null;
  jobs?: ProcessingJobRecord[];
  ficheStatus?: "processing" | "draft" | "validated" | "error" | null;
  hasFicheXml?: boolean;
  processingStartedAt?: string | null;
} = {}): AppelOffresDetail {
  const latest = input.latestJob === undefined ? job() : input.latestJob;
  return {
    latestJob: latest,
    processingJobs: input.jobs ?? (latest ? [latest] : []),
    ficheStatus: input.ficheStatus === null ? null : {
      status: input.ficheStatus ?? "processing",
      createdAt: "2026-08-18T12:00:00.000Z",
      validatedAt: null,
      modifiedAt: null,
      n8nExecutionId: null,
      processingStartedAt: input.processingStartedAt === undefined ? "2026-08-18T12:00:00.000Z" : input.processingStartedAt,
      errorReason: null,
      errorStage: null
    },
    artifacts: { hasSourcePdf: true, hasFicheXml: input.hasFicheXml ?? false, hasFicheMarkdown: false, hasStatusJson: true },
    documents: [],
    auditLogs: []
  } as unknown as AppelOffresDetail;
}

test("A - elapsed time uses a persisted start timestamp", () => {
  assert.equal(formatElapsedDuration("2026-08-18T12:00:00.000Z", NOW), "02:34");
});

test("B - recreating presentation after refresh continues from persisted time", () => {
  const persisted = "2026-08-18T12:00:00.000Z";
  assert.equal(formatElapsedDuration(persisted, NOW), "02:34");
  assert.equal(formatElapsedDuration(persisted, NOW + 10_000), "02:44");
});

test("C/D - processing is indeterminate and never exposes a percentage", () => {
  const result = deriveCdcProcessingPresentation(detail(), NOW);
  assert.equal(result.state, "processing");
  assert.equal(result.indeterminate, true);
  assert.equal(result.percentage, null);
});

test("E/K - authoritative draft Fiche is ready and stops the loader", () => {
  const result = deriveCdcProcessingPresentation(detail({ ficheStatus: "draft", hasFicheXml: true }), NOW);
  assert.equal(result.state, "ready");
  assert.equal(result.step, "Prête pour vérification");
  assert.equal(result.indeterminate, false);
});

test("F - failed processing stops the loader", () => {
  const result = deriveCdcProcessingPresentation(detail({ latestJob: job({ status: "failed" }), ficheStatus: "error" }), NOW);
  assert.equal(result.state, "failed");
  assert.equal(result.indeterminate, false);
});

test("G - authoritative success wins over an older failed attempt", () => {
  const failed = job({ id: 1, publicId: "pj-old", status: "failed" });
  const successful = job({ id: 2, publicId: "pj-new", status: "completed", finishedAt: "2026-08-18T12:02:00.000Z" });
  const result = deriveCdcProcessingPresentation(detail({ latestJob: successful, jobs: [successful, failed], ficheStatus: "draft", hasFicheXml: true }), NOW);
  assert.equal(result.state, "ready");
});

test("H - long running remains processing and only adds information", () => {
  const startedAt = new Date(NOW - LONG_CDC_PROCESSING_THRESHOLD_MS - 1_000).toISOString();
  const result = deriveCdcProcessingPresentation(detail({ processingStartedAt: startedAt }), NOW);
  assert.equal(result.state, "processing");
  assert.equal(result.isLongRunning, true);
});

test("I - processing list data has a persisted start usable by one list timer", () => {
  assert.equal(deriveCdcProcessingPresentation(detail(), NOW).startedAt, "2026-08-18T12:00:00.000Z");
});

test("J - completed timeline/job without authoritative Fiche is not ready", () => {
  const result = deriveCdcProcessingPresentation(detail({ latestJob: job({ status: "completed" }), ficheStatus: null, hasFicheXml: false }), NOW);
  assert.notEqual(result.state, "ready");
});

test("persisted split-pipeline stages map only to supported business precision", () => {
  assert.equal(deriveCdcProcessingPresentation(detail(), NOW).step, "Analyse du document");
  const extraction = detail({ latestJob: job({ metadata: { pipelineStage: "cdc_extraction_running" } }) });
  assert.equal(deriveCdcProcessingPresentation(extraction, NOW).step, "Extraction des informations et génération de la Fiche CDC");
});
