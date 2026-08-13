import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTenderWorkspaceHref,
  isTenderWorkspaceRouteView,
  TENDER_WORKSPACE_ROUTE_VIEWS
} from "./tender-routes.ts";

test("the dynamic tender router accepts every canonical workspace view", () => {
  assert.deepEqual(TENDER_WORKSPACE_ROUTE_VIEWS, [
    "overview",
    "documents",
    "fiche-cdc",
    "fci",
    "go-no-go",
    "history"
  ]);
  for (const view of TENDER_WORKSPACE_ROUTE_VIEWS) {
    assert.equal(isTenderWorkspaceRouteView(view), true);
  }
  assert.equal(isTenderWorkspaceRouteView("decision"), false);
});

test("canonical tender links encode the code and use path-based views", () => {
  assert.equal(
    buildTenderWorkspaceHref("AO 2026/42", "go-no-go"),
    "/appels-offres/AO%202026%2F42/go-no-go"
  );
});
