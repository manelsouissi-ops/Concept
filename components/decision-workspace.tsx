import Link from "next/link";
import { CheckCircleIcon, ClockIcon, FolderIcon } from "@/components/app-icons.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { StatCard } from "@/components/stat-card.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import type {
  DecisionWorkspacePresentation,
  DecisionWorkspaceRow
} from "@/lib/appels-offres/decision-workspace.ts";
import type { FinanceWorkspacePresentation } from "@/lib/appels-offres/finance-workspace.ts";

function renderRow(row: DecisionWorkspaceRow) {
  return (
    <tr key={row.code}>
      <td>
        <div className="finance-dossiers-main">
          <span className="mono finance-dossiers-code">{row.code}</span>
          <div className="finance-dossiers-copy">
            <strong title={row.title}>{row.title}</strong>
            <span>{row.client}</span>
          </div>
        </div>
      </td>
      <td>
        <div className="finance-dossiers-copy">
          <strong>{row.deadlineLabel}</strong>
          <span>{row.deadlineMeta}</span>
        </div>
      </td>
      <td>
        <div className="finance-dossiers-copy">
          <StatusBadge label={row.statusLabel} tone={row.statusTone} />
          <span>{row.decisionAtLabel}</span>
        </div>
      </td>
      <td>
        <div className="finance-dossiers-copy">
          <strong>{row.rationale ?? "Sans justification saisie"}</strong>
          <span>{row.reserves ?? "Aucune reserve"}</span>
        </div>
      </td>
      <td>
        <Link href={row.actionHref} className="button button-secondary button-small">
          {row.actionLabel}
        </Link>
      </td>
    </tr>
  );
}

