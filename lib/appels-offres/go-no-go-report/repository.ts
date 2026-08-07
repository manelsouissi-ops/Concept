import { Pool } from "pg";
import { ensureAppelsOffresSchema } from "../repository.ts";
import type {
  AppendGoNoGoReportAuditEventInput,
  GoNoGoReportAuditEventRecord,
  GoNoGoReportRecord,
  InsertGoNoGoReportInput,
  UpdateGoNoGoReportInput
} from "./types.ts";

const GO_NO_GO_REPORTS_TABLE = "public.go_no_go_reports";
const GO_NO_GO_REPORT_AUDIT_EVENTS_TABLE = "public.go_no_go_report_audit_events";

type GlobalWithPool = typeof globalThis & {
  __appelsOffresGoNoGoReportPool?: Pool;
  __appelsOffresGoNoGoReportSetupPromise?: Promise<void>;
};

type GoNoGoReportRow = {
  id: number | string;
  appel_offres_id: number | string;
  version: number;
  status: GoNoGoReportRecord["status"];
  generated_from_fci_snapshot_at: string | Date | null;
  generated_by_user_id: number | string | null;
  commercial_owner_user_id: number | string | null;
  prepared_by_user_id: number | string | null;
  prepared_at: string | Date | null;
  submitted_by_user_id: number | string | null;
  submitted_at: string | Date | null;
  reopened_at: string | Date | null;
  supersedes_report_id: number | string | null;
  executive_summary: string | null;
  project_overview: string | null;
  commercial_summary: string | null;
  financial_summary: string | null;
  operational_summary: string | null;
  key_strengths: string | null;
  key_risks: string | null;
  reservations: string | null;
  assumptions: string | null;
  unresolved_points: string | null;
  commercial_recommendation: string | null;
  ai_recommendation: string | null;
  recommended_decision: GoNoGoReportRecord["recommendedDecision"];
  source_snapshot_jsonb: Record<string, unknown> | null;
  editable_payload_jsonb: Record<string, unknown> | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type GoNoGoReportAuditEventRow = {
  id: number | string;
  go_no_go_report_id: number | string;
  appel_offres_id: number | string;
  event_type: GoNoGoReportAuditEventRecord["eventType"];
  actor_user_id: number | string | null;
  actor_name: string | null;
  payload_json: Record<string, unknown> | null;
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
  if (!globalWithPool.__appelsOffresGoNoGoReportPool) {
    globalWithPool.__appelsOffresGoNoGoReportPool = new Pool({
      connectionString: databaseUrl
    });
  }

  return globalWithPool.__appelsOffresGoNoGoReportPool;
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (value == null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapGoNoGoReportRow(row: GoNoGoReportRow): GoNoGoReportRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    version: row.version,
    status: row.status,
    generatedFromFciSnapshotAt: normalizeTimestamp(row.generated_from_fci_snapshot_at),
    generatedByUserId:
      row.generated_by_user_id == null ? null : Number(row.generated_by_user_id),
    commercialOwnerUserId:
      row.commercial_owner_user_id == null ? null : Number(row.commercial_owner_user_id),
    preparedByUserId:
      row.prepared_by_user_id == null ? null : Number(row.prepared_by_user_id),
    preparedAt: normalizeTimestamp(row.prepared_at),
    submittedByUserId:
      row.submitted_by_user_id == null ? null : Number(row.submitted_by_user_id),
    submittedAt: normalizeTimestamp(row.submitted_at),
    reopenedAt: normalizeTimestamp(row.reopened_at),
    supersedesReportId:
      row.supersedes_report_id == null ? null : Number(row.supersedes_report_id),
    executiveSummary: row.executive_summary,
    projectOverview: row.project_overview,
    commercialSummary: row.commercial_summary,
    financialSummary: row.financial_summary,
    operationalSummary: row.operational_summary,
    keyStrengths: row.key_strengths,
    keyRisks: row.key_risks,
    reservations: row.reservations,
    assumptions: row.assumptions,
    unresolvedPoints: row.unresolved_points,
    commercialRecommendation: row.commercial_recommendation,
    aiRecommendation: row.ai_recommendation,
    recommendedDecision: row.recommended_decision,
    sourceSnapshotJson: row.source_snapshot_jsonb,
    editablePayloadJson: row.editable_payload_jsonb,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString()
  };
}

function mapGoNoGoReportAuditEventRow(
  row: GoNoGoReportAuditEventRow
): GoNoGoReportAuditEventRecord {
  return {
    id: Number(row.id),
    goNoGoReportId: Number(row.go_no_go_report_id),
    appelOffresId: Number(row.appel_offres_id),
    eventType: row.event_type,
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    actorName: row.actor_name,
    payloadJson: row.payload_json,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString()
  };
}

async function ensureSchemaInternal(pool: Pool) {
  const client = await pool.connect();

  try {
    await client.query(`
      create table if not exists ${GO_NO_GO_REPORTS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        version integer not null,
        status text not null check (
          status in (
            'DRAFT',
            'READY_FOR_REVIEW',
            'PREPARED',
            'SUBMITTED_TO_DG',
            'SUPERSEDED',
            'ARCHIVED'
          )
        ),
        generated_from_fci_snapshot_at timestamptz null,
        generated_by_user_id bigint null,
        commercial_owner_user_id bigint null,
        prepared_by_user_id bigint null,
        prepared_at timestamptz null,
        submitted_by_user_id bigint null,
        submitted_at timestamptz null,
        reopened_at timestamptz null,
        supersedes_report_id bigint null references ${GO_NO_GO_REPORTS_TABLE}(id) on delete set null,
        executive_summary text null,
        project_overview text null,
        commercial_summary text null,
        financial_summary text null,
        operational_summary text null,
        key_strengths text null,
        key_risks text null,
        reservations text null,
        assumptions text null,
        unresolved_points text null,
        commercial_recommendation text null,
        ai_recommendation text null,
        recommended_decision text null check (
          recommended_decision is null or recommended_decision in ('go', 'no_go')
        ),
        source_snapshot_jsonb jsonb null,
        editable_payload_jsonb jsonb null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create unique index if not exists go_no_go_reports_appel_version_uidx
      on ${GO_NO_GO_REPORTS_TABLE} (appel_offres_id, version)
    `);
    await client.query(`
      create index if not exists go_no_go_reports_appel_status_idx
      on ${GO_NO_GO_REPORTS_TABLE} (appel_offres_id, status, version desc)
    `);
    await client.query(`
      create table if not exists ${GO_NO_GO_REPORT_AUDIT_EVENTS_TABLE} (
        id bigserial primary key,
        go_no_go_report_id bigint not null references ${GO_NO_GO_REPORTS_TABLE}(id) on delete cascade,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        event_type text not null check (
          event_type in (
            'REPORT_GENERATED',
            'REPORT_EDITED',
            'REPORT_PREPARED',
            'REPORT_SUBMITTED',
            'REPORT_REOPENED',
            'REPORT_SUPERSEDED',
            'REPORT_EXPORTED'
          )
        ),
        actor_user_id bigint null,
        actor_name text null,
        payload_json jsonb null,
        created_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create index if not exists go_no_go_report_audit_events_report_idx
      on ${GO_NO_GO_REPORT_AUDIT_EVENTS_TABLE} (go_no_go_report_id, created_at desc)
    `);
    await client.query(`
      create index if not exists go_no_go_report_audit_events_appel_idx
      on ${GO_NO_GO_REPORT_AUDIT_EVENTS_TABLE} (appel_offres_id, created_at desc)
    `);
  } finally {
    client.release();
  }
}

export async function ensureGoNoGoReportSchema() {
  await ensureAppelsOffresSchema();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const globalWithPool = globalThis as GlobalWithPool;
  if (!globalWithPool.__appelsOffresGoNoGoReportSetupPromise) {
    globalWithPool.__appelsOffresGoNoGoReportSetupPromise = ensureSchemaInternal(pool).catch(
      (error) => {
        globalWithPool.__appelsOffresGoNoGoReportSetupPromise = undefined;
        throw error;
      }
    );
  }

  await globalWithPool.__appelsOffresGoNoGoReportSetupPromise;
}

async function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  await ensureGoNoGoReportSchema();
  return pool;
}

