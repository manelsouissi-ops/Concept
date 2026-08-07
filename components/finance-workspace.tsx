import Link from "next/link";
import { ActivityFeed } from "@/components/activity-feed.tsx";
import {
  CheckCircleIcon,
  ClockIcon,
  FileTextIcon,
  FolderIcon
} from "@/components/app-icons.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { FinanceDossiersTable } from "@/components/finance-dossiers-table.tsx";
import { StatCard } from "@/components/stat-card.tsx";
import type {
  FinanceQuickAction,
  FinanceWorkspacePresentation
} from "@/lib/appels-offres/finance-workspace.ts";

function getKpiIcon(key: string) {
  switch (key) {
    case "attention":
      return <ClockIcon className="stat-icon" />;
    case "completed":
      return <CheckCircleIcon className="stat-icon" />;
    case "overdue":
      return <FileTextIcon className="stat-icon" />;
    case "mine":
    default:
      return <FolderIcon className="stat-icon" />;
  }
}

function renderQuickAction(action: FinanceQuickAction) {
  if (!action.href) {
    return (
      <div key={action.key} className="finance-quick-action is-disabled" aria-disabled="true">
        <strong>{action.label}</strong>
        <p>{action.description}</p>
      </div>
    );
  }

  return (
    <Link key={action.key} href={action.href} className="finance-quick-action">
      <strong>{action.label}</strong>
      <p>{action.description}</p>
    </Link>
  );
}

export function FinanceWorkspace({
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

      <section className="kpi-grid finance-kpi-grid" aria-label={`Indicateurs personnels ${departmentLabel}`}>
        {workspace.kpis.map((item) => (
          <StatCard
            key={item.key}
            icon={getKpiIcon(item.key)}
            label={item.label}
            value={item.value}
            description={item.description}
            tone={item.tone}
            statusTone={
              item.tone === "danger"
                ? "danger"
                : item.tone === "warning"
                  ? "warning"
                  : item.tone === "success"
                    ? "success"
                    : undefined
            }
          />
        ))}
      </section>

      <section id="finance-dossiers" className="data-card finance-panel finance-dossiers-panel">
        <div className="section-header">
          <div>
            <h3>Mes dossiers {departmentLabel}</h3>
            <p className="meta">
              Uniquement les dossiers qui demandent un suivi {departmentLabel} ou une intervention
              sur le module FCI.
            </p>
          </div>
        </div>
        <div className="section-body">
          {workspace.dossiers.length > 0 ? (
            <FinanceDossiersTable rows={workspace.dossiers} departmentLabel={departmentLabel} />
          ) : (
            <EmptyState
              compact
              title={`Aucun dossier ${departmentLabel} en cours`}
              description={`Les prochains dossiers ${departmentLabel} apparaitront ici des qu'une Fiche CDC validee ouvrira le module ${departmentLabel}.`}
            />
          )}
        </div>
      </section>

      <section className="finance-secondary-grid">
        <section id="finance-modules" className="data-card finance-panel">
          <div className="section-header">
            <div>
              <h3>Actions rapides</h3>
              <p className="meta">Raccourcis utiles pour reprendre le travail {departmentLabel}.</p>
            </div>
          </div>
          <div className="section-body finance-quick-actions">
            {workspace.quickActions.map(renderQuickAction)}
          </div>
        </section>

        <section id="finance-history" className="data-card finance-panel">
          <div className="section-header">
            <div>
              <h3>Notifications</h3>
              <p className="meta">Evenements utiles pour reprendre vos dossiers sans bruit inutile.</p>
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
                description={`Les prochaines evolutions utiles a ${departmentLabel} remonteront ici.`}
              />
            )}
          </div>
        </section>
      </section>
    </div>
  );
}
