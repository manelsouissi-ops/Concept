/**
 * Controlled local ingestion CLI for the FCI C historical project-reference
 * RAG pilot. See docs/HISTORICAL_PROJECT_INGESTION_PILOT.md.
 *
 * Usage:
 *   node --experimental-strip-types scripts/ingest-historical-project-records.ts <manifest.json>
 *
 * <manifest.json> must be an array of objects matching
 * HistoricalProjectRecordInput (lib/appels-offres/fci/historical-project-ingestion.ts)
 * plus a `sourceDocumentSourcePath` pointing at the already-approved local
 * file to hash. This script does NOT scan any directory on its own, does
 * NOT decide what is approved, and does NOT call any external service -
 * only local Ollama (embeddings) and local Qdrant (vector upsert) once a
 * record's reuseStatus is already "approved_for_rag" in the manifest.
 *
 * This script is intentionally NOT invoked with real data by any automated
 * process in this repository: an explicitly approved 5-20 record manifest
 * must be supplied by hand, deliberately, each time.
 */
import nextEnv from "@next/env";
import { Pool } from "pg";
import {
  computeFileSha256,
  ingestHistoricalProjectRecord,
  type HistoricalProjectRecordInput
} from "../lib/appels-offres/fci/historical-project-ingestion.ts";

type ManifestEntry = HistoricalProjectRecordInput;

async function main() {
  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(process.cwd());

  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error(
      "[ingest-historical-project-records] Missing manifest path. Usage: " +
        "node --experimental-strip-types scripts/ingest-historical-project-records.ts <manifest.json>"
    );
    process.exitCode = 1;
    return;
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("[ingest-historical-project-records] DATABASE_URL is not configured.");
    process.exitCode = 1;
    return;
  }

  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(manifestPath, "utf8");
  const entries = JSON.parse(raw) as ManifestEntry[];

  if (!Array.isArray(entries) || entries.length === 0) {
    console.error("[ingest-historical-project-records] Manifest must be a non-empty JSON array.");
    process.exitCode = 1;
    return;
  }
  if (entries.length > 20) {
    console.error(
      `[ingest-historical-project-records] Manifest has ${entries.length} entries; this pilot is capped at 20. Refusing to proceed.`
    );
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const summary = { invalid: 0, notApproved: 0, unchanged: 0, indexed: 0, failed: 0 };

  try {
    for (const entry of entries) {
      const stat = await fs.stat(entry.sourceDocumentSourcePath);
      const sha256 = await computeFileSha256(entry.sourceDocumentSourcePath);
      const result = await ingestHistoricalProjectRecord(pool, entry, {
        sha256,
        fileSize: stat.size
      });

      switch (result.status) {
        case "invalid":
          summary.invalid += 1;
          console.warn(
            `[ingest-historical-project-records] Invalid record (${entry.sourceDocumentFilename}): ${JSON.stringify(result.issues)}`
          );
          break;
        case "not_approved":
          summary.notApproved += 1;
          console.log(
            `[ingest-historical-project-records] Stored, not indexed (reuseStatus=${result.reuseStatus}), documentVersionId=${result.documentVersionId}.`
          );
          break;
        case "unchanged":
          summary.unchanged += 1;
          console.log(`[ingest-historical-project-records] Unchanged, already indexed, documentVersionId=${result.documentVersionId}.`);
          break;
        case "indexed":
          summary.indexed += 1;
          console.log(
            `[ingest-historical-project-records] Indexed documentVersionId=${result.documentVersionId} (dimension=${result.embeddingDimension}).`
          );
          break;
        case "failed":
          summary.failed += 1;
          console.error(
            `[ingest-historical-project-records] FAILED documentVersionId=${result.documentVersionId}: ${result.errorCode} ${result.errorMessage}`
          );
          break;
      }
    }
  } finally {
    await pool.end();
  }

  console.log("[ingest-historical-project-records] Summary:", summary);
}

main().catch((error) => {
  console.error("[ingest-historical-project-records] Fatal error:", error);
  process.exitCode = 1;
});
