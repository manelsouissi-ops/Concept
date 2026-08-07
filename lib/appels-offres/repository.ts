import { Pool } from "pg";
import type {
  AppelOffresDetail,
  AppelOffresCommercialOwnershipEventRecord,
  AppelOffresCommercialOwnerView,
  AppelOffresInput,
  AppelOffresRecord,
  AppelOffresBusinessStatus,
  AppelOffresSource,
  AppelOffresStatus,
  AuditLogRecord,
  DocumentRecord,
  ListAppelsOffresFilters,
  ProcessingJobCallbackStatus,
  ProcessingJobErrorStage,
  ProcessingJobRecord,
  ProcessingJobStatus,
  ProcessingJobType,
  UpsertDocumentInput
} from "./types.ts";
import { isAppelOffresStatus } from "./status.ts";
import type { UserStatus } from "../users/types.ts";
import {
  getArtifactPresence,
  getAttachedFicheStatus,
  getStoredArtifactStats
} from "./storage.ts";

const APPELS_OFFRES_TABLE = "public.appels_offres";
const DOCUMENTS_TABLE = "public.documents";
const PROCESSING_JOBS_TABLE = "public.processing_jobs";
const AUDIT_LOGS_TABLE = "public.audit_logs";
const COMMERCIAL_OWNERSHIP_EVENTS_TABLE = "public.appel_offre_commercial_ownership_events";

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
  business_status: AppelOffresBusinessStatus | null;
  source: AppelOffresSource;
  commercial_owner_user_id: number | string | null;
  commercial_owner_assigned_at: string | Date | null;
  commercial_owner_assigned_by_user_id: number | string | null;
  commercial_owner_previous_user_id: number | string | null;
  commercial_owner_reason: string | null;
  commercial_owner_updated_at: string | Date | null;
  commercial_owner_status: UserStatus | null;
  created_at: string | Date;
  updated_at: string | Date;
  archived_at: string | Date | null;
  deleted_at: string | Date | null;
};

type CommercialOwnershipEventRow = {
  id: number | string;
  appel_offres_id: number | string;
  appel_offres_code: string;
  previous_owner_user_id: number | string | null;
  previous_owner_name: string | null;
  new_owner_user_id: number | string;
  new_owner_name: string | null;
  changed_by_user_id: number | string | null;
  changed_by_name: string | null;
  reason: string | null;
  metadata_jsonb: Record<string, unknown> | null;
  created_at: string | Date;
};

type CommercialOwnerViewRow = {
  commercial_owner_user_id: number | string | null;
  owner_display_name: string | null;
  owner_email: string | null;
  owner_job_title: string | null;
  owner_role: "COMMERCIAL" | null;
  owner_status: UserStatus | null;
  commercial_owner_assigned_at: string | Date | null;
  commercial_owner_assigned_by_user_id: number | string | null;
  assigned_by_name: string | null;
  commercial_owner_previous_user_id: number | string | null;
  previous_owner_name: string | null;
  commercial_owner_reason: string | null;
  commercial_owner_updated_at: string | Date | null;
  legacy_responsable_commercial: string | null;
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
  public_id: string | null;
  job_type: ProcessingJobType;
  status: ProcessingJobStatus;
  started_at: string | Date;
  finished_at: string | Date | null;
  contract_version: string | null;
  correlation_id: string | null;
  execution_id: string | null;
  launch_accepted_at: string | Date | null;
  callback_received_at: string | Date | null;
  callback_status: ProcessingJobCallbackStatus | null;
  callback_idempotency_key: string | null;
  retry_of_job_id: number | string | null;
  error_stage: ProcessingJobErrorStage | null;
  error_code: string | null;
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

function mapBusinessStatusToStoredStatus(
  status: AppelOffresBusinessStatus
): AppelOffresStatus {
  switch (status) {
    case "brouillon":
      return "draft";
    case "analyse_en_cours":
      return "processing";
    case "erreur":
      return "error";
    case "archive":
    case "offre_rejetee":
      return "archived";
    default:
      return "ready";
  }
}

function mapStoredStatusToBusinessStatus(
  status: AppelOffresStatus
): AppelOffresBusinessStatus {
  switch (status) {
    case "draft":
      return "brouillon";
    case "processing":
      return "analyse_en_cours";
    case "error":
      return "erreur";
    case "archived":
      return "archive";
    default:
      return "cdc_importe";
  }
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
    businessStatus: row.business_status ?? null,
    source: row.source,
    commercialOwnerUserId:
      row.commercial_owner_user_id == null ? null : Number(row.commercial_owner_user_id),
    commercialOwnerAssignedAt: normalizeTimestamp(row.commercial_owner_assigned_at),
    commercialOwnerAssignedByUserId:
      row.commercial_owner_assigned_by_user_id == null
        ? null
        : Number(row.commercial_owner_assigned_by_user_id),
    commercialOwnerPreviousUserId:
      row.commercial_owner_previous_user_id == null
        ? null
        : Number(row.commercial_owner_previous_user_id),
    commercialOwnerReason: row.commercial_owner_reason ?? null,
    commercialOwnerUpdatedAt: normalizeTimestamp(row.commercial_owner_updated_at),
    commercialOwnerStatus: row.commercial_owner_status ?? null,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString(),
    archivedAt: normalizeTimestamp(row.archived_at) ?? normalizeTimestamp(row.deleted_at)
  };
}

