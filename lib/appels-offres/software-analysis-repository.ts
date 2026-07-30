import { Pool } from "pg";
import { ensureSoftwareSchema, listSoftware } from "../administration/logiciels/repository.ts";
import type { SoftwareRecord } from "../administration/logiciels/types.ts";
import { appendAuditLog, ensureAppelsOffresSchema, getAppelOffresRecordByCode } from "./repository.ts";
import { buildSoftwareAnalysisSummary } from "./software-analysis-presentation.ts";
import type {
  AnalysisConfirmationRecord,
  AnalysisSourceRecord,
  ConfirmationMutationInput,
  GapMutationInput,
  MatchMutationInput,
  RequirementMutationInput,
  SoftwareAnalysisDetail,
  SoftwareAnalysisReviewRecord,
  SoftwareAnalysisScope,
  SoftwareAnalysisTransitionAction,
  SourceMutationInput,
  TenderSoftwareGapRecord,
  TenderSoftwareMatchRecord,
  TenderSoftwareRequirementRecord
} from "./software-analysis-types.ts";
import { canTransitionSoftwareAnalysisStatus } from "./software-analysis-presentation.ts";

const REVIEWS_TABLE = "public.software_analysis_reviews";
const REQUIREMENTS_TABLE = "public.tender_software_requirements";
const MATCHES_TABLE = "public.tender_software_matches";
const GAPS_TABLE = "public.tender_software_gaps";
const CONFIRMATIONS_TABLE = "public.analysis_confirmations";
const SOURCES_TABLE = "public.analysis_sources";

type GlobalWithPool = typeof globalThis & {
  __softwareAnalysisPool?: Pool;
  __softwareAnalysisSetupPromise?: Promise<void>;
};

type ReviewRow = {
  id: number | string;
  appel_offres_id: number | string;
  scope: SoftwareAnalysisScope;
  status: SoftwareAnalysisReviewRecord["status"];
  submitted_at: string | Date | null;
  validated_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type RequirementRow = {
  id: number | string;
  appel_offres_id: number | string;
  requirement_text: string;
  explicitness: TenderSoftwareRequirementRecord["explicitness"];
  software_names_raw: string | null;
  necessity_level: string;
  justification: string | null;
  risk_if_missing: string | null;
  alternative_possible: string | null;
  source_excerpt: string | null;
  status: TenderSoftwareRequirementRecord["status"];
  created_at: string | Date;
  updated_at: string | Date;
};

type MatchRow = {
  id: number | string;
  appel_offres_id: number | string;
  requirement_id: number | string | null;
  logiciel_id: number | string | null;
  software_name_raw: string;
  match_type: TenderSoftwareMatchRecord["matchType"];
  coverage_status: TenderSoftwareMatchRecord["coverageStatus"];
  necessity_level: string;
  utility_text: string | null;
  recommended_decision: string | null;
  comment: string | null;
  validated_by_user: boolean;
  status: TenderSoftwareMatchRecord["status"];
  created_at: string | Date;
  updated_at: string | Date;
};

type GapRow = {
  id: number | string;
  appel_offres_id: number | string;
  requirement_id: number | string | null;
  missing_need: string;
  software_type_needed: string | null;
  why_needed: string | null;
  urgency_level: string;
  example_software_or_category: string | null;
  recommended_action: string | null;
  status: TenderSoftwareGapRecord["status"];
  created_at: string | Date;
  updated_at: string | Date;
};

type ConfirmationRow = {
  id: number | string;
  appel_offres_id: number | string;
  scope: SoftwareAnalysisScope;
  topic: string;
  question_text: string;
  status: AnalysisConfirmationRecord["status"];
  resolution_note: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type SourceRow = {
  id: number | string;
  appel_offres_id: number | string;
  scope: SoftwareAnalysisScope;
  source_label: string;
  file_name: string | null;
  sheet_name: string | null;
  source_excerpt: string | null;
  comment: string | null;
  created_at: string | Date;
  updated_at: string | Date;
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
  if (!globalWithPool.__softwareAnalysisPool) {
    globalWithPool.__softwareAnalysisPool = new Pool({
      connectionString: databaseUrl
    });
  }

  return globalWithPool.__softwareAnalysisPool;
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (value == null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function mapReviewRow(row: ReviewRow): SoftwareAnalysisReviewRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    scope: row.scope,
    status: row.status,
    submittedAt: normalizeTimestamp(row.submitted_at),
    validatedAt: normalizeTimestamp(row.validated_at),
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString()
  };
}

function mapRequirementRow(row: RequirementRow): TenderSoftwareRequirementRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    requirementText: row.requirement_text,
    explicitness: row.explicitness,
    softwareNamesRaw: row.software_names_raw ?? "",
    necessityLevel: row.necessity_level,
    justification: row.justification ?? "",
    riskIfMissing: row.risk_if_missing ?? "",
    alternativePossible: row.alternative_possible ?? "",
    sourceExcerpt: row.source_excerpt ?? "",
    status: row.status,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString()
  };
}

