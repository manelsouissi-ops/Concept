import { canAccess, type AppArea, type UserRole } from "../auth/rbac.ts";

export type NavigationIconKey =
  | "dashboard"
  | "folder"
  | "database"
  | "library"
  | "settings"
  | "user";

export type NavigationItemDefinition = {
  label: string;
  href?: string;
  iconKey: NavigationIconKey;
  disabled?: boolean;
  /** When set, the item is hidden entirely for roles that fail canAccess(role, area). */
  area?: AppArea;
};

export type NavigationSectionDefinition = {
  label: string;
  items: NavigationItemDefinition[];
};

function parseNavigationHref(href: string) {
  const baseUrl = new URL(href, "https://concept.local");
  return {
    pathname: baseUrl.pathname,
    searchParams: baseUrl.searchParams
  };
}

export function isActiveNavigationPath(
  currentPath: string,
  href?: string,
  currentSearch = ""
) {
  if (!href) {
    return false;
  }

  const target = parseNavigationHref(href);

  if (!(currentPath === target.pathname || currentPath.startsWith(`${target.pathname}/`))) {
    return false;
  }

  if ([...target.searchParams.keys()].length === 0) {
    return true;
  }

  const search = currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch;
  const currentParams = new URLSearchParams(search);

  for (const [key, value] of target.searchParams.entries()) {
    if (currentParams.get(key) !== value) {
      return false;
    }
  }

  return true;
}

// Hides items a role has no RBAC access to, instead of rendering them disabled.
// Items with no `area` (pure placeholders) are unaffected and pass through as-is.
export function filterNavigationByRole(
  items: NavigationItemDefinition[],
  role: UserRole
): NavigationItemDefinition[] {
  return items.filter((item) => !item.area || canAccess(role, item.area));
}

export function getAdminNavigationSections(): NavigationSectionDefinition[] {
  return [
    {
      label: "Administration",
      items: [
        {
          label: "Vue d'ensemble",
          href: "/administration",
          iconKey: "dashboard"
        }
      ]
    },
    {
      label: "Gestion",
      items: [
        {
          label: "Utilisateurs",
          href: "/administration/utilisateurs",
          iconKey: "user"
        },
        {
          label: "Logiciels",
          href: "/administration/logiciels",
          iconKey: "library"
        }
      ]
    },
    {
      label: "Configuration",
      items: [
        {
          label: "Parametres",
          href: "/settings",
          iconKey: "settings"
        }
      ]
    },
    {
      label: "Compte",
      items: [
        {
          label: "Profil",
          href: "/profile",
          iconKey: "user"
        }
      ]
    }
  ];
}
