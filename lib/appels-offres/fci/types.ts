export const FCI_MODULE_CODES = ["A", "B", "C", "D", "E"] as const;

export type FciModuleCode = (typeof FCI_MODULE_CODES)[number];

export const FCI_CONTRIBUTING_MODULE_CODES = ["A", "B", "C", "D"] as const;

export type FciContributingModuleCode =
  (typeof FCI_CONTRIBUTING_MODULE_CODES)[number];

export const FCI_HUMAN_VISIBLE_MODULE_CODES = ["A", "B", "C", "D"] as const;

export type FciHumanVisibleModuleCode =
  (typeof FCI_HUMAN_VISIBLE_MODULE_CODES)[number];

export const FCI_GENERATABLE_MODULE_CODES = ["A", "B", "C", "D"] as const;

export type FciGeneratableModuleCode =
  (typeof FCI_GENERATABLE_MODULE_CODES)[number];

export const FCI_MODULE_TYPES = [
  "commercial",
  "finance",
  "operations",
  "strategy",
  "experience"
] as const;

export type FciModuleType = (typeof FCI_MODULE_TYPES)[number];

export const FCI_SET_OVERALL_STATUSES = [
  "not_started",
  "in_progress",
  "needs_review",
  "validated",
  "failed"
] as const;

export type FciSetOverallStatus = (typeof FCI_SET_OVERALL_STATUSES)[number];

export const FCI_MODULE_STATUSES = [
  "not_started",
  "generating",
  "generated",
  "needs_review",
  "validated",
  "failed",
  "unavailable"
] as const;

export type FciModuleStatus = (typeof FCI_MODULE_STATUSES)[number];

export const FCI_GENERATION_TRIGGER_TYPES = [
  "manual",
  "automatic",
  "regeneration"
] as const;

export type FciGenerationTriggerType =
  (typeof FCI_GENERATION_TRIGGER_TYPES)[number];

export const FCI_GENERATION_JOB_STATUSES = [
  "pending_integration",
  "created",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
] as const;

export type FciGenerationJobStatus =
  (typeof FCI_GENERATION_JOB_STATUSES)[number];

export type FciJsonObject = Record<string, unknown>;

export type FciSetRecord = {
  id: number;
  appelOffresId: number;
  sourceFicheVersion: string;
  sourceFicheHash: string;
  sourceFicheUpdatedAt: string;
  overallStatus: FciSetOverallStatus;
  createdAt: string;
  updatedAt: string;
};

export type FciModuleRecord = {
  id: number;
  fciSetId: number;
  moduleCode: FciModuleCode;
  moduleType: FciModuleType;
  status: FciModuleStatus;
  aiGeneratedAt: string | null;
  validatedAt: string | null;
  validatedBy: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FciModuleDataRecord = {
  id: number;
  fciModuleId: number;
  dataJson: FciJsonObject;
  sourceSummaryJson: FciJsonObject | null;
  confidenceJson: FciJsonObject | null;
  aiNotesJson: FciJsonObject | null;
  version: number;
  generatedFromFicheVersion: string | null;
  generatedFromFicheHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FciGenerationJobRecord = {
  id: number;
  fciModuleId: number;
  triggerType: FciGenerationTriggerType;
  provider: string;
  model: string;
  status: FciGenerationJobStatus;
  contractVersion: string | null;
  schemaVersion: string | null;
  promptVersion: string | null;
  generationParameters: FciJsonObject | null;
  sourceFicheVersion: string | null;
  sourceFicheHash: string | null;
  executionId: string | null;
  correlationId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  callbackReceivedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type FciAuditEventRecord = {
  id: number;
  appelOffresId: number;
  fciModuleId: number | null;
  eventType: string;
  actor: string | null;
  payloadJson: FciJsonObject | null;
  createdAt: string;
};

export type FciDetail = {
  set: FciSetRecord;
  modules: FciModuleRecord[];
  moduleData: FciModuleDataRecord[];
  generationJobs: FciGenerationJobRecord[];
  auditEvents: FciAuditEventRecord[];
};

export type InitializeFciSetInput = {
  sourceFicheVersion: string;
  sourceFicheHash: string;
  sourceFicheUpdatedAt: string;
  overallStatus?: FciSetOverallStatus;
  knowledgeBaseEnabled?: boolean;
};

export type UpsertFciModuleDataInput = {
  dataJson: FciJsonObject;
  sourceSummaryJson?: FciJsonObject | null;
  confidenceJson?: FciJsonObject | null;
  aiNotesJson?: FciJsonObject | null;
  version: number;
  generatedFromFicheVersion?: string | null;
  generatedFromFicheHash?: string | null;
};

export type CreateFciGenerationJobInput = {
  triggerType: FciGenerationTriggerType;
  provider: string;
  model: string;
  status?: FciGenerationJobStatus;
  contractVersion?: string | null;
  schemaVersion?: string | null;
  promptVersion?: string | null;
  generationParameters?: FciJsonObject | null;
  sourceFicheVersion?: string | null;
  sourceFicheHash?: string | null;
  executionId?: string | null;
  correlationId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  callbackReceivedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type UpdateFciGenerationJobInput = {
  provider?: string;
  model?: string;
  status?: FciGenerationJobStatus;
  contractVersion?: string | null;
  schemaVersion?: string | null;
  promptVersion?: string | null;
  generationParameters?: FciJsonObject | null;
  sourceFicheVersion?: string | null;
  sourceFicheHash?: string | null;
  executionId?: string | null;
  correlationId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  callbackReceivedAt?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type AppendFciAuditEventInput = {
  appelOffresId: number;
  fciModuleId?: number | null;
  eventType: string;
  actor?: string | null;
  payloadJson?: FciJsonObject | null;
};
