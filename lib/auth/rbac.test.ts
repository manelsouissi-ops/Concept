import test from "node:test";
import assert from "node:assert/strict";
import {
  canAccess,
  canAccessPath,
  canCreateTender,
  canEditFciModule,
  canGenerateFciModule,
  getAreaAccessDeniedMessage,
  getFciModuleForRole,
  canMakeFinalDecision,
  canValidateFciModule,
  canViewFciModule,
  getDefaultAuthenticatedPath,
  getFciReadOnlyMessage,
  getUserRoleLabel,
  type AppArea
} from "./rbac.ts";

// Regression test for a real bug: getAreaAccessDeniedMessage's switch did not
// have a case for the "archive" AppArea (added for the Knowledge Base admin
// page), so TypeScript correctly inferred the return type as
// `string | undefined` and, at runtime, a denied /administration/knowledge
// request would have propagated an undefined message into the 403 response
// body. Every AppArea must produce a defined, non-empty denial message, for
// every role including the one that only hits the switch (not the ADMIN
// fast-path) - this guards against the same class of bug recurring when a
// new AppArea is added without updating this switch.
const ALL_APP_AREAS: readonly AppArea[] = [
  "administration",
  "dashboard",
  "appels_offres",
  "profile",
  "settings",
  "archive"
];

test("only Commercial can create a tender while all business roles retain tender viewing", () => {
  assert.equal(canCreateTender("COMMERCIAL"), true);
  assert.equal(canAccessPath("COMMERCIAL", "/appels-offres/nouveau"), true);

  for (const role of ["FINANCE", "OPERATIONS", "DIRECTION_GENERALE", "ADMIN"] as const) {
    assert.equal(canCreateTender(role), false);
    assert.equal(canAccessPath(role, "/appels-offres/nouveau"), false);
  }

  for (const role of ["COMMERCIAL", "FINANCE", "OPERATIONS", "DIRECTION_GENERALE"] as const) {
    assert.equal(canAccess(role, "appels_offres"), true);
    assert.equal(canAccessPath(role, "/appels-offres/AO-EXISTANT"), true);
  }
});

test("ADMIN keeps only technical areas while business roles keep dashboard and appels d'offres", () => {
  assert.equal(canAccess("ADMIN", "administration"), true);
  assert.equal(canAccess("ADMIN", "profile"), true);
  assert.equal(canAccess("ADMIN", "settings"), true);
  assert.equal(canAccess("ADMIN", "dashboard"), false);
  assert.equal(canAccess("ADMIN", "appels_offres"), false);

  for (const role of ["COMMERCIAL", "FINANCE", "OPERATIONS", "DIRECTION_GENERALE"] as const) {
    assert.equal(canAccess(role, "dashboard"), true);
    assert.equal(canAccess(role, "appels_offres"), true);
    assert.equal(canAccess(role, "administration"), false);
  }
});

test("ADMIN lands on administration and cannot keep forbidden next paths", () => {
  assert.equal(getDefaultAuthenticatedPath("ADMIN"), "/administration");
  assert.equal(canAccessPath("ADMIN", "/administration"), true);
  assert.equal(canAccessPath("ADMIN", "/administration/utilisateurs"), true);
  assert.equal(canAccessPath("ADMIN", "/dashboard"), false);
  assert.equal(canAccessPath("ADMIN", "/appels-offres/AO-1"), false);
  assert.equal(canAccessPath("COMMERCIAL", "/dashboard"), true);
  assert.equal(canAccessPath("COMMERCIAL", "/administration"), false);
});

test("role-specific secondary workspaces reject unrelated roles", () => {
  for (const path of ["/fiches-cdc", "/go-no-go"]) {
    assert.equal(canAccessPath("COMMERCIAL", path), true);
    assert.equal(canAccessPath("FINANCE", path), false);
    assert.equal(canAccessPath("OPERATIONS", path), false);
    assert.equal(canAccessPath("DIRECTION_GENERALE", path), false);
  }
  for (const path of ["/mes-fci", "/history"]) {
    assert.equal(canAccessPath("COMMERCIAL", path), true);
    assert.equal(canAccessPath("DIRECTION_GENERALE", path), true);
    assert.equal(canAccessPath("FINANCE", path), false);
    assert.equal(canAccessPath("OPERATIONS", path), false);
  }
  assert.equal(canAccessPath("DIRECTION_GENERALE", "/decisions"), true);
});

