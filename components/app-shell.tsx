"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const routeMeta = getRouteMeta(pathname);
  const showTopContext = routeMeta.breadcrumbs.length > 1;

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
          items={administrationNavigation}
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
          <span className="sidebar-user-avatar">BD</span>
          <div className="sidebar-user-copy">
            <strong>Bob Durand</strong>
            <span>Commercial</span>
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
              title="Notifications bientôt disponibles"
            >
              <BellIcon className="topbar-action-icon" />
            </span>

            <div className="topbar-user-display" aria-label="Identite utilisateur">
              <UserCircleIcon className="topbar-action-icon" />
              <div className="topbar-user-copy">
                <strong>Bob Durand</strong>
                <span>Commercial</span>
              </div>
            </div>

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
