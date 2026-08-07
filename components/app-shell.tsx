"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import type { ReactNode } from "react";
import {
  DashboardIcon,
  DatabaseIcon,
  FolderIcon,
  LibraryIcon,
  SettingsIcon,
  UserCircleIcon
} from "./app-icons.tsx";
import { BrandLogo } from "./brand-logo.tsx";
import { NotificationBell } from "./notification-bell.tsx";
import { UserAvatar } from "./user-avatar.tsx";
import { canAccess, type UserPresentation, type UserRole } from "@/lib/auth/rbac.ts";
import {
  filterNavigationByRole,
  getAdminNavigationSections,
  isActiveNavigationPath,
  type NavigationIconKey
} from "@/lib/administration/navigation.ts";
import { switchDevelopmentUser, UsersClientError } from "@/lib/users/client.ts";
import type { DevelopmentUserState } from "@/lib/users/types.ts";
import { getUserRoleLabel } from "@/lib/auth/rbac.ts";
import type { NavigationItemDefinition as NavigationItem } from "@/lib/administration/navigation.ts";
import { getRoleWorkspaceExperience } from "@/lib/appels-offres/role-workspace.ts";
import type { AppNotificationRecord } from "@/lib/notifications/types.ts";

const administrationNavigation: NavigationItem[] = [
  {
    label: "Administration",
    href: "/administration",
    iconKey: "settings"
  },
  { label: "Referentiels", iconKey: "library", disabled: true },
  { label: "Employes", iconKey: "library", disabled: true },
  { label: "Competences", iconKey: "library", disabled: true },
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
];

function renderNavigationIcon(iconKey: NavigationIconKey) {
  switch (iconKey) {
    case "dashboard":
      return <DashboardIcon className="nav-icon" />;
    case "folder":
      return <FolderIcon className="nav-icon" />;
    case "database":
      return <DatabaseIcon className="nav-icon" />;
    case "library":
      return <LibraryIcon className="nav-icon" />;
    case "settings":
      return <SettingsIcon className="nav-icon" />;
    case "user":
      return <UserCircleIcon className="nav-icon" />;
    default:
      return <DashboardIcon className="nav-icon" />;
  }
}

