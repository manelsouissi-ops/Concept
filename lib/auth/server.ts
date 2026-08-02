import { NextResponse } from "next/server";
import { forbidden } from "next/navigation";
import { resolveCurrentUserFromRequest, resolveCurrentUserFromServerHeaders } from "./current-user.ts";
import { canAccess, getAreaAccessDeniedMessage, type AppArea } from "./rbac.ts";

export function buildForbiddenApiResponse(message: string, details: Record<string, unknown> = {}) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "RBAC_FORBIDDEN",
        message,
        details
      }
    },
    { status: 403 }
  );
}

export async function requireAreaAccessForRequest(request: Request, area: AppArea) {
  const currentUser = await resolveCurrentUserFromRequest(request);
  if (!canAccess(currentUser.role, area)) {
    return {
      currentUser,
      deniedResponse: buildForbiddenApiResponse(getAreaAccessDeniedMessage(area), {
        area,
        role: currentUser.role
      })
    };
  }

  return { currentUser, deniedResponse: null };
}

export async function requireAreaAccessForPage(area: AppArea) {
  const currentUser = await resolveCurrentUserFromServerHeaders();
  if (!canAccess(currentUser.role, area)) {
    forbidden();
  }

  return currentUser;
}
