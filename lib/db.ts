import { Pool } from "pg";
import type {
  ControleSection,
  EvaluationField,
  FichePayload,
  StatusPayload
} from "./types.ts";

const INDEX_SCHEMA = "cdc_fiches";
const INDEX_TABLE = "fiches_projet";
const FULL_TABLE_NAME = `${INDEX_SCHEMA}.${INDEX_TABLE}`;
const EMBEDDING_DIMENSION = 1536;

type ExtractionIndexValue = {
  value: string;
  source: string;
};

type EvaluationIndexValue = {
  note: number | null;
  justification: string;
  charge_estimee: string | null;
};

type ControleIndexValue = {
  champs_non_trouves: string[];
  incoherences: string[];
  a_verifier: string[];
  resolutions: ControleSection["resolutions"];
};

type FicheIndexStatus = Pick<
  StatusPayload,
  "status" | "createdAt" | "validatedAt" | "processingStartedAt" | "errorReason" | "errorStage"
>;

type GlobalWithPool = typeof globalThis & {
  __ficheIndexPool?: Pool;
  __ficheIndexSetupPromise?: Promise<void>;
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

  if (!globalWithPool.__ficheIndexPool) {
    globalWithPool.__ficheIndexPool = new Pool({
      connectionString: databaseUrl
    });
  }

  return globalWithPool.__ficheIndexPool;
}

function buildExtractionIndex(fiche: FichePayload): Record<string, ExtractionIndexValue> {
  return Object.fromEntries(
    fiche.extraction.map((field) => [
      field.key,
      {
        value: field.value,
        source: field.source
      }
    ])
  );
}

function buildEvaluationIndex(fiche: FichePayload): Record<string, EvaluationIndexValue> {
  return Object.fromEntries(
    fiche.evaluation.map((field: EvaluationField) => [
      field.key,
      {
        note: field.score,
        justification: field.justification,
        charge_estimee: field.chargeEstimee ?? null
      }
    ])
  );
}

function buildControleIndex(controle: ControleSection): ControleIndexValue {
  return {
    champs_non_trouves: controle.champsNonTrouves,
    incoherences: controle.incoherences,
    a_verifier: controle.aVerifier,
    resolutions: controle.resolutions
  };
}

async function ensureSchemaInternal(pool: Pool) {
  const client = await pool.connect();

  try {
    await client.query("create extension if not exists vector");
    await client.query(`create schema if not exists ${INDEX_SCHEMA}`);
    await client.query(`
      create table if not exists ${FULL_TABLE_NAME} (
        id bigserial primary key,
        code_interne text not null,
        status text not null check (status in ('processing', 'draft', 'validated', 'error')),
        created_at timestamptz not null,
        validated_at timestamptz null,
        raw_xml text null,
        extraction jsonb null,
        evaluation jsonb null,
        controle jsonb null,
        embedding vector(${EMBEDDING_DIMENSION}) null
      )
    `);
    await client.query(`
      alter table ${FULL_TABLE_NAME}
      alter column raw_xml drop not null,
      alter column extraction drop not null,
      alter column evaluation drop not null,
      alter column controle drop not null
    `);
    await client.query(`
      alter table ${FULL_TABLE_NAME}
      drop constraint if exists fiches_projet_status_check
    `);
    await client.query(`
      alter table ${FULL_TABLE_NAME}
      add constraint fiches_projet_status_check
      check (status in ('processing', 'draft', 'validated', 'error'))
    `);
    await client.query(`
      create unique index if not exists fiches_projet_code_interne_uidx
      on ${FULL_TABLE_NAME} (code_interne)
    `);
    await client.query(`
      create index if not exists fiches_projet_extraction_gin_idx
      on ${FULL_TABLE_NAME}
      using gin (extraction)
    `);
  } finally {
    client.release();
  }
}

export async function ensureFicheIndexSchema() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const globalWithPool = globalThis as GlobalWithPool;

  if (!globalWithPool.__ficheIndexSetupPromise) {
    globalWithPool.__ficheIndexSetupPromise = ensureSchemaInternal(pool).catch((error) => {
      globalWithPool.__ficheIndexSetupPromise = undefined;
      throw error;
    });
  }

  await globalWithPool.__ficheIndexSetupPromise;
}

export async function upsertFicheIndex(
  codeInterne: string,
  xmlString: string | null,
  parsedFiche: FichePayload | null,
  status: FicheIndexStatus
) {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  await ensureFicheIndexSchema();

  await pool.query(
    `
      insert into ${FULL_TABLE_NAME} (
        code_interne,
        status,
        created_at,
        validated_at,
        raw_xml,
        extraction,
        evaluation,
        controle,
        embedding
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, null)
      on conflict (code_interne)
      do update set
        status = excluded.status,
        created_at = excluded.created_at,
        validated_at = excluded.validated_at,
        raw_xml = excluded.raw_xml,
        extraction = excluded.extraction,
        evaluation = excluded.evaluation,
        controle = excluded.controle
    `,
    [
      codeInterne,
      status.status,
      status.createdAt,
      status.validatedAt,
      xmlString,
      parsedFiche ? JSON.stringify(buildExtractionIndex(parsedFiche)) : null,
      parsedFiche ? JSON.stringify(buildEvaluationIndex(parsedFiche)) : null,
      parsedFiche ? JSON.stringify(buildControleIndex(parsedFiche.controle)) : null
    ]
  );
}

export async function syncFicheIndexSafely(
  codeInterne: string,
  xmlString: string | null,
  parsedFiche: FichePayload | null,
  status: FicheIndexStatus,
  context: string
) {
  try {
    await upsertFicheIndex(codeInterne, xmlString, parsedFiche, status);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[fiche-index] Sync skipped after ${context} for ${codeInterne}: ${reason}`
    );
  }
}

export async function getIndexedFicheRow(codeInterne: string) {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const result = await pool.query(
    `
      select
        id,
        code_interne,
        status,
        created_at,
        validated_at,
        raw_xml,
        extraction,
        evaluation,
        controle,
        embedding
      from ${FULL_TABLE_NAME}
      where code_interne = $1
    `,
    [codeInterne]
  );

  return result.rows[0] ?? null;
}

export async function closeFicheIndexPool() {
  const globalWithPool = globalThis as GlobalWithPool;

  if (globalWithPool.__ficheIndexPool) {
    await globalWithPool.__ficheIndexPool.end();
    globalWithPool.__ficheIndexPool = undefined;
    globalWithPool.__ficheIndexSetupPromise = undefined;
  }
}

export { EMBEDDING_DIMENSION, FULL_TABLE_NAME, INDEX_SCHEMA, INDEX_TABLE };
