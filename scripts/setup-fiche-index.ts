import nextEnv from "@next/env";
import { closeFicheIndexPool, ensureFicheIndexSchema } from "../lib/db.ts";

async function main() {
  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(process.cwd());
  await ensureFicheIndexSchema();
  console.log("Fiche index schema is ready.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeFicheIndexPool();
  });
