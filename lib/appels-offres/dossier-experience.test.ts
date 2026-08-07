import test from "node:test";
import assert from "node:assert/strict";
import {
  getAppelOffresWorkspaceTabs,
  isDecisionCenterRole,
  resolveAppelOffresWorkspaceView
} from "./dossier-experience.ts";

test("DG dossier navigation is reduced to Decision and Historique", () => {
  const tabs = getAppelOffresWorkspaceTabs("DIRECTION_GENERALE");

  assert.deepEqual(
    tabs.map((tab) => tab.label),
    ["Decision", "Historique"]
  );
});

test("business roles keep the generic dossier workspace tabs", () => {
  const tabs = getAppelOffresWorkspaceTabs("COMMERCIAL");

  assert.deepEqual(
    tabs.map((tab) => tab.label),
    ["Apercu", "Documents", "Fiche CDC", "FCI", "Go/No-Go", "Historique"]
  );
});

test("DG defaults to the decision center and never falls back to the worker FCI shell", () => {
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
    "go-no-go"
  );
  assert.equal(
    resolveAppelOffresWorkspaceView({
      requestedView: "overview",
      role: "DIRECTION_GENERALE"
    }),
    "go-no-go"
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
