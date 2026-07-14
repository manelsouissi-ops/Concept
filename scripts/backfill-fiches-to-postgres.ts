import nextEnv from "@next/env";
import { promises as fs } from "fs";
import path from "path";
import {
  closeFicheIndexPool,
  ensureFicheIndexSchema,
  upsertFicheIndex
} from "../lib/db.ts";
import { DATA_ROOT, readFicheIndexSource } from "../lib/storage.ts";

async function main() {
  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(process.cwd());
  await ensureFicheIndexSchema();

  const entries = await fs.readdir(DATA_ROOT, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  let processed = 0;

  for (const codeInterne of directories) {
    const ficheFilePath = path.join(DATA_ROOT, codeInterne, "fiche.xml");
    const statusFilePath = path.join(DATA_ROOT, codeInterne, "status.json");

    try {
      await fs.access(ficheFilePath);
      await fs.access(statusFilePath);
    } catch {
      console.warn(`[backfill] Skipping ${codeInterne}: missing fiche.xml or status.json.`);
      continue;
    }

    const indexed = await readFicheIndexSource(codeInterne);
    await upsertFicheIndex(codeInterne, indexed.xml, indexed.fiche, indexed.status);
    processed += 1;
    console.log(`[backfill] Indexed ${codeInterne}.`);
  }

  console.log(JSON.stringify({ processed }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeFicheIndexPool();
  });
