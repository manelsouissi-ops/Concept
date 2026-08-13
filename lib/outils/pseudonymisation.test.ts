import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  MAX_PSEUDONYMISATION_INPUT_LENGTH,
  PseudonymisationInputError,
  pseudonymiseText
} from "./pseudonymisation.ts";

function detectionFor(result: ReturnType<typeof pseudonymiseText>, originalValue: string) {
  return result.detections.find((detection) => detection.originalValue === originalValue);
}

// D. Email addresses are replaced with a deterministic EMAIL_xxx alias.
test("pseudonymiseText replaces an email address with EMAIL_001", () => {
  const result = pseudonymiseText("Contact: claire.martin@concept.local pour toute question.");

  assert.match(result.pseudonymisedText, /Contact: EMAIL_001 pour toute question\./);
  assert.equal(detectionFor(result, "claire.martin@concept.local")?.alias, "EMAIL_001");
  assert.equal(detectionFor(result, "claire.martin@concept.local")?.category, "EMAIL");
});

// E. Phone numbers (international and local French formats) are replaced.
test("pseudonymiseText replaces phone numbers with TELEPHONE_xxx", () => {
  const result = pseudonymiseText("Joignable au +33 6 11 22 33 44 ou au 01 23 45 67 89.");

  assert.match(result.pseudonymisedText, /Joignable au TELEPHONE_001 ou au TELEPHONE_002\./);
  assert.equal(result.detections.filter((detection) => detection.category === "TELEPHONE").length, 2);
});

// F. Tender/reference identifiers are replaced.
test("pseudonymiseText replaces a tender reference with REFERENCE_001", () => {
  const result = pseudonymiseText("Reference: CI-PARU-365151-CS-QCBS/003/2024.");

  assert.match(result.pseudonymisedText, /Reference: REFERENCE_001\./);
  assert.equal(detectionFor(result, "CI-PARU-365151-CS-QCBS/003/2024")?.category, "REFERENCE");
});

// G. Deterministic mapping: the same value repeated in the same input must
// resolve to the same alias, never a second distinct one.
test("pseudonymiseText maps a repeated value to the same alias within one run", () => {
  const result = pseudonymiseText("Claire Martin a signe le document. Claire Martin confirmera la reception.");

  const occurrencesOfAlias = result.pseudonymisedText.match(/PERSONNE_001/g) ?? [];
  assert.equal(occurrencesOfAlias.length, 2);
  assert.equal(result.pseudonymisedText.includes("PERSONNE_002"), false);

  const detection = detectionFor(result, "Claire Martin");
  assert.equal(detection?.alias, "PERSONNE_001");
  assert.equal(detection?.occurrences, 2);
});

// H. Different values receive different aliases, in order of first appearance.
test("pseudonymiseText assigns distinct aliases to distinct values in the same category", () => {
  const result = pseudonymiseText("Claire Martin a transmis le dossier a Paul Diallo.");

  assert.equal(detectionFor(result, "Claire Martin")?.alias, "PERSONNE_001");
  assert.equal(detectionFor(result, "Paul Diallo")?.alias, "PERSONNE_002");
});

// J. Empty input produces a clean validation error, not a crash.
test("pseudonymiseText rejects empty input with a business-friendly message", () => {
  assert.throws(
    () => pseudonymiseText(""),
    (error: unknown) =>
      error instanceof PseudonymisationInputError && error.message === "Aucun texte à pseudonymiser."
  );

  assert.throws(
    () => pseudonymiseText("   \n  "),
    (error: unknown) =>
      error instanceof PseudonymisationInputError && error.message === "Aucun texte à pseudonymiser."
  );
});

test("pseudonymiseText rejects input above the size limit with a business-friendly message", () => {
  const oversized = "a".repeat(MAX_PSEUDONYMISATION_INPUT_LENGTH + 1);

  assert.throws(
    () => pseudonymiseText(oversized),
    (error: unknown) =>
      error instanceof PseudonymisationInputError && error.message === "Le document est trop volumineux."
  );
});

test("pseudonymiseText excludes a detection from substitution when its key is passed as excluded", () => {
  const first = pseudonymiseText("Contact: Claire Martin, claire.martin@concept.local.");
  const personKey = detectionFor(first, "Claire Martin")?.key;
  assert.ok(personKey);

  const second = pseudonymiseText(
    "Contact: Claire Martin, claire.martin@concept.local.",
    new Set([personKey!])
  );

  assert.match(second.pseudonymisedText, /Contact: Claire Martin, EMAIL_001\./);
  assert.equal(detectionFor(second, "Claire Martin")?.included, false);
});

test("pseudonymiseText is a pure function with no side effects and no I/O", () => {
  const input = "Claire Martin, claire.martin@concept.local, +33 6 11 22 33 44.";
  const before = input;

  const first = pseudonymiseText(input);
  const secondRun = pseudonymiseText(input);

  assert.equal(input, before, "input string must not be mutated");
  assert.deepEqual(first, secondRun, "calling it twice must be perfectly idempotent");
});

test("pseudonymiseText detects an organisation/client name", () => {
  const result = pseudonymiseText("Client: AGEROUTE Sénégal, dossier en cours.");

  assert.equal(detectionFor(result, "AGEROUTE Sénégal")?.category, "ORGANISATION");
  assert.match(result.pseudonymisedText, /Client: ORGANISATION_001, dossier en cours\./);
});

test("pseudonymiseText detects a contract/account identifier via a keyword-anchored match", () => {
  const result = pseudonymiseText("Merci de vous referer au contrat n° CT-2024-118 pour toute question.");

  assert.equal(detectionFor(result, "CT-2024-118")?.category, "CONTRAT");
  assert.match(result.pseudonymisedText, /contrat n° CONTRAT_001/);
});

// I. Pseudonymisation must never call out to a network/AI provider - it is a
// pure, local, synchronous string transform. This is a structural guard: the
// source file must contain no network primitive at all, so the property holds
// even if the implementation changes later.
test("pseudonymisation.ts contains no network call of any kind", () => {
  const source = readFileSync(path.join(import.meta.dirname, "pseudonymisation.ts"), "utf8");

  for (const forbidden of ["fetch(", "XMLHttpRequest", "axios", "http.request", "https.request"]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `pseudonymisation.ts must not reference "${forbidden}" - processing must stay fully local`
    );
  }
});
