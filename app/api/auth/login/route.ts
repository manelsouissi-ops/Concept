import { NextResponse } from "next/server";
import { authenticateWithPassword, readClientIpAddress, readUserAgent } from "@/lib/auth/session.ts";
import { AuthError } from "@/lib/auth/errors.ts";
import { getAuthCookieOptions, AUTH_SESSION_COOKIE_NAME } from "@/lib/auth/config.ts";
import { getSafeRedirectTargetForRole } from "@/lib/auth/paths.ts";

export const runtime = "nodejs";

function parseStringField(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_LOGIN_PAYLOAD",
            message: "Le formulaire de connexion est invalide."
          }
        },
        { status: 400 }
      );
    }

    const email = parseStringField(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "INVALID_LOGIN_PAYLOAD",
            message: "Email ou mot de passe incorrect."
          }
        },
        { status: 400 }
      );
    }

    const authenticated = await authenticateWithPassword({
      email,
      password,
      ipAddress: readClientIpAddress(request),
      userAgent: readUserAgent(request)
    });
    const redirectTo = getSafeRedirectTargetForRole(
      authenticated.currentUser.role,
      parseStringField(body.next)
    );
    const response = NextResponse.json({
      ok: true,
      redirect_to: redirectTo
    });
    response.cookies.set(
      AUTH_SESSION_COOKIE_NAME,
      authenticated.sessionToken,
      getAuthCookieOptions()
    );

    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message
          }
        },
        { status: error.status }
      );
    }

    const message = error instanceof Error ? error.message : "La connexion a echoue.";
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "AUTH_INTERNAL_ERROR",
          message
        }
      },
      { status: 500 }
    );
  }
}
