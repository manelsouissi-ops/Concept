import assert from "node:assert/strict";
import test from "node:test";
import { getRoleWorkspaceExperience } from "./role-workspace.ts";

test("finance gets the focused department navigation", () => {
  const financeExperience = getRoleWorkspaceExperience("FINANCE");

  assert.equal(financeExperience.dashboardVariant, "department_minimal");
  assert.equal(financeExperience.dashboardAction, null);
  assert.deepEqual(
    financeExperience.primaryNavigation.map((item) => item.label),
    ["Accueil", "Mes FCI", "Appels d'offres", "Historique", "Profil"]
  );
});

test("operations gets the same minimal workspace as finance", () => {
  const operationsExperience = getRoleWorkspaceExperience("OPERATIONS");

  assert.equal(operationsExperience.dashboardVariant, "department_minimal");
  assert.equal(operationsExperience.dashboardAction, null);
  assert.deepEqual(
    operationsExperience.primaryNavigation.map((item) => item.label),
    ["Accueil", "Mes FCI", "Appels d'offres", "Historique", "Profil"]
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

test("commercial workspace exposes task-oriented navigation", () => {
  const commercialExperience = getRoleWorkspaceExperience("COMMERCIAL");

  assert.equal(commercialExperience.dashboardVariant, "commercial_coordination");
  assert.deepEqual(
    commercialExperience.primaryNavigation.map((item) => item.label),
    [
      "Accueil",
      "Appels d'offres",
      "Mes Fiches CDC",
      "Mes FCI",
      "Go/No-Go",
      "Historique",
      "Profil"
    ]
  );
  assert.equal(commercialExperience.dashboardAction, null);
  assert.deepEqual(
    commercialExperience.primaryNavigation.map((item) => item.href),
    ["/dashboard", "/appels-offres", "/fiches-cdc", "/mes-fci", "/go-no-go", "/history", "/profile"]
  );
});
