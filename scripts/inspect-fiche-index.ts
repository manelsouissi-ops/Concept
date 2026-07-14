import nextEnv from "@next/env";
import { closeFicheIndexPool, ensureFicheIndexSchema } from "../lib/db.ts";
import { Pool } from "pg";

async function withClient<T>(fn: (pool: Pool) => Promise<T>) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  const pool = new Pool({ connectionString });

  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function showSchema() {
  return withClient(async (pool) => {
    const columns = await pool.query(
      `
        select
          column_name,
          data_type,
          udt_name,
          is_nullable
        from information_schema.columns
        where table_schema = 'cdc_fiches'
          and table_name = 'fiches_projet'
        order by ordinal_position
      `
    );
    const indexes = await pool.query(
      `
        select indexname, indexdef
        from pg_indexes
        where schemaname = 'cdc_fiches'
          and tablename = 'fiches_projet'
        order by indexname
      `
    );

    console.log(
      JSON.stringify(
        {
          columns: columns.rows,
          indexes: indexes.rows
        },
        null,
        2
      )
    );
  });
}

async function showRow(codeInterne: string) {
  return withClient(async (pool) => {
    const result = await pool.query(
      `
        select
          code_interne,
          status,
          created_at,
          validated_at,
          extraction,
          evaluation,
          controle
        from cdc_fiches.fiches_projet
        where code_interne = $1
      `,
      [codeInterne]
    );

    console.log(JSON.stringify(result.rows[0] ?? null, null, 2));
  });
}

async function main() {
  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(process.cwd());
  await ensureFicheIndexSchema();

  const [mode, value] = process.argv.slice(2);

  if (mode === "schema") {
    await showSchema();
    return;
  }

  if (mode === "row" && value) {
    await showRow(value);
    return;
  }

  throw new Error("Usage: node --experimental-strip-types scripts/inspect-fiche-index.ts schema|row <code>");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeFicheIndexPool();
  });
