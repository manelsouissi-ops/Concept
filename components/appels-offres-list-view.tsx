"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyboardEvent, useEffect, useMemo, useState, useTransition } from "react";
import { DashboardRowActionButton } from "@/components/dashboard-row-action-button.tsx";
import type { DashboardRowAction } from "@/lib/appels-offres/dashboard-status.ts";
import type { AppelOffresSummaryView, BadgeTone } from "@/lib/appels-offres/presentation.ts";
import { isPlaceholderProjectTitle } from "@/lib/appels-offres/workspace.ts";
import { EmptyState } from "./empty-state.tsx";
import { MoreHorizontalIcon, UploadIcon } from "./app-icons.tsx";
import { StatusBadge } from "./status-badge.tsx";

const TABLE_PAGE_SIZE = 10;
const CARD_PAGE_SIZE = 6;

const EXTRACTION_PENDING_LABEL = "En attente d'extraction";

type PaginationItem = number | "ellipsis";

export type AppelOffresListItem = AppelOffresSummaryView & {
  statusDisplay: { label: string; tone: BadgeTone };
  rowAction: DashboardRowAction;
};

function isMissingValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "non renseigne" || normalized === "non renseignee";
}

function withExtractionFallback(value: string) {
  return isMissingValue(value) ? EXTRACTION_PENDING_LABEL : value;
}

function formatDate(value: string | null) {
  if (!value) {
    return EXTRACTION_PENDING_LABEL;
  }

  return new Date(value).toLocaleDateString("fr-FR");
}

function buildPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);

  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }

  if (currentPage >= totalPages - 2) {
    pages.add(totalPages - 1);
    pages.add(totalPages - 2);
    pages.add(totalPages - 3);
  }

  const sortedPages = [...pages]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);

  const paginationItems: PaginationItem[] = [];

  sortedPages.forEach((page, index) => {
    const previous = sortedPages[index - 1];

    if (previous != null && page - previous > 1) {
      paginationItems.push("ellipsis");
    }

    paginationItems.push(page);
  });

  return paginationItems;
}

