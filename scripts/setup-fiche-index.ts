import nextEnv from "@next/env";
import {
  closeAppelsOffresPool,
  ensureAppelsOffresSchema
} from "../lib/appels-offres/repository.ts";
import { closeFicheIndexPool, ensureFicheIndexSchema } from "../lib/db.ts";

async function main() {
  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(process.cwd());
  await ensureFicheIndexSchema();
  await ensureAppelsOffresSchema();
  console.log("Fiche and Appels d'offres schemas are ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAppelsOffresPool();
    await closeFicheIndexPool();
  });
