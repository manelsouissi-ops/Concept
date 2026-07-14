import { Pool } from "pg";
import type {
  AppelOffresDetail,
  AppelOffresInput,
  AppelOffresRecord,
  AppelOffresSource,
  AppelOffresStatus,
  AuditLogRecord,
  DocumentRecord,
  ListAppelsOffresFilters,
  ProcessingJobRecord,
  ProcessingJobStatus,
  ProcessingJobType,
  UpsertDocumentInput
} from "./types.ts";
import { isAppelOffresStatus } from "./status.ts";
import {
  getArtifactPresence,
  getAttachedFicheStatus,
  getStoredArtifactStats
} from "./storage.ts";

const APPELS_OFFRES_TABLE = "public.appels_offres";
const DOCUMENTS_TABLE = "public.documents";
const PROCESSING_JOBS_TABLE = "public.processing_jobs";
const AUDIT_LOGS_TABLE = "public.audit_logs";

type GlobalWithPool = typeof globalThis & {
  __appelsOffresPool?: Pool;
  __appelsOffresSetupPromise?: Promise<void>;
};

type AppelOffresRow = {
  id: number | string;
  code: string;
  title: string;
  reference: string | null;
  buyer: string | null;
  country: string | null;
  due_date: string | null;
  notes: string | null;
  priorite: AppelOffresInput["priorite"] | null;
  responsable_commercial: string | null;
  status: AppelOffresStatus;
  source: AppelOffresSource;
  created_at: string | Date;
  updated_at: string | Date;
  archived_at: string | Date | null;
  deleted_at: string | Date | null;
};

type DocumentRow = {
  id: number | string;
  appel_offres_id: number | string;
  kind: DocumentRecord["kind"];
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number | string;
  created_at: string | Date;
  updated_at: string | Date;
};

type ProcessingJobRow = {
  id: number | string;
  appel_offres_id: number | string;
  job_type: ProcessingJobType;
  status: ProcessingJobStatus;
  started_at: string | Date;
  finished_at: string | Date | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
};

type AuditLogRow = {
  id: number | string;
  appel_offres_id: number | string | null;
  action: string;
  payload: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  actor: string | null;
  created_at: string | Date;
};

type FindByCodeOptions = {
  includeArchived?: boolean;
};

type ListOptions = {
  includeDetails?: boolean;
};

type ListOptionsWithDetails = {
  includeDetails?: true;
};

type ListOptionsWithoutDetails = {
  includeDetails: false;
};

function getDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  return value ? value : null;
}

function getPool() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  const globalWithPool = globalThis as GlobalWithPool;

  if (!globalWithPool.__appelsOffresPool) {
    globalWithPool.__appelsOffresPool = new Pool({
      connectionString: databaseUrl
    });
  }

  return globalWithPool.__appelsOffresPool;
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (value == null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapAppelOffresRow(row: AppelOffresRow): AppelOffresRecord {
  return {
    id: Number(row.id),
    code: row.code,
    title: row.title,
    reference: row.reference ?? "",
    buyer: row.buyer ?? "",
    country: row.country ?? "",
    dueDate: row.due_date ?? null,
    notes: row.notes ?? "",
    priorite: row.priorite ?? "normale",
    responsableCommercial: row.responsable_commercial ?? "",
    status: row.status,
    source: row.source,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString(),
    archivedAt: normalizeTimestamp(row.archived_at) ?? normalizeTimestamp(row.deleted_at)
  };
}

function mapDocumentRow(row: DocumentRow): DocumentRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    kind: row.kind,
    fileName: row.file_name,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString()
  };
}

function mapProcessingJobRow(row: ProcessingJobRow): ProcessingJobRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    jobType: row.job_type,
    status: row.status,
    startedAt: normalizeTimestamp(row.started_at) ?? new Date(0).toISOString(),
    finishedAt: normalizeTimestamp(row.finished_at),
    errorMessage: row.error_message,
    metadata: row.metadata ?? null
  };
}

