import { StatusBadge } from "@/components/status-badge.tsx";
import {
  formatFciDateTime,
  formatFciSourceLabel,
  getFciSourceFreshnessPresentation
} from "@/lib/appels-offres/fci/ui.ts";

function formatSourceStatus(status: string | null) {
  switch (status) {
    case "validated":
      return "Validée";
    case "draft":
      return "Brouillon";
    case "processing":
      return "En cours";
    case "error":
      return "Erreur";
    default:
      return status ?? "Inconnu";
  }
}

export function FciSourceStatus({
  source
}: {
  source: {
    available: boolean;
    status: string | null;
    is_validated: boolean;
    version: string | null;
    updated_at: string | null;
    hash: string | null;
    freshness: "current" | "stale" | "missing";
  };
}) {
  const freshness = getFciSourceFreshnessPresentation(source.freshness);

  return (
    <section className="workspace-card compact">
      <div className="workspace-card-topline">
        <div>
          <span className="card-kicker">Source Fiche CDC</span>
          <h3>{formatFciSourceLabel(source.version)}</h3>
        </div>
        <StatusBadge label={freshness.label} tone={freshness.tone} />
      </div>
      <div className="workspace-card-meta">
        <span>Statut : {formatSourceStatus(source.status)}</span>
        <span>Validée : {source.is_validated ? "Oui" : "Non"}</span>
      </div>
      <p className="workspace-card-description">
        Dernière mise à jour : {formatFciDateTime(source.updated_at)}
      </p>
    </section>
  );
}
