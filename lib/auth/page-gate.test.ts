import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isProtectedPagePath, isPublicPagePath } from "./paths.ts";

// Next.js streams a route segment's loading.tsx fallback with an already-committed
// 200 status before an async page component further down the tree finishes
// rendering. A redirect() thrown from inside page.tsx on such a segment therefore
// cannot change the response status: it throws correctly, but the client still
// gets served the 200 shell. The fix is to run the gate in layout.tsx, which
// renders above that Suspense boundary, so its redirect() commits first.
//
// This test locks that in structurally: any gated segment that has a loading.tsx
// must also have a layout.tsx that calls requireAreaAccessForPage before it
// renders children. A page-level-only gate call is not sufficient on these routes.
const GATED_SEGMENTS_WITH_LOADING = [
  { dir: "app/dashboard", area: "dashboard" },
  { dir: "app/appels-offres", area: "appels_offres" },
  { dir: "app/fiche/[code]", area: "appels_offres" }
] as const;

test("route segments with a loading.tsx boundary gate access in layout.tsx, not page.tsx alone", () => {
  for (const { dir, area } of GATED_SEGMENTS_WITH_LOADING) {
    const loadingPath = path.join(process.cwd(), dir, "loading.tsx");
    assert.ok(
      existsSync(loadingPath),
      `expected ${dir}/loading.tsx to exist (this test's premise is stale otherwise)`
    );

    const layoutPath = path.join(process.cwd(), dir, "layout.tsx");
    assert.ok(
      existsSync(layoutPath),
      `${dir} has loading.tsx but no layout.tsx — a denied role would be served a 200 instead of redirected`
    );

    const layoutSource = readFileSync(layoutPath, "utf8");
    assert.match(
      layoutSource,
      new RegExp(`requireAreaAccessForPage\\(\\s*["']${area}["']`),
      `${dir}/layout.tsx must call requireAreaAccessForPage("${area}") before rendering children`
    );
  }
});

// C. /outils/pseudonymisation has no loading.tsx boundary, so a page-level gate
// is sufficient (same shape as /profile). It must stay authenticated-only, like
// /profile: any signed-in role may pseudonymise text locally, so it gates on
// requireAuthenticatedUserForPage rather than a specific AppArea.
test("the pseudonymisation page gates access with requireAuthenticatedUserForPage", () => {
  const pagePath = path.join(process.cwd(), "app/outils/pseudonymisation/page.tsx");
  assert.ok(existsSync(pagePath), "expected app/outils/pseudonymisation/page.tsx to exist");

  const pageSource = readFileSync(pagePath, "utf8");
  assert.match(
    pageSource,
    /requireAuthenticatedUserForPage\s*\(/,
    "app/outils/pseudonymisation/page.tsx must call requireAuthenticatedUserForPage before rendering the workspace"
  );
});

// C. Defense in depth: even before the page-level gate runs, the global
// middleware/layout redirect-to-login logic must treat this route as
// protected (it is not in the public allowlist), so an unauthenticated
// request never reaches the page at all.
test("/outils/pseudonymisation is a protected page path, not a public one", () => {
  assert.equal(isProtectedPagePath("/outils/pseudonymisation"), true);
  assert.equal(isPublicPagePath("/outils/pseudonymisation"), false);
});

test("the tender creation segment gates on tender.create above its loading boundary", () => {
  const layoutPath = path.join(process.cwd(), "app/appels-offres/nouveau/layout.tsx");
  const pagePath = path.join(process.cwd(), "app/appels-offres/nouveau/page.tsx");
  assert.ok(existsSync(layoutPath));

  for (const sourcePath of [layoutPath, pagePath]) {
    assert.match(
      readFileSync(sourcePath, "utf8"),
      /requireTenderCreationAccessForPage\s*\(/,
      `${sourcePath} must enforce the canonical tender creation permission`
    );
  }
});

test("the tender POST authorizes before parsing input or creating side effects", () => {
  const routeSource = readFileSync(
    path.join(process.cwd(), "app/api/appels-offres/route.ts"),
    "utf8"
  );
  const postSource = routeSource.slice(routeSource.indexOf("export async function POST"));
  const authorizationIndex = postSource.indexOf("requireTenderCreationAccessForRequest(request)");

  assert.ok(authorizationIndex >= 0, "POST must enforce tender.create");
  for (const sideEffect of [
    "request.formData()",
    "createAppelOffres(",
    "assignCommercialOwner(",
    "appendAuditLog(",
    "launchAnalysisForAppelOffres("
  ]) {
    assert.ok(
      authorizationIndex < postSource.indexOf(sideEffect),
      `authorization must happen before ${sideEffect}`
    );
  }
});