test("all business roles can view departmental FCI modules A to D but ADMIN cannot", () => {
  for (const moduleCode of ["A", "B", "C", "D"] as const) {
    assert.equal(canViewFciModule("ADMIN", moduleCode), false);
    assert.equal(canViewFciModule("COMMERCIAL", moduleCode), true);
    assert.equal(canViewFciModule("FINANCE", moduleCode), true);
    assert.equal(canViewFciModule("OPERATIONS", moduleCode), true);
    assert.equal(canViewFciModule("DIRECTION_GENERALE", moduleCode), true);
  }
});

test("each department owns exactly its FCI contribution", () => {
  assert.equal(canEditFciModule("COMMERCIAL", "A"), true);
  assert.equal(canGenerateFciModule("COMMERCIAL", "A"), true);
  assert.equal(canValidateFciModule("COMMERCIAL", "A"), true);

  assert.equal(canEditFciModule("FINANCE", "B"), true);
  assert.equal(canGenerateFciModule("FINANCE", "B"), true);
  assert.equal(canValidateFciModule("FINANCE", "B"), true);

  assert.equal(canEditFciModule("OPERATIONS", "C"), true);
  assert.equal(canGenerateFciModule("OPERATIONS", "C"), true);
  assert.equal(canValidateFciModule("OPERATIONS", "C"), true);

  assert.equal(canEditFciModule("DIRECTION_GENERALE", "A"), false);
  assert.equal(canGenerateFciModule("DIRECTION_GENERALE", "B"), false);
  assert.equal(canValidateFciModule("DIRECTION_GENERALE", "C"), false);
  assert.equal(canEditFciModule("DIRECTION_GENERALE", "D"), true);
  assert.equal(canGenerateFciModule("DIRECTION_GENERALE", "D"), true);
  assert.equal(canValidateFciModule("DIRECTION_GENERALE", "D"), true);
  assert.equal(getFciModuleForRole("DIRECTION_GENERALE"), "D");

  assert.equal(canEditFciModule("ADMIN", "A"), false);
  assert.equal(canGenerateFciModule("ADMIN", "B"), false);
  assert.equal(canValidateFciModule("ADMIN", "D"), false);
  assert.equal(canEditFciModule("COMMERCIAL", "B"), false);
  assert.equal(canEditFciModule("FINANCE", "A"), false);
  assert.equal(canEditFciModule("OPERATIONS", "D"), false);
  assert.equal(canEditFciModule("DIRECTION_GENERALE", "C"), false);
});

test("final decision permission is limited to direction generale", () => {
  assert.equal(canMakeFinalDecision("ADMIN"), false);
  assert.equal(canMakeFinalDecision("DIRECTION_GENERALE"), true);
  assert.equal(canMakeFinalDecision("COMMERCIAL"), false);
  assert.equal(canMakeFinalDecision("FINANCE"), false);
  assert.equal(canMakeFinalDecision("OPERATIONS"), false);
});

test("read-only helper returns the business-only message for ADMIN and a French read-only hint for non-owner roles", () => {
  assert.equal(
    getFciReadOnlyMessage("ADMIN", "A"),
    "Cette fonctionnalite est reservee aux equipes metier."
  );
  assert.equal(getFciReadOnlyMessage("COMMERCIAL", "A"), null);
  assert.match(getFciReadOnlyMessage("COMMERCIAL", "B") ?? "", /Lecture seule/i);
  assert.equal(getUserRoleLabel("DIRECTION_GENERALE"), "Direction generale");
});

test("getAreaAccessDeniedMessage returns a defined, non-empty message for every area and role", () => {
  const roles = ["ADMIN", "COMMERCIAL", "FINANCE", "OPERATIONS", "DIRECTION_GENERALE"] as const;

  for (const area of ALL_APP_AREAS) {
    for (const role of roles) {
      const message = getAreaAccessDeniedMessage(area, role);
      assert.equal(typeof message, "string", `area=${area} role=${role} must return a string`);
      assert.ok(message.length > 0, `area=${area} role=${role} must return a non-empty message`);
    }

    // role omitted entirely (e.g. an unauthenticated caller) must still fail closed
    // with a real message rather than undefined.
    const messageWithoutRole = getAreaAccessDeniedMessage(area);
    assert.equal(typeof messageWithoutRole, "string", `area=${area} with no role must return a string`);
    assert.ok(messageWithoutRole.length > 0, `area=${area} with no role must return a non-empty message`);
  }
});

test("getAreaAccessDeniedMessage covers the archive area specifically", () => {
  assert.match(getAreaAccessDeniedMessage("archive", "COMMERCIAL"), /archives/i);
  assert.match(getAreaAccessDeniedMessage("archive"), /archives/i);
});
