import type { WorkspaceTimelineStep } from "@/lib/appels-offres/workspace.ts";

function stepStateLabel(state: WorkspaceTimelineStep["state"]) {
  switch (state) {
    case "complete":
      return "Termine";
    case "active":
      return "En cours";
    case "failed":
      return "Erreur";
    default:
      return "En attente";
  }
}

export function ProcessingTimeline({
  steps
}: {
  steps: WorkspaceTimelineStep[];
}) {
  return (
    <ol className="processing-timeline" aria-label="Timeline du traitement">
      {steps.map((step) => {
        const detail =
          step.detail &&
          !((step.state === "waiting" || step.state === "active") &&
            step.detail.toLowerCase() === stepStateLabel(step.state).toLowerCase())
            ? step.detail
            : null;

        return (
          <li
            key={step.key}
            className={[
              "processing-timeline-step",
              `is-${step.state}`
            ].join(" ")}
          >
            <span className="processing-step-marker" aria-hidden="true" />
            <div className="processing-step-copy">
              <div className="processing-step-topline">
                <strong>{step.label}</strong>
                <span className={`processing-step-state state-${step.state}`}>
                  {stepStateLabel(step.state)}
                </span>
              </div>
              {step.timestamp || detail ? (
                <div className="processing-step-meta">
                  {step.timestamp ? (
                    <span>{new Date(step.timestamp).toLocaleString("fr-FR")}</span>
                  ) : null}
                  {detail ? <p>{detail}</p> : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
