import { resolveAuthenticatedSession } from "./session.ts";
import { AUTH_SESSION_COOKIE_NAME } from "./config.ts";
import { AuthError } from "./errors.ts";

function readSessionCookieFromHeader(cookieHeader: string | null) {
  if (!cookieHeader) {
    return null;
  }

  for (const entry of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = entry.split("=");
    if (rawKey?.trim() !== AUTH_SESSION_COOKIE_NAME) {
      continue;
    }

    const value = rawValue.join("=").trim();
    return value || null;
  }

  return null;
}

export async function getOptionalCurrentUserFromRequest(request: Request) {
  const sessionToken = readSessionCookieFromHeader(request.headers.get("cookie"));
  const resolved = await resolveAuthenticatedSession(sessionToken);
  return resolved?.currentUser ?? null;
}

export async function resolveCurrentUserFromRequest(request: Request) {
  const currentUser = await getOptionalCurrentUserFromRequest(request);
  if (!currentUser) {
    throw new AuthError(
      "AUTH_REQUIRED",
      "Authentification requise pour acceder a cette ressource.",
      401
    );
  }

  return currentUser;
}
