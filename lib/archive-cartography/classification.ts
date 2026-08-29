// Phase 2 classification infrastructure - shared types and the deterministic
// technical filter. Deliberately contains no AI, no filesystem access, and
// no database access: see scripts/sql/20260829_archive_cartography_classification.sql
// for the storage side of these value sets.

export const TECHNICAL_BUCKETS = [
  "BUSINESS_DOCUMENT",
  "TECHNICAL_FILE",
  "IMAGE",
  "ARCHIVE",
  "SOFTWARE_SYSTEM",
  "UNKNOWN"
] as const;

export type TechnicalBucket = (typeof TECHNICAL_BUCKETS)[number];

export const KNOWLEDGE_CATEGORIES = [
  "CDC",
  "OFFER",
  "PROJECT",
  "METHODOLOGY",
  "CV_CONSULTANT",
  "COMMERCIAL",
  "FINANCIAL",
  "ADMINISTRATIVE",
  "OTHER",
  "UNKNOWN"
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const CLASSIFICATION_STATES = [
  "UNCLASSIFIED",
  "AUTO_FILTERED",
  "AI_PROPOSED",
  "NEEDS_REVIEW",
  "VALIDATED"
] as const;

export type ClassificationState = (typeof CLASSIFICATION_STATES)[number];

// CLOUD_AI is deliberately not a member of this list (local-only requirement).
export const CLASSIFICATION_METHODS = ["RULE", "LOCAL_AI", "HUMAN"] as const;

export type ClassificationMethod = (typeof CLASSIFICATION_METHODS)[number];

export type ArchiveFileClassification = {
  technical_bucket: TechnicalBucket | null;
  knowledge_category: KnowledgeCategory | null;
  classification_state: ClassificationState;
  classification_method: ClassificationMethod | null;
  classification_confidence: number | null;
  classification_reason: string | null;
  classified_at: string | null;
  reviewed_at: string | null;
};

// Extension sets are a technical pre-filter ONLY. They decide how a file
// should be handled technically (can it even be opened/parsed, is it an
// image, etc.) - they must NEVER be used to decide whether something is a
// CDC, an offer, a CV, etc. That is knowledge_category's job, and it is
// intentionally a separate, independent field.
const BUSINESS_DOCUMENT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "msg", "odt", "ods", "rtf", "txt"
]);

const TECHNICAL_FILE_EXTENSIONS = new Set([
  "dwg", "dxf", "shp", "dbf", "kml", "kmz", "mpp"
]);

const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "tif", "tiff", "bmp", "gif", "webp"
]);

const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z"]);

const SOFTWARE_SYSTEM_EXTENSIONS = new Set([
  "dll", "exe", "js", "css", "config", "manifest"
]);

function normalizeExtension(extension: string | null | undefined): string {
  if (!extension) {
    return "";
  }
  const trimmed = extension.trim().toLowerCase();
  return trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
}

/**
 * Pure, deterministic technical pre-filter. Extension only - never inspects
 * file contents, filename semantics, calls AI, or touches the database.
 * Unknown/ambiguous/empty extensions resolve to UNKNOWN rather than being
 * guessed at.
 */
export function classifyTechnicalBucket(extension: string | null | undefined): TechnicalBucket {
  const normalized = normalizeExtension(extension);
  if (!normalized) {
    return "UNKNOWN";
  }
  if (BUSINESS_DOCUMENT_EXTENSIONS.has(normalized)) {
    return "BUSINESS_DOCUMENT";
  }
  if (TECHNICAL_FILE_EXTENSIONS.has(normalized)) {
    return "TECHNICAL_FILE";
  }
  if (IMAGE_EXTENSIONS.has(normalized)) {
    return "IMAGE";
  }
  if (ARCHIVE_EXTENSIONS.has(normalized)) {
    return "ARCHIVE";
  }
  if (SOFTWARE_SYSTEM_EXTENSIONS.has(normalized)) {
    return "SOFTWARE_SYSTEM";
  }
  return "UNKNOWN";
}

export function isTechnicalBucket(value: string): value is TechnicalBucket {
  return (TECHNICAL_BUCKETS as readonly string[]).includes(value);
}

export function isKnowledgeCategory(value: string): value is KnowledgeCategory {
  return (KNOWLEDGE_CATEGORIES as readonly string[]).includes(value);
}

export function isClassificationState(value: string): value is ClassificationState {
  return (CLASSIFICATION_STATES as readonly string[]).includes(value);
}