function mapAuditLogRow(row: AuditLogRow): AuditLogRecord {
  return {
    id: Number(row.id),
    appelOffresId: row.appel_offres_id == null ? null : Number(row.appel_offres_id),
    action: row.action,
    details: row.details ?? row.payload ?? null,
    actor: row.actor ?? null,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString()
  };
}

function normalizeArchivedFilter(value: ListAppelsOffresFilters["archived"]) {
  return value ?? "false";
}

function buildListWhereClause(filters: ListAppelsOffresFilters) {
  const clauses: string[] = [];
  const values: Array<string> = [];

  const archived = normalizeArchivedFilter(filters.archived);
  if (archived === "true") {
    clauses.push("(archived_at is not null or deleted_at is not null)");
  } else if (archived !== "all") {
    clauses.push("(archived_at is null and deleted_at is null)");
  }

  if (filters.search?.trim()) {
    values.push(`%${filters.search.trim().toLowerCase()}%`);
    const index = values.length;
    clauses.push(`
      (
        lower(code) like $${index}
        or lower(title) like $${index}
        or lower(coalesce(reference, '')) like $${index}
        or lower(coalesce(buyer, '')) like $${index}
        or lower(coalesce(country, '')) like $${index}
        or lower(coalesce(responsable_commercial, '')) like $${index}
      )
    `);
  }

  if (filters.status?.trim() && isAppelOffresStatus(filters.status.trim())) {
    values.push(filters.status.trim());
    clauses.push(`status = $${values.length}`);
  }

  if (filters.priorite?.trim()) {
    values.push(filters.priorite.trim().toLowerCase());
    clauses.push(`coalesce(priorite, 'normale') = $${values.length}`);
  }

  if (filters.pays?.trim()) {
    values.push(filters.pays.trim());
    clauses.push(`country = $${values.length}`);
  }

  if (filters.client?.trim()) {
    values.push(filters.client.trim());
    clauses.push(`buyer = $${values.length}`);
  }

  const whereClause = clauses.length ? `where ${clauses.join(" and ")}` : "";
  return { whereClause, values };
}

function buildOrderByClause(sort: string | undefined) {
  switch ((sort ?? "").trim()) {
    case "deadline":
      return "order by due_date asc nulls last, updated_at desc";
    case "title":
      return "order by title asc, updated_at desc";
    case "code":
      return "order by code asc";
    case "created_at":
      return "order by created_at desc";
    default:
      return "order by updated_at desc, code asc";
  }
}

