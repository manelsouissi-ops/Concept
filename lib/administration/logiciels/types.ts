export type SoftwareStatus = "active" | "archived";

export type SoftwareAliasSource = "manual" | "catalogue_import";

export type SoftwareRecord = {
  id: number;
  name: string;
  normalizedName: string;
  descriptionRaw: string;
  status: SoftwareStatus;
  createdAt: string;
  updatedAt: string;
  aliases: SoftwareAliasRecord[];
};

export type SoftwareAliasRecord = {
  id: number;
  softwareId: number;
  alias: string;
  normalizedAlias: string;
  source: SoftwareAliasSource;
  createdAt: string;
};

export type SoftwareListFilters = {
  search?: string;
  status?: SoftwareStatus | "all";
};

export type SoftwareMutationInput = {
  name: string;
  descriptionRaw: string;
  aliases: string[];
};

export type SoftwareImportSource =
  | {
      kind: "local_catalogue";
    }
  | {
      kind: "uploaded_file";
      fileName: string;
      buffer: Buffer;
    };

export type SoftwareImportCandidateResult =
  | "new"
  | "existing"
  | "warning"
  | "skipped";

export type SoftwareImportCandidate = {
  rowNumber: number;
  originalCellValue: string;
  sourceName: string | null;
  proposedName: string | null;
  normalizedName: string | null;
  rawUsage: string;
  result: SoftwareImportCandidateResult;
  messages: string[];
  splitFromMultiNameCell: boolean;
  existingSoftwareId: number | null;
  existingSoftwareName: string | null;
};

export type SoftwareImportPreview = {
  sourceFileName: string;
  worksheetName: string;
  totalRowsInspected: number;
  validSoftwareCandidates: number;
  newRecords: number;
  existingMatches: number;
  possibleDuplicates: number;
  rowsSkipped: number;
  splitCells: number;
  warnings: string[];
  candidates: SoftwareImportCandidate[];
};

export type SoftwareImportSummary = {
  sourceFileName: string;
  worksheetName: string;
  totalRowsInspected: number;
  validSoftwareCandidates: number;
  createdRecords: number;
  existingMatches: number;
  updatedDescriptions: number;
  addedAliases: number;
  skippedRows: number;
  duplicateCandidates: number;
  warnings: string[];
};
