import path from "node:path";
import type { FciAiSupportedModuleCode } from "../ai-contracts.ts";
import type { FciExportTemplateCode } from "./types.ts";

const TEMPLATE_DIRECTORY = path.join(process.cwd(), "ai", "templates", "fci");

const TEMPLATE_DEFINITIONS: Record<
  FciAiSupportedModuleCode,
  { templateCode: FciExportTemplateCode; fileName: string }
> = {
  A: { templateCode: "DC", fileName: "FCI_DC.docx" },
  B: { templateCode: "DF", fileName: "FCI_DF.docx" },
  C: { templateCode: "DO", fileName: "FCI_DO.docx" },
  D: { templateCode: "DG", fileName: "FCI_DG.docx" }
};

export function getFciTemplateDirectory() {
  return TEMPLATE_DIRECTORY;
}

export function getFciTemplateDefinition(moduleCode: FciAiSupportedModuleCode) {
  return TEMPLATE_DEFINITIONS[moduleCode];
}

export function getFciTemplatePath(moduleCode: FciAiSupportedModuleCode) {
  const definition = getFciTemplateDefinition(moduleCode);
  return path.join(TEMPLATE_DIRECTORY, definition.fileName);
}
