import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { UserRecord } from "../users/types.ts";
import {
  closeAdministrationDashboardPool,
  getAdministrationDashboardData
} from "./dashboard.ts";

function buildUser(overrides: Partial<UserRecord> = {}) {
  return {
    id: 1,
    firstName: "Bob",
    lastName: "Durand",
    displayName: "Bob Durand",
    email: "bob@concept.local",
    normalizedEmail: "bob@concept.local",
    jobTitle: "Admin",
    departmentCode: "ADMINISTRATION",
    departmentName: "Administration",
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris",
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
    lastLoginAt: null,
    ...overrides
  } satisfies UserRecord;
}

test("admin dashboard aggregates real user, software, session, and security totals", async () => {
  const dashboard = await getAdministrationDashboardData({
    loadUsers: async () => [
      buildUser(),
      buildUser({
        id: 2,
        firstName: "Claire",
        lastName: "Martin",
        displayName: "Claire Martin",
        email: "claire@concept.local",
        normalizedEmail: "claire@concept.local",
        jobTitle: "Commerciale",
        departmentCode: "COMMERCIAL",
        departmentName: "Commercial",
        role: "COMMERCIAL",
        status: "INACTIVE"
      })
    ],
    loadSoftware: async () => [
      {
        id: 10,
        name: "Autocad",
        normalizedName: "autocad",
        descriptionRaw: "",
        status: "active",
        createdAt: "2026-08-01T08:00:00.000Z",
        updatedAt: "2026-08-01T08:00:00.000Z",
        aliases: []
      },
      {
        id: 11,
        name: "QGIS",
        normalizedName: "qgis",
        descriptionRaw: "",
        status: "archived",
        createdAt: "2026-08-01T08:00:00.000Z",
        updatedAt: "2026-08-01T08:00:00.000Z",
        aliases: []
      }
    ],
    loadSessionMetrics: async () => ({
      active: 3,
      expired: 7,
      revoked: 0
    }),
    loadSecurityMetrics: async () => ({
      login_success_today: 8,
      login_failed_today: 2,
      login_failed_today_excluding_demo: 2,
      locked_accounts: 1
    }),
    loadRecentActivity: async () => [
      {
        id: 1,
        event_type: "auth.login.success",
        email: "bob@concept.local",
        created_at: "2026-08-02T09:15:00.000Z",
        display_name: "Bob Durand"
      }
    ],
    checkDataRoot: async () => true
  });

  assert.equal(dashboard.metrics.users.value, "2");
  assert.match(dashboard.metrics.users.description, /1 actifs \/ 1 a surveiller/i);
  assert.equal(dashboard.metrics.software.value, "2");
  assert.match(dashboard.metrics.software.description, /1 actifs \/ 1 archives/i);
  assert.equal(dashboard.metrics.sessions.value, "3");
  assert.match(dashboard.metrics.sessions.description, /7 session\(s\) expiree\(s\) \(normal\)/i);
  assert.equal(dashboard.metrics.security.value, "1");
  assert.match(dashboard.metrics.security.description, /2 echec\(s\) de connexion aujourd'hui/i);
  assert.equal(dashboard.recentActivity.state, "ready");
  assert.equal(dashboard.recentActivity.items[0]?.label, "Connexion reussie");
  assert.match(dashboard.recentActivity.items[0]?.summary ?? "", /a ouvert une session/i);
  assert.equal(dashboard.recentUsers.state, "ready");
  assert.equal(dashboard.recentUsers.items[0]?.displayName, "Bob Durand");
  assert.equal(dashboard.platformHealth.find((item) => item.label === "Authentification")?.kindLabel, "Configuration");
  assert.equal(dashboard.platformHealth.find((item) => item.label === "PostgreSQL")?.kindLabel, "Operation");
});

test("recent activity exposes a clean empty state when no administrative events exist", async () => {
  const dashboard = await getAdministrationDashboardData({
    loadUsers: async () => [],
    loadSoftware: async () => [],
    loadSessionMetrics: async () => ({ active: 0, expired: 0, revoked: 0 }),
    loadSecurityMetrics: async () => ({
      login_success_today: 0,
      login_failed_today: 0,
      login_failed_today_excluding_demo: 0,
      locked_accounts: 0
    }),
    loadRecentActivity: async () => [],
    checkDataRoot: async () => true,
    checkAuthConfigured: () => true,
    checkN8nConfigured: () => true,
    checkGeminiConfigured: () => true
  });

  assert.equal(dashboard.recentActivity.state, "empty");
  assert.match(dashboard.recentActivity.message ?? "", /Aucune activite administrative recente/i);
  assert.equal(dashboard.recentUsers.state, "empty");
});

test("optional metric failures do not crash the dashboard and expose a calm fallback", async () => {
  const dashboard = await getAdministrationDashboardData({
    loadUsers: async () => [
      buildUser()
    ],
    loadSoftware: async () => [],
    loadSessionMetrics: async () => {
      throw new Error("session store unavailable");
    },
    loadSecurityMetrics: async () => {
      throw new Error("audit store unavailable");
    },
    loadRecentActivity: async () => {
      throw new Error("audit stream unavailable");
    },
    checkDataRoot: async () => false,
    checkAuthConfigured: () => false,
    checkN8nConfigured: () => false,
    checkGeminiConfigured: () => false
  });

  assert.equal(dashboard.metrics.users.status, "ready");
  assert.equal(dashboard.metrics.sessions.status, "unavailable");
  assert.equal(dashboard.metrics.security.status, "unavailable");
  assert.equal(dashboard.recentActivity.state, "unavailable");
  assert.match(dashboard.recentActivity.message ?? "", /donnees de securite/i);
  assert.ok(dashboard.alerts.some((item) => item.id === "storage-unavailable"));
  assert.ok(dashboard.alerts.some((item) => item.id === "auth-missing"));
  assert.ok(dashboard.alerts.some((item) => item.id === "n8n-missing"));
  assert.ok(dashboard.alerts.some((item) => item.id === "gemini-missing"));
  assert.equal(
    dashboard.platformHealth.find((item) => item.label === "Sessions")?.statusLabel,
    "Indisponible"
  );
});

test("admin dashboard surfaces real alerts without resurrecting old admin shortcut cards", async () => {
  const dashboard = await getAdministrationDashboardData({
    loadUsers: async () => [
      buildUser(),
      buildUser({
        id: 2,
        firstName: "Claire",
        lastName: "Martin",
        displayName: "Claire Martin",
        email: "claire@concept.local",
        normalizedEmail: "claire@concept.local",
        jobTitle: "Commerciale",
        departmentCode: "COMMERCIAL",
        departmentName: "Commercial",
        role: "COMMERCIAL",
        status: "LOCKED"
      })
    ],
    loadSoftware: async () => [],
    loadSessionMetrics: async () => ({ active: 1, expired: 1, revoked: 1 }),
    loadSecurityMetrics: async () => ({
      login_success_today: 4,
      login_failed_today: 3,
      login_failed_today_excluding_demo: 3,
      locked_accounts: 1
    }),
    loadRecentActivity: async () => [],
    checkDataRoot: async () => true,
    checkAuthConfigured: () => true,
    checkN8nConfigured: () => true,
    checkGeminiConfigured: () => true
  });

  // Routine failed-login counts must not duplicate the security KPI card in the banner.
  assert.equal(dashboard.alerts.some((item) => item.id === "failed-logins"), false);
  assert.ok(dashboard.alerts.some((item) => item.id === "locked-users"));
  assert.ok(dashboard.alerts.some((item) => item.id === "inactive-users"));
  assert.ok(dashboard.alerts.some((item) => item.id === "revoked-sessions"));
  assert.deepEqual(
    dashboard.quickActions.map((item) => item.label),
    ["Nouvel utilisateur", "Nouveau logiciel", "Utilisateurs", "Logiciels", "Parametres"]
  );
});

test("admin dashboard source keeps the new compact hierarchy and removes old redundant sections", () => {
  const source = readFileSync(
    path.join(process.cwd(), "app/administration/page.tsx"),
    "utf8"
  );

  assert.equal(source.includes("Portee ADMIN"), false);
  assert.equal(source.includes("Raccourcis d'administration"), false);
  assert.equal(source.includes("Acteur :"), false);
  assert.equal(source.includes("Cible :"), false);
  assert.equal(source.includes("A surveiller"), true);
  assert.equal(source.includes("Actions rapides"), true);
  assert.equal(source.includes("Activite recente"), true);
  assert.equal(source.includes("Etat de la plateforme"), true);
  assert.equal(source.includes("Utilisateurs recents"), true);
});

after(async () => {
  await closeAdministrationDashboardPool();
});
