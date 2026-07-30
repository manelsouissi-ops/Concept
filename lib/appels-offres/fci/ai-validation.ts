import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type {
  FciAiModulePayload,
  FciAiPayloadByCode,
  FciAiSupportedModuleCode,
  FciAiValidationError,
  FciAiValidationResult
} from "./ai-contracts.ts";

type JsonSchema = Record<string, unknown>;

const SCHEMA_ROOT = path.join(process.cwd(), "ai", "schemas");

const SCHEMA_FILE_BY_CODE = {
  A: "fci-commercial.schema.json",
  B: "fci-finance.schema.json",
  C: "fci-operations.schema.json",
  D: "fci-strategy.schema.json"
} as const satisfies Record<FciAiSupportedModuleCode, string>;

const COMMON_SCHEMA_PATH = path.join(SCHEMA_ROOT, "fci-common.schema.json");

function loadSchema(filePath: string) {
  return JSON.parse(readFileSync(filePath, "utf8")) as JsonSchema;
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  allowUnionTypes: true
});

ajv.addFormat("date-time", true);

const commonSchema = loadSchema(COMMON_SCHEMA_PATH);
ajv.addSchema(commonSchema);

const validators = Object.fromEntries(
  (Object.entries(SCHEMA_FILE_BY_CODE) as Array<
    [FciAiSupportedModuleCode, string]
  >).map(([moduleCode, fileName]) => {
    const schema = loadSchema(path.join(SCHEMA_ROOT, fileName));
    ajv.addSchema(schema);
    return [moduleCode, ajv.getSchema(String(schema.$id)) ?? ajv.compile(schema)];
  })
) as Record<FciAiSupportedModuleCode, ValidateFunction>;

function formatInstancePath(error: ErrorObject) {
  const missingProperty =
    error.keyword === "required" &&
    typeof error.params === "object" &&
    error.params &&
    "missingProperty" in error.params
      ? String(error.params.missingProperty)
      : null;

  if (!missingProperty) {
    return error.instancePath || "/";
  }

  return `${error.instancePath || ""}/${missingProperty}` || `/${missingProperty}`;
}

function formatErrors(errors: ErrorObject[] | null | undefined) {
  return (errors ?? []).map(
    (error): FciAiValidationError => ({
      path: formatInstancePath(error),
      keyword: error.keyword,
      message: error.message ?? "Erreur de validation inconnue."
    })
  );
}

function isSupportedModuleCode(value: string): value is FciAiSupportedModuleCode {
  return value === "A" || value === "B" || value === "C" || value === "D";
}

export function validateFciAiPayload(
  moduleCode: "A",
  payload: unknown
): FciAiValidationResult<FciAiPayloadByCode["A"]>;
export function validateFciAiPayload(
  moduleCode: "B",
  payload: unknown
): FciAiValidationResult<FciAiPayloadByCode["B"]>;
export function validateFciAiPayload(
  moduleCode: "C",
  payload: unknown
): FciAiValidationResult<FciAiPayloadByCode["C"]>;
export function validateFciAiPayload(
  moduleCode: "D",
  payload: unknown
): FciAiValidationResult<FciAiPayloadByCode["D"]>;
export function validateFciAiPayload(
  moduleCode: string,
  payload: unknown
): FciAiValidationResult<FciAiModulePayload>;
export function validateFciAiPayload(
  moduleCode: string,
  payload: unknown
): FciAiValidationResult<FciAiModulePayload> {
  if (!isSupportedModuleCode(moduleCode)) {
    return {
      ok: false,
      errors: [
        {
          path: "/module_code",
          keyword: "unsupported",
          message: `Le module FCI "${moduleCode}" n'est pas pris en charge par les contrats IA Phase 2.5.`
        }
      ]
    };
  }

  const validator = validators[moduleCode];
  const isValid = validator(payload);

  if (!isValid) {
    return {
      ok: false,
      errors: formatErrors(validator.errors)
    };
  }

  return {
    ok: true,
    data: payload as FciAiPayloadByCode[typeof moduleCode]
  };
}
