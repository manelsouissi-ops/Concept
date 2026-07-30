"use client";

import type { FciModuleHistoryPresentation } from "@/lib/appels-offres/fci/client.ts";
import {
  formatFciDateTime,
  getFciGenerationJobStatusPresentation,
  mapFciHistoryEventLabel
} from "@/lib/appels-offres/fci/ui.ts";
import { StatusBadge } from "@/components/status-badge.tsx";

function buildTimelineItems(history: FciModuleHistoryPresentation) {
  const versionItems = history.versions.map((version) => ({
    id: `version-${version.id}`,
    created_at: version.created_at,
    title: `Version ${version.version}`,
    meta: "Données du module",
    detail:
      version.generated_from_fiche_version != null
        ? `Source Fiche CDC : ${version.generated_from_fiche_version}`
        : "Source Fiche CDC non rattachée",
    badge: null
  }));

  const jobItems = history.generation_jobs.map((job) => {
    const status = getFciGenerationJobStatusPresentation(job.status);
    return {
      id: `job-${job.id}`,
      created_at: job.created_at,
      title:
        job.trigger_type === "regeneration"
          ? "Régénération IA"
          : "Génération IA",
      meta: `${job.provider} · ${job.model}`,
      detail:
        job.error_message
        ?? (
          job.status === "completed"
            ? "Résultat IA reçu et persisté."
            : job.status === "running"
              ? "Génération en cours dans n8n."
              : job.status === "queued" || job.status === "created"
                ? "Génération acceptée et en attente de traitement."
                : "Génération enregistrée."
        ),
      badge: status
    };
  });

  const auditItems = history.audit_events.map((event) => ({
    id: `audit-${event.id}`,
    created_at: event.created_at,
    title: mapFciHistoryEventLabel(event.event_type),
    meta: event.actor ? `Par ${event.actor}` : "Événement système",
    detail: event.payload ? JSON.stringify(event.payload) : null,
    badge: null
  }));

  return [...versionItems, ...jobItems, ...auditItems].sort((left, right) =>
    right.created_at.localeCompare(left.created_at)
  );
}

export function FciModuleHistory({
  history
}: {
  history: FciModuleHistoryPresentation | null;
}) {
  if (!history) {
    return (
      <section className="section-card" id="fci-module-history">
        <div className="section-header">
          <div>
            <h3>Historique</h3>
            <p className="meta">Aucun historique chargé pour ce module.</p>
          </div>
        </div>
      </section>
    );
  }

  const items = buildTimelineItems(history);

  return (
    <section className="section-card" id="fci-module-history">
      <div className="section-header">
        <div>
          <h3>Historique</h3>
          <p className="meta">
            Versions, validations et exécutions IA de ce module.
          </p>
        </div>
      </div>
      <div className="section-body">
        {items.length ? (
          <div className="fci-history-timeline">
            {items.map((item) => (
              <article key={item.id} className="fci-history-item">
                <div className="fci-history-item-topline">
                  <strong>{item.title}</strong>
                  {item.badge ? (
                    <StatusBadge label={item.badge.label} tone={item.badge.tone} />
                  ) : null}
                </div>
                <span className="meta">{item.meta}</span>
                <small>{formatFciDateTime(item.created_at)}</small>
                {item.detail ? <p>{item.detail}</p> : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="meta">Aucun événement disponible.</p>
        )}
      </div>
    </section>
  );
}
