import { Pool, type PoolClient } from "pg";
import type {
  SoftwareAliasRecord,
  SoftwareImportPreview,
  SoftwareImportSummary,
  SoftwareListFilters,
  SoftwareMutationInput,
  SoftwareRecord,
  SoftwareStatus
} from "./types.ts";
import { validateSoftwareMutationInput } from "./validation.ts";
import {
  normalizeSoftwareAlias,
  normalizeSoftwareComparisonName,
  normalizeSoftwareDisplayName
} from "./normalization.ts";

const SOFTWARE_TABLE = "public.logiciels";
const SOFTWARE_ALIASES_TABLE = "public.logiciel_aliases";

type GlobalWithPool = typeof globalThis & {
  __logicielsPool?: Pool;
  __logicielsSetupPromise?: Promise<void>;
};

type SoftwareRow = {
  id: number | string;
  name: string;
  normalized_name: string;
  description_raw: string | null;
  status: SoftwareStatus;
  created_at: string | Date;
  updated_at: string | Date;
};

type SoftwareAliasRow = {
  id: number | string;
  logiciel_id: number | string;
  alias: string;
  normalized_alias: string;
  source: SoftwareAliasRecord["source"];
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

  if (!globalWithPool.__logicielsPool) {
    globalWithPool.__logicielsPool = new Pool({
      connectionString: databaseUrl
    });
  }

  return globalWithPool.__logicielsPool;
}

function normalizeTimestamp(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value;
}

function mapAliasRow(row: SoftwareAliasRow): SoftwareAliasRecord {
  return {
    id: Number(row.id),
    softwareId: Number(row.logiciel_id),
    alias: row.alias,
    normalizedAlias: row.normalized_alias,
    source: row.source,
    createdAt: normalizeTimestamp(row.created_at)
  };
}

function mapSoftwareRow(row: SoftwareRow, aliases: SoftwareAliasRecord[]): SoftwareRecord {
  return {
    id: Number(row.id),
    name: row.name,
    normalizedName: row.normalized_name,
    descriptionRaw: row.description_raw ?? "",
    status: row.status,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    aliases
  };
}

async function ensureSchemaInternal(pool: Pool) {
  const client = await pool.connect();

  try {
    await client.query(`
      create table if not exists ${SOFTWARE_TABLE} (
        id bigserial primary key,
        name text not null,
        normalized_name text not null,
        description_raw text null,
        status text not null check (status in ('active', 'archived')) default 'active',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      alter table ${SOFTWARE_TABLE}
      add column if not exists normalized_name text,
      add column if not exists description_raw text null,
      add column if not exists status text not null default 'active',
      add column if not exists created_at timestamptz not null default now(),
      add column if not exists updated_at timestamptz not null default now()
    `);
    await client.query(`
      update ${SOFTWARE_TABLE}
      set normalized_name = lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))
      where normalized_name is null or normalized_name = ''
    `);
    await client.query(`
      alter table ${SOFTWARE_TABLE}
      alter column normalized_name set not null
    `);
    await client.query(`
      alter table ${SOFTWARE_TABLE}
      drop constraint if exists logiciels_status_check
    `);
    await client.query(`
      alter table ${SOFTWARE_TABLE}
      add constraint logiciels_status_check
      check (status in ('active', 'archived'))
    `);
    await client.query(`
      create unique index if not exists logiciels_normalized_name_uidx
      on ${SOFTWARE_TABLE} (normalized_name)
    `);
    await client.query(`
      create index if not exists logiciels_status_idx
      on ${SOFTWARE_TABLE} (status)
    `);
    await client.query(`
      create index if not exists logiciels_updated_at_idx
      on ${SOFTWARE_TABLE} (updated_at desc)
    `);
    await client.query(`
      create table if not exists ${SOFTWARE_ALIASES_TABLE} (
        id bigserial primary key,
        logiciel_id bigint not null references ${SOFTWARE_TABLE}(id) on delete cascade,
        alias text not null,
        normalized_alias text not null,
        source text not null check (source in ('manual', 'catalogue_import')),
        created_at timestamptz not null default now(),
        unique (logiciel_id, normalized_alias)
      )
    `);
    await client.query(`
      create index if not exists logiciel_aliases_logiciel_id_idx
      on ${SOFTWARE_ALIASES_TABLE} (logiciel_id)
    `);
    await client.query(`
      create index if not exists logiciel_aliases_normalized_alias_idx
      on ${SOFTWARE_ALIASES_TABLE} (normalized_alias)
    `);
  } finally {
    client.release();
  }
}

