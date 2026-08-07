import {
  appendAuditLog,
  appendCommercialOwnershipEvent,
  countActiveAppelOffresByCommercialOwnerUserId,
  getAppelOffresRecordByCode,
  getCommercialOwnerViewByCode,
  listActiveAppelOffresByCommercialOwnerUserId,
  listAppelOffresDetails,
  listCommercialOwnershipEventsByCode,
  updateCommercialOwnerByCode
} from "./repository.ts";
import type {
  AppelOffresCommercialOwnershipEventRecord,
  AppelOffresCommercialOwnerView,
  AppelOffresRecord
} from "./types.ts";
import type { CurrentUser } from "../auth/rbac.ts";
import { canAccess, getAreaAccessDeniedMessage } from "../auth/rbac.ts";
import { getFallbackDevelopmentUser } from "../auth/current-user.ts";
import { getUserById, listUsers } from "../users/repository.ts";
import type { UserRecord } from "../users/types.ts";
import { createNotification } from "../notifications/service.ts";

type CommercialOwnershipImpact = {
  activeOwnedCount: number;
  ownedTenderCodes: string[];
  ownedTenders: Array<{
    code: string;
    title: string;
    updatedAt: string;
  }>;
};

export type CommercialOwnershipErrorCode =
  | "AO_NOT_FOUND"
  | "RBAC_FORBIDDEN"
  | "OWNER_NOT_ASSIGNED"
  | "OWNER_ALREADY_ASSIGNED"
  | "OWNER_TRANSFER_FORBIDDEN"
  | "OWNER_INVALID_TARGET"
  | "OWNER_TARGET_INACTIVE"
  | "OWNER_TARGET_SAME_AS_CURRENT"
  | "OWNER_ASSIGNMENT_NOT_ALLOWED";

export class CommercialOwnershipError extends Error {
  code: CommercialOwnershipErrorCode;
  status: number;
  details: Record<string, unknown> | null;

