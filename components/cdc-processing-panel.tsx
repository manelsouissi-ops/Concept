"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatElapsedDuration } from "@/lib/appels-offres/cdc-processing-presentation.ts";

export function CdcProcessingPanel({
  state,
  step,
  startedAt,
  isLongRunning,
  readyHref,
  onRetry,
  retryPending = false
}: {
  state: "processing" | "ready" | "failed" | "received";
  step: string;
  startedAt: string | null;
  isLongRunning: boolean;
  readyHref?: string;
  onRetry?: () => void;
  retryPending?: boolean;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (state !== "processing") return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [state]);

  if (state === "ready") {
    return (
      <section className="cdc-processing-panel is-ready" aria-live="polite">
        <strong>✓ Fiche CDC prête à vérifier</strong>
        {readyHref ? <Link className="button button-primary button-small" href={readyHref}>Vérifier la Fiche CDC</Link> : null}
      </section>
    );
  }

  if (state === "failed") {
    return (
      <section className="cdc-processing-panel is-failed" aria-live="assertive">
        <div><strong>Le traitement du CDC a été interrompu.</strong><p>Le document n&apos;a pas pu être traité correctement.</p></div>
        {onRetry ? <button type="button" className="button button-primary button-small" onClick={onRetry} disabled={retryPending}>{retryPending ? "Relance en cours..." : "Réessayer l'analyse"}</button> : null}
      </section>
    );
  }

  return (
    <section className="cdc-processing-panel" aria-live="polite" aria-label="Analyse du CDC en cours">
      <div className="cdc-processing-heading"><div><strong>Analyse du CDC en cours</strong><span>⏱ {formatElapsedDuration(startedAt, nowMs)} écoulées</span></div></div>
      <div className="cdc-indeterminate-progress" role="progressbar" aria-label="Analyse du CDC en cours"><span /></div>
      <div className="cdc-processing-step"><span>Étape actuelle</span><strong>{step}</strong></div>
      <p>Le traitement continue en arrière-plan.<br />Vous pouvez quitter cette page.</p>
      {isLongRunning ? <p className="cdc-processing-long">Le traitement prend un peu plus de temps que prévu.<br />Il continue en arrière-plan.</p> : null}
    </section>
  );
}
