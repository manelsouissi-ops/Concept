"use server";

import { getAdministrationDashboardPool } from "@/lib/administration/dashboard.ts";
import { requireAreaAccessForPage } from "@/lib/auth/server.ts";
import type {
  ArchiveFilePage,
  ArchiveFileQuery,
  ArchiveFileRecord,
  ArchiveFileSortField,
  ArchiveFileSortOrder,
  ArchiveSummary,
  ScanRun
} from "./types.ts";

// Archive Cartography is READ-ONLY: every query in this file is a SELECT
// against knowledge_base.archive_* tables. There is no INSERT/UPDATE/DELETE/
// TRUNCATE anywhere here, no filesystem access, and no call to the scanner.
// The Postgres pool is the shared administration dashboard pool - it is a
// process-lifetime singleton (see getAdministrationDashboardPool), so it is
// never closed here; doing so would break every other admin dashboard query
// in the app for the remainder of the process.

const SORT_COLUMNS: Record<ArchiveFileSortField, string> = {
  filename: "f.filename",
  size_bytes: "f.size_bytes",
  modified_at: "f.modified_at",
  duplicate_count: "duplicate_count"
};

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

function sanitizePage(page: unknown): number {
  const value = Number(page);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function sanitizeLimit(limit: unknown): number {
  const value = Number(limit);
  if (!Number.isInteger(value) || value <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(value, MAX_PAGE_SIZE);
}

function sanitizeSortField(field: unknown): ArchiveFileSortField {
  return typeof field === "string" && field in SORT_COLUMNS
    ? (field as ArchiveFileSortField)
    : "filename";
}

function sanitizeSortOrder(order: unknown): ArchiveFileSortOrder {
  return order === "desc" ? "desc" : "asc";
}

function mapFileRow(row: Record<string, unknown>): ArchiveFileRecord {
  return {
    id: Number(row.id),
    source_root_id: Number(row.source_root_id),
    relative_path: String(row.relative_path),
    filename: String(row.filename),
    extension: row.extension == null ? null : String(row.extension),
    parent_folder: row.parent_folder == null ? null : String(row.parent_folder),
    size_bytes: Number(row.size_bytes),
    modified_at: row.modified_at == null ? null : new Date(row.modified_at as string).toISOString(),
    sha256: row.sha256 == null ? null : String(row.sha256),
    discovery_status: row.discovery_status as ArchiveFileRecord["discovery_status"],
    processing_status: String(row.processing_status),
    first_seen_at: new Date(row.first_seen_at as string).toISOString(),
    last_seen_at: new Date(row.last_seen_at as string).toISOString(),
    updated_at: new Date(row.updated_at as string).toISOString(),
    duplicate_count: Number(row.duplicate_count ?? 0)
  };
}

export async function loadArchiveSummary(): Promise<ArchiveSummary> {
  await requireAreaAccessForPage("archive");
  const pool = getAdministrationDashboardPool();

  const result = await pool.query<{
    total_files: string;
    total_bytes: string | null;
    duplicate_files: string;
    failed_files: string;
    last_scan_date: string | null;
  }>(`
    select
      count(*) as total_files,
      coalesce(sum(f.size_bytes), 0) as total_bytes,
      coalesce(sum(case when dup.hash_count > 1 then 1 else 0 end), 0) as duplicate_files,
      coalesce(sum(case when f.discovery_status = 'failed' then 1 else 0 end), 0) as failed_files,
      (select max(started_at) from knowledge_base.archive_scan_runs) as last_scan_date
    from knowledge_base.archive_files f
    left join (
      select sha256, count(*) as hash_count
      from knowledge_base.archive_files
      where sha256 is not null
      group by sha256
    ) dup on f.sha256 = dup.sha256
  `);

  const row = result.rows[0];
  return {
    total_files: Number(row?.total_files ?? 0),
    total_bytes: Number(row?.total_bytes ?? 0),
    duplicate_files: Number(row?.duplicate_files ?? 0),
    failed_files: Number(row?.failed_files ?? 0),
    last_scan_date: row?.last_scan_date ? new Date(row.last_scan_date).toISOString() : null
  };
}

export async function loadArchiveFiles(query: ArchiveFileQuery = {}): Promise<ArchiveFilePage> {
  await requireAreaAccessForPage("archive");
  const pool = getAdministrationDashboardPool();

  const page = sanitizePage(query.page);
  const limit = sanitizeLimit(query.limit);
  const offset = (page - 1) * limit;
  const sortField = sanitizeSortField(query.sortField);
  const sortOrder = sanitizeSortOrder(query.sortOrder);
  const sortColumn = SORT_COLUMNS[sortField]; // strict whitelist - never interpolate the raw field name itself

  const whereConditions: string[] = [];
  const params: unknown[] = [];

  const search = query.search?.trim();
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    whereConditions.push(`(lower(f.filename) like $${params.length} or lower(f.relative_path) like $${params.length})`);
  }

  if (query.extension && query.extension !== "all") {
    params.push(query.extension);
    whereConditions.push(`f.extension = $${params.length}`);
  }

  if (query.duplicate === "duplicate") {
    whereConditions.push("dup.hash_count > 1");
  } else if (query.duplicate === "unique") {
    whereConditions.push("f.sha256 is not null and dup.hash_count = 1");
  }

  if (query.processing_status && query.processing_status !== "all") {
    params.push(query.processing_status);
    whereConditions.push(`f.processing_status = $${params.length}`);
  }

  if (query.discovery_status && query.discovery_status !== "all") {
    params.push(query.discovery_status);
    whereConditions.push(`f.discovery_status = $${params.length}`);
  }

  if (query.source_root_id !== undefined) {
    params.push(query.source_root_id);
    whereConditions.push(`f.source_root_id = $${params.length}`);
  }

  const whereClause = whereConditions.length > 0 ? `where ${whereConditions.join(" and ")}` : "";

  const cte = `
    with dup as (
      select sha256, count(*) as hash_count
      from knowledge_base.archive_files
      where sha256 is not null
      group by sha256
    )
  `;

  const countResult = await pool.query<{ total: string }>(
    `${cte}
     select count(*) as total
     from knowledge_base.archive_files f
     left join dup on f.sha256 = dup.sha256
     ${whereClause}`,
    params
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  const limitParamIndex = params.length + 1;
  const offsetParamIndex = params.length + 2;

  const filesResult = await pool.query<Record<string, unknown>>(
    `${cte}
     select
       f.id, f.source_root_id, f.relative_path, f.filename, f.extension, f.parent_folder,
       f.size_bytes, f.modified_at, f.sha256, f.discovery_status, f.processing_status,
       f.first_seen_at, f.last_seen_at, f.updated_at,
       coalesce(dup.hash_count, 0) as duplicate_count
     from knowledge_base.archive_files f
     left join dup on f.sha256 = dup.sha256
     ${whereClause}
     order by ${sortColumn} ${sortOrder}, f.id asc
     limit $${limitParamIndex} offset $${offsetParamIndex}`,
    [...params, limit, offset]
  );

  return {
    items: filesResult.rows.map(mapFileRow),
    total
  };
}

export async function loadFileDetails(fileId: number): Promise<ArchiveFileRecord | null> {
  await requireAreaAccessForPage("archive");
  if (!Number.isInteger(fileId) || fileId <= 0) {
    return null;
  }
  const pool = getAdministrationDashboardPool();

  const result = await pool.query<Record<string, unknown>>(
    `with dup as (
       select sha256, count(*) as hash_count
       from knowledge_base.archive_files
       where sha256 is not null
       group by sha256
     )
     select
       f.id, f.source_root_id, f.relative_path, f.filename, f.extension, f.parent_folder,
       f.size_bytes, f.modified_at, f.sha256, f.discovery_status, f.processing_status,
       f.first_seen_at, f.last_seen_at, f.updated_at,
       coalesce(dup.hash_count, 0) as duplicate_count
     from knowledge_base.archive_files f
     left join dup on f.sha256 = dup.sha256
     where f.id = $1`,
    [fileId]
  );

  const row = result.rows[0];
  return row ? mapFileRow(row) : null;
}

export async function loadArchiveScanRuns(): Promise<ScanRun[]> {
  await requireAreaAccessForPage("archive");
  const pool = getAdministrationDashboardPool();

  const result = await pool.query<Record<string, unknown>>(`
    select
      sr.id, sr.source_root_id, sr.status, sr.started_at, sr.completed_at,
      sr.files_seen, sr.files_new, sr.files_unchanged, sr.files_changed, sr.files_failed,
      sr.total_bytes, sr.duplicate_files, sr.error_message
    from knowledge_base.archive_scan_runs sr
    order by sr.started_at desc
    limit 10
  `);

  return result.rows.map((row) => ({
    id: Number(row.id),
    source_root_id: Number(row.source_root_id),
    status: row.status as ScanRun["status"],
    started_at: new Date(row.started_at as string).toISOString(),
    completed_at: row.completed_at ? new Date(row.completed_at as string).toISOString() : null,
    files_seen: Number(row.files_seen),
    files_new: Number(row.files_new),
    files_unchanged: Number(row.files_unchanged),
    files_changed: Number(row.files_changed),
    files_failed: Number(row.files_failed),
    total_bytes: Number(row.total_bytes),
    duplicate_files: Number(row.duplicate_files),
    error_message: row.error_message == null ? null : String(row.error_message)
  }));
}

export async function loadExtensionOptions(): Promise<{ value: string; label: string }[]> {
  await requireAreaAccessForPage("archive");
  const pool = getAdministrationDashboardPool();

  const result = await pool.query<{ extension: string }>(`
    select distinct extension
    from knowledge_base.archive_files
    where extension is not null and extension != ''
    order by extension
  `);

  return result.rows.map((row) => ({ value: row.extension, label: row.extension.toUpperCase() }));
}

export async function loadSourceRootOptions(): Promise<{ value: number; label: string }[]> {
  await requireAreaAccessForPage("archive");
  const pool = getAdministrationDashboardPool();

  // label falls back to a generic placeholder rather than the raw root_path -
  // the absolute filesystem path must never reach the browser (Step 5/13).
  const result = await pool.query<{ id: number; label: string | null }>(`
    select id, label
    from knowledge_base.archive_source_roots
    order by coalesce(label, id::text)
  `);

  return result.rows.map((row) => ({
    value: Number(row.id),
    label: row.label ?? `Source #${row.id}`
  }));
}

export async function loadProcessingStatusOptions(): Promise<{ value: string; label: string }[]> {
  await requireAreaAccessForPage("archive");
  const pool = getAdministrationDashboardPool();

  const result = await pool.query<{ processing_status: string }>(`
    select distinct processing_status
    from knowledge_base.archive_files
    where processing_status is not null
    order by processing_status
  `);

  return result.rows.map((row) => ({
    value: row.processing_status,
    label: row.processing_status === "not_classified" ? "Non classifie" : row.processing_status
  }));
}
