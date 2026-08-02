import { type NextRequest } from "next/server";
import {
  getDevelopmentUserState,
  getUserById,
  setCurrentDevelopmentUser
} from "@/lib/users/repository.ts";
import { buildUsersApiError, buildUsersApiSuccess, mapUsersApiError } from "@/lib/users/http.ts";

function isDevelopmentMode() {
  return process.env.NODE_ENV !== "production";
}

export async function GET() {
  if (!isDevelopmentMode()) {
    return buildUsersApiError("DEVELOPMENT_MODE_DISABLED", "Commutateur indisponible hors developpement.", 404);
  }

  try {
    const state = await getDevelopmentUserState();
    const user = await getUserById(state.currentUserId);
    if (!user) {
      return buildUsersApiError("USER_NOT_FOUND", "Utilisateur introuvable.", 404);
    }

    return buildUsersApiSuccess({
      ...state,
      user
    });
  } catch (error) {
    return mapUsersApiError(
      error,
      "DEVELOPMENT_USER_STATE_FAILED",
      "Impossible de charger le contexte utilisateur de developpement."
    );
  }
}

export async function PUT(request: NextRequest) {
  if (!isDevelopmentMode()) {
    return buildUsersApiError("DEVELOPMENT_MODE_DISABLED", "Commutateur indisponible hors developpement.", 404);
  }

  try {
    const body = (await request.json()) as { userId?: unknown };
    const userId = Number(body.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return buildUsersApiError("USER_INVALID_ID", "Identifiant utilisateur invalide.", 400);
    }

    const user = await setCurrentDevelopmentUser(userId);
    const state = await getDevelopmentUserState();

    return buildUsersApiSuccess({
      ...state,
      user
    });
  } catch (error) {
    return mapUsersApiError(
      error,
      "DEVELOPMENT_USER_SWITCH_FAILED",
      "Impossible de changer l'utilisateur de developpement."
    );
  }
}
