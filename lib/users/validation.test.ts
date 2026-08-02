import test from "node:test";
import assert from "node:assert/strict";
import {
  parseProfilePayload,
  parseUserPayload,
  validateProfileUpdateInput,
  validateUserMutationInput
} from "./validation.ts";

test("validateUserMutationInput normalizes a valid payload", () => {
  const normalized = validateUserMutationInput({
    firstName: " Bob ",
    lastName: " Durand ",
    email: "BOB.DURAND@CONCEPT.LOCAL ",
    jobTitle: " Administrateur ",
    departmentCode: "ADMINISTRATION",
    role: "ADMIN",
    status: "ACTIVE",
    avatarUrl: "",
    phone: " 06 00 00 00 00 ",
    language: "",
    timezone: ""
  });

  assert.equal(normalized.displayName, "Bob Durand");
  assert.equal(normalized.email, "bob.durand@concept.local");
  assert.equal(normalized.avatarUrl, null);
  assert.equal(normalized.language, "fr-FR");
  assert.equal(normalized.timezone, "Europe/Paris");
});

test("validateUserMutationInput rejects missing required fields and invalid email", () => {
  assert.throws(
    () =>
      validateUserMutationInput({
        firstName: "",
        lastName: "Durand",
        email: "bob",
        jobTitle: "",
        departmentCode: "ADMINISTRATION",
        role: "ADMIN",
        status: "ACTIVE",
        avatarUrl: null,
        phone: null,
        language: "fr-FR",
        timezone: "Europe/Paris"
      }),
    /prenom est obligatoire|adresse email est invalide/i
  );
});

test("parseUserPayload and parseProfilePayload accept plain JSON bodies", () => {
  const userPayload = parseUserPayload({
    firstName: "Claire",
    lastName: "Martin",
    email: "claire.martin@concept.local",
    jobTitle: "Commerciale",
    departmentCode: "COMMERCIAL",
    role: "COMMERCIAL",
    status: "ACTIVE",
    avatarUrl: null,
    phone: "0600000000",
    language: "fr-FR",
    timezone: "Europe/Paris"
  });

  const profilePayload = parseProfilePayload({
    firstName: "Claire",
    lastName: "Martin",
    email: "claire.martin@concept.local",
    jobTitle: "Commerciale",
    departmentCode: "COMMERCIAL",
    avatarUrl: null,
    phone: "0600000000",
    language: "fr-FR",
    timezone: "Europe/Paris"
  });

  assert.equal(userPayload.role, "COMMERCIAL");
  assert.equal(profilePayload.departmentCode, "COMMERCIAL");
});

test("validateProfileUpdateInput keeps role and status out of editable profile data", () => {
  const normalized = validateProfileUpdateInput({
    firstName: "Isabelle",
    lastName: "Moreau",
    email: "isabelle.moreau@concept.local",
    jobTitle: "Direction generale",
    departmentCode: "DIRECTION_GENERALE",
    avatarUrl: null,
    phone: null,
    language: "fr-FR",
    timezone: "Europe/Paris"
  });

  assert.equal(normalized.displayName, "Isabelle Moreau");
  assert.equal("role" in normalized, false);
  assert.equal("status" in normalized, false);
});
