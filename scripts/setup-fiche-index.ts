import nextEnv from "@next/env";
import {
  closeAppelsOffresPool,
  ensureAppelsOffresSchema
} from "../lib/appels-offres/repository.ts";
import { closeFciPool, ensureFciSchema } from "../lib/appels-offres/fci/repository.ts";
import { closeFicheIndexPool, ensureFicheIndexSchema } from "../lib/db.ts";

async function main() {
  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(process.cwd());
  await ensureFicheIndexSchema();
  await ensureAppelsOffresSchema();
  await ensureFciSchema();
  console.log("Fiche, Appels d'offres and FCI schemas are ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeFciPool();
    await closeAppelsOffresPool();
    await closeFicheIndexPool();
  });
