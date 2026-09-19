import test from "node:test";
import assert from "node:assert/strict";
import {
  getAppelOffresWorkspaceTabs,
  isDecisionCenterRole,
  resolveAppelOffresWorkspaceView
} from "./dossier-experience.ts";

test("DG dossier navigation exposes the submitted evidence read-only", () => {
  const tabs = getAppelOffresWorkspaceTabs("DIRECTION_GENERALE");

  // "Contributions FCI" (not the older "FCI A / B / C" shorthand this test
  // used to expect) is the current, single-source label: it is what
  // DECISION_CENTER_TABS itself defines below, and it matches every other
  // live use of this tab across the app (tender-stage.ts,
  // components/fci/fci-overview.tsx, components/fci/fci-blocked-state.tsx).
  // "FCI A / B / C" survives only as loose shorthand in two markdown docs,
  // never as an actual UI string - this was a stale test expectation, not
  // a lost navigation item (Fiche CDC, the other tab this test checks, was
  // never actually missing).
  assert.deepEqual(
    tabs.map((tab) => tab.label),
    ["Synthèse", "Fiche CDC", "Contributions FCI", "Décision", "Historique"]
  );
});

test("the Fiche CDC tab is present for every role, decision-center or not", () => {
  for (const role of ["ADMIN", "COMMERCIAL", "FINANCE", "OPERATIONS", "DIRECTION_GENERALE"] as const) {
    const labels = getAppelOffresWorkspaceTabs(role).map((tab) => tab.label);
    assert.ok(labels.includes("Fiche CDC"), `role=${role} must keep a Fiche CDC tab`);
  }
});

test("business roles keep the generic dossier workspace tabs", () => {
  const tabs = getAppelOffresWorkspaceTabs("COMMERCIAL");

  assert.deepEqual(
    tabs.map((tab) => tab.label),
    ["Apercu", "Documents", "Fiche CDC", "FCI", "Go/No-Go", "Historique"]
  );
});

test("DG defaults to the decision center and can open read-only evidence", () => {
  assert.equal(
    resolveAppelOffresWorkspaceView({
      requestedView: undefined,
      role: "DIRECTION_GENERALE"
    }),
    "go-no-go"
  );
  assert.equal(
    resolveAppelOffresWorkspaceView({
      requestedView: "fci",
      role: "DIRECTION_GENERALE"
    }),
    "fci"
  );
  assert.equal(
    resolveAppelOffresWorkspaceView({
      requestedView: "overview",
      role: "DIRECTION_GENERALE"
    }),
    "overview"
  );
});

test("DG keeps direct access only to explicit supporting read-only views", () => {
  assert.equal(
    resolveAppelOffresWorkspaceView({
      requestedView: "documents",
      role: "DIRECTION_GENERALE"
    }),
    "documents"
  );
  assert.equal(
    resolveAppelOffresWorkspaceView({
      requestedView: "history",
      role: "DIRECTION_GENERALE"
    }),
    "history"
  );
});

test("isDecisionCenterRole is limited to DIRECTION_GENERALE", () => {
  assert.equal(isDecisionCenterRole("DIRECTION_GENERALE"), true);
  assert.equal(isDecisionCenterRole("COMMERCIAL"), false);
  assert.equal(isDecisionCenterRole("FINANCE"), false);
  assert.equal(isDecisionCenterRole("OPERATIONS"), false);
});
