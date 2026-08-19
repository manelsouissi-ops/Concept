export function isFicheCdcReadyNotificationEligible(input: {
  callbackStatus: "COMPLETED" | "FAILED" | "CANCELLED";
  callbackApplied: boolean;
  persistedFicheStatus: string | null;
}) {
  return (
    input.callbackStatus === "COMPLETED" &&
    input.callbackApplied &&
    (input.persistedFicheStatus === "draft" || input.persistedFicheStatus === "validated")
  );
}