function mapCommercialOwnershipEventRow(
  row: CommercialOwnershipEventRow
): AppelOffresCommercialOwnershipEventRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    appelOffresCode: row.appel_offres_code,
    previousOwnerUserId:
      row.previous_owner_user_id == null ? null : Number(row.previous_owner_user_id),
    previousOwnerName: row.previous_owner_name ?? null,
    newOwnerUserId: Number(row.new_owner_user_id),
    newOwnerName: row.new_owner_name ?? null,
    changedByUserId:
      row.changed_by_user_id == null ? null : Number(row.changed_by_user_id),
    changedByName: row.changed_by_name ?? null,
    reason: row.reason ?? null,
    metadata: row.metadata_jsonb ?? null,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString()
  };
}

function mapCommercialOwnerViewRow(
  row: CommercialOwnerViewRow
): AppelOffresCommercialOwnerView {
  const status = row.owner_status ?? null;
  return {
    userId: row.commercial_owner_user_id == null ? null : Number(row.commercial_owner_user_id),
    displayName: row.owner_display_name ?? null,
    email: row.owner_email ?? null,
    jobTitle: row.owner_job_title ?? null,
    role: row.owner_role ?? null,
    status,
    assignedAt: normalizeTimestamp(row.commercial_owner_assigned_at),
    assignedByUserId:
      row.commercial_owner_assigned_by_user_id == null
        ? null
        : Number(row.commercial_owner_assigned_by_user_id),
    assignedByName: row.assigned_by_name ?? null,
    previousOwnerUserId:
      row.commercial_owner_previous_user_id == null
        ? null
        : Number(row.commercial_owner_previous_user_id),
    previousOwnerName: row.previous_owner_name ?? null,
    reason: row.commercial_owner_reason ?? null,
    updatedAt: normalizeTimestamp(row.commercial_owner_updated_at),
    isRecoveryRequired:
      row.commercial_owner_user_id == null
      || status === "INACTIVE"
      || status === "LOCKED",
    legacyResponsibleLabel: row.legacy_responsable_commercial ?? null
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
    publicId: row.public_id,
    jobType: row.job_type,
    status: row.status,
    startedAt: normalizeTimestamp(row.started_at) ?? new Date(0).toISOString(),
    finishedAt: normalizeTimestamp(row.finished_at),
    contractVersion: row.contract_version,
    correlationId: row.correlation_id,
    executionId: row.execution_id,
    launchAcceptedAt: normalizeTimestamp(row.launch_accepted_at),
    callbackReceivedAt: normalizeTimestamp(row.callback_received_at),
    callbackStatus: row.callback_status,
    callbackIdempotencyKey: row.callback_idempotency_key,
    retryOfJobId: row.retry_of_job_id == null ? null : Number(row.retry_of_job_id),
    errorStage: row.error_stage,
    errorCode: row.error_code,
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
        commercial_owner_user_id bigint null references public.app_users(id) on delete set null,
        commercial_owner_assigned_at timestamptz null,
        commercial_owner_assigned_by_user_id bigint null references public.app_users(id) on delete set null,
        commercial_owner_previous_user_id bigint null references public.app_users(id) on delete set null,
        commercial_owner_reason text null,
        commercial_owner_updated_at timestamptz null,
        status text not null check (status in ('draft', 'processing', 'ready', 'error', 'archived')),
        business_status text null,
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
      add column if not exists commercial_owner_user_id bigint null references public.app_users(id) on delete set null,
      add column if not exists commercial_owner_assigned_at timestamptz null,
      add column if not exists commercial_owner_assigned_by_user_id bigint null references public.app_users(id) on delete set null,
      add column if not exists commercial_owner_previous_user_id bigint null references public.app_users(id) on delete set null,
      add column if not exists commercial_owner_reason text null,
      add column if not exists commercial_owner_updated_at timestamptz null,
      add column if not exists business_status text null,
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
      do $$
      begin
        if not exists (
          select 1
          from pg_constraint
          where conname = 'appels_offres_priorite_check'
            and conrelid = '${APPELS_OFFRES_TABLE}'::regclass
        ) then
          alter table ${APPELS_OFFRES_TABLE}
          add constraint appels_offres_priorite_check
          check (priorite in ('basse', 'normale', 'haute', 'critique'));
        end if;
      end
      $$;
    `);
    await client.query(`
      do $$
      begin
        if not exists (
          select 1
          from pg_constraint
          where conname = 'appels_offres_business_status_check'
            and conrelid = '${APPELS_OFFRES_TABLE}'::regclass
        ) then
          alter table ${APPELS_OFFRES_TABLE}
          add constraint appels_offres_business_status_check
          check (
            business_status is null
            or business_status in (
              'brouillon',
              'cdc_importe',
              'en_attente_analyse',
              'analyse_en_cours',
              'fiche_a_valider',
              'fiche_validee',
              'erreur',
              'archive',
              'offre_autorisee',
              'offre_rejetee'
            )
          );
        end if;
      end
      $$;
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
        public_id text null,
        job_type text not null check (job_type in ('appel_offres_upload', 'appel_offres_update', 'fiche_generation')),
        status text not null check (status in ('created', 'queued', 'running', 'completed', 'failed', 'cancelled', 'retrying')),
        started_at timestamptz not null default now(),
        finished_at timestamptz null,
        contract_version text null,
        correlation_id text null,
        execution_id text null,
        launch_accepted_at timestamptz null,
        callback_received_at timestamptz null,
        callback_status text null,
        callback_idempotency_key text null,
        retry_of_job_id bigint null references ${PROCESSING_JOBS_TABLE}(id) on delete set null,
        error_stage text null,
        error_code text null,
        error_message text null,
        metadata jsonb null
      )
    `);
    await client.query(`
      alter table ${PROCESSING_JOBS_TABLE}
      add column if not exists public_id text null,
      add column if not exists contract_version text null,
      add column if not exists correlation_id text null,
      add column if not exists execution_id text null,
      add column if not exists launch_accepted_at timestamptz null,
      add column if not exists callback_received_at timestamptz null,
      add column if not exists callback_status text null,
      add column if not exists callback_idempotency_key text null,
      add column if not exists retry_of_job_id bigint null,
      add column if not exists error_stage text null,
      add column if not exists error_code text null
    `);
    await client.query(`
      update ${PROCESSING_JOBS_TABLE}
      set status = case status
        when 'processing' then 'running'
        when 'completed' then 'completed'
        when 'failed' then 'failed'
        else status
      end
      where status in ('processing', 'completed', 'failed')
    `);
    await client.query(`
      update ${PROCESSING_JOBS_TABLE}
      set public_id = concat('legacy_pj_', id)
      where public_id is null
    `);
    await client.query(`
      do $$
      begin
        if not exists (
          select 1
          from pg_constraint
          where conname = 'processing_jobs_status_check'
            and conrelid = '${PROCESSING_JOBS_TABLE}'::regclass
        ) then
          alter table ${PROCESSING_JOBS_TABLE}
          add constraint processing_jobs_status_check
          check (status in ('created', 'queued', 'running', 'completed', 'failed', 'cancelled', 'retrying'));
        end if;
      end
      $$;
    `);
    await client.query(`
      do $$
      begin
        if not exists (
          select 1
          from pg_constraint
          where conname = 'processing_jobs_callback_status_check'
            and conrelid = '${PROCESSING_JOBS_TABLE}'::regclass
        ) then
          alter table ${PROCESSING_JOBS_TABLE}
          add constraint processing_jobs_callback_status_check
          check (
            callback_status is null
            or callback_status in ('completed', 'failed', 'cancelled')
          );
        end if;
      end
      $$;
    `);
    await client.query(`
      do $$
      begin
        if not exists (
          select 1
          from pg_constraint
          where conname = 'processing_jobs_error_stage_check'
            and conrelid = '${PROCESSING_JOBS_TABLE}'::regclass
        ) then
          alter table ${PROCESSING_JOBS_TABLE}
          add constraint processing_jobs_error_stage_check
          check (
            error_stage is null
            or error_stage in (
              'webhook',
              'upload',
              'marker',
              'markdown',
              'anonymization',
              'llm',
              'xml',
              'callback',
              'unknown'
            )
          );
        end if;
      end
      $$;
    `);
    await client.query(`
      create unique index if not exists processing_jobs_public_id_uidx
      on ${PROCESSING_JOBS_TABLE} (public_id)
    `);
    await client.query(`
      create unique index if not exists processing_jobs_correlation_id_uidx
      on ${PROCESSING_JOBS_TABLE} (correlation_id)
      where correlation_id is not null
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
      create index if not exists appels_offres_commercial_owner_user_idx
      on ${APPELS_OFFRES_TABLE} (commercial_owner_user_id, updated_at desc)
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
    await client.query(`
      create table if not exists ${COMMERCIAL_OWNERSHIP_EVENTS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references ${APPELS_OFFRES_TABLE}(id) on delete cascade,
        previous_owner_user_id bigint null references public.app_users(id) on delete set null,
        new_owner_user_id bigint not null references public.app_users(id) on delete restrict,
        changed_by_user_id bigint null references public.app_users(id) on delete set null,
        reason text null,
        metadata_jsonb jsonb null,
        created_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create index if not exists appel_offre_commercial_ownership_events_appel_idx
      on ${COMMERCIAL_OWNERSHIP_EVENTS_TABLE} (appel_offres_id, created_at desc)
    `);
    await client.query(`
      create index if not exists appel_offre_commercial_ownership_events_new_owner_idx
      on ${COMMERCIAL_OWNERSHIP_EVENTS_TABLE} (new_owner_user_id, created_at desc)
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
  await reapStaleProcessingJobs();
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        null::text as commercial_owner_status,
        status,
        business_status,
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        (
          select status
          from public.app_users owner_user
          where owner_user.id = ${APPELS_OFFRES_TABLE}.commercial_owner_user_id
        ) as commercial_owner_status,
        status,
        business_status,
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
  input: AppelOffresInput & {
    status: AppelOffresStatus;
    businessStatus?: AppelOffresBusinessStatus | null;
    source: AppelOffresSource;
  }
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        status,
        business_status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        null,
        null,
        null,
        null,
        null,
        null,
        $10,
        $11,
        $12,
        now(),
        now(),
        null,
        null
      )
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        null::text as commercial_owner_status,
        status,
        business_status,
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
      input.businessStatus ?? null,
      input.source
    ]
  );

  return mapAppelOffresRow(result.rows[0]);
}

export async function ensureAppelOffresRecord(
  input: AppelOffresInput & {
    status: AppelOffresStatus;
    businessStatus?: AppelOffresBusinessStatus | null;
    source: AppelOffresSource;
  }
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        status,
        business_status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        null,
        null,
        null,
        null,
        null,
        null,
        $10,
        $11,
        $12,
        now(),
        now(),
        null,
        null
      )
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
        business_status = coalesce(excluded.business_status, ${APPELS_OFFRES_TABLE}.business_status),
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        null::text as commercial_owner_status,
        status,
        business_status,
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
      input.businessStatus ?? null,
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        null::text as commercial_owner_status,
        status,
        business_status,
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

const FRENCH_MONTHS: Record<string, string> = {
  janvier: "01",
  fevrier: "02",
  "février": "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  aout: "08",
  "août": "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  decembre: "12",
  "décembre": "12"
};

function isValidCalendarDate(year: string, month: string, day: string) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Extracts a clean YYYY-MM-DD out of a free-text deadline field
// (e.g. "Lundi 20 avril 2026 a 12h00 precises, heure de Ouagadougou (GMT)"
// or "2026-08-01 12:00 GMT"). Returns null on anything that isn't
// confidently a single calendar date, rather than guessing.
export function parseExtractedDeadline(raw: string | null | undefined) {
  const value = raw?.trim();
  if (!value) {
    return null;
  }

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return isValidCalendarDate(year, month, day) ? `${year}-${month}-${day}` : null;
  }

  const frenchMatch = value.match(
    /(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i
  );
  if (frenchMatch) {
    const [, day, monthName, year] = frenchMatch;
    const month = FRENCH_MONTHS[monthName.toLowerCase()];
    const paddedDay = day.padStart(2, "0");
    if (month && isValidCalendarDate(year, month, paddedDay)) {
      return `${year}-${month}-${paddedDay}`;
    }
  }

  return null;
}

// Fills the dossier's title/buyer/country/due date from the validated Fiche
// CDC extraction (intitule_mission / client_maitre_ouvrage / pays /
// date_limite_depot). Only overwrites when the extracted value is non-empty
// (and, for the deadline, only when it parses to an unambiguous calendar
// date), so a placeholder-title/empty-buyer/unset-country dossier never gets
// blanked out again by a re-validation with missing or messy fields.
export async function applyValidatedExtractionIdentity(
  code: string,
  identity: {
    title: string | null;
    buyer: string | null;
    country?: string | null;
    deadline?: string | null;
  }
) {
  const pool = await requirePool();
  const title = identity.title?.trim() || null;
  const buyer = identity.buyer?.trim() || null;
  const country = identity.country?.trim() || null;
  const dueDate = parseExtractedDeadline(identity.deadline);
  const result = await pool.query<AppelOffresRow>(
    `
      update ${APPELS_OFFRES_TABLE}
      set
        title = coalesce($2, title),
        buyer = coalesce($3, buyer),
        country = coalesce($4, country),
        due_date = coalesce($5::date, due_date),
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        null::text as commercial_owner_status,
        status,
        business_status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
    `,
    [code, title, buyer, country, dueDate]
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        null::text as commercial_owner_status,
        status,
        business_status,
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

export async function setAppelOffresBusinessStatus(
  code: string,
  businessStatus: AppelOffresBusinessStatus,
  details: Record<string, unknown> | null = null
) {
  const pool = await requirePool();
  const current = await getAppelOffresRecordByCode(code, { includeArchived: true });
  const storedStatus = mapBusinessStatusToStoredStatus(businessStatus);
  const result = await pool.query<AppelOffresRow>(
    `
      update ${APPELS_OFFRES_TABLE}
      set
        status = $2,
        business_status = $3,
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        null::text as commercial_owner_status,
        status,
        business_status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
    `,
    [code, storedStatus, businessStatus]
  );

  const next = result.rows[0] ? mapAppelOffresRow(result.rows[0]) : null;

  if (current && next && current.businessStatus !== next.businessStatus) {
    await appendAuditLog(code, "appel_offres.business_status_changed", {
      previousBusinessStatus: current.businessStatus,
      nextBusinessStatus: next.businessStatus,
      previousStatus: current.status,
      nextStatus: next.status,
      ...(details ?? {})
    });
  }

  return next;
}

export async function archiveAppelOffres(
  code: string,
  options?: { businessStatus?: AppelOffresBusinessStatus }
) {
  const pool = await requirePool();
  const current = await getAppelOffresRecordByCode(code, { includeArchived: true });

  if (!current) {
    return null;
  }

  if (current.archivedAt) {
    return current;
  }

  const businessStatus = options?.businessStatus ?? "archive";
  const result = await pool.query<AppelOffresRow>(
    `
      update ${APPELS_OFFRES_TABLE}
      set
        status = 'archived',
        business_status = $2,
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        null::text as commercial_owner_status,
        status,
        business_status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
    `,
    [code, businessStatus]
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
        business_status = $3,
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        null::text as commercial_owner_status,
        status,
        business_status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
    `,
    [code, nextStatus, mapStoredStatusToBusinessStatus(nextStatus)]
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
  metadata: Record<string, unknown> | null = null,
  status: ProcessingJobStatus = "running"
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
        public_id,
        job_type,
        status,
        started_at,
        contract_version,
        correlation_id,
        execution_id,
        launch_accepted_at,
        callback_received_at,
        callback_status,
        callback_idempotency_key,
        retry_of_job_id,
        error_stage,
        error_code,
        error_message,
        metadata
      )
      values ($1, null, $2, $3, now(), null, null, null, null, null, null, null, null, null, null, null, $4::jsonb)
      returning
        id,
        appel_offres_id,
        public_id,
        job_type,
        status,
        started_at,
        finished_at,
        contract_version,
        correlation_id,
        execution_id,
        launch_accepted_at,
        callback_received_at,
        callback_status,
        callback_idempotency_key,
        retry_of_job_id,
        error_stage,
        error_code,
        error_message,
        metadata
    `,
    [appelOffresId, jobType, status, metadata ? JSON.stringify(metadata) : null]
  );

  return mapProcessingJobRow(result.rows[0]);
}

export async function createContractProcessingJobByCode(
  code: string,
  input: {
    publicId: string;
    jobType: ProcessingJobType;
    status: ProcessingJobStatus;
    contractVersion: string;
    correlationId: string;
    retryOfJobId?: number | null;
    metadata?: Record<string, unknown> | null;
  }
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
        public_id,
        job_type,
        status,
        started_at,
        contract_version,
        correlation_id,
        retry_of_job_id,
        metadata
      )
      values ($1, $2, $3, $4, now(), $5, $6, $7, $8::jsonb)
      returning
        id,
        appel_offres_id,
        public_id,
        job_type,
        status,
        started_at,
        finished_at,
        contract_version,
        correlation_id,
        execution_id,
        launch_accepted_at,
        callback_received_at,
        callback_status,
        callback_idempotency_key,
        retry_of_job_id,
        error_stage,
        error_code,
        error_message,
        metadata
    `,
    [
      appelOffresId,
      input.publicId,
      input.jobType,
      input.status,
      input.contractVersion,
      input.correlationId,
      input.retryOfJobId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null
    ]
  );

  return mapProcessingJobRow(result.rows[0]);
}

