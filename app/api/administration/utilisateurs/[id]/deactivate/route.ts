import { type NextRequest } from "next/server";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import { getUserById, setUserStatus } from "@/lib/users/repository.ts";
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

export async function POST(
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

    const ownershipImpact =
      existingUser.role === "COMMERCIAL"
        ? await getCommercialOwnershipImpactForUser(existingUser.id)
        : emptyOwnershipImpact();
    const user = await setUserStatus(userId, "INACTIVE");
    if (!user) {
      return buildUsersApiError("USER_NOT_FOUND", "Utilisateur introuvable.", 404);
    }

    await handleCommercialOwnershipRecoveryRequired({
      user,
      currentUser
    });

    return buildUsersApiSuccess({ user, ownershipImpact });
  } catch (error) {
    return mapUsersApiError(error, "USER_DEACTIVATE_FAILED", "Impossible de desactiver cet utilisateur.");
  }
}
