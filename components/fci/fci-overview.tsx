import type { FciWorkspacePresentation } from "@/lib/appels-offres/fci/presentation.ts";
import { getFciModuleDefinitions } from "@/lib/appels-offres/fci/rendering.ts";
import { formatFciDateTime } from "@/lib/appels-offres/fci/ui.ts";
import { FciModuleCard } from "./fci-module-card.tsx";
import { FciProgress } from "./fci-progress.tsx";
import { FciSourceStatus } from "./fci-source-status.tsx";

export function FciOverview({
  workspace,
  isBusy = false,
  busyMessage,
  onOpenModule,
  onPrepareAction,
  onOpenHistory
}: {
  workspace: FciWorkspacePresentation;
  isBusy?: boolean;
  busyMessage?: string;
  onOpenModule: (moduleCode: "A" | "B" | "C" | "D") => void;
  onPrepareAction: (moduleCode: "A" | "B" | "C" | "D", action: "generate" | "regenerate" | "validate") => void;
  onOpenHistory: (moduleCode: "A" | "B" | "C" | "D") => void;
}) {
  const definitions = getFciModuleDefinitions();
  const summaryByCode = new Map(
    workspace.module_summaries.map((summary) => [summary.module_code, summary] as const)
  );

  const modulesRequiringReview = workspace.module_summaries.filter(
    (summary) => summary.status === "needs_review"
  ).length;

  return (
    <div className="workspace-stack">
      <div className="workspace-overview-grid fci-overview-grid">
        <section className="workspace-card compact">
          <div className="workspace-card-topline">
            <div>
              <span className="card-kicker">Statut global</span>
              <h3>{workspace.fci_set.overall_status === "validated" ? "Validation terminée" : "Workspace actif"}</h3>
            </div>
            <strong>{workspace.progress.enabled_modules} modules</strong>
          </div>
          <p className="workspace-card-description">
            Dernière activité : {formatFciDateTime(workspace.fci_set.updated_at)}
          </p>
        </section>

        <FciProgress
          validatedModules={workspace.progress.validated_modules}
          totalModules={workspace.progress.enabled_modules}
          percentage={workspace.progress.percentage}
        />

        <section className="workspace-card compact">
          <div className="workspace-card-topline">
            <div>
              <span className="card-kicker">À vérifier</span>
              <h3>{modulesRequiringReview}</h3>
            </div>
            <strong>{workspace.progress.modules_with_data} modules alimentés</strong>
          </div>
          <p className="workspace-card-description">
            Les modules à vérifier peuvent être complétés et validés manuellement.
          </p>
        </section>

        <FciSourceStatus source={workspace.source_fiche} />
      </div>

      {workspace.source_fiche.status === "draft" ? (
        <div className="callout warning">
          La Fiche CDC source est encore en brouillon. La génération et la validation FCI devront être relues avec prudence.
        </div>
      ) : null}

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>Formulaires departementaux</h3>
            <p className="meta">
              Chaque direction dispose de son formulaire FCI dédié. Ouvrez une fiche pour relire les champs pré-remplis par l’IA, compléter les informations humaines et suivre l’avancement.
            </p>
          </div>
        </div>
        <div className="section-body">
          <div className="fci-module-grid">
            {definitions.map((definition) => {
              const summary = summaryByCode.get(definition.moduleCode);
              return (
                <FciModuleCard
                  key={definition.moduleCode}
                  definition={definition}
                  summary={summary}
                  disabled={isBusy}
                  disabledMessage={isBusy ? busyMessage : undefined}
                  onAction={(action) => {
                    if (action === "open") {
                      onOpenModule(definition.moduleCode);
                      return;
                    }
                    if (action === "history") {
                      onOpenHistory(definition.moduleCode);
                      return;
                    }
                    onPrepareAction(definition.moduleCode, action);
                  }}
                />
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