export async function listGoNoGoReportsByAppelOffresId(
  appelOffresId: number
): Promise<GoNoGoReportRecord[]> {
  const pool = await requirePool();
  const result = await pool.query<GoNoGoReportRow>(
    `
      select
        id,
        appel_offres_id,
        version,
        status,
        generated_from_fci_snapshot_at,
        generated_by_user_id,
        commercial_owner_user_id,
        prepared_by_user_id,
        prepared_at,
        submitted_by_user_id,
        submitted_at,
        reopened_at,
        supersedes_report_id,
        executive_summary,
        project_overview,
        commercial_summary,
        financial_summary,
        operational_summary,
        key_strengths,
        key_risks,
        reservations,
        assumptions,
        unresolved_points,
        commercial_recommendation,
        ai_recommendation,
        recommended_decision,
        source_snapshot_jsonb,
        editable_payload_jsonb,
        created_at,
        updated_at
      from ${GO_NO_GO_REPORTS_TABLE}
      where appel_offres_id = $1
      order by version desc
    `,
    [appelOffresId]
  );

  return result.rows.map(mapGoNoGoReportRow);
}

export async function getLatestGoNoGoReportByAppelOffresId(
  appelOffresId: number
): Promise<GoNoGoReportRecord | null> {
  const reports = await listGoNoGoReportsByAppelOffresId(appelOffresId);
  return reports[0] ?? null;
}

