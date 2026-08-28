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
};

export type ArchiveFileFilters = {
  search?: string;
  extension?: string;
  duplicate?: 'all' | 'duplicate' | 'unique';
  processing_status?: string;
  discovery_status?: 'all' | 'discovered' | 'hashed' | 'failed';
  source_root_id?: number;
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