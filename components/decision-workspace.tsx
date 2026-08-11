import Link from "next/link";
import { CheckCircleIcon, ClockIcon, FolderIcon } from "@/components/app-icons.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { StatCard } from "@/components/stat-card.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import type {
  DecisionWorkspacePresentation,
  DecisionWorkspaceRow
} from "@/lib/appels-offres/decision-workspace.ts";

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
  workspace
}: {
  workspace: DecisionWorkspacePresentation;
}) {
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
          description="Dossiers dont les contributions A, B et C sont validees et qui attendent votre arbitrage."
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
              Dossiers prets pour une decision Go/No-Go apres validation des contributions A, B et C.
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

      <section id="decision-history" className="data-card finance-panel">
        <div className="section-header">
          <div>
            <h3>Décidées</h3>
            <p className="meta">Historique recent des arbitrages Go/No-Go deja rendus.</p>
          </div>
        </div>
        <div className="section-body">
          {workspace.history.length > 0 ? (
            <div className="table-shell">
              <table className="finance-dossiers-table">
                <thead>
                  <tr>
                    <th>Dossier</th>
                    <th>Echeance</th>
                    <th>Decision</th>
                    <th>Rationale / reserves</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>{workspace.history.map(renderRow)}</tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              compact
              title="Aucune decision enregistree"
              description="Les Go/No-Go rendus apparaitront ici pour relecture."
            />
          )}
        </div>
      </section>
    </div>
  );
}
