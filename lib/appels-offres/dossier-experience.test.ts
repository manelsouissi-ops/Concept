import test from "node:test";
import assert from "node:assert/strict";
import {
  getAppelOffresWorkspaceTabs,
  isDecisionCenterRole,
  resolveAppelOffresWorkspaceView
} from "./dossier-experience.ts";

test("DG dossier navigation exposes the submitted evidence read-only", () => {
  const tabs = getAppelOffresWorkspaceTabs("DIRECTION_GENERALE");

  assert.deepEqual(
    tabs.map((tab) => tab.label),
    ["Synthèse", "Fiche CDC", "FCI A / B / C", "Décision", "Historique"]
  );
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
