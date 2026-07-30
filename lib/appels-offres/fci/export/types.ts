import type { FciAiSupportedModuleCode } from "../ai-contracts.ts";
import type { FciFormPayload } from "../rendering.ts";
import type { FciModulePresentation } from "../presentation.ts";

export type FciExportFormat = "docx" | "pdf";

export type FciExportState = "draft" | "completed";

export type FciExportTemplateCode = "DC" | "DF" | "DO" | "DG";

export type FciExportSource = {
  moduleCode: FciAiSupportedModuleCode;
  templateCode: FciExportTemplateCode;
  module: FciModulePresentation["module"];
  appelOffres: FciModulePresentation["appel_offres"];
  payload: FciFormPayload;
  state: FciExportState;
};

export type FciDocxSingleValueRow = {
  label: string;
  value: string;
};

export type FciDocxRepeatableTable = {
  key: string;
  header: string[];
  rows: string[][];
  emptyPlaceholder: string;
};

export type FciDocxExportInstruction = {
  templatePath: string;
  outputPath: string;
  draftIndicator: string | null;
  headerSuffix: string | null;
  singleValueRows: FciDocxSingleValueRow[];
  repeatableTables: FciDocxRepeatableTable[];
};

export type FciGeneratedArtifact = {
  buffer: Buffer;
  contentType: string;
  fileName: string;
  converter: "docx-template" | "libreoffice" | "word";
};
