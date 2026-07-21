"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { AppelOffresSummaryView } from "@/lib/appels-offres/presentation.ts";
import { isPlaceholderProjectTitle } from "@/lib/appels-offres/workspace.ts";
import { EmptyState } from "./empty-state.tsx";
import { MoreHorizontalIcon, UploadIcon } from "./app-icons.tsx";
import { StatusBadge } from "./status-badge.tsx";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("fr-FR");
}

function formatDate(value: string | null) {
  if (!value) {
    return "Non renseignée";
  }

  return new Date(value).toLocaleDateString("fr-FR");
}

export function AppelsOffresListView({
  items,
  initialStatusFilter = "all",
  initialSortBy = "updated"
}: {
  items: AppelOffresSummaryView[];
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
  const [isPending, startTransition] = useTransition();

  const clients = useMemo(
    () =>
      [...new Set(items.map((item) => item.client).filter((value) => value !== "Non renseigné"))]
        .sort((a, b) => a.localeCompare(b, "fr")),
    [items]
  );

  const countries = useMemo(
    () =>
      [...new Set(items.map((item) => item.country).filter((value) => value !== "Non renseigné"))]
        .sort((a, b) => a.localeCompare(b, "fr")),
    [items]
  );

  const priorities = useMemo(
    () => [...new Set(items.map((item) => item.priorityLabel))].sort((a, b) => a.localeCompare(b, "fr")),
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
        ![
          item.code,
          item.title,
          item.client,
          item.country,
          item.statusLabel
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
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

  if (!items.length) {
    return (
      <EmptyState
        title="Aucun appel d'offres"
        description="Créez votre premier appel d'offres pour importer un CDC et démarrer son analyse."
        action={
          <Link href="/appels-offres/nouveau" className="button button-primary">
            Créer un appel d'offres
          </Link>
        }
      />
    );
  }

  return (
    <div className="stack">
      <section className="toolbar-card">
        <div className="toolbar-grid">
          <label className="toolbar-field field-span-2">
            <span>Recherche</span>
            <input
              className="input"
              value={query}
              placeholder="Code, intitulé, client, pays"
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
                    {item?.statusLabel ?? statusKey}
                  </option>
                );
              })}
            </select>
          </label>

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

          <label className="toolbar-field">
            <span>Trier par</span>
            <select
              className="select"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
            >
              <option value="updated">Dernière mise à jour</option>
              <option value="deadline">Date limite</option>
              <option value="title">Intitulé</option>
            </select>
          </label>
        </div>

        <div className="toolbar-actions">
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

          <label className="toggle-field">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            <span>Afficher les archives</span>
          </label>

          <button type="button" className="button button-secondary" disabled>
            Exporter · bientôt disponible
          </button>
        </div>
      </section>

      {!filteredItems.length ? (
        <EmptyState
          compact
          title="Aucun résultat"
          description="Aucun appel d'offres ne correspond aux filtres actuellement sélectionnés."
        />
      ) : null}

      {filteredItems.length ? (
        viewMode === "table" ? (
          <section className="data-card table-shell">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code interne</th>
                    <th>Intitulé</th>
                    <th>Client</th>
                    <th>Pays</th>
                    <th>Statut</th>
                    <th>Priorité</th>
                    <th>Responsable commercial</th>
                    <th>Date limite</th>
                    <th>Dernière mise à jour</th>
                    <th>Etape courante</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.code}>
                      <td>
                        <span className="mono table-code" title={item.code}>
                          {item.code}
                        </span>
                      </td>
                      <td>
                        <div className="table-primary-cell">
                          <strong title={item.title}>
                            {isPlaceholderProjectTitle(item.title, item.code)
                              ? "Intitule en attente d'extraction"
                              : item.title}
                          </strong>
                          <span>{item.reference}</span>
                        </div>
                      </td>
                      <td>{item.client}</td>
                      <td>{item.country}</td>
                      <td>
                        <StatusBadge label={item.statusLabel} tone={item.statusTone} />
                      </td>
                      <td>{item.priorityLabel}</td>
                      <td>{item.ownerLabel}</td>
                      <td>
                        <div className={item.isOverdue ? "deadline-cell overdue" : item.daysUntilDeadline != null && item.daysUntilDeadline <= 14 ? "deadline-cell near" : "deadline-cell"}>
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
                      <td>{formatDateTime(item.updatedAt)}</td>
                      <td>{item.currentStep}</td>
                      <td>
                        <div className="table-actions">
                          <Link href={`/appels-offres/${encodeURIComponent(item.code)}`} className="button button-ghost button-small">
                            Ouvrir
                          </Link>
                          <details className="row-menu">
                            <summary className="row-menu-trigger" aria-label="Plus d'actions">
                              <MoreHorizontalIcon className="table-menu-icon" />
                            </summary>
                            <div className="row-menu-content">
                              <Link href={`/appels-offres/${encodeURIComponent(item.code)}`} className="row-menu-link">
                                Modifier
                              </Link>
                              {item.hasSourcePdf ? (
                                <Link
                                  href={`/api/appels-offres/${encodeURIComponent(item.code)}/pdf`}
                                  className="row-menu-link"
                                  target="_blank"
                                >
                                  Télécharger le CDC
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
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <div className="responsive-card-grid">
            {filteredItems.map((item) => (
              <article key={item.code} className="workspace-card">
                <div className="workspace-card-topline">
                  <div>
                    <span className="card-kicker mono" title={item.code}>{item.code}</span>
                    <h3 title={item.title}>
                      {isPlaceholderProjectTitle(item.title, item.code)
                        ? "Intitule en attente d'extraction"
                        : item.title}
                    </h3>
                  </div>
                  <StatusBadge label={item.statusLabel} tone={item.statusTone} />
                </div>
                <div className="workspace-card-meta">
                  <span>{item.client}</span>
                  <span>{item.country}</span>
                  <span>Priorite {item.priorityLabel}</span>
                  <span>Date limite {formatDate(item.dueDate)}</span>
                </div>
                <p className="workspace-card-description">{item.statusDescription}</p>
                <p className="workspace-card-description">{item.currentStep}</p>
                <div className="workspace-card-actions">
                  <Link href={`/appels-offres/${encodeURIComponent(item.code)}`} className="button button-primary button-small">
                    Ouvrir
                  </Link>
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
    </div>
  );
}
