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
import { isPlaceholderProjectTitle } from "@/lib/appels-offres/workspace.ts";

function formatDate(value: string | null) {
  if (!value) {
    return "Non renseignee";
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
          description="Vue d'ensemble des appels d'offres, des traitements en cours et des validations en attente."
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
                : "Aucun appel d'offres n'est encore enregistre."
            }
            href="/appels-offres"
            actionLabel="Voir la liste"
            tone="success"
          />
          <StatCard
            icon={<ClockIcon className="stat-icon" />}
            label="En attente d'analyse"
            value={dashboard.en_attente_analyse}
            description="Dossiers prets a lancer en analyse."
            href="/appels-offres"
            actionLabel="Filtrer la liste"
            tone="warning"
          />
          <StatCard
            icon={<DashboardIcon className="stat-icon" />}
            label="Analyses en cours"
            value={dashboard.analyses_en_cours}
            description="Traitements actifs actuellement."
            href="/appels-offres"
            actionLabel="Ouvrir les dossiers"
            tone="ai"
          />
          <StatCard
            icon={<FileTextIcon className="stat-icon" />}
            label="Fiches CDC a valider"
            value={dashboard.fiches_cdc_a_valider}
            description="Relectures commerciales en attente."
            href="/appels-offres"
            actionLabel="Traiter maintenant"
            tone="ai"
          />
          <StatCard
            icon={<CheckCircleIcon className="stat-icon" />}
            label="Fiches CDC validees"
            value={dashboard.fiches_cdc_validees}
            description="Dossiers prets pour l'etape suivante."
            tone="success"
          />
          <StatCard
            icon={<AlertIcon className="stat-icon" />}
            label="Erreurs de traitement"
            value={dashboard.erreurs_traitement}
            description="Dossiers necessitant une reprise."
            href="/appels-offres"
            actionLabel="Voir les erreurs"
            tone="danger"
          />
        </section>

        <div className="dashboard-grid">
          <section className="data-card">
            <div className="section-header">
              <div>
                <h3>Appels d'offres recents</h3>
                <p className="meta">Derniers dossiers mis a jour ou crees dans la plateforme.</p>
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
                        <th>Intitule</th>
                        <th>Client</th>
                        <th>Pays</th>
                        <th>Statut</th>
                        <th>Responsable</th>
                        <th>Date limite</th>
                        <th>Etape courante</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.recent_appels_offres.map(({ detail, summary }) => (
                        <tr key={detail.code}>
                          <td>
                            <span className="mono table-code" title={detail.code}>
                              {detail.code}
                            </span>
                          </td>
                          <td title={detail.title}>
                            {isPlaceholderProjectTitle(detail.title, detail.code)
                              ? "Intitule en attente d'extraction"
                              : detail.title}
                          </td>
                          <td>{summary.client}</td>
                          <td>{summary.country}</td>
                          <td>
                            <StatusBadge label={summary.statusLabel} tone={summary.statusTone} />
                          </td>
                          <td>{summary.ownerLabel}</td>
                          <td>
                            <div className={summary.isOverdue ? "deadline-cell overdue" : summary.daysUntilDeadline != null && summary.daysUntilDeadline <= 14 ? "deadline-cell near" : "deadline-cell"}>
                              <strong>{formatDate(detail.dueDate)}</strong>
                              {summary.daysUntilDeadline != null ? (
                                <span>
                                  {summary.daysUntilDeadline < 0
                                    ? `Depassee de ${Math.abs(summary.daysUntilDeadline)} j`
                                    : summary.daysUntilDeadline === 0
                                      ? "Echeance aujourd'hui"
                                      : `J-${summary.daysUntilDeadline}`}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td>{summary.currentStep}</td>
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
                  title="Aucun dossier recent"
                  description="Creez un premier appel d'offres pour commencer le pilotage."
                />
              )}
            </div>
          </section>

          <div className="stack">
            <section className="data-card">
              <div className="section-header">
                <div>
                  <h3>Actions requises</h3>
                  <p className="meta">Elements a traiter en priorite.</p>
                </div>
              </div>
              <div className="section-body stack">
                <article className="action-card">
                  <strong>Fiches CDC a valider</strong>
                  <span>{dashboard.actions_requises.fiches_cdc_a_valider.length} dossier(s)</span>
                  <p>Les Fiches CDC generees attendent une validation commerciale.</p>
                  <Link href="/appels-offres?status=fiche_a_valider" className="button button-secondary button-small">
                    Ouvrir les dossiers
                  </Link>
                </article>
                <article className="action-card">
                  <strong>Analyses en erreur</strong>
                  <span>{dashboard.actions_requises.analyses_en_erreur.length} dossier(s)</span>
                  <p>Relancez les traitements bloques pour securiser le planning.</p>
                  <Link href="/appels-offres?status=erreur" className="button button-secondary button-small">
                    Voir les erreurs
                  </Link>
                </article>
                <article className="action-card">
                  <strong>Echeances proches</strong>
                  <span>{dashboard.actions_requises.appels_proches_date_limite.length} dossier(s)</span>
                  <p>Appels d'offres proches de la date limite dans les 14 prochains jours.</p>
                  <Link href="/appels-offres?sort=deadline" className="button button-secondary button-small">
                    Trier par echeance
                  </Link>
                </article>
                <article className="action-card muted">
                  <strong>FCI en attente</strong>
                  <span>{dashboard.actions_requises.fci_en_attente.length} dossier(s)</span>
                  <p>Module FCI a venir apres validation de la Fiche CDC.</p>
                  <Link href="/appels-offres?status=fiche_validee" className="button button-secondary button-small">
                    Voir les dossiers prets
                  </Link>
                </article>
              </div>
            </section>

            <section className="data-card">
              <div className="section-header">
                <div>
                  <h3>Activite recente</h3>
                  <p className="meta">Historique transversal des derniers evenements reels.</p>
                </div>
              </div>
              <div className="section-body">
                {dashboard.recent_activity.length ? (
                  <div className="timeline-list">
                    {dashboard.recent_activity.map((entry) => (
                      <article key={entry.id} className="timeline-item">
                        <div className="timeline-dot" />
                        <div className="timeline-content">
                          <strong>{entry.label}</strong>
                          <span>
                            {entry.title} · {entry.code} · {formatDateTime(entry.createdAt)}
                          </span>
                          {entry.description ? <span>{entry.description}</span> : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    compact
                    title="Aucune activite recente"
                    description="Les evenements apparaitront ici a mesure que les dossiers progresseront."
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
                  : "Le tableau de bord n'a pas pu etre charge."
              }
            />
          </div>
        </section>
      </div>
    );
  }
}