export async function getGoNoGoReportById(reportId: number) {
  const pool = await requirePool();
  const result = await pool.query<GoNoGoReportRow>(
    `
      select
        id,
        appel_offres_id,
        version,
        status,
        generated_from_fci_snapshot_at,
        generated_by_user_id,
        commercial_owner_user_id,
        prepared_by_user_id,
        prepared_at,
        submitted_by_user_id,
        submitted_at,
        reopened_at,
        supersedes_report_id,
        executive_summary,
        project_overview,
        commercial_summary,
        financial_summary,
        operational_summary,
        key_strengths,
        key_risks,
        reservations,
        assumptions,
        unresolved_points,
        commercial_recommendation,
        ai_recommendation,
        recommended_decision,
        source_snapshot_jsonb,
        editable_payload_jsonb,
        created_at,
        updated_at
      from ${GO_NO_GO_REPORTS_TABLE}
      where id = $1
      limit 1
    `,
    [reportId]
  );

  return result.rows[0] ? mapGoNoGoReportRow(result.rows[0]) : null;
}

export async function insertGoNoGoReport(
  appelOffresId: number,
  input: InsertGoNoGoReportInput
): Promise<GoNoGoReportRecord> {
  const pool = await requirePool();
  const result = await pool.query<GoNoGoReportRow>(
    `
      insert into ${GO_NO_GO_REPORTS_TABLE} (
        appel_offres_id,
        version,
        status,
        generated_from_fci_snapshot_at,
        generated_by_user_id,
        commercial_owner_user_id,
        prepared_by_user_id,
        prepared_at,
        submitted_by_user_id,
        submitted_at,
        reopened_at,
        supersedes_report_id,
        executive_summary,
        project_overview,
        commercial_summary,
        financial_summary,
        operational_summary,
        key_strengths,
        key_risks,
        reservations,
        assumptions,
        unresolved_points,
        commercial_recommendation,
        ai_recommendation,
        recommended_decision,
        source_snapshot_jsonb,
        editable_payload_jsonb,
        created_at,
        updated_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
        $23, $24, $25, $26::jsonb, $27::jsonb, now(), now()
      )
      returning
        id,
        appel_offres_id,
        version,
        status,
        generated_from_fci_snapshot_at,
        generated_by_user_id,
        commercial_owner_user_id,
        prepared_by_user_id,
        prepared_at,
        submitted_by_user_id,
        submitted_at,
        reopened_at,
        supersedes_report_id,
        executive_summary,
        project_overview,
        commercial_summary,
        financial_summary,
        operational_summary,
        key_strengths,
        key_risks,
        reservations,
        assumptions,
        unresolved_points,
        commercial_recommendation,
        ai_recommendation,
        recommended_decision,
        source_snapshot_jsonb,
        editable_payload_jsonb,
        created_at,
        updated_at
    `,
    [
      appelOffresId,
      input.version,
      input.status,
      input.generatedFromFciSnapshotAt ?? null,
      input.generatedByUserId ?? null,
      input.commercialOwnerUserId ?? null,
      input.preparedByUserId ?? null,
      input.preparedAt ?? null,
      input.submittedByUserId ?? null,
      input.submittedAt ?? null,
      input.reopenedAt ?? null,
      input.supersedesReportId ?? null,
      input.executiveSummary ?? null,
      input.projectOverview ?? null,
      input.commercialSummary ?? null,
      input.financialSummary ?? null,
      input.operationalSummary ?? null,
      input.keyStrengths ?? null,
      input.keyRisks ?? null,
      input.reservations ?? null,
      input.assumptions ?? null,
      input.unresolvedPoints ?? null,
      input.commercialRecommendation ?? null,
      input.aiRecommendation ?? null,
      input.recommendedDecision ?? null,
      input.sourceSnapshotJson ? JSON.stringify(input.sourceSnapshotJson) : null,
      input.editablePayloadJson ? JSON.stringify(input.editablePayloadJson) : null
    ]
  );

  return mapGoNoGoReportRow(result.rows[0]);
}

