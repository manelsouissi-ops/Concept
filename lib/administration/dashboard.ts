import { access } from "node:fs/promises";
import { Pool, type QueryResultRow } from "pg";
import { getUserRoleLabel } from "../auth/rbac.ts";
import { getAuthSecret } from "../auth/config.ts";
import { ensureAuthenticationSchema } from "../auth/repository.ts";
import { listSoftware } from "./logiciels/repository.ts";
import { getN8nIntegrationConfig } from "../integrations/n8n-config.ts";
import { DATA_ROOT } from "../storage.ts";
import { listUsers } from "../users/repository.ts";

const SESSIONS_TABLE = "public.app_user_sessions";
const USERS_TABLE = "public.app_users";
const AUTH_AUDIT_TABLE = "public.app_auth_audit_events";

type GlobalWithAdministrationPool = typeof globalThis & {
  __administrationDashboardPool?: Pool;
};

type DashboardDataStatus = "ready" | "unavailable";
type ActivityState = "ready" | "empty" | "unavailable";

type SessionMetricsRow = {
  active: number;
  expired: number;
  revoked: number;
};

type SecurityMetricsRow = {
  login_success_today: number;
  login_failed_today: number;
  login_failed_today_excluding_demo: number;
  locked_accounts: number;
};

type RecentAuditRow = {
  id: number | string;
  event_type: string;
  email: string | null;
  created_at: string | Date;
  display_name: string | null;
};

type DefaultDashboardLoaders = {
  loadUsers: typeof listUsers;
  loadSoftware: typeof listSoftware;
  loadSessionMetrics: () => Promise<SessionMetricsRow>;
  loadSecurityMetrics: () => Promise<SecurityMetricsRow>;
  loadRecentActivity: () => Promise<RecentAuditRow[]>;
  checkDataRoot: () => Promise<boolean>;
  checkAuthConfigured: () => boolean;
  checkN8nConfigured: () => boolean;
  checkGeminiConfigured: () => boolean;
};

export type AdministrationMetricCard = {
  label: string;
  value: string;
  description: string;
  href?: string;
  actionLabel?: string;
  tone: "default" | "success" | "warning" | "danger";
  status: DashboardDataStatus;
  /** Small status dot rendered next to the card label. Omit when the metric has no health signal. */
  statusDotTone?: "success" | "warning" | "danger";
};

export type AdministrationActivityItem = {
  id: string;
  label: string;
  summary: string;
  createdAt: string;
  tone: "neutral" | "success" | "warning";
};

export type AdministrationHealthItem = {
  label: string;
  kindLabel: "Operation" | "Configuration";
  statusLabel: "Operationnel" | "Configure" | "Non configure" | "Attention" | "Indisponible";
  tone: "success" | "neutral" | "warning" | "danger";
  description: string;
};

export type AdministrationAlertItem = {
  id: string;
  label: string;
  description: string;
  href?: string;
  actionLabel?: string;
  tone: "warning" | "danger";
};

export type AdministrationQuickAction = {
  label: string;
  href: string;
  tone: "default" | "primary";
};

export type AdministrationRecentUserItem = {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string;
  avatarUrl: string | null;
  roleLabel: string;
  departmentLabel: string;
  statusLabel: string;
  statusTone: "success" | "neutral" | "warning";
  metaLabel: string;
  metaValue: string;
  href: string;
};

export type AdministrationDashboardData = {
  metrics: {
    users: AdministrationMetricCard;
    software: AdministrationMetricCard;
    sessions: AdministrationMetricCard;
    security: AdministrationMetricCard;
  };
  alerts: AdministrationAlertItem[];
  quickActions: AdministrationQuickAction[];
  recentActivity: {
    state: ActivityState;
    items: AdministrationActivityItem[];
    message?: string;
  };
  recentUsers: {
    state: ActivityState;
    items: AdministrationRecentUserItem[];
    message?: string;
  };
  platformHealth: AdministrationHealthItem[];
};

type PartialLoaders = Partial<DefaultDashboardLoaders>;

function readOptionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getDatabaseUrl() {
  return readOptionalEnv("DATABASE_URL");
}