function getRouteMeta(pathname: string) {
  if (pathname === "/administration") {
    return {
      title: "Administration",
      breadcrumbs: ["Administration"]
    };
  }

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
  currentSearch,
  onNavigate
}: {
  item: NavigationItem;
  currentPath: string;
  currentSearch: string;
  onNavigate?: () => void;
}) {
  const isActive = isActiveNavigationPath(currentPath, item.href, currentSearch);

  if (!item.href || item.disabled) {
    return (
      <span className="sidebar-link disabled" aria-disabled="true">
        {renderNavigationIcon(item.iconKey)}
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
      {renderNavigationIcon(item.iconKey)}
      <span className="sidebar-link-text">{item.label}</span>
    </Link>
  );
}

function SidebarDisclosure({
  label,
  iconKey,
  items,
  currentPath,
  currentSearch,
  defaultOpen = true,
  onNavigate
}: {
  label: string;
  iconKey: NavigationIconKey;
  items: NavigationItem[];
  currentPath: string;
  currentSearch: string;
  defaultOpen?: boolean;
  onNavigate?: () => void;
}) {
  const hasActiveItem = items.some((item) =>
    isActiveNavigationPath(currentPath, item.href, currentSearch)
  );

  return (
    <details
      className={hasActiveItem ? "sidebar-disclosure active" : "sidebar-disclosure"}
      open={defaultOpen || hasActiveItem}
    >
      <summary className="sidebar-disclosure-trigger">
        {renderNavigationIcon(iconKey)}
        <span className="sidebar-link-text">{label}</span>
      </summary>
      <div className="sidebar-disclosure-list">
        {items.map((item) => (
          <SidebarItem
            key={item.label}
            item={item}
            currentPath={currentPath}
            currentSearch={currentSearch}
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
  isDevelopmentMode,
  initialNotifications = [],
  initialUnreadNotificationCount = 0
}: {
  children: ReactNode;
  currentUser: UserPresentation | null;
  developmentUserState?: DevelopmentUserState | null;
  isDevelopmentMode?: boolean;
  initialNotifications?: AppNotificationRecord[];
  initialUnreadNotificationCount?: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isSwitchPending, startSwitchTransition] = useTransition();
  const [isLogoutPending, startLogoutTransition] = useTransition();
  const routeMeta = getRouteMeta(pathname);
  const showTopContext = routeMeta.breadcrumbs.length > 1;
  const isAdminExperience = currentUser?.role === "ADMIN";
  const canAccessAdministration = currentUser
    ? canAccess(currentUser.role, "administration")
    : false;
  const adminSections = getAdminNavigationSections();
  const currentSearch = searchParams.toString();
  const workspaceExperience = currentUser
    ? getRoleWorkspaceExperience(currentUser.role as UserRole)
    : null;
  const primaryNavigation: NavigationItem[] = currentUser
    ? filterNavigationByRole(
        workspaceExperience?.primaryNavigation ?? [],
        currentUser.role as UserRole
      )
    : [];
  const topbarAction =
    pathname === "/dashboard"
      ? workspaceExperience?.dashboardAction ?? null
      : routeMeta.actionHref && routeMeta.actionLabel
        ? {
            href: routeMeta.actionHref,
            label: routeMeta.actionLabel
          }
        : null;

  function handleLogout() {
    if (isLogoutPending) {
      return;
    }

    startLogoutTransition(() => {
      void (async () => {
        setLogoutError(null);
        try {
          await fetch("/api/auth/logout", { method: "POST" });
          router.push("/login");
          router.refresh();
        } catch {
          setLogoutError("La deconnexion a echoue.");
        }
      })();
    });
  }

  function handleSwitchUser(userId: number) {
    if (!isDevelopmentMode || isSwitchPending || !currentUser) {
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

  if (!currentUser) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      <aside
        className={[
          "app-sidebar",
          sidebarOpen ? "open" : "",
          isAdminExperience ? "is-admin-experience" : ""
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="sidebar-brand">
          <BrandLogo compact priority />
        </div>

        {isAdminExperience ? (
          <div className="sidebar-admin-sections" aria-label="Navigation administration">
            {adminSections.map((section) => (
              <section key={section.label} className="sidebar-section">
                <span className="sidebar-section-title">{section.label}</span>
                <nav className="sidebar-group" aria-label={section.label}>
                  {section.items.map((item) => (
                    <SidebarItem
                      key={`${section.label}-${item.label}`}
                      item={item}
                      currentPath={pathname}
                      currentSearch={currentSearch}
                      onNavigate={() => setSidebarOpen(false)}
                    />
                  ))}
                </nav>
              </section>
            ))}
          </div>
        ) : (
          <nav className="sidebar-group" aria-label="Navigation principale">
            {primaryNavigation.map((item) => (
              <SidebarItem
                key={item.label}
                item={item}
                currentPath={pathname}
                currentSearch={currentSearch}
                onNavigate={() => setSidebarOpen(false)}
              />
            ))}
          </nav>
        )}

        {!isAdminExperience && canAccessAdministration ? (
          <SidebarDisclosure
            label="Administration"
            iconKey="settings"
            items={administrationNavigation}
            currentPath={pathname}
            currentSearch={currentSearch}
            onNavigate={() => setSidebarOpen(false)}
          />
        ) : null}

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
            <NotificationBell
              initialItems={initialNotifications}
              initialUnreadCount={initialUnreadNotificationCount}
            />

            <details className="topbar-user-menu">
              <summary className="topbar-user-button" aria-label="Menu utilisateur">
                <UserAvatar
                  displayName={currentUser.name}
                  avatarUrl={currentUser.avatar_url}
                  size="sm"
                />
                <span className="topbar-user-copy">
                  <strong>{currentUser.name}</strong>
                  <span>
                    {currentUser.role_label} · {currentUser.department_label}
                  </span>
                </span>
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
                  <button
                    type="button"
                    className="topbar-user-menu-link topbar-user-menu-button"
                    disabled={isLogoutPending}
                    onClick={handleLogout}
                  >
                    {isLogoutPending ? "Deconnexion..." : "Deconnexion"}
                  </button>
                </div>

                {isDevelopmentMode && developmentUserState ? (
                  <div className="topbar-dev-switcher">
                    <div className="topbar-dev-switcher-header">
                      <strong>Changer d'utilisateur - developpement</strong>
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

                {logoutError ? <div className="callout warning">{logoutError}</div> : null}
              </div>
            </details>

            {!isAdminExperience && topbarAction ? (
              <Link href={topbarAction.href} className="button button-primary topbar-cta">
                {topbarAction.label}
              </Link>
            ) : null}
          </div>
        </header>

        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