export function AppelsOffresListView({
  items,
  initialStatusFilter = "all",
  initialSortBy = "updated"
}: {
  items: AppelOffresListItem[];
  initialStatusFilter?: string;
  initialSortBy?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [clientFilter, setClientFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sortBy, setSortBy] = useState(initialSortBy);
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [isPending, startTransition] = useTransition();
  const activeAdvancedFiltersCount = [
    clientFilter !== "all",
    countryFilter !== "all",
    priorityFilter !== "all",
    showArchived
  ].filter(Boolean).length;

  const clients = useMemo(
    () =>
      [...new Set(items.map((item) => item.client).filter((value) => !isMissingValue(value)))].sort(
        (a, b) => a.localeCompare(b, "fr")
      ),
    [items]
  );

  const countries = useMemo(
    () =>
      [...new Set(items.map((item) => item.country).filter((value) => !isMissingValue(value)))].sort(
        (a, b) => a.localeCompare(b, "fr")
      ),
    [items]
  );

  const priorities = useMemo(
    () =>
      [...new Set(items.map((item) => item.priorityLabel))].sort((a, b) =>
        a.localeCompare(b, "fr")
      ),
    [items]
  );

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const nextItems = items.filter((item) => {
      if (!showArchived && item.isArchived) {
        return false;
      }

      if (
        normalizedQuery &&
        [item.code, item.title, item.client, item.country, item.statusDisplay.label]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery) === false
      ) {
        return false;
      }

      if (statusFilter !== "all" && item.statusKey !== statusFilter) {
        return false;
      }

      if (clientFilter !== "all" && item.client !== clientFilter) {
        return false;
      }

      if (countryFilter !== "all" && item.country !== countryFilter) {
        return false;
      }

      if (priorityFilter !== "all" && item.priorityLabel !== priorityFilter) {
        return false;
      }

      return true;
    });

    return nextItems.sort((left, right) => {
      if (sortBy === "deadline") {
        return (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31");
      }

      if (sortBy === "title") {
        return left.title.localeCompare(right.title, "fr");
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }, [clientFilter, countryFilter, items, priorityFilter, query, showArchived, sortBy, statusFilter]);

  const itemsPerPage = viewMode === "table" ? TABLE_PAGE_SIZE : CARD_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / itemsPerPage));
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredItems.slice(startIndex, startIndex + itemsPerPage);
  }, [currentPage, filteredItems, itemsPerPage]);
  const paginationItems = useMemo(
    () => buildPaginationItems(currentPage, totalPages),
    [currentPage, totalPages]
  );
  const resultStart = filteredItems.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const resultEnd =
    filteredItems.length === 0
      ? 0
      : Math.min(currentPage * itemsPerPage, filteredItems.length);
  const viewToggle = (
    <div className="view-toggle" role="tablist" aria-label="Choix de la vue">
      <button
        type="button"
        className={viewMode === "table" ? "view-toggle-button active" : "view-toggle-button"}
        onClick={() => setViewMode("table")}
      >
        Tableau
      </button>
      <button
        type="button"
        className={viewMode === "cards" ? "view-toggle-button active" : "view-toggle-button"}
        onClick={() => setViewMode("cards")}
      >
        Cartes
      </button>
    </div>
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [query, statusFilter, clientFilter, countryFilter, priorityFilter, sortBy, showArchived, viewMode]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  async function handleArchive(code: string, archived: boolean) {
    const confirmed = window.confirm(
      archived
        ? "Desarchiver cet appel d'offres ?"
        : "Archiver cet appel d'offres ? Les documents resteront disponibles sur disque."
    );

    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      const response = await fetch(
        archived
          ? `/api/appels-offres/${encodeURIComponent(code)}/unarchive`
          : `/api/appels-offres/${encodeURIComponent(code)}/archive`,
        {
          method: "POST"
        }
      );

      if (response.ok) {
        router.refresh();
      }
    });
  }

  function openWorkspace(code: string) {
    router.push(`/appels-offres/${encodeURIComponent(code)}`);
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, code: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openWorkspace(code);
    }
  }

  if (!items.length) {
    return (
      <EmptyState
        title="Aucun appel d'offres"
        description="Creez votre premier appel d'offres pour importer un CDC et demarrer son analyse."
        action={
          <Link href="/appels-offres/nouveau" className="button button-primary">
            Creer un appel d'offres
          </Link>
        }
      />
    );
  }

  return (
    <div className="stack">
      <section className="toolbar-card appels-offres-toolbar-card">
        <div className="toolbar-grid appels-offres-toolbar-grid">
          <label className="toolbar-field field-span-2">
            <span>Recherche</span>
            <input
              className="input"
              value={query}
              placeholder="Code, intitule, client"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <label className="toolbar-field">
            <span>Statut</span>
            <select
              className="select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">Tous</option>
              {[...new Set(items.map((item) => item.statusKey))].map((statusKey) => {
                const item = items.find((entry) => entry.statusKey === statusKey);
                return (
                  <option key={statusKey} value={statusKey}>
                    {item?.statusDisplay.label ?? statusKey}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="toolbar-field">
            <span>Trier par</span>
            <select
              className="select"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
            >
              <option value="updated">Derniere mise a jour</option>
              <option value="deadline">Date limite</option>
              <option value="title">Intitule</option>
            </select>
          </label>
        </div>

        <details
          className="advanced-filters"
          open={advancedFiltersOpen}
          onToggle={(event) =>
            setAdvancedFiltersOpen((event.currentTarget as HTMLDetailsElement).open)
          }
        >
          <summary className="advanced-filters-trigger">
            <span>Filtres avances</span>
            {activeAdvancedFiltersCount > 0 ? (
              <small>{activeAdvancedFiltersCount} actif{activeAdvancedFiltersCount > 1 ? "s" : ""}</small>
            ) : null}
            <span className="advanced-filters-chevron" aria-hidden="true" />
          </summary>

          <div className="advanced-filters-panel">
            <div className="advanced-filters-grid">
              <label className="toolbar-field">
                <span>Client</span>
                <select
                  className="select"
                  value={clientFilter}
                  onChange={(event) => setClientFilter(event.target.value)}
                >
                  <option value="all">Tous</option>
                  {clients.map((client) => (
                    <option key={client} value={client}>
                      {client}
                    </option>
                  ))}
                </select>
              </label>

              <label className="toolbar-field">
                <span>Pays</span>
                <select
                  className="select"
                  value={countryFilter}
                  onChange={(event) => setCountryFilter(event.target.value)}
                >
                  <option value="all">Tous</option>
                  {countries.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
              </label>

              <label className="toolbar-field">
                <span>Priorite</span>
                <select
                  className="select"
                  value={priorityFilter}
                  onChange={(event) => setPriorityFilter(event.target.value)}
                >
                  <option value="all">Toutes</option>
                  {priorities.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </label>

              <label className="toggle-field advanced-toggle-field">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />
                <span>Afficher les archives</span>
              </label>
            </div>
          </div>
        </details>
      </section>

      {!filteredItems.length ? (
        <EmptyState
          compact
          title="Aucun resultat"
          description="Aucun appel d'offres ne correspond aux filtres actuellement selectionnes."
        />
      ) : null}

      {filteredItems.length ? <div className="results-toolbar">{viewToggle}</div> : null}

      {paginatedItems.length ? (
        viewMode === "table" ? (
          <section className="data-card table-shell">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code interne</th>
                    <th>Intitule</th>
                    <th>Client</th>
                    <th>Statut</th>
                    <th>Date limite</th>
                    <th>Responsable</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map((item) => {
                    const titlePending = isPlaceholderProjectTitle(item.title, item.code);
                    const referenceMissing = isMissingValue(item.reference);

                    return (
                      <tr
                        key={item.code}
                        className="clickable-row"
                        tabIndex={0}
                        role="link"
                        aria-label={`Ouvrir ${item.code}`}
                        onClick={() => openWorkspace(item.code)}
                        onKeyDown={(event) => handleRowKeyDown(event, item.code)}
                      >
                        <td>
                          <span className="mono table-code" title={item.code}>
                            {item.code}
                          </span>
                        </td>
                        <td>
                          <div className="table-primary-cell">
                            <strong title={item.title}>
                              {titlePending ? "Intitule en attente d'extraction" : item.title}
                            </strong>
                            {titlePending && referenceMissing ? null : (
                              <span>{withExtractionFallback(item.reference)}</span>
                            )}
                          </div>
                        </td>
                        <td>{withExtractionFallback(item.client)}</td>
                        <td>
                          <StatusBadge label={item.statusDisplay.label} tone={item.statusDisplay.tone} />
                        </td>
                        <td>
                          <div
                            className={
                              item.isOverdue
                                ? "deadline-cell overdue"
                                : item.daysUntilDeadline != null && item.daysUntilDeadline <= 14
                                  ? "deadline-cell near"
                                  : "deadline-cell"
                            }
                          >
                            <strong>{formatDate(item.dueDate)}</strong>
                            {item.daysUntilDeadline != null ? (
                              <span>
                                {item.daysUntilDeadline < 0
                                  ? `Depassee de ${Math.abs(item.daysUntilDeadline)} j`
                                  : item.daysUntilDeadline === 0
                                    ? "Echeance aujourd'hui"
                                    : `J-${item.daysUntilDeadline}`}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td>{withExtractionFallback(item.ownerLabel)}</td>
                        <td>
                          <div className="table-actions" onClick={(event) => event.stopPropagation()}>
                            <DashboardRowActionButton action={item.rowAction} />
                            <details className="row-menu">
                              <summary
                                className="row-menu-trigger"
                                aria-label="Plus d'actions"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <MoreHorizontalIcon className="table-menu-icon" />
                              </summary>
                              <div className="row-menu-content">
                                <Link
                                  href={`/appels-offres/${encodeURIComponent(item.code)}`}
                                  className="row-menu-link"
                                >
                                  Modifier
                                </Link>
                                {item.hasSourcePdf ? (
                                  <Link
                                    href={`/api/appels-offres/${encodeURIComponent(item.code)}/pdf`}
                                    className="row-menu-link"
                                    target="_blank"
                                  >
                                    Telecharger le CDC
                                  </Link>
                                ) : null}
                                <button
                                  type="button"
                                  className="row-menu-link destructive"
                                  onClick={() => void handleArchive(item.code, item.isArchived)}
                                  disabled={isPending}
                                >
                                  {item.isArchived ? "Desarchiver" : "Archiver"}
                                </button>
                              </div>
                            </details>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <div className="responsive-card-grid">
            {paginatedItems.map((item) => (
              <article key={item.code} className="workspace-card">
                <div className="workspace-card-topline">
                  <div>
                    <span className="card-kicker mono" title={item.code}>
                      {item.code}
                    </span>
                    <h3 title={item.title}>
                      {isPlaceholderProjectTitle(item.title, item.code)
                        ? "Intitule en attente d'extraction"
                        : item.title}
                    </h3>
                  </div>
                  <StatusBadge label={item.statusDisplay.label} tone={item.statusDisplay.tone} />
                </div>
                <div className="workspace-card-meta">
                  <span>{withExtractionFallback(item.client)}</span>
                  <span>{withExtractionFallback(item.country)}</span>
                  <span>Priorite {item.priorityLabel}</span>
                  <span>Date limite {formatDate(item.dueDate)}</span>
                </div>
                <p className="workspace-card-description">{item.statusDescription}</p>
                <p className="workspace-card-description">{item.currentStep}</p>
                <div className="workspace-card-actions">
                  <DashboardRowActionButton action={item.rowAction} />
                  {item.hasSourcePdf ? (
                    <Link
                      href={`/api/appels-offres/${encodeURIComponent(item.code)}/pdf`}
                      className="button button-secondary button-small"
                      target="_blank"
                    >
                      <UploadIcon className="button-icon" />
                      CDC
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )
      ) : null}

      {filteredItems.length ? (
        <div className="pagination-bar" aria-label="Pagination des resultats">
          <p className="pagination-summary">
            {resultStart}-{resultEnd} sur {filteredItems.length}{" "}
            {filteredItems.length > 1 ? "appels d'offres" : "appel d'offres"}
          </p>

          {totalPages > 1 ? (
            <div className="pagination-controls">
              <button
                type="button"
                className="button button-ghost button-small pagination-button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
              >
                Precedent
              </button>

              <div className="pagination-pages">
                {paginationItems.map((item, index) =>
                  item === "ellipsis" ? (
                    <span key={`ellipsis-${index}`} className="pagination-ellipsis" aria-hidden="true">
                      ...
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      className={
                        item === currentPage
                          ? "button button-ghost button-small pagination-button active"
                          : "button button-ghost button-small pagination-button"
                      }
                      aria-current={item === currentPage ? "page" : undefined}
                      onClick={() => setCurrentPage(item)}
                    >
                      {item}
                    </button>
                  )
                )}
              </div>

              <button
                type="button"
                className="button button-ghost button-small pagination-button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
              >
                Suivant
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
