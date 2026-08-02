import {
  ensureUserManagementSchema,
  getCurrentDevelopmentUser
} from "../users/repository.ts";
import { getDepartmentLabel } from "../users/presentation.ts";
import type { CurrentUser, UserPresentation } from "./rbac.ts";
import { buildUserPresentation } from "./rbac.ts";

export const DEFAULT_DEVELOPMENT_USER_NAME = "Bob Durand";
export const DEFAULT_DEVELOPMENT_USER_ROLE = "ADMIN";

export function getFallbackDevelopmentUser(): CurrentUser {
  return {
    id: "dev-bob-durand",
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

async function resolveCurrentUserInternal(): Promise<CurrentUser> {
  try {
    await ensureUserManagementSchema();
    const user = await getCurrentDevelopmentUser();

    if (user) {
      return {
        id: String(user.id),
        name: user.displayName,
        email: user.email,
        role: user.role,
        status: user.status,
        departmentCode: user.departmentCode,
        departmentLabel: user.departmentName,
        jobTitle: user.jobTitle,
        avatarUrl: user.avatarUrl,
        phone: user.phone,
        language: user.language,
        timezone: user.timezone,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        isDevelopmentUser: true
      };
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[identity] Falling back to local development user: ${reason}`);
  }

  return getFallbackDevelopmentUser();
}

export async function getDefaultDevelopmentUser(): Promise<CurrentUser> {
  return resolveCurrentUserInternal();
}

export async function resolveCurrentUserFromRequest(_request: Request) {
  return resolveCurrentUserInternal();
}

export async function resolveCurrentUserFromServerHeaders() {
  return resolveCurrentUserInternal();
}

export async function getDefaultDevelopmentUserPresentation(): Promise<UserPresentation> {
  return buildUserPresentation(await resolveCurrentUserInternal());
}