async function ensureSchemaInternal(pool: Pool) {
  const client = await pool.connect();

  try {
    await client.query(`
      create table if not exists ${APPELS_OFFRES_TABLE} (
        id bigserial primary key,
        code text not null unique,
        title text not null,
        reference text null,
        buyer text null,
        country text null,
        due_date date null,
        notes text null,
        priorite text null,
        responsable_commercial text null,
        status text not null check (status in ('draft', 'processing', 'ready', 'error', 'archived')),
        source text not null check (source in ('manual', 'fiche-flow')) default 'manual',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        archived_at timestamptz null,
        deleted_at timestamptz null
      )
    `);
    await client.query(`
      alter table ${APPELS_OFFRES_TABLE}
      add column if not exists priorite text null,
      add column if not exists responsable_commercial text null,
      add column if not exists archived_at timestamptz null,
      add column if not exists deleted_at timestamptz null
    `);
    await client.query(`
      update ${APPELS_OFFRES_TABLE}
      set
        priorite = coalesce(priorite, 'normale'),
        archived_at = coalesce(archived_at, deleted_at)
      where priorite is null or (archived_at is null and deleted_at is not null)
    `);
    await client.query(`
      alter table ${APPELS_OFFRES_TABLE}
      drop constraint if exists appels_offres_priorite_check
    `);
    await client.query(`
      alter table ${APPELS_OFFRES_TABLE}
      add constraint appels_offres_priorite_check
      check (priorite in ('basse', 'normale', 'haute', 'critique'))
    `);
    await client.query(`
      create table if not exists ${DOCUMENTS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references ${APPELS_OFFRES_TABLE}(id) on delete cascade,
        kind text not null check (kind in ('source_pdf', 'fiche_xml', 'fiche_markdown', 'status_json')),
        file_name text not null,
        storage_path text not null,
        mime_type text not null,
        size_bytes bigint not null check (size_bytes >= 0),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (appel_offres_id, kind)
      )
    `);
    await client.query(`
      create table if not exists ${PROCESSING_JOBS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references ${APPELS_OFFRES_TABLE}(id) on delete cascade,
        job_type text not null check (job_type in ('appel_offres_upload', 'appel_offres_update', 'fiche_generation')),
        status text not null check (status in ('processing', 'completed', 'failed')),
        started_at timestamptz not null default now(),
        finished_at timestamptz null,
        error_message text null,
        metadata jsonb null
      )
    `);
    await client.query(`
      create table if not exists ${AUDIT_LOGS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint null references ${APPELS_OFFRES_TABLE}(id) on delete set null,
        action text not null,
        payload jsonb null,
        details jsonb null,
        actor text null,
        created_at timestamptz not null default now()
      )
    `);
    await client.query(`
      alter table ${AUDIT_LOGS_TABLE}
      add column if not exists payload jsonb null,
      add column if not exists details jsonb null,
      add column if not exists actor text null
    `);
    await client.query(`
      update ${AUDIT_LOGS_TABLE}
      set details = payload
      where details is null and payload is not null
    `);
    await client.query(`
      create index if not exists appels_offres_updated_at_idx
      on ${APPELS_OFFRES_TABLE} (updated_at desc)
    `);
    await client.query(`
      create index if not exists appels_offres_archived_at_idx
      on ${APPELS_OFFRES_TABLE} (archived_at desc nulls last)
    `);
    await client.query(`
      create index if not exists appels_offres_priorite_idx
      on ${APPELS_OFFRES_TABLE} (priorite)
    `);
    await client.query(`
      create index if not exists appels_offres_responsable_idx
      on ${APPELS_OFFRES_TABLE} (responsable_commercial)
    `);
    await client.query(`
      create index if not exists appels_offres_deleted_at_idx
      on ${APPELS_OFFRES_TABLE} (deleted_at)
    `);
    await client.query(`
      create index if not exists documents_appel_offres_id_idx
      on ${DOCUMENTS_TABLE} (appel_offres_id)
    `);
    await client.query(`
      create index if not exists processing_jobs_appel_offres_id_started_at_idx
      on ${PROCESSING_JOBS_TABLE} (appel_offres_id, started_at desc)
    `);
    await client.query(`
      create index if not exists audit_logs_appel_offres_id_created_at_idx
      on ${AUDIT_LOGS_TABLE} (appel_offres_id, created_at desc)
    `);
  } finally {
    client.release();
  }
}

export async function ensureAppelsOffresSchema() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const globalWithPool = globalThis as GlobalWithPool;

  if (!globalWithPool.__appelsOffresSetupPromise) {
    globalWithPool.__appelsOffresSetupPromise = ensureSchemaInternal(pool).catch((error) => {
      globalWithPool.__appelsOffresSetupPromise = undefined;
      throw error;
    });
  }

  await globalWithPool.__appelsOffresSetupPromise;
}

async function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  await ensureAppelsOffresSchema();
  return pool;
}

async function getAppelOffresIdByCode(code: string, includeArchived = true) {
  const record = await getAppelOffresRecordByCode(code, { includeArchived });
  return record?.id ?? null;
}

async function getLatestArchivePreviousStatus(appelOffresId: number) {
  const pool = await requirePool();
  const result = await pool.query<{ previous_status: string | null }>(
    `
      select coalesce(details->>'previousStatus', payload->>'previousStatus') as previous_status
      from ${AUDIT_LOGS_TABLE}
      where appel_offres_id = $1 and action = 'appel_offres.archived'
      order by created_at desc, id desc
      limit 1
    `,
    [appelOffresId]
  );

  const previousStatus = result.rows[0]?.previous_status?.trim() ?? "";
  return isAppelOffresStatus(previousStatus) ? previousStatus : null;
}

