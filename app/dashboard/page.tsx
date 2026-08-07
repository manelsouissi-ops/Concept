import Link from "next/link";
import type { ReactNode } from "react";
import { ActivityFeed } from "@/components/activity-feed.tsx";
import {
  CheckCircleIcon,
  ClockIcon,
  FileTextIcon,
  FolderIcon
} from "@/components/app-icons.tsx";
import { DashboardRecentAppelsTable } from "@/components/dashboard-recent-appels-table.tsx";
import { DecisionWorkspace } from "@/components/decision-workspace.tsx";
import { DepartmentTaskWorkspace } from "@/components/department-task-workspace.tsx";
import { CommercialWorkspace } from "@/components/commercial-workspace.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { getCommercialWorkspacePresentation } from "@/lib/appels-offres/commercial-workspace.ts";
import { getDashboardData } from "@/lib/appels-offres/dashboard.ts";
import { getDecisionWorkspacePresentation } from "@/lib/appels-offres/decision-workspace.ts";
import { getFinanceWorkspacePresentation } from "@/lib/appels-offres/finance-workspace.ts";
import { getRoleWorkspaceExperience } from "@/lib/appels-offres/role-workspace.ts";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
import { getFciModuleForRole } from "@/lib/auth/rbac.ts";
import type { WorkspaceActivityItem } from "@/lib/appels-offres/workspace.ts";

type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
type DashboardTaskItem = {
  key: string;
  title: string;
  supportingText: string;
  icon?: ReactNode;
  href?: string;
  actionLabel?: string;
  tone?: "default" | "success" | "warning" | "danger" | "muted";
};

type DashboardStatItem = {
  key: string;
  label: string;
  value: number;
  href?: string;
  tone?: "default" | "success" | "warning" | "danger" | "ai";
};

function getDashboardFilterHref(kind: "total" | "processing" | "validation") {
  switch (kind) {
    case "total":
      return "/appels-offres";
    case "processing":
      return "/appels-offres?status=analyse_en_cours";
    case "validation":
    default:
      return "/appels-offres?status=fiche_a_valider";
  }
}

// COMMERCIAL owns intake and Fiche CDC validation ahead of any FCI module work,
// so its dashboard stays centered on that stage. This mirrors the existing
// (unchanged) behavior.
function buildCommercialStats(dashboard: DashboardData) {
  return [
    {
      key: "total",
      label: "Total",
      value: dashboard.total_appels_offres,
      href: dashboard.total_appels_offres > 0 ? getDashboardFilterHref("total") : undefined,
      tone: "default"
    },
    {
      key: "nouveaux",
      label: "Nouveaux",
      value: dashboard.nouveaux,
      tone: "default"
    },
    {
      key: "processing",
      label: "En cours d'analyse",
      value: dashboard.analyses_en_cours,
      href: dashboard.analyses_en_cours > 0 ? getDashboardFilterHref("processing") : undefined,
      tone: "ai"
    },
    {
      key: "validation",
      label: "A valider",
      value: dashboard.fiches_cdc_a_valider,
      href: dashboard.fiches_cdc_a_valider > 0 ? getDashboardFilterHref("validation") : undefined,
      tone: "warning"
    },
    {
      key: "termines",
      label: "Termines",
      value: dashboard.termines,
      tone: "success"
    }
  ] satisfies DashboardStatItem[];
}

function buildRecentActivityItems(dashboard: DashboardData) {
  return dashboard.recent_activity.slice(0, 3).map<WorkspaceActivityItem>((entry) => ({
    id: entry.id,
    kind: entry.kind,
    label: entry.label,
    description: entry.code,
    actor: null,
    createdAt: entry.createdAt,
    tone: entry.tone
  }));
}