  constructor(
    code: CommercialOwnershipErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "CommercialOwnershipError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function normalizeCurrentUser(currentUser?: CurrentUser | null) {
  return currentUser ?? getFallbackDevelopmentUser();
}

function parseActorUserId(currentUser: CurrentUser) {
  const parsed = Number(currentUser.id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isCommercialActor(currentUser: CurrentUser) {
  return currentUser.role === "COMMERCIAL" && currentUser.status === "ACTIVE";
}

export function requiresCommercialOwnershipRecovery(
  tender:
    | Pick<AppelOffresRecord, "commercialOwnerUserId" | "commercialOwnerStatus">
    | AppelOffresCommercialOwnerView
) {
  const userId = "userId" in tender ? tender.userId : tender.commercialOwnerUserId;
  const status = "status" in tender ? tender.status : tender.commercialOwnerStatus;

  return userId == null || status === "INACTIVE" || status === "LOCKED";
}

export function canCoordinateTender(
  currentUser: CurrentUser,
  tender: Pick<AppelOffresRecord, "commercialOwnerUserId">
) {
  const actorUserId = parseActorUserId(currentUser);
  return (
    isCommercialActor(currentUser)
    && actorUserId != null
    && tender.commercialOwnerUserId != null
    && actorUserId === tender.commercialOwnerUserId
  );
}

export async function assertCanCoordinateTender(
  code: string,
  currentUser?: CurrentUser | null
) {
  const actor = normalizeCurrentUser(currentUser);
  if (!canAccess(actor.role, "appels_offres")) {
    throw new CommercialOwnershipError(
      "RBAC_FORBIDDEN",
      getAreaAccessDeniedMessage("appels_offres", actor.role),
      403,
      { role: actor.role }
    );
  }

  const tender = await getAppelOffresRecordByCode(code, { includeArchived: true });
  if (!tender) {
    throw new CommercialOwnershipError(
      "AO_NOT_FOUND",
      "Appel d'offres introuvable.",
      404,
      { code }
    );
  }

  if (!canCoordinateTender(actor, tender)) {
    throw new CommercialOwnershipError(
      "RBAC_FORBIDDEN",
      tender.commercialOwnerUserId == null
        ? "Ce dossier doit etre attribue a un responsable commercial avant toute coordination."
        : "Ce dossier est coordonne par un autre responsable commercial.",
      403,
      {
        role: actor.role,
        actor_user_id: parseActorUserId(actor),
        commercial_owner_user_id: tender.commercialOwnerUserId
      }
    );
  }

  return tender;
}

function assertCanManageOwnership(actor: CurrentUser) {
  if (isCommercialActor(actor) || actor.role === "ADMIN") {
    return;
  }

  throw new CommercialOwnershipError(
    "RBAC_FORBIDDEN",
    "Acces refuse : seul un Commercial actif ou un administrateur peut attribuer ce dossier.",
    403,
    { role: actor.role, status: actor.status }
  );
}

export function assertCanManageCommercialOwnership(currentUser?: CurrentUser | null) {
  assertCanManageOwnership(normalizeCurrentUser(currentUser));
}

async function requireTender(code: string) {
  const tender = await getAppelOffresRecordByCode(code, { includeArchived: true });
  if (!tender) {
    throw new CommercialOwnershipError(
      "AO_NOT_FOUND",
      "Appel d'offres introuvable.",
      404,
      { code }
    );
  }

  return tender;
}

async function requireCommercialTarget(userId: number) {
  const user = await getUserById(userId);
  if (!user || user.role !== "COMMERCIAL") {
    throw new CommercialOwnershipError(
      "OWNER_INVALID_TARGET",
      "Le responsable cible doit etre un utilisateur Commercial existant.",
      422,
      { user_id: userId }
    );
  }

  if (user.status !== "ACTIVE") {
    throw new CommercialOwnershipError(
      "OWNER_TARGET_INACTIVE",
      "Le responsable cible doit etre un utilisateur Commercial actif.",
      422,
      { user_id: userId, status: user.status }
    );
  }

  return user;
}

function inferCommercialOwnerFromLegacyLabel(
  legacyLabel: string,
  users: UserRecord[]
): { match: UserRecord | null; ambiguous: boolean; reason: string | null } {
  const normalized = normalizeText(legacyLabel);
  if (!normalized) {
    return { match: null, ambiguous: false, reason: null };
  }

  const emailMatches = users.filter((user) => user.normalizedEmail === normalized);
  if (emailMatches.length === 1) {
    return { match: emailMatches[0], ambiguous: false, reason: "legacy_email" };
  }
  if (emailMatches.length > 1) {
    return { match: null, ambiguous: true, reason: "legacy_email_ambiguous" };
  }

  const exactNameMatches = users.filter((user) => normalizeText(user.displayName) === normalized);
  if (exactNameMatches.length === 1) {
    return { match: exactNameMatches[0], ambiguous: false, reason: "legacy_name" };
  }
  if (exactNameMatches.length > 1) {
    return { match: null, ambiguous: true, reason: "legacy_name_ambiguous" };
  }

  return { match: null, ambiguous: false, reason: null };
}

export async function backfillLegacyCommercialOwnership(options?: {
  dryRun?: boolean;
}) {
  const [tenders, commercialUsers] = await Promise.all([
    listAppelOffresDetails({ archived: "all" }, { includeDetails: false }),
    listUsers({ role: "COMMERCIAL", status: "ACTIVE" })
  ]);

  const summary = {
    automaticallyAssignedCount: 0,
    unresolvedCount: 0,
    ambiguousCount: 0,
    assignedCodes: [] as string[],
    unresolvedCodes: [] as string[],
    ambiguousCodes: [] as string[]
  };

  for (const tender of tenders) {
    if (tender.commercialOwnerUserId != null) {
      continue;
    }

    const inference = inferCommercialOwnerFromLegacyLabel(
      tender.responsableCommercial,
      commercialUsers
    );

    if (inference.ambiguous) {
      summary.ambiguousCount += 1;
      summary.ambiguousCodes.push(tender.code);
      continue;
    }

    if (!inference.match) {
      summary.unresolvedCount += 1;
      summary.unresolvedCodes.push(tender.code);
      continue;
    }

    summary.automaticallyAssignedCount += 1;
    summary.assignedCodes.push(tender.code);

    if (!options?.dryRun) {
      const now = new Date().toISOString();
      await updateCommercialOwnerByCode({
        code: tender.code,
        commercialOwnerUserId: inference.match.id,
        assignedAt: now,
        assignedByUserId: null,
        previousOwnerUserId: null,
        reason: inference.reason,
        updatedAt: now,
        legacyResponsibleLabel: inference.match.displayName
      });
      await appendCommercialOwnershipEvent({
        code: tender.code,
        previousOwnerUserId: null,
        newOwnerUserId: inference.match.id,
        changedByUserId: null,
        reason: inference.reason,
        metadata: { source: "legacy_inference" }
      });
      await appendAuditLog(
        tender.code,
        "commercial_owner.assigned",
        {
          previousOwnerUserId: null,
          newOwnerUserId: inference.match.id,
          reason: inference.reason,
          source: "legacy_inference"
        },
        null
      );
    }
  }

  return summary;
}

export async function listEligibleCommercialOwners() {
  return listUsers({ role: "COMMERCIAL", status: "ACTIVE" });
}

export async function getCommercialOwnershipImpactForUser(
  userId: number
): Promise<CommercialOwnershipImpact> {
  const tenders = await listActiveAppelOffresByCommercialOwnerUserId(userId);
  return {
    activeOwnedCount: tenders.length,
    ownedTenderCodes: tenders.map((tender) => tender.code),
    ownedTenders: tenders.map((tender) => ({
      code: tender.code,
      title: tender.title,
      updatedAt: tender.updatedAt
    }))
  };
}

export async function getCommercialOwnership(code: string) {
  const [tender, owner, history] = await Promise.all([
    requireTender(code),
    getCommercialOwnerViewByCode(code),
    listCommercialOwnershipEventsByCode(code)
  ]);

  return {
    tender,
    owner:
      owner ?? {
        userId: null,
        displayName: null,
        email: null,
        jobTitle: null,
        role: null,
        status: null,
        assignedAt: null,
        assignedByUserId: null,
        assignedByName: null,
        previousOwnerUserId: null,
        previousOwnerName: null,
        reason: null,
        updatedAt: null,
        isRecoveryRequired: true,
        legacyResponsibleLabel: tender.responsableCommercial || null
      },
    history
  };
}

async function saveOwnershipChange(input: {
  code: string;
  previousOwnerUserId: number | null;
  nextOwner: UserRecord;
  actor: CurrentUser;
  reason: string | null;
  eventAction: "commercial_owner.assigned" | "commercial_owner.transferred";
}) {
  const actorUserId = parseActorUserId(input.actor);
  const now = new Date().toISOString();
  const updated = await updateCommercialOwnerByCode({
    code: input.code,
    commercialOwnerUserId: input.nextOwner.id,
    assignedAt: now,
    assignedByUserId: actorUserId,
    previousOwnerUserId: input.previousOwnerUserId,
    reason: input.reason,
    updatedAt: now,
    legacyResponsibleLabel: input.nextOwner.displayName
  });

  if (!updated) {
    throw new CommercialOwnershipError(
      "AO_NOT_FOUND",
      "Appel d'offres introuvable.",
      404,
      { code: input.code }
    );
  }

  await appendCommercialOwnershipEvent({
    code: input.code,
    previousOwnerUserId: input.previousOwnerUserId,
    newOwnerUserId: input.nextOwner.id,
    changedByUserId: actorUserId,
    reason: input.reason,
    metadata: {
      changedByRole: input.actor.role
    }
  });
  await appendAuditLog(
    input.code,
    input.eventAction,
    {
      previousOwnerUserId: input.previousOwnerUserId,
      newOwnerUserId: input.nextOwner.id,
      reason: input.reason
    },
    input.actor.name
  );

  await createNotification({
    recipientUserId: input.nextOwner.id,
    recipientRole: input.nextOwner.role,
    appelOffreCode: input.code,
    eventType:
      input.eventAction === "commercial_owner.assigned"
        ? "COMMERCIAL_OWNER_ASSIGNED"
        : "COMMERCIAL_OWNER_TRANSFERRED",
    actorUserId,
    metadata: {
      actorName: input.actor.name,
      previousOwnerUserId: input.previousOwnerUserId
    },
    section: "overview",
    dedupeKey: `${input.eventAction}:${input.code}:${input.nextOwner.id}:${input.previousOwnerUserId ?? 0}`
  });
  if (input.previousOwnerUserId != null && input.previousOwnerUserId !== input.nextOwner.id) {
    await createNotification({
      recipientUserId: input.previousOwnerUserId,
      recipientRole: "COMMERCIAL",
      appelOffreCode: input.code,
      eventType: "COMMERCIAL_OWNER_TRANSFERRED",
      actorUserId,
      metadata: {
        actorName: input.actor.name,
        newOwnerUserId: input.nextOwner.id,
        newOwnerName: input.nextOwner.displayName
      },
      section: "overview",
      dedupeKey: `commercial_owner.transferred:previous:${input.code}:${input.previousOwnerUserId}:${input.nextOwner.id}`
    });
  }

  return updated;
}

export async function assignCommercialOwner(input: {
  code: string;
  newOwnerUserId: number;
  reason?: string | null;
  currentUser?: CurrentUser | null;
}) {
  const actor = normalizeCurrentUser(input.currentUser);
  assertCanManageOwnership(actor);

  const tender = await requireTender(input.code);
  if (tender.commercialOwnerUserId != null) {
    throw new CommercialOwnershipError(
      "OWNER_ALREADY_ASSIGNED",
      "Ce dossier possede deja un responsable commercial. Utilisez le transfert pour le changer.",
      409,
      { commercial_owner_user_id: tender.commercialOwnerUserId }
    );
  }

  const nextOwner = await requireCommercialTarget(input.newOwnerUserId);
  return saveOwnershipChange({
    code: input.code,
    previousOwnerUserId: null,
    nextOwner,
    actor,
    reason: input.reason?.trim() || null,
    eventAction: "commercial_owner.assigned"
  });
}

export async function transferCommercialOwner(input: {
  code: string;
  newOwnerUserId: number;
  reason?: string | null;
  currentUser?: CurrentUser | null;
}) {
  const actor = normalizeCurrentUser(input.currentUser);
  assertCanManageOwnership(actor);

  const tender = await requireTender(input.code);
  if (tender.commercialOwnerUserId == null) {
    throw new CommercialOwnershipError(
      "OWNER_NOT_ASSIGNED",
      "Ce dossier doit d'abord etre attribue avant de pouvoir etre transfere.",
      409,
      { code: input.code }
    );
  }

  const actorUserId = parseActorUserId(actor);
  const isOwner = actor.role === "COMMERCIAL" && actorUserId === tender.commercialOwnerUserId;
  if (!isOwner && actor.role !== "ADMIN") {
    throw new CommercialOwnershipError(
      "OWNER_TRANSFER_FORBIDDEN",
      "Seul le responsable commercial actuel peut transferer ce dossier.",
      403,
      {
        actor_user_id: actorUserId,
        commercial_owner_user_id: tender.commercialOwnerUserId
      }
    );
  }

  const nextOwner = await requireCommercialTarget(input.newOwnerUserId);
  if (nextOwner.id === tender.commercialOwnerUserId) {
    throw new CommercialOwnershipError(
      "OWNER_TARGET_SAME_AS_CURRENT",
      "Le nouveau responsable est deja le proprietaire courant du dossier.",
      409,
      { commercial_owner_user_id: tender.commercialOwnerUserId }
    );
  }

  return saveOwnershipChange({
    code: input.code,
    previousOwnerUserId: tender.commercialOwnerUserId,
    nextOwner,
    actor,
    reason: input.reason?.trim() || null,
    eventAction: "commercial_owner.transferred"
  });
}

export async function getActiveOwnedTenderCount(userId: number) {
  return countActiveAppelOffresByCommercialOwnerUserId(userId);
}

export async function handleCommercialOwnershipRecoveryRequired(input: {
  user: Pick<UserRecord, "id" | "displayName" | "role" | "status">;
  currentUser?: CurrentUser | null;
}) {
  if (
    input.user.role !== "COMMERCIAL"
    || (input.user.status !== "INACTIVE" && input.user.status !== "LOCKED")
  ) {
    return {
      activeOwnedCount: 0,
      ownedTenderCodes: [],
      ownedTenders: []
    } satisfies CommercialOwnershipImpact;
  }

  const impact = await getCommercialOwnershipImpactForUser(input.user.id);
  if (impact.activeOwnedCount === 0) {
    return impact;
  }

  const actor = normalizeCurrentUser(input.currentUser);
  const actorUserId = parseActorUserId(actor);
  const recipients = (await listUsers({ role: "COMMERCIAL", status: "ACTIVE" }))
    .filter((recipient) => recipient.id !== input.user.id);

  for (const tender of impact.ownedTenders) {
    await appendAuditLog(
      tender.code,
      "commercial_owner.recovery_required",
      {
        commercialOwnerUserId: input.user.id,
        commercialOwnerName: input.user.displayName,
        commercialOwnerStatus: input.user.status,
        activeOwnedCount: impact.activeOwnedCount
      },
      actor.name
    );

    for (const recipient of recipients) {
      await createNotification({
        recipientUserId: recipient.id,
        recipientRole: recipient.role,
        appelOffreCode: tender.code,
        eventType: "COMMERCIAL_OWNER_RECOVERY_REQUIRED",
        actorUserId,
        metadata: {
          actorName: actor.name,
          inactiveOwnerUserId: input.user.id,
          inactiveOwnerName: input.user.displayName,
          inactiveOwnerStatus: input.user.status
        },
        section: "overview",
        dedupeKey: `commercial_owner.recovery:${tender.code}:${input.user.id}:${recipient.id}:${input.user.status}`
      });
    }
  }

  return impact;
}

export async function getCommercialOwnershipHistory(
  code: string
): Promise<AppelOffresCommercialOwnershipEventRecord[]> {
  await requireTender(code);
  return listCommercialOwnershipEventsByCode(code);
}

export function toCommercialOwnershipErrorResponse(error: unknown) {
  if (error instanceof CommercialOwnershipError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? {}
        }
      }
    };
  }

  const message =
    error instanceof Error ? error.message : "Erreur ownership inattendue.";

  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: "COMMERCIAL_OWNERSHIP_INTERNAL_ERROR",
        message,
        details: {}
      }
    }
  };
}
