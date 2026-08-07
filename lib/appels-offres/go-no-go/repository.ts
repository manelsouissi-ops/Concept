import { Pool } from "pg";
import { ensureAppelsOffresSchema } from "../repository.ts";
import type {
  GoNoGoDecisionRecord,
  InsertGoNoGoDecisionVersionInput
} from "./types.ts";

const GO_NO_GO_DECISIONS_TABLE = "public.go_no_go_decisions";

type GlobalWithPool = typeof globalThis & {
  __appelsOffresGoNoGoPool?: Pool;
  __appelsOffresGoNoGoSetupPromise?: Promise<void>;
};

type GoNoGoDecisionRow = {
  id: number | string;
  appel_offres_id: number | string;
  version: number;
  status: GoNoGoDecisionRecord["status"];
  decision: GoNoGoDecisionRecord["decision"];
  rationale: string | null;
  reserves: string | null;
  decided_by: string | null;
  decided_at: string | Date | null;
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
  if (!globalWithPool.__appelsOffresGoNoGoPool) {
    globalWithPool.__appelsOffresGoNoGoPool = new Pool({
      connectionString: databaseUrl
    });
  }

  return globalWithPool.__appelsOffresGoNoGoPool;
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (value == null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapGoNoGoDecisionRow(row: GoNoGoDecisionRow): GoNoGoDecisionRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    version: row.version,
    status: row.status,
    decision: row.decision,
    rationale: row.rationale,
    reserves: row.reserves,
    decidedBy: row.decided_by,
    decidedAt: normalizeTimestamp(row.decided_at),
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString()
  };
}

async function ensureSchemaInternal(pool: Pool) {
  const client = await pool.connect();

  try {
    await client.query(`
      create table if not exists ${GO_NO_GO_DECISIONS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        version integer not null default 1,
        status text not null check (
          status in ('a_decider', 'go', 'no_go', 'reouvert')
        ),
        decision text null check (decision is null or decision in ('go', 'no_go')),
        rationale text null,
        reserves text null,
        decided_by text null,
        decided_at timestamptz null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create unique index if not exists go_no_go_decisions_appel_version_uidx
      on ${GO_NO_GO_DECISIONS_TABLE} (appel_offres_id, version)
    `);
    await client.query(`
      create index if not exists go_no_go_decisions_appel_created_at_idx
      on ${GO_NO_GO_DECISIONS_TABLE} (appel_offres_id, version desc)
    `);
  } finally {
    client.release();
  }
}

export async function ensureGoNoGoSchema() {
  await ensureAppelsOffresSchema();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const globalWithPool = globalThis as GlobalWithPool;
  if (!globalWithPool.__appelsOffresGoNoGoSetupPromise) {
    globalWithPool.__appelsOffresGoNoGoSetupPromise = ensureSchemaInternal(pool).catch(
      (error) => {
        globalWithPool.__appelsOffresGoNoGoSetupPromise = undefined;
        throw error;
      }
    );
  }

  await globalWithPool.__appelsOffresGoNoGoSetupPromise;
}

async function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  await ensureGoNoGoSchema();
  return pool;
}

export async function getLatestGoNoGoDecisionByAppelOffresId(
  appelOffresId: number
): Promise<GoNoGoDecisionRecord | null> {
  const pool = await requirePool();
  const result = await pool.query<GoNoGoDecisionRow>(
    `
      select
        id,
        appel_offres_id,
        version,
        status,
        decision,
        rationale,
        reserves,
        decided_by,
        decided_at,
        created_at,
        updated_at
      from ${GO_NO_GO_DECISIONS_TABLE}
      where appel_offres_id = $1
      order by version desc
      limit 1
    `,
    [appelOffresId]
  );

  return result.rows[0] ? mapGoNoGoDecisionRow(result.rows[0]) : null;
}

export async function listGoNoGoDecisionVersionsByAppelOffresId(
  appelOffresId: number
): Promise<GoNoGoDecisionRecord[]> {
  const pool = await requirePool();
  const result = await pool.query<GoNoGoDecisionRow>(
    `
      select
        id,
        appel_offres_id,
        version,
        status,
        decision,
        rationale,
        reserves,
        decided_by,
        decided_at,
        created_at,
        updated_at
      from ${GO_NO_GO_DECISIONS_TABLE}
      where appel_offres_id = $1
      order by version desc
    `,
    [appelOffresId]
  );

  return result.rows.map(mapGoNoGoDecisionRow);
}

// Mirrors upsertFciModuleData's version pattern (lib/appels-offres/fci/repository.ts):
// every transition is a new row, never an in-place update, so the decision history
// stays fully auditable (who decided/reopened what, and when).
export async function insertGoNoGoDecisionVersion(
  appelOffresId: number,
  input: InsertGoNoGoDecisionVersionInput
): Promise<GoNoGoDecisionRecord> {
  const pool = await requirePool();
  const latest = await getLatestGoNoGoDecisionByAppelOffresId(appelOffresId);
  const nextVersion = (latest?.version ?? 0) + 1;

  const result = await pool.query<GoNoGoDecisionRow>(
    `
      insert into ${GO_NO_GO_DECISIONS_TABLE} (
        appel_offres_id,
        version,
        status,
        decision,
        rationale,
        reserves,
        decided_by,
        decided_at,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
      returning
        id,
        appel_offres_id,
        version,
        status,
        decision,
        rationale,
        reserves,
        decided_by,
        decided_at,
        created_at,
        updated_at
    `,
    [
      appelOffresId,
      nextVersion,
      input.status,
      input.decision,
      input.rationale,
      input.reserves,
      input.decidedBy,
      input.decidedAt
    ]
  );

  return mapGoNoGoDecisionRow(result.rows[0]);
}

export async function closeGoNoGoPool() {
  const globalWithPool = globalThis as GlobalWithPool;

  if (globalWithPool.__appelsOffresGoNoGoPool) {
    await globalWithPool.__appelsOffresGoNoGoPool.end();
    globalWithPool.__appelsOffresGoNoGoPool = undefined;
    globalWithPool.__appelsOffresGoNoGoSetupPromise = undefined;
  }
}
