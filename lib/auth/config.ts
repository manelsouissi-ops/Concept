export const AUTH_SESSION_COOKIE_NAME = "concept_session";
const DEFAULT_AUTH_SESSION_TTL_SECONDS = 60 * 60 * 12;

function readOptionalEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getAuthSecret() {
  const secret = readOptionalEnv("AUTH_SECRET");
  if (!secret) {
    throw new Error("La variable d'environnement AUTH_SECRET est requise.");
  }

  return secret;
}

export function getAuthSessionTtlSeconds() {
  const rawValue = readOptionalEnv("AUTH_SESSION_TTL_SECONDS");
  if (!rawValue) {
    return DEFAULT_AUTH_SESSION_TTL_SECONDS;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      "La variable d'environnement AUTH_SESSION_TTL_SECONDS doit etre un entier positif."
    );
  }

  return parsed;
}

export function getAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getAuthSessionTtlSeconds()
  };
}

export function getDevelopmentAdminPassword() {
  return readOptionalEnv("CONCEPT_DEV_ADMIN_PASSWORD");
}

export function getDevelopmentUserPassword() {
  return readOptionalEnv("CONCEPT_DEV_USER_PASSWORD");
}

export function isDevelopmentUserSwitcherEnabled() {
  return process.env.NODE_ENV === "development"
    && readOptionalEnv("CONCEPT_ENABLE_DEV_USER_SWITCHER") === "true";
}
