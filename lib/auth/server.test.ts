import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// lib/auth/server.ts imports NextResponse from "next/server", which this
// repo's plain `node --test` runner cannot resolve outside the Next build
// (no test file in the repo executes anything that transitively imports
// "next/server" - see lib/auth/page-gate.test.ts for the established
// pattern of asserting on source text instead of importing route/handler
// modules directly). These tests follow that same convention.
const SERVER_SOURCE = readFileSync(path.join(process.cwd(), "lib/auth/server.ts"), "utf8");
const RBAC_SOURCE = readFileSync(path.join(process.cwd(), "lib/auth/rbac.ts"), "utf8");

// Regression guard for the exact bug fixed: getAreaAccessDeniedMessage's
// switch had no "archive" case, so TypeScript correctly inferred
// `string | undefined`, and buildForbiddenApiResponse(message: string, ...)
// failed to typecheck. The fix must be a real, exhaustive switch case - not
// a type-safety bypass.
test("no type-safety bypass was used to silence the string | undefined error", () => {
  for (const source of [SERVER_SOURCE, RBAC_SOURCE]) {
    assert.doesNotMatch(source, /@ts-ignore/);
    assert.doesNotMatch(source, /@ts-expect-error/);
    assert.doesNotMatch(source, /\bas\s+string\b/);
    assert.doesNotMatch(source, /\bas\s+any\b/);
    // non-null assertions on the values that were actually undefined-typed
    assert.doesNotMatch(source, /currentUser\.role!/);
    assert.doesNotMatch(source, /getAreaAccessDeniedMessage\([^)]*!\s*[,)]/);
  }
});

test("getAreaAccessDeniedMessage has an explicit case for every AppArea, including archive", () => {
  for (const area of ["administration", "dashboard", "appels_offres", "profile", "settings", "archive"]) {
    assert.match(
      RBAC_SOURCE,
      new RegExp(`case\\s+"${area}"\\s*:`),
      `getAreaAccessDeniedMessage must have an explicit case for "${area}"`
    );
  }
});

// C. requireAreaAccessForRequest must resolve the authenticated user (and
// fail closed with 401 via AuthError) BEFORE it ever calls canAccess() -
// an unauthenticated caller must never reach the permission check, let
// alone be granted access.
test("requireAreaAccessForRequest authenticates before checking area access", () => {
  const fnSource = SERVER_SOURCE.slice(
    SERVER_SOURCE.indexOf("export async function requireAreaAccessForRequest"),
    SERVER_SOURCE.indexOf("export async function requireAreaAccessForPage")
  );

  const authIndex = fnSource.indexOf("requireAuthenticatedUserForRequest(request)");
  const canAccessIndex = fnSource.indexOf("canAccess(currentUser.role, area)");

  assert.ok(authIndex >= 0, "must call requireAuthenticatedUserForRequest");
  assert.ok(canAccessIndex >= 0, "must call canAccess");
  assert.ok(authIndex < canAccessIndex, "authentication must happen before the RBAC check");

  // An AuthError from the authentication step must short-circuit with a 401
  // and currentUser: null - never fall through to the RBAC check.
  assert.match(fnSource, /currentUser:\s*null,\s*\n\s*deniedResponse:\s*buildUnauthorizedApiResponse/);
});

// C. Same fail-closed ordering for tender creation access.
test("requireTenderCreationAccessForRequest authenticates before checking the create permission", () => {
  const fnSource = SERVER_SOURCE.slice(
    SERVER_SOURCE.indexOf("export async function requireTenderCreationAccessForRequest")
  );

  const authIndex = fnSource.indexOf("requireAuthenticatedUserForRequest(request)");
  const permissionIndex = fnSource.indexOf("canCreateTender(currentUser.role)");

  assert.ok(authIndex >= 0);
  assert.ok(permissionIndex >= 0);
  assert.ok(authIndex < permissionIndex, "authentication must happen before the tender-create permission check");
});

// C. The forbidden-response message must come from the shared, now-exhaustive
// helper rather than a locally invented or hardcoded fallback - the whole
// point of the fix is that this call can never observe `undefined`.
test("area-access denial responses source their message from getAreaAccessDeniedMessage", () => {
  assert.match(
    SERVER_SOURCE,
    /buildForbiddenApiResponse\(getAreaAccessDeniedMessage\(area, currentUser\.role\)/
  );
});
