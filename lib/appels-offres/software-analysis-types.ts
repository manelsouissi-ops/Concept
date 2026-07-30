import type { SoftwareRecord } from "../administration/logiciels/types.ts";

export type SoftwareAnalysisScope = "logiciels";

export type SoftwareAnalysisReviewStatus = "draft" | "submitted" | "validated";

export type TenderSoftwareExplicitness = "explicit" | "implicit";

export type TenderSoftwareRowStatus =
  | "draft"
  | "reviewed"
  | "validated"
  | "rejected";

export type TenderSoftwareMatchType =
  | "exact"
  | "alias"
  | "manual"
  | "possible"
  | "none";

export type TenderSoftwareCoverageStatus =
  | "covered"
  | "partially_covered"
  | "not_covered"
  | "to_confirm";

export type AnalysisConfirmationStatus = "open" | "resolved" | "not_applicable";

export type SoftwareAnalysisReviewRecord = {
  id: number;
  appelOffresId: number;
  scope: SoftwareAnalysisScope;
  status: SoftwareAnalysisReviewStatus;
  submittedAt: string | null;
  validatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TenderSoftwareRequirementRecord = {
  id: number;
  appelOffresId: number;
  requirementText: string;
  explicitness: TenderSoftwareExplicitness;
  softwareNamesRaw: string;
  necessityLevel: string;
  justification: string;
  riskIfMissing: string;
  alternativePossible: string;
  sourceExcerpt: string;
  status: TenderSoftwareRowStatus;
  createdAt: string;
  updatedAt: string;
};

export type TenderSoftwareMatchRecord = {
  id: number;
  appelOffresId: number;
  requirementId: number | null;
  logicielId: number | null;
  softwareNameRaw: string;
  matchType: TenderSoftwareMatchType;
  coverageStatus: TenderSoftwareCoverageStatus;
  necessityLevel: string;
  utilityText: string;
  recommendedDecision: string;
  comment: string;
  validatedByUser: boolean;
  status: TenderSoftwareRowStatus;
  createdAt: string;
  updatedAt: string;
  matchedSoftware: Pick<
    SoftwareRecord,
    "id" | "name" | "descriptionRaw" | "normalizedName" | "status" | "aliases"
  > | null;
};

export type TenderSoftwareGapRecord = {
  id: number;
  appelOffresId: number;
  requirementId: number | null;
  missingNeed: string;
  softwareTypeNeeded: string;
  whyNeeded: string;
  urgencyLevel: string;
  exampleSoftwareOrCategory: string;
  recommendedAction: string;
  status: TenderSoftwareRowStatus;
  createdAt: string;
  updatedAt: string;
};

export type AnalysisConfirmationRecord = {
  id: number;
  appelOffresId: number;
  scope: SoftwareAnalysisScope;
  topic: string;
  questionText: string;
  status: AnalysisConfirmationStatus;
  resolutionNote: string;
  createdAt: string;
  updatedAt: string;
};

export type AnalysisSourceRecord = {
  id: number;
  appelOffresId: number;
  scope: SoftwareAnalysisScope;
  sourceLabel: string;
  fileName: string;
  sheetName: string;
  sourceExcerpt: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
};

export type SoftwareAnalysisSummary = {
  requirementsCount: number;
  coveredCount: number;
  partiallyCoveredCount: number;
  notCoveredCount: number;
  toConfirmCount: number;
};

export type SoftwareAnalysisDetail = {
  review: SoftwareAnalysisReviewRecord;
  summary: SoftwareAnalysisSummary;
  requirements: TenderSoftwareRequirementRecord[];
  matches: TenderSoftwareMatchRecord[];
  gaps: TenderSoftwareGapRecord[];
  confirmations: AnalysisConfirmationRecord[];
  sources: AnalysisSourceRecord[];
};

export type RequirementMutationInput = {
  id?: number;
  requirementText: string;
  explicitness: TenderSoftwareExplicitness;
  softwareNamesRaw: string;
  necessityLevel: string;
  justification: string;
  riskIfMissing: string;
  alternativePossible: string;
  sourceExcerpt: string;
  status: TenderSoftwareRowStatus;
};

export type MatchMutationInput = {
  id?: number;
  requirementId: number | null;
  logicielId: number | null;
  softwareNameRaw: string;
  matchType: TenderSoftwareMatchType;
  coverageStatus: TenderSoftwareCoverageStatus;
  necessityLevel: string;
  utilityText: string;
  recommendedDecision: string;
  comment: string;
  validatedByUser: boolean;
  status: TenderSoftwareRowStatus;
};

export type GapMutationInput = {
  id?: number;
  requirementId: number | null;
  missingNeed: string;
  softwareTypeNeeded: string;
  whyNeeded: string;
  urgencyLevel: string;
  exampleSoftwareOrCategory: string;
  recommendedAction: string;
  status: TenderSoftwareRowStatus;
};

export type ConfirmationMutationInput = {
  id?: number;
  topic: string;
  questionText: string;
  status: AnalysisConfirmationStatus;
  resolutionNote: string;
};

export type SourceMutationInput = {
  id?: number;
  sourceLabel: string;
  fileName: string;
  sheetName: string;
  sourceExcerpt: string;
  comment: string;
};

export type SoftwareAnalysisTransitionAction = "submit" | "validate" | "reopen";

export type SoftwareAnalysisMatchCandidate = {
  software: Pick<
    SoftwareRecord,
    "id" | "name" | "descriptionRaw" | "normalizedName" | "status" | "aliases"
  > | null;
  matchType: TenderSoftwareMatchType;
  validatedByUser: boolean;
  explanation: string;
};

export type SoftwareAnalysisImportSource =
  | {
      kind: "local_example";
    }
  | {
      kind: "uploaded_file";
      fileName: string;
      buffer: Buffer;
    };

export type SoftwareAnalysisImportCandidateResult =
  | "new"
  | "update"
  | "unchanged"
  | "warning"
  | "skipped";

export type RequirementImportCandidate = {
  existingId: number | null;
  rowNumber: number;
  requirementText: string;
  explicitness: TenderSoftwareExplicitness;
  softwareNamesRaw: string;
  necessityLevel: string;
  justification: string;
  riskIfMissing: string;
  alternativePossible: string;
  result: SoftwareAnalysisImportCandidateResult;
  messages: string[];
};

export type MatchImportCandidate = {
  existingId: number | null;
  rowNumber: number;
  softwareNameRaw: string;
  utilityText: string;
  necessityLevel: string;
  coverageStatus: TenderSoftwareCoverageStatus;
  recommendedDecision: string;
  comment: string;
  proposedLogicielId: number | null;
  proposedLogicielName: string | null;
  proposedMatchType: TenderSoftwareMatchType;
  requiresConfirmation: boolean;
  result: SoftwareAnalysisImportCandidateResult;
  messages: string[];
};

export type GapImportCandidate = {
  existingId: number | null;
  rowNumber: number;
  missingNeed: string;
  softwareTypeNeeded: string;
  whyNeeded: string;
  urgencyLevel: string;
  exampleSoftwareOrCategory: string;
  result: SoftwareAnalysisImportCandidateResult;
  messages: string[];
};

export type ConfirmationImportCandidate = {
  existingId: number | null;
  rowNumber: number;
  topic: string;
  questionText: string;
  result: SoftwareAnalysisImportCandidateResult;
  messages: string[];
};

export type SourceImportCandidate = {
  existingId: number | null;
  rowNumber: number;
  sourceLabel: string;
  fileName: string;
  comment: string;
  sheetName: string;
  result: SoftwareAnalysisImportCandidateResult;
  messages: string[];
};

export type SoftwareAnalysisImportSectionSummary = {
  detected: number;
  create: number;
  update: number;
  unchanged: number;
  skipped: number;
  warnings: number;
};

export type SoftwareAnalysisImportPreview = {
  sourceFileName: string;
  warnings: string[];
  sections: {
    requirements: SoftwareAnalysisImportSectionSummary;
    matches: SoftwareAnalysisImportSectionSummary;
    gaps: SoftwareAnalysisImportSectionSummary;
    confirmations: SoftwareAnalysisImportSectionSummary;
    sources: SoftwareAnalysisImportSectionSummary;
  };
  requirements: RequirementImportCandidate[];
  matches: MatchImportCandidate[];
  gaps: GapImportCandidate[];
  confirmations: ConfirmationImportCandidate[];
  sources: SourceImportCandidate[];
};

export type SoftwareAnalysisImportSummary = {
  sourceFileName: string;
  warnings: string[];
  createdRecords: number;
  updatedRecords: number;
  unchangedRecords: number;
  skippedRecords: number;
  sectionSummaries: SoftwareAnalysisImportPreview["sections"];
};
