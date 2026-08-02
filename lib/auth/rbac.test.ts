import test from "node:test";
import assert from "node:assert/strict";
import {
  canAccess,
  canEditFciModule,
  canGenerateFciModule,
  canMakeFinalDecision,
  canValidateFciModule,
  canViewFciModule,
  getFciReadOnlyMessage,
  getUserRoleLabel,
  USER_ROLES
} from "./rbac.ts";

test("all business roles can access dashboard and appels d'offres", () => {
  for (const role of USER_ROLES) {
    assert.equal(canAccess(role, "dashboard"), true);
    assert.equal(canAccess(role, "appels_offres"), true);
  }
});

test("administration access is restricted to admin", () => {
  assert.equal(canAccess("ADMIN", "administration"), true);
  assert.equal(canAccess("COMMERCIAL", "administration"), false);
  assert.equal(canAccess("FINANCE", "administration"), false);
  assert.equal(canAccess("OPERATIONS", "administration"), false);
  assert.equal(canAccess("DIRECTION_GENERALE", "administration"), false);
});

test("all roles can view departmental FCI modules A to D", () => {
  for (const role of USER_ROLES) {
    for (const moduleCode of ["A", "B", "C", "D"] as const) {
      assert.equal(canViewFciModule(role, moduleCode), true);
    }
  }
});

test("only the assigned role can edit, generate, and validate its own module", () => {
  assert.equal(canEditFciModule("COMMERCIAL", "A"), true);
  assert.equal(canGenerateFciModule("COMMERCIAL", "A"), true);
  assert.equal(canValidateFciModule("COMMERCIAL", "A"), true);

  assert.equal(canEditFciModule("FINANCE", "B"), true);
  assert.equal(canGenerateFciModule("FINANCE", "B"), true);
  assert.equal(canValidateFciModule("FINANCE", "B"), true);

  assert.equal(canEditFciModule("OPERATIONS", "C"), true);
  assert.equal(canEditFciModule("DIRECTION_GENERALE", "D"), true);

  assert.equal(canEditFciModule("COMMERCIAL", "B"), false);
  assert.equal(canEditFciModule("FINANCE", "A"), false);
  assert.equal(canEditFciModule("OPERATIONS", "D"), false);
  assert.equal(canEditFciModule("DIRECTION_GENERALE", "C"), false);
});

test("admin has full edit rights across every FCI module", () => {
  for (const moduleCode of ["A", "B", "C", "D"] as const) {
    assert.equal(canEditFciModule("ADMIN", moduleCode), true);
    assert.equal(canGenerateFciModule("ADMIN", moduleCode), true);
    assert.equal(canValidateFciModule("ADMIN", moduleCode), true);
  }
});

test("final decision permission is limited to admin and direction generale", () => {
  assert.equal(canMakeFinalDecision("ADMIN"), true);
  assert.equal(canMakeFinalDecision("DIRECTION_GENERALE"), true);
  assert.equal(canMakeFinalDecision("COMMERCIAL"), false);
  assert.equal(canMakeFinalDecision("FINANCE"), false);
  assert.equal(canMakeFinalDecision("OPERATIONS"), false);
});

test("read-only helper returns a clear French message for non-owner roles", () => {
  assert.equal(getFciReadOnlyMessage("ADMIN", "A"), null);
  assert.equal(getFciReadOnlyMessage("COMMERCIAL", "A"), null);
  assert.match(getFciReadOnlyMessage("COMMERCIAL", "B") ?? "", /Lecture seule/i);
  assert.equal(getUserRoleLabel("DIRECTION_GENERALE"), "Direction generale");
});
