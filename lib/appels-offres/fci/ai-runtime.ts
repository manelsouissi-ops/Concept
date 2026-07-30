import { readFileSync } from "node:fs";
import path from "node:path";
import type { FciAiSupportedModuleCode } from "./ai-contracts.ts";
import { getFciContractRegistry } from "./contract-registry.ts";
import { getFciModuleTypeFromCode } from "./validation.ts";

type JsonSchema = Record<string, unknown>;

const PROMPT_FILE_BY_CODE = {
  A: "fci-commercial.md",
  B: "fci-finance.md",
  C: "fci-operations.md",
  D: "fci-strategy.md"
} as const satisfies Record<FciAiSupportedModuleCode, string>;

const SCHEMA_FILE_BY_CODE = {
  A: "fci-commercial.schema.json",
  B: "fci-finance.schema.json",
  C: "fci-operations.schema.json",
  D: "fci-strategy.schema.json"
} as const satisfies Record<FciAiSupportedModuleCode, string>;

const PROMPT_ROOT = path.join(process.cwd(), "ai", "prompts");
const SCHEMA_ROOT = path.join(process.cwd(), "ai", "schemas");

function readTextFile(filePath: string) {
  return readFileSync(filePath, "utf8").trim();
}

function readJsonFile(filePath: string) {
  return JSON.parse(readFileSync(filePath, "utf8")) as JsonSchema;
}

const runtimeContractCache = new Map<
  FciAiSupportedModuleCode,
  {
    moduleCode: FciAiSupportedModuleCode;
    moduleType: ReturnType<typeof getFciModuleTypeFromCode>;
    promptText: string;
    schemaJson: JsonSchema;
    promptVersion: string;
    schemaVersion: string;
    contractVersion: string;
  }
>();

export function getFciAiRuntimeContract(moduleCode: FciAiSupportedModuleCode) {
  const cached = runtimeContractCache.get(moduleCode);
  if (cached) {
    return cached;
  }

  const registry = getFciContractRegistry();
  const promptPath = path.join(PROMPT_ROOT, PROMPT_FILE_BY_CODE[moduleCode]);
  const schemaPath = path.join(SCHEMA_ROOT, SCHEMA_FILE_BY_CODE[moduleCode]);

  const runtimeContract = {
    moduleCode,
    moduleType: getFciModuleTypeFromCode(moduleCode),
    promptText: readTextFile(promptPath),
    schemaJson: readJsonFile(schemaPath),
    promptVersion: registry.promptVersion,
    schemaVersion: registry.schemaVersion,
    contractVersion: registry.contractVersion
  };

  runtimeContractCache.set(moduleCode, runtimeContract);
  return runtimeContract;
}
