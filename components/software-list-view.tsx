"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { EmptyState } from "./empty-state.tsx";
import { MoreHorizontalIcon } from "./app-icons.tsx";
import { StatusBadge } from "./status-badge.tsx";
import type { SoftwareRecord } from "@/lib/administration/logiciels/types.ts";

function formatTimestamp(value: string) {
  return new Date(value).toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function getStatusLabel(status: SoftwareRecord["status"]) {
  return status === "active" ? "Actif" : "Archive";
}

function getStatusTone(status: SoftwareRecord["status"]) {
  return status === "active" ? "success" : "neutral";
}

function summarizeAliases(record: SoftwareRecord) {
  if (!record.aliases.length) {
    return "Aucun alias";
  }

  const aliases = record.aliases.map((alias) => alias.alias);
  if (aliases.length <= 2) {
    return aliases.join(", ");
  }

  return `${aliases.slice(0, 2).join(", ")} +${aliases.length - 2}`;
}

function summarizeDescription(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "Non renseignee";
  }

  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 117)}...`;
}

export function SoftwareListView({ items }: { items: SoftwareRecord[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SoftwareRecord["status"]>("all");
  const [isPending, startTransition] = useTransition();

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("fr-FR");

    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        item.name,
        item.descriptionRaw,
        ...item.aliases.map((alias) => alias.alias)
      ]
        .join(" ")
        .toLocaleLowerCase("fr-FR");

      return haystack.includes(normalizedQuery);
    });
  }, [items, query, statusFilter]);

  async function handleStatusToggle(record: SoftwareRecord) {
    startTransition(async () => {
      const response = await fetch(
        `/api/administration/logiciels/${record.id}/${record.status === "active" ? "archive" : "reactivate"}`,
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
        title="Aucun logiciel n'est encore enregistre."
        description="Importez le catalogue interne ou ajoutez manuellement un premier logiciel de reference."
        action={
          <div className="empty-state-actions">
            <Link href="/administration/logiciels/importer" className="button button-primary">
              Importer le catalogue
            </Link>
            <Link href="/administration/logiciels/nouveau" className="button button-secondary">
              Ajouter un logiciel
            </Link>
          </div>
        }
      />
    );
  }

  return (
    <div className="stack">
      <section className="toolbar-card">
        <div className="toolbar-grid logiciels-toolbar-grid">
          <label className="toolbar-field field-span-2">
            <span>Recherche</span>
            <input
              className="input"
              value={query}
              placeholder="Nom, utilisation ou alias"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <label className="toolbar-field">
            <span>Statut</span>
            <select
              className="select"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as "all" | SoftwareRecord["status"])
              }
            >
              <option value="all">Tous</option>
              <option value="active">Actifs</option>
              <option value="archived">Archives</option>
            </select>
          </label>

          <div className="logiciels-result-count" aria-live="polite">
            {filteredItems.length} logiciel{filteredItems.length > 1 ? "s" : ""}
          </div>
        </div>
      </section>

      {!filteredItems.length ? (
        <EmptyState
          compact
          title="Aucun resultat"
          description="Aucun logiciel ne correspond aux filtres actuellement selectionnes."
        />
      ) : null}

      {filteredItems.length ? (
        <section className="data-card table-shell">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Logiciel</th>
                  <th>Utilisation</th>
                  <th>Alias</th>
                  <th>Statut</th>
                  <th>Derniere modification</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="table-primary-cell">
                        <strong>{item.name}</strong>
                      </div>
                    </td>
                    <td title={item.descriptionRaw}>{summarizeDescription(item.descriptionRaw)}</td>
                    <td title={item.aliases.map((alias) => alias.alias).join(", ")}>
                      {summarizeAliases(item)}
                    </td>
                    <td>
                      <StatusBadge
                        label={getStatusLabel(item.status)}
                        tone={getStatusTone(item.status)}
                      />
                    </td>
                    <td>{formatTimestamp(item.updatedAt)}</td>
                    <td>
                      <div className="table-actions">
                        <Link
                          href={`/administration/logiciels/${item.id}`}
                          className="button button-ghost button-small"
                        >
                          Ouvrir
                        </Link>
                        <details className="row-menu">
                          <summary className="row-menu-trigger" aria-label="Plus d'actions">
                            <MoreHorizontalIcon className="table-menu-icon" />
                          </summary>
                          <div className="row-menu-content">
                            <Link
                              href={`/administration/logiciels/${item.id}/modifier`}
                              className="row-menu-link"
                            >
                              Modifier
                            </Link>
                            <button
                              type="button"
                              className="row-menu-link destructive"
                              onClick={() => void handleStatusToggle(item)}
                              disabled={isPending}
                            >
                              {item.status === "active" ? "Archiver" : "Reactiver"}
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
      ) : null}
    </div>
  );
}
