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
    label: "Mes FCI",
    href: "/dashboard?section=modules#finance-modules",
    iconKey: "folder",
    area: "dashboard"
  },
  {
    label: "Appels d'offres",
    href: "/appels-offres",
    iconKey: "folder",
    area: "appels_offres"
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
const DEPARTMENT_MINIMAL_NAVIGATION: NavigationItemDefinition[] = DEPARTMENT_NAVIGATION;

const DECISION_NAVIGATION: NavigationItemDefinition[] = [
  {
    label: "Accueil",
    href: "/dashboard",
    iconKey: "dashboard",
    area: "dashboard"
  },
  {
    label: "Mes FCI",
    href: "/mes-fci",
    iconKey: "database",
    area: "dashboard"
  },
  {
    label: "Appels d'offres",
    href: "/appels-offres",
    iconKey: "folder",
    area: "appels_offres"
  },
  {
    label: "Décisions Go/No-Go",
    href: "/decisions",
    iconKey: "folder",
    area: "dashboard"
  },
  {
    label: "Historique",
    href: "/history",
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
    label: "Appels d'offres",
    href: "/appels-offres",
    iconKey: "folder",
    area: "appels_offres"
  },
  {
    label: "Mes Fiches CDC",
    href: "/fiches-cdc",
    iconKey: "library",
    area: "appels_offres"
  },
  {
    label: "Mes FCI",
    href: "/mes-fci",
    iconKey: "database",
    area: "dashboard"
  },
  {
    label: "Go/No-Go",
    href: "/go-no-go",
    iconKey: "library",
    area: "dashboard"
  },
  {
    label: "Historique",
    href: "/history",
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
