import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE_NAME, getAuthCookieOptions } from "@/lib/auth/config.ts";
import { getOptionalCurrentUserFromRequest } from "@/lib/auth/current-user.ts";
import { logoutAuthenticatedSession } from "@/lib/auth/session.ts";

export const runtime = "nodejs";

function readSessionToken(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const tokens = cookieHeader.split(";");

  for (const token of tokens) {
    const [rawKey, ...rawValue] = token.split("=");
    if (rawKey?.trim() === AUTH_SESSION_COOKIE_NAME) {
      return rawValue.join("=").trim() || null;
    }
  }

  return null;
}

export async function POST(request: Request) {
  const currentUser = await getOptionalCurrentUserFromRequest(request);
  const sessionToken = readSessionToken(request);

  await logoutAuthenticatedSession({
    sessionToken,
    userId: currentUser ? Number(currentUser.id) : null,
    email: currentUser?.email ?? null
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_SESSION_COOKIE_NAME, "", {
    ...getAuthCookieOptions(),
    maxAge: 0
  });

  return response;
}