export function getAdministrationDashboardPool() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  const globalWithPool = globalThis as GlobalWithAdministrationPool;
  if (!globalWithPool.__administrationDashboardPool) {
    globalWithPool.__administrationDashboardPool = new Pool({
      connectionString: databaseUrl
    });
  }

  return globalWithPool.__administrationDashboardPool;
}

async function queryOne<TRow extends QueryResultRow>(sql: string) {
  await ensureAuthenticationSchema();
  const pool = getAdministrationDashboardPool();
  const result = await pool.query<TRow>(sql);
  const row = result.rows[0];
  if (!row) {
    throw new Error("Dashboard query returned no rows.");
  }

  return row;
}

function toIsoTimestamp(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function buildUnavailableMetric(
  label: string,
  href: string,
  actionLabel: string,
  description: string
): AdministrationMetricCard {
  return {
    label,
    value: "--",
    description,
    href,
    actionLabel,
    tone: "warning",
    status: "unavailable"
  };
}

function formatLoginEventLabel(eventType: string) {
  switch (eventType) {
    case "auth.login.success":
      return { label: "Connexion reussie", tone: "success" as const };
    case "auth.login.invalid_credentials":
      return { label: "Echec de connexion", tone: "warning" as const };
    case "auth.login.account_denied":
      return { label: "Acces refuse", tone: "warning" as const };
    case "auth.logout":
      return { label: "Deconnexion", tone: "neutral" as const };
    case "auth.development_switch":
      return { label: "Changement d'utilisateur", tone: "neutral" as const };
    default:
      return { label: "Evenement d'authentification", tone: "neutral" as const };
  }
}

function formatUserStatus(status: string) {
  switch (status) {
    case "ACTIVE":
      return { label: "Actif", tone: "success" as const };
    case "LOCKED":
      return { label: "Verrouille", tone: "warning" as const };
    case "INVITED":
      return { label: "Invitation en attente", tone: "neutral" as const };
    default:
      return { label: "Inactif", tone: "neutral" as const };
  }
}

function buildRecentActivityItem(row: RecentAuditRow): AdministrationActivityItem {
  const event = formatLoginEventLabel(row.event_type);
  const actor = row.display_name?.trim() || row.email?.trim() || "Utilisateur inconnu";
  const target = row.email?.trim();
  let summary = actor;

  switch (row.event_type) {
    case "auth.login.success":
      summary = `${actor} a ouvert une session.`;
      break;
    case "auth.login.invalid_credentials":
      summary = `${target ?? actor} a saisi des identifiants invalides.`;
      break;
    case "auth.login.account_denied":
      summary = `${target ?? actor} a ete refuse par les controles d'acces.`;
      break;
    case "auth.logout":
      summary = `${actor} s'est deconnecte.`;
      break;
    case "auth.development_switch":
      summary = `${actor} a change d'utilisateur en mode developpement.`;
      break;
    default:
      summary = `${actor} a genere un evenement d'authentification.`;
      break;
  }

  return {
    id: `auth-${row.id}`,
    label: event.label,
    summary,
    createdAt: toIsoTimestamp(row.created_at),
    tone: event.tone
  };
}

function formatRelativeDateLabel(value: string | null, fallbackLabel: string) {
  if (!value) {
    return {
      label: fallbackLabel,
      value: "Jamais"
    };
  }

  return {
    label: fallbackLabel,
    value: new Date(value).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    })
  };
}

function buildRecentUsers(users: Awaited<ReturnType<typeof listUsers>>) {
  return [...users]
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt);
      const rightTime = Date.parse(right.createdAt);
      return rightTime - leftTime;
    })
    .slice(0, 5)
    .map<AdministrationRecentUserItem>((user) => {
      const status = formatUserStatus(user.status);
      const lastLogin = formatRelativeDateLabel(user.lastLoginAt, "Derniere connexion");
      const createdAt = formatRelativeDateLabel(user.createdAt, "Cree le");
      const meta = user.lastLoginAt ? lastLogin : createdAt;

      return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        roleLabel: getUserRoleLabel(user.role),
        departmentLabel: user.departmentName,
        statusLabel: status.label,
        statusTone: status.tone,
        metaLabel: meta.label,
        metaValue: meta.value,
        href: `/administration/utilisateurs/${user.id}`
      };
    });
}

