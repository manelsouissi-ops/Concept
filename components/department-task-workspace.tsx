import { ActivityFeed } from "@/components/activity-feed.tsx";
import { ClockIcon } from "@/components/app-icons.tsx";
import { DepartmentTasksTable } from "@/components/department-tasks-table.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { StatCard } from "@/components/stat-card.tsx";
import type { FinanceWorkspacePresentation } from "@/lib/appels-offres/finance-workspace.ts";

// FINANCE/OPERATIONS have exactly one job: complete and validate their own
// pre-filled FCI module. No dossier list, no KPI strip, no quick-actions panel,
// no tender-lifecycle notifications - see role-workspace.ts/finance-workspace.ts
// for where DIRECTION_GENERALE (the fuller components/finance-workspace.tsx)
// branches off from this minimal shell.
export function DepartmentTaskWorkspace({
  workspace
}: {
  workspace: FinanceWorkspacePresentation;
}) {
  const departmentLabel = workspace.departmentLabel;

  return (
    <div className="page-stack finance-workspace">
      <section id="finance-home" className="data-card finance-hero">
        <div className="finance-hero-copy">
          <span className="page-eyebrow">Espace {departmentLabel}</span>
          <h1>Bonjour {workspace.currentUser.firstName}</h1>
          <p className="finance-hero-role">{workspace.currentUser.roleTitle}</p>
          <p className="finance-hero-summary">{workspace.heroSummary}</p>
        </div>
      </section>

      <section className="department-stat-single" aria-label="Indicateur personnel">
        <StatCard
          icon={<ClockIcon className="stat-icon" />}
          label="Modules a completer"
          value={workspace.attentionCount}
          description={`Vos modules ${departmentLabel} en attente d'action.`}
          tone={workspace.attentionCount > 0 ? "warning" : "success"}
          statusTone={workspace.attentionCount > 0 ? "warning" : "success"}
        />
      </section>

      <section id="finance-modules" className="data-card finance-panel finance-dossiers-panel">
        <div className="section-header">
          <div>
            <h3>Mes modules {departmentLabel}</h3>
            <p className="meta">Uniquement les contributions qui vous sont reellement affectees.</p>
          </div>
        </div>
        <div className="section-body">
          <div className="stack">
            <section>
              <div className="section-header">
                <div>
                  <h3>A traiter</h3>
                  <p className="meta">Contributions a demarrer ou a finaliser.</p>
                </div>
              </div>
              {workspace.todo.length > 0 ? (
                <DepartmentTasksTable rows={workspace.todo} departmentLabel={departmentLabel} />
              ) : (
                <EmptyState
                  compact
                  title="Aucune contribution a traiter"
                  description={`Les prochaines contributions ${departmentLabel} a reprendre apparaitront ici.`}
                />
              )}
            </section>

            <section>
              <div className="section-header">
                <div>
                  <h3>En cours</h3>
                  <p className="meta">Contributions deja demarrees ou en generation.</p>
                </div>
              </div>
              {workspace.inProgress.length > 0 ? (
                <DepartmentTasksTable rows={workspace.inProgress} departmentLabel={departmentLabel} />
              ) : (
                <EmptyState
                  compact
                  title="Aucune contribution en cours"
                  description={`Les travaux ${departmentLabel} en cours apparaitront ici.`}
                />
              )}
            </section>

            <section>
              <div className="section-header">
                <div>
                  <h3>Bloquees</h3>
                  <p className="meta">Contributions necessitant une action de reprise.</p>
                </div>
              </div>
              {workspace.blocked.length > 0 ? (
                <DepartmentTasksTable rows={workspace.blocked} departmentLabel={departmentLabel} />
              ) : (
                <EmptyState
                  compact
                  title="Aucune contribution bloquee"
                  description={`Les blocages ${departmentLabel} apparaitront ici si necessaire.`}
                />
              )}
            </section>
          </div>
        </div>
      </section>

      <section className="finance-secondary-grid">
        <section id="finance-history" className="data-card finance-panel">
          <div className="section-header">
            <div>
              <h3>Validees</h3>
              <p className="meta">Contributions {departmentLabel} deja completees et validees.</p>
            </div>
          </div>
          <div className="section-body">
            {workspace.validated.length > 0 ? (
              <div className="department-history-list">
                {workspace.validated.map((row) => (
                  <article key={row.code} className="department-history-item">
                    <div className="department-history-copy">
                      <span className="mono finance-dossiers-code">{row.code}</span>
                      <strong title={row.title}>{row.title}</strong>
                    </div>
                    <span className="department-history-date">{row.validatedAtLabel}</span>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                title="Aucun module valide pour le moment"
                description={`Les contributions ${departmentLabel} validees apparaitront ici.`}
              />
            )}
          </div>
        </section>

        <section className="data-card finance-panel">
          <div className="section-header">
            <div>
              <h3>Notifications</h3>
              <p className="meta">Evenements de votre module {departmentLabel} uniquement.</p>
            </div>
          </div>
          <div className="section-body">
            {workspace.notifications.length > 0 ? (
              <ActivityFeed
                items={workspace.notifications}
                variant="compact"
                compactDateMode="relative"
                nowReference={new Date().toISOString()}
                subtleIcons
              />
            ) : (
              <EmptyState
                compact
                title="Aucune notification recente"
                description={`Les prochaines evolutions de votre module ${departmentLabel} remonteront ici.`}
              />
            )}
          </div>
        </section>
      </section>
    </div>
  );
}
