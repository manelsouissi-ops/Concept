import type { CurrentUser } from "./rbac.ts";
import { getDepartmentLabel } from "../users/presentation.ts";
import {
  type AuthenticatedUserRecord,
  createDevelopmentSwitcherSession,
  createUserSession,
  findAuthenticationUserByEmail,
  invalidateUserSession,
  recordFailedLogin,
  recordLogout,
  recordSuccessfulLogin,
  resolveSession
} from "./repository.ts";
import { verifyPassword } from "./passwords.ts";
import { AuthError } from "./errors.ts";

function mapCurrentUser(user: AuthenticatedUserRecord): CurrentUser {
  return {
    id: String(user.id),
    firstName: user.firstName,
    name: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    departmentCode: user.departmentCode,
    departmentLabel: user.departmentName || getDepartmentLabel(user.departmentCode),
    jobTitle: user.jobTitle,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    language: user.language,
    timezone: user.timezone,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    isDevelopmentUser: false
  };
}

export function readClientIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedFor) {
    return forwardedFor;
  }

  return request.headers.get("x-real-ip")?.trim() ?? null;
}

export function readUserAgent(request: Request) {
  return request.headers.get("user-agent")?.trim() || null;
}

function isLockedByTime(lockedUntil: string | null) {
  if (!lockedUntil) {
    return false;
  }

  const timestamp = Date.parse(lockedUntil);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

export async function authenticateWithPassword(input: {
  email: string;
  password: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const email = input.email.trim().toLowerCase();
  const user = await findAuthenticationUserByEmail(email);

  if (!user) {
    await verifyPassword(input.password, null);
    await recordFailedLogin({
      email,
      reason: "invalid_credentials"
    });
    throw new AuthError(
      "AUTH_INVALID_CREDENTIALS",
      "Email ou mot de passe incorrect.",
      401
    );
  }

  if (
    user.status !== "ACTIVE"
    || isLockedByTime(user.lockedUntil)
  ) {
    await recordFailedLogin({
      email,
      userId: user.id,
      reason: "account_denied"
    });
    throw new AuthError(
      "AUTH_ACCOUNT_DENIED",
      "Ce compte n'est pas autorise a se connecter. Contactez un administrateur.",
      403
    );
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);
  if (!passwordMatches) {
    await recordFailedLogin({
      email,
      userId: user.id,
      reason: "invalid_credentials"
    });
    throw new AuthError(
      "AUTH_INVALID_CREDENTIALS",
      "Email ou mot de passe incorrect.",
      401
    );
  }

  await recordSuccessfulLogin(user.id, user.email);
  const created = await createUserSession({
    userId: user.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  return {
    sessionToken: created.sessionToken,
    currentUser: mapCurrentUser(user)
  };
}

export async function resolveAuthenticatedSession(sessionToken: string | null | undefined) {
  const resolved = await resolveSession(sessionToken);
  if (!resolved) {
    return null;
  }

  return {
    currentUser: mapCurrentUser(resolved.user),
    session: resolved.session
  };
}

export async function logoutAuthenticatedSession(input: {
  sessionToken: string | null | undefined;
  userId?: number | null;
  email?: string | null;
}) {
  await invalidateUserSession(input.sessionToken);
  await recordLogout(input.userId ?? null, input.email ?? null);
}

export async function createDevelopmentUserSession(input: {
  actingAdmin: CurrentUser;
  targetUserId: number;
  targetUserEmail: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const created = await createDevelopmentSwitcherSession({
    actingAdminId: Number(input.actingAdmin.id),
    actingAdminEmail: input.actingAdmin.email,
    targetUserId: input.targetUserId,
    targetUserEmail: input.targetUserEmail,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent
  });

  return created.sessionToken;
}
