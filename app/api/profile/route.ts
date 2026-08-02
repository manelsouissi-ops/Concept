import { type NextRequest } from "next/server";
import { resolveCurrentUserFromRequest } from "@/lib/auth/current-user.ts";
import { getUserById, listDepartments, updateOwnProfile } from "@/lib/users/repository.ts";
import { parseProfilePayload } from "@/lib/users/validation.ts";
import { buildUsersApiError, buildUsersApiSuccess, mapUsersApiError } from "@/lib/users/http.ts";

function parseCurrentUserId(id: string) {
  const parsed = Number(id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await resolveCurrentUserFromRequest(request);
    const userId = parseCurrentUserId(currentUser.id);
    if (!userId) {
      return buildUsersApiError("PROFILE_UNAVAILABLE", "Profil utilisateur indisponible.", 500);
    }

    const [user, departments] = await Promise.all([getUserById(userId), listDepartments()]);
    if (!user) {
      return buildUsersApiError("USER_NOT_FOUND", "Utilisateur introuvable.", 404);
    }

    return buildUsersApiSuccess({ user, departments });
  } catch (error) {
    return mapUsersApiError(error, "PROFILE_FETCH_FAILED", "Impossible de charger le profil.");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const currentUser = await resolveCurrentUserFromRequest(request);
    const userId = parseCurrentUserId(currentUser.id);
    if (!userId) {
      return buildUsersApiError("PROFILE_UNAVAILABLE", "Profil utilisateur indisponible.", 500);
    }

    const body = await request.json();
    const payload = parseProfilePayload(body);
    const user = await updateOwnProfile(userId, payload);

    if (!user) {
      return buildUsersApiError("USER_NOT_FOUND", "Utilisateur introuvable.", 404);
    }

    return buildUsersApiSuccess({ user });
  } catch (error) {
    return mapUsersApiError(error, "PROFILE_UPDATE_FAILED", "La mise a jour du profil a echoue.");
  }
}
