import { Pool, type PoolClient } from "pg";
import {
  ensureAppelsOffresSchema,
  getAppelOffresRecordByCode,
  getProcessingJobTimeoutMinutes
} from "../repository.ts";
import type { AppelOffresRecord } from "../types.ts";
import {
  getEnabledFciModuleCodes,
  getFciModuleTypeFromCode,
  isKnowledgeBaseEnabled
} from "./validation.ts";
import { calculateFciOverallStatus, indexLatestModuleData } from "./presentation.ts";
import type {
  AppendFciAuditEventInput,
  CreateFciGenerationJobInput,
  FciAuditEventRecord,
  FciDetail,
  FciGenerationJobRecord,
  FciGenerationJobStatus,
  FciJsonObject,
  FciModuleCode,
  FciModuleDataRecord,
  FciModuleRecord,
  FciModuleStatus,
  FciSetOverallStatus,
  FciSetRecord,
  InitializeFciSetInput,
  UpdateFciGenerationJobInput,
  UpsertFciModuleDataInput
} from "./types.ts";

const FCI_SETS_TABLE = "public.fci_sets";
const FCI_MODULES_TABLE = "public.fci_modules";
const FCI_MODULE_DATA_TABLE = "public.fci_module_data";
const FCI_GENERATION_JOBS_TABLE = "public.fci_generation_jobs";
const FCI_AUDIT_EVENTS_TABLE = "public.fci_audit_events";

type GlobalWithPool = typeof globalThis & {
  __appelsOffresFciPool?: Pool;
  __appelsOffresFciSetupPromise?: Promise<void>;
};

type FciSetRow = {
  id: number | string;
  appel_offres_id: number | string;
  source_fiche_version: string;
  source_fiche_hash: string;
  source_fiche_updated_at: string | Date;
  overall_status: FciSetOverallStatus;
  created_at: string | Date;
  updated_at: string | Date;
};

type FciModuleRow = {
  id: number | string;
  fci_set_id: number | string;
  module_code: FciModuleRecord["moduleCode"];
  module_type: FciModuleRecord["moduleType"];
  status: FciModuleRecord["status"];
  ai_generated_at: string | Date | null;
  validated_at: string | Date | null;
  validated_by: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type FciModuleDataRow = {
  id: number | string;
  fci_module_id: number | string;
  data_json: FciJsonObject;
  source_summary_json: FciJsonObject | null;
  confidence_json: FciJsonObject | null;
  ai_notes_json: FciJsonObject | null;
  version: number;
  generated_from_fiche_version: string | null;
  generated_from_fiche_hash: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type FciGenerationJobRow = {
  id: number | string;
  fci_module_id: number | string;
  trigger_type: FciGenerationJobRecord["triggerType"];
  provider: string;
  model: string;
  status: FciGenerationJobStatus;
  contract_version: string | null;
  schema_version: string | null;
  prompt_version: string | null;
  generation_parameters: FciJsonObject | null;
  source_fiche_version: string | null;
  source_fiche_hash: string | null;
  execution_id: string | null;
  correlation_id: string | null;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  callback_received_at: string | Date | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string | Date;
};

type FciAuditEventRow = {
  id: number | string;
  appel_offres_id: number | string;
  fci_module_id: number | string | null;
  event_type: string;
  actor: string | null;
  payload_json: FciJsonObject | null;
  created_at: string | Date;
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
  if (!globalWithPool.__appelsOffresFciPool) {
    globalWithPool.__appelsOffresFciPool = new Pool({
      connectionString: databaseUrl
    });
  }

  return globalWithPool.__appelsOffresFciPool;
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (value == null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapFciSetRow(row: FciSetRow): FciSetRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    sourceFicheVersion: row.source_fiche_version,
    sourceFicheHash: row.source_fiche_hash,
    sourceFicheUpdatedAt:
      normalizeTimestamp(row.source_fiche_updated_at) ?? new Date(0).toISOString(),
    overallStatus: row.overall_status,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString()
  };
}

function mapFciModuleRow(row: FciModuleRow): FciModuleRecord {
  return {
    id: Number(row.id),
    fciSetId: Number(row.fci_set_id),
    moduleCode: row.module_code,
    moduleType: row.module_type,
    status: row.status,
    aiGeneratedAt: normalizeTimestamp(row.ai_generated_at),
    validatedAt: normalizeTimestamp(row.validated_at),
    validatedBy: row.validated_by,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString()
  };
}

function mapFciModuleDataRow(row: FciModuleDataRow): FciModuleDataRecord {
  return {
    id: Number(row.id),
    fciModuleId: Number(row.fci_module_id),
    dataJson: row.data_json,
    sourceSummaryJson: row.source_summary_json,
    confidenceJson: row.confidence_json,
    aiNotesJson: row.ai_notes_json,
    version: row.version,
    generatedFromFicheVersion: row.generated_from_fiche_version,
    generatedFromFicheHash: row.generated_from_fiche_hash,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString()
  };
}

function mapFciGenerationJobRow(row: FciGenerationJobRow): FciGenerationJobRecord {
  return {
    id: Number(row.id),
    fciModuleId: Number(row.fci_module_id),
    triggerType: row.trigger_type,
    provider: row.provider,
    model: row.model,
    status: row.status,
    contractVersion: row.contract_version,
    schemaVersion: row.schema_version,
    promptVersion: row.prompt_version,
    generationParameters: row.generation_parameters,
    sourceFicheVersion: row.source_fiche_version,
    sourceFicheHash: row.source_fiche_hash,
    executionId: row.execution_id,
    correlationId: row.correlation_id,
    startedAt: normalizeTimestamp(row.started_at),
    completedAt: normalizeTimestamp(row.completed_at),
    callbackReceivedAt: normalizeTimestamp(row.callback_received_at),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString()
  };
}

function mapFciAuditEventRow(row: FciAuditEventRow): FciAuditEventRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    fciModuleId: row.fci_module_id == null ? null : Number(row.fci_module_id),
    eventType: row.event_type,
    actor: row.actor,
    payloadJson: row.payload_json,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString()
  };
}

