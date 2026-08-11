import type { TenderStageProgressStep } from "@/lib/appels-offres/tender-stage.ts";

function StepMarker({ state }: { state: TenderStageProgressStep["state"] }) {
  if (state === "complete") {
    return (
      <span className="tender-stepper-marker" aria-hidden="true">
        ✓
      </span>
    );
  }

  if (state === "blocked") {
    return (
      <span className="tender-stepper-marker" aria-hidden="true">
        !
      </span>
    );
  }

  return <span className="tender-stepper-marker" aria-hidden="true" />;
}

function stateLabel(state: TenderStageProgressStep["state"]) {
  switch (state) {
    case "complete":
      return "Terminé";
    case "current":
      return "En cours";
    case "blocked":
      return "Bloqué";
    default:
      return "À venir";
  }
}

export function TenderStageStrip({ steps }: { steps: TenderStageProgressStep[] }) {
  return (
    <ol className="tender-stepper" aria-label="Étapes du dossier">
      {steps.map((step, index) => (
        <li key={step.key} className="tender-stepper-item">
          <div className={`tender-stepper-step is-${step.state}`}>
            <StepMarker state={step.state} />
            <span className="tender-stepper-label">
              {step.label}
              <small className="sr-only">{stateLabel(step.state)}</small>
            </span>
          </div>
          {index < steps.length - 1 ? (
            <span
              className={step.state === "complete" ? "tender-stepper-connector is-complete" : "tender-stepper-connector"}
              aria-hidden="true"
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
