"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { formatBytes, formatDate } from "@/lib/utils/format.ts";
import type { BadgeTone } from "@/lib/appels-offres/presentation.ts";
import {
  CLASSIFICATION_STATES,
  KNOWLEDGE_CATEGORIES,
  TECHNICAL_BUCKETS,
  type ClassificationState,
  type KnowledgeCategory,
  type TechnicalBucket
} from "@/lib/archive-cartography/classification.ts";
import type {
  ArchiveFileRecord,
  ArchiveFileSortField,
  ArchiveFileSortOrder,
  ScanRun
} from "./types.ts";
import {
  loadArchiveFiles,
  loadFileDetails,
  loadSourceRootOptions,
  loadProcessingStatusOptions,
  reviewArchiveFileClassification
} from "./actions.ts";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

const DISCOVERY_STATUS_LABEL: Record<ArchiveFileRecord["discovery_status"], string> = {
  discovered: "Decouvert",
  hashed: "Hache",
  failed: "Echec"
};

const TECHNICAL_BUCKET_LABEL: Record<TechnicalBucket, string> = {
  BUSINESS_DOCUMENT: "Document metier",
  TECHNICAL_FILE: "Fichier technique",
  IMAGE: "Image",
  ARCHIVE: "Archive compressee",
  SOFTWARE_SYSTEM: "Systeme/logiciel",
  UNKNOWN: "Inconnu"
};

const KNOWLEDGE_CATEGORY_LABEL: Record<KnowledgeCategory, string> = {
  CDC: "CDC",
  OFFER: "Offre",
  PROJECT: "Projet",
  METHODOLOGY: "Methodologie",
  CV_CONSULTANT: "CV consultant",
  COMMERCIAL: "Commercial",
  FINANCIAL: "Financier",
  ADMINISTRATIVE: "Administratif",
  OTHER: "Autre",
  UNKNOWN: "Inconnu"
};

const CLASSIFICATION_STATE_LABEL: Record<ClassificationState, string> = {
  UNCLASSIFIED: "Non classifie",
  AUTO_FILTERED: "Filtre automatiquement",
  AI_PROPOSED: "Propose par l'IA",
  NEEDS_REVIEW: "A revoir",
  VALIDATED: "Valide"
};

const CLASSIFICATION_STATE_TONE: Record<ClassificationState, BadgeTone> = {
  UNCLASSIFIED: "neutral",
  AUTO_FILTERED: "neutral",
  AI_PROPOSED: "ai",
  NEEDS_REVIEW: "warning",
  VALIDATED: "success"
};

const SORTABLE_COLUMNS: { field: ArchiveFileSortField; label: string }[] = [
  { field: "filename", label: "Fichier" },
  { field: "size_bytes", label: "Taille" },
  { field: "modified_at", label: "Modifie" },
  { field: "duplicate_count", label: "Doublons" }
];

type Filters = {
  search: string;
  extension: string;
  duplicate: "all" | "duplicate" | "unique";
  processing_status: string;
  discovery_status: "all" | "discovered" | "hashed" | "failed";
  source_root_id: string;
  technical_bucket: "all" | TechnicalBucket;
  knowledge_category: "all" | KnowledgeCategory;
  classification_state: "all" | ClassificationState;
};

const DEFAULT_FILTERS: Filters = {
  search: "",
  extension: "all",
  duplicate: "all",
  processing_status: "all",
  discovery_status: "all",
  technical_bucket: "all",
  knowledge_category: "all",
  classification_state: "all",
  source_root_id: "all"
};

