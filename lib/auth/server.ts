import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import {
  requireAuthenticatedUserForPage
} from "./current-user.ts";
import { AuthError } from "./errors.ts";
import { canAccess, getAreaAccessDeniedMessage, type AppArea } from "./rbac.ts";
import { resolveCurrentUserFromRequest } from "./request-user.ts";

export function buildUnauthorizedApiResponse(message: string) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "AUTH_REQUIRED",
        message,
        details: {}
      }
    },
    { status: 401 }
  );
}

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

export function mapAuthErrorToApiResponse(error: unknown) {
  if (!(error instanceof AuthError)) {
    return null;
  }

  const payload = {
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      details: {}
    }
  };

  return NextResponse.json(payload, { status: error.status });
}

export async function requireAuthenticatedUserForRequest(request: Request) {
  return resolveCurrentUserFromRequest(request);
}

export async function requireAreaAccessForRequest(request: Request, area: AppArea) {
  let currentUser;
  try {
    currentUser = await requireAuthenticatedUserForRequest(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        currentUser: null,
        deniedResponse: buildUnauthorizedApiResponse(error.message)
      };
    }

    throw error;
  }

  if (!canAccess(currentUser.role, area)) {
    return {
      currentUser,
      deniedResponse: buildForbiddenApiResponse(getAreaAccessDeniedMessage(area, currentUser.role), {
        area,
        role: currentUser.role
      })
    };
  }

  return { currentUser, deniedResponse: null };
}

export async function requireAreaAccessForPage(area: AppArea) {
  const currentUser = await requireAuthenticatedUserForPage();
  if (!canAccess(currentUser.role, area)) {
    redirect("/forbidden");
  }

  return currentUser;
}
