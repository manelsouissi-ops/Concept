import nextEnv from "@next/env";
import { promises as fs } from "fs";
import path from "path";
import { Client } from "pg";
import { DATA_ROOT } from "../lib/storage.ts";

type AppelOffresRow = {
  code: string;
  status: string;
  archived_at: string | null;
  deleted_at: string | null;
};

function readDatabaseSummary() {
  const value = process.env.DATABASE_URL?.trim();

  if (!value) {
    return {
      present: false
    };
  }

  const parsed = new URL(value);

  return {
    present: true,
    scheme: parsed.protocol.replace(":", ""),
    host: parsed.hostname,
    port: parsed.port || "default",
    database: parsed.pathname.replace(/^\//, ""),
    usernamePresent: Boolean(parsed.username),
    passwordPresent: Boolean(parsed.password)
  };
}

async function listDiskFolders() {
  const entries = await fs.readdir(DATA_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function main() {
  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(process.cwd());

  const environment = {
    envFile: path.join(process.cwd(), ".env.local"),
    database: readDatabaseSummary()
  };

  if (!process.env.DATABASE_URL) {
    console.log(JSON.stringify({ environment, connected: false, reason: "DATABASE_URL missing" }, null, 2));
    return;
  }

  const diskFolders = await listDiskFolders();
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  await client.connect();

  try {
    const tables = await client.query<{
      table_schema: string;
      table_name: string;
    }>(`
      select table_schema, table_name
      from information_schema.tables
      where
        (table_schema = 'public' and table_name in ('appels_offres', 'documents', 'processing_jobs', 'audit_logs'))
        or (table_schema = 'cdc_fiches' and table_name = 'fiches_projet')
      order by table_schema, table_name
    `);

    const columns = await client.query<{
      table_name: string;
      column_name: string;
    }>(`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name in ('appels_offres', 'audit_logs')
        and column_name in ('priorite', 'responsable_commercial', 'archived_at', 'updated_at', 'deleted_at', 'details', 'actor')
      order by table_name, column_name
    `);

    const indexes = await client.query<{ indexname: string }>(`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'appels_offres_updated_at_idx',
          'appels_offres_archived_at_idx',
          'appels_offres_deleted_at_idx',
          'appels_offres_priorite_idx',
          'appels_offres_responsable_idx',
          'documents_appel_offres_id_idx',
          'processing_jobs_appel_offres_id_started_at_idx',
          'audit_logs_appel_offres_id_created_at_idx'
        )
      order by indexname
    `);

    const constraints = await client.query<{ conname: string }>(`
      select conname
      from pg_constraint
      where conname in ('appels_offres_priorite_check', 'fiches_projet_status_check')
      order by conname
    `);

    const counts = await client.query<{
      appels_offres_count: string;
      documents_count: string;
      processing_jobs_count: string;
      audit_logs_count: string;
      fiches_index_count: string;
    }>(`
      select
        (select count(*) from public.appels_offres) as appels_offres_count,
        (select count(*) from public.documents) as documents_count,
        (select count(*) from public.processing_jobs) as processing_jobs_count,
        (select count(*) from public.audit_logs) as audit_logs_count,
        (select count(*) from cdc_fiches.fiches_projet) as fiches_index_count
    `);

    const rows = await client.query<AppelOffresRow>(`
      select code, status, archived_at::text, deleted_at::text
      from public.appels_offres
      order by code asc
    `);

    const dbCodes = rows.rows.map((row) => row.code);
    const diskSet = new Set(diskFolders);
    const dbSet = new Set(dbCodes);

    const unmatchedFolders = diskFolders.filter((code) => !dbSet.has(code));
    const unmatchedRows = dbCodes.filter((code) => !diskSet.has(code));

    const migrationAppearsApplied =
      columns.rows.some((row) => row.table_name === "appels_offres" && row.column_name === "priorite") &&
      columns.rows.some((row) => row.table_name === "appels_offres" && row.column_name === "archived_at") &&
      columns.rows.some((row) => row.table_name === "audit_logs" && row.column_name === "details");

    console.log(
      JSON.stringify(
        {
          environment,
          connected: true,
          migrationAppearsApplied,
          diskFolders: {
            count: diskFolders.length,
            codes: diskFolders
          },
          database: {
            tables: tables.rows,
            columns: columns.rows,
            indexes: indexes.rows.map((row) => row.indexname),
            constraints: constraints.rows.map((row) => row.conname),
            counts: counts.rows[0],
            rows: rows.rows
          },
          mismatches: {
            unmatchedFolders,
            unmatchedRows
          }
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        connected: false,
        message: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