export async function finishProcessingJob(
  jobId: number,
  status: Exclude<ProcessingJobStatus, "created" | "queued" | "running" | "retrying">,
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
        public_id,
        job_type,
        status,
        started_at,
        finished_at,
        contract_version,
        correlation_id,
        execution_id,
        launch_accepted_at,
        callback_received_at,
        callback_status,
        callback_idempotency_key,
        retry_of_job_id,
        error_stage,
        error_code,
        error_message,
        metadata
    `,
    [jobId, status, errorMessage ?? null]
  );

  return result.rows[0] ? mapProcessingJobRow(result.rows[0]) : null;
}

export async function getProcessingJobByPublicId(publicId: string) {
  const pool = await requirePool();
  const result = await pool.query<ProcessingJobRow>(
    `
      select
        id,
        appel_offres_id,
        public_id,
        job_type,
        status,
        started_at,
        finished_at,
        contract_version,
        correlation_id,
        execution_id,
        launch_accepted_at,
        callback_received_at,
        callback_status,
        callback_idempotency_key,
        retry_of_job_id,
        error_stage,
        error_code,
        error_message,
        metadata
      from ${PROCESSING_JOBS_TABLE}
      where public_id = $1
      limit 1
    `,
    [publicId]
  );

  return result.rows[0] ? mapProcessingJobRow(result.rows[0]) : null;
}

export async function updateProcessingJobByPublicId(
  publicId: string,
  patch: {
    status?: ProcessingJobStatus;
    executionId?: string | null;
    contractVersion?: string | null;
    launchAcceptedAt?: string | null;
    callbackReceivedAt?: string | null;
    callbackStatus?: ProcessingJobCallbackStatus | null;
    callbackIdempotencyKey?: string | null;
    errorStage?: ProcessingJobErrorStage | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    finishedAt?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  const pool = await requirePool();
  const current = await getProcessingJobByPublicId(publicId);
  if (!current) {
    return null;
  }

  const nextMetadata =
    patch.metadata === undefined
      ? current.metadata
      : {
          ...(current.metadata ?? {}),
          ...(patch.metadata ?? {})
        };

  const result = await pool.query<ProcessingJobRow>(
    `
      update ${PROCESSING_JOBS_TABLE}
      set
        status = $2,
        execution_id = $3,
        contract_version = $4,
        launch_accepted_at = $5,
        callback_received_at = $6,
        callback_status = $7,
        callback_idempotency_key = $8,
        error_stage = $9,
        error_code = $10,
        error_message = $11,
        finished_at = $12,
        metadata = $13::jsonb
      where public_id = $1
      returning
        id,
        appel_offres_id,
        public_id,
        job_type,
        status,
        started_at,
        finished_at,
        contract_version,
        correlation_id,
        execution_id,
        launch_accepted_at,
        callback_received_at,
        callback_status,
        callback_idempotency_key,
        retry_of_job_id,
        error_stage,
        error_code,
        error_message,
        metadata
    `,
    [
      publicId,
      patch.status ?? current.status,
      patch.executionId === undefined ? current.executionId : patch.executionId,
      patch.contractVersion === undefined
        ? current.contractVersion
        : patch.contractVersion,
      patch.launchAcceptedAt === undefined
        ? current.launchAcceptedAt
        : patch.launchAcceptedAt,
      patch.callbackReceivedAt === undefined
        ? current.callbackReceivedAt
        : patch.callbackReceivedAt,
      patch.callbackStatus === undefined ? current.callbackStatus : patch.callbackStatus,
      patch.callbackIdempotencyKey === undefined
        ? current.callbackIdempotencyKey
        : patch.callbackIdempotencyKey,
      patch.errorStage === undefined ? current.errorStage : patch.errorStage,
      patch.errorCode === undefined ? current.errorCode : patch.errorCode,
      patch.errorMessage === undefined ? current.errorMessage : patch.errorMessage,
      patch.finishedAt === undefined ? current.finishedAt : patch.finishedAt,
      nextMetadata ? JSON.stringify(nextMetadata) : null
    ]
  );

  return result.rows[0] ? mapProcessingJobRow(result.rows[0]) : null;
}

export async function finishLatestProcessingJobByCode(
  code: string,
  jobType: ProcessingJobType,
  status: Exclude<ProcessingJobStatus, "created" | "queued" | "running" | "retrying">,
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
      where appel_offres_id = $1
        and job_type = $2
        and status in ('created', 'queued', 'running', 'retrying')
      order by started_at desc, id desc
      limit 1
    `,
    [appelOffresId, jobType]
  );

  if (!latest.rows[0]) {
    return null;
  }

  return finishProcessingJob(Number(latest.rows[0].id), status, errorMessage);
}

