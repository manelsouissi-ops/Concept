import nextEnv from "@next/env";
import {
  backfillLegacyCommercialOwnership
} from "../lib/appels-offres/ownership.ts";
import {
  closeAppelsOffresPool
} from "../lib/appels-offres/repository.ts";
import { closeUsersPool } from "../lib/users/repository.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

async function main() {
  const dryRun = !process.argv.includes("--apply");
  const summary = await backfillLegacyCommercialOwnership({ dryRun });

  console.log(JSON.stringify({
    mode: dryRun ? "dry-run" : "apply",
    summary
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([
      closeAppelsOffresPool(),
      closeUsersPool()
    ]);
  });
