import { type NextRequest } from "next/server";
import { requireAreaAccessForRequest } from "@/lib/auth/server.ts";
import { getUserById, listDepartments, updateUser as updateUserRecord } from "@/lib/users/repository.ts";
import { parseUserPayload } from "@/lib/users/validation.ts";
import { buildUsersApiError, buildUsersApiSuccess, mapUsersApiError } from "@/lib/users/http.ts";

function parseRouteId(id: string) {
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

    return buildUsersApiSuccess({ user, departments });
  } catch (error) {
    return mapUsersApiError(error, "USER_FETCH_FAILED", "Impossible de charger cet utilisateur.");
  }
}

export async function PUT(
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

    const body = await request.json();
    const payload = parseUserPayload(body);
    const user = await updateUserRecord(userId, payload);

    if (!user) {
      return buildUsersApiError("USER_NOT_FOUND", "Utilisateur introuvable.", 404);
    }

    return buildUsersApiSuccess({ user });
  } catch (error) {
    return mapUsersApiError(error, "USER_UPDATE_FAILED", "La mise a jour utilisateur a echoue.");
  }
}
