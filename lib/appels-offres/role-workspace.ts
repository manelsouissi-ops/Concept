import type { NavigationItemDefinition } from "../administration/navigation.ts";
import type { UserRole } from "../auth/rbac.ts";

export type DashboardWorkspaceVariant =
  | "business_overview"
  | "commercial_coordination"
  | "decision"
  | "department_minimal";

export type RoleWorkspaceAction = {
  href: string;
  label: string;
} | null;

export type RoleWorkspaceExperience = {
  dashboardVariant: DashboardWorkspaceVariant;
  primaryNavigation: NavigationItemDefinition[];
  dashboardAction: RoleWorkspaceAction;
};

const DEFAULT_BUSINESS_NAVIGATION: NavigationItemDefinition[] = [
  {
    label: "Tableau de bord",
    href: "/dashboard",
    iconKey: "dashboard",
    area: "dashboard"
  },
  {
    label: "Appels d'offres",
    href: "/appels-offres",
    iconKey: "folder",
    area: "appels_offres"
  }
];

// Shared department navigation base for Finance/Operations. DG now gets its own
// dedicated decision workspace below.
const DEPARTMENT_NAVIGATION: NavigationItemDefinition[] = [
  {
    label: "Accueil",
    href: "/dashboard",
    iconKey: "dashboard",
    area: "dashboard"
  },
  {
    label: "Mes dossiers",
    href: "/dashboard?section=dossiers#finance-dossiers",
    iconKey: "folder",
    area: "dashboard"
  },
  {
    label: "Mes modules FCI",
    href: "/dashboard?section=modules#finance-modules",
    iconKey: "database",
    area: "dashboard"
  },
  {
    label: "Historique",
    href: "/dashboard?section=history#finance-history",
    iconKey: "library",
    area: "dashboard"
  },
  {
    label: "Profil",
    href: "/profile",
    iconKey: "user",
    area: "profile"
  }
];

// FINANCE/OPERATIONS have one job (complete + validate their own FCI module), so
// their home page IS the module task list - "Mes dossiers" would just duplicate it.
const DEPARTMENT_MINIMAL_NAVIGATION: NavigationItemDefinition[] = DEPARTMENT_NAVIGATION.filter(
  (item) => item.label !== "Mes dossiers"
);

const DECISION_NAVIGATION: NavigationItemDefinition[] = [
  {
    label: "Accueil",
    href: "/dashboard",
    iconKey: "dashboard",
    area: "dashboard"
  },
  {
    label: "Décisions Go/No-Go",
    href: "/dashboard?section=queue#decision-queue",
    iconKey: "folder",
    area: "dashboard"
  },
  {
    label: "Historique",
    href: "/dashboard?section=history#decision-history",
    iconKey: "library",
    area: "dashboard"
  },
  {
    label: "Profil",
    href: "/profile",
    iconKey: "user",
    area: "profile"
  }
];

const COMMERCIAL_COORDINATION_NAVIGATION: NavigationItemDefinition[] = [
  {
    label: "Accueil",
    href: "/dashboard",
    iconKey: "dashboard",
    area: "dashboard"
  },
  {
    label: "Mes dossiers",
    href: "/appels-offres",
    iconKey: "folder",
    area: "appels_offres"
  },
  {
    label: "FCIs a suivre",
    href: "/dashboard?section=tracking#commercial-tracking",
    iconKey: "database",
    area: "dashboard"
  },
  {
    label: "Prets pour Go/No-Go",
    href: "/dashboard?section=ready#commercial-ready",
    iconKey: "library",
    area: "dashboard"
  },
  {
    label: "En attente DG",
    href: "/dashboard?section=dg#commercial-awaiting-dg",
    iconKey: "folder",
    area: "dashboard"
  },
  {
    label: "Historique",
    href: "/dashboard?section=history#commercial-history",
    iconKey: "library",
    area: "dashboard"
  },
  {
    label: "Profil",
    href: "/profile",
    iconKey: "user",
    area: "profile"
  }
];

const MINIMAL_DEPARTMENT_ROLES: UserRole[] = ["FINANCE", "OPERATIONS"];

export function getRoleWorkspaceExperience(role: UserRole): RoleWorkspaceExperience {
  if (MINIMAL_DEPARTMENT_ROLES.includes(role)) {
    return {
      dashboardVariant: "department_minimal",
      primaryNavigation: DEPARTMENT_MINIMAL_NAVIGATION,
      dashboardAction: null
    };
  }

  if (role === "DIRECTION_GENERALE") {
    return {
      dashboardVariant: "decision",
      primaryNavigation: DECISION_NAVIGATION,
      dashboardAction: null
    };
  }

  if (role === "COMMERCIAL") {
    return {
      dashboardVariant: "commercial_coordination",
      primaryNavigation: COMMERCIAL_COORDINATION_NAVIGATION,
      dashboardAction: null
    };
  }

  return {
    dashboardVariant: "business_overview",
    primaryNavigation: DEFAULT_BUSINESS_NAVIGATION,
    dashboardAction: {
      href: "/appels-offres/nouveau",
      label: "Nouvel appel d'offres"
    }
  };
}
