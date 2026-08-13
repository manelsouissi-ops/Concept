import type { FciGenerationFailurePresentation } from "@/lib/appels-offres/fci/ui.ts";

/**
 * Shown instead of the editable form when the module's latest generation
 * attempt failed and hasn't been resolved yet (retried successfully, or
 * acknowledged via manual completion). Never renders raw provider/HTTP text -
 * `presentation` is already a business-safe title/message pair.
 */
export function FciGenerationFailureCard({
  presentation,
  onRetry,
  onManualComplete,
  canRetry,
  canEdit,
  isBusy
}: {
  presentation: FciGenerationFailurePresentation;
  onRetry: () => void;
  onManualComplete: () => void;
  canRetry: boolean;
  canEdit: boolean;
  isBusy: boolean;
}) {
  return (
    <section className="section-card fci-generation-failure-card">
      <div className="section-body stack">
        <div>
          <h3>{presentation.title}</h3>
          <p>{presentation.message}</p>
          {presentation.lastAttemptLabel ? <p className="meta">{presentation.lastAttemptLabel}</p> : null}
        </div>
        <div className="actions">
          {canRetry ? (
            <button type="button" className="button button-primary" onClick={onRetry} disabled={isBusy}>
              {isBusy ? "Nouvelle tentative..." : "Réessayer la génération"}
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" className="button button-secondary" onClick={onManualComplete} disabled={isBusy}>
              Remplir manuellement
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