function mapGapRow(row: GapRow): TenderSoftwareGapRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    requirementId: row.requirement_id == null ? null : Number(row.requirement_id),
    missingNeed: row.missing_need,
    softwareTypeNeeded: row.software_type_needed ?? "",
    whyNeeded: row.why_needed ?? "",
    urgencyLevel: row.urgency_level,
    exampleSoftwareOrCategory: row.example_software_or_category ?? "",
    recommendedAction: row.recommended_action ?? "",
    status: row.status,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString()
  };
}

function mapConfirmationRow(row: ConfirmationRow): AnalysisConfirmationRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    scope: row.scope,
    topic: row.topic,
    questionText: row.question_text,
    status: row.status,
    resolutionNote: row.resolution_note ?? "",
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString()
  };
}

function mapSourceRow(row: SourceRow): AnalysisSourceRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    scope: row.scope,
    sourceLabel: row.source_label,
    fileName: row.file_name ?? "",
    sheetName: row.sheet_name ?? "",
    sourceExcerpt: row.source_excerpt ?? "",
    comment: row.comment ?? "",
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString()
  };
}

function mapMatchRow(
  row: MatchRow,
  softwareById: Map<number, SoftwareRecord>
): TenderSoftwareMatchRecord {
  const softwareId = row.logiciel_id == null ? null : Number(row.logiciel_id);
  const matchedSoftware = softwareId == null ? null : softwareById.get(softwareId) ?? null;

  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    requirementId: row.requirement_id == null ? null : Number(row.requirement_id),
    logicielId: softwareId,
    softwareNameRaw: row.software_name_raw,
    matchType: row.match_type,
    coverageStatus: row.coverage_status,
    necessityLevel: row.necessity_level,
    utilityText: row.utility_text ?? "",
    recommendedDecision: row.recommended_decision ?? "",
    comment: row.comment ?? "",
    validatedByUser: row.validated_by_user,
    status: row.status,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString(),
    matchedSoftware: matchedSoftware
      ? {
          id: matchedSoftware.id,
          name: matchedSoftware.name,
          normalizedName: matchedSoftware.normalizedName,
          descriptionRaw: matchedSoftware.descriptionRaw,
          status: matchedSoftware.status,
          aliases: matchedSoftware.aliases
        }
      : null
  };
}