export async function updateGoNoGoReport(
  reportId: number,
  input: UpdateGoNoGoReportInput
): Promise<GoNoGoReportRecord | null> {
  const assignments: string[] = ["updated_at = now()"];
  const values: Array<string | number | null> = [reportId];

  const push = (column: string, value: string | number | null, cast = "") => {
    values.push(value);
    assignments.push(`${column} = $${values.length}${cast}`);
  };

  if (input.status !== undefined) {
    push("status", input.status);
  }
  if (input.preparedByUserId !== undefined) {
    push("prepared_by_user_id", input.preparedByUserId);
  }
  if (input.preparedAt !== undefined) {
    push("prepared_at", input.preparedAt);
  }
  if (input.submittedByUserId !== undefined) {
    push("submitted_by_user_id", input.submittedByUserId);
  }
  if (input.submittedAt !== undefined) {
    push("submitted_at", input.submittedAt);
  }
  if (input.reopenedAt !== undefined) {
    push("reopened_at", input.reopenedAt);
  }
  if (input.supersedesReportId !== undefined) {
    push("supersedes_report_id", input.supersedesReportId);
  }
  if (input.executiveSummary !== undefined) {
    push("executive_summary", input.executiveSummary);
  }
  if (input.projectOverview !== undefined) {
    push("project_overview", input.projectOverview);
  }
  if (input.commercialSummary !== undefined) {
    push("commercial_summary", input.commercialSummary);
  }
  if (input.financialSummary !== undefined) {
    push("financial_summary", input.financialSummary);
  }
  if (input.operationalSummary !== undefined) {
    push("operational_summary", input.operationalSummary);
  }
  if (input.keyStrengths !== undefined) {
    push("key_strengths", input.keyStrengths);
  }
  if (input.keyRisks !== undefined) {
    push("key_risks", input.keyRisks);
  }
  if (input.reservations !== undefined) {
    push("reservations", input.reservations);
  }
  if (input.assumptions !== undefined) {
    push("assumptions", input.assumptions);
  }
  if (input.unresolvedPoints !== undefined) {
    push("unresolved_points", input.unresolvedPoints);
  }
  if (input.commercialRecommendation !== undefined) {
    push("commercial_recommendation", input.commercialRecommendation);
  }
  if (input.aiRecommendation !== undefined) {
    push("ai_recommendation", input.aiRecommendation);
  }
  if (input.recommendedDecision !== undefined) {
    push("recommended_decision", input.recommendedDecision);
  }
  if (input.sourceSnapshotJson !== undefined) {
    push(
      "source_snapshot_jsonb",
      input.sourceSnapshotJson ? JSON.stringify(input.sourceSnapshotJson) : null,
      "::jsonb"
    );
  }
  if (input.editablePayloadJson !== undefined) {
    push(
      "editable_payload_jsonb",
      input.editablePayloadJson ? JSON.stringify(input.editablePayloadJson) : null,
      "::jsonb"
    );
  }

  const pool = await requirePool();
  const result = await pool.query<GoNoGoReportRow>(
    `
      update ${GO_NO_GO_REPORTS_TABLE}
      set ${assignments.join(", ")}
      where id = $1
      returning
        id,
        appel_offres_id,
        version,
        status,
        generated_from_fci_snapshot_at,
        generated_by_user_id,
        commercial_owner_user_id,
        prepared_by_user_id,
        prepared_at,
        submitted_by_user_id,
        submitted_at,
        reopened_at,
        supersedes_report_id,
        executive_summary,
        project_overview,
        commercial_summary,
        financial_summary,
        operational_summary,
        key_strengths,
        key_risks,
        reservations,
        assumptions,
        unresolved_points,
        commercial_recommendation,
        ai_recommendation,
        recommended_decision,
        source_snapshot_jsonb,
        editable_payload_jsonb,
        created_at,
        updated_at
    `,
    values
  );

  return result.rows[0] ? mapGoNoGoReportRow(result.rows[0]) : null;
}

