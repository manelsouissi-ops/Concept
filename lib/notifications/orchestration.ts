import type { FciModuleCode } from "../appels-offres/fci/types.ts";
import type { CurrentUser, UserRole } from "../auth/rbac.ts";
import { listUsers } from "../users/repository.ts";
import {
  getCommercialOwnership
} from "../appels-offres/ownership.ts";
import { appendAuditLog } from "../appels-offres/repository.ts";
import {
  createNotification,
  notificationExists,
  notifyRoleUsers
} from "./service.ts";

function parseActorUserId(currentUser?: CurrentUser | null) {
  if (!currentUser) {
    return null;
  }

  const parsed = Number(currentUser.id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isActiveCommercialNotificationOwner(owner: {
  userId: number | null;
  status: string | null;
  role: string | null;
}) {
  return owner.userId != null && owner.status === "ACTIVE" && owner.role === "COMMERCIAL";
}

export async function notifyAssignedUser(input: {
  appelOffreCode: string;
  moduleCode: FciModuleCode;
  eventType: "FCI_ASSIGNED" | "FCI_REASSIGNED" | "REMINDER_SENT";
  recipientUserId: number;
  recipientRole: UserRole;
  currentUser?: CurrentUser | null;
  metadata?: Record<string, unknown> | null;
  dedupeKey?: string | null;
}) {
  return createNotification({
    recipientUserId: input.recipientUserId,
    recipientRole: input.recipientRole,
    appelOffreCode: input.appelOffreCode,
    moduleCode: input.moduleCode,
    eventType: input.eventType,
    actorUserId: parseActorUserId(input.currentUser),
    metadata: {
      actorName: input.currentUser?.name ?? null,
      ...(input.metadata ?? {})
    },
    dedupeKey: input.dedupeKey,
    section: "overview"
  });
}

export async function notifyCommercialUsers(input: {
  appelOffreCode: string;
  eventType:
    | "FICHE_CDC_READY"
    | "FCI_STARTED"
    | "FCI_COMPLETED"
    | "FCI_VALIDATED"
    | "READY_FOR_GONOGO"
    | "GONOGO_REPORT_GENERATED"
    | "GONOGO_REPORT_READY_FOR_REVIEW"
    | "GONOGO_REPORT_PREPARED"
    | "GONOGO_REPORT_REOPENED"
    | "GONOGO_REPORT_STALE"
    | "GONOGO_REPORT_EXPORTED"
    | "GONOGO_PREPARED"
    | "DG_DECISION_MADE"
    | "COMMERCIAL_OWNER_ASSIGNED"
    | "COMMERCIAL_OWNER_TRANSFERRED"
    | "COMMERCIAL_OWNER_RECOVERY_REQUIRED"
    | "COMMERCIAL_OWNER_TARGET_INACTIVE";
  moduleCode?: FciModuleCode | null;
  currentUser?: CurrentUser | null;
  metadata?: Record<string, unknown> | null;
  dedupeKey?: string | null;
  section?: string | null;
  actionUrl?: string;
  onCreated?: (notification: Awaited<ReturnType<typeof createNotification>>) => Promise<void>;
}) {
  const ownership = await getCommercialOwnership(input.appelOffreCode);
  if (!isActiveCommercialNotificationOwner(ownership.owner)) {
    await appendAuditLog(
      input.appelOffreCode,
      "notification.commercial_owner_missing",
      {
        eventType: input.eventType,
        currentOwnerUserId: ownership.owner.userId,
        currentOwnerStatus: ownership.owner.status
      },
      input.currentUser?.name ?? null
    );
    return [];
  }

  const ownerUserId = ownership.owner.userId!;

  const dedupeKey = input.dedupeKey
    ? `${input.dedupeKey}:${ownerUserId}`
    : `commercial-owner:${input.eventType}:${input.appelOffreCode}:${ownerUserId}`;

  const existing = await notificationExists(dedupeKey);
  if (existing) {
    return [existing];
  }

  const notification = await createNotification({
      recipientUserId: ownerUserId,
      recipientRole: "COMMERCIAL",
      appelOffreCode: input.appelOffreCode,
      moduleCode: input.moduleCode ?? null,
      eventType: input.eventType,
      actorUserId: parseActorUserId(input.currentUser),
      metadata: {
        actorName: input.currentUser?.name ?? null,
        ...(input.metadata ?? {})
      },
      section: input.section ?? "overview",
      actionUrl: input.actionUrl,
      dedupeKey
    });
  await input.onCreated?.(notification);
  return [notification];
}

export function buildFicheCdcReadyDedupeKey(
  appelOffreCode: string,
  processingJobId: string
) {
  return `fiche-cdc-ready:${appelOffreCode}:${processingJobId}`;
}

export function buildFicheCdcReadyActionUrl(appelOffreCode: string) {
  return `/appels-offres/${encodeURIComponent(appelOffreCode)}/fiche-cdc`;
}

export async function notifyFicheCdcReady(input: {
  appelOffreCode: string;
  processingJobId: string;
}) {
  const notifications = await notifyCommercialUsers({
    appelOffreCode: input.appelOffreCode,
    eventType: "FICHE_CDC_READY",
    dedupeKey: buildFicheCdcReadyDedupeKey(
      input.appelOffreCode,
      input.processingJobId
    ),
    metadata: {
      appelOffreCode: input.appelOffreCode,
      processingJobId: input.processingJobId,
      eventType: "FICHE_CDC_READY"
    },
    actionUrl: buildFicheCdcReadyActionUrl(input.appelOffreCode),
    onCreated: async (notification) => {
      await appendAuditLog(input.appelOffreCode, "notification.created", {
        appelOffreCode: input.appelOffreCode,
        processingJobId: input.processingJobId,
        eventType: "FICHE_CDC_READY",
        recipientUserId: notification.recipientUserId,
        notificationId: notification.id
      }).catch(() => undefined);
    }
  });

  return notifications[0] ?? null;
}

export async function notifyDirectionGeneraleUsers(input: {
  appelOffreCode: string;
  eventType?: "SUBMITTED_TO_DG" | "GONOGO_REPORT_SUBMITTED";
  currentUser?: CurrentUser | null;
}) {
  return notifyRoleUsers({
    role: "DIRECTION_GENERALE",
    appelOffreCode: input.appelOffreCode,
    eventType: input.eventType ?? "SUBMITTED_TO_DG",
    actorUserId: parseActorUserId(input.currentUser),
    metadata: {
      actorName: input.currentUser?.name ?? null
    },
    section: "go-no-go",
    dedupeKeyPrefix: `submitted-to-dg:${input.appelOffreCode}`
  });
}

export async function notifyReadyForGoNoGoOnce(input: {
  appelOffreCode: string;
  currentUser?: CurrentUser | null;
}) {
  return notifyCommercialUsers({
    appelOffreCode: input.appelOffreCode,
    eventType: "READY_FOR_GONOGO",
    currentUser: input.currentUser,
    dedupeKey: `ready-for-gonogo:${input.appelOffreCode}`,
    section: "go-no-go"
  });
}
