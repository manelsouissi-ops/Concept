import type { FciWorkspacePresentation } from "@/lib/appels-offres/fci/presentation.ts";
import { getFciModuleDefinitions } from "@/lib/appels-offres/fci/rendering.ts";
import type { FciHumanVisibleModuleCode } from "@/lib/appels-offres/fci/types.ts";
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
  onOpenModule: (moduleCode: FciHumanVisibleModuleCode) => void;
  onPrepareAction: (
    moduleCode: FciHumanVisibleModuleCode,
    action: "regenerate" | "validate"
  ) => void;
  onOpenHistory: (moduleCode: FciHumanVisibleModuleCode) => void;
}) {
  const definitions = getFciModuleDefinitions();
  const summaryByCode = new Map(
    workspace.module_summaries.map((summary) => [summary.module_code, summary] as const)
  );

  return (
    <div className="workspace-stack">
      <header className="fci-overview-header">
        <h2>FCI du dossier</h2>
        <p className="meta">Dernière activité : {formatFciDateTime(workspace.fci_set.updated_at)}</p>
      </header>

      <div className="workspace-overview-grid fci-overview-grid">
        <FciProgress
          validatedModules={workspace.progress.validated_modules}
          totalModules={workspace.progress.enabled_modules}
          percentage={workspace.progress.percentage}
        />

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
                      onOpenModule(definition.moduleCode as FciHumanVisibleModuleCode);
                      return;
                    }
                    if (action === "history") {
                      onOpenHistory(definition.moduleCode as FciHumanVisibleModuleCode);
                      return;
                    }
                    onPrepareAction(definition.moduleCode as FciHumanVisibleModuleCode, action);
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