export async function appendGoNoGoReportAuditEvent(
  input: AppendGoNoGoReportAuditEventInput
): Promise<GoNoGoReportAuditEventRecord> {
  const pool = await requirePool();
  const result = await pool.query<GoNoGoReportAuditEventRow>(
    `
      insert into ${GO_NO_GO_REPORT_AUDIT_EVENTS_TABLE} (
        go_no_go_report_id,
        appel_offres_id,
        event_type,
        actor_user_id,
        actor_name,
        payload_json,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, now())
      returning
        id,
        go_no_go_report_id,
        appel_offres_id,
        event_type,
        actor_user_id,
        actor_name,
        payload_json,
        created_at
    `,
    [
      input.goNoGoReportId,
      input.appelOffresId,
      input.eventType,
      input.actorUserId ?? null,
      input.actorName ?? null,
      input.payloadJson ? JSON.stringify(input.payloadJson) : null
    ]
  );

  return mapGoNoGoReportAuditEventRow(result.rows[0]);
}

export async function listGoNoGoReportAuditEventsByAppelOffresId(
  appelOffresId: number
) {
  const pool = await requirePool();
  const result = await pool.query<GoNoGoReportAuditEventRow>(
    `
      select
        id,
        go_no_go_report_id,
        appel_offres_id,
        event_type,
        actor_user_id,
        actor_name,
        payload_json,
        created_at
      from ${GO_NO_GO_REPORT_AUDIT_EVENTS_TABLE}
      where appel_offres_id = $1
      order by created_at desc, id desc
    `,
    [appelOffresId]
  );

  return result.rows.map(mapGoNoGoReportAuditEventRow);
}

export async function closeGoNoGoReportPool() {
  const globalWithPool = globalThis as GlobalWithPool;

  if (globalWithPool.__appelsOffresGoNoGoReportPool) {
    await globalWithPool.__appelsOffresGoNoGoReportPool.end();
    globalWithPool.__appelsOffresGoNoGoReportPool = undefined;
    globalWithPool.__appelsOffresGoNoGoReportSetupPromise = undefined;
  }
}
