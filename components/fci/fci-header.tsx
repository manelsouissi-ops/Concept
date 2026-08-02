import { FciOverallStatusBadge } from "./fci-status-badge.tsx";
import type { FciWorkspacePresentation } from "@/lib/appels-offres/fci/presentation.ts";

export function FciHeader({
  workspace,
  onRefresh,
  onInitialize,
  onOpenFiche
}: {
  workspace: FciWorkspacePresentation | null;
  onRefresh: () => void;
  onInitialize: () => void;
  onOpenFiche: () => void;
}) {
  if (!workspace) {
    return null;
  }

  return (
    <section className="workspace-identity-card fci-header-card">
      <div className="workspace-identity-topline compact">
        <div className="workspace-identity-copy">
          <div className="workspace-code mono">{workspace.appel_offres.code}</div>
          <h2>Fiche Contexte Interne</h2>
          <p>{workspace.appel_offres.title}</p>
        </div>
        <FciOverallStatusBadge status={workspace.fci_set.overall_status} />
      </div>
      <div className="workspace-identity-grid compact">
        <div className="workspace-identity-meta compact">
          <span>Progression : {workspace.progress.percentage}%</span>
          <span>Modules valides : {workspace.progress.validated_modules}</span>
          <span>Source Fiche : {workspace.source_fiche.version ?? "Indisponible"}</span>
          <span>
            Utilisateur : {workspace.current_user.name} ({workspace.current_user.role_label})
          </span>
        </div>
        <div className="workspace-identity-actions">
          {workspace.module_summaries.length ? null : (
            <button type="button" className="button button-primary" onClick={onInitialize}>
              Initialiser la FCI
            </button>
          )}
          <button type="button" className="button button-secondary" onClick={onRefresh}>
            Actualiser
          </button>
          <button type="button" className="button button-ghost" onClick={onOpenFiche}>
            Ouvrir la Fiche CDC
          </button>
        </div>
      </div>
    </section>
  );
}
