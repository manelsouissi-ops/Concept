// CDC human-review dashboard - shared types and pure, database-free logic
// (processing-group derivation, filter/sort/page sanitization, parameterized
// WHERE-clause construction, row mapping, error sanitization). Contains no
// database access, no filesystem access, and no AI call - see
// app/administration/knowledge/cdc-review-actions.ts for the "use server"
// layer that actually runs these queries against
// knowledge_base.historical_technical_source_candidates /
// knowledge_base.historical_technical_source_import_batches.
//
// This module is READ-ONLY by construction: nothing here builds an INSERT,
// UPDATE, DELETE, or DDL statement.

export const VALIDATION_STATUSES = [
  "MACHINE_CLASSIFIED",
  "HUMAN_VALIDATED_CDC",
  "HUMAN_REJECTED_CDC"
] as const;

export type CandidateValidationStatus = (typeof VALIDATION_STATUSES)[number] | (string & {});

export const DETECTED_ROLES = [
  "CDC",
  "TDR",
  "DAO_WITH_TDR",
  "DAO_WITH_CDC",
  "DAO",
  "DCE",
  "RFP",
  "OFFER",
  "REPORT",
  "METHODOLOGY",
  "OTHER",
  "UNKNOWN"
] as const;
export type DetectedRole = (typeof DETECTED_ROLES)[number];

export const STRUCTURAL_BANDS = [
  "STRONG_TECHNICAL_SOURCE",
  "POSSIBLE_TECHNICAL_SOURCE",
  "WEAK_TECHNICAL_SOURCE"
] as const;
export type StructuralBand = (typeof STRUCTURAL_BANDS)[number];

export const REVIEW_PRIORITIES = ["HIGH_PRIORITY", "MEDIUM_PRIORITY", "EXTRACTION_FAILED"] as const;
export type ReviewPriority = (typeof REVIEW_PRIORITIES)[number];

export const EXTRACTION_STATUSES = ["NOT_ATTEMPTED", "SUCCESS", "FAILED"] as const;
export type CandidateExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

// The confirmed business rule: a validated CDC dated 2020-2026 is
// processed with higher priority than an older one. Same bounds as the
// offline importer's own RECENT_YEAR_MIN/RECENT_YEAR_MAX
// (services/knowledge-base/cdc_review_import_preview.py).
export const RECENT_YEAR_MIN = 2020;
export const RECENT_YEAR_MAX = 2026;

export const PROCESSING_GROUPS = [
  "PRIORITAIRE_2020_2026",
  "SECONDAIRE_AVANT_2020",
  "EXCLU",
  "A_REVOIR"
] as const;
export type ProcessingGroup = (typeof PROCESSING_GROUPS)[number];

/**
 * Pure derivation, no database. Mirrors the already-applied import's own
 * classification (services/knowledge-base/cdc_review_importer.py):
 *   HUMAN_VALIDATED_CDC + year in [2020, 2026] -> PRIORITAIRE_2020_2026
 *   HUMAN_VALIDATED_CDC + year < 2020           -> SECONDAIRE_AVANT_2020
 *   HUMAN_REJECTED_CDC (any year)                -> EXCLU
 *   anything else (MACHINE_CLASSIFIED - the 2 INCERTAIN rows today, or any
 *   candidate that has not gone through this review round at all) -> A_REVOIR
 *
 * A_REVOIR is deliberately the catch-all, not a MACHINE_CLASSIFIED-specific
 * branch: this function never asserts that MACHINE_CLASSIFIED means
 * "one of Youssef's two uncertain rows" - see isKnownUncertainCandidate()
 * below and the "Uncertain-candidate treatment" section of the audit report
 * for why that distinction matters and what evidence it actually rests on.
 */
