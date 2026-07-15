import nextEnv from "@next/env";
import { promises as fs } from "fs";
import path from "path";
import {
  closeAppelsOffresPool,
  createAppelOffres,
  ensureAppelsOffresSchema,
  getAppelOffresRecordByCode,
  syncStoredDocumentsMetadata
} from "../lib/appels-offres/repository.ts";
import { DATA_ROOT, readExistingStatus } from "../lib/storage.ts";
import type { AppelOffresSource, AppelOffresStatus } from "../lib/appels-offres/types.ts";

type ReconciliationWarning = {
  code: string;
  reason: string;
};

function mapFicheStatusToAppelOffresStatus(
  ficheStatus: Awaited<ReturnType<typeof readExistingStatus>>
): AppelOffresStatus {
  switch (ficheStatus?.status) {
    case "processing":
      return "processing";
    case "error":
      return "error";
    case "draft":
    case "validated":
      return "ready";
    default:
      return "ready";
  }
}

function inferSource(hasStructuredArtifacts: boolean): AppelOffresSource {
  return hasStructuredArtifacts ? "fiche-flow" : "manual";
}

async function main() {
  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(process.cwd());
  await ensureAppelsOffresSchema();

  const entries = await fs.readdir(DATA_ROOT, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const warnings: ReconciliationWarning[] = [];
  let created = 0;
  let documentsSynced = 0;

  for (const code of directories) {
    const [status, sourcePdf, ficheXml, ficheMarkdown] = await Promise.all([
      readExistingStatus(code).catch(() => null),
      fs.access(path.join(DATA_ROOT, code, "cdc.pdf")).then(() => true).catch(() => false),
      fs.access(path.join(DATA_ROOT, code, "fiche.xml")).then(() => true).catch(() => false),
      fs.access(path.join(DATA_ROOT, code, "cdc.md")).then(() => true).catch(() => false)
    ]);

    if (!status) {
      warnings.push({
        code,
        reason: "status.json missing or unreadable; metadata status inferred"
      });
    }

    if (!sourcePdf) {
      warnings.push({
        code,
        reason: "cdc.pdf missing from disk bundle"
      });
    }

    const current = await getAppelOffresRecordByCode(code, { includeArchived: true });

    if (!current) {
      await createAppelOffres({
        code,
        title: code,
        reference: "",
        buyer: "",
        country: "",
        dueDate: null,
        notes: "",
        priorite: "normale",
        responsableCommercial: "",
        status: mapFicheStatusToAppelOffresStatus(status),
        source: inferSource(ficheXml || ficheMarkdown)
      });
      created += 1;
    }

    await syncStoredDocumentsMetadata(code);
    documentsSynced += 1;
    console.log(`[reconcile] Synced ${code}.`);
  }

  console.log(
    JSON.stringify(
      {
        scanned: directories.length,
        created,
        documentsSynced,
        warnings
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAppelsOffresPool();
  });
