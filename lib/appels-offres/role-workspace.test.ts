import assert from "node:assert/strict";
import test from "node:test";
import { getRoleWorkspaceExperience } from "./role-workspace.ts";

test("finance gets the minimal department workspace with a 4-item nav (no Mes dossiers)", () => {
  const financeExperience = getRoleWorkspaceExperience("FINANCE");

  assert.equal(financeExperience.dashboardVariant, "department_minimal");
  assert.equal(financeExperience.dashboardAction, null);
  assert.deepEqual(
    financeExperience.primaryNavigation.map((item) => item.label),
    ["Accueil", "Mes modules FCI", "Historique", "Profil"]
  );
});

test("operations gets the same minimal workspace as finance", () => {
  const operationsExperience = getRoleWorkspaceExperience("OPERATIONS");

  assert.equal(operationsExperience.dashboardVariant, "department_minimal");
  assert.equal(operationsExperience.dashboardAction, null);
  assert.deepEqual(
    operationsExperience.primaryNavigation.map((item) => item.label),
    ["Accueil", "Mes modules FCI", "Historique", "Profil"]
  );
});

test("direction generale gets the decision workspace and a Go/No-Go nav", () => {
  const directionGeneraleExperience = getRoleWorkspaceExperience("DIRECTION_GENERALE");

  assert.equal(directionGeneraleExperience.dashboardVariant, "decision");
  assert.equal(directionGeneraleExperience.dashboardAction, null);
  assert.deepEqual(
    directionGeneraleExperience.primaryNavigation.map((item) => item.label),
    ["Accueil", "Décisions Go/No-Go", "Historique", "Profil"]
  );
});

test("commercial workspace keeps the classic dashboard and new tender action", () => {
  const commercialExperience = getRoleWorkspaceExperience("COMMERCIAL");

  assert.equal(commercialExperience.dashboardVariant, "commercial_coordination");
  assert.deepEqual(
    commercialExperience.primaryNavigation.map((item) => item.label),
    [
      "Accueil",
      "Mes dossiers",
      "FCIs a suivre",
      "Prets pour Go/No-Go",
      "En attente DG",
      "Historique",
      "Profil"
    ]
  );
  assert.equal(commercialExperience.dashboardAction, null);
});
