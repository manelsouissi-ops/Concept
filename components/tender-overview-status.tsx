import type { TenderStageView } from "@/lib/appels-offres/tender-stage.ts";
import type { GoNoGoDecisionRecord } from "@/lib/appels-offres/go-no-go/types.ts";

function formatDate(value: string | null) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

/**
 * The single dominant, state-dependent panel on the tender Overview: either
 * "what should I do next", "waiting on the DG", or the final GO/NO-GO
 * decision. All three variants read from the same canonical `stage` (and,
 * for the decision variant, the raw decision record already loaded by the
 * page) - no independent state is derived here.
 */
export function TenderOverviewStatus({
  stage,
  decision,
  nextActionLabelOverride,
  onNavigate
}: {
  stage: TenderStageView;
  decision: GoNoGoDecisionRecord | null;
  // Presentation-only refinement (e.g. "Compléter ma FCI" / "En attente de
  // la Finance") for the Overview specifically - the canonical stage/href
  // are unchanged, only the displayed label is more specific here.
  nextActionLabelOverride?: string;
  onNavigate: (href: string) => void;
}) {
  const nextActionLabel = nextActionLabelOverride ?? stage.nextAction?.label;

  if (stage.stage === "DECIDED") {
    const isGo = stage.decision === "go";
    const decidedDate = formatDate(decision?.decidedAt ?? null);

    return (
      <section className={`tender-decision-panel is-${isGo ? "go" : "nogo"}`}>
        <span className="card-kicker">Décision finale</span>
        <strong className="tender-decision-outcome">{isGo ? "GO" : "NO-GO"}</strong>
        {(decidedDate || decision?.decidedBy) ? (
          <p className="tender-decision-meta">
            {decidedDate ? `Décidé le ${decidedDate}` : null}
            {decidedDate && decision?.decidedBy ? " · " : null}
            {decision?.decidedBy ? `par ${decision.decidedBy}` : null}
          </p>
        ) : null}
        {decision?.rationale ? <p className="tender-decision-rationale">{decision.rationale}</p> : null}
        {stage.nextAction ? (
          <div className="workspace-card-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => onNavigate(stage.nextAction!.href)}
            >
              {stage.nextAction.label}
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  if (stage.stage === "SUBMITTED_TO_DG") {
    return (
      <section className="tender-status-panel is-waiting">
        <span className="card-kicker">En attente de décision</span>
        <h3>Le dossier a été soumis à la Direction Générale.</h3>
        {stage.nextAction ? (
          <div className="workspace-card-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => onNavigate(stage.nextAction!.href)}
            >
              {stage.nextAction.label}
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  if (stage.nextAction) {
    return (
      <section className="tender-status-panel is-action">
        <span className="card-kicker">Prochaine action</span>
        <h3>{nextActionLabel}</h3>
        <div className="workspace-card-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => onNavigate(stage.nextAction!.href)}
          >
            {nextActionLabel}
          </button>
        </div>
      </section>
    );
  }

  return null;
}
