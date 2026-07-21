import test from "node:test";
import assert from "node:assert/strict";
import { toBusinessSafeAnalysisError } from "./user-errors.ts";

test("toBusinessSafeAnalysisError hides technical environment variable details", () => {
  assert.equal(
    toBusinessSafeAnalysisError("La variable d'environnement N8N_WEBHOOK_TOKEN est obligatoire."),
    "L'analyse n'a pas pu etre demarree. Le dossier peut etre conserve et relance depuis son espace de travail."
  );
});