export async function listAppelsOffres(filters: ListAppelsOffresFilters = {}) {
  const pool = await requirePool();
  const { whereClause, values } = buildListWhereClause(filters);
  const orderByClause = buildOrderByClause(filters.sort);
  const result = await pool.query<AppelOffresRow>(
    `
      select
        id,
        code,
        title,
        reference,
        buyer,
        country,
        due_date::text,
        notes,
        priorite,
        responsable_commercial,
        status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
      from ${APPELS_OFFRES_TABLE}
      ${whereClause}
      ${orderByClause}
    `,
    values
  );

  return result.rows.map(mapAppelOffresRow);
}

export async function listAppelOffresDetails(
  filters?: ListAppelsOffresFilters,
  options?: ListOptionsWithDetails
): Promise<AppelOffresDetail[]>;
export async function listAppelOffresDetails(
  filters: ListAppelsOffresFilters | undefined,
  options: ListOptionsWithoutDetails
): Promise<AppelOffresRecord[]>;
export async function listAppelOffresDetails(
  filters: ListAppelsOffresFilters = {},
  options: ListOptions = {}
) {
  const records = await listAppelsOffres(filters);

  if (options.includeDetails === false) {
    return records;
  }

  const details = await Promise.all(
    records.map((record) =>
      getAppelOffresDetailByCode(record.code, { includeArchived: true })
    )
  );

  return details.filter((detail): detail is AppelOffresDetail => detail !== null);
}

export async function getAppelOffresRecordByCode(
  code: string,
  options: FindByCodeOptions = {}
) {
  const pool = await requirePool();
  const includeArchived = options.includeArchived ?? false;
  const result = await pool.query<AppelOffresRow>(
    `
      select
        id,
        code,
        title,
        reference,
        buyer,
        country,
        due_date::text,
        notes,
        priorite,
        responsable_commercial,
        status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
      from ${APPELS_OFFRES_TABLE}
      where code = $1
        and (${includeArchived ? "true" : "(archived_at is null and deleted_at is null)"})
      limit 1
    `,
    [code]
  );

  return result.rows[0] ? mapAppelOffresRow(result.rows[0]) : null;
}

export async function createAppelOffres(
  input: AppelOffresInput & { status: AppelOffresStatus; source: AppelOffresSource }
) {
  const pool = await requirePool();
  const result = await pool.query<AppelOffresRow>(
    `
      insert into ${APPELS_OFFRES_TABLE} (
        code,
        title,
        reference,
        buyer,
        country,
        due_date,
        notes,
        priorite,
        responsable_commercial,
        status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now(), null, null)
      returning
        id,
        code,
        title,
        reference,
        buyer,
        country,
        due_date::text,
        notes,
        priorite,
        responsable_commercial,
        status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
    `,
    [
      input.code,
      input.title,
      input.reference || null,
      input.buyer || null,
      input.country || null,
      input.dueDate,
      input.notes || null,
      input.priorite,
      input.responsableCommercial || null,
      input.status,
      input.source
    ]
  );

  return mapAppelOffresRow(result.rows[0]);
}

export async function ensureAppelOffresRecord(
  input: AppelOffresInput & { status: AppelOffresStatus; source: AppelOffresSource }
) {
  const pool = await requirePool();
  const result = await pool.query<AppelOffresRow>(
    `
      insert into ${APPELS_OFFRES_TABLE} (
        code,
        title,
        reference,
        buyer,
        country,
        due_date,
        notes,
        priorite,
        responsable_commercial,
        status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now(), null, null)
      on conflict (code)
      do update set
        title = excluded.title,
        reference = excluded.reference,
        buyer = excluded.buyer,
        country = excluded.country,
        due_date = excluded.due_date,
        notes = excluded.notes,
        priorite = excluded.priorite,
        responsable_commercial = excluded.responsable_commercial,
        status = excluded.status,
        source = excluded.source,
        updated_at = now()
      returning
        id,
        code,
        title,
        reference,
        buyer,
        country,
        due_date::text,
        notes,
        priorite,
        responsable_commercial,
        status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
    `,
    [
      input.code,
      input.title,
      input.reference || null,
      input.buyer || null,
      input.country || null,
      input.dueDate,
      input.notes || null,
      input.priorite,
      input.responsableCommercial || null,
      input.status,
      input.source
    ]
  );

  return mapAppelOffresRow(result.rows[0]);
}

