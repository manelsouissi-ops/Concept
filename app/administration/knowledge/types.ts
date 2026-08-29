import type {
  ClassificationMethod,
  ClassificationState,
  KnowledgeCategory,
  TechnicalBucket
} from "@/lib/archive-cartography/classification.ts";

export type ArchiveFileRecord = {
  id: number;
  source_root_id: number;
  relative_path: string;
  filename: string;
  extension: string | null;
  parent_folder: string | null;
  size_bytes: number;
  modified_at: string | null;
  sha256: string | null;
  discovery_status: 'discovered' | 'hashed' | 'failed';
  processing_status: string;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
  /**
   * Count of rows (including this one) sharing this file's sha256. Always 0
   * when sha256 is null - a NULL hash must never be treated as a duplicate.
   * Computed server-side; the UI must never re-derive duplicate state from
   * "has a sha256" alone.
   */
  duplicate_count: number;

  /**
   * Phase 2 classification fields. All null/UNCLASSIFIED for a file that has
   * no row yet in knowledge_base.archive_file_classifications - that is the
   * default, expected state for the entire Phase 1 inventory today.
   */
  technical_bucket: TechnicalBucket | null;
  knowledge_category: KnowledgeCategory | null;
  classification_state: ClassificationState;
  classification_method: ClassificationMethod | null;
  classification_confidence: number | null;
  classification_reason: string | null;
  classified_at: string | null;
  reviewed_at: string | null;
};

export type ArchiveFileFilters = {
  search?: string;
  extension?: string;
  duplicate?: 'all' | 'duplicate' | 'unique';
  processing_status?: string;
  discovery_status?: 'all' | 'discovered' | 'hashed' | 'failed';
  source_root_id?: number;
  technical_bucket?: TechnicalBucket;
  knowledge_category?: KnowledgeCategory;
  classification_state?: ClassificationState;
};

export type ArchiveFileReviewInput = {
  archiveFileId: number;
  knowledgeCategory: KnowledgeCategory;
  classificationState: Extract<ClassificationState, 'VALIDATED' | 'NEEDS_REVIEW'>;
  reason?: string;
};

export type ArchiveFileSortField = 'filename' | 'size_bytes' | 'modified_at' | 'duplicate_count';
export type ArchiveFileSortOrder = 'asc' | 'desc';

export type ArchiveFileQuery = ArchiveFileFilters & {
  page?: number;
  limit?: number;
  sortField?: ArchiveFileSortField;
  sortOrder?: ArchiveFileSortOrder;
};

export type ArchiveFilePage = {
  items: ArchiveFileRecord[];
  total: number;
};

export type SourceRoot = {
  id: number;
  root_path: string;
  label: string | null;
  created_at: string;
};

export type ScanRun = {
  id: number;
  source_root_id: number;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at: string | null;
  files_seen: number;
  files_new: number;
  files_unchanged: number;
  files_changed: number;
  files_failed: number;
  total_bytes: number;
  duplicate_files: number;
  error_message: string | null;
};

export type ArchiveSummary = {
  total_files: number;
  total_bytes: number;
  duplicate_files: number;
  failed_files: number;
  last_scan_date: string | null;
};