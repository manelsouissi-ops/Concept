"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ReactNode } from "react";
import {
  BellIcon,
  DashboardIcon,
  DatabaseIcon,
  FolderIcon,
  LibraryIcon,
  SettingsIcon,
  UserCircleIcon
} from "./app-icons.tsx";
import { BrandLogo } from "./brand-logo.tsx";
import { UserAvatar } from "./user-avatar.tsx";
import { canAccess, type UserPresentation } from "@/lib/auth/rbac.ts";
import { switchDevelopmentUser, UsersClientError } from "@/lib/users/client.ts";
import type { DevelopmentUserState } from "@/lib/users/types.ts";
import { getUserRoleLabel } from "@/lib/auth/rbac.ts";

type NavigationItem = {
  label: string;
  href?: string;
  icon: ReactNode;
  disabled?: boolean;
};

const primaryNavigation: NavigationItem[] = [
  { label: "Tableau de bord", href: "/dashboard", icon: <DashboardIcon className="nav-icon" /> },
  { label: "Appels d'offres", href: "/appels-offres", icon: <FolderIcon className="nav-icon" /> }
];

const upcomingNavigation: NavigationItem[] = [
  {
    label: "Base de connaissances",
    icon: <DatabaseIcon className="nav-icon" />,
    disabled: true
  }
];

const administrationNavigation: NavigationItem[] = [
  { label: "Referentiels", icon: <LibraryIcon className="nav-icon" />, disabled: true },
  { label: "Employes", icon: <LibraryIcon className="nav-icon" />, disabled: true },
  { label: "Competences", icon: <LibraryIcon className="nav-icon" />, disabled: true },
  {
    label: "Utilisateurs",
    href: "/administration/utilisateurs",
    icon: <UserCircleIcon className="nav-icon" />
  },
  {
    label: "Logiciels",
    href: "/administration/logiciels",
    icon: <LibraryIcon className="nav-icon" />
  }
];

function getRouteMeta(pathname: string) {
  if (pathname === "/dashboard") {
    return {
      title: "Tableau de bord",
      breadcrumbs: ["Tableau de bord"],
      actionHref: "/appels-offres/nouveau",
      actionLabel: "Nouvel appel d'offres"
    };
  }

  if (pathname === "/appels-offres") {
    return {
      title: "Appels d'offres",
      breadcrumbs: ["Appels d'offres"],
      actionHref: "/appels-offres/nouveau",
      actionLabel: "Nouvel appel d'offres"
    };
  }

  if (pathname === "/appels-offres/nouveau") {
    return {
      title: "Nouvel appel d'offres",
      breadcrumbs: ["Appels d'offres", "Creation"]
    };
  }

  if (pathname === "/profile") {
    return {
      title: "Mon profil",
      breadcrumbs: ["Mon profil"]
    };
  }

  if (pathname === "/settings") {
    return {
      title: "Parametres",
      breadcrumbs: ["Parametres"]
    };
  }

  if (pathname.startsWith("/settings/")) {
    const leaf = pathname.split("/").filter(Boolean)[1] ?? "section";
    return {
      title: `Parametres ${leaf}`,
      breadcrumbs: ["Parametres", leaf]
    };
  }

  if (pathname === "/administration/utilisateurs") {
    return {
      title: "Utilisateurs",
      breadcrumbs: ["Administration", "Utilisateurs"]
    };
  }

  if (pathname === "/administration/utilisateurs/nouveau") {
    return {
      title: "Creer un utilisateur",
      breadcrumbs: ["Administration", "Utilisateurs", "Nouveau"]
    };
  }

  if (pathname.startsWith("/administration/utilisateurs/")) {
    const segments = pathname.split("/").filter(Boolean);
    const userId = decodeURIComponent(segments[2] ?? "");
    const lastSegment = segments[3] ?? "";

    return {
      title: lastSegment === "modifier" ? `Modifier l'utilisateur ${userId}` : `Utilisateur ${userId}`,
      breadcrumbs:
        lastSegment === "modifier"
          ? ["Administration", "Utilisateurs", userId, "Modification"]
          : ["Administration", "Utilisateurs", userId]
    };
  }

  if (pathname === "/administration/logiciels") {
    return {
      title: "Logiciels",
      breadcrumbs: ["Administration", "Logiciels"]
    };
  }

  if (pathname === "/administration/logiciels/nouveau") {
    return {
      title: "Ajouter un logiciel",
      breadcrumbs: ["Administration", "Logiciels", "Nouveau"]
    };
  }

  if (pathname === "/administration/logiciels/importer") {
    return {
      title: "Importer le catalogue",
      breadcrumbs: ["Administration", "Logiciels", "Import"]
    };
  }

  if (pathname.startsWith("/administration/logiciels/")) {
    const segments = pathname.split("/").filter(Boolean);
    const logicielId = decodeURIComponent(segments[2] ?? "");
    const lastSegment = segments[3] ?? "";

    return {
      title: lastSegment === "modifier" ? `Modifier le logiciel ${logicielId}` : `Logiciel ${logicielId}`,
      breadcrumbs:
        lastSegment === "modifier"
          ? ["Administration", "Logiciels", logicielId, "Modification"]
          : ["Administration", "Logiciels", logicielId]
    };
  }

  if (pathname.startsWith("/appels-offres/") && pathname.includes("/analyse/logiciels")) {
    const segments = pathname.split("/").filter(Boolean);
    const code = decodeURIComponent(segments[1] ?? "");
    return {
      title: "Analyse des logiciels",
      breadcrumbs: ["Appels d'offres", code, "Analyse", "Logiciels"]
    };
  }

  if (pathname.startsWith("/appels-offres/")) {
    const code = decodeURIComponent(pathname.split("/")[2] ?? "");
    return {
      title: `Appel d'offres ${code}`,
      breadcrumbs: ["Appels d'offres", code]
    };
  }

  if (pathname.startsWith("/fiche/")) {
    const code = decodeURIComponent(pathname.split("/")[2] ?? "");
    return {
      title: `Fiche CDC ${code}`,
      breadcrumbs: ["Fiche CDC", code]
    };
  }

  if (pathname === "/initiation") {
    return {
      title: "Initiation CDC",
      breadcrumbs: ["Legacy", "Initiation CDC"]
    };
  }

  return {
    title: "CONCEPT",
    breadcrumbs: ["CONCEPT"]
  };
}