export async function updateAppelOffres(
  code: string,
  patch: Omit<AppelOffresInput, "code">
) {
  const pool = await requirePool();
  const result = await pool.query<AppelOffresRow>(
    `
      update ${APPELS_OFFRES_TABLE}
      set
        title = $2,
        reference = $3,
        buyer = $4,
        country = $5,
        due_date = $6,
        notes = $7,
        priorite = $8,
        responsable_commercial = $9,
        updated_at = now()
      where code = $1
      returning
        id,
        code,
        title,
        reference,
        buyer,
        country,
        due_date::text,
        notes,
        priorite,
        responsable_commercial,
        status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
    `,
    [
      code,
      patch.title,
      patch.reference || null,
      patch.buyer || null,
      patch.country || null,
      patch.dueDate,
      patch.notes || null,
      patch.priorite,
      patch.responsableCommercial || null
    ]
  );

  return result.rows[0] ? mapAppelOffresRow(result.rows[0]) : null;
}

export async function setAppelOffresStatus(
  code: string,
  status: AppelOffresStatus,
  details: Record<string, unknown> | null = null
) {
  const pool = await requirePool();
  const current = await getAppelOffresRecordByCode(code, { includeArchived: true });
  const result = await pool.query<AppelOffresRow>(
    `
      update ${APPELS_OFFRES_TABLE}
      set status = $2, updated_at = now()
      where code = $1
      returning
        id,
        code,
        title,
        reference,
        buyer,
        country,
        due_date::text,
        notes,
        priorite,
        responsable_commercial,
        status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
    `,
    [code, status]
  );

  const next = result.rows[0] ? mapAppelOffresRow(result.rows[0]) : null;

  if (current && next && current.status !== next.status) {
    await appendAuditLog(code, "appel_offres.status_changed", {
      previousStatus: current.status,
      nextStatus: next.status,
      ...(details ?? {})
    });
  }

  return next;
}

export async function archiveAppelOffres(code: string) {
  const pool = await requirePool();
  const current = await getAppelOffresRecordByCode(code, { includeArchived: true });

  if (!current) {
    return null;
  }

  if (current.archivedAt) {
    return current;
  }

  const result = await pool.query<AppelOffresRow>(
    `
      update ${APPELS_OFFRES_TABLE}
      set
        status = 'archived',
        archived_at = now(),
        deleted_at = now(),
        updated_at = now()
      where code = $1
      returning
        id,
        code,
        title,
        reference,
        buyer,
        country,
        due_date::text,
        notes,
        priorite,
        responsable_commercial,
        status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
    `,
    [code]
  );

  const next = result.rows[0] ? mapAppelOffresRow(result.rows[0]) : null;

  if (next && current.status !== next.status) {
    await appendAuditLog(code, "appel_offres.status_changed", {
      previousStatus: current.status,
      nextStatus: next.status
    });
  }

  return next;
}

export async function unarchiveAppelOffres(code: string) {
  const pool = await requirePool();
  const current = await getAppelOffresRecordByCode(code, { includeArchived: true });

  if (!current) {
    return null;
  }

  if (!current.archivedAt) {
    return current;
  }

  const previousStatus =
    (await getLatestArchivePreviousStatus(current.id)) ??
    (current.source === "fiche-flow" ? "processing" : "ready");
  const nextStatus = previousStatus === "archived" ? "ready" : previousStatus;

  const result = await pool.query<AppelOffresRow>(
    `
      update ${APPELS_OFFRES_TABLE}
      set
        status = $2,
        archived_at = null,
        deleted_at = null,
        updated_at = now()
      where code = $1
      returning
        id,
        code,
        title,
        reference,
        buyer,
        country,
        due_date::text,
        notes,
        priorite,
        responsable_commercial,
        status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
    `,
    [code, nextStatus]
  );

  const next = result.rows[0] ? mapAppelOffresRow(result.rows[0]) : null;

  if (next && current.status !== next.status) {
    await appendAuditLog(code, "appel_offres.status_changed", {
      previousStatus: current.status,
      nextStatus: next.status
    });
  }

  return next;
}

