import Link from "next/link";
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  DashboardIcon,
  FileTextIcon,
  FolderIcon
} from "@/components/app-icons.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import { StatCard } from "@/components/stat-card.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import { getDashboardData } from "@/lib/appels-offres/dashboard.ts";

function formatDate(value: string | null) {
  if (!value) {
    return "Non renseignée";
  }

  return new Date(value).toLocaleDateString("fr-FR");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("fr-FR");
}

export default async function DashboardPage() {
  try {
    const dashboard = await getDashboardData();

    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="Pilotage"
          title="Tableau de bord"
          description="Vue d'ensemble des appels d'offres et des actions en attente."
          actions={
            <Link href="/appels-offres/nouveau" className="button button-primary">
              Nouvel appel d'offres
            </Link>
          }
        />

        <section className="kpi-grid">
          <StatCard
            icon={<FolderIcon className="stat-icon" />}
            label="Total appels d'offres"
            value={dashboard.total_appels_offres}
            description={
              dashboard.total_appels_offres
                ? `${dashboard.total_appels_offres} dossier(s) actifs et ${dashboard.archives} archive(s).`
                : "Aucun appel d'offres n'est encore enregistré."
            }
            href="/appels-offres"
            actionLabel="Voir la liste"
          />
          <StatCard
            icon={<ClockIcon className="stat-icon" />}
            label="En attente d'analyse"
            value={dashboard.en_attente_analyse}
            description="Dossiers prêts à lancer en analyse."
            href="/appels-offres"
            actionLabel="Filtrer la liste"
          />
          <StatCard
            icon={<DashboardIcon className="stat-icon" />}
            label="Analyses en cours"
            value={dashboard.analyses_en_cours}
            description="Traitements actifs actuellement."
            href="/appels-offres"
            actionLabel="Ouvrir les dossiers"
          />
          <StatCard
            icon={<FileTextIcon className="stat-icon" />}
            label="Fiches CDC à valider"
            value={dashboard.fiches_cdc_a_valider}
            description="Relectures commerciales en attente."
            href="/appels-offres"
            actionLabel="Traiter maintenant"
          />
          <StatCard
            icon={<CheckCircleIcon className="stat-icon" />}
            label="Fiches CDC validées"
            value={dashboard.fiches_cdc_validees}
            description="Dossiers prêts pour l'étape suivante."
          />
          <StatCard
            icon={<AlertIcon className="stat-icon" />}
            label="Erreurs de traitement"
            value={dashboard.erreurs_traitement}
            description="Dossiers nécessitant une reprise."
            href="/appels-offres"
            actionLabel="Voir les erreurs"
          />
        </section>

        <div className="dashboard-grid">
          <section className="data-card">
            <div className="section-header">
              <div>
                <h3>Appels d'offres récents</h3>
                <p className="meta">Derniers dossiers mis à jour ou créés dans la plateforme.</p>
              </div>
              <Link href="/appels-offres" className="button button-secondary button-small">
                Voir tout
              </Link>
            </div>
            <div className="section-body">
              {dashboard.recent_appels_offres.length ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Intitulé</th>
                        <th>Client</th>
                        <th>Pays</th>
                        <th>Statut</th>
                        <th>Responsable</th>
                        <th>Date limite</th>
                        <th>Progression</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.recent_appels_offres.map(({ detail, summary }) => (
                        <tr key={detail.code}>
                          <td className="mono">{detail.code}</td>
                          <td>{detail.title}</td>
                          <td>{summary.client}</td>
                          <td>{summary.country}</td>
                          <td>
                            <StatusBadge label={summary.statusLabel} tone={summary.statusTone} />
                          </td>
                          <td>{summary.ownerLabel}</td>
                          <td>{formatDate(detail.dueDate)}</td>
                          <td>
                            <div className="progress-cell">
                              <div className="progress-bar">
                                <span style={{ width: `${summary.progressValue}%` }} />
                              </div>
                              <small>{summary.currentStep}</small>
                            </div>
                          </td>
                          <td>
                            <Link
                              href={`/appels-offres/${encodeURIComponent(detail.code)}`}
                              className="button button-ghost button-small"
                            >
                              Ouvrir
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
                  title="Aucun dossier récent"
                  description="Créez un premier appel d'offres pour commencer le pilotage."
                />
              )}
            </div>
          </section>

          <div className="stack">
            <section className="data-card">
              <div className="section-header">
                <div>
                  <h3>Actions requises</h3>
                  <p className="meta">Éléments à traiter en priorité.</p>
                </div>
              </div>
              <div className="section-body stack">
                <article className="action-card">
                  <strong>Fiches CDC à valider</strong>
                  <span>{dashboard.actions_requises.fiches_cdc_a_valider.length} dossier(s)</span>
                  <p>Les Fiches CDC générées attendent une validation commerciale.</p>
                </article>
                <article className="action-card">
                  <strong>Analyses en erreur</strong>
                  <span>{dashboard.actions_requises.analyses_en_erreur.length} dossier(s)</span>
                  <p>Relancez les traitements bloqués pour sécuriser le planning.</p>
                </article>
                <article className="action-card">
                  <strong>Échéances proches</strong>
                  <span>{dashboard.actions_requises.appels_proches_date_limite.length} dossier(s)</span>
                  <p>Appels d'offres proches de la date limite dans les 14 prochains jours.</p>
                </article>
                <article className="action-card muted">
                  <strong>FCI en attente</strong>
                  <span>{dashboard.actions_requises.fci_en_attente.length} dossier(s)</span>
                  <p>Module FCI à venir après validation de la Fiche CDC.</p>
                </article>
              </div>
            </section>

            <section className="data-card">
              <div className="section-header">
                <div>
                  <h3>Activité récente</h3>
                  <p className="meta">Historique transversal des derniers événements réels.</p>
                </div>
              </div>
              <div className="section-body">
                {dashboard.recent_activity.length ? (
                  <div className="timeline-list">
                    {dashboard.recent_activity.map((entry) => (
                      <article key={entry.id} className="timeline-item">
                        <div className="timeline-dot" />
                        <div className="timeline-content">
                          <strong>{entry.action}</strong>
                          <span>
                            {entry.title} · {entry.code} · {formatDateTime(entry.createdAt)}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    compact
                    title="Aucune activité récente"
                    description="Les événements apparaîtront ici à mesure que les dossiers progresseront."
                  />
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  } catch (error) {
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow="Pilotage"
          title="Tableau de bord"
          description="Vue d'ensemble des appels d'offres et des actions en attente."
        />
        <section className="data-card">
          <div className="section-body">
            <EmptyState
              title="Chargement impossible"
              description={
                error instanceof Error
                  ? error.message
                  : "Le tableau de bord n'a pas pu être chargé."
              }
            />
          </div>
        </section>
      </div>
    );
  }
}
