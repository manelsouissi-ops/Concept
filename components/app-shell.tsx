"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  BellIcon,
  ChartIcon,
  DashboardIcon,
  DatabaseIcon,
  FileTextIcon,
  FolderIcon,
  LibraryIcon,
  PlusSquareIcon,
  SearchIcon,
  SettingsIcon,
  UserCircleIcon
} from "./app-icons.tsx";

type NavigationItem = {
  label: string;
  href?: string;
  icon: ReactNode;
  disabled?: boolean;
};

const primaryNavigation: NavigationItem[] = [
  { label: "Tableau de bord", href: "/dashboard", icon: <DashboardIcon className="nav-icon" /> },
  { label: "Appels d'offres", href: "/appels-offres", icon: <FolderIcon className="nav-icon" /> },
  {
    label: "Nouvel appel d'offres",
    href: "/appels-offres/nouveau",
    icon: <PlusSquareIcon className="nav-icon" />
  },
  { label: "Fiches CDC", icon: <FileTextIcon className="nav-icon" />, disabled: true },
  { label: "FCI", icon: <LibraryIcon className="nav-icon" />, disabled: true },
  {
    label: "Base de connaissances",
    icon: <DatabaseIcon className="nav-icon" />,
    disabled: true
  },
  { label: "Référentiels", icon: <LibraryIcon className="nav-icon" />, disabled: true },
  { label: "Statistiques", icon: <ChartIcon className="nav-icon" />, disabled: true }
];

const referentialsNavigation = [
  "Employés",
  "Compétences",
  "Logiciels",
  "Clients",
  "Partenaires",
  "Concurrents"
];

const utilityNavigation: NavigationItem[] = [
  { label: "Notifications", icon: <BellIcon className="nav-icon" />, disabled: true },
  { label: "Administration", icon: <SettingsIcon className="nav-icon" />, disabled: true },
  { label: "Paramètres", icon: <SettingsIcon className="nav-icon" />, disabled: true }
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
      breadcrumbs: ["Appels d'offres", "Création"]
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
          <small>Bientôt disponible</small>
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

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const routeMeta = getRouteMeta(pathname);

  return (
    <div className="app-shell">
      <aside className={sidebarOpen ? "app-sidebar open" : "app-sidebar"}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">C</div>
          <div className="sidebar-brand-copy">
            <strong>CONCEPT</strong>
            <span>Gestion intelligente des appels d'offres</span>
          </div>
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

        <section className="sidebar-section">
          <div className="sidebar-section-title">Référentiels</div>
          <div className="sidebar-submenu">
            {referentialsNavigation.map((label) => (
              <span key={label} className="sidebar-subitem" aria-disabled="true">
                {label}
                <small>Bientôt disponible</small>
              </span>
            ))}
          </div>
        </section>

        <div className="sidebar-spacer" />

        <section className="sidebar-group" aria-label="Navigation secondaire">
          {utilityNavigation.map((item) => (
            <SidebarItem key={item.label} item={item} currentPath={pathname} />
          ))}
        </section>

        <div className="sidebar-user">
          <span className="sidebar-user-avatar">LL</span>
          <div className="sidebar-user-copy">
            <strong>Commercial Emp</strong>
            <span>Profil utilisateur</span>
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

            <div className="topbar-copy">
              <div className="breadcrumb">
                {routeMeta.breadcrumbs.map((item, index) => (
                  <span key={`${item}-${index}`} className="breadcrumb-item">
                    {item}
                  </span>
                ))}
              </div>
              <strong>{routeMeta.title}</strong>
            </div>
          </div>

          <div className="app-topbar-right">
            <label className="topbar-search" aria-label="Recherche globale">
              <SearchIcon className="topbar-search-icon" />
              <input
                className="topbar-search-input"
                value=""
                readOnly
                aria-label="Recherche globale bientôt disponible"
                placeholder="Recherche globale · Bientôt disponible"
              />
            </label>

            <button type="button" className="topbar-icon-button" aria-label="Notifications">
              <BellIcon className="topbar-action-icon" />
            </button>

            <button type="button" className="topbar-user-button" aria-label="Profil utilisateur">
              <UserCircleIcon className="topbar-action-icon" />
              <span>Commercial</span>
            </button>

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