function buildPlatformHealth(items: {
  databaseOperational: boolean;
  sessionsState: "ready" | "attention" | "unavailable";
  authConfigured: boolean;
  dataRootAccessible: boolean;
  n8nConfigured: boolean;
  geminiConfigured: boolean;
}) {
  return [
    // Operational checks first: real-time signals about whether the platform is working right now.
    {
      label: "PostgreSQL",
      kindLabel: "Operation",
      statusLabel: items.databaseOperational ? "Operationnel" : "Indisponible",
      tone: items.databaseOperational ? "success" : "danger",
      description: items.databaseOperational
        ? "Les lectures d'administration aboutissent."
        : "Les donnees d'administration n'ont pas pu etre lues."
    },
    {
      label: "Sessions",
      kindLabel: "Operation",
      statusLabel:
        items.sessionsState === "ready"
          ? "Operationnel"
          : items.sessionsState === "attention"
            ? "Attention"
            : "Indisponible",
      tone:
        items.sessionsState === "ready"
          ? "success"
          : items.sessionsState === "attention"
            ? "warning"
            : "danger",
      description:
        items.sessionsState === "ready"
          ? "Le registre des sessions est accessible."
          : items.sessionsState === "attention"
            ? "Des sessions revoquees demandent une verification."
            : "Le registre des sessions n'est pas disponible."
    },
    {
      label: "Stockage fichiers",
      kindLabel: "Operation",
      statusLabel: items.dataRootAccessible ? "Operationnel" : "Indisponible",
      tone: items.dataRootAccessible ? "success" : "danger",
      description: items.dataRootAccessible
        ? "Le dossier de donnees local est accessible."
        : "Le dossier de donnees local n'est pas accessible."
    },
    // Configuration checks: static setup state, not live incidents.
    {
      label: "Authentification",
      kindLabel: "Configuration",
      statusLabel: items.authConfigured ? "Configure" : "Non configure",
      tone: items.authConfigured ? "success" : "warning",
      description: items.authConfigured
        ? "Le secret d'authentification est present."
        : "Le secret d'authentification est absent."
    },
    {
      label: "Webhook n8n",
      kindLabel: "Configuration",
      statusLabel: items.n8nConfigured ? "Configure" : "Non configure",
      tone: items.n8nConfigured ? "success" : "warning",
      description: items.n8nConfigured
        ? "Le contrat de lancement est renseigne."
        : "La configuration de lancement n8n est incomplete."
    },
    {
      label: "Gemini",
      kindLabel: "Configuration",
      statusLabel: items.geminiConfigured ? "Configure" : "Non configure",
      tone: items.geminiConfigured ? "success" : "warning",
      description: items.geminiConfigured
        ? "La cle d'integration IA est presente."
        : "La cle d'integration IA est absente du runtime web."
    }
  ] satisfies AdministrationHealthItem[];
}

function buildSessionsDescription(expired: number, revoked: number) {
  if (expired === 0 && revoked === 0) {
    return "Aucune session inactive";
  }

  if (revoked === 0) {
    return `${expired} session(s) expiree(s) (normal)`;
  }

  if (expired === 0) {
    return `${revoked} session(s) revoquee(s) a verifier`;
  }

  return `${expired} expiree(s), ${revoked} revoquee(s) a verifier`;
}

function buildSecurityDescription(failedToday: number, failedExcludingDemo: number) {
  if (failedToday === 0) {
    return "Aucun echec de connexion aujourd'hui";
  }

  const demoAttributedCount = Math.max(failedToday - failedExcludingDemo, 0);

  if (demoAttributedCount === 0) {
    return `${failedToday} echec(s) de connexion aujourd'hui`;
  }

  if (demoAttributedCount === failedToday) {
    return `${failedToday} echec(s) de connexion aujourd'hui (comptes de demonstration)`;
  }

  return `${failedToday} echec(s) de connexion aujourd'hui (dont ${demoAttributedCount} sur des comptes de demonstration)`;
}