export async function ensureSoftwareSchema() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const globalWithPool = globalThis as GlobalWithPool;
  if (!globalWithPool.__logicielsSetupPromise) {
    globalWithPool.__logicielsSetupPromise = ensureSchemaInternal(pool).catch((error) => {
      globalWithPool.__logicielsSetupPromise = undefined;
      throw error;
    });
  }

  await globalWithPool.__logicielsSetupPromise;
}

async function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  await ensureSoftwareSchema();
  return pool;
}

async function listAliasesBySoftwareIds(
  client: Pool | PoolClient,
  softwareIds: number[]
) {
  if (!softwareIds.length) {
    return new Map<number, SoftwareAliasRecord[]>();
  }

  const result = await client.query<SoftwareAliasRow>(
    `
      select
        id,
        logiciel_id,
        alias,
        normalized_alias,
        source,
        created_at
      from ${SOFTWARE_ALIASES_TABLE}
      where logiciel_id = any($1::bigint[])
      order by alias asc
    `,
    [softwareIds]
  );

  const aliasesBySoftwareId = new Map<number, SoftwareAliasRecord[]>();
  for (const row of result.rows) {
    const softwareId = Number(row.logiciel_id);
    const current = aliasesBySoftwareId.get(softwareId) ?? [];
    current.push(mapAliasRow(row));
    aliasesBySoftwareId.set(softwareId, current);
  }

  return aliasesBySoftwareId;
}

function buildSoftwareWhereClause(filters: SoftwareListFilters) {
  const clauses: string[] = [];
  const values: Array<string> = [];

  if (filters.status && filters.status !== "all") {
    values.push(filters.status);
    clauses.push(`logiciel.status = $${values.length}`);
  }

  if (filters.search?.trim()) {
    values.push(`%${filters.search.trim().toLocaleLowerCase("fr-FR")}%`);
    const index = values.length;
    clauses.push(`
      (
        lower(logiciel.name) like $${index}
        or lower(coalesce(logiciel.description_raw, '')) like $${index}
        or exists (
          select 1
          from ${SOFTWARE_ALIASES_TABLE} alias_search
          where alias_search.logiciel_id = logiciel.id
            and lower(alias_search.alias) like $${index}
        )
      )
    `);
  }

  return {
    whereClause: clauses.length ? `where ${clauses.join(" and ")}` : "",
    values
  };
}

export async function listSoftware(filters: SoftwareListFilters = {}) {
  const pool = await requirePool();
  const { whereClause, values } = buildSoftwareWhereClause(filters);
  const result = await pool.query<SoftwareRow>(
    `
      select
        logiciel.id,
        logiciel.name,
        logiciel.normalized_name,
        logiciel.description_raw,
        logiciel.status,
        logiciel.created_at,
        logiciel.updated_at
      from ${SOFTWARE_TABLE} logiciel
      ${whereClause}
      order by logiciel.updated_at desc, logiciel.name asc
    `,
    values
  );

  const softwareIds = result.rows.map((row) => Number(row.id));
  const aliasesBySoftwareId = await listAliasesBySoftwareIds(pool, softwareIds);

  return result.rows.map((row) =>
    mapSoftwareRow(row, aliasesBySoftwareId.get(Number(row.id)) ?? [])
  );
}