async function ensureSchemaInternal(pool: Pool) {
  const client = await pool.connect();

  try {
    await client.query(`
      create table if not exists ${FCI_SETS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        source_fiche_version text not null,
        source_fiche_hash text not null,
        source_fiche_updated_at timestamptz not null,
        overall_status text not null check (
          overall_status in ('not_started', 'in_progress', 'needs_review', 'validated', 'failed')
        ) default 'not_started',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (appel_offres_id)
      )
    `);
    await client.query(`
      create table if not exists ${FCI_MODULES_TABLE} (
        id bigserial primary key,
        fci_set_id bigint not null references ${FCI_SETS_TABLE}(id) on delete cascade,
        module_code text not null check (module_code in ('A', 'B', 'C', 'D', 'E')),
        module_type text not null check (
          module_type in ('commercial', 'finance', 'operations', 'strategy', 'experience')
        ),
        status text not null check (
          status in ('not_started', 'generating', 'generated', 'needs_review', 'validated', 'failed', 'unavailable')
        ) default 'not_started',
        ai_generated_at timestamptz null,
        validated_at timestamptz null,
        validated_by text null,
        error_code text null,
        error_message text null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (fci_set_id, module_code)
      )
    `);
    await client.query(`
      create table if not exists ${FCI_MODULE_DATA_TABLE} (
        id bigserial primary key,
        fci_module_id bigint not null references ${FCI_MODULES_TABLE}(id) on delete cascade,
        data_json jsonb not null default '{}'::jsonb,
        source_summary_json jsonb null,
        confidence_json jsonb null,
        ai_notes_json jsonb null,
        version integer not null default 1,
        generated_from_fiche_version text null,
        generated_from_fiche_hash text null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create table if not exists ${FCI_GENERATION_JOBS_TABLE} (
        id bigserial primary key,
        fci_module_id bigint not null references ${FCI_MODULES_TABLE}(id) on delete cascade,
        trigger_type text not null check (
          trigger_type in ('manual', 'automatic', 'regeneration')
        ),
        provider text not null,
        model text not null,
        status text not null check (
          status in ('pending_integration', 'created', 'queued', 'running', 'completed', 'failed', 'cancelled')
        ) default 'created',
        execution_id text null,
        correlation_id text null,
        started_at timestamptz null,
        completed_at timestamptz null,
        error_code text null,
        error_message text null,
        created_at timestamptz not null default now()
      )
    `);
    await client.query(`
      alter table ${FCI_GENERATION_JOBS_TABLE}
      add column if not exists contract_version text null
    `);
    await client.query(`
      alter table ${FCI_GENERATION_JOBS_TABLE}
      add column if not exists schema_version text null
    `);
    await client.query(`
      alter table ${FCI_GENERATION_JOBS_TABLE}
      add column if not exists prompt_version text null
    `);
    await client.query(`
      alter table ${FCI_GENERATION_JOBS_TABLE}
      add column if not exists generation_parameters jsonb null
    `);
    await client.query(`
      alter table ${FCI_GENERATION_JOBS_TABLE}
      add column if not exists source_fiche_version text null
    `);
    await client.query(`
      alter table ${FCI_GENERATION_JOBS_TABLE}
      add column if not exists source_fiche_hash text null
    `);
    await client.query(`
      alter table ${FCI_GENERATION_JOBS_TABLE}
      add column if not exists callback_received_at timestamptz null
    `);
    await client.query(`
      alter table ${FCI_MODULE_DATA_TABLE}
      drop constraint if exists fci_module_data_fci_module_id_key
    `);
    await client.query(`
      create unique index if not exists fci_module_data_module_version_uidx
      on ${FCI_MODULE_DATA_TABLE} (fci_module_id, version)
    `);
    await client.query(`
      create index if not exists fci_module_data_module_created_at_idx
      on ${FCI_MODULE_DATA_TABLE} (fci_module_id, created_at desc, id desc)
    `);
    await client.query(`
      do $$
      begin
        if not exists (
          select 1
          from pg_constraint
          where conname = 'fci_generation_jobs_status_check'
            and conrelid = '${FCI_GENERATION_JOBS_TABLE}'::regclass
        ) then
          alter table ${FCI_GENERATION_JOBS_TABLE}
          add constraint fci_generation_jobs_status_check
          check (
            status in (
              'pending_integration',
              'created',
              'queued',
              'running',
              'completed',
              'failed',
              'cancelled'
            )
          );
        end if;
      end
      $$;
    `);
    await client.query(`
      create table if not exists ${FCI_AUDIT_EVENTS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        fci_module_id bigint null references ${FCI_MODULES_TABLE}(id) on delete set null,
        event_type text not null,
        actor text null,
        payload_json jsonb null,
        created_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create index if not exists fci_sets_appel_offres_id_idx
      on ${FCI_SETS_TABLE} (appel_offres_id)
    `);
    await client.query(`
      create index if not exists fci_modules_module_code_idx
      on ${FCI_MODULES_TABLE} (module_code)
    `);
    await client.query(`
      create index if not exists fci_modules_status_idx
      on ${FCI_MODULES_TABLE} (status)
    `);
    await client.query(`
      create index if not exists fci_modules_fci_set_id_idx
      on ${FCI_MODULES_TABLE} (fci_set_id, created_at desc)
    `);
    await client.query(`
      create index if not exists fci_generation_jobs_fci_module_status_idx
      on ${FCI_GENERATION_JOBS_TABLE} (fci_module_id, status, created_at desc)
    `);
    await client.query(`
      create unique index if not exists fci_generation_jobs_correlation_id_uidx
      on ${FCI_GENERATION_JOBS_TABLE} (correlation_id)
      where correlation_id is not null
    `);
    // At most one active (non-terminal) generation job per module. The
    // application already checks this before creating a job, but that
    // check-then-insert isn't atomic - a rapid double-click on "Réessayer la
    // génération" could otherwise race two concurrent launches through. This
    // index turns the second insert into a clean unique-violation instead,
    // which createFciGenerationJob translates into the existing
    // FCI_ALREADY_GENERATING error.
    await client.query(`
      create unique index if not exists fci_generation_jobs_module_active_uidx
      on ${FCI_GENERATION_JOBS_TABLE} (fci_module_id)
      where status in ('created', 'queued', 'running')
    `);
    await client.query(`
      create index if not exists fci_audit_events_appel_offres_created_at_idx
      on ${FCI_AUDIT_EVENTS_TABLE} (appel_offres_id, created_at desc)
    `);
    await client.query(`
      create index if not exists fci_audit_events_fci_module_created_at_idx
      on ${FCI_AUDIT_EVENTS_TABLE} (fci_module_id, created_at desc)
    `);
  } finally {
    client.release();
  }
}

export async function ensureFciSchema() {
  await ensureAppelsOffresSchema();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const globalWithPool = globalThis as GlobalWithPool;
  if (!globalWithPool.__appelsOffresFciSetupPromise) {
    globalWithPool.__appelsOffresFciSetupPromise = ensureSchemaInternal(pool).catch(
      (error) => {
        globalWithPool.__appelsOffresFciSetupPromise = undefined;
        throw error;
      }
    );
  }

  await globalWithPool.__appelsOffresFciSetupPromise;
}

async function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  await ensureFciSchema();
  return pool;
}