export async function getLatestProcessingJobByCode(
  code: string,
  jobType?: ProcessingJobType
) {
  const pool = await requirePool();
  const appelOffresId = await getAppelOffresIdByCode(code, true);

  if (!appelOffresId) {
    return null;
  }

  const values: Array<number | string> = [appelOffresId];
  let jobTypeClause = "";
  if (jobType) {
    values.push(jobType);
    jobTypeClause = `and job_type = $2`;
  }

  const result = await pool.query<ProcessingJobRow>(
    `
      select
        id,
        appel_offres_id,
        public_id,
        job_type,
        status,
        started_at,
        finished_at,
        contract_version,
        correlation_id,
        execution_id,
        launch_accepted_at,
        callback_received_at,
        callback_status,
        callback_idempotency_key,
        retry_of_job_id,
        error_stage,
        error_code,
        error_message,
        metadata
      from ${PROCESSING_JOBS_TABLE}
      where appel_offres_id = $1
        ${jobTypeClause}
      order by started_at desc, id desc
      limit 1
    `,
    values
  );

  return result.rows[0] ? mapProcessingJobRow(result.rows[0]) : null;
}

export async function getActiveProcessingJobByCode(
  code: string,
  jobType?: ProcessingJobType
) {
  const pool = await requirePool();
  const appelOffresId = await getAppelOffresIdByCode(code, true);

  if (!appelOffresId) {
    return null;
  }

  const values: Array<number | string> = [appelOffresId];
  let jobTypeClause = "";
  if (jobType) {
    values.push(jobType);
    jobTypeClause = `and job_type = $2`;
  }

  const result = await pool.query<ProcessingJobRow>(
    `
      select
        id,
        appel_offres_id,
        public_id,
        job_type,
        status,
        started_at,
        finished_at,
        contract_version,
        correlation_id,
        execution_id,
        launch_accepted_at,
        callback_received_at,
        callback_status,
        callback_idempotency_key,
        retry_of_job_id,
        error_stage,
        error_code,
        error_message,
        metadata
      from ${PROCESSING_JOBS_TABLE}
      where appel_offres_id = $1
        ${jobTypeClause}
        and status in ('created', 'queued', 'running', 'retrying')
      order by started_at desc, id desc
      limit 1
    `,
    values
  );

  return result.rows[0] ? mapProcessingJobRow(result.rows[0]) : null;
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function getProcessingJobTimeoutMinutes() {
  return readPositiveIntegerEnv("PROCESSING_JOB_TIMEOUT_MINUTES", 15);
}

// Self-healing check, not a background worker: called from the main read paths
// (listAppelsOffres, getAppelOffresDetailByCode) so a tender never spins in
// "En cours d'analyse" forever just because its callback never arrived (wrong
// PLATFORM_PUBLIC_BASE_URL, a downed pipeline service, etc.). Any job still
// running/queued past PROCESSING_JOB_TIMEOUT_MINUTES is marked failed and its
// tender moves out of analyse_en_cours into the calm "erreur" ("A verifier")
// state via the same setAppelOffresBusinessStatus path (and audit log) every
// other status transition uses.
export async function reapStaleProcessingJobs() {
  const timeoutMinutes = getProcessingJobTimeoutMinutes();
  const pool = await requirePool();

  const staleJobs = await pool.query<{
    id: number;
    appel_offres_id: number;
    public_id: string | null;
  }>(
    `
      update ${PROCESSING_JOBS_TABLE}
      set
        status = 'failed',
        finished_at = now(),
        callback_status = 'failed',
        error_stage = 'callback',
        error_code = 'PROCESSING_JOB_TIMEOUT',
        error_message = $1
      where status in ('created', 'queued', 'running', 'retrying')
        and started_at < now() - (interval '1 minute' * $2::int)
      returning id, appel_offres_id, public_id
    `,
    [
      `Aucun callback recu dans le delai imparti (${timeoutMinutes} minutes).`,
      timeoutMinutes
    ]
  );

  if (staleJobs.rows.length === 0) {
    return [];
  }

  const affectedAppelOffresIds = [
    ...new Set(staleJobs.rows.map((row) => Number(row.appel_offres_id)))
  ];

  const affectedTenders = await pool.query<{
    code: string;
    business_status: AppelOffresBusinessStatus | null;
  }>(
    `
      select code, business_status
      from ${APPELS_OFFRES_TABLE}
      where id = any($1::bigint[])
    `,
    [affectedAppelOffresIds]
  );

  for (const tender of affectedTenders.rows) {
    if (tender.business_status === "analyse_en_cours") {
      await setAppelOffresBusinessStatus(tender.code, "erreur", {
        reason: "processing_job_timeout",
        timeoutMinutes
      });
    }
  }

  return staleJobs.rows;
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
        public_id,
        job_type,
        status,
        started_at,
        finished_at,
        contract_version,
        correlation_id,
        execution_id,
        launch_accepted_at,
        callback_received_at,
        callback_status,
        callback_idempotency_key,
        retry_of_job_id,
        error_stage,
        error_code,
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

export async function getCommercialOwnerViewByCode(
  code: string
): Promise<AppelOffresCommercialOwnerView | null> {
  const pool = await requirePool();
  const result = await pool.query<CommercialOwnerViewRow>(
    `
      select
        appels.commercial_owner_user_id,
        owner_user.display_name as owner_display_name,
        owner_user.email as owner_email,
        owner_user.job_title as owner_job_title,
        case when owner_user.role = 'COMMERCIAL' then owner_user.role else null end as owner_role,
        owner_user.status as owner_status,
        appels.commercial_owner_assigned_at,
        appels.commercial_owner_assigned_by_user_id,
        assigned_by.display_name as assigned_by_name,
        appels.commercial_owner_previous_user_id,
        previous_owner.display_name as previous_owner_name,
        appels.commercial_owner_reason,
        appels.commercial_owner_updated_at,
        appels.responsable_commercial as legacy_responsable_commercial
      from ${APPELS_OFFRES_TABLE} appels
      left join public.app_users owner_user on owner_user.id = appels.commercial_owner_user_id
      left join public.app_users assigned_by on assigned_by.id = appels.commercial_owner_assigned_by_user_id
      left join public.app_users previous_owner on previous_owner.id = appels.commercial_owner_previous_user_id
      where appels.code = $1
      limit 1
    `,
    [code]
  );

  return result.rows[0] ? mapCommercialOwnerViewRow(result.rows[0]) : null;
}

export async function updateCommercialOwnerByCode(input: {
  code: string;
  commercialOwnerUserId: number | null;
  assignedAt: string | null;
  assignedByUserId: number | null;
  previousOwnerUserId: number | null;
  reason: string | null;
  updatedAt: string;
  legacyResponsibleLabel?: string | null;
}) {
  const pool = await requirePool();
  const result = await pool.query<AppelOffresRow>(
    `
      update ${APPELS_OFFRES_TABLE}
      set
        commercial_owner_user_id = $2,
        commercial_owner_assigned_at = $3,
        commercial_owner_assigned_by_user_id = $4,
        commercial_owner_previous_user_id = $5,
        commercial_owner_reason = $6,
        commercial_owner_updated_at = $7,
        responsable_commercial = coalesce($8, responsable_commercial),
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        (
          select status
          from public.app_users owner_user
          where owner_user.id = ${APPELS_OFFRES_TABLE}.commercial_owner_user_id
        ) as commercial_owner_status,
        status,
        business_status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
    `,
    [
      input.code,
      input.commercialOwnerUserId,
      input.assignedAt,
      input.assignedByUserId,
      input.previousOwnerUserId,
      input.reason,
      input.updatedAt,
      input.legacyResponsibleLabel ?? null
    ]
  );

  return result.rows[0] ? mapAppelOffresRow(result.rows[0]) : null;
}

export async function appendCommercialOwnershipEvent(input: {
  code: string;
  previousOwnerUserId: number | null;
  newOwnerUserId: number;
  changedByUserId: number | null;
  reason: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const pool = await requirePool();
  const appelOffresId = await getAppelOffresIdByCode(input.code, true);
  if (!appelOffresId) {
    throw new Error(`Appel d'offres ${input.code} introuvable.`);
  }

  await pool.query(
    `
      insert into ${COMMERCIAL_OWNERSHIP_EVENTS_TABLE} (
        appel_offres_id,
        previous_owner_user_id,
        new_owner_user_id,
        changed_by_user_id,
        reason,
        metadata_jsonb,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, now())
    `,
    [
      appelOffresId,
      input.previousOwnerUserId,
      input.newOwnerUserId,
      input.changedByUserId,
      input.reason,
      input.metadata ? JSON.stringify(input.metadata) : null
    ]
  );
}

export async function listCommercialOwnershipEventsByCode(
  code: string
): Promise<AppelOffresCommercialOwnershipEventRecord[]> {
  const pool = await requirePool();
  const result = await pool.query<CommercialOwnershipEventRow>(
    `
      select
        events.id,
        events.appel_offres_id,
        appels.code as appel_offres_code,
        events.previous_owner_user_id,
        previous_owner.display_name as previous_owner_name,
        events.new_owner_user_id,
        new_owner.display_name as new_owner_name,
        events.changed_by_user_id,
        changed_by.display_name as changed_by_name,
        events.reason,
        events.metadata_jsonb,
        events.created_at
      from ${COMMERCIAL_OWNERSHIP_EVENTS_TABLE} events
      inner join ${APPELS_OFFRES_TABLE} appels on appels.id = events.appel_offres_id
      left join public.app_users previous_owner on previous_owner.id = events.previous_owner_user_id
      left join public.app_users new_owner on new_owner.id = events.new_owner_user_id
      left join public.app_users changed_by on changed_by.id = events.changed_by_user_id
      where appels.code = $1
      order by events.created_at desc, events.id desc
    `,
    [code]
  );

  return result.rows.map(mapCommercialOwnershipEventRow);
}

export async function countActiveAppelOffresByCommercialOwnerUserId(userId: number) {
  const pool = await requirePool();
  const result = await pool.query<{ count: string }>(
    `
      select count(*)::text as count
      from ${APPELS_OFFRES_TABLE}
      where commercial_owner_user_id = $1
        and archived_at is null
        and deleted_at is null
    `,
    [userId]
  );

  return Number(result.rows[0]?.count ?? 0);
}

export async function listActiveAppelOffresByCommercialOwnerUserId(userId: number) {
  const pool = await requirePool();
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
        commercial_owner_user_id,
        commercial_owner_assigned_at,
        commercial_owner_assigned_by_user_id,
        commercial_owner_previous_user_id,
        commercial_owner_reason,
        commercial_owner_updated_at,
        (
          select status
          from public.app_users owner_user
          where owner_user.id = ${APPELS_OFFRES_TABLE}.commercial_owner_user_id
        ) as commercial_owner_status,
        status,
        business_status,
        source,
        created_at,
        updated_at,
        archived_at,
        deleted_at
      from ${APPELS_OFFRES_TABLE}
      where commercial_owner_user_id = $1
        and archived_at is null
        and deleted_at is null
      order by updated_at desc, id desc
    `,
    [userId]
  );

  return result.rows.map(mapAppelOffresRow);
}

export async function getAppelOffresDetailByCode(
  code: string,
  options: FindByCodeOptions = {}
): Promise<AppelOffresDetail | null> {
  await reapStaleProcessingJobs();
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