async function ensureSchemaInternal(pool: Pool) {
  const client = await pool.connect();

  try {
    await client.query(`
      create table if not exists ${REVIEWS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        scope text not null check (scope in ('logiciels')) default 'logiciels',
        status text not null check (status in ('draft', 'submitted', 'validated')) default 'draft',
        submitted_at timestamptz null,
        validated_at timestamptz null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (appel_offres_id, scope)
      )
    `);
    await client.query(`
      create table if not exists ${REQUIREMENTS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        requirement_text text not null,
        explicitness text not null check (explicitness in ('explicit', 'implicit')),
        software_names_raw text null,
        necessity_level text not null,
        justification text null,
        risk_if_missing text null,
        alternative_possible text null,
        source_excerpt text null,
        status text not null check (status in ('draft', 'reviewed', 'validated', 'rejected')) default 'draft',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create table if not exists ${MATCHES_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        requirement_id bigint null references ${REQUIREMENTS_TABLE}(id) on delete set null,
        logiciel_id bigint null references public.logiciels(id) on delete set null,
        software_name_raw text not null,
        match_type text not null check (match_type in ('exact', 'alias', 'manual', 'possible', 'none')),
        coverage_status text not null check (coverage_status in ('covered', 'partially_covered', 'not_covered', 'to_confirm')),
        necessity_level text not null,
        utility_text text null,
        recommended_decision text null,
        comment text null,
        validated_by_user boolean not null default false,
        status text not null check (status in ('draft', 'reviewed', 'validated', 'rejected')) default 'draft',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create table if not exists ${GAPS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        requirement_id bigint null references ${REQUIREMENTS_TABLE}(id) on delete set null,
        missing_need text not null,
        software_type_needed text null,
        why_needed text null,
        urgency_level text not null,
        example_software_or_category text null,
        recommended_action text null,
        status text not null check (status in ('draft', 'reviewed', 'validated', 'rejected')) default 'draft',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create table if not exists ${CONFIRMATIONS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        scope text not null check (scope in ('logiciels')) default 'logiciels',
        topic text not null,
        question_text text not null,
        status text not null check (status in ('open', 'resolved', 'not_applicable')) default 'open',
        resolution_note text null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create table if not exists ${SOURCES_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        scope text not null check (scope in ('logiciels')) default 'logiciels',
        source_label text not null,
        file_name text null,
        sheet_name text null,
        source_excerpt text null,
        comment text null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create index if not exists software_analysis_reviews_appel_scope_uidx
      on ${REVIEWS_TABLE} (appel_offres_id, scope)
    `);
    await client.query(`
      create index if not exists tender_software_requirements_appel_idx
      on ${REQUIREMENTS_TABLE} (appel_offres_id, created_at desc)
    `);
    await client.query(`
      create index if not exists tender_software_matches_appel_idx
      on ${MATCHES_TABLE} (appel_offres_id, created_at desc)
    `);
    await client.query(`
      create index if not exists tender_software_matches_requirement_idx
      on ${MATCHES_TABLE} (requirement_id)
    `);
    await client.query(`
      create index if not exists tender_software_gaps_appel_idx
      on ${GAPS_TABLE} (appel_offres_id, created_at desc)
    `);
    await client.query(`
      create index if not exists analysis_confirmations_appel_scope_idx
      on ${CONFIRMATIONS_TABLE} (appel_offres_id, scope, created_at desc)
    `);
    await client.query(`
      create index if not exists analysis_sources_appel_scope_idx
      on ${SOURCES_TABLE} (appel_offres_id, scope, created_at desc)
    `);
  } finally {
    client.release();
  }
}

export async function ensureSoftwareAnalysisSchema() {
  await ensureAppelsOffresSchema();
  await ensureSoftwareSchema();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const globalWithPool = globalThis as GlobalWithPool;
  if (!globalWithPool.__softwareAnalysisSetupPromise) {
    globalWithPool.__softwareAnalysisSetupPromise = ensureSchemaInternal(pool).catch((error) => {
      globalWithPool.__softwareAnalysisSetupPromise = undefined;
      throw error;
    });
  }

  await globalWithPool.__softwareAnalysisSetupPromise;
}

async function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  await ensureSoftwareAnalysisSchema();
  return pool;
}

async function requireAppelOffresRecord(code: string) {
  const appel = await getAppelOffresRecordByCode(code, { includeArchived: true });
  if (!appel) {
    throw new Error("Appel d'offres introuvable.");
  }
  return appel;
}

export async function ensureSoftwareAnalysisReviewByCode(code: string) {
  const appel = await requireAppelOffresRecord(code);
  const pool = await requirePool();
  const result = await pool.query<ReviewRow>(
    `
      insert into ${REVIEWS_TABLE} (
        appel_offres_id,
        scope,
        status,
        submitted_at,
        validated_at,
        created_at,
        updated_at
      )
      values ($1, 'logiciels', 'draft', null, null, now(), now())
      on conflict (appel_offres_id, scope)
      do update set updated_at = ${REVIEWS_TABLE}.updated_at
      returning
        id,
        appel_offres_id,
        scope,
        status,
        submitted_at,
        validated_at,
        created_at,
        updated_at
    `,
    [appel.id]
  );

  return mapReviewRow(result.rows[0]);
}