async function requireAppelOffresRecord(code: string) {
  const appel = await getAppelOffresRecordByCode(code, { includeArchived: true });
  if (!appel) {
    throw new Error("Appel d'offres introuvable.");
  }

  return appel;
}

export type FciModuleContext = {
  appelOffres: AppelOffresRecord;
  set: FciSetRecord;
  module: FciModuleRecord;
};

export type FciGenerationJobContext = {
  appelOffres: AppelOffresRecord;
  set: FciSetRecord;
  module: FciModuleRecord;
  job: FciGenerationJobRecord;
};

async function listModulesBySetIdWithClient(client: PoolClient, fciSetId: number) {
  const result = await client.query<FciModuleRow>(
    `
      select
        id,
        fci_set_id,
        module_code,
        module_type,
        status,
        ai_generated_at,
        validated_at,
        validated_by,
        error_code,
        error_message,
        created_at,
        updated_at
      from ${FCI_MODULES_TABLE}
      where fci_set_id = $1
      order by module_code asc
    `,
    [fciSetId]
  );

  return result.rows.map(mapFciModuleRow);
}

export async function listFciOverallStatusesByAppelOffresCodes(
  codes: string[]
): Promise<Map<string, FciSetOverallStatus>> {
  if (codes.length === 0) {
    return new Map();
  }

  // Self-heals here because this is the single shared read path for both the
  // dashboard and the /appels-offres list - the two views that would otherwise
  // keep showing "En cours d'analyse" forever for a tender stuck on a dead FCI
  // generation job.
  await reapStaleFciGenerationJobs();

  const pool = await requirePool();
  const result = await pool.query<{ code: string; overall_status: FciSetOverallStatus }>(
    `
      select appels.code as code, sets.overall_status as overall_status
      from ${FCI_SETS_TABLE} sets
      inner join public.appels_offres appels on appels.id = sets.appel_offres_id
      where appels.code = any($1::text[])
    `,
    [codes]
  );

  const statusByCode = new Map<string, FciSetOverallStatus>();
  for (const row of result.rows) {
    statusByCode.set(row.code, row.overall_status);
  }

  return statusByCode;
}

// Per-module counterpart of listFciOverallStatusesByAppelOffresCodes: used to build
// each department's own FCI queue (for the active human workflow, modules A/B/C/D)
// instead of the tender's overall FCI status across all modules.
export async function listFciModuleStatusesByAppelOffresCodes(
  codes: string[],
  moduleCode: FciModuleCode
): Promise<Map<string, FciModuleStatus>> {
  if (codes.length === 0) {
    return new Map();
  }

  const pool = await requirePool();
  const result = await pool.query<{ code: string; status: FciModuleStatus }>(
    `
      select appels.code as code, modules.status as status
      from ${FCI_MODULES_TABLE} modules
      inner join ${FCI_SETS_TABLE} sets on sets.id = modules.fci_set_id
      inner join public.appels_offres appels on appels.id = sets.appel_offres_id
      where appels.code = any($1::text[])
        and modules.module_code = $2
    `,
    [codes, moduleCode]
  );

  const statusByCode = new Map<string, FciModuleStatus>();
  for (const row of result.rows) {
    statusByCode.set(row.code, row.status);
  }

  return statusByCode;
}

export async function getFciSetByAppelOffresCode(code: string) {
  const appel = await requireAppelOffresRecord(code);
  const pool = await requirePool();
  const result = await pool.query<FciSetRow>(
    `
      select
        id,
        appel_offres_id,
        source_fiche_version,
        source_fiche_hash,
        source_fiche_updated_at,
        overall_status,
        created_at,
        updated_at
      from ${FCI_SETS_TABLE}
      where appel_offres_id = $1
      limit 1
    `,
    [appel.id]
  );

  return result.rows[0] ? mapFciSetRow(result.rows[0]) : null;
}

export async function listFciModulesByAppelOffresCode(code: string) {
  const fciSet = await getFciSetByAppelOffresCode(code);
  if (!fciSet) {
    return [];
  }

  const pool = await requirePool();
  const result = await pool.query<FciModuleRow>(
    `
      select
        id,
        fci_set_id,
        module_code,
        module_type,
        status,
        ai_generated_at,
        validated_at,
        validated_by,
        error_code,
        error_message,
        created_at,
        updated_at
      from ${FCI_MODULES_TABLE}
      where fci_set_id = $1
      order by module_code asc
    `,
    [fciSet.id]
  );

  return result.rows.map(mapFciModuleRow);
}

