import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_POLL_INTERVAL_MS,
  RECOVERY_POLL_INTERVAL_MS,
  getCreateWizardPollInterval,
  resolveCreateWizardDetailState
} from "./create-wizard-state.ts";
import type { AppelOffresDetail } from "./types.ts";

function detail(input: {
  ficheStatus?: "draft" | "validated" | "processing" | "error" | null;
  hasFicheXml?: boolean;
  latestStatus?: "created" | "queued" | "running" | "completed" | "failed" | "cancelled" | "retrying";
  processingStatuses?: Array<"created" | "queued" | "running" | "completed" | "failed" | "cancelled" | "retrying">;
}) {
  const jobs = (input.processingStatuses ?? [input.latestStatus ?? "running"]).map(
    (status, index) => ({ id: index + 1, status })
  );
  return {
    artifacts: {
      hasSourcePdf: true,
      hasFicheXml: input.hasFicheXml ?? false,
      hasFicheMarkdown: true,
      hasStatusJson: true
    },
    ficheStatus: input.ficheStatus ? { status: input.ficheStatus } : null,
    latestJob: jobs[0] ?? null,
    processingJobs: jobs
  } as AppelOffresDetail;
}

test("processing without an authoritative Fiche stays on Analyse", () => {
  assert.equal(resolveCreateWizardDetailState(detail({ ficheStatus: "processing" })), "analyzing");
});

test("draft and validated authoritative Fiches move to Verification", () => {
  assert.equal(resolveCreateWizardDetailState(detail({ ficheStatus: "draft", hasFicheXml: true })), "review");
  assert.equal(resolveCreateWizardDetailState(detail({ ficheStatus: "validated", hasFicheXml: true })), "review");
});

test("refresh with an already-ready authoritative Fiche resumes Verification", () => {
  assert.equal(resolveCreateWizardDetailState(detail({ ficheStatus: "draft", hasFicheXml: true, latestStatus: "completed" })), "review");
});

test("a successful retry and authoritative Fiche win over older failed jobs", () => {
  assert.equal(resolveCreateWizardDetailState(detail({ ficheStatus: "draft", hasFicheXml: true, processingStatuses: ["completed", "failed"] })), "review");
});

test("timeout recovery uses bounded low-frequency polling and still accepts a later Fiche", () => {
  assert.equal(getCreateWizardPollInterval({ analysisFailed: false, pollTimedOut: false }), ACTIVE_POLL_INTERVAL_MS);
  assert.equal(getCreateWizardPollInterval({ analysisFailed: false, pollTimedOut: true }), RECOVERY_POLL_INTERVAL_MS);
  assert.equal(resolveCreateWizardDetailState(detail({ ficheStatus: "draft", hasFicheXml: true, latestStatus: "completed" })), "review");
});

test("a completed timeline without an authoritative Fiche does not advance", () => {
  assert.equal(resolveCreateWizardDetailState(detail({ ficheStatus: null, hasFicheXml: false, latestStatus: "completed" })), "analyzing");
});
