import { listUsers } from "../users/repository.ts";
import type { CurrentUser } from "../auth/rbac.ts";
import { buildNotificationCopy } from "./copy.ts";
import {
  getLatestNotificationByDedupeKey,
  insertAppNotification,
  listAppNotificationsForUser,
  listUnreadAppNotificationsForUser,
  markAllAppNotificationsRead,
  markAppNotificationRead
} from "./repository.ts";
import type {
  AppNotificationRecord,
  BusinessNotificationEventType,
  CreateAppNotificationInput
} from "./types.ts";

function parseCurrentUserId(currentUser?: CurrentUser | null) {
  if (!currentUser) {
    return null;
  }

  const parsed = Number(currentUser.id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildActionUrl(appelOffreCode: string, section?: string | null) {
  if (!section) {
    return `/appels-offres/${encodeURIComponent(appelOffreCode)}`;
  }

  return `/appels-offres/${encodeURIComponent(appelOffreCode)}?view=${encodeURIComponent(section)}`;
}

export async function createNotification(
  input: Omit<CreateAppNotificationInput, "title" | "message" | "actionUrl"> & {
    title?: string;
    message?: string;
    actionUrl?: string;
    section?: string | null;
  }
) {
  const copy = buildNotificationCopy({
    eventType: input.eventType,
    appelOffreCode: input.appelOffreCode,
    moduleCode: input.moduleCode,
    metadata: input.metadata
  });

  return insertAppNotification({
    recipientUserId: input.recipientUserId,
    recipientRole: input.recipientRole ?? null,
    appelOffreCode: input.appelOffreCode,
    moduleCode: input.moduleCode ?? null,
    eventType: input.eventType,
    title: input.title ?? copy.title,
    message: input.message ?? copy.message,
    actionUrl: input.actionUrl ?? buildActionUrl(input.appelOffreCode, input.section ?? null),
    actorUserId: input.actorUserId ?? null,
    metadata: input.metadata ?? null,
    dedupeKey: input.dedupeKey ?? null
  });
}

export async function listNotificationsForUser(currentUser: CurrentUser, limit = 8) {
  const userId = parseCurrentUserId(currentUser);
  if (userId == null) {
    return [] as AppNotificationRecord[];
  }

  return listAppNotificationsForUser(userId, limit);
}

export async function markNotificationRead(currentUser: CurrentUser, notificationId: number) {
  const userId = parseCurrentUserId(currentUser);
  if (userId == null) {
    return null;
  }

  return markAppNotificationRead(notificationId, userId);
}

export async function markAllNotificationsRead(currentUser: CurrentUser) {
  const userId = parseCurrentUserId(currentUser);
  if (userId == null) {
    return 0;
  }

  return markAllAppNotificationsRead(userId);
}

export async function getUnreadNotificationCount(currentUser: CurrentUser) {
  const userId = parseCurrentUserId(currentUser);
  if (userId == null) {
    return 0;
  }

  return listUnreadAppNotificationsForUser(userId);
}

export async function notifyRoleUsers(input: {
  role: CurrentUser["role"];
  appelOffreCode: string;
  eventType: BusinessNotificationEventType;
  actorUserId?: number | null;
  moduleCode?: CreateAppNotificationInput["moduleCode"];
  metadata?: Record<string, unknown> | null;
  section?: string | null;
  dedupeKeyPrefix?: string | null;
}) {
  const recipients = await listUsers({
    role: input.role,
    status: "ACTIVE"
  });

  return Promise.all(
    recipients.map((recipient) =>
      createNotification({
        recipientUserId: recipient.id,
        recipientRole: recipient.role,
        appelOffreCode: input.appelOffreCode,
        moduleCode: input.moduleCode ?? null,
        eventType: input.eventType,
        actorUserId: input.actorUserId ?? null,
        metadata: input.metadata ?? null,
        section: input.section ?? null,
        dedupeKey: input.dedupeKeyPrefix
          ? `${input.dedupeKeyPrefix}:${recipient.id}`
          : null
      })
    )
  );
}

export async function notificationExists(dedupeKey: string) {
  return getLatestNotificationByDedupeKey(dedupeKey);
}
