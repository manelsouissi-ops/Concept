import {
  FCI_CONTRIBUTING_MODULE_CODES,
  FCI_GENERATABLE_MODULE_CODES,
  FCI_HUMAN_VISIBLE_MODULE_CODES,
  FCI_GENERATION_JOB_STATUSES,
  FCI_GENERATION_TRIGGER_TYPES,
  type FciContributingModuleCode,
  FCI_MODULE_CODES,
  FCI_MODULE_STATUSES,
  FCI_MODULE_TYPES,
  FCI_SET_OVERALL_STATUSES,
  type FciHumanVisibleModuleCode,
  type FciGenerationJobStatus,
  type FciGenerationTriggerType,
  type FciGeneratableModuleCode,
  type FciModuleCode,
  type FciModuleStatus,
  type FciModuleType,
  type FciSetOverallStatus
} from "./types.ts";

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseStringEnum<T extends readonly string[]>(
  value: unknown,
  allowedValues: T,
  fieldName: string
) {
  const normalized = normalizeString(value);
  if (!allowedValues.includes(normalized)) {
    throw new Error(`Valeur invalide pour ${fieldName}: ${String(value)}`);
  }

  return normalized as T[number];
}

export function parseFciModuleCode(value: unknown): FciModuleCode {
  return parseStringEnum(value, FCI_MODULE_CODES, "module_code");
}

export function parseFciModuleType(value: unknown): FciModuleType {
  return parseStringEnum(value, FCI_MODULE_TYPES, "module_type");
}

export function parseFciModuleStatus(value: unknown): FciModuleStatus {
  return parseStringEnum(value, FCI_MODULE_STATUSES, "status");
}

export function parseFciSetOverallStatus(value: unknown): FciSetOverallStatus {
  return parseStringEnum(value, FCI_SET_OVERALL_STATUSES, "overall_status");
}

export function parseFciGenerationTriggerType(
  value: unknown
): FciGenerationTriggerType {
  return parseStringEnum(
    value,
    FCI_GENERATION_TRIGGER_TYPES,
    "trigger_type"
  );
}

export function parseFciGenerationJobStatus(
  value: unknown
): FciGenerationJobStatus {
  return parseStringEnum(value, FCI_GENERATION_JOB_STATUSES, "status");
}

export function parseFciGeneratableModuleCode(
  value: unknown
): FciGeneratableModuleCode {
  return parseStringEnum(
    value,
    FCI_GENERATABLE_MODULE_CODES,
    "generatable_module_code"
  );
}

export function getFciModuleTypeFromCode(
  moduleCode: FciModuleCode
): FciModuleType {
  switch (moduleCode) {
    case "A":
      return "commercial";
    case "B":
      return "finance";
    case "C":
      return "operations";
    case "D":
      return "strategy";
    case "E":
      return "experience";
  }
}

export function isKnowledgeBaseEnabled(value = process.env.KNOWLEDGE_BASE_ENABLED) {
  const normalized = normalizeString(value).toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export function getEnabledFciModuleCodes(input?: {
  knowledgeBaseEnabled?: boolean;
}) {
  const knowledgeBaseEnabled =
    input?.knowledgeBaseEnabled ?? isKnowledgeBaseEnabled();

  return FCI_MODULE_CODES.filter((code) =>
    code === "E" ? knowledgeBaseEnabled : true
  );
}

export function isFciContributingModuleCode(
  moduleCode: FciModuleCode
): moduleCode is FciContributingModuleCode {
  return FCI_CONTRIBUTING_MODULE_CODES.includes(
    moduleCode as FciContributingModuleCode
  );
}

export function isHumanVisibleFciModuleCode(
  moduleCode: FciModuleCode
): moduleCode is FciHumanVisibleModuleCode {
  return FCI_HUMAN_VISIBLE_MODULE_CODES.includes(
    moduleCode as FciHumanVisibleModuleCode
  );
}

export function isFciModuleGeneratable(moduleCode: FciModuleCode) {
  return FCI_GENERATABLE_MODULE_CODES.includes(
    moduleCode as FciGeneratableModuleCode
  );
}
