import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertIcon,
  CheckCircleIcon,
  ClockIcon,
  LibraryIcon,
  UserCircleIcon
} from "@/components/app-icons.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { PageHeader } from "@/components/page-header.tsx";
import { StatCard } from "@/components/stat-card.tsx";
import { StatusBadge } from "@/components/status-badge.tsx";
import { UserAvatar } from "@/components/user-avatar.tsx";
import {
  getAdministrationDashboardData,
  type AdministrationHealthItem
} from "@/lib/administration/dashboard.ts";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";

function formatActivityTimestamp(value: string) {
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getActivityIcon(tone: "neutral" | "success" | "warning"): ReactNode {
  switch (tone) {
    case "success":
      return <CheckCircleIcon className="admin-activity-icon" />;
    case "warning":
      return <AlertIcon className="admin-activity-icon" />;
    default:
      return <UserCircleIcon className="admin-activity-icon" />;
  }
}

const HEALTH_GROUP_LABELS: Record<AdministrationHealthItem["kindLabel"], string> = {
  Operation: "Operationnel",
  Configuration: "Configuration"
};

export default async function AdministrationDashboardPage() {
  await requireAreaAccessForPage("administration");
  const dashboard = await getAdministrationDashboardData();

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Administration technique"
        title="Vue d'ensemble"
        description="Surveillez les acces, la securite et les services de la plateforme."
        actions={
          <>
            <Link href="/administration/utilisateurs/nouveau" className="button button-secondary">
              Nouvel utilisateur
            </Link>
            <Link href="/administration/logiciels/nouveau" className="button button-primary">
              Nouveau logiciel
            </Link>
          </>
        }
      />

      {dashboard.alerts.length > 0 ? (
        <section className="data-card dashboard-section-compact">
          <div className="section-header">
            <div>
              <h3>A surveiller</h3>
              <p className="meta">Les alertes ci-dessous reposent sur des etats reels de la plateforme.</p>
            </div>
          </div>
          <div className="section-body">
            <div className="admin-alert-list">
              {dashboard.alerts.map((alert) => (
                <article key={alert.id} className={`admin-alert-row tone-${alert.tone}`}>
                  <div className="admin-alert-copy">
                    <strong>{alert.label}</strong>
                    <p>{alert.description}</p>
                  </div>
                  {alert.href && alert.actionLabel ? (
                    <Link href={alert.href} className="button button-secondary button-small">
                      {alert.actionLabel}
                    </Link>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="kpi-grid admin-kpi-grid">
        <StatCard
          icon={<UserCircleIcon className="stat-icon" />}
          label={dashboard.metrics.users.label}
          value={dashboard.metrics.users.value}
          description={dashboard.metrics.users.description}
          href={dashboard.metrics.users.href}
          actionLabel={dashboard.metrics.users.actionLabel}
          tone={dashboard.metrics.users.tone}
          statusTone={dashboard.metrics.users.statusDotTone}
        />
        <StatCard
          icon={<LibraryIcon className="stat-icon" />}
          label={dashboard.metrics.software.label}
          value={dashboard.metrics.software.value}
          description={dashboard.metrics.software.description}
          href={dashboard.metrics.software.href}
          actionLabel={dashboard.metrics.software.actionLabel}
          tone={dashboard.metrics.software.tone}
          statusTone={dashboard.metrics.software.statusDotTone}
        />
        <StatCard
          icon={<ClockIcon className="stat-icon" />}
          label={dashboard.metrics.sessions.label}
          value={dashboard.metrics.sessions.value}
          description={dashboard.metrics.sessions.description}
          href={dashboard.metrics.sessions.href}
          actionLabel={dashboard.metrics.sessions.actionLabel}
          tone={dashboard.metrics.sessions.tone}
          statusTone={dashboard.metrics.sessions.statusDotTone}
        />
        <StatCard
          icon={
            dashboard.metrics.security.tone === "danger" ? (
              <AlertIcon className="stat-icon" />
            ) : (
              <CheckCircleIcon className="stat-icon" />
            )
          }
          label={dashboard.metrics.security.label}
          value={dashboard.metrics.security.value}
          description={dashboard.metrics.security.description}
          href={dashboard.metrics.security.href}
          actionLabel={dashboard.metrics.security.actionLabel}
          tone={dashboard.metrics.security.tone}
          statusTone={dashboard.metrics.security.statusDotTone}
        />
      </section>

      <section className="admin-dashboard-grid">
        <div className="admin-main-stack">
          <section className="data-card dashboard-section-compact">
            <div className="section-header">
              <div>
                <h3>Activite recente</h3>
                <p className="meta">Journal recent des acces et evenements de securite.</p>
              </div>
            </div>
            <div className="section-body">
              {dashboard.recentActivity.state === "ready" ? (
                <div className="admin-activity-list">
                  {dashboard.recentActivity.items.map((item) => (
                    <article key={item.id} className={`admin-activity-row tone-${item.tone}`}>
                      <span className="admin-activity-icon-shell" aria-hidden="true">
                        {getActivityIcon(item.tone)}
                      </span>
                      <div className="admin-activity-main">
                        <div className="admin-activity-copy">
                          <strong>{item.label}</strong>
                          <p>{item.summary}</p>
                        </div>
                        <time dateTime={item.createdAt} className="admin-activity-time">
                          {formatActivityTimestamp(item.createdAt)}
                        </time>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  compact
                  title={
                    dashboard.recentActivity.state === "unavailable"
                      ? "Activite indisponible"
                      : "Aucune activite recente"
                  }
                  description={dashboard.recentActivity.message ?? "Aucune activite a afficher."}
                />
              )}
            </div>
          </section>

          <section className="data-card dashboard-section-compact">
            <div className="section-header">
              <div>
                <h3>Utilisateurs recents</h3>
                <p className="meta">Les cinq derniers comptes ajoutes ou recemment utilises.</p>
              </div>
              <Link href="/administration/utilisateurs" className="button button-secondary button-small">
                Voir tous les utilisateurs
              </Link>
            </div>
            <div className="section-body">
              {dashboard.recentUsers.state === "ready" ? (
                <div className="admin-users-list">
                  {dashboard.recentUsers.items.map((user) => (
                    <article key={user.id} className="admin-user-row">
                      <div className="admin-user-identity">
                        <UserAvatar
                          firstName={user.firstName}
                          lastName={user.lastName}
                          displayName={user.displayName}
                          avatarUrl={user.avatarUrl}
                          size="sm"
                        />
                        <div className="admin-user-copy">
                          <strong>{user.displayName}</strong>
                          <p>
                            <span>{user.roleLabel}</span>
                            <span>{user.departmentLabel}</span>
                          </p>
                        </div>
                      </div>
                      <div className="admin-user-meta">
                        <StatusBadge label={user.statusLabel} tone={user.statusTone} />
                        <span>
                          {user.metaLabel} : {user.metaValue}
                        </span>
                      </div>
                      <Link href={user.href} className="admin-user-link">
                        Ouvrir
                      </Link>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  compact
                  title={
                    dashboard.recentUsers.state === "unavailable"
                      ? "Utilisateurs indisponibles"
                      : "Aucun utilisateur recent"
                  }
                  description={dashboard.recentUsers.message ?? "Aucun utilisateur a afficher."}
                />
              )}
            </div>
          </section>
        </div>

        <div className="admin-sidebar-stack">
          <section className="data-card dashboard-section-compact">
            <div className="section-header">
              <div>
                <h3>Etat de la plateforme</h3>
                <p className="meta">Verifications operationnelles, puis configurations attendues.</p>
              </div>
            </div>
            <div className="section-body">
              <div className="admin-health-groups">
                {(["Operation", "Configuration"] as const).map((kindLabel) => {
                  const items = dashboard.platformHealth.filter(
                    (item) => item.kindLabel === kindLabel
                  );

                  if (items.length === 0) {
                    return null;
                  }

                  return (
                    <div className="admin-health-group" key={kindLabel}>
                      <span className="admin-health-group-label">
                        {HEALTH_GROUP_LABELS[kindLabel]}
                      </span>
                      <div className="admin-health-list">
                        {items.map((item) => (
                          <article key={item.label} className="admin-health-row">
                            <div className="admin-health-copy">
                              <div className="admin-health-heading">
                                <strong>{item.label}</strong>
                                <span>{item.kindLabel}</span>
                              </div>
                              <p>{item.description}</p>
                            </div>
                            <StatusBadge
                              label={item.statusLabel}
                              tone={item.tone}
                            />
                          </article>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="data-card dashboard-section-compact">
            <div className="section-header">
              <div>
                <h3>Actions rapides</h3>
                <p className="meta">Commandes frequentes sans duplication des parcours de navigation.</p>
              </div>
            </div>
            <div className="section-body">
              <div className="admin-quick-actions-bar">
                {dashboard.quickActions.map((action) => (
                  <Link
                    key={action.href}
                    href={action.href}
                    className={action.tone === "primary" ? "button button-primary" : "button button-secondary"}
                  >
                    {action.label}
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
