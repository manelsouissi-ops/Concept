import type { FciWorkspacePresentation } from "@/lib/appels-offres/fci/presentation.ts";
import { getFciModuleDefinition } from "@/lib/appels-offres/fci/rendering.ts";
import type { FciHumanVisibleModuleCode } from "@/lib/appels-offres/fci/types.ts";
import { formatFciDateTime } from "@/lib/appels-offres/fci/ui.ts";
import { getFciModuleForRole } from "@/lib/auth/rbac.ts";
import type { FciModuleAssignmentDetail } from "@/lib/appels-offres/workflow/types.ts";
import { FciModuleCard } from "./fci-module-card.tsx";
import { FciContributionRow } from "./fci-contribution-row.tsx";

const CONTRIBUTING_MODULES: FciHumanVisibleModuleCode[] = ["A", "B", "C", "D"];

export function FciOverview({
  workspace,
  assignments = [],
  isBusy = false,
  busyMessage,
  onOpenModule,
  onPrepareAction,
  onOpenHistory
}: {
  workspace: FciWorkspacePresentation;
  assignments?: FciModuleAssignmentDetail[];
  isBusy?: boolean;
  busyMessage?: string;
  onOpenModule: (moduleCode: FciHumanVisibleModuleCode) => void;
  onPrepareAction: (
    moduleCode: FciHumanVisibleModuleCode,
    action: "regenerate" | "validate"
  ) => void;
  onOpenHistory: (moduleCode: FciHumanVisibleModuleCode) => void;
}) {
  const summaryByCode = new Map(
    workspace.module_summaries.map((summary) => [summary.module_code, summary] as const)
  );
  const assigneeByCode = new Map<string, string>(
    assignments.map((assignment) => [assignment.moduleCode, assignment.assignedUserName])
  );
  const ownModuleCode = getFciModuleForRole(workspace.current_user.role);
  const isOwnModuleContributing =
    ownModuleCode != null && CONTRIBUTING_MODULES.includes(ownModuleCode as FciHumanVisibleModuleCode);
  const otherModules = CONTRIBUTING_MODULES.filter((moduleCode) => moduleCode !== ownModuleCode);

  return (
    <div className="workspace-stack">
      <header className="fci-overview-header">
        <h2>Contributions FCI</h2>
        <p className="meta">Dernière activité : {formatFciDateTime(workspace.fci_set.updated_at)}</p>
      </header>

      {isOwnModuleContributing ? (
        <section className="section-card">
          <div className="section-header">
            <div>
              <h3>Ma FCI</h3>
            </div>
          </div>
          <div className="section-body">
            <div className="fci-module-grid fci-own-module-grid">
              {(() => {
                const definition = getFciModuleDefinition(ownModuleCode as FciHumanVisibleModuleCode);
                if (!definition) {
                  return null;
                }
                const summary = summaryByCode.get(ownModuleCode as FciHumanVisibleModuleCode);
                return (
                  <FciModuleCard
                    definition={definition}
                    summary={summary}
                    disabled={isBusy}
                    disabledMessage={isBusy ? busyMessage : undefined}
                    onAction={(action) => {
                      if (action === "open") {
                        onOpenModule(ownModuleCode as FciHumanVisibleModuleCode);
                        return;
                      }
                      if (action === "history") {
                        onOpenHistory(ownModuleCode as FciHumanVisibleModuleCode);
                        return;
                      }
                      onPrepareAction(ownModuleCode as FciHumanVisibleModuleCode, action);
                    }}
                  />
                );
              })()}
            </div>
          </div>
        </section>
      ) : null}

      <section className="section-card">
        <div className="section-header">
          <div>
            <h3>{isOwnModuleContributing ? "Contributions des autres directions" : "Contributions FCI"}</h3>
            <p className="meta">
              Suivez l’avancement des contributions nécessaires à la préparation du Go/No-Go.
            </p>
          </div>
        </div>
        <div className="section-body">
          <div className="fci-contribution-list">
            {(isOwnModuleContributing ? otherModules : CONTRIBUTING_MODULES).map((moduleCode) => {
              const definition = getFciModuleDefinition(moduleCode);
              if (!definition) {
                return null;
              }
              return (
                <FciContributionRow
                  key={moduleCode}
                  definition={definition}
                  summary={summaryByCode.get(moduleCode)}
                  assigneeName={assigneeByCode.get(moduleCode)}
                  onConsult={() => onOpenModule(moduleCode)}
                />
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