export async function upsertDocumentByCode(code: string, input: UpsertDocumentInput) {
  const pool = await requirePool();
  const appelOffresId = await getAppelOffresIdByCode(code);

  if (!appelOffresId) {
    throw new Error(`Appel d'offres ${code} introuvable.`);
  }

  const result = await pool.query<DocumentRow>(
    `
      insert into ${DOCUMENTS_TABLE} (
        appel_offres_id,
        kind,
        file_name,
        storage_path,
        mime_type,
        size_bytes,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, now(), now())
      on conflict (appel_offres_id, kind)
      do update set
        file_name = excluded.file_name,
        storage_path = excluded.storage_path,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        updated_at = now()
      returning
        id,
        appel_offres_id,
        kind,
        file_name,
        storage_path,
        mime_type,
        size_bytes,
        created_at,
        updated_at
    `,
    [
      appelOffresId,
      input.kind,
      input.fileName,
      input.storagePath,
      input.mimeType,
      input.sizeBytes
    ]
  );

  return mapDocumentRow(result.rows[0]);
}

export async function syncDocumentsFromStorage(
  code: string,
  documents: UpsertDocumentInput[]
) {
  const synced: DocumentRecord[] = [];
  for (const document of documents) {
    synced.push(await upsertDocumentByCode(code, document));
  }

  return synced;
}

export async function syncStoredDocumentsMetadata(code: string) {
  const storedDocuments = await getStoredArtifactStats(code);
  return syncDocumentsFromStorage(code, storedDocuments);
}

export async function createProcessingJobByCode(
  code: string,
  jobType: ProcessingJobType,
  metadata: Record<string, unknown> | null = null
) {
  const pool = await requirePool();
  const appelOffresId = await getAppelOffresIdByCode(code, true);

  if (!appelOffresId) {
    throw new Error(`Appel d'offres ${code} introuvable.`);
  }

  const result = await pool.query<ProcessingJobRow>(
    `
      insert into ${PROCESSING_JOBS_TABLE} (
        appel_offres_id,
        job_type,
        status,
        started_at,
        metadata
      )
      values ($1, $2, 'processing', now(), $3::jsonb)
      returning
        id,
        appel_offres_id,
        job_type,
        status,
        started_at,
        finished_at,
        error_message,
        metadata
    `,
    [appelOffresId, jobType, metadata ? JSON.stringify(metadata) : null]
  );

  return mapProcessingJobRow(result.rows[0]);
}

export async function finishProcessingJob(
  jobId: number,
  status: Exclude<ProcessingJobStatus, "processing">,
  errorMessage?: string | null
) {
  const pool = await requirePool();
  const result = await pool.query<ProcessingJobRow>(
    `
      update ${PROCESSING_JOBS_TABLE}
      set
        status = $2,
        finished_at = now(),
        error_message = $3
      where id = $1
      returning
        id,
        appel_offres_id,
        job_type,
        status,
        started_at,
        finished_at,
        error_message,
        metadata
    `,
    [jobId, status, errorMessage ?? null]
  );

  return result.rows[0] ? mapProcessingJobRow(result.rows[0]) : null;
}

