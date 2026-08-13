import type { DepartmentCode, UserStatus } from "../../users/types.ts";
import type { UserRole } from "../../auth/rbac.ts";

export const TENDER_WORKFLOW_EXPLICIT_STATES = [
  "FCI_GENERATED",
  "FCI_ASSIGNED",
  "GONOGO_PREPARED",
  "SUBMITTED_TO_DG",
  "UNDER_DG_REVIEW",
  "GO_DECIDED",
  "NO_GO_DECIDED",
  "ARCHIVED"
] as const;

export type TenderWorkflowExplicitState =
  (typeof TENDER_WORKFLOW_EXPLICIT_STATES)[number];

export const TENDER_WORKFLOW_DERIVED_STATES = [
  "FCI_IN_PROGRESS",
  "READY_FOR_GONOGO"
] as const;

export type TenderWorkflowDerivedState =
  (typeof TENDER_WORKFLOW_DERIVED_STATES)[number];

export const FCI_ASSIGNABLE_MODULE_CODES = ["B", "C", "D"] as const;

export type FciAssignableModuleCode =
  (typeof FCI_ASSIGNABLE_MODULE_CODES)[number];

export const FCI_ASSIGNMENT_STATUSES = [
  "assigned",
  "in_progress",
  "completed",
  "validated"
] as const;

export type FciAssignmentStatus =
  (typeof FCI_ASSIGNMENT_STATUSES)[number];

export type TenderWorkflowStateRecord = {
  id: number;
  appelOffresId: number;
  currentState: TenderWorkflowExplicitState;
  lastTransitionAt: string;
  createdAt: string;
  updatedAt: string;
};

export type TenderWorkflowEventRecord = {
  id: number;
  appelOffresId: number;
  eventType: string;
  fromState: TenderWorkflowExplicitState | null;
  toState: TenderWorkflowExplicitState;
  actorUserId: number | null;
  actorName: string | null;
  payloadJson: Record<string, unknown> | null;
  createdAt: string;
};

export type FciModuleAssignmentRecord = {
  id: number;
  appelOffresId: number;
  moduleCode: FciAssignableModuleCode;
  assignedUserId: number;
  assignedRole: UserRole;
  assignedDepartmentCode: DepartmentCode | null;
  assignedUserStatus: UserStatus | null;
  assignedByUserId: number;
  assignedAt: string;
  reassignedAt: string | null;
  assignmentStatus: FciAssignmentStatus;
  createdAt: string;
  updatedAt: string;
};

export type FciModuleAssignmentDetail = FciModuleAssignmentRecord & {
  appelOffresCode: string;
  assignedUserName: string;
  assignedUserEmail: string;
  assignedByName: string;
};

export type UpsertFciModuleAssignmentInput = {
  assignedUserId: number;
  assignedRole: UserRole;
  assignedDepartmentCode: DepartmentCode | null;
  assignedByUserId: number;
  assignedAt?: string;
  reassignedAt?: string | null;
  assignmentStatus: FciAssignmentStatus;
};

export type UpdateFciModuleAssignmentInput = {
  assignedUserId?: number;
  assignedRole?: UserRole;
  assignedDepartmentCode?: DepartmentCode | null;
  assignedByUserId?: number;
  assignedAt?: string;
  reassignedAt?: string | null;
  assignmentStatus?: FciAssignmentStatus;
};

export type AppendTenderWorkflowEventInput = {
  appelOffresId: number;
  eventType: string;
  fromState: TenderWorkflowExplicitState | null;
  toState: TenderWorkflowExplicitState;
  actorUserId?: number | null;
  actorName?: string | null;
  payloadJson?: Record<string, unknown> | null;
};
