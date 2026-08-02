import { ArrowRightIcon } from "@/components/app-icons.tsx";
import type { FciModuleDefinition } from "@/lib/appels-offres/fci/rendering.ts";
import type { FciModulePresentation } from "@/lib/appels-offres/fci/presentation.ts";
import { formatFciDateTime } from "@/lib/appels-offres/fci/ui.ts";
import { FciFormStatusBadge } from "./fci-status-badge.tsx";

export function FciModuleHeader({
  definition,
  modulePresentation,
  contractVersion,
  onBack
}: {
  definition: FciModuleDefinition;
  modulePresentation: FciModulePresentation;
  contractVersion: string | null;
  onBack: () => void;
}) {
  return (
    <section className="workspace-identity-card fci-module-header-card">
      <div className="workspace-backlink-row">
        <button type="button" className="button button-ghost button-small workspace-backlink" onClick={onBack}>
          <ArrowRightIcon className="button-icon rotate-180" />
          Retour a la vue FCI
        </button>
      </div>
      <div className="workspace-identity-topline compact">
        <div className="workspace-identity-copy">
          <div className="workspace-code mono">
            Module {definition.moduleCode} · {definition.departmentLabel}
          </div>
          <h2>{definition.title}</h2>
          <p>{definition.description}</p>
        </div>
        <FciFormStatusBadge status={modulePresentation.module.form_status} />
      </div>
      <div className="workspace-identity-grid compact">
        <div className="workspace-identity-meta compact">
          <span>Version : {modulePresentation.latest_data?.version ?? "Aucune"}</span>
          <span>Source Fiche : {modulePresentation.source_fiche.version ?? "Indisponible"}</span>
          <span>
            {contractVersion ? `Formulaire : v${contractVersion}` : "Formulaire : version inconnue"}
          </span>
          <span>
            Derniere mise a jour : {formatFciDateTime(
              modulePresentation.latest_data?.updated_at ?? modulePresentation.module.updated_at
            )}
          </span>
          <span>
            Utilisateur : {modulePresentation.current_user.name} ({modulePresentation.current_user.role_label})
          </span>
          <span>
            Acces : {modulePresentation.permissions.read_only ? "Lecture seule" : "Edition autorisee"}
          </span>
        </div>
      </div>
      {modulePresentation.permissions.read_only_message ? (
        <div className="callout info">
          {modulePresentation.permissions.read_only_message}
        </div>
      ) : null}
    </section>
  );
}
