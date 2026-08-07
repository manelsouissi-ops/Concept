import Link from "next/link";
import { ClockIcon, FolderIcon, LibraryIcon, CheckCircleIcon } from "@/components/app-icons.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { StatCard } from "@/components/stat-card.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import type {
  CommercialWorkspacePresentation
} from "@/lib/appels-offres/commercial-workspace.ts";

function getKpiIcon(key: string) {
  switch (key) {
    case "my-active":
      return <FolderIcon className="stat-icon" />;
    case "to-assign":
      return <ClockIcon className="stat-icon" />;
    case "ready":
      return <CheckCircleIcon className="stat-icon" />;
    case "awaiting-dg":
      return <LibraryIcon className="stat-icon" />;
    case "in-progress":
    default:
      return <FolderIcon className="stat-icon" />;
  }
}

export function CommercialWorkspace({
  workspace
}: {
  workspace: CommercialWorkspacePresentation;
}) {
  return (
    <div className="page-stack finance-workspace">
      <section className="data-card finance-hero">
        <div className="finance-hero-copy">
          <span className="page-eyebrow">Coordination Commerciale</span>
          <h1>{workspace.heroTitle}</h1>
          <p className="finance-hero-role">{workspace.currentUser.roleTitle}</p>
          <p className="finance-hero-summary">{workspace.heroSummary}</p>
        </div>
      </section>

      <section className="kpi-grid finance-kpi-grid" aria-label="Indicateurs de coordination">
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

      <section className="data-card finance-panel">
        <div className="section-header">
          <div>
            <h3>Sans responsable</h3>
            <p className="meta">Dossiers a attribuer ou a reaffecter avant toute coordination.</p>
          </div>
        </div>
        <div className="section-body">
          {workspace.unownedQueue.length > 0 ? (
            <div className="department-history-list">
              {workspace.unownedQueue.map((item) => (
                <article key={item.key} className="department-history-item">
                  <div className="department-history-copy">
                    <span className="mono finance-dossiers-code">{item.code}</span>
                    <strong title={item.title}>{item.title}</strong>
                    <span>{item.client}</span>
                    <small>{item.summary}</small>
                  </div>
                  <div className="workspace-card-actions">
                    <StatusBadge label={item.statusLabel} tone={item.statusTone} />
                    <Link href={item.actionHref} className="button button-secondary button-small">
                      {item.actionLabel}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="Aucun dossier sans responsable"
              description="Les dossiers a attribuer ou reaffecter apparaitront ici."
            />
          )}
        </div>
      </section>

      <section className="data-card finance-panel">
        <div className="section-header">
          <div>
            <h3>Actions requises</h3>
            <p className="meta">Affectations a faire, blocages a lever et dossiers a preparer.</p>
          </div>
        </div>
        <div className="section-body">
          {workspace.actionsRequired.length > 0 ? (
            <div className="department-history-list">
              {workspace.actionsRequired.map((item) => (
                <article key={item.key} className="department-history-item">
                  <div className="department-history-copy">
                    <span className="mono finance-dossiers-code">{item.code}</span>
                    <strong title={item.title}>{item.title}</strong>
                    <span>{item.client}</span>
                    <small>{item.summary}</small>
                  </div>
                  <div className="workspace-card-actions">
                    <StatusBadge label={item.statusLabel} tone={item.statusTone} />
                    <Link href={item.actionHref} className="button button-secondary button-small">
                      {item.actionLabel}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="Aucune action immediate"
              description="Les prochains dossiers a coordonner apparaitront ici."
            />
          )}
        </div>
      </section>

      <section id="commercial-tracking" className="data-card finance-panel finance-dossiers-panel">
        <div className="section-header">
          <div>
            <h3>Suivi des contributions</h3>
            <p className="meta">Pilotage de la contribution Commerciale, Finance et Operations.</p>
          </div>
        </div>
        <div className="section-body">
          {workspace.tracking.length > 0 ? (
            <div className="table-shell">
              <table className="finance-dossiers-table">
                <thead>
                  <tr>
                    <th>Dossier</th>
                    <th>Commercial A</th>
                    <th>Finance B</th>
                    <th>Operations C</th>
                    <th>Etat global</th>
                    <th>Derniere activite</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.tracking.map((row) => (
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
                      <td>{row.commercialLabel}</td>
                      <td>{row.financeLabel}</td>
                      <td>{row.operationsLabel}</td>
                      <td>
                        <StatusBadge label={row.overallStateLabel} tone={row.overallStateTone} />
                      </td>
                      <td>{row.latestActivity}</td>
                      <td>
                        <Link href={row.actionHref} className="button button-secondary button-small">
                          {row.actionLabel}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              compact
              title="Aucun dossier a suivre"
              description="Les contributions FCI apparaitront ici apres validation de la Fiche CDC."
            />
          )}
        </div>
      </section>

      <section className="finance-secondary-grid">
        <section id="commercial-awaiting-dg" className="data-card finance-panel">
          <div className="section-header">
            <div>
              <h3>En attente DG</h3>
              <p className="meta">Dossiers soumis a la Direction generale et en attente d'arbitrage.</p>
            </div>
          </div>
          <div className="section-body">
            {workspace.awaitingDg.length > 0 ? (
              <div className="department-history-list">
                {workspace.awaitingDg.map((item) => (
                  <article key={item.code} className="department-history-item">
                    <div className="department-history-copy">
                      <span className="mono finance-dossiers-code">{item.code}</span>
                      <strong title={item.title}>{item.title}</strong>
                      <span>{item.client}</span>
                      <small>{item.detailLabel}</small>
                    </div>
                    <div className="workspace-card-actions">
                      <StatusBadge label={item.statusLabel} tone={item.statusTone} />
                      <Link href={item.actionHref} className="button button-ghost button-small">
                        {item.actionLabel}
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                title="Aucun dossier en attente DG"
                description="Les soumissions a la Direction generale apparaitront ici."
              />
            )}
          </div>
        </section>

        <section id="commercial-history" className="data-card finance-panel">
          <div className="section-header">
            <div>
              <h3>Decisions recentes</h3>
              <p className="meta">Historique recent des arbitrages Go/No-Go deja rendus.</p>
            </div>
          </div>
          <div className="section-body">
            {workspace.recentDecisions.length > 0 ? (
              <div className="department-history-list">
                {workspace.recentDecisions.map((item) => (
                  <article key={item.code} className="department-history-item">
                    <div className="department-history-copy">
                      <span className="mono finance-dossiers-code">{item.code}</span>
                      <strong title={item.title}>{item.title}</strong>
                      <span>{item.client}</span>
                      <small>{item.detailLabel}</small>
                    </div>
                    <div className="workspace-card-actions">
                      <StatusBadge label={item.statusLabel} tone={item.statusTone} />
                      <Link href={item.actionHref} className="button button-ghost button-small">
                        {item.actionLabel}
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                title="Aucune decision recente"
                description="Les arbitrages Go/No-Go apparaissent ici apres decision DG."
              />
            )}
          </div>
        </section>
      </section>
    </div>
  );
}
