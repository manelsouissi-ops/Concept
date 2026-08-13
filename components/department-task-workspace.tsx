import { DepartmentTasksTable } from "@/components/department-tasks-table.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import type { FinanceWorkspacePresentation } from "@/lib/appels-offres/finance-workspace.ts";

export function DepartmentTaskWorkspace({
  workspace
}: {
  workspace: FinanceWorkspacePresentation;
}) {
  const departmentLabel = workspace.departmentLabel;

  return (
    <div className="page-stack finance-workspace">
      <header id="finance-home" className="finance-hero finance-hero-compact">
        <div className="finance-hero-copy">
          <span className="page-eyebrow">Espace {departmentLabel}</span>
          <h1>Bonjour {workspace.currentUser.firstName}</h1>
          <p className="finance-hero-role">{workspace.currentUser.roleTitle}</p>
          <p className="finance-hero-summary">{workspace.heroSummary}</p>
        </div>
      </header>

      <section className="finance-summary-strip" aria-label="Résumé de vos contributions">
        {workspace.kpis.map((item) => (
          <div key={item.key} className="finance-summary-metric">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.description}</small>
          </div>
        ))}
      </section>

      <section id="finance-modules" className="data-card finance-panel finance-dossiers-panel">
        <div className="section-header">
          <div>
            <h2>Mes FCI</h2>
            <p className="meta">
              Les contributions {departmentLabel === "Finance" ? "financières" : departmentLabel} qui vous sont attribuées.
            </p>
          </div>
        </div>
        <div className="section-body">
          {workspace.tasks.length > 0 ? (
            <DepartmentTasksTable rows={workspace.tasks} />
          ) : (
            <EmptyState
              compact
              title="Vous n'avez aucune FCI en attente."
              description="Les nouvelles contributions qui vous seront attribuées apparaîtront ici."
            />
          )}
        </div>
      </section>

      {workspace.validated.length > 0 ? (
        <section id="finance-history" className="finance-recent-panel">
          <div className="section-header">
            <div>
              <h2>Récemment validées</h2>
            </div>
          </div>
          <div className="department-history-list">
            {workspace.validated.slice(0, 3).map((row) => (
              <article key={row.code} className="department-history-item">
                <div className="department-history-copy">
                  <span className="mono finance-dossiers-code">{row.code}</span>
                  <strong title={row.title}>{row.title}</strong>
                </div>
                <time className="department-history-date" dateTime={row.validatedAt ?? undefined}>
                  {row.validatedAtLabel}
                </time>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
