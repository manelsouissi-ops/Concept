import type { UserRole } from "./rbac.ts";
import { canAccessPath, getDefaultAuthenticatedPath } from "./rbac.ts";

const PUBLIC_PAGE_PATHS = new Set<string>(["/login"]);
const PUBLIC_API_PATH_PATTERNS = [
  /^\/api\/auth\/(?:login|logout)$/,
  /^\/api\/fiche\/callbacks\/n8n$/,
  /^\/api\/documents\/callbacks\/n8n$/,
  /^\/api\/fci\/callbacks\/n8n$/,
  /^\/api\/fci\/contracts\/validate$/,
  /^\/api\/fiche\/[^/]+\/complete$/
];

export function isPublicPagePath(pathname: string) {
  return PUBLIC_PAGE_PATHS.has(pathname);
}

export function isProtectedPagePath(pathname: string) {
  if (!pathname || pathname.startsWith("/api")) {
    return false;
  }

  return !isPublicPagePath(pathname);
}

export function isPublicApiPath(pathname: string) {
  return PUBLIC_API_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function getSafeRedirectTarget(
  value: string | null | undefined,
  fallback = "/dashboard"
) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return fallback;
  }

  if (trimmed.startsWith("/login") || trimmed.startsWith("/api/")) {
    return fallback;
  }

  return trimmed;
}

export function getSafeRedirectTargetForRole(role: UserRole, value: string | null | undefined) {
  const fallback = getDefaultAuthenticatedPath(role);
  const target = getSafeRedirectTarget(value, fallback);
  return canAccessPath(role, target) ? target : fallback;
}

export function buildLoginHref(nextPath: string | null | undefined) {
  const target = getSafeRedirectTarget(nextPath, "/dashboard");
  const params = new URLSearchParams({ next: target });
  return `/login?${params.toString()}`;
}
