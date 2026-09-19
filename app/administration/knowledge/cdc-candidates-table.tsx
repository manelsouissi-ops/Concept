"use client";

import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { formatDate } from "@/lib/utils/format.ts";
import type { BadgeTone } from "@/lib/appels-offres/presentation.ts";
import {
  DETECTED_ROLES,
  STRUCTURAL_BANDS,
  REVIEW_PRIORITIES,
  PROCESSING_GROUPS,
  VALIDATION_STATUSES,
  type CdcCandidateRecord,
  type CdcCandidateSortField,
  type CdcCandidateSortOrder,
  type DetectedRole,
  type StructuralBand,
  type ReviewPriority,
  type ProcessingGroup,
  type CandidateValidationStatus
} from "@/lib/archive-cartography/cdc-review.ts";
import { loadCdcCandidates, loadCdcCandidateDetail } from "./cdc-review-actions.ts";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

const VALIDATION_STATUS_LABEL: Record<string, string> = {
  MACHINE_CLASSIFIED: "A revoir",
  HUMAN_VALIDATED_CDC: "Valide",
  HUMAN_REJECTED_CDC: "Rejete"
};

const VALIDATION_STATUS_TONE: Record<string, BadgeTone> = {
  MACHINE_CLASSIFIED: "warning",
  HUMAN_VALIDATED_CDC: "success",
  HUMAN_REJECTED_CDC: "danger"
};

const PROCESSING_GROUP_LABEL: Record<ProcessingGroup, string> = {
  PRIORITAIRE_2020_2026: "Prioritaire (2020-2026)",
  SECONDAIRE_AVANT_2020: "Secondaire (avant 2020)",
  EXCLU: "Exclu",
  A_REVOIR: "A revoir"
};

const PROCESSING_GROUP_TONE: Record<ProcessingGroup, BadgeTone> = {
  PRIORITAIRE_2020_2026: "ai",
  SECONDAIRE_AVANT_2020: "info",
  EXCLU: "danger",
  A_REVOIR: "warning"
};

const REVIEW_PRIORITY_LABEL: Record<string, string> = {
  HIGH_PRIORITY: "Haute",
  MEDIUM_PRIORITY: "Moyenne",
  EXTRACTION_FAILED: "Échec d’inspection initiale"
};

const EXTRACTION_STATUS_LABEL: Record<string, string> = {
  NOT_ATTEMPTED: "Inspection non réalisée",
  SUCCESS: "Inspection réussie",
  FAILED: "Inspection échouée"
};

const SORTABLE_COLUMNS: { field: CdcCandidateSortField; label: string }[] = [
  { field: "year", label: "Annee" },
  { field: "detected_role", label: "Role detecte" },
  { field: "structural_band", label: "Bande structurelle" },
  { field: "review_priority", label: "Priorite" },
  { field: "validation_status", label: "Statut" },
  { field: "reviewed_at", label: "Revu le" }
];

type Filters = {
  search: string;
  validationStatus: "all" | CandidateValidationStatus;
  processingGroup: "all" | ProcessingGroup;
  detectedRole: "all" | DetectedRole;
  structuralBand: "all" | StructuralBand;
  reviewPriority: "all" | ReviewPriority;
};

const DEFAULT_FILTERS: Filters = {
  search: "",
  validationStatus: "all",
  processingGroup: "all",
  detectedRole: "all",
  structuralBand: "all",
  reviewPriority: "all"
};

