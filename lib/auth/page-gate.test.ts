import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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