export async function initializeFciSetByAppelOffresCode(
  code: string,
  input: InitializeFciSetInput
) {
  const appel = await requireAppelOffresRecord(code);
  const pool = await requirePool();
  const client = await pool.connect();
  const enabledCodes = getEnabledFciModuleCodes({
    knowledgeBaseEnabled:
      input.knowledgeBaseEnabled ?? isKnowledgeBaseEnabled()
  });

  try {
    await client.query("begin");

    const setResult = await client.query<FciSetRow>(
      `
        insert into ${FCI_SETS_TABLE} (
          appel_offres_id,
          source_fiche_version,
          source_fiche_hash,
          source_fiche_updated_at,
          overall_status,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5, now(), now())
        on conflict (appel_offres_id)
        do update set
          source_fiche_version = excluded.source_fiche_version,
          source_fiche_hash = excluded.source_fiche_hash,
          source_fiche_updated_at = excluded.source_fiche_updated_at,
          overall_status = excluded.overall_status,
          updated_at = now()
        returning
          id,
          appel_offres_id,
          source_fiche_version,
          source_fiche_hash,
          source_fiche_updated_at,
          overall_status,
          created_at,
          updated_at
      `,
      [
        appel.id,
        input.sourceFicheVersion,
        input.sourceFicheHash,
        input.sourceFicheUpdatedAt,
        input.overallStatus ?? "not_started"
      ]
    );

    const fciSet = mapFciSetRow(setResult.rows[0]);

    for (const moduleCode of enabledCodes) {
      await client.query(
        `
          insert into ${FCI_MODULES_TABLE} (
            fci_set_id,
            module_code,
            module_type,
            status,
            created_at,
            updated_at
          )
          values ($1, $2, $3, 'not_started', now(), now())
          on conflict (fci_set_id, module_code)
          do nothing
        `,
        [fciSet.id, moduleCode, getFciModuleTypeFromCode(moduleCode)]
      );
    }

    await client.query("commit");
    const modules = await listModulesBySetIdWithClient(client, fciSet.id);

    return {
      set: fciSet,
      modules
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function getFciModuleByAppelOffresCode(
  code: string,
  moduleCode: FciModuleRecord["moduleCode"]
) {
  const appel = await requireAppelOffresRecord(code);
  const pool = await requirePool();
  const result = await pool.query<FciModuleRow>(
    `
      select
        modules.id,
        modules.fci_set_id,
        modules.module_code,
        modules.module_type,
        modules.status,
        modules.ai_generated_at,
        modules.validated_at,
        modules.validated_by,
        modules.error_code,
        modules.error_message,
        modules.created_at,
        modules.updated_at
      from ${FCI_MODULES_TABLE} as modules
      inner join ${FCI_SETS_TABLE} as sets on sets.id = modules.fci_set_id
      where sets.appel_offres_id = $1
        and modules.module_code = $2
      limit 1
    `,
    [appel.id, moduleCode]
  );

  return result.rows[0] ? mapFciModuleRow(result.rows[0]) : null;
}

export async function getFciModuleContextByAppelOffresCode(
  code: string,
  moduleCode: FciModuleRecord["moduleCode"]
): Promise<FciModuleContext | null> {
  const appelOffres = await requireAppelOffresRecord(code);
  const pool = await requirePool();
  const result = await pool.query<{
    set_id: number | string;
    set_appel_offres_id: number | string;
    set_source_fiche_version: string;
    set_source_fiche_hash: string;
    set_source_fiche_updated_at: string | Date;
    set_overall_status: FciSetOverallStatus;
    set_created_at: string | Date;
    set_updated_at: string | Date;
    module_id: number | string;
    module_fci_set_id: number | string;
    module_code: FciModuleRecord["moduleCode"];
    module_type: FciModuleRecord["moduleType"];
    module_status: FciModuleRecord["status"];
    module_ai_generated_at: string | Date | null;
    module_validated_at: string | Date | null;
    module_validated_by: string | null;
    module_error_code: string | null;
    module_error_message: string | null;
    module_created_at: string | Date;
    module_updated_at: string | Date;
  }>(
    `
      select
        sets.id as set_id,
        sets.appel_offres_id as set_appel_offres_id,
        sets.source_fiche_version as set_source_fiche_version,
        sets.source_fiche_hash as set_source_fiche_hash,
        sets.source_fiche_updated_at as set_source_fiche_updated_at,
        sets.overall_status as set_overall_status,
        sets.created_at as set_created_at,
        sets.updated_at as set_updated_at,
        modules.id as module_id,
        modules.fci_set_id as module_fci_set_id,
        modules.module_code as module_code,
        modules.module_type as module_type,
        modules.status as module_status,
        modules.ai_generated_at as module_ai_generated_at,
        modules.validated_at as module_validated_at,
        modules.validated_by as module_validated_by,
        modules.error_code as module_error_code,
        modules.error_message as module_error_message,
        modules.created_at as module_created_at,
        modules.updated_at as module_updated_at
      from ${FCI_MODULES_TABLE} as modules
      inner join ${FCI_SETS_TABLE} as sets on sets.id = modules.fci_set_id
      where sets.appel_offres_id = $1
        and modules.module_code = $2
      limit 1
    `,
    [appelOffres.id, moduleCode]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    appelOffres,
    set: mapFciSetRow({
      id: row.set_id,
      appel_offres_id: row.set_appel_offres_id,
      source_fiche_version: row.set_source_fiche_version,
      source_fiche_hash: row.set_source_fiche_hash,
      source_fiche_updated_at: row.set_source_fiche_updated_at,
      overall_status: row.set_overall_status,
      created_at: row.set_created_at,
      updated_at: row.set_updated_at
    }),
    module: mapFciModuleRow({
      id: row.module_id,
      fci_set_id: row.module_fci_set_id,
      module_code: row.module_code,
      module_type: row.module_type,
      status: row.module_status,
      ai_generated_at: row.module_ai_generated_at,
      validated_at: row.module_validated_at,
      validated_by: row.module_validated_by,
      error_code: row.module_error_code,
      error_message: row.module_error_message,
      created_at: row.module_created_at,
      updated_at: row.module_updated_at
    })
  };
}

export async function upsertFciModuleData(
  fciModuleId: number,
  input: UpsertFciModuleDataInput
) {
  const pool = await requirePool();
  const result = await pool.query<FciModuleDataRow>(
    `
      insert into ${FCI_MODULE_DATA_TABLE} (
        fci_module_id,
        data_json,
        source_summary_json,
        confidence_json,
        ai_notes_json,
        version,
        generated_from_fiche_version,
        generated_from_fiche_hash,
        created_at,
        updated_at
      )
      values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8, now(), now())
      on conflict (fci_module_id, version)
      do update set
        data_json = excluded.data_json,
        source_summary_json = excluded.source_summary_json,
        confidence_json = excluded.confidence_json,
        ai_notes_json = excluded.ai_notes_json,
        version = excluded.version,
        generated_from_fiche_version = excluded.generated_from_fiche_version,
        generated_from_fiche_hash = excluded.generated_from_fiche_hash,
        updated_at = now()
      returning
        id,
        fci_module_id,
        data_json,
        source_summary_json,
        confidence_json,
        ai_notes_json,
        version,
        generated_from_fiche_version,
        generated_from_fiche_hash,
        created_at,
        updated_at
    `,
    [
      fciModuleId,
      JSON.stringify(input.dataJson),
      input.sourceSummaryJson ? JSON.stringify(input.sourceSummaryJson) : null,
      input.confidenceJson ? JSON.stringify(input.confidenceJson) : null,
      input.aiNotesJson ? JSON.stringify(input.aiNotesJson) : null,
      input.version,
      input.generatedFromFicheVersion ?? null,
      input.generatedFromFicheHash ?? null
    ]
  );

  return mapFciModuleDataRow(result.rows[0]);
}

export async function listFciModuleDataVersions(fciModuleId: number) {
  const pool = await requirePool();
  const result = await pool.query<FciModuleDataRow>(
    `
      select
        id,
        fci_module_id,
        data_json,
        source_summary_json,
        confidence_json,
        ai_notes_json,
        version,
        generated_from_fiche_version,
        generated_from_fiche_hash,
        created_at,
        updated_at
      from ${FCI_MODULE_DATA_TABLE}
      where fci_module_id = $1
      order by version desc, created_at desc, id desc
    `,
    [fciModuleId]
  );

  return result.rows.map(mapFciModuleDataRow);
}

export async function getLatestFciModuleData(fciModuleId: number) {
  const versions = await listFciModuleDataVersions(fciModuleId);
  return versions[0] ?? null;
}

// Thrown when the fci_generation_jobs_module_active_uidx partial unique
// index rejects a concurrent insert - i.e. two launch requests for the same
// module raced past the application-level hasBlockingGenerationJob check at
// (almost) the same time. The caller (service.ts) translates this into the
// same FCI_ALREADY_GENERATING error the non-racing check-then-insert path
// already returns, so callers see one consistent error regardless of timing.
export class FciConcurrentGenerationError extends Error {
  constructor() {
    super("Une demande de generation FCI est deja en attente pour ce module.");
    this.name = "FciConcurrentGenerationError";
  }
}

function isActiveJobUniqueViolation(error: unknown) {
  const pgError = error as { code?: string; constraint?: string } | null;
  return (
    pgError?.code === "23505"
    && pgError?.constraint === "fci_generation_jobs_module_active_uidx"
  );
}

export async function createFciGenerationJob(
  fciModuleId: number,
  input: CreateFciGenerationJobInput
) {
  const pool = await requirePool();
  let result;
  try {
    result = await pool.query<FciGenerationJobRow>(
      `
      insert into ${FCI_GENERATION_JOBS_TABLE} (
        fci_module_id,
        trigger_type,
        provider,
        model,
        status,
        contract_version,
        schema_version,
        prompt_version,
        generation_parameters,
        source_fiche_version,
        source_fiche_hash,
        execution_id,
        correlation_id,
        started_at,
        completed_at,
        callback_received_at,
        error_code,
        error_message,
        created_at
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
        $9::jsonb,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18,
        now()
      )
      returning
        id,
        fci_module_id,
        trigger_type,
        provider,
        model,
        status,
        contract_version,
        schema_version,
        prompt_version,
        generation_parameters,
        source_fiche_version,
        source_fiche_hash,
        execution_id,
        correlation_id,
        started_at,
        completed_at,
        callback_received_at,
        error_code,
        error_message,
        created_at
      `,
      [
        fciModuleId,
      input.triggerType,
      input.provider,
      input.model,
      input.status ?? "created",
      input.contractVersion ?? null,
      input.schemaVersion ?? null,
      input.promptVersion ?? null,
      input.generationParameters
        ? JSON.stringify(input.generationParameters)
        : null,
      input.sourceFicheVersion ?? null,
      input.sourceFicheHash ?? null,
      input.executionId ?? null,
      input.correlationId ?? null,
      input.startedAt ?? null,
      input.completedAt ?? null,
      input.callbackReceivedAt ?? null,
      input.errorCode ?? null,
      input.errorMessage ?? null
    ]
    );
  } catch (error) {
    if (isActiveJobUniqueViolation(error)) {
      throw new FciConcurrentGenerationError();
    }

    throw error;
  }

  return mapFciGenerationJobRow(result.rows[0]);
}

export async function listFciGenerationJobsForModule(fciModuleId: number) {
  const pool = await requirePool();
  const result = await pool.query<FciGenerationJobRow>(
    `
      select
        id,
        fci_module_id,
        trigger_type,
        provider,
        model,
        status,
        contract_version,
        schema_version,
        prompt_version,
        generation_parameters,
        source_fiche_version,
        source_fiche_hash,
        execution_id,
        correlation_id,
        started_at,
        completed_at,
        callback_received_at,
        error_code,
        error_message,
        created_at
      from ${FCI_GENERATION_JOBS_TABLE}
      where fci_module_id = $1
      order by created_at desc, id desc
    `,
    [fciModuleId]
  );

  return result.rows.map(mapFciGenerationJobRow);
}

export async function getLatestFciGenerationJob(fciModuleId: number) {
  const jobs = await listFciGenerationJobsForModule(fciModuleId);
  return jobs[0] ?? null;
}

type StaleFciGenerationJobRow = {
  job_id: number;
  generation_parameters: FciJsonObject | null;
  fci_module_id: number;
  module_code: FciModuleCode;
  appel_offres_id: number;
  appel_offres_code: string;
};

async function listStaleFciGenerationJobRows(
  timeoutMinutes: number
): Promise<StaleFciGenerationJobRow[]> {
  const pool = await requirePool();
  const result = await pool.query<StaleFciGenerationJobRow>(
    `
      select
        j.id as job_id,
        j.generation_parameters,
        m.id as fci_module_id,
        m.module_code,
        s.appel_offres_id,
        a.code as appel_offres_code
      from ${FCI_GENERATION_JOBS_TABLE} j
      inner join ${FCI_MODULES_TABLE} m on m.id = j.fci_module_id
      inner join ${FCI_SETS_TABLE} s on s.id = m.fci_set_id
      inner join public.appels_offres a on a.id = s.appel_offres_id
      where j.status in ('created', 'queued', 'running')
        and coalesce(j.started_at, j.created_at) < now() - (interval '1 minute' * $1::int)
    `,
    [timeoutMinutes]
  );

  return result.rows;
}

function getRestoredModuleStatusFromGenerationParameters(
  generationParameters: FciJsonObject | null
): FciModuleRecord["status"] {
  // Mirrors getPreviousModuleStatusFromJob in fci/service.ts (the real n8n
  // failure-callback path): previous_module_status is captured on every
  // launch (see prepareFciGeneration/prepareFciRegeneration) precisely so a
  // failed/timed-out attempt can restore the module to what it was before,
  // rather than leaving it stuck "generating" or guessing a new state.
  const rawStatus = generationParameters?.previous_module_status;
  if (
    rawStatus === "not_started"
    || rawStatus === "needs_review"
    || rawStatus === "validated"
    || rawStatus === "generated"
    || rawStatus === "failed"
  ) {
    return rawStatus === "generated" ? "needs_review" : rawStatus;
  }

  return "not_started";
}

export type ReapedFciGenerationJob = {
  jobId: number;
  fciModuleId: number;
  moduleCode: FciModuleCode;
  appelOffresCode: string;
  restoredStatus: FciModuleRecord["status"];
};

// Mirrors reapStaleProcessingJobs (lib/appels-offres/repository.ts) - same
// PROCESSING_JOB_TIMEOUT_MINUTES env var and lazy-on-read pattern - but for FCI
// generation jobs. These live in fci_generation_jobs/fci_modules, a separate
// pipeline from the CDC-side processing_jobs, so the CDC reaper never covers
// them: a module stuck "generating" with no callback keeps the tender's
// dashboard row reading "En cours d'analyse" (fiche_validee + FCI
// overall_status in_progress) even after the CDC reaper has already run.
export async function reapStaleFciGenerationJobs(): Promise<ReapedFciGenerationJob[]> {
  const timeoutMinutes = getProcessingJobTimeoutMinutes();
  const staleRows = await listStaleFciGenerationJobRows(timeoutMinutes);
  if (staleRows.length === 0) {
    return [];
  }

  const pool = await requirePool();
  const errorMessage = `Aucun callback recu dans le delai imparti (${timeoutMinutes} minutes).`;
  const reaped: ReapedFciGenerationJob[] = [];
  const affectedCodes = new Set<string>();

  for (const row of staleRows) {
    // pg returns bigint/bigserial columns as strings, not numbers - normalize
    // here so the returned ReapedFciGenerationJob entries actually match the
    // numeric ids callers compare them against.
    const jobId = Number(row.job_id);
    const fciModuleId = Number(row.fci_module_id);
    const appelOffresId = Number(row.appel_offres_id);
    const restoredStatus = getRestoredModuleStatusFromGenerationParameters(
      row.generation_parameters
    );

    await pool.query(
      `
        update ${FCI_GENERATION_JOBS_TABLE}
        set
          status = 'failed',
          completed_at = now(),
          error_code = 'FCI_GENERATION_TIMEOUT',
          error_message = $2
        where id = $1
      `,
      [jobId, errorMessage]
    );

    await updateFciModule(fciModuleId, {
      status: restoredStatus,
      errorCode: "FCI_GENERATION_TIMEOUT",
      errorMessage
    });

    await appendFciAuditEvent({
      appelOffresId,
      fciModuleId,
      eventType: "fci.generation.failed",
      payloadJson: {
        generationJobId: jobId,
        moduleCode: row.module_code,
        errorCode: "FCI_GENERATION_TIMEOUT",
        errorMessage,
        reason: "timeout",
        timeoutMinutes
      }
    });

    affectedCodes.add(row.appel_offres_code);
    reaped.push({
      jobId,
      fciModuleId,
      moduleCode: row.module_code,
      appelOffresCode: row.appel_offres_code,
      restoredStatus
    });
  }

  for (const code of affectedCodes) {
    const detail = await getFciDetailByAppelOffresCode(code);
    if (!detail) {
      continue;
    }

    const overallStatus = calculateFciOverallStatus({
      modules: detail.modules,
      latestDataByModuleId: indexLatestModuleData(detail.moduleData)
    });

    if (overallStatus !== detail.set.overallStatus) {
      await updateFciSet(detail.set.id, { overallStatus });
    }
  }

  return reaped;
}

export async function updateFciGenerationJob(
  jobId: number,
  input: UpdateFciGenerationJobInput
) {
  const assignments: string[] = [];
  const values: Array<string | number | null> = [jobId];

  const push = (column: string, value: string | number | null, cast = "") => {
    values.push(value);
    assignments.push(`${column} = $${values.length}${cast}`);
  };

  if (input.provider !== undefined) {
    push("provider", input.provider);
  }

  if (input.model !== undefined) {
    push("model", input.model);
  }

  if (input.status !== undefined) {
    push("status", input.status);
  }

  if (input.contractVersion !== undefined) {
    push("contract_version", input.contractVersion);
  }

  if (input.schemaVersion !== undefined) {
    push("schema_version", input.schemaVersion);
  }

  if (input.promptVersion !== undefined) {
    push("prompt_version", input.promptVersion);
  }

  if (input.generationParameters !== undefined) {
    push(
      "generation_parameters",
      input.generationParameters ? JSON.stringify(input.generationParameters) : null,
      "::jsonb"
    );
  }

  if (input.sourceFicheVersion !== undefined) {
    push("source_fiche_version", input.sourceFicheVersion);
  }

  if (input.sourceFicheHash !== undefined) {
    push("source_fiche_hash", input.sourceFicheHash);
  }

  if (input.executionId !== undefined) {
    push("execution_id", input.executionId);
  }

  if (input.correlationId !== undefined) {
    push("correlation_id", input.correlationId);
  }

  if (input.startedAt !== undefined) {
    push("started_at", input.startedAt);
  }

  if (input.completedAt !== undefined) {
    push("completed_at", input.completedAt);
  }

  if (input.callbackReceivedAt !== undefined) {
    push("callback_received_at", input.callbackReceivedAt);
  }

  if (input.errorCode !== undefined) {
    push("error_code", input.errorCode);
  }

  if (input.errorMessage !== undefined) {
    push("error_message", input.errorMessage);
  }

  if (assignments.length === 0) {
    return null;
  }

  const pool = await requirePool();
  const result = await pool.query<FciGenerationJobRow>(
    `
      update ${FCI_GENERATION_JOBS_TABLE}
      set ${assignments.join(", ")}
      where id = $1
      returning
        id,
        fci_module_id,
        trigger_type,
        provider,
        model,
        status,
        contract_version,
        schema_version,
        prompt_version,
        generation_parameters,
        source_fiche_version,
        source_fiche_hash,
        execution_id,
        correlation_id,
        started_at,
        completed_at,
        callback_received_at,
        error_code,
        error_message,
        created_at
    `,
    values
  );

  return result.rows[0] ? mapFciGenerationJobRow(result.rows[0]) : null;
}

export async function getFciGenerationJobContextById(
  jobId: number
): Promise<FciGenerationJobContext | null> {
  const pool = await requirePool();
  const result = await pool.query<{
    appel_id: number | string;
    appel_code: string;
    appel_title: string;
    appel_reference: string | null;
    appel_buyer: string;
    appel_country: string | null;
    appel_due_date: string | Date | null;
    appel_notes: string | null;
    appel_status: string;
    appel_business_status: string | null;
    appel_source: string;
    appel_priorite: string;
    appel_responsable_commercial: string | null;
    appel_archived_at: string | Date | null;
    appel_created_at: string | Date;
    appel_updated_at: string | Date;
    set_id: number | string;
    set_appel_offres_id: number | string;
    set_source_fiche_version: string;
    set_source_fiche_hash: string;
    set_source_fiche_updated_at: string | Date;
    set_overall_status: FciSetOverallStatus;
    set_created_at: string | Date;
    set_updated_at: string | Date;
    module_id: number | string;
    module_fci_set_id: number | string;
    module_code: FciModuleRecord["moduleCode"];
    module_type: FciModuleRecord["moduleType"];
    module_status: FciModuleRecord["status"];
    module_ai_generated_at: string | Date | null;
    module_validated_at: string | Date | null;
    module_validated_by: string | null;
    module_error_code: string | null;
    module_error_message: string | null;
    module_created_at: string | Date;
    module_updated_at: string | Date;
    job_id: number | string;
    job_fci_module_id: number | string;
    job_trigger_type: FciGenerationJobRecord["triggerType"];
    job_provider: string;
    job_model: string;
    job_status: FciGenerationJobStatus;
    job_contract_version: string | null;
    job_schema_version: string | null;
    job_prompt_version: string | null;
    job_generation_parameters: FciJsonObject | null;
    job_source_fiche_version: string | null;
    job_source_fiche_hash: string | null;
    job_execution_id: string | null;
    job_correlation_id: string | null;
    job_started_at: string | Date | null;
    job_completed_at: string | Date | null;
    job_callback_received_at: string | Date | null;
    job_error_code: string | null;
    job_error_message: string | null;
    job_created_at: string | Date;
  }>(
    `
      select
        appels.id as appel_id,
        appels.code as appel_code,
        appels.title as appel_title,
        appels.reference as appel_reference,
        appels.buyer as appel_buyer,
        appels.country as appel_country,
        appels.due_date as appel_due_date,
        appels.notes as appel_notes,
        appels.status as appel_status,
        appels.business_status as appel_business_status,
        appels.source as appel_source,
        appels.priorite as appel_priorite,
        appels.responsable_commercial as appel_responsable_commercial,
        appels.archived_at as appel_archived_at,
        appels.created_at as appel_created_at,
        appels.updated_at as appel_updated_at,
        sets.id as set_id,
        sets.appel_offres_id as set_appel_offres_id,
        sets.source_fiche_version as set_source_fiche_version,
        sets.source_fiche_hash as set_source_fiche_hash,
        sets.source_fiche_updated_at as set_source_fiche_updated_at,
        sets.overall_status as set_overall_status,
        sets.created_at as set_created_at,
        sets.updated_at as set_updated_at,
        modules.id as module_id,
        modules.fci_set_id as module_fci_set_id,
        modules.module_code as module_code,
        modules.module_type as module_type,
        modules.status as module_status,
        modules.ai_generated_at as module_ai_generated_at,
        modules.validated_at as module_validated_at,
        modules.validated_by as module_validated_by,
        modules.error_code as module_error_code,
        modules.error_message as module_error_message,
        modules.created_at as module_created_at,
        modules.updated_at as module_updated_at,
        jobs.id as job_id,
        jobs.fci_module_id as job_fci_module_id,
        jobs.trigger_type as job_trigger_type,
        jobs.provider as job_provider,
        jobs.model as job_model,
        jobs.status as job_status,
        jobs.contract_version as job_contract_version,
        jobs.schema_version as job_schema_version,
        jobs.prompt_version as job_prompt_version,
        jobs.generation_parameters as job_generation_parameters,
        jobs.source_fiche_version as job_source_fiche_version,
        jobs.source_fiche_hash as job_source_fiche_hash,
        jobs.execution_id as job_execution_id,
        jobs.correlation_id as job_correlation_id,
        jobs.started_at as job_started_at,
        jobs.completed_at as job_completed_at,
        jobs.callback_received_at as job_callback_received_at,
        jobs.error_code as job_error_code,
        jobs.error_message as job_error_message,
        jobs.created_at as job_created_at
      from ${FCI_GENERATION_JOBS_TABLE} as jobs
      inner join ${FCI_MODULES_TABLE} as modules on modules.id = jobs.fci_module_id
      inner join ${FCI_SETS_TABLE} as sets on sets.id = modules.fci_set_id
      inner join public.appels_offres as appels on appels.id = sets.appel_offres_id
      where jobs.id = $1
      limit 1
    `,
    [jobId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    appelOffres: {
      id: Number(row.appel_id),
      code: row.appel_code,
      title: row.appel_title,
      reference: row.appel_reference ?? "",
      buyer: row.appel_buyer,
      country: row.appel_country ?? "",
      dueDate: normalizeTimestamp(row.appel_due_date),
      notes: row.appel_notes ?? "",
      status: row.appel_status as AppelOffresRecord["status"],
      businessStatus:
        row.appel_business_status as AppelOffresRecord["businessStatus"],
      source: row.appel_source as AppelOffresRecord["source"],
      priorite: row.appel_priorite as AppelOffresRecord["priorite"],
      responsableCommercial: row.appel_responsable_commercial ?? "",
      archivedAt: normalizeTimestamp(row.appel_archived_at),
      createdAt: normalizeTimestamp(row.appel_created_at) ?? new Date(0).toISOString(),
      updatedAt: normalizeTimestamp(row.appel_updated_at) ?? new Date(0).toISOString()
    },
    set: mapFciSetRow({
      id: row.set_id,
      appel_offres_id: row.set_appel_offres_id,
      source_fiche_version: row.set_source_fiche_version,
      source_fiche_hash: row.set_source_fiche_hash,
      source_fiche_updated_at: row.set_source_fiche_updated_at,
      overall_status: row.set_overall_status,
      created_at: row.set_created_at,
      updated_at: row.set_updated_at
    }),
    module: mapFciModuleRow({
      id: row.module_id,
      fci_set_id: row.module_fci_set_id,
      module_code: row.module_code,
      module_type: row.module_type,
      status: row.module_status,
      ai_generated_at: row.module_ai_generated_at,
      validated_at: row.module_validated_at,
      validated_by: row.module_validated_by,
      error_code: row.module_error_code,
      error_message: row.module_error_message,
      created_at: row.module_created_at,
      updated_at: row.module_updated_at
    }),
    job: mapFciGenerationJobRow({
      id: row.job_id,
      fci_module_id: row.job_fci_module_id,
      trigger_type: row.job_trigger_type,
      provider: row.job_provider,
      model: row.job_model,
      status: row.job_status,
      contract_version: row.job_contract_version,
      schema_version: row.job_schema_version,
      prompt_version: row.job_prompt_version,
      generation_parameters: row.job_generation_parameters,
      source_fiche_version: row.job_source_fiche_version,
      source_fiche_hash: row.job_source_fiche_hash,
      execution_id: row.job_execution_id,
      correlation_id: row.job_correlation_id,
      started_at: row.job_started_at,
      completed_at: row.job_completed_at,
      callback_received_at: row.job_callback_received_at,
      error_code: row.job_error_code,
      error_message: row.job_error_message,
      created_at: row.job_created_at
    })
  };
}

export async function appendFciAuditEvent(input: AppendFciAuditEventInput) {
  const pool = await requirePool();
  const result = await pool.query<FciAuditEventRow>(
    `
      insert into ${FCI_AUDIT_EVENTS_TABLE} (
        appel_offres_id,
        fci_module_id,
        event_type,
        actor,
        payload_json,
        created_at
      )
      values ($1, $2, $3, $4, $5::jsonb, now())
      returning
        id,
        appel_offres_id,
        fci_module_id,
        event_type,
        actor,
        payload_json,
        created_at
    `,
    [
      input.appelOffresId,
      input.fciModuleId ?? null,
      input.eventType,
      input.actor ?? null,
      input.payloadJson ? JSON.stringify(input.payloadJson) : null
    ]
  );

  return mapFciAuditEventRow(result.rows[0]);
}

export async function updateFciSet(
  fciSetId: number,
  input: {
    sourceFicheVersion?: string;
    sourceFicheHash?: string;
    sourceFicheUpdatedAt?: string;
    overallStatus?: FciSetOverallStatus;
  }
) {
  const assignments: string[] = ["updated_at = now()"];
  const values: Array<string | FciSetOverallStatus | number> = [fciSetId];

  if (input.sourceFicheVersion !== undefined) {
    values.push(input.sourceFicheVersion);
    assignments.push(`source_fiche_version = $${values.length}`);
  }

  if (input.sourceFicheHash !== undefined) {
    values.push(input.sourceFicheHash);
    assignments.push(`source_fiche_hash = $${values.length}`);
  }

  if (input.sourceFicheUpdatedAt !== undefined) {
    values.push(input.sourceFicheUpdatedAt);
    assignments.push(`source_fiche_updated_at = $${values.length}`);
  }

  if (input.overallStatus !== undefined) {
    values.push(input.overallStatus);
    assignments.push(`overall_status = $${values.length}`);
  }

  const pool = await requirePool();
  const result = await pool.query<FciSetRow>(
    `
      update ${FCI_SETS_TABLE}
      set ${assignments.join(", ")}
      where id = $1
      returning
        id,
        appel_offres_id,
        source_fiche_version,
        source_fiche_hash,
        source_fiche_updated_at,
        overall_status,
        created_at,
        updated_at
    `,
    values
  );

  return result.rows[0] ? mapFciSetRow(result.rows[0]) : null;
}

export async function updateFciModule(
  fciModuleId: number,
  input: {
    status?: FciModuleRecord["status"];
    aiGeneratedAt?: string | null;
    validatedAt?: string | null;
    validatedBy?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }
) {
  const assignments: string[] = ["updated_at = now()"];
  const values: Array<string | number | null> = [fciModuleId];

  if (input.status !== undefined) {
    values.push(input.status);
    assignments.push(`status = $${values.length}`);
  }

  if (input.aiGeneratedAt !== undefined) {
    values.push(input.aiGeneratedAt);
    assignments.push(`ai_generated_at = $${values.length}`);
  }

  if (input.validatedAt !== undefined) {
    values.push(input.validatedAt);
    assignments.push(`validated_at = $${values.length}`);
  }

  if (input.validatedBy !== undefined) {
    values.push(input.validatedBy);
    assignments.push(`validated_by = $${values.length}`);
  }

  if (input.errorCode !== undefined) {
    values.push(input.errorCode);
    assignments.push(`error_code = $${values.length}`);
  }

  if (input.errorMessage !== undefined) {
    values.push(input.errorMessage);
    assignments.push(`error_message = $${values.length}`);
  }

  const pool = await requirePool();
  const result = await pool.query<FciModuleRow>(
    `
      update ${FCI_MODULES_TABLE}
      set ${assignments.join(", ")}
      where id = $1
      returning
        id,
        fci_set_id,
        module_code,
        module_type,
        status,
        ai_generated_at,
        validated_at,
        validated_by,
        error_code,
        error_message,
        created_at,
        updated_at
    `,
    values
  );

  return result.rows[0] ? mapFciModuleRow(result.rows[0]) : null;
}

export async function getFciDetailByAppelOffresCode(code: string): Promise<FciDetail | null> {
  const appel = await requireAppelOffresRecord(code);
  const pool = await requirePool();
  const setResult = await pool.query<FciSetRow>(
    `
      select
        id,
        appel_offres_id,
        source_fiche_version,
        source_fiche_hash,
        source_fiche_updated_at,
        overall_status,
        created_at,
        updated_at
      from ${FCI_SETS_TABLE}
      where appel_offres_id = $1
      limit 1
    `,
    [appel.id]
  );

  if (!setResult.rows[0]) {
    return null;
  }

  const fciSet = mapFciSetRow(setResult.rows[0]);
  const [modulesResult, moduleDataResult, jobsResult, auditResult] = await Promise.all([
    pool.query<FciModuleRow>(
      `
        select
          id,
          fci_set_id,
          module_code,
          module_type,
          status,
          ai_generated_at,
          validated_at,
          validated_by,
          error_code,
          error_message,
          created_at,
          updated_at
        from ${FCI_MODULES_TABLE}
        where fci_set_id = $1
        order by module_code asc
      `,
      [fciSet.id]
    ),
    pool.query<FciModuleDataRow>(
      `
        select
          data.id,
          data.fci_module_id,
          data.data_json,
          data.source_summary_json,
          data.confidence_json,
          data.ai_notes_json,
          data.version,
          data.generated_from_fiche_version,
          data.generated_from_fiche_hash,
          data.created_at,
          data.updated_at
        from ${FCI_MODULE_DATA_TABLE} as data
        inner join ${FCI_MODULES_TABLE} as modules on modules.id = data.fci_module_id
        where modules.fci_set_id = $1
        order by modules.module_code asc
      `,
      [fciSet.id]
    ),
    pool.query<FciGenerationJobRow>(
      `
        select
          jobs.id,
          jobs.fci_module_id,
          jobs.trigger_type,
          jobs.provider,
          jobs.model,
          jobs.status,
          jobs.contract_version,
          jobs.schema_version,
          jobs.prompt_version,
          jobs.generation_parameters,
          jobs.source_fiche_version,
          jobs.source_fiche_hash,
          jobs.execution_id,
          jobs.correlation_id,
          jobs.started_at,
          jobs.completed_at,
          jobs.callback_received_at,
          jobs.error_code,
          jobs.error_message,
          jobs.created_at
        from ${FCI_GENERATION_JOBS_TABLE} as jobs
        inner join ${FCI_MODULES_TABLE} as modules on modules.id = jobs.fci_module_id
        where modules.fci_set_id = $1
        order by jobs.created_at desc, jobs.id desc
      `,
      [fciSet.id]
    ),
    pool.query<FciAuditEventRow>(
      `
        select
          id,
          appel_offres_id,
          fci_module_id,
          event_type,
          actor,
          payload_json,
          created_at
        from ${FCI_AUDIT_EVENTS_TABLE}
        where appel_offres_id = $1
        order by created_at desc, id desc
      `,
      [appel.id]
    )
  ]);

  return {
    set: fciSet,
    modules: modulesResult.rows.map(mapFciModuleRow),
    moduleData: moduleDataResult.rows.map(mapFciModuleDataRow),
    generationJobs: jobsResult.rows.map(mapFciGenerationJobRow),
    auditEvents: auditResult.rows.map(mapFciAuditEventRow)
  };
}

export async function closeFciPool() {
  const globalWithPool = globalThis as GlobalWithPool;

  if (globalWithPool.__appelsOffresFciPool) {
    await globalWithPool.__appelsOffresFciPool.end();
    globalWithPool.__appelsOffresFciPool = undefined;
    globalWithPool.__appelsOffresFciSetupPromise = undefined;
  }
}