async function listRequirementsByAppelOffresId(appelOffresId: number) {
  const pool = await requirePool();
  const result = await pool.query<RequirementRow>(
    `
      select
        id,
        appel_offres_id,
        requirement_text,
        explicitness,
        software_names_raw,
        necessity_level,
        justification,
        risk_if_missing,
        alternative_possible,
        source_excerpt,
        status,
        created_at,
        updated_at
      from ${REQUIREMENTS_TABLE}
      where appel_offres_id = $1
      order by created_at asc, id asc
    `,
    [appelOffresId]
  );

  return result.rows.map(mapRequirementRow);
}

async function listMatchesByAppelOffresId(appelOffresId: number) {
  const [pool, catalogue] = await Promise.all([requirePool(), listSoftware({ status: "all" })]);
  const result = await pool.query<MatchRow>(
    `
      select
        id,
        appel_offres_id,
        requirement_id,
        logiciel_id,
        software_name_raw,
        match_type,
        coverage_status,
        necessity_level,
        utility_text,
        recommended_decision,
        comment,
        validated_by_user,
        status,
        created_at,
        updated_at
      from ${MATCHES_TABLE}
      where appel_offres_id = $1
      order by created_at asc, id asc
    `,
    [appelOffresId]
  );

  const softwareById = new Map(catalogue.map((software) => [software.id, software]));
  return result.rows.map((row) => mapMatchRow(row, softwareById));
}

async function listGapsByAppelOffresId(appelOffresId: number) {
  const pool = await requirePool();
  const result = await pool.query<GapRow>(
    `
      select
        id,
        appel_offres_id,
        requirement_id,
        missing_need,
        software_type_needed,
        why_needed,
        urgency_level,
        example_software_or_category,
        recommended_action,
        status,
        created_at,
        updated_at
      from ${GAPS_TABLE}
      where appel_offres_id = $1
      order by created_at asc, id asc
    `,
    [appelOffresId]
  );

  return result.rows.map(mapGapRow);
}

async function listConfirmationsByAppelOffresId(appelOffresId: number) {
  const pool = await requirePool();
  const result = await pool.query<ConfirmationRow>(
    `
      select
        id,
        appel_offres_id,
        scope,
        topic,
        question_text,
        status,
        resolution_note,
        created_at,
        updated_at
      from ${CONFIRMATIONS_TABLE}
      where appel_offres_id = $1 and scope = 'logiciels'
      order by created_at asc, id asc
    `,
    [appelOffresId]
  );

  return result.rows.map(mapConfirmationRow);
}

async function listSourcesByAppelOffresId(appelOffresId: number) {
  const pool = await requirePool();
  const result = await pool.query<SourceRow>(
    `
      select
        id,
        appel_offres_id,
        scope,
        source_label,
        file_name,
        sheet_name,
        source_excerpt,
        comment,
        created_at,
        updated_at
      from ${SOURCES_TABLE}
      where appel_offres_id = $1 and scope = 'logiciels'
      order by created_at asc, id asc
    `,
    [appelOffresId]
  );

  return result.rows.map(mapSourceRow);
}

export async function getSoftwareAnalysisDetailByCode(code: string): Promise<SoftwareAnalysisDetail> {
  const appel = await requireAppelOffresRecord(code);
  const review = await ensureSoftwareAnalysisReviewByCode(code);
  const [requirements, matches, gaps, confirmations, sources] = await Promise.all([
    listRequirementsByAppelOffresId(appel.id),
    listMatchesByAppelOffresId(appel.id),
    listGapsByAppelOffresId(appel.id),
    listConfirmationsByAppelOffresId(appel.id),
    listSourcesByAppelOffresId(appel.id)
  ]);

  const summary = buildSoftwareAnalysisSummary({
    review,
    requirements,
    matches,
    gaps,
    confirmations,
    sources
  });

  return {
    review,
    summary,
    requirements,
    matches,
    gaps,
    confirmations,
    sources
  };
}