function buildCommercialActionItems(dashboard: DashboardData, deadlineCount: number) {
  return [
    dashboard.actions_requises.fiches_cdc_a_valider.length > 0
      ? {
          key: "validation",
          title: "Fiches CDC a valider",
          supportingText: `${dashboard.actions_requises.fiches_cdc_a_valider.length} dossier${dashboard.actions_requises.fiches_cdc_a_valider.length > 1 ? "s a relire" : " a relire"}`,
          href: getDashboardFilterHref("validation"),
          actionLabel: "Revoir les fiches",
          tone: "warning",
          icon: <FileTextIcon className="stat-icon" />
        }
      : null,
    dashboard.actions_requises.analyses_fci_a_generer.length > 0
      ? {
          key: "fci-generer",
          title: "Modules FCI a suivre",
          supportingText: `${dashboard.actions_requises.analyses_fci_a_generer.length} dossier${dashboard.actions_requises.analyses_fci_a_generer.length > 1 ? "s concernes" : " concerne"}`,
          href: "/appels-offres?status=fiche_validee",
          actionLabel: "Suivre",
          tone: "muted",
          icon: <FolderIcon className="stat-icon" />
        }
      : null,
    dashboard.actions_requises.dossiers_prets_pour_offre.length > 0
      ? {
          key: "prets-offre",
          title: "Dossiers prets pour l'offre",
          supportingText: `${dashboard.actions_requises.dossiers_prets_pour_offre.length} dossier${dashboard.actions_requises.dossiers_prets_pour_offre.length > 1 ? "s prets" : " pret"}`,
          href: "/appels-offres?status=fiche_validee",
          actionLabel: "Consulter",
          tone: "success",
          icon: <CheckCircleIcon className="stat-icon" />
        }
      : null,
    dashboard.actions_requises.dossiers_a_verifier.length > 0
      ? {
          key: "a-verifier",
          title: "Dossiers a verifier",
          supportingText: `${dashboard.actions_requises.dossiers_a_verifier.length} dossier${dashboard.actions_requises.dossiers_a_verifier.length > 1 ? "s a verifier" : " a verifier"}`,
          href: "/appels-offres?status=erreur",
          actionLabel: "Verifier ces dossiers",
          tone: "muted",
          icon: <FolderIcon className="stat-icon" />
        }
      : null,
    deadlineCount > 0
      ? {
          key: "deadlines",
          title: "Echeances proches",
          supportingText: `${deadlineCount} appel${deadlineCount > 1 ? "s d'offres approchent de leur echeance" : " d'offres approche de son echeance"}`,
          href: "/appels-offres?sort=deadline",
          actionLabel: "Voir les echeances",
          tone: "default",
          icon: <ClockIcon className="stat-icon" />
        }
      : null
  ].filter(Boolean) as DashboardTaskItem[];
}

