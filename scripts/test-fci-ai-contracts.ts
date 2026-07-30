import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { validateFciAiPayload } from "../lib/appels-offres/fci/ai-validation.ts";

function readJson(relativePath: string) {
  const filePath = path.join(process.cwd(), relativePath);
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function expectValid(moduleCode: "A" | "B" | "C" | "D", payload: unknown) {
  const result = validateFciAiPayload(moduleCode, payload);
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
}

function expectInvalid(
  moduleCode: string,
  payload: unknown,
  matcher: (messages: string[]) => boolean
) {
  const result = validateFciAiPayload(moduleCode, payload);
  assert.equal(result.ok, false, `Expected invalid payload for module ${moduleCode}.`);
  const messages = result.ok
    ? []
    : result.errors.map((error) => `${error.path} ${error.keyword} ${error.message}`);
  assert.equal(
    matcher(messages),
    true,
    `Unexpected validation errors for module ${moduleCode}:\n${messages.join("\n")}`
  );
}

function run() {
  const sampleCommercial = readJson("ai/examples/fci-commercial.sample.json");
  const sampleFinance = readJson("ai/examples/fci-finance.sample.json");
  const sampleOperations = readJson("ai/examples/fci-operations.sample.json");
  const sampleStrategy = readJson("ai/examples/fci-strategy.sample.json");

  expectValid("A", sampleCommercial);
  expectValid("B", sampleFinance);
  expectValid("C", sampleOperations);
  expectValid("D", sampleStrategy);

  const unknownTopLevel = deepClone(sampleCommercial);
  unknownTopLevel.unknown_property = true;
  expectInvalid("A", unknownTopLevel, (messages) =>
    messages.some((message) => message.includes("additionalProperties"))
  );

  const invalidSourceType = deepClone(sampleCommercial);
  (
    invalidSourceType.data as Record<string, Record<string, Record<string, unknown>>>
  ).identification_opportunite.reference_interne_code_dossier.source_type = "market_magic";
  expectInvalid("A", invalidSourceType, (messages) =>
    messages.some((message) => message.includes("/source_type"))
  );

  const invalidConfidence = deepClone(sampleCommercial);
  (
    invalidConfidence.data as Record<string, Record<string, Record<string, unknown>>>
  ).positionnement_offre.niveau_de_prix_cible_estime.confidence = "certain";
  expectInvalid("A", invalidConfidence, (messages) =>
    messages.some((message) => message.includes("/confidence"))
  );

  expectInvalid("B", sampleCommercial, (messages) =>
    messages.some((message) => message.includes("/module_code"))
  );

  const invalidInternalRequiredFlag = deepClone(sampleFinance);
  (
    invalidInternalRequiredFlag.data as Record<string, unknown>
  ).elements_financiers_internes = {
    ...(invalidInternalRequiredFlag.data as Record<string, Record<string, unknown>>)
      .elements_financiers_internes,
    marge_cible_visee: {
      ...(
        (invalidInternalRequiredFlag.data as Record<
          string,
          Record<string, Record<string, unknown>>
        >).elements_financiers_internes.marge_cible_visee
      ),
      requires_human_input: false
    }
  };
  expectInvalid("B", invalidInternalRequiredFlag, (messages) =>
    messages.some((message) => message.includes("requires_human_input"))
  );

  const invalidInternalRequiredValue = deepClone(sampleFinance);
  (
    invalidInternalRequiredValue.data as Record<string, unknown>
  ).elements_financiers_internes = {
    ...(invalidInternalRequiredValue.data as Record<string, Record<string, unknown>>)
      .elements_financiers_internes,
    marge_cible_visee: {
      ...(
        (invalidInternalRequiredValue.data as Record<
          string,
          Record<string, Record<string, unknown>>
        >).elements_financiers_internes.marge_cible_visee
      ),
      value: "12%"
    }
  };
  expectInvalid("B", invalidInternalRequiredValue, (messages) =>
    messages.some((message) => message.includes("/value"))
  );

  const invalidCompletion = deepClone(sampleOperations);
  (invalidCompletion.summary as Record<string, unknown>).completion_percentage = 120;
  expectInvalid("C", invalidCompletion, (messages) =>
    messages.some((message) => message.includes("completion_percentage"))
  );

  const invalidSourceReference = deepClone(sampleCommercial);
  (
    invalidSourceReference.data as Record<string, Record<string, Record<string, unknown>>>
  ).synthese_commerciale.attractivite_commerciale.source_references = [
    {
      section: "Procedure",
      field: "date_limite_depot",
      excerpt: 42
    }
  ];
  expectInvalid("A", invalidSourceReference, (messages) =>
    messages.some((message) => message.includes("/excerpt"))
  );

  const invalidCalculation = deepClone(sampleFinance);
  (
    invalidCalculation.data as Record<string, unknown>
  ).calculs_financiers = [
    {
      label: "Cash flow",
      inputs: [],
      result: {
        value: null,
        source_type: "ai_inference",
        confidence: "medium",
        requires_human_input: false,
        justification: "Test",
        source_references: []
      },
      justification: "Test",
      source_references: []
    }
  ];
  expectInvalid("B", invalidCalculation, (messages) =>
    messages.some((message) => message.includes("/formula"))
  );

  const invalidStrategyDecision = deepClone(sampleStrategy);
  (
    invalidStrategyDecision.data as Record<string, Record<string, Record<string, unknown>>>
  ).synthese_direction.statut_revue_preliminaire.value = "GO";
  expectInvalid("D", invalidStrategyDecision, (messages) =>
    messages.some((message) => message.includes("statut_revue_preliminaire"))
  );

  assert.throws(() => JSON.parse("{invalid json"), SyntaxError);

  expectInvalid("E", sampleStrategy, (messages) =>
    messages.some((message) => message.includes("n'est pas pris en charge"))
  );

  console.log("All FCI AI contract checks passed.");
}

try {
  run();
} catch (error) {
  console.error("FCI AI contract validation failed.");
  console.error(error);
  process.exitCode = 1;
}