export async function saveRequirementByCode(code: string, input: RequirementMutationInput) {
  const appel = await requireAppelOffresRecord(code);
  const pool = await requirePool();
  const query = input.id
    ? `
          update ${REQUIREMENTS_TABLE}
          set
            requirement_text = $3,
            explicitness = $4,
            software_names_raw = $5,
            necessity_level = $6,
            justification = $7,
            risk_if_missing = $8,
            alternative_possible = $9,
            source_excerpt = $10,
            status = $11,
            updated_at = now()
          where id = $1 and appel_offres_id = $2
          returning
            id,
            appel_offres_id,
            requirement_text,
            explicitness,
            software_names_raw,
            necessity_level,
            justification,
            risk_if_missing,
            alternative_possible,
            source_excerpt,
            status,
            created_at,
            updated_at
        `
    : `
          insert into ${REQUIREMENTS_TABLE} (
            appel_offres_id,
            requirement_text,
            explicitness,
            software_names_raw,
            necessity_level,
            justification,
            risk_if_missing,
            alternative_possible,
            source_excerpt,
            status,
            created_at,
            updated_at
          )
          values ($2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
          returning
            id,
            appel_offres_id,
            requirement_text,
            explicitness,
            software_names_raw,
            necessity_level,
            justification,
            risk_if_missing,
            alternative_possible,
            source_excerpt,
            status,
            created_at,
            updated_at
        `;
  const params = input.id
    ? [
        input.id,
        appel.id,
        input.requirementText,
        input.explicitness,
        input.softwareNamesRaw || null,
        input.necessityLevel,
        input.justification || null,
        input.riskIfMissing || null,
        input.alternativePossible || null,
        input.sourceExcerpt || null,
        input.status
      ]
    : [
        appel.id,
        input.requirementText,
        input.explicitness,
        input.softwareNamesRaw || null,
        input.necessityLevel,
        input.justification || null,
        input.riskIfMissing || null,
        input.alternativePossible || null,
        input.sourceExcerpt || null,
        input.status
      ];

  const result = await pool.query<RequirementRow>(query, params);

  if (!result.rows[0]) {
    throw new Error("Le besoin logiciel est introuvable pour cet appel d'offres.");
  }

  await appendAuditLog(code, "software_analysis.requirement_saved", {
    requirementId: Number(result.rows[0].id),
    mode: input.id ? "update" : "create",
    status: input.status
  }).catch(() => undefined);

  return mapRequirementRow(result.rows[0]);
}

export async function saveMatchByCode(code: string, input: MatchMutationInput) {
  const appel = await requireAppelOffresRecord(code);
  const pool = await requirePool();
  const query = input.id
    ? `
          update ${MATCHES_TABLE}
          set
            requirement_id = $3,
            logiciel_id = $4,
            software_name_raw = $5,
            match_type = $6,
            coverage_status = $7,
            necessity_level = $8,
            utility_text = $9,
            recommended_decision = $10,
            comment = $11,
            validated_by_user = $12,
            status = $13,
            updated_at = now()
          where id = $1 and appel_offres_id = $2
          returning
            id,
            appel_offres_id,
            requirement_id,
            logiciel_id,
            software_name_raw,
            match_type,
            coverage_status,
            necessity_level,
            utility_text,
            recommended_decision,
            comment,
            validated_by_user,
            status,
            created_at,
            updated_at
        `
    : `
          insert into ${MATCHES_TABLE} (
            appel_offres_id,
            requirement_id,
            logiciel_id,
            software_name_raw,
            match_type,
            coverage_status,
            necessity_level,
            utility_text,
            recommended_decision,
            comment,
            validated_by_user,
            status,
            created_at,
            updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
          returning
            id,
            appel_offres_id,
            requirement_id,
            logiciel_id,
            software_name_raw,
            match_type,
            coverage_status,
            necessity_level,
            utility_text,
            recommended_decision,
            comment,
            validated_by_user,
            status,
            created_at,
            updated_at
        `;
  const params = input.id
    ? [
        input.id,
        appel.id,
        input.requirementId,
        input.logicielId,
        input.softwareNameRaw,
        input.matchType,
        input.coverageStatus,
        input.necessityLevel,
        input.utilityText || null,
        input.recommendedDecision || null,
        input.comment || null,
        input.validatedByUser,
        input.status
      ]
    : [
        appel.id,
        input.requirementId,
        input.logicielId,
        input.softwareNameRaw,
        input.matchType,
        input.coverageStatus,
        input.necessityLevel,
        input.utilityText || null,
        input.recommendedDecision || null,
        input.comment || null,
        input.validatedByUser,
        input.status
      ];

  const result = await pool.query<MatchRow>(query, params);

  if (!result.rows[0]) {
    throw new Error("La correspondance logicielle est introuvable pour cet appel d'offres.");
  }

  await appendAuditLog(code, "software_analysis.match_saved", {
    matchId: Number(result.rows[0].id),
    mode: input.id ? "update" : "create",
    matchType: input.matchType,
    coverageStatus: input.coverageStatus
  }).catch(() => undefined);

  const softwareById = new Map((await listSoftware({ status: "all" })).map((software) => [software.id, software]));
  return mapMatchRow(result.rows[0], softwareById);
}