export default async function DashboardPage() {
  const currentUser = await requireAreaAccessForPage("dashboard");
  const workspaceExperience = getRoleWorkspaceExperience(currentUser.role);
  if (workspaceExperience.dashboardVariant === "department_minimal") {
    try {
      // FINANCE/OPERATIONS each own exactly one editable FCI module (B/C), so
      // their dashboard stays scoped to that single task lane.
      const moduleCode = getFciModuleForRole(currentUser.role);
      if (!moduleCode) {
        throw new Error("Aucun module FCI n'est associe a ce role.");
      }
      const financeWorkspace = await getFinanceWorkspacePresentation(currentUser, moduleCode);
      return <DepartmentTaskWorkspace workspace={financeWorkspace} />;
    } catch (error) {
      return (
        <div className="page-stack">
          <section className="data-card">
            <div className="section-header">
              <div>
                <h3>Espace {currentUser.departmentLabel}</h3>
                <p className="meta">Workspace personnel indisponible.</p>
              </div>
            </div>
            <div className="section-body">
              <EmptyState
                title="Chargement impossible"
                description={
                  error instanceof Error
                    ? error.message
                    : "Le workspace n'a pas pu etre charge."
                }
              />
            </div>
          </section>
        </div>
      );
    }
  }

  if (workspaceExperience.dashboardVariant === "decision") {
    try {
      const decisionWorkspace = await getDecisionWorkspacePresentation(currentUser);
      return <DecisionWorkspace workspace={decisionWorkspace} />;
    } catch (error) {
      return (
        <div className="page-stack">
          <section className="data-card">
            <div className="section-header">
              <div>
                <h3>Centre de decision DG</h3>
                <p className="meta">File Go/No-Go indisponible.</p>
              </div>
            </div>
            <div className="section-body">
              <EmptyState
                title="Chargement impossible"
                description={
                  error instanceof Error
                    ? error.message
                    : "Le centre de decision n'a pas pu etre charge."
                }
              />
            </div>
          </section>
        </div>
      );
    }
  }

  if (workspaceExperience.dashboardVariant === "commercial_coordination") {
    try {
      const commercialWorkspace = await getCommercialWorkspacePresentation(currentUser);
      return <CommercialWorkspace workspace={commercialWorkspace} />;
    } catch (error) {
      return (
        <div className="page-stack">
          <section className="data-card">
            <div className="section-header">
              <div>
                <h3>Pilotage des appels d'offres</h3>
                <p className="meta">Workspace de coordination indisponible.</p>
              </div>
            </div>
            <div className="section-body">
              <EmptyState
                title="Chargement impossible"
                description={
                  error instanceof Error
                    ? error.message
                    : "Le workspace de coordination n'a pas pu etre charge."
                }
              />
            </div>
          </section>
        </div>
      );
    }
  }

  try {
    const dashboard = await getDashboardData();
    const dashboardNowReference = new Date().toISOString();
    const recentActivity = buildRecentActivityItems(dashboard);
    const statItems = buildCommercialStats(dashboard);
    const deadlineCount = dashboard.actions_requises.appels_proches_date_limite.length;
    const actionItems = buildCommercialActionItems(dashboard, deadlineCount);

    if (dashboard.total_appels_offres === 0) {
      return (
        <div className="page-stack">
          <section className="data-card dashboard-hero dashboard-hero-empty">
            <EmptyState
              compact
              title="Bienvenue sur CONCEPT"
              description="Importez votre premier appel d'offres pour commencer."
              action={
                <Link href="/appels-offres/nouveau" className="button button-primary">
                  Nouvel appel d'offres
                </Link>
              }
            />
          </section>
        </div>
      );
    }

    return (
      <div className="page-stack">
        <section className="data-card dashboard-hero">
          <h1>Bonjour {currentUser.firstName}</h1>
          <p className="dashboard-hero-summary">Voici l&apos;etat de vos appels d&apos;offres aujourd&apos;hui.</p>
        </section>

        <section className="data-card dashboard-stats-strip">
          {statItems.map((item) =>
            item.href ? (
              <Link
                key={item.key}
                href={item.href}
                className={`dashboard-stat-cell interactive tone-${item.tone ?? "default"}`}
              >
                <strong className="dashboard-stat-value">{item.value}</strong>
                <span className="dashboard-stat-label">{item.label}</span>
              </Link>
            ) : (
              <div key={item.key} className={`dashboard-stat-cell tone-${item.tone ?? "default"}`}>
                <strong className="dashboard-stat-value">{item.value}</strong>
                <span className="dashboard-stat-label">{item.label}</span>
              </div>
            )
          )}
        </section>

        <section className="dashboard-main-grid">
          <section className="data-card dashboard-section-compact">
            <div className="section-header">
              <div>
                <h3>Appels d&apos;offres recents</h3>
                <p className="meta">Les cinq dossiers les plus recents a ouvrir rapidement.</p>
              </div>
              <Link href="/appels-offres" className="button button-secondary button-small">
                Voir tout
              </Link>
            </div>
            <div className="section-body">
              {dashboard.recent_appels_offres.length ? (
                <DashboardRecentAppelsTable
                  items={dashboard.recent_appels_offres.map(
                    ({ detail, displayTitle, clientLabel, statusDisplay, nextAction }) => ({
                      code: detail.code,
                      title: displayTitle,
                      client: clientLabel,
                      statusLabel: statusDisplay.label,
                      statusTone: statusDisplay.tone,
                      nextAction
                    })
                  )}
                />
              ) : (
                <EmptyState
                  compact
                  title="Aucun dossier recent"
                  description="Creez un premier appel d'offres pour commencer le pilotage."
                />
              )}
            </div>
          </section>

          <section className="data-card dashboard-section-compact dashboard-actions-panel">
            <div className="section-header">
              <div>
                <h3>Actions prioritaires</h3>
                <p className="meta">Ce qui demande votre prochaine action.</p>
              </div>
            </div>
            <div className="section-body">
              {actionItems.length ? (
                <div className="dashboard-task-list">
                  {actionItems.map((section) => {
                    const tone = section.tone ?? "default";

                    return (
                      <article key={section.key} className={`dashboard-task-row tone-${tone}`}>
                        <div className="dashboard-task-main">
                          {section.icon ? (
                            <span className="dashboard-task-icon" aria-hidden="true">
                              {section.icon}
                            </span>
                          ) : null}
                          <div className="dashboard-task-copy">
                            <strong>{section.title}</strong>
                            <p>{section.supportingText}</p>
                          </div>
                        </div>
                        {section.href && section.actionLabel ? (
                          <Link href={section.href} className="dashboard-task-link">
                            {section.actionLabel} {"→"}
                          </Link>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="dashboard-task-list">
                  <p className="dashboard-task-footer-note">
                    <CheckCircleIcon className="dashboard-task-footer-icon" />
                    <span>Aucune action prioritaire en attente.</span>
                  </p>
                </div>
              )}
            </div>
          </section>
        </section>

        <section className="data-card dashboard-section-compact dashboard-activity-card">
          <div className="section-header">
            <div>
              <h3>Activite recente</h3>
              <p className="meta">Les derniers evenements metier utiles au suivi de la plateforme.</p>
            </div>
          </div>
          <div className="section-body">
            {recentActivity.length ? (
              <div className="dashboard-activity-feed">
                <ActivityFeed
                  items={recentActivity}
                  variant="compact"
                  compactDateMode="relative"
                  nowReference={dashboardNowReference}
                  subtleIcons
                />
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
    );
  } catch (error) {
    return (
      <div className="page-stack">
        <section className="data-card">
          <div className="section-header">
            <div>
              <h3>Tableau de bord</h3>
              <p className="meta">Vue d'ensemble des appels d'offres et des actions en attente.</p>
            </div>
          </div>
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