export type ClassificationReviewTransition = {
  archiveFileId: number;
  previousKnowledgeCategory: KnowledgeCategory | null;
  newKnowledgeCategory: KnowledgeCategory;
  previousClassificationState: ClassificationState;
  newClassificationState: ClassificationState;
  classificationMethod: ClassificationMethod;
  reason: string | null;
  reviewedByUserId: number | null;
};

/**
 * Pure computation of a classification review event from a before/after
 * snapshot. Kept separate from any database access so the exact traceability
 * fields (previous vs new category/state) can be verified with synthetic
 * inputs alone - no DB connection required. The actual read-current/
 * upsert-current/insert-event transaction lives in
 * app/administration/knowledge/actions.ts and calls this helper once it has
 * read the current row inside its transaction.
 */
export function buildClassificationReviewEvent(input: {
  archiveFileId: number;
  previousKnowledgeCategory: KnowledgeCategory | null;
  previousClassificationState: ClassificationState | null;
  newKnowledgeCategory: KnowledgeCategory;
  newClassificationState: Extract<ClassificationState, "VALIDATED" | "NEEDS_REVIEW">;
  reason?: string | null;
  reviewedByUserId: number | null;
}): ClassificationReviewTransition {
  return {
    archiveFileId: input.archiveFileId,
    previousKnowledgeCategory: input.previousKnowledgeCategory,
    newKnowledgeCategory: input.newKnowledgeCategory,
    // A file with no prior classification row is implicitly UNCLASSIFIED -
    // see 20260829_archive_cartography_classification.sql. Recording that
    // explicitly (rather than leaving it NULL) keeps the event's
    // previous/new state columns both NOT NULL and always comparable.
    previousClassificationState: input.previousClassificationState ?? "UNCLASSIFIED",
    newClassificationState: input.newClassificationState,
    classificationMethod: "HUMAN",
    reason: input.reason?.trim() || null,
    reviewedByUserId: input.reviewedByUserId
  };
}

export type TechnicalClassificationSnapshot = {
  technicalBucket: TechnicalBucket | null;
  classificationState: ClassificationState;
  classificationMethod: ClassificationMethod | null;
  classifiedAt: string | null;
} | null;

export type TechnicalBackfillDecision = {
  technicalBucket: TechnicalBucket;
  classificationState: ClassificationState;
  classificationMethod: ClassificationMethod | null;
  /** Whether the write should set classified_at (only true the first time a file is confidently bucketed). */
  classifiedAtShouldBeSet: boolean;
  /** Whether anything actually needs writing - false means the existing row already reflects this decision. */
  changed: boolean;
};

/**
 * Pure decision function for the deterministic technical-bucket backfill
 * (RULE method, extension-only - see
 * scripts/archive_cartography/backfill_technical_buckets.ts). Contains no
 * database or filesystem access so it can be unit-tested with synthetic
 * snapshots alone.
 *
 * Never advances classification_state past AUTO_FILTERED, and never
 * advances it at all once a file has moved beyond UNCLASSIFIED
 * (AI_PROPOSED/NEEDS_REVIEW/VALIDATED, or an AUTO_FILTERED already set by an
 * earlier backfill run) - this is what keeps human review and local-AI
 * proposals intact across reruns. A technical_bucket of UNKNOWN never
 * advances classification_state at all, regardless of its current value.
 */
export function decideTechnicalBackfillWrite(
  extension: string | null | undefined,
  existing: TechnicalClassificationSnapshot
): TechnicalBackfillDecision {
  const technicalBucket = classifyTechnicalBucket(extension);
  const currentState = existing?.classificationState ?? "UNCLASSIFIED";
  const shouldAdvanceState = technicalBucket !== "UNKNOWN" && currentState === "UNCLASSIFIED";

  const classificationState: ClassificationState = shouldAdvanceState ? "AUTO_FILTERED" : currentState;
  const classificationMethod: ClassificationMethod | null = shouldAdvanceState
    ? "RULE"
    : (existing?.classificationMethod ?? null);
  const classifiedAtShouldBeSet = shouldAdvanceState && !existing?.classifiedAt;

  const changed =
    existing == null ||
    existing.technicalBucket !== technicalBucket ||
    existing.classificationState !== classificationState ||
    existing.classificationMethod !== classificationMethod;

  return {
    technicalBucket,
    classificationState,
    classificationMethod,
    classifiedAtShouldBeSet,
    changed
  };
}
