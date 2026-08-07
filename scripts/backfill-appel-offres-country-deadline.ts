import nextEnv from "@next/env";
import { applyValidatedExtractionIdentity, closeAppelsOffresPool } from "../lib/appels-offres/repository.ts";
import { readFicheBundle } from "../lib/storage.ts";

// One-off/on-demand backfill: re-runs the same country/due_date propagation
// that applyValidatedExtractionIdentity now does on every fiche validation,
// for a dossier that was validated before that propagation existed.
async function main() {
  const code = process.argv[2]?.trim();
  if (!code) {
    console.error("Usage: node --experimental-strip-types scripts/backfill-appel-offres-country-deadline.ts <code>");
    process.exitCode = 1;
    return;
  }

  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(process.cwd());

  const fiche = await readFicheBundle(code);
  const extractedCountry = fiche.extraction.find((field) => field.key === "pays")?.value ?? null;
  const extractedDeadline =
    fiche.extraction.find((field) => field.key === "date_limite_depot")?.value ?? null;

  const updated = await applyValidatedExtractionIdentity(code, {
    title: null,
    buyer: null,
    country: extractedCountry,
    deadline: extractedDeadline
  });

  console.log(`[backfill] ${code}: country=${updated?.country ?? null} dueDate=${updated?.dueDate ?? null}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeAppelsOffresPool();
  });
