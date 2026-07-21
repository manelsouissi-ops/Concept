import type { WorkspaceTimelineStep } from "@/lib/appels-offres/workspace.ts";

export function ProcessingTimeline({
  steps
}: {
  steps: WorkspaceTimelineStep[];
}) {
  return (
    <ol className="processing-timeline" aria-label="Timeline du traitement">
      {steps.map((step) => (
        <li
          key={step.key}
          className={[
            "processing-timeline-step",
            `is-${step.state}`
          ].join(" ")}
        >
          <span className="processing-step-marker" aria-hidden="true" />
          <div className="processing-step-copy">
            <strong>{step.label}</strong>
            {step.timestamp ? <span>{new Date(step.timestamp).toLocaleString("fr-FR")}</span> : null}
            {step.detail ? <p>{step.detail}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
