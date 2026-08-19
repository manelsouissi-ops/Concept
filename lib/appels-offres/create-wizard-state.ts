import type { AppelOffresDetail } from "./types.ts";

export type CreateWizardDetailState = "analyzing" | "failed" | "review";

export const ACTIVE_POLL_INTERVAL_MS = 3_000;
export const RECOVERY_POLL_INTERVAL_MS = 15_000;
export const MAX_ACTIVE_POLL_ATTEMPTS = 60;

export function hasAuthoritativeReviewableFiche(detail: AppelOffresDetail) {
  const status = detail.ficheStatus?.status ?? null;
  return detail.artifacts.hasFicheXml && (status === "draft" || status === "validated");
}

export function resolveCreateWizardDetailState(
  detail: AppelOffresDetail
): CreateWizardDetailState {
  if (hasAuthoritativeReviewableFiche(detail)) {
    return "review";
  }

  const latestJob = detail.latestJob ?? detail.processingJobs[0] ?? null;
  if (detail.ficheStatus?.status === "error" || latestJob?.status === "failed") {
    return "failed";
  }

  return "analyzing";
}

export function getCreateWizardPollInterval(input: {
  analysisFailed: boolean;
  pollTimedOut: boolean;
}) {
  return input.analysisFailed || input.pollTimedOut
    ? RECOVERY_POLL_INTERVAL_MS
    : ACTIVE_POLL_INTERVAL_MS;
}
