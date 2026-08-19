import type { UserRole } from "../auth/rbac.ts";
import type { FciModuleCode } from "../appels-offres/fci/types.ts";

export const BUSINESS_NOTIFICATION_EVENT_TYPES = [
  "FICHE_CDC_READY",
  "FCI_ASSIGNED",
  "FCI_REASSIGNED",
  "FCI_STARTED",
  "FCI_COMPLETED",
  "FCI_VALIDATED",
  "FCI_RETURNED",
  "FCI_BLOCKED",
  "READY_FOR_GONOGO",
  "GONOGO_REPORT_GENERATED",
  "GONOGO_REPORT_READY_FOR_REVIEW",
  "GONOGO_REPORT_PREPARED",
  "GONOGO_REPORT_SUBMITTED",
  "GONOGO_REPORT_REOPENED",
  "GONOGO_REPORT_STALE",
  "GONOGO_REPORT_EXPORTED",
  "GONOGO_PREPARED",
  "SUBMITTED_TO_DG",
  "DG_DECISION_MADE",
  "COMMERCIAL_OWNER_ASSIGNED",
  "COMMERCIAL_OWNER_TRANSFERRED",
  "COMMERCIAL_OWNER_RECOVERY_REQUIRED",
  "COMMERCIAL_OWNER_TARGET_INACTIVE",
  "REMINDER_SENT"
] as const;

export type BusinessNotificationEventType =
  (typeof BUSINESS_NOTIFICATION_EVENT_TYPES)[number];

export type AppNotificationRecord = {
  id: number;
  recipientUserId: number;
  recipientRole: UserRole | null;
  appelOffreCode: string;
  moduleCode: FciModuleCode | null;
  eventType: BusinessNotificationEventType;
  title: string;
  message: string;
  actionUrl: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  actorUserId: number | null;
  metadata: Record<string, unknown> | null;
  dedupeKey: string | null;
};

export type CreateAppNotificationInput = {
  recipientUserId: number;
  recipientRole?: UserRole | null;
  appelOffreCode: string;
  moduleCode?: FciModuleCode | null;
  eventType: BusinessNotificationEventType;
  title: string;
  message: string;
  actionUrl: string;
  actorUserId?: number | null;
  metadata?: Record<string, unknown> | null;
  dedupeKey?: string | null;
};
