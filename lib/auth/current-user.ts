import { cookies, headers } from "next/headers.js";
import { redirect } from "next/navigation.js";
import { getDepartmentLabel } from "../users/presentation.ts";
import { buildLoginHref, getSafeRedirectTargetForRole } from "./paths.ts";
import { resolveAuthenticatedSession } from "./session.ts";
import { AUTH_SESSION_COOKIE_NAME } from "./config.ts";
import { AuthError } from "./errors.ts";
import type { CurrentUser, UserPresentation } from "./rbac.ts";
import { buildUserPresentation } from "./rbac.ts";
import * as requestUser from "./request-user.ts";

export const getOptionalCurrentUserFromRequest = requestUser.getOptionalCurrentUserFromRequest;
export const resolveCurrentUserFromRequest = requestUser.resolveCurrentUserFromRequest;

export const DEFAULT_DEVELOPMENT_USER_NAME = "Bob Durand";
export const DEFAULT_DEVELOPMENT_USER_ROLE = "ADMIN";

export function getFallbackDevelopmentUser(): CurrentUser {
  return {
    id: "dev-bob-durand",
    firstName: "Bob",
    name: DEFAULT_DEVELOPMENT_USER_NAME,
    email: "bob.durand@concept.local",
    role: "ADMIN",
    status: "ACTIVE",
    departmentCode: "ADMINISTRATION",
    departmentLabel: getDepartmentLabel("ADMINISTRATION"),
    jobTitle: "Administrateur de plateforme",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris",
    lastLoginAt: null,
    createdAt: new Date("2026-07-30T00:00:00.000Z").toISOString(),
    isDevelopmentUser: true
  };
}

export async function getOptionalCurrentUserFromServerHeaders() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value ?? null;
  const resolved = await resolveAuthenticatedSession(sessionToken);
  return resolved?.currentUser ?? null;
}

export async function resolveCurrentUserFromServerHeaders() {
  const currentUser = await getOptionalCurrentUserFromServerHeaders();
  if (!currentUser) {
    throw new AuthError(
      "AUTH_REQUIRED",
      "Authentification requise pour acceder a cette page.",
      401
    );
  }

  return currentUser;
}

export async function requireAuthenticatedUserForPage() {
  const currentUser = await getOptionalCurrentUserFromServerHeaders();
  if (currentUser) {
    return currentUser;
  }

  const requestHeaders = await headers();
  const requestPath = requestHeaders.get("x-concept-request-path") ?? "/dashboard";
  redirect(buildLoginHref(requestPath));
}

export async function redirectAuthenticatedUserAwayFromLogin(
  requestedDestination?: string | null
) {
  const currentUser = await getOptionalCurrentUserFromServerHeaders();
  if (!currentUser) {
    return null;
  }

  redirect(getSafeRedirectTargetForRole(currentUser.role, requestedDestination));
}

export async function getDefaultDevelopmentUserPresentation(): Promise<UserPresentation> {
  return buildUserPresentation(getFallbackDevelopmentUser());
}