export async function finishLatestProcessingJobByCode(
  code: string,
  jobType: ProcessingJobType,
  status: Exclude<ProcessingJobStatus, "processing">,
  errorMessage?: string | null
) {
  const pool = await requirePool();
  const appelOffresId = await getAppelOffresIdByCode(code, true);

  if (!appelOffresId) {
    return null;
  }

  const latest = await pool.query<{ id: number | string }>(
    `
      select id
      from ${PROCESSING_JOBS_TABLE}
      where appel_offres_id = $1 and job_type = $2 and status = 'processing'
      order by started_at desc
      limit 1
    `,
    [appelOffresId, jobType]
  );

  if (!latest.rows[0]) {
    return null;
  }

  return finishProcessingJob(Number(latest.rows[0].id), status, errorMessage);
}

export async function appendAuditLog(
  code: string,
  action: string,
  details: Record<string, unknown> | null = null,
  actor: string | null = null
) {
  const pool = await requirePool();
  const appelOffresId = await getAppelOffresIdByCode(code, true);

  await pool.query(
    `
      insert into ${AUDIT_LOGS_TABLE} (
        appel_offres_id,
        action,
        payload,
        details,
        actor,
        created_at
      )
      values ($1, $2, $3::jsonb, $4::jsonb, $5, now())
    `,
    [
      appelOffresId,
      action,
      details ? JSON.stringify(details) : null,
      details ? JSON.stringify(details) : null,
      actor
    ]
  );
}

async function listDocumentsForCode(code: string) {
  const pool = await requirePool();
  const appelOffresId = await getAppelOffresIdByCode(code, true);

  if (!appelOffresId) {
    return [];
  }

  const result = await pool.query<DocumentRow>(
    `
      select
        id,
        appel_offres_id,
        kind,
        file_name,
        storage_path,
        mime_type,
        size_bytes,
        created_at,
        updated_at
      from ${DOCUMENTS_TABLE}
      where appel_offres_id = $1
      order by created_at asc, kind asc
    `,
    [appelOffresId]
  );

  return result.rows.map(mapDocumentRow);
}

export async function listProcessingJobsForCode(code: string) {
  const pool = await requirePool();
  const appelOffresId = await getAppelOffresIdByCode(code, true);

  if (!appelOffresId) {
    return [];
  }

  const result = await pool.query<ProcessingJobRow>(
    `
      select
        id,
        appel_offres_id,
        job_type,
        status,
        started_at,
        finished_at,
        error_message,
        metadata
      from ${PROCESSING_JOBS_TABLE}
      where appel_offres_id = $1
      order by started_at desc
    `,
    [appelOffresId]
  );

  return result.rows.map(mapProcessingJobRow);
}

export async function listAuditLogsForCode(code: string) {
  const pool = await requirePool();
  const appelOffresId = await getAppelOffresIdByCode(code, true);

  if (!appelOffresId) {
    return [];
  }

  const result = await pool.query<AuditLogRow>(
    `
      select
        id,
        appel_offres_id,
        action,
        payload,
        details,
        actor,
        created_at
      from ${AUDIT_LOGS_TABLE}
      where appel_offres_id = $1
      order by created_at desc, id desc
    `,
    [appelOffresId]
  );

  return result.rows.map(mapAuditLogRow);
}

export async function getAppelOffresDetailByCode(
  code: string,
  options: FindByCodeOptions = {}
): Promise<AppelOffresDetail | null> {
  const record = await getAppelOffresRecordByCode(code, options);
  if (!record) {
    return null;
  }

  const [documents, processingJobs, auditLogs, artifacts, ficheStatus] = await Promise.all([
    listDocumentsForCode(code),
    listProcessingJobsForCode(code),
    listAuditLogsForCode(code),
    getArtifactPresence(code),
    getAttachedFicheStatus(code)
  ]);

  return {
    ...record,
    documents,
    latestJob: processingJobs[0] ?? null,
    processingJobs,
    auditLogs,
    artifacts,
    ficheStatus
  };
}

export async function closeAppelsOffresPool() {
  const globalWithPool = globalThis as GlobalWithPool;

  if (globalWithPool.__appelsOffresPool) {
    await globalWithPool.__appelsOffresPool.end();
    globalWithPool.__appelsOffresPool = undefined;
    globalWithPool.__appelsOffresSetupPromise = undefined;
  }
}