export default function CdcCandidatesTable({ initialUncertainOnly = false }: { initialUncertainOnly?: boolean }) {
  const [candidates, setCandidates] = useState<CdcCandidateRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(
    initialUncertainOnly ? { ...DEFAULT_FILTERS, processingGroup: "A_REVOIR" } : DEFAULT_FILTERS
  );
  const [searchInput, setSearchInput] = useState("");
  const [sortField, setSortField] = useState<CdcCandidateSortField>("reviewed_at");
  const [sortOrder, setSortOrder] = useState<CdcCandidateSortOrder>("desc");

  const [selectedCandidate, setSelectedCandidate] = useState<CdcCandidateRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

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
        const result = await loadCdcCandidates({
          search: filters.search || undefined,
          validationStatus: filters.validationStatus === "all" ? undefined : filters.validationStatus,
          processingGroup: filters.processingGroup === "all" ? undefined : filters.processingGroup,
          detectedRole: filters.detectedRole === "all" ? undefined : filters.detectedRole,
          structuralBand: filters.structuralBand === "all" ? undefined : filters.structuralBand,
          reviewPriority: filters.reviewPriority === "all" ? undefined : filters.reviewPriority,
          page,
          limit: PAGE_SIZE,
          sortField,
          sortOrder
        });
        if (!cancelled) {
          setCandidates(result.items);
          setTotal(result.total);
        }
      } catch {
        if (!cancelled) {
          setLoadError("Impossible de charger les candidats pour le moment.");
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

  function toggleSort(field: CdcCandidateSortField) {
    if (field === sortField) {
      setSortOrder((previous) => (previous === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  }

  async function openDetail(candidate: CdcCandidateRecord) {
    setShowDetail(true);
    setDetailLoading(true);
    setSelectedCandidate(null);
    try {
      const detail = await loadCdcCandidateDetail(candidate.id);
      setSelectedCandidate(detail ?? candidate);
    } catch {
      setSelectedCandidate(candidate);
    } finally {
      setDetailLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasActiveFilters =
    filters.search !== "" ||
    filters.validationStatus !== "all" ||
    filters.processingGroup !== "all" ||
    filters.detectedRole !== "all" ||
    filters.structuralBand !== "all" ||
    filters.reviewPriority !== "all";

  return (
    <div className="stack">
      <section className="toolbar-card">
        <div className="toolbar-grid">
          <label className="toolbar-field field-span-2">
            <span>Recherche</span>
            <input
              className="input"
              value={searchInput}
              placeholder="Reference de projet"
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>

          <label className="toolbar-field">
            <span>Statut de validation</span>
            <select
              className="select"
              value={filters.validationStatus}
              onChange={(event) => updateFilter("validationStatus", event.target.value as Filters["validationStatus"])}
            >
              <option value="all">Tous</option>
              {VALIDATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {VALIDATION_STATUS_LABEL[status] ?? status}
                </option>
              ))}
            </select>
          </label>

          <label className="toolbar-field">
            <span>Groupe de traitement</span>
            <select
              className="select"
              value={filters.processingGroup}
              onChange={(event) => updateFilter("processingGroup", event.target.value as Filters["processingGroup"])}
            >
              <option value="all">Tous</option>
              {PROCESSING_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {PROCESSING_GROUP_LABEL[group]}
                </option>
              ))}
            </select>
          </label>

          <label className="toolbar-field">
            <span>Role detecte</span>
            <select
              className="select"
              value={filters.detectedRole}
              onChange={(event) => updateFilter("detectedRole", event.target.value as Filters["detectedRole"])}
            >
              <option value="all">Tous</option>
              {DETECTED_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>

          <label className="toolbar-field">
            <span>Bande structurelle</span>
            <select
              className="select"
              value={filters.structuralBand}
              onChange={(event) => updateFilter("structuralBand", event.target.value as Filters["structuralBand"])}
            >
              <option value="all">Toutes</option>
              {STRUCTURAL_BANDS.map((band) => (
                <option key={band} value={band}>
                  {band}
                </option>
              ))}
            </select>
          </label>

          <label className="toolbar-field">
            <span>Priorite de revue</span>
            <select
              className="select"
              value={filters.reviewPriority}
              onChange={(event) => updateFilter("reviewPriority", event.target.value as Filters["reviewPriority"])}
            >
              <option value="all">Toutes</option>
              {REVIEW_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {REVIEW_PRIORITY_LABEL[priority] ?? priority}
                </option>
              ))}
            </select>
          </label>

          <button type="button" className="button button-ghost" onClick={clearFilters} disabled={!hasActiveFilters}>
            Reinitialiser les filtres
          </button>
        </div>
      </section>

      {loadError ? <div className="callout warning">{loadError}</div> : null}

      {!isLoading && candidates.length === 0 ? (
        <EmptyState
          compact
          title="Aucun candidat"
          description={
            hasActiveFilters
              ? "Aucun candidat ne correspond aux filtres actuellement selectionnes."
              : "Aucun candidat CDC n'a encore ete enregistre."
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
                  <th>Groupe de traitement</th>
                  <th>Inspection initiale</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={8}>Chargement...</td>
                  </tr>
                ) : (
                  candidates.map((candidate) => (
                    <tr
                      key={candidate.id}
                      className="table-row-clickable"
                      onClick={() => void openDetail(candidate)}
                    >
                      <td>{candidate.year ?? "-"}</td>
                      <td className="table-secondary-cell">{candidate.detectedRole}</td>
                      <td className="table-secondary-cell">{candidate.structuralBand}</td>
                      <td className="table-secondary-cell">
                        {candidate.reviewPriority ? REVIEW_PRIORITY_LABEL[candidate.reviewPriority] ?? candidate.reviewPriority : "-"}
                      </td>
                      <td>
                        <StatusBadge
                          tone={VALIDATION_STATUS_TONE[candidate.validationStatus] ?? "neutral"}
                          label={VALIDATION_STATUS_LABEL[candidate.validationStatus] ?? candidate.validationStatus}
                        />
                      </td>
                      <td className="table-secondary-cell">{candidate.reviewedAt ? formatDate(candidate.reviewedAt) : "-"}</td>
                      <td>
                        <StatusBadge
                          tone={PROCESSING_GROUP_TONE[candidate.processingGroup]}
                          label={PROCESSING_GROUP_LABEL[candidate.processingGroup]}
                        />
                      </td>
                      <td className="table-secondary-cell">
                        {EXTRACTION_STATUS_LABEL[candidate.extractionStatus] ?? candidate.extractionStatus}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination-bar" aria-label="Pagination des resultats">
            <span className="pagination-summary">
              {total > 0 ? `${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} sur ${total}` : "Aucun resultat"}
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

      {showDetail ? (
        <div className="fci-dialog-backdrop" role="presentation" onClick={() => setShowDetail(false)}>
          <div
            className="fci-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cdc-candidate-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="fci-dialog-header">
              <h3 id="cdc-candidate-detail-title">Details du candidat CDC</h3>
              <p>Lecture seule - metadonnees uniquement, aucun apercu ni telechargement de document.</p>
            </div>

            {detailLoading || !selectedCandidate ? (
              <p>Chargement...</p>
            ) : (
              <div className="stack">
                <p><strong>Annee :</strong> {selectedCandidate.year ?? "Non renseignee"}</p>
                <p><strong>Reference projet :</strong> {selectedCandidate.projectReference ?? "-"}</p>
                <p><strong>Role detecte :</strong> {selectedCandidate.detectedRole}</p>
                <p><strong>Bande structurelle :</strong> {selectedCandidate.structuralBand}</p>
                <p>
                  <strong>Confiance :</strong>{" "}
                  {selectedCandidate.confidence != null ? `${Math.round(selectedCandidate.confidence * 100)}%` : "-"}
                </p>
                <p>
                  <strong>Priorite de revue :</strong>{" "}
                  {selectedCandidate.reviewPriority
                    ? REVIEW_PRIORITY_LABEL[selectedCandidate.reviewPriority] ?? selectedCandidate.reviewPriority
                    : "-"}
                </p>

                <div className="section-header">
                  <h4 className="section-title">Validation humaine</h4>
                </div>
                <p>
                  <strong>Decision :</strong>{" "}
                  <StatusBadge
                    tone={VALIDATION_STATUS_TONE[selectedCandidate.validationStatus] ?? "neutral"}
                    label={VALIDATION_STATUS_LABEL[selectedCandidate.validationStatus] ?? selectedCandidate.validationStatus}
                  />
                </p>
                <p>
                  <strong>Groupe de traitement :</strong>{" "}
                  <StatusBadge
                    tone={PROCESSING_GROUP_TONE[selectedCandidate.processingGroup]}
                    label={PROCESSING_GROUP_LABEL[selectedCandidate.processingGroup]}
                  />
                </p>
                <p><strong>Revu le :</strong> {selectedCandidate.reviewedAt ? formatDate(selectedCandidate.reviewedAt) : "Non revu"}</p>
                <p>
                  <strong>Rattache a un lot de revue :</strong>{" "}
                  {selectedCandidate.humanReviewImportBatchId ? "Oui" : "Non"}
                </p>
                {selectedCandidate.isKnownUncertain ? (
                  <div className="callout warning">
                    À revoir — décision incertaine lors de la revue humaine. Non rejeté, non approuvé. Aucune extraction des 21 critères n'est planifiée.
                  </div>
                ) : null}

                <div className="section-header">
                  <h4 className="section-title">Inspection initiale</h4>
                </div>
                <p>
                  <strong>Statut d’inspection :</strong>{" "}
                  {EXTRACTION_STATUS_LABEL[selectedCandidate.extractionStatus] ?? selectedCandidate.extractionStatus}
                </p>
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
