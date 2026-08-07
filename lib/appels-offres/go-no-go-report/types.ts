import type { FciJsonObject } from "../fci/types.ts";

export const GO_NO_GO_REPORT_STATUSES = [
  "DRAFT",
  "READY_FOR_REVIEW",
  "PREPARED",
  "SUBMITTED_TO_DG",
  "SUPERSEDED",
  "ARCHIVED"
] as const;

export type GoNoGoReportStatus = (typeof GO_NO_GO_REPORT_STATUSES)[number];

export const GO_NO_GO_REPORT_AUDIT_EVENT_TYPES = [
  "REPORT_GENERATED",
  "REPORT_EDITED",
  "REPORT_PREPARED",
  "REPORT_SUBMITTED",
  "REPORT_REOPENED",
  "REPORT_SUPERSEDED",
  "REPORT_EXPORTED"
] as const;

export type GoNoGoReportAuditEventType =
  (typeof GO_NO_GO_REPORT_AUDIT_EVENT_TYPES)[number];

export type GoNoGoReportRecommendation = "go" | "no_go";

export type GoNoGoReportEditablePayload = {
  executive_summary: string;
  project_overview: string;
  commercial_summary: string;
  financial_summary: string;
  operational_summary: string;
  key_strengths: string;
  key_risks: string;
  reservations: string;
  assumptions: string;
  unresolved_points: string;
  commercial_recommendation: string;
  ai_recommendation: string | null;
  recommended_decision: GoNoGoReportRecommendation | null;
};

export type GoNoGoReportRecord = {
  id: number;
  appelOffresId: number;
  version: number;
  status: GoNoGoReportStatus;
  generatedFromFciSnapshotAt: string | null;
  generatedByUserId: number | null;
  commercialOwnerUserId: number | null;
  preparedByUserId: number | null;
  preparedAt: string | null;
  submittedByUserId: number | null;
  submittedAt: string | null;
  reopenedAt: string | null;
  supersedesReportId: number | null;
  executiveSummary: string | null;
  projectOverview: string | null;
  commercialSummary: string | null;
  financialSummary: string | null;
  operationalSummary: string | null;
  keyStrengths: string | null;
  keyRisks: string | null;
  reservations: string | null;
  assumptions: string | null;
  unresolvedPoints: string | null;
  commercialRecommendation: string | null;
  aiRecommendation: string | null;
  recommendedDecision: GoNoGoReportRecommendation | null;
  sourceSnapshotJson: FciJsonObject | null;
  editablePayloadJson: FciJsonObject | null;
  createdAt: string;
  updatedAt: string;
};

export type GoNoGoReportAuditEventRecord = {
  id: number;
  goNoGoReportId: number;
  appelOffresId: number;
  eventType: GoNoGoReportAuditEventType;
  actorUserId: number | null;
  actorName: string | null;
  payloadJson: FciJsonObject | null;
  createdAt: string;
};

export type InsertGoNoGoReportInput = {
  version: number;
  status: GoNoGoReportStatus;
  generatedFromFciSnapshotAt?: string | null;
  generatedByUserId?: number | null;
  commercialOwnerUserId?: number | null;
  preparedByUserId?: number | null;
  preparedAt?: string | null;
  submittedByUserId?: number | null;
  submittedAt?: string | null;
  reopenedAt?: string | null;
  supersedesReportId?: number | null;
  executiveSummary?: string | null;
  projectOverview?: string | null;
  commercialSummary?: string | null;
  financialSummary?: string | null;
  operationalSummary?: string | null;
  keyStrengths?: string | null;
  keyRisks?: string | null;
  reservations?: string | null;
  assumptions?: string | null;
  unresolvedPoints?: string | null;
  commercialRecommendation?: string | null;
  aiRecommendation?: string | null;
  recommendedDecision?: GoNoGoReportRecommendation | null;
  sourceSnapshotJson?: FciJsonObject | null;
  editablePayloadJson?: FciJsonObject | null;
};

export type UpdateGoNoGoReportInput = {
  status?: GoNoGoReportStatus;
  preparedByUserId?: number | null;
  preparedAt?: string | null;
  submittedByUserId?: number | null;
  submittedAt?: string | null;
  reopenedAt?: string | null;
  supersedesReportId?: number | null;
  executiveSummary?: string | null;
  projectOverview?: string | null;
  commercialSummary?: string | null;
  financialSummary?: string | null;
  operationalSummary?: string | null;
  keyStrengths?: string | null;
  keyRisks?: string | null;
  reservations?: string | null;
  assumptions?: string | null;
  unresolvedPoints?: string | null;
  commercialRecommendation?: string | null;
  aiRecommendation?: string | null;
  recommendedDecision?: GoNoGoReportRecommendation | null;
  sourceSnapshotJson?: FciJsonObject | null;
  editablePayloadJson?: FciJsonObject | null;
};

export type AppendGoNoGoReportAuditEventInput = {
  goNoGoReportId: number;
  appelOffresId: number;
  eventType: GoNoGoReportAuditEventType;
  actorUserId?: number | null;
  actorName?: string | null;
  payloadJson?: FciJsonObject | null;
};