function getDefaultLoaders(): DefaultDashboardLoaders {
  return {
    loadUsers: (filters) => listUsers(filters),
    loadSoftware: (filters) => listSoftware(filters),
    loadSessionMetrics: () =>
      queryOne<SessionMetricsRow>(
        `
          select
            count(*) filter (
              where invalidated_at is null
                and expires_at > now()
            )::int as active,
            count(*) filter (
              where invalidated_at is null
                and expires_at <= now()
            )::int as expired,
            count(*) filter (
              where invalidated_at is not null
            )::int as revoked
          from ${SESSIONS_TABLE}
        `
      ),
    loadSecurityMetrics: () =>
      queryOne<SecurityMetricsRow>(
        `
          select
            count(*) filter (
              where event_type = 'auth.login.success'
                and created_at >= date_trunc('day', now())
            )::int as login_success_today,
            count(*) filter (
              where event_type like 'auth.login.%'
                and event_type <> 'auth.login.success'
                and created_at >= date_trunc('day', now())
            )::int as login_failed_today,
            count(*) filter (
              where event_type like 'auth.login.%'
                and event_type <> 'auth.login.success'
                and created_at >= date_trunc('day', now())
                and (email is null or email not ilike '%@concept.local')
            )::int as login_failed_today_excluding_demo,
            (
              select count(*)::int
              from ${USERS_TABLE}
              where status = 'LOCKED'
                 or (locked_until is not null and locked_until > now())
            ) as locked_accounts
          from ${AUTH_AUDIT_TABLE}
        `
      ),
    loadRecentActivity: async () => {
      await ensureAuthenticationSchema();
      const pool = getAdministrationDashboardPool();
      const result = await pool.query<RecentAuditRow>(
        `
          select
            e.id,
            e.event_type,
            e.email,
            e.created_at,
            u.display_name
          from ${AUTH_AUDIT_TABLE} e
          left join ${USERS_TABLE} u on u.id = e.user_id
          order by e.created_at desc
          limit 6
        `
      );

      return result.rows;
    },
    checkDataRoot: async () => {
      await access(DATA_ROOT);
      return true;
    },
    checkAuthConfigured: () => Boolean(readOptionalEnv("AUTH_SECRET")),
    checkN8nConfigured: () => {
      try {
        getN8nIntegrationConfig();
        return true;
      } catch {
        return false;
      }
    },
    checkGeminiConfigured: () => Boolean(readOptionalEnv("GEMINI_API_KEY"))
  };
}