export function computeProcessingGroup(
  validationStatus: CandidateValidationStatus,
  year: number | null
): ProcessingGroup {
  if (validationStatus === "HUMAN_REJECTED_CDC") {
    return "EXCLU";
  }
  if (validationStatus === "HUMAN_VALIDATED_CDC") {
    if (year != null && year >= RECENT_YEAR_MIN && year <= RECENT_YEAR_MAX) {
      return "PRIORITAIRE_2020_2026";
    }
    return "SECONDAIRE_AVANT_2020";
  }
  return "A_REVOIR";
}

/**
 * Whether a candidate is one of the two rows this review round explicitly
 * left unresolved (workbook decision "INCERTAIN"), as opposed to a
 * candidate that has simply never gone through any human-review import at
 * all. The importer NEVER writes anything for an INCERTAIN row - by
 * design, it is never locked, never updated, never linked to a batch (see
 * execute_import()'s skipped_pairs handling) - so there is no column that
 * directly records "this row was seen and marked INCERTAIN".
 *
 * The only currently-available, verifiable distinguishing signal is
 * indirect: this candidate's validation_status is still MACHINE_CLASSIFIED
 * AND it belongs to the archive-file population that a completed human-
 * review batch's total_count covers. That is a genuine limitation, not a
 * guess dressed up as certainty - see the audit report's "Uncertain-
 * candidate treatment" section. It happens to be exact today because the
 * one completed batch's total_count (750) equals the entire candidates
 * table's row count, but it would mislabel a future candidate added to
 * this table without going through a linked review batch.
 */
export function isKnownUncertainCandidate(input: {
  validationStatus: CandidateValidationStatus;
  humanReviewImportBatchId: string | number | null;
}): boolean {
  return input.validationStatus === "MACHINE_CLASSIFIED" && input.humanReviewImportBatchId == null;
}

// ---------------------------------------------------------------------
// Records / query shapes
// ---------------------------------------------------------------------

export type CdcCandidateRecord = {
  id: string;
  year: number | null;
  projectReference: string | null;
  detectedRole: DetectedRole | string;
  structuralBand: StructuralBand | string;
  confidence: number | null;
  reviewPriority: ReviewPriority | string | null;
  validationStatus: CandidateValidationStatus;
  processingGroup: ProcessingGroup;
  extractionStatus: CandidateExtractionStatus | string;
  reviewedAt: string | null;
  humanReviewImportBatchId: string | null;
  isKnownUncertain: boolean;
};

export type CdcReviewSummary = {
  total: number;
  validated: number;
  rejected: number;
  unresolved: number;
  recentUsable: number;
  olderUsable: number;
  linkedToCompletedBatch: number;
};

export type CdcImportBatchRecord = {
  id: string;
  status: string;
  reviewerType: string;
  externalReviewerLabel: string | null;
  startedAt: string;
  completedAt: string | null;
  totalCount: number;
  usableCount: number;
  excludedCount: number;
  skippedUncertainCount: number;
  updatedCount: number;
  sourceWorkbookFingerprint: string;
};

export type CdcCandidateSortField =
  | "year"
  | "detected_role"
  | "structural_band"
  | "review_priority"
  | "validation_status"
  | "reviewed_at";
export type CdcCandidateSortOrder = "asc" | "desc";

export type CdcCandidateFilters = {
  search?: string;
  validationStatus?: CandidateValidationStatus | "all";
  processingGroup?: ProcessingGroup | "all";
  yearMin?: number;
  yearMax?: number;
  detectedRole?: DetectedRole | "all";
  structuralBand?: StructuralBand | "all";
  reviewPriority?: ReviewPriority | "all";
};

export type CdcCandidateQuery = CdcCandidateFilters & {
  page?: number;
  limit?: number;
  sortField?: CdcCandidateSortField;
  sortOrder?: CdcCandidateSortOrder;
};

export type CdcCandidatePage = {
  items: CdcCandidateRecord[];
  total: number;
};

// ---------------------------------------------------------------------
// Sort / page sanitization (allowlist pattern, mirrors
// app/administration/knowledge/actions.ts's ArchiveFileSortField handling)
// ---------------------------------------------------------------------

