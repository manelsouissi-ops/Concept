import { canAccess, type AppArea, type UserRole } from "../auth/rbac.ts";

export type NavigationIconKey =
  | "dashboard"
  | "folder"
  | "database"
  | "library"
  | "settings"
  | "user"
  | "message"
  | "shield";

export type NavigationItemDefinition = {
  label: string;
  href?: string;
  iconKey: NavigationIconKey;
  disabled?: boolean;
  /** When set, the item is hidden entirely for roles that fail canAccess(role, area). */
  area?: AppArea;
  /** Opens in a new tab via a plain anchor instead of Next.js client-side routing. */
  external?: boolean;
  /** Rendered as a native title/tooltip attribute. */
  description?: string;
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

// Shared "Outils IA" items, available to every authenticated role regardless
// of area-based RBAC (no `area` set), so they pass filterNavigationByRole unfiltered.
// `openWebUiUrl` comes from NEXT_PUBLIC_OPEN_WEBUI_URL, read server-side and
// threaded down as a prop - never hardcoded here. When unset, the item renders
// disabled instead of breaking the rest of the sidebar.
export function getAiToolsNavigation(openWebUiUrl: string | null): NavigationItemDefinition[] {
  return [
    {
      label: "Assistant IA",
      href: openWebUiUrl || undefined,
      disabled: !openWebUiUrl,
      iconKey: "message",
      external: true,
      description: "Assistant IA interne"
    },
    {
      label: "Pseudonymisation",
      href: "/outils/pseudonymisation",
      iconKey: "shield",
      description: "Préparer un texte avant de le partager avec un service d'IA externe"
    }
  ];
}

export function getAdminNavigationSections(
  openWebUiUrl: string | null = null
): NavigationSectionDefinition[] {
  return [
    {
      label: "Administration",
      items: [
        {
          label: "Vue d'ensemble",
          href: "/administration",
          iconKey: "dashboard"
        },
        {
          label: "Archive Cartography",
          href: "/administration/knowledge",
          iconKey: "database"
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
      label: "Outils IA",
      items: getAiToolsNavigation(openWebUiUrl)
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