export function DecisionWorkspace({
  workspace,
  fciWorkspace
}: {
  workspace: DecisionWorkspacePresentation;
  fciWorkspace?: FinanceWorkspacePresentation;
}) {
  if (fciWorkspace) {
    const fciInProgress = fciWorkspace.inProgress.length;
    const attentionCount = fciWorkspace.tasks.length + workspace.queue.length;
    return (
      <div className="page-stack finance-workspace dg-workspace">
        <header className="finance-hero finance-hero-compact">
          <div className="finance-hero-copy">
            <span className="page-eyebrow">Espace Direction Générale</span>
            <h1>Bonjour {workspace.currentUser.firstName}</h1>
            <p className="finance-hero-role">{workspace.currentUser.roleTitle}</p>
            <p className="finance-hero-summary">
              {attentionCount} dossier{attentionCount > 1 ? "s nécessitent" : " nécessite"} votre attention.
            </p>
          </div>
        </header>

        <section className="finance-summary-strip dg-summary-strip" aria-label="Résumé Direction Générale">
          {[
            ["FCI à traiter", fciWorkspace.tasks.length, "Contributions DG nécessitant votre action"],
            ["FCI en cours", fciInProgress, "Contributions DG commencées"],
            ["Décisions en attente", workspace.queue.length, "Dossiers soumis pour arbitrage"],
            ["Décidées", workspace.history.length, "Décisions Go/No-Go rendues"]
          ].map(([label, value, description]) => (
            <div key={String(label)} className="finance-summary-metric">
              <span>{label}</span><strong>{value}</strong><small>{description}</small>
            </div>
          ))}
        </section>

        <section className="data-card finance-panel">
          <div className="section-header"><div><h2>Mes actions</h2><p className="meta">Vos contributions DG et arbitrages soumis, réunis dans une même file.</p></div></div>
          <div className="section-body">
            {attentionCount ? (
              <div className="table-shell"><table className="dg-action-table"><thead><tr><th>Dossier</th><th>Client</th><th>Étape</th><th>Statut</th><th>Échéance</th><th>Action</th></tr></thead><tbody>
                {workspace.queue.map((row) => <tr key={`decision-${row.code}`}><td><span className="mono">{row.code}</span><strong>{row.title}</strong></td><td>{row.client}</td><td>Décision Go/No-Go</td><td><StatusBadge label="Décision requise" tone={row.statusTone} /></td><td>{row.deadlineLabel}</td><td><Link href={row.actionHref} className="button button-secondary button-small">Examiner</Link></td></tr>)}
                {fciWorkspace.tasks.map((row) => <tr key={`fci-${row.code}`}><td><span className="mono">{row.code}</span><strong>{row.title}</strong></td><td>{row.client}</td><td>FCI Direction Générale</td><td><StatusBadge label={row.statusLabel} tone={row.statusTone} /></td><td>{row.deadlineLabel}</td><td><Link href={row.actionHref} className="button button-secondary button-small">{row.actionLabel}</Link></td></tr>)}
              </tbody></table></div>
            ) : <EmptyState compact title="Aucune action en attente" description="Vos prochaines FCI DG et décisions soumises apparaîtront ici." />}
          </div>
        </section>

        {workspace.history.length ? <DecisionHistory rows={workspace.history} /> : null}
      </div>
    );
  }

  return (
    <div className="page-stack finance-workspace">
      <section className="data-card finance-hero">
        <div className="finance-hero-copy">
          <span className="page-eyebrow">Centre de décision DG</span>
          <h1>Bonjour {workspace.currentUser.firstName}</h1>
          <p className="finance-hero-role">{workspace.currentUser.roleTitle}</p>
          <p className="finance-hero-summary">{workspace.heroSummary}</p>
        </div>
      </section>

      <section className="kpi-grid finance-kpi-grid" aria-label="Indicateurs de décision">
        <StatCard
          icon={<ClockIcon className="stat-icon" />}
          label="Décisions en attente"
          value={workspace.attentionCount}
          description="Dossiers soumis par le Commercial et en attente de votre arbitrage."
          tone={workspace.attentionCount > 0 ? "warning" : "success"}
          statusTone={workspace.attentionCount > 0 ? "warning" : "success"}
        />
        <StatCard
          icon={<CheckCircleIcon className="stat-icon" />}
          label="GO"
          value={workspace.goCount}
          description="Décisions favorables rendues."
          tone="success"
          statusTone="success"
        />
        <StatCard
          icon={<FolderIcon className="stat-icon" />}
          label="NO-GO"
          value={workspace.noGoCount}
          description="Décisions défavorables rendues."
          tone="default"
        />
      </section>

      <section id="decision-queue" className="data-card finance-panel finance-dossiers-panel">
        <div className="section-header">
          <div>
            <h3>À décider</h3>
            <p className="meta">
              Rapports consolidés soumis par le Commercial après validation des quatre contributions.
            </p>
          </div>
        </div>
        <div className="section-body">
          {workspace.queue.length > 0 ? (
            <div className="table-shell">
              <table className="finance-dossiers-table">
                <thead>
                  <tr>
                    <th>Dossier</th>
                    <th>Echeance</th>
                    <th>Statut</th>
                    <th>Rationale / reserves</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>{workspace.queue.map(renderRow)}</tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              compact
              title="Aucune decision en attente"
              description="Les prochains dossiers prets a arbitrer apparaitront ici des que les FCI contributives seront validees."
            />
          )}
        </div>
      </section>

      {workspace.history.length > 0 ? (
        <DecisionHistory rows={workspace.history} />
      ) : (
        <section id="decision-history" className="data-card finance-panel"><div className="section-body"><EmptyState compact title="Aucune décision enregistrée" description="Les Go/No-Go rendus apparaîtront ici pour relecture." /></div></section>
      )}
    </div>
  );
}

function DecisionHistory({ rows }: { rows: DecisionWorkspaceRow[] }) {
  return <section id="decision-history" className="data-card finance-panel"><div className="section-header"><div><h2>Décidées</h2><p className="meta">Historique récent des arbitrages rendus.</p></div></div><div className="section-body"><div className="table-shell"><table className="dg-history-table"><thead><tr><th>Dossier</th><th>Client</th><th>Décision</th><th>Décidée le</th><th>Décidée par</th><th>Action</th></tr></thead><tbody>{rows.map(row => <tr key={row.code}><td><span className="mono">{row.code}</span><strong title={row.title}>{row.title}</strong></td><td>{row.client}</td><td><StatusBadge label={row.statusLabel} tone={row.statusTone} /></td><td>{row.decisionAtLabel}</td><td>{row.decidedByLabel}</td><td><Link href={row.actionHref} className="button button-secondary button-small">Consulter</Link></td></tr>)}</tbody></table></div></div></section>;
}
