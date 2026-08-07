import { NextResponse, type NextRequest } from "next/server";
import { AUTH_SESSION_COOKIE_NAME } from "./lib/auth/config";
import { buildLoginHref, isProtectedPagePath, isPublicApiPath } from "./lib/auth/paths";

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const requestPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  requestHeaders.set("x-concept-request-path", requestPath);

  const hasSessionCookie = Boolean(
    request.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value?.trim()
  );

  // Pages: redirect to /login so the user lands back where they wanted.
  if (isProtectedPagePath(request.nextUrl.pathname) && !hasSessionCookie) {
    return NextResponse.redirect(new URL(buildLoginHref(requestPath), request.url));
  }

  // API routes: never redirect a fetch()/webhook caller to an HTML login page.
  // /api/auth/*, n8n callbacks, and other pre-authenticated endpoints stay public;
  // everything else requires a session cookie and gets a plain 401 otherwise.
  if (
    request.nextUrl.pathname.startsWith("/api/")
    && !isPublicApiPath(request.nextUrl.pathname)
    && !hasSessionCookie
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "AUTH_REQUIRED",
          message: "Authentification requise pour acceder a cette ressource."
        }
      },
      { status: 401 }
    );
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml|pdf|docx)$).*)"
  ]
};
