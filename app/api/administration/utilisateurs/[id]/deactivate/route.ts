import { type NextRequest } from "next/server";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import { setUserStatus } from "@/lib/users/repository.ts";
import { buildUsersApiError, buildUsersApiSuccess, mapUsersApiError } from "@/lib/users/http.ts";

function parseRouteId(id: string) {
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(
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

    const user = await setUserStatus(userId, "INACTIVE");
    if (!user) {
      return buildUsersApiError("USER_NOT_FOUND", "Utilisateur introuvable.", 404);
    }

    return buildUsersApiSuccess({ user });
  } catch (error) {
    return mapUsersApiError(error, "USER_DEACTIVATE_FAILED", "Impossible de desactiver cet utilisateur.");
  }
}