function SidebarItem({
  item,
  currentPath,
  onNavigate
}: {
  item: NavigationItem;
  currentPath: string;
  onNavigate?: () => void;
}) {
  const isActive = item.href
    ? currentPath === item.href || currentPath.startsWith(`${item.href}/`)
    : false;

  if (!item.href || item.disabled) {
    return (
      <span className="sidebar-link disabled" aria-disabled="true">
        {item.icon}
        <span className="sidebar-link-text">
          {item.label}
          <small>Bientot</small>
        </span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      className={isActive ? "sidebar-link active" : "sidebar-link"}
      onClick={onNavigate}
    >
      {item.icon}
      <span className="sidebar-link-text">{item.label}</span>
    </Link>
  );
}

function SidebarDisclosure({
  label,
  icon,
  items,
  currentPath,
  defaultOpen = true,
  onNavigate
}: {
  label: string;
  icon: ReactNode;
  items: NavigationItem[];
  currentPath: string;
  defaultOpen?: boolean;
  onNavigate?: () => void;
}) {
  const hasActiveItem = items.some((item) =>
    item.href ? currentPath === item.href || currentPath.startsWith(`${item.href}/`) : false
  );

  return (
    <details
      className={hasActiveItem ? "sidebar-disclosure active" : "sidebar-disclosure"}
      open={defaultOpen || hasActiveItem}
    >
      <summary className="sidebar-disclosure-trigger">
        {icon}
        <span className="sidebar-link-text">{label}</span>
      </summary>
      <div className="sidebar-disclosure-list">
        {items.map((item) => (
          <SidebarItem
            key={item.label}
            item={item}
            currentPath={currentPath}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </details>
  );
}

export function AppShell({
  children,
  currentUser,
  developmentUserState,
  isDevelopmentMode
}: {
  children: ReactNode;
  currentUser: UserPresentation;
  developmentUserState?: DevelopmentUserState | null;
  isDevelopmentMode?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [isSwitchPending, startSwitchTransition] = useTransition();
  const routeMeta = getRouteMeta(pathname);
  const showTopContext = routeMeta.breadcrumbs.length > 1;
  const canAccessAdministration = canAccess(currentUser.role, "administration");
  const administrationItems = administrationNavigation.map((item) =>
    item.href && !canAccessAdministration ? { ...item, disabled: true } : item
  );

  function handleSwitchUser(userId: number) {
    if (!isDevelopmentMode || isSwitchPending) {
      return;
    }

    startSwitchTransition(() => {
      void (async () => {
        setSwitchError(null);
        try {
          await switchDevelopmentUser(userId);
          router.refresh();
        } catch (requestError) {
          setSwitchError(
            requestError instanceof UsersClientError
              ? requestError.message
              : "Le changement d'utilisateur a echoue."
          );
        }
      })();
    });
  }

  return (
    <div className="app-shell">
      <aside className={sidebarOpen ? "app-sidebar open" : "app-sidebar"}>
        <div className="sidebar-brand">
          <BrandLogo compact priority />
        </div>

        <nav className="sidebar-group" aria-label="Navigation principale">
          {primaryNavigation.map((item) => (
            <SidebarItem
              key={item.label}
              item={item}
              currentPath={pathname}
              onNavigate={() => setSidebarOpen(false)}
            />
          ))}
        </nav>

        <SidebarDisclosure
          label="Administration"
          icon={<SettingsIcon className="nav-icon" />}
          items={administrationItems}
          currentPath={pathname}
          onNavigate={() => setSidebarOpen(false)}
        />

        <div className="sidebar-upcoming-group">
          <span className="sidebar-upcoming-heading">Prochainement</span>
          <nav className="sidebar-group" aria-label="Fonctionnalites a venir">
            {upcomingNavigation.map((item) => (
              <SidebarItem
                key={item.label}
                item={item}
                currentPath={pathname}
                onNavigate={() => setSidebarOpen(false)}
              />
            ))}
          </nav>
        </div>

        <div className="sidebar-spacer" />

        <div className="sidebar-user">
          <UserAvatar
            displayName={currentUser.name}
            avatarUrl={currentUser.avatar_url}
            size="md"
          />
          <div className="sidebar-user-copy">
            <strong>{currentUser.name}</strong>
            <span>{currentUser.role_label}</span>
            <small>{currentUser.department_label}</small>
          </div>
        </div>
      </aside>

      {sidebarOpen ? (
        <button
          type="button"
          className="sidebar-overlay"
          aria-label="Fermer le menu"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar-left">
            <button
              type="button"
              className="sidebar-toggle"
              aria-label="Ouvrir le menu"
              onClick={() => setSidebarOpen((current) => !current)}
            >
              <span />
              <span />
              <span />
            </button>

            {showTopContext ? (
              <div className="topbar-copy">
                <div className="breadcrumb">
                  {routeMeta.breadcrumbs.map((item, index) => (
                    <span key={`${item}-${index}`} className="breadcrumb-item">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="app-topbar-right">
            <span
              className="topbar-icon-button topbar-icon-button-disabled"
              aria-disabled="true"
              title="Notifications bientot disponibles"
            >
              <BellIcon className="topbar-action-icon" />
            </span>

            <details className="topbar-user-menu">
              <summary className="topbar-user-button" aria-label="Menu utilisateur">
                <UserAvatar
                  displayName={currentUser.name}
                  avatarUrl={currentUser.avatar_url}
                  size="sm"
                />
                <div className="topbar-user-copy">
                  <strong>{currentUser.name}</strong>
                  <span>
                    {currentUser.role_label} · {currentUser.department_label}
                  </span>
                </div>
              </summary>

              <div className="topbar-user-menu-content">
                <div className="topbar-user-menu-identity">
                  <UserAvatar
                    displayName={currentUser.name}
                    avatarUrl={currentUser.avatar_url}
                    size="md"
                  />
                  <div className="topbar-user-menu-copy">
                    <strong>{currentUser.name}</strong>
                    <span>{currentUser.email}</span>
                    <small>
                      {currentUser.role_label} · {currentUser.department_label}
                    </small>
                  </div>
                </div>

                <div className="topbar-user-menu-links">
                  <Link href="/profile" className="topbar-user-menu-link">
                    Profil
                  </Link>
                  <Link href="/settings" className="topbar-user-menu-link">
                    Parametres
                  </Link>
                  <span className="topbar-user-menu-link disabled" aria-disabled="true">
                    Deconnexion
                    <small>Bientot</small>
                  </span>
                </div>

                {isDevelopmentMode && developmentUserState ? (
                  <div className="topbar-dev-switcher">
                    <div className="topbar-dev-switcher-header">
                      <strong>Mode developpement</strong>
                      <span>Changer immediatement d'utilisateur pour tester les permissions.</span>
                    </div>

                    <div className="topbar-dev-switcher-list">
                      {developmentUserState.users.map((user) => {
                        const isSelected = user.id === developmentUserState.currentUserId;
                        return (
                          <button
                            key={user.id}
                            type="button"
                            className={isSelected ? "topbar-dev-user active" : "topbar-dev-user"}
                            disabled={isSwitchPending}
                            onClick={() => handleSwitchUser(user.id)}
                          >
                            <div className="topbar-dev-user-copy">
                              <strong>{user.displayName}</strong>
                              <span>
                                {getUserRoleLabel(user.role)} · {user.departmentName}
                              </span>
                            </div>
                            <small>{user.email}</small>
                          </button>
                        );
                      })}
                    </div>

                    {switchError ? (
                      <div className="callout warning topbar-dev-switcher-error">{switchError}</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </details>

            {routeMeta.actionHref && routeMeta.actionLabel ? (
              <Link href={routeMeta.actionHref} className="button button-primary topbar-cta">
                {routeMeta.actionLabel}
              </Link>
            ) : null}
          </div>
        </header>

        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