export default function ArchiveInventoryTable({
  extensionOptions,
  scanRuns
}: {
  extensionOptions: { value: string; label: string }[];
  scanRuns: ScanRun[];
}) {
  const [files, setFiles] = useState<ArchiveFileRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [sortField, setSortField] = useState<ArchiveFileSortField>("filename");
  const [sortOrder, setSortOrder] = useState<ArchiveFileSortOrder>("asc");

  const [sourceRootOptions, setSourceRootOptions] = useState<{ value: number; label: string }[]>([]);
  const [processingStatusOptions, setProcessingStatusOptions] = useState<{ value: string; label: string }[]>([]);

  const [selectedFile, setSelectedFile] = useState<ArchiveFileRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [showScanHistory, setShowScanHistory] = useState(false);

  const [reviewCategory, setReviewCategory] = useState<KnowledgeCategory>("UNKNOWN");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [roots, statuses] = await Promise.all([
          loadSourceRootOptions(),
          loadProcessingStatusOptions()
        ]);
        if (!cancelled) {
          setSourceRootOptions(roots);
          setProcessingStatusOptions(statuses);
        }
      } catch {
        // Filter option lists are a convenience, not core data; a failure
        // here should not block the main inventory table from rendering.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      setFilters((previous) => ({ ...previous, search: searchInput }));
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const result = await loadArchiveFiles({
          search: filters.search || undefined,
          extension: filters.extension === "all" ? undefined : filters.extension,
          duplicate: filters.duplicate,
          processing_status: filters.processing_status === "all" ? undefined : filters.processing_status,
          discovery_status: filters.discovery_status,
          source_root_id: filters.source_root_id === "all" ? undefined : Number(filters.source_root_id),
          technical_bucket: filters.technical_bucket === "all" ? undefined : filters.technical_bucket,
          knowledge_category: filters.knowledge_category === "all" ? undefined : filters.knowledge_category,
          classification_state: filters.classification_state === "all" ? undefined : filters.classification_state,
          page,
          limit: PAGE_SIZE,
          sortField,
          sortOrder
        });
        if (!cancelled) {
          setFiles(result.items);
          setTotal(result.total);
        }
      } catch {
        if (!cancelled) {
          setLoadError("Impossible de charger l'inventaire pour le moment.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters, page, sortField, sortOrder]);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setSearchInput("");
    setPage(1);
  }

  function toggleSort(field: ArchiveFileSortField) {
    if (field === sortField) {
      setSortOrder((previous) => (previous === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  async function openDetail(file: ArchiveFileRecord) {
    setShowDetail(true);
    setDetailLoading(true);
    setSelectedFile(null);
    setReviewError(null);
    setReviewReason("");
    try {
      const detail = await loadFileDetails(file.id);
      const resolved = detail ?? file;
      setSelectedFile(resolved);
      setReviewCategory(resolved.knowledge_category ?? "UNKNOWN");
    } catch {
      setSelectedFile(file);
      setReviewCategory(file.knowledge_category ?? "UNKNOWN");
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitReview(nextState: "VALIDATED" | "NEEDS_REVIEW") {
    if (!selectedFile) {
      return;
    }
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      await reviewArchiveFileClassification({
        archiveFileId: selectedFile.id,
        knowledgeCategory: reviewCategory,
        classificationState: nextState,
        reason: reviewReason || undefined
      });
      const refreshed = await loadFileDetails(selectedFile.id);
      if (refreshed) {
        setSelectedFile(refreshed);
      }
      setFiles((previous) =>
        previous.map((item) =>
          item.id === selectedFile.id && refreshed ? refreshed : item
        )
      );
    } catch {
      setReviewError("La revision n'a pas pu etre enregistree.");
    } finally {
      setReviewSubmitting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasActiveFilters =
    filters.search !== "" ||
    filters.extension !== "all" ||
    filters.duplicate !== "all" ||
    filters.processing_status !== "all" ||
    filters.discovery_status !== "all" ||
    filters.source_root_id !== "all" ||
    filters.technical_bucket !== "all" ||
    filters.knowledge_category !== "all" ||
    filters.classification_state !== "all";

  return (
    <div className="stack">
      <section className="toolbar-card">
        <div className="toolbar-grid">
          <label className="toolbar-field field-span-2">
            <span>Recherche</span>
            <input
              className="input"
              value={searchInput}
              placeholder="Nom de fichier ou chemin relatif"
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>

          <label className="toolbar-field">
            <span>Extension</span>
            <select
              className="select"
              value={filters.extension}
              onChange={(event) => updateFilter("extension", event.target.value)}
            >
              <option value="all">Toutes</option>
              {extensionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="toolbar-field">
            <span>Doublons</span>
            <select
              className="select"
              value={filters.duplicate}
              onChange={(event) => updateFilter("duplicate", event.target.value as Filters["duplicate"])}
            >
              <option value="all">Tous</option>
              <option value="duplicate">Doublons uniquement</option>
              <option value="unique">Uniques uniquement</option>
            </select>
          </label>

          <label className="toolbar-field">
            <span>Statut de traitement</span>
            <select
              className="select"
              value={filters.processing_status}
              onChange={(event) => updateFilter("processing_status", event.target.value)}
            >
              <option value="all">Tous</option>
              {processingStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="toolbar-field">
            <span>Decouverte</span>
            <select
              className="select"
              value={filters.discovery_status}
              onChange={(event) => updateFilter("discovery_status", event.target.value as Filters["discovery_status"])}
            >
              <option value="all">Toutes</option>
              <option value="discovered">Decouvert</option>
              <option value="hashed">Hache</option>
              <option value="failed">Echec</option>
            </select>
          </label>

          <label className="toolbar-field">
            <span>Source</span>
            <select
              className="select"
              value={filters.source_root_id}
              onChange={(event) => updateFilter("source_root_id", event.target.value)}
            >
              <option value="all">Toutes les sources</option>
              {sourceRootOptions.map((option) => (
                <option key={option.value} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="toolbar-field">
            <span>Type technique</span>
            <select
              className="select"
              value={filters.technical_bucket}
              onChange={(event) => updateFilter("technical_bucket", event.target.value as Filters["technical_bucket"])}
            >
              <option value="all">Tous</option>
              {TECHNICAL_BUCKETS.map((bucket) => (
                <option key={bucket} value={bucket}>
                  {TECHNICAL_BUCKET_LABEL[bucket]}
                </option>
              ))}
            </select>
          </label>

          <label className="toolbar-field">
            <span>Categorie</span>
            <select
              className="select"
              value={filters.knowledge_category}
              onChange={(event) => updateFilter("knowledge_category", event.target.value as Filters["knowledge_category"])}
            >
              <option value="all">Toutes</option>
              {KNOWLEDGE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {KNOWLEDGE_CATEGORY_LABEL[category]}
                </option>
              ))}
            </select>
          </label>

          <label className="toolbar-field">
            <span>Statut de classification</span>
            <select
              className="select"
              value={filters.classification_state}
              onChange={(event) => updateFilter("classification_state", event.target.value as Filters["classification_state"])}
            >
              <option value="all">Tous</option>
              {CLASSIFICATION_STATES.map((state) => (
                <option key={state} value={state}>
                  {CLASSIFICATION_STATE_LABEL[state]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="button button-ghost"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
          >
            Reinitialiser les filtres
          </button>
        </div>
      </section>

      {loadError ? <div className="callout warning">{loadError}</div> : null}

      {!isLoading && files.length === 0 ? (
        <EmptyState
          compact
          title="Aucun fichier catalogue"
          description={
            hasActiveFilters
              ? "Aucun fichier ne correspond aux filtres actuellement selectionnes."
              : "Aucun scan n'a encore ete execute pour cette source."
          }
        />
      ) : (
        <section className="data-card table-shell">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  {SORTABLE_COLUMNS.map((column) => (
                    <th key={column.field}>
                      <button
                        type="button"
                        className="table-sort-button"
                        onClick={() => toggleSort(column.field)}
                        aria-sort={sortField === column.field ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
                      >
                        {column.label}
                        {sortField === column.field ? (sortOrder === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                  <th>Dossier</th>
                  <th>Type</th>
                  <th>Statut</th>
                  <th>Type technique</th>
                  <th>Categorie</th>
                  <th>Classification</th>
                  <th>Confiance</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={11}>Chargement...</td>
                  </tr>
                ) : (
                  files.map((file) => (
                    <tr key={file.id} className="table-row-clickable" onClick={() => void openDetail(file)}>
                      <td>
                        <div className="table-primary-cell">
                          <strong>{file.filename}</strong>
                        </div>
                      </td>
                      <td>{formatBytes(file.size_bytes)}</td>
                      <td>{formatDate(file.modified_at)}</td>
                      <td>
                        {file.duplicate_count > 1 ? (
                          <StatusBadge tone="warning" label={`${file.duplicate_count} copies`} />
                        ) : (
                          <StatusBadge tone="neutral" label="Unique" />
                        )}
                      </td>
                      <td className="table-secondary-cell">{file.parent_folder || "."}</td>
                      <td className="table-secondary-cell">{file.extension ? file.extension.toUpperCase() : "-"}</td>
                      <td>
                        <StatusBadge
                          tone={
                            file.discovery_status === "failed"
                              ? "danger"
                              : file.discovery_status === "hashed"
                                ? "success"
                                : "neutral"
                          }
                          label={DISCOVERY_STATUS_LABEL[file.discovery_status]}
                        />
                      </td>
                      <td className="table-secondary-cell">
                        {file.technical_bucket ? TECHNICAL_BUCKET_LABEL[file.technical_bucket] : "-"}
                      </td>
                      <td className="table-secondary-cell">
                        {file.knowledge_category ? KNOWLEDGE_CATEGORY_LABEL[file.knowledge_category] : "-"}
                      </td>
                      <td>
                        <StatusBadge
                          tone={CLASSIFICATION_STATE_TONE[file.classification_state]}
                          label={CLASSIFICATION_STATE_LABEL[file.classification_state]}
                        />
                      </td>
                      <td className="table-secondary-cell">
                        {file.classification_confidence != null
                          ? `${Math.round(file.classification_confidence * 100)}%`
                          : "-"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination-bar" aria-label="Pagination des resultats">
            <span className="pagination-summary">
              {total > 0
                ? `${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} sur ${total}`
                : "Aucun resultat"}
            </span>
            <div className="pagination-controls">
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
              >
                Precedent
              </button>
              <span>
                Page {page} / {totalPages}
              </span>
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
              >
                Suivant
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="data-card">
        <div className="section-header">
          <h3 className="section-title">Historique des scans</h3>
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => setShowScanHistory((value) => !value)}
          >
            {showScanHistory ? "Masquer" : "Afficher"}
          </button>
        </div>
        {showScanHistory ? (
          scanRuns.length === 0 ? (
            <div className="section-body">
              <p>Aucun scan n'a encore ete enregistre.</p>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Debut</th>
                    <th>Fin</th>
                    <th>Statut</th>
                    <th>Vus</th>
                    <th>Nouveaux</th>
                    <th>Inchanges</th>
                    <th>Modifies</th>
                    <th>Echecs</th>
                    <th>Doublons</th>
                  </tr>
                </thead>
                <tbody>
                  {scanRuns.map((run) => (
                    <tr key={run.id}>
                      <td>{formatDate(run.started_at)}</td>
                      <td>{run.completed_at ? formatDate(run.completed_at) : "-"}</td>
                      <td>
                        <StatusBadge
                          tone={run.status === "failed" ? "danger" : run.status === "completed" ? "success" : "neutral"}
                          label={run.status}
                        />
                      </td>
                      <td>{run.files_seen.toLocaleString("fr-FR")}</td>
                      <td>{run.files_new.toLocaleString("fr-FR")}</td>
                      <td>{run.files_unchanged.toLocaleString("fr-FR")}</td>
                      <td>{run.files_changed.toLocaleString("fr-FR")}</td>
                      <td>{run.files_failed.toLocaleString("fr-FR")}</td>
                      <td>{run.duplicate_files.toLocaleString("fr-FR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </section>

      {showDetail ? (
        <div className="fci-dialog-backdrop" role="presentation" onClick={() => setShowDetail(false)}>
          <div
            className="fci-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-file-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fci-dialog-header">
              <h3 id="archive-file-detail-title">Details du fichier</h3>
              <p>Metadonnees uniquement - aucun apercu ni telechargement.</p>
            </div>

            {detailLoading || !selectedFile ? (
              <p>Chargement...</p>
            ) : (
              <div className="stack">
                <p><strong>Nom :</strong> {selectedFile.filename}</p>
                <p><strong>Chemin relatif :</strong> {selectedFile.relative_path}</p>
                <p><strong>Dossier parent :</strong> {selectedFile.parent_folder || "."}</p>
                <p><strong>Extension :</strong> {selectedFile.extension || "-"}</p>
                <p><strong>Taille :</strong> {formatBytes(selectedFile.size_bytes)}</p>
                <p><strong>Modifie :</strong> {formatDate(selectedFile.modified_at)}</p>
                <p><strong>SHA256 :</strong> {selectedFile.sha256 || "Non calcule"}</p>
                <p><strong>Doublons :</strong> {selectedFile.duplicate_count > 1 ? `${selectedFile.duplicate_count} fichiers partagent ce contenu` : "Aucun"}</p>
                <p><strong>Statut de decouverte :</strong> {DISCOVERY_STATUS_LABEL[selectedFile.discovery_status]}</p>
                <p><strong>Statut de traitement :</strong> {selectedFile.processing_status}</p>
                <p><strong>Premiere detection :</strong> {formatDate(selectedFile.first_seen_at)}</p>
                <p><strong>Derniere detection :</strong> {formatDate(selectedFile.last_seen_at)}</p>

                <div className="section-header">
                  <h4 className="section-title">Classification (Phase 2)</h4>
                </div>
                <p>
                  <strong>Type technique :</strong>{" "}
                  {selectedFile.technical_bucket ? TECHNICAL_BUCKET_LABEL[selectedFile.technical_bucket] : "Non evalue"}
                </p>
                <p>
                  <strong>Categorie proposee :</strong>{" "}
                  {selectedFile.knowledge_category ? KNOWLEDGE_CATEGORY_LABEL[selectedFile.knowledge_category] : "Aucune"}
                </p>
                <p>
                  <strong>Statut :</strong>{" "}
                  <StatusBadge
                    tone={CLASSIFICATION_STATE_TONE[selectedFile.classification_state]}
                    label={CLASSIFICATION_STATE_LABEL[selectedFile.classification_state]}
                  />
                </p>
                <p>
                  <strong>Methode :</strong> {selectedFile.classification_method ?? "-"}
                  {selectedFile.classification_confidence != null
                    ? ` (confiance ${Math.round(selectedFile.classification_confidence * 100)}%)`
                    : ""}
                </p>
                {selectedFile.classification_reason ? (
                  <p><strong>Motif :</strong> {selectedFile.classification_reason}</p>
                ) : null}
                {selectedFile.reviewed_at ? (
                  <p><strong>Revise le :</strong> {formatDate(selectedFile.reviewed_at)}</p>
                ) : null}

                <div className="section-header">
                  <h4 className="section-title">Revision humaine</h4>
                </div>
                <label className="toolbar-field">
                  <span>Categorie</span>
                  <select
                    className="select"
                    value={reviewCategory}
                    onChange={(event) => setReviewCategory(event.target.value as KnowledgeCategory)}
                    disabled={reviewSubmitting}
                  >
                    {KNOWLEDGE_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {KNOWLEDGE_CATEGORY_LABEL[category]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="toolbar-field">
                  <span>Motif (optionnel)</span>
                  <input
                    className="input"
                    value={reviewReason}
                    onChange={(event) => setReviewReason(event.target.value)}
                    disabled={reviewSubmitting}
                  />
                </label>
                {reviewError ? <div className="callout warning">{reviewError}</div> : null}
                <div className="fci-dialog-actions">
                  <button
                    type="button"
                    className="button button-ghost"
                    disabled={reviewSubmitting}
                    onClick={() => void submitReview("NEEDS_REVIEW")}
                  >
                    Marquer a revoir
                  </button>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={reviewSubmitting}
                    onClick={() => void submitReview("VALIDATED")}
                  >
                    Valider
                  </button>
                </div>
              </div>
            )}

            <div className="fci-dialog-actions">
              <button type="button" className="button button-primary" onClick={() => setShowDetail(false)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