export async function getSoftwareById(id: number) {
  const pool = await requirePool();
  const result = await pool.query<SoftwareRow>(
    `
      select
        id,
        name,
        normalized_name,
        description_raw,
        status,
        created_at,
        updated_at
      from ${SOFTWARE_TABLE}
      where id = $1
      limit 1
    `,
    [id]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const aliasesBySoftwareId = await listAliasesBySoftwareIds(pool, [Number(row.id)]);
  return mapSoftwareRow(row, aliasesBySoftwareId.get(Number(row.id)) ?? []);
}

async function listSoftwareByNormalizedNamesWithClient(
  client: Pool | PoolClient,
  normalizedNames: string[]
) {
  if (!normalizedNames.length) {
    return new Map<string, SoftwareRecord>();
  }

  const result = await client.query<SoftwareRow>(
    `
      select
        id,
        name,
        normalized_name,
        description_raw,
        status,
        created_at,
        updated_at
      from ${SOFTWARE_TABLE}
      where normalized_name = any($1::text[])
    `,
    [normalizedNames]
  );

  const softwareIds = result.rows.map((row) => Number(row.id));
  const aliasesBySoftwareId = await listAliasesBySoftwareIds(client, softwareIds);
  const softwareByNormalizedName = new Map<string, SoftwareRecord>();

  for (const row of result.rows) {
    softwareByNormalizedName.set(
      row.normalized_name,
      mapSoftwareRow(row, aliasesBySoftwareId.get(Number(row.id)) ?? [])
    );
  }

  return softwareByNormalizedName;
}

export async function listSoftwareByNormalizedNames(normalizedNames: string[]) {
  const pool = await requirePool();
  return listSoftwareByNormalizedNamesWithClient(pool, normalizedNames);
}

async function insertSoftwareWithClient(
  client: PoolClient,
  input: {
    name: string;
    normalizedName: string;
    descriptionRaw: string;
    status?: SoftwareStatus;
  }
) {
  const result = await client.query<SoftwareRow>(
    `
      insert into ${SOFTWARE_TABLE} (
        name,
        normalized_name,
        description_raw,
        status,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, now(), now())
      returning
        id,
        name,
        normalized_name,
        description_raw,
        status,
        created_at,
        updated_at
    `,
    [
      input.name,
      input.normalizedName,
      input.descriptionRaw || null,
      input.status ?? "active"
    ]
  );

  return result.rows[0];
}

async function ensureAliasWithClient(
  client: PoolClient,
  input: {
    softwareId: number;
    alias: string;
    source: SoftwareAliasRecord["source"];
  }
) {
  const alias = normalizeSoftwareDisplayName(input.alias);
  if (!alias) {
    return false;
  }

  const normalizedAlias = normalizeSoftwareAlias(alias);

  const result = await client.query(
    `
      insert into ${SOFTWARE_ALIASES_TABLE} (
        logiciel_id,
        alias,
        normalized_alias,
        source,
        created_at
      )
      values ($1, $2, $3, $4, now())
      on conflict (logiciel_id, normalized_alias)
      do nothing
    `,
    [input.softwareId, alias, normalizedAlias, input.source]
  );

  return (result.rowCount ?? 0) > 0;
}

async function replaceAliasesWithClient(
  client: PoolClient,
  software: SoftwareRecord,
  nextNormalizedName: string,
  aliases: string[]
) {
  const normalizedAliases = new Map<string, string>();
  for (const alias of aliases) {
    const displayAlias = normalizeSoftwareDisplayName(alias);
    const normalizedAlias = normalizeSoftwareAlias(displayAlias);
    if (!normalizedAlias || normalizedAlias === nextNormalizedName) {
      continue;
    }

    if (!normalizedAliases.has(normalizedAlias)) {
      normalizedAliases.set(normalizedAlias, displayAlias);
    }
  }

  await client.query(
    `
      delete from ${SOFTWARE_ALIASES_TABLE}
      where logiciel_id = $1
        and source = 'manual'
    `,
    [software.id]
  );

  for (const alias of normalizedAliases.values()) {
    await ensureAliasWithClient(client, {
      softwareId: software.id,
      alias,
      source: "manual"
    });
  }
}

export async function createSoftware(input: SoftwareMutationInput) {
  const pool = await requirePool();
  const normalized = validateSoftwareMutationInput(input);

  const client = await pool.connect();

  try {
    await client.query("begin");
    const inserted = await insertSoftwareWithClient(client, normalized);
    for (const alias of normalized.aliases) {
      await ensureAliasWithClient(client, {
        softwareId: Number(inserted.id),
        alias,
        source: "manual"
      });
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return getSoftwareByIdFromRequiredPool(pool, normalized.normalizedName);
}

async function getSoftwareByIdFromRequiredPool(pool: Pool, normalizedName: string) {
  const result = await pool.query<SoftwareRow>(
    `
      select
        id,
        name,
        normalized_name,
        description_raw,
        status,
        created_at,
        updated_at
      from ${SOFTWARE_TABLE}
      where normalized_name = $1
      limit 1
    `,
    [normalizedName]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const aliasesBySoftwareId = await listAliasesBySoftwareIds(pool, [Number(row.id)]);
  return mapSoftwareRow(row, aliasesBySoftwareId.get(Number(row.id)) ?? []);
}

export async function updateSoftware(id: number, input: SoftwareMutationInput) {
  const pool = await requirePool();
  const current = await getSoftwareById(id);
  if (!current) {
    return null;
  }

  const normalized = validateSoftwareMutationInput(input);
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query(
      `
        update ${SOFTWARE_TABLE}
        set
          name = $2,
          normalized_name = $3,
          description_raw = $4,
          updated_at = now()
        where id = $1
      `,
      [id, normalized.name, normalized.normalizedName, normalized.descriptionRaw || null]
    );
    await replaceAliasesWithClient(
      client,
      current,
      normalized.normalizedName,
      normalized.aliases
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return getSoftwareById(id);
}

export async function setSoftwareStatus(id: number, status: SoftwareStatus) {
  const pool = await requirePool();
  const result = await pool.query(
    `
      update ${SOFTWARE_TABLE}
      set
        status = $2,
        updated_at = now()
      where id = $1
      returning id
    `,
    [id, status]
  );

  if (!result.rows[0]) {
    return null;
  }

  return getSoftwareById(id);
}

export async function applySoftwareImportPreview(preview: SoftwareImportPreview) {
  const pool = await requirePool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const normalizedNames = [
      ...new Set(
        preview.candidates
          .map((candidate) => candidate.normalizedName)
          .filter((value): value is string => Boolean(value))
      )
    ];
    const softwareByNormalizedName = await listSoftwareByNormalizedNamesWithClient(
      client,
      normalizedNames
    );

    let createdRecords = 0;
    let existingMatches = 0;
    let updatedDescriptions = 0;
    let addedAliases = 0;
    let duplicateCandidates = 0;
    const insertedThisRun = new Set<string>();

    for (const candidate of preview.candidates) {
      if (!candidate.normalizedName || !candidate.proposedName || !candidate.sourceName) {
        continue;
      }

      const normalizedName = candidate.normalizedName;
      const existing = softwareByNormalizedName.get(normalizedName);

      if (!existing && insertedThisRun.has(normalizedName)) {
        duplicateCandidates += 1;
        continue;
      }

      if (existing) {
        existingMatches += 1;

        if (!existing.descriptionRaw.trim() && candidate.rawUsage.trim()) {
          await client.query(
            `
              update ${SOFTWARE_TABLE}
              set
                description_raw = $2,
                updated_at = now()
              where id = $1
            `,
            [existing.id, candidate.rawUsage]
          );
          updatedDescriptions += 1;
        }

        if (
          candidate.sourceName !== existing.name &&
          normalizeSoftwareComparisonName(candidate.sourceName) === normalizedName
        ) {
          const inserted = await ensureAliasWithClient(client, {
            softwareId: existing.id,
            alias: candidate.sourceName,
            source: "catalogue_import"
          });
          if (inserted) {
            addedAliases += 1;
          }
        }

        continue;
      }

      const inserted = await insertSoftwareWithClient(client, {
        name: candidate.proposedName,
        normalizedName,
        descriptionRaw: candidate.rawUsage,
        status: "active"
      });
      const insertedId = Number(inserted.id);
      const createdRecord = mapSoftwareRow(inserted, []);
      softwareByNormalizedName.set(normalizedName, createdRecord);
      insertedThisRun.add(normalizedName);
      createdRecords += 1;

      if (
        candidate.sourceName !== candidate.proposedName &&
        normalizeSoftwareComparisonName(candidate.sourceName) === normalizedName
      ) {
        const aliasInserted = await ensureAliasWithClient(client, {
          softwareId: insertedId,
          alias: candidate.sourceName,
          source: "catalogue_import"
        });
        if (aliasInserted) {
          addedAliases += 1;
        }
      }
    }

    await client.query("commit");

    return {
      sourceFileName: preview.sourceFileName,
      worksheetName: preview.worksheetName,
      totalRowsInspected: preview.totalRowsInspected,
      validSoftwareCandidates: preview.validSoftwareCandidates,
      createdRecords,
      existingMatches,
      updatedDescriptions,
      addedAliases,
      skippedRows: preview.rowsSkipped,
      duplicateCandidates,
      warnings: preview.warnings
    } satisfies SoftwareImportSummary;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function closeSoftwarePool() {
  const globalWithPool = globalThis as GlobalWithPool;
  if (globalWithPool.__logicielsPool) {
    await globalWithPool.__logicielsPool.end();
    globalWithPool.__logicielsPool = undefined;
    globalWithPool.__logicielsSetupPromise = undefined;
  }
}