export async function saveGapByCode(code: string, input: GapMutationInput) {
  const appel = await requireAppelOffresRecord(code);
  const pool = await requirePool();
  const query = input.id
    ? `
          update ${GAPS_TABLE}
          set
            requirement_id = $3,
            missing_need = $4,
            software_type_needed = $5,
            why_needed = $6,
            urgency_level = $7,
            example_software_or_category = $8,
            recommended_action = $9,
            status = $10,
            updated_at = now()
          where id = $1 and appel_offres_id = $2
          returning
            id,
            appel_offres_id,
            requirement_id,
            missing_need,
            software_type_needed,
            why_needed,
            urgency_level,
            example_software_or_category,
            recommended_action,
            status,
            created_at,
            updated_at
        `
    : `
          insert into ${GAPS_TABLE} (
            appel_offres_id,
            requirement_id,
            missing_need,
            software_type_needed,
            why_needed,
            urgency_level,
            example_software_or_category,
            recommended_action,
            status,
            created_at,
            updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
          returning
            id,
            appel_offres_id,
            requirement_id,
            missing_need,
            software_type_needed,
            why_needed,
            urgency_level,
            example_software_or_category,
            recommended_action,
            status,
            created_at,
            updated_at
        `;
  const params = input.id
    ? [
        input.id,
        appel.id,
        input.requirementId,
        input.missingNeed,
        input.softwareTypeNeeded || null,
        input.whyNeeded || null,
        input.urgencyLevel,
        input.exampleSoftwareOrCategory || null,
        input.recommendedAction || null,
        input.status
      ]
    : [
        appel.id,
        input.requirementId,
        input.missingNeed,
        input.softwareTypeNeeded || null,
        input.whyNeeded || null,
        input.urgencyLevel,
        input.exampleSoftwareOrCategory || null,
        input.recommendedAction || null,
        input.status
      ];

  const result = await pool.query<GapRow>(query, params);

  if (!result.rows[0]) {
    throw new Error("Le manque logiciel est introuvable pour cet appel d'offres.");
  }

  await appendAuditLog(code, "software_analysis.gap_saved", {
    gapId: Number(result.rows[0].id),
    mode: input.id ? "update" : "create",
    status: input.status
  }).catch(() => undefined);

  return mapGapRow(result.rows[0]);
}

export async function saveConfirmationByCode(code: string, input: ConfirmationMutationInput) {
  const appel = await requireAppelOffresRecord(code);
  const pool = await requirePool();
  const query = input.id
    ? `
          update ${CONFIRMATIONS_TABLE}
          set
            topic = $3,
            question_text = $4,
            status = $5,
            resolution_note = $6,
            updated_at = now()
          where id = $1 and appel_offres_id = $2 and scope = 'logiciels'
          returning
            id,
            appel_offres_id,
            scope,
            topic,
            question_text,
            status,
            resolution_note,
            created_at,
            updated_at
        `
    : `
          insert into ${CONFIRMATIONS_TABLE} (
            appel_offres_id,
            scope,
            topic,
            question_text,
            status,
            resolution_note,
            created_at,
            updated_at
          )
          values ($1, 'logiciels', $2, $3, $4, $5, now(), now())
          returning
            id,
            appel_offres_id,
            scope,
            topic,
            question_text,
            status,
            resolution_note,
            created_at,
            updated_at
        `;
  const params = input.id
    ? [
        input.id,
        appel.id,
        input.topic,
        input.questionText,
        input.status,
        input.resolutionNote || null
      ]
    : [
        appel.id,
        input.topic,
        input.questionText,
        input.status,
        input.resolutionNote || null
      ];

  const result = await pool.query<ConfirmationRow>(query, params);

  if (!result.rows[0]) {
    throw new Error("Le point a confirmer est introuvable pour cet appel d'offres.");
  }

  await appendAuditLog(code, "software_analysis.confirmation_saved", {
    confirmationId: Number(result.rows[0].id),
    mode: input.id ? "update" : "create",
    status: input.status
  }).catch(() => undefined);

  return mapConfirmationRow(result.rows[0]);
}