export const SORTABLE_CANDIDATE_COLUMNS: Record<CdcCandidateSortField, string> = {
  year: "c.year",
  detected_role: "c.detected_role",
  structural_band: "c.structural_band",
  review_priority: "c.review_priority",
  validation_status: "c.validation_status",
  reviewed_at: "c.reviewed_at"
};

export const MAX_CANDIDATE_PAGE_SIZE = 200;
export const DEFAULT_CANDIDATE_PAGE_SIZE = 50;

export function sanitizeCandidatePage(page: unknown): number {
  const value = Number(page);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export function sanitizeCandidateLimit(limit: unknown): number {
  const value = Number(limit);
  if (!Number.isInteger(value) || value <= 0) {
    return DEFAULT_CANDIDATE_PAGE_SIZE;
  }
  return Math.min(value, MAX_CANDIDATE_PAGE_SIZE);
}

export function sanitizeCandidateSortField(field: unknown): CdcCandidateSortField {
  return typeof field === "string" && field in SORTABLE_CANDIDATE_COLUMNS
    ? (field as CdcCandidateSortField)
    : "reviewed_at";
}

export function sanitizeCandidateSortOrder(order: unknown): CdcCandidateSortOrder {
  return order === "asc" ? "asc" : "desc";
}

export function isValidationStatus(value: unknown): value is CandidateValidationStatus {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

export function isProcessingGroup(value: unknown): value is ProcessingGroup {
  return typeof value === "string" && (PROCESSING_GROUPS as readonly string[]).includes(value);
}

export function isDetectedRole(value: unknown): value is DetectedRole {
  return typeof value === "string" && (DETECTED_ROLES as readonly string[]).includes(value);
}

export function isStructuralBand(value: unknown): value is StructuralBand {
  return typeof value === "string" && (STRUCTURAL_BANDS as readonly string[]).includes(value);
}

export function isReviewPriority(value: unknown): value is ReviewPriority {
  return typeof value === "string" && (REVIEW_PRIORITIES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------
// Parameterized WHERE-clause construction - pure string/array building,
// never executed here. Every condition uses a numbered placeholder; no
// filter value is ever concatenated into the SQL text itself. The
// processing-group filter is intentionally expressed with the exact same
// boolean logic as computeProcessingGroup() above, kept in sync by the
// unit test that checks both against the same fixture set.
// ---------------------------------------------------------------------

export function buildCandidateFilterClause(filters: CdcCandidateFilters): {
  whereClause: string;
  params: unknown[];
} {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const search = filters.search?.trim();
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(lower(coalesce(c.project_reference, '')) like $${params.length})`);
  }

  if (filters.validationStatus && filters.validationStatus !== "all" && isValidationStatus(filters.validationStatus)) {
    params.push(filters.validationStatus);
    conditions.push(`c.validation_status = $${params.length}`);
  }

  if (filters.detectedRole && filters.detectedRole !== "all" && isDetectedRole(filters.detectedRole)) {
    params.push(filters.detectedRole);
    conditions.push(`c.detected_role = $${params.length}`);
  }

  if (filters.structuralBand && filters.structuralBand !== "all" && isStructuralBand(filters.structuralBand)) {
    params.push(filters.structuralBand);
    conditions.push(`c.structural_band = $${params.length}`);
  }

  if (filters.reviewPriority && filters.reviewPriority !== "all" && isReviewPriority(filters.reviewPriority)) {
    params.push(filters.reviewPriority);
    conditions.push(`c.review_priority = $${params.length}`);
  }

  if (typeof filters.yearMin === "number" && Number.isInteger(filters.yearMin)) {
    params.push(filters.yearMin);
    conditions.push(`c.year >= $${params.length}`);
  }

  if (typeof filters.yearMax === "number" && Number.isInteger(filters.yearMax)) {
    params.push(filters.yearMax);
    conditions.push(`c.year <= $${params.length}`);
  }

  if (filters.processingGroup && filters.processingGroup !== "all" && isProcessingGroup(filters.processingGroup)) {
    conditions.push(buildProcessingGroupCondition(filters.processingGroup));
  }

  return {
    whereClause: conditions.length > 0 ? `where ${conditions.join(" and ")}` : "",
    params
  };
}

function buildProcessingGroupCondition(group: ProcessingGroup): string {
  switch (group) {
    case "EXCLU":
      return `c.validation_status = 'HUMAN_REJECTED_CDC'`;
    case "PRIORITAIRE_2020_2026":
      return `c.validation_status = 'HUMAN_VALIDATED_CDC' and c.year between ${RECENT_YEAR_MIN} and ${RECENT_YEAR_MAX}`;
    case "SECONDAIRE_AVANT_2020":
      return `c.validation_status = 'HUMAN_VALIDATED_CDC' and (c.year is null or c.year < ${RECENT_YEAR_MIN})`;
    case "A_REVOIR":
      return `c.validation_status not in ('HUMAN_VALIDATED_CDC', 'HUMAN_REJECTED_CDC')`;
    default:
      return "false";
  }
}

// ---------------------------------------------------------------------
// Row mapping - never includes a filesystem path, a document excerpt, or
// a raw hash beyond an explicitly-truncated provenance fingerprint.
// ---------------------------------------------------------------------

export function mapCandidateRow(row: Record<string, unknown>): CdcCandidateRecord {
  const validationStatus = String(row.validation_status) as CandidateValidationStatus;
  const year = row.year == null ? null : Number(row.year);
  const humanReviewImportBatchId = row.human_review_import_batch_id == null ? null : String(row.human_review_import_batch_id);

  return {
    id: String(row.id),
    year,
    projectReference: row.project_reference == null ? null : String(row.project_reference),
    detectedRole: String(row.detected_role),
    structuralBand: String(row.structural_band),
    confidence: row.confidence == null ? null : Number(row.confidence),
    reviewPriority: row.review_priority == null ? null : String(row.review_priority),
    validationStatus,
    processingGroup: computeProcessingGroup(validationStatus, year),
    extractionStatus: String(row.extraction_status ?? "NOT_ATTEMPTED"),
    reviewedAt: row.reviewed_at == null ? null : new Date(row.reviewed_at as string).toISOString(),
    humanReviewImportBatchId,
    isKnownUncertain: isKnownUncertainCandidate({ validationStatus, humanReviewImportBatchId })
  };
}

export function mapImportBatchRow(row: Record<string, unknown>): CdcImportBatchRecord {
  const sha = row.source_workbook_sha256 == null ? "" : String(row.source_workbook_sha256);
  return {
    id: String(row.id),
    status: String(row.status),
    reviewerType: String(row.reviewer_type),
    externalReviewerLabel: row.external_reviewer_label == null ? null : String(row.external_reviewer_label),
    startedAt: new Date(row.started_at as string).toISOString(),
    completedAt: row.completed_at == null ? null : new Date(row.completed_at as string).toISOString(),
    totalCount: Number(row.total_count ?? 0),
    usableCount: Number(row.usable_count ?? 0),
    excludedCount: Number(row.excluded_count ?? 0),
    skippedUncertainCount: Number(row.skipped_uncertain_count ?? 0),
    updatedCount: Number(row.updated_count ?? 0),
    // Abbreviated fingerprint only - the full workbook hash is provenance
    // metadata, not something the dashboard needs to display in full, and
    // this keeps the UI from reading as if it were a document link.
    sourceWorkbookFingerprint: sha ? `${sha.slice(0, 8)}…${sha.slice(-4)}` : ""
  };
}

// ---------------------------------------------------------------------
// Error sanitization - never let a raw driver/SQL error string (which can
// include the connection string, a query fragment, or a constraint name)
// reach the browser.
// ---------------------------------------------------------------------

export function sanitizeRepositoryError(_error: unknown): string {
  return "Impossible de charger les donnees pour le moment.";
}