export async function getAdministrationDashboardData(loadersOverride: PartialLoaders = {}) {
  const loaders = {
    ...getDefaultLoaders(),
    ...loadersOverride
  } satisfies DefaultDashboardLoaders;

  const [
    usersResult,
    softwareResult,
    sessionsResult,
    securityResult,
    activityResult,
    dataRootResult
  ] = await Promise.allSettled([
    loaders.loadUsers({ status: "all" }),
    loaders.loadSoftware({ status: "all" }),
    loaders.loadSessionMetrics(),
    loaders.loadSecurityMetrics(),
    loaders.loadRecentActivity(),
    loaders.checkDataRoot()
  ]);

  const usersActiveCount =
    usersResult.status === "fulfilled"
      ? usersResult.value.filter((user) => user.status === "ACTIVE").length
      : 0;
  const usersInactiveCount =
    usersResult.status === "fulfilled" ? usersResult.value.length - usersActiveCount : 0;

  const usersCard: AdministrationMetricCard =
    usersResult.status === "fulfilled"
      ? {
          label: "Utilisateurs",
          value: String(usersResult.value.length),
          description: `${usersActiveCount} actifs / ${usersInactiveCount} a surveiller`,
          href: "/administration/utilisateurs",
          actionLabel: "Voir les utilisateurs",
          tone: "default",
          status: "ready",
          statusDotTone: usersInactiveCount > 0 ? "warning" : "success"
        }
      : buildUnavailableMetric(
          "Utilisateurs",
          "/administration/utilisateurs",
          "Gerer les utilisateurs",
          "Les comptes ne sont pas disponibles actuellement."
        );

  const softwareCard: AdministrationMetricCard =
    softwareResult.status === "fulfilled"
      ? {
          label: "Logiciels",
          value: String(softwareResult.value.length),
          description: `${softwareResult.value.filter((item) => item.status === "active").length} actifs / ${softwareResult.value.filter((item) => item.status !== "active").length} archives`,
          href: "/administration/logiciels",
          actionLabel: "Voir les logiciels",
          tone: "success",
          status: "ready",
          statusDotTone: "success"
        }
      : buildUnavailableMetric(
          "Logiciels",
          "/administration/logiciels",
          "Gerer les logiciels",
          "Le catalogue n'est pas disponible actuellement."
        );

  // Active count stays the headline: it is a neutral, informational number.
  // Expired sessions are routine and never drive the tone; only revoked sessions do.
  const sessionsCard: AdministrationMetricCard =
    sessionsResult.status === "fulfilled"
      ? {
          label: "Sessions",
          value: String(sessionsResult.value.active),
          description: buildSessionsDescription(sessionsResult.value.expired, sessionsResult.value.revoked),
          tone: sessionsResult.value.revoked > 0 ? "warning" : "default",
          status: "ready",
          statusDotTone: sessionsResult.value.revoked > 0 ? "warning" : "success"
        }
      : buildUnavailableMetric(
          "Sessions",
          "/administration",
          "Controle indisponible",
          "Le registre des sessions n'est pas disponible actuellement."
        );

  // Headline is a posture signal (locked accounts), not the failed-login count, so a busy
  // but healthy day does not read as an incident. Failed attempts move to the sub-stat line.
  const securityCard: AdministrationMetricCard =
    securityResult.status === "fulfilled"
      ? {
          label: "Comptes verrouilles",
          value: String(securityResult.value.locked_accounts),
          description: buildSecurityDescription(
            securityResult.value.login_failed_today,
            securityResult.value.login_failed_today_excluding_demo
          ),
          tone: securityResult.value.locked_accounts > 0 ? "danger" : "success",
          status: "ready",
          statusDotTone: securityResult.value.locked_accounts > 0 ? "danger" : "success"
        }
      : buildUnavailableMetric(
          "Comptes verrouilles",
          "/administration",
          "Controle indisponible",
          "Les donnees de securite ne sont pas disponibles actuellement."
        );

  const authConfigured = loaders.checkAuthConfigured();
  const n8nConfigured = loaders.checkN8nConfigured();
  const geminiConfigured = loaders.checkGeminiConfigured();
  const usersAvailable = usersResult.status === "fulfilled";
  const sessionsRevokedCount =
    sessionsResult.status === "fulfilled" ? sessionsResult.value.revoked : 0;
  const alerts: AdministrationAlertItem[] = [];

  if (usersResult.status === "rejected" && softwareResult.status === "rejected") {
    alerts.push({
      id: "database-unavailable",
      label: "Lecture PostgreSQL indisponible",
      description: "Le dashboard ne peut pas lire les donnees d'administration.",
      tone: "danger"
    });
  }

  // Routine counts (failed logins, expired sessions) live only in the KPI cards above.
  // The banner is reserved for genuinely actionable states: a locked account, a revoked
  // session, or missing configuration.

  if (securityResult.status === "fulfilled" && securityResult.value.locked_accounts > 0) {
    alerts.push({
      id: "locked-users",
      label: `${securityResult.value.locked_accounts} compte(s) verrouille(s)`,
      description: "Des utilisateurs ne peuvent plus ouvrir de session.",
      href: "/administration/utilisateurs",
      actionLabel: "Verifier les comptes",
      tone: "danger"
    });
  }

  if (usersAvailable && usersInactiveCount > 0) {
    alerts.push({
      id: "inactive-users",
      label: `${usersInactiveCount} utilisateur(s) inactif(s) ou en attente`,
      description: "Revoyez les statuts avant de relancer les parcours metier.",
      href: "/administration/utilisateurs",
      actionLabel: "Voir les utilisateurs",
      tone: "warning"
    });
  }

  if (sessionsResult.status === "fulfilled" && sessionsRevokedCount > 0) {
    alerts.push({
      id: "revoked-sessions",
      label: `${sessionsRevokedCount} session(s) revoquee(s)`,
      description: "Une session a ete invalidee avant son expiration normale ; verifiez l'origine de la revocation.",
      tone: "warning"
    });
  }

  if (!authConfigured) {
    alerts.push({
      id: "auth-missing",
      label: "Configuration d'authentification incomplete",
      description: "Le secret d'authentification n'est pas charge dans le runtime web.",
      tone: "danger"
    });
  }

  if (dataRootResult.status === "rejected" || !dataRootResult.value) {
    alerts.push({
      id: "storage-unavailable",
      label: "Stockage local indisponible",
      description: "Le dossier de donnees n'est pas accessible depuis l'application.",
      tone: "danger"
    });
  }

  if (!n8nConfigured) {
    alerts.push({
      id: "n8n-missing",
      label: "Configuration n8n incomplete",
      description: "Le contrat de lancement n8n n'est pas charge correctement.",
      tone: "warning"
    });
  }

  if (!geminiConfigured) {
    alerts.push({
      id: "gemini-missing",
      label: "Configuration Gemini absente",
      description: "La cle d'integration IA n'est pas disponible dans le runtime web.",
      tone: "warning"
    });
  }

  const quickActions = [
    {
      label: "Nouvel utilisateur",
      href: "/administration/utilisateurs/nouveau",
      tone: "primary"
    },
    {
      label: "Nouveau logiciel",
      href: "/administration/logiciels/nouveau",
      tone: "primary"
    },
    {
      label: "Utilisateurs",
      href: "/administration/utilisateurs",
      tone: "default"
    },
    {
      label: "Logiciels",
      href: "/administration/logiciels",
      tone: "default"
    },
    {
      label: "Parametres",
      href: "/settings",
      tone: "default"
    }
  ] satisfies AdministrationQuickAction[];

  const recentActivity: AdministrationDashboardData["recentActivity"] =
    activityResult.status === "rejected"
      ? {
          state: "unavailable",
          items: [],
          message: "Les donnees de securite ne sont pas disponibles actuellement."
        }
      : activityResult.value.length === 0
        ? {
            state: "empty",
            items: [],
            message: "Aucune activite administrative recente n'a ete enregistree."
          }
        : {
            state: "ready",
            items: activityResult.value.map(buildRecentActivityItem)
          };

  const recentUsers: AdministrationDashboardData["recentUsers"] =
    usersResult.status === "rejected"
      ? {
          state: "unavailable",
          items: [],
          message: "Les comptes ne sont pas disponibles actuellement."
        }
      : usersResult.value.length === 0
        ? {
            state: "empty",
            items: [],
            message: "Aucun utilisateur n'est encore disponible."
          }
        : {
            state: "ready",
            items: buildRecentUsers(usersResult.value)
          };

  const platformHealth = buildPlatformHealth({
    databaseOperational: usersResult.status === "fulfilled" || softwareResult.status === "fulfilled",
    sessionsState:
      sessionsResult.status === "rejected"
        ? "unavailable"
        : sessionsRevokedCount > 0
          ? "attention"
          : "ready",
    authConfigured,
    dataRootAccessible: dataRootResult.status === "fulfilled" && dataRootResult.value,
    n8nConfigured,
    geminiConfigured
  });

  try {
    getAuthSecret();
  } catch {
    // The health card already exposes the missing configuration without failing the page.
  }

  return {
    metrics: {
      users: usersCard,
      software: softwareCard,
      sessions: sessionsCard,
      security: securityCard
    },
    alerts,
    quickActions,
    recentActivity,
    recentUsers,
    platformHealth
  } satisfies AdministrationDashboardData;
}

export async function closeAdministrationDashboardPool() {
  const globalWithPool = globalThis as GlobalWithAdministrationPool;
  if (globalWithPool.__administrationDashboardPool) {
    await globalWithPool.__administrationDashboardPool.end();
    globalWithPool.__administrationDashboardPool = undefined;
  }
}
