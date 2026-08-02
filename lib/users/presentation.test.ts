import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDisplayName,
  buildProfileMetadata,
  getUserInitials,
  getUserStatusLabel,
  getUserStatusTone
} from "./presentation.ts";

test("buildDisplayName composes first and last names cleanly", () => {
  assert.equal(buildDisplayName(" Bob ", " Durand "), "Bob Durand");
});

test("getUserInitials prefers first and last name when available", () => {
  assert.equal(
    getUserInitials({
      firstName: "Bob",
      lastName: "Durand",
      displayName: "Ignored Fallback"
    }),
    "BD"
  );

  assert.equal(
    getUserInitials({
      displayName: "Claire Martin"
    }),
    "CM"
  );
});

test("status presentation stays stable for profile and administration UI", () => {
  assert.equal(getUserStatusLabel("ACTIVE"), "Actif");
  assert.equal(getUserStatusTone("ACTIVE"), "success");
  assert.equal(getUserStatusTone("LOCKED"), "warning");
});

test("profile metadata exposes the expected business-facing labels", () => {
  const metadata = buildProfileMetadata({
    id: 1,
    firstName: "Bob",
    lastName: "Durand",
    displayName: "Bob Durand",
    email: "bob.durand@concept.local",
    normalizedEmail: "bob.durand@concept.local",
    jobTitle: "Administrateur",
    departmentCode: "ADMINISTRATION",
    departmentName: "Administration",
    role: "ADMIN",
    status: "ACTIVE",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    lastLoginAt: null
  });

  assert.equal(metadata[0]?.label, "Email");
  assert.equal(metadata[0]?.value, "bob.durand@concept.local");
  assert.equal(metadata[4]?.value, "Actif");
});
