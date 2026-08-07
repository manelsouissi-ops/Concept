import { type NextRequest } from "next/server";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import { getUserById, listDepartments, updateUser as updateUserRecord } from "@/lib/users/repository.ts";
import { assertAdminCanUpdateUser, parseUserPayload } from "@/lib/users/validation.ts";
import { buildUsersApiError, buildUsersApiSuccess, mapUsersApiError } from "@/lib/users/http.ts";
import {
  getCommercialOwnershipImpactForUser,
  handleCommercialOwnershipRecoveryRequired
} from "@/lib/appels-offres/ownership.ts";

function parseRouteId(id: string) {
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function emptyOwnershipImpact() {
  return {
    activeOwnedCount: 0,
    ownedTenderCodes: [],
    ownedTenders: []
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { deniedResponse } = await requireAreaAccessForRequest(request, "administration");
  if (deniedResponse) {
    return deniedResponse;
  }

  try {
    const { id } = await context.params;
    const userId = parseRouteId(id);
    if (!userId) {
      return buildUsersApiError("USER_INVALID_ID", "Identifiant utilisateur invalide.", 400);
    }

    const [user, departments] = await Promise.all([getUserById(userId), listDepartments()]);
    if (!user) {
      return buildUsersApiError("USER_NOT_FOUND", "Utilisateur introuvable.", 404);
    }

    const ownershipImpact =
      user.role === "COMMERCIAL"
        ? await getCommercialOwnershipImpactForUser(user.id)
        : emptyOwnershipImpact();

    return buildUsersApiSuccess({ user, departments, ownershipImpact });
  } catch (error) {
    return mapUsersApiError(error, "USER_FETCH_FAILED", "Impossible de charger cet utilisateur.");
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { currentUser, deniedResponse } = await requireAreaAccessForRequest(request, "administration");
  if (deniedResponse || !currentUser) {
    return deniedResponse;
  }

  try {
    const { id } = await context.params;
    const userId = parseRouteId(id);
    if (!userId) {
      return buildUsersApiError("USER_INVALID_ID", "Identifiant utilisateur invalide.", 400);
    }

    const existingUser = await getUserById(userId);
    if (!existingUser) {
      return buildUsersApiError("USER_NOT_FOUND", "Utilisateur introuvable.", 404);
    }

    const body = await request.json();
    const payload = parseUserPayload(body);
    assertAdminCanUpdateUser(currentUser, userId, payload);
    const ownershipImpactBefore =
      existingUser.role === "COMMERCIAL"
        ? await getCommercialOwnershipImpactForUser(existingUser.id)
        : emptyOwnershipImpact();

    if (
      existingUser.role === "COMMERCIAL"
      && payload.role !== "COMMERCIAL"
      && ownershipImpactBefore.activeOwnedCount > 0
    ) {
      return buildUsersApiError(
        "USER_COMMERCIAL_OWNER_ROLE_CHANGE_FORBIDDEN",
        "Ce role ne peut pas etre modifie tant que des dossiers actifs lui sont encore rattaches.",
        409,
        ownershipImpactBefore
      );
    }

    const user = await updateUserRecord(userId, payload);

    if (!user) {
      return buildUsersApiError("USER_NOT_FOUND", "Utilisateur introuvable.", 404);
    }

    const ownershipImpact =
      existingUser.role === "COMMERCIAL" || user.role === "COMMERCIAL"
        ? await getCommercialOwnershipImpactForUser(user.id)
        : emptyOwnershipImpact();

    if (
      existingUser.status === "ACTIVE"
      && (user.status === "INACTIVE" || user.status === "LOCKED")
    ) {
      await handleCommercialOwnershipRecoveryRequired({
        user,
        currentUser
      });
    }

    return buildUsersApiSuccess({ user, ownershipImpact });
  } catch (error) {
    return mapUsersApiError(error, "USER_UPDATE_FAILED", "La mise a jour utilisateur a echoue.");
  }
}
