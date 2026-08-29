// Phase 2 - deterministic technical-bucket backfill (RULE method only).
//
// archive_files.extension -> classifyTechnicalBucket(extension) ->
// archive_file_classifications.technical_bucket
//
// No AI, no filesystem access, no document content is ever read. Extension
// only. See lib/archive-cartography/classification.ts for the pure
// classification logic reused here, and
// scripts/sql/20260829_archive_cartography_classification.sql for the
// target schema.
//
// Usage:
//   node --experimental-strip-types scripts/archive_cartography/backfill_technical_buckets.ts [--dry-run] [--batch-size 500]

import nextEnv from "@next/env";
import { pathToFileURL } from "node:url";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  classifyTechnicalBucket,
  decideTechnicalBackfillWrite,
  isClassificationState,
  isTechnicalBucket,
  type ClassificationMethod,
  type TechnicalClassificationSnapshot
} from "../../lib/archive-cartography/classification.ts";
import {
  closeAdministrationDashboardPool,
  getAdministrationDashboardPool
} from "../../lib/administration/dashboard.ts";

const DEFAULT_BATCH_SIZE = 500;

export type CliOptions = {
  dryRun: boolean;
  batchSize: number;
};

export function parseCliArgs(argv: string[]): CliOptions {
  let dryRun = false;
  let batchSize = DEFAULT_BATCH_SIZE;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--batch-size") {
      const value = argv[index + 1];
      batchSize = parseBatchSize(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--batch-size=")) {
      batchSize = parseBatchSize(arg.slice("--batch-size=".length));
      continue;
    }
  }

  return { dryRun, batchSize };
}

function parseBatchSize(value: string | undefined): number {
  const parsed = value ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid --batch-size value: ${value ?? "(missing)"}`);
  }
  return parsed;
}

type ArchiveFileRow = {
  id: number;
  extension: string | null;
};

type ExistingClassificationRow = {
  technical_bucket: string | null;
  classification_state: string | null;
  classification_method: string | null;
  classified_at: string | null;
};

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
};

function toSnapshot(row: ExistingClassificationRow | undefined): TechnicalClassificationSnapshot {
  if (!row) {
    return null;
  }
  return {
    technicalBucket: row.technical_bucket && isTechnicalBucket(row.technical_bucket) ? row.technical_bucket : null,
    classificationState:
      row.classification_state && isClassificationState(row.classification_state)
        ? row.classification_state
        : "UNCLASSIFIED",
    classificationMethod: (row.classification_method as ClassificationMethod | null) ?? null,
    classifiedAt: row.classified_at
  };
}

type BatchCounts = {
  seen: number;
  classified: number;
  unchanged: number;
  unknown: number;
};

async function readExistingClassification(executor: Queryable, archiveFileId: number) {
  const result = await executor.query<ExistingClassificationRow>(
    `
      select technical_bucket, classification_state, classification_method, classified_at
      from knowledge_base.archive_file_classifications
      where archive_file_id = $1
    `,
    [archiveFileId]
  );
  return toSnapshot(result.rows[0]);
}

async function writeTechnicalBucket(
  executor: Queryable,
  archiveFileId: number,
  decision: ReturnType<typeof decideTechnicalBackfillWrite>
) {
  await executor.query(
    `
      insert into knowledge_base.archive_file_classifications (
        archive_file_id,
        technical_bucket,
        classification_state,
        classification_method,
        classified_at,
        updated_at
      )
      values (
        $1,
        $2,
        $3,
        $4,
        case when $5 then now() else null end,
        now()
      )
      on conflict (archive_file_id) do update set
        technical_bucket = excluded.technical_bucket,
        classification_state = excluded.classification_state,
        classification_method = excluded.classification_method,
        classified_at = coalesce(
          knowledge_base.archive_file_classifications.classified_at,
          excluded.classified_at
        ),
        updated_at = excluded.updated_at
    `,
    [archiveFileId, decision.technicalBucket, decision.classificationState, decision.classificationMethod, decision.classifiedAtShouldBeSet]
  );
}

/**
 * Processes one batch of (id, extension) rows and returns aggregate counts
 * only - never an id, filename, path, or hash. In dry-run mode this reads
 * the existing classification (to compute an honest changed/unchanged
 * count) but issues no INSERT/UPDATE and no transaction/row lock at all.
 * Outside dry-run, the whole batch runs in one transaction: any error
 * rolls back every write in that batch (the caller counts the whole batch
 * as failed).
 */
async function processBatch(
  executor: Queryable,
  rows: ArchiveFileRow[],
  dryRun: boolean
): Promise<BatchCounts> {
  const counts: BatchCounts = { seen: 0, classified: 0, unchanged: 0, unknown: 0 };

  for (const row of rows) {
    counts.seen += 1;

    const existing = await readExistingClassification(executor, row.id);
    const decision = decideTechnicalBackfillWrite(row.extension, existing);

    if (decision.technicalBucket === "UNKNOWN") {
      counts.unknown += 1;
    }

    if (!decision.changed) {
      counts.unchanged += 1;
      continue;
    }

    counts.classified += 1;

    if (!dryRun) {
      await writeTechnicalBucket(executor, row.id, decision);
    }
  }

  return counts;
}

async function main() {
  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(process.cwd());

  const { dryRun, batchSize } = parseCliArgs(process.argv.slice(2));

  // Never log the connection string itself - only that a pool was acquired.
  const pool: Pool = getAdministrationDashboardPool();

  let seen = 0;
  let classified = 0;
  let unchanged = 0;
  let unknown = 0;
  let failed = 0;
  let failedBatches = 0;

  let lastId = 0;

  for (;;) {
    const batch = await pool.query<ArchiveFileRow>(
      `
        select id, extension
        from knowledge_base.archive_files
        where id > $1
        order by id asc
        limit $2
      `,
      [lastId, batchSize]
    );

    if (batch.rows.length === 0) {
      break;
    }

    lastId = batch.rows[batch.rows.length - 1].id;

    if (dryRun) {
      // Read-only: no transaction, no row lock, no write of any kind.
      const counts = await processBatch(pool, batch.rows, true);
      seen += counts.seen;
      classified += counts.classified;
      unchanged += counts.unchanged;
      unknown += counts.unknown;
      continue;
    }

    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      await client.query("begin");
      const counts = await processBatch(client, batch.rows, false);
      await client.query("commit");

      seen += counts.seen;
      classified += counts.classified;
      unchanged += counts.unchanged;
      unknown += counts.unknown;
    } catch {
      if (client) {
        await client.query("rollback").catch(() => {
          // Best-effort rollback; the transaction is over either way once
          // the connection is released below.
        });
      }
      failed += batch.rows.length;
      failedBatches += 1;
      // Deliberately generic and aggregate-only: the raw driver error can
      // embed the connection string (host/user/password), SQL parameter
      // values, or other connection details. Never surface the underlying
      // error's message here - only the fact and size of the failure.
      console.error("[backfill] Technical bucket batch failed; transaction rolled back.");
    } finally {
      client?.release();
    }
  }

  const summary = { seen, classified, unchanged, unknown, failed, failedBatches, dryRun, batchSize };
  console.log(JSON.stringify(summary, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeAdministrationDashboardPool();
    });
}
