import { type NextRequest } from "next/server";
import {
  getDevelopmentUserState,
  getUserById,
  setCurrentDevelopmentUser
} from "@/lib/users/repository.ts";
import { buildUsersApiError, buildUsersApiSuccess, mapUsersApiError } from "@/lib/users/http.ts";
import { AUTH_SESSION_COOKIE_NAME, getAuthCookieOptions, isDevelopmentUserSwitcherEnabled } from "@/lib/auth/config.ts";
import { createDevelopmentUserSession, readClientIpAddress, readUserAgent } from "@/lib/auth/session.ts";
import { canAccess } from "@/lib/auth/rbac.ts";
import { resolveCurrentUserFromRequest } from "@/lib/auth/current-user.ts";

function isDevelopmentMode() {
  return isDevelopmentUserSwitcherEnabled();
}

export async function GET(request: NextRequest) {
  if (!isDevelopmentMode()) {
    return buildUsersApiError("DEVELOPMENT_MODE_DISABLED", "Commutateur indisponible hors developpement.", 404);
  }

  try {
    const currentUser = await resolveCurrentUserFromRequest(request);
    if (!canAccess(currentUser.role, "administration")) {
      return buildUsersApiError("RBAC_FORBIDDEN", "Acces refuse : cette section est reservee a l'administrateur.", 403);
    }

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
    const currentUser = await resolveCurrentUserFromRequest(request);
    if (!canAccess(currentUser.role, "administration")) {
      return buildUsersApiError("RBAC_FORBIDDEN", "Acces refuse : cette section est reservee a l'administrateur.", 403);
    }

    const body = (await request.json()) as { userId?: unknown };
    const userId = Number(body.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return buildUsersApiError("USER_INVALID_ID", "Identifiant utilisateur invalide.", 400);
    }

    const user = await setCurrentDevelopmentUser(userId);
    const state = await getDevelopmentUserState();
    const sessionToken = await createDevelopmentUserSession({
      actingAdmin: currentUser,
      targetUserId: user.id,
      targetUserEmail: user.email,
      ipAddress: readClientIpAddress(request),
      userAgent: readUserAgent(request)
    });

    const response = buildUsersApiSuccess({
      ...state,
      user
    });
    response.cookies.set(AUTH_SESSION_COOKIE_NAME, sessionToken, getAuthCookieOptions());

    return response;
  } catch (error) {
    return mapUsersApiError(
      error,
      "DEVELOPMENT_USER_SWITCH_FAILED",
      "Impossible de changer l'utilisateur de developpement."
    );
  }
}