export async function saveSourceByCode(code: string, input: SourceMutationInput) {
  const appel = await requireAppelOffresRecord(code);
  const pool = await requirePool();
  const query = input.id
    ? `
          update ${SOURCES_TABLE}
          set
            source_label = $3,
            file_name = $4,
            sheet_name = $5,
            source_excerpt = $6,
            comment = $7,
            updated_at = now()
          where id = $1 and appel_offres_id = $2 and scope = 'logiciels'
          returning
            id,
            appel_offres_id,
            scope,
            source_label,
            file_name,
            sheet_name,
            source_excerpt,
            comment,
            created_at,
            updated_at
        `
    : `
          insert into ${SOURCES_TABLE} (
            appel_offres_id,
            scope,
            source_label,
            file_name,
            sheet_name,
            source_excerpt,
            comment,
            created_at,
            updated_at
          )
          values ($1, 'logiciels', $2, $3, $4, $5, $6, now(), now())
          returning
            id,
            appel_offres_id,
            scope,
            source_label,
            file_name,
            sheet_name,
            source_excerpt,
            comment,
            created_at,
            updated_at
        `;
  const params = input.id
    ? [
        input.id,
        appel.id,
        input.sourceLabel,
        input.fileName || null,
        input.sheetName || null,
        input.sourceExcerpt || null,
        input.comment || null
      ]
    : [
        appel.id,
        input.sourceLabel,
        input.fileName || null,
        input.sheetName || null,
        input.sourceExcerpt || null,
        input.comment || null
      ];

  const result = await pool.query<SourceRow>(query, params);

  if (!result.rows[0]) {
    throw new Error("La source est introuvable pour cet appel d'offres.");
  }

  await appendAuditLog(code, "software_analysis.source_saved", {
    sourceId: Number(result.rows[0].id),
    mode: input.id ? "update" : "create"
  }).catch(() => undefined);

  return mapSourceRow(result.rows[0]);
}

export async function transitionSoftwareAnalysisReviewByCode(
  code: string,
  action: SoftwareAnalysisTransitionAction
) {
  const current = await ensureSoftwareAnalysisReviewByCode(code);
  if (!canTransitionSoftwareAnalysisStatus(current.status, action)) {
    throw new Error("La transition demandee n'est pas autorisee pour l'etat actuel.");
  }

  const pool = await requirePool();
  const nextStatus =
    action === "submit" ? "submitted" : action === "validate" ? "validated" : "draft";
  const result = await pool.query<ReviewRow>(
    `
      update ${REVIEWS_TABLE}
      set
        status = $2,
        submitted_at = case
          when $2 = 'submitted' then now()
          when $2 = 'draft' then null
          else submitted_at
        end,
        validated_at = case
          when $2 = 'validated' then now()
          when $2 = 'draft' then null
          else validated_at
        end,
        updated_at = now()
      where id = $1
      returning
        id,
        appel_offres_id,
        scope,
        status,
        submitted_at,
        validated_at,
        created_at,
        updated_at
    `,
    [current.id, nextStatus]
  );

  const review = mapReviewRow(result.rows[0]);

  await appendAuditLog(
    code,
    action === "submit"
      ? "software_analysis.submitted"
      : action === "validate"
        ? "software_analysis.validated"
        : "software_analysis.reopened",
    {
      previousStatus: current.status,
      nextStatus: review.status
    }
  ).catch(() => undefined);

  return review;
}

export async function closeSoftwareAnalysisPool() {
  const globalWithPool = globalThis as GlobalWithPool;
  if (globalWithPool.__softwareAnalysisPool) {
    await globalWithPool.__softwareAnalysisPool.end();
    globalWithPool.__softwareAnalysisPool = undefined;
    globalWithPool.__softwareAnalysisSetupPromise = undefined;
  }
}
