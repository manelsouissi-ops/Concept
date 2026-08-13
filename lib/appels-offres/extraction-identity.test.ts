import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExtractionIdentityPreview,
  pickIdentityFieldsFromExtraction
} from "./repository.ts";
import type { ExtractionField } from "../types.ts";

function field(key: string, value: string): ExtractionField {
  return { key: key as ExtractionField["key"], label: key, value, source: "Page 1" };
}

function fullExtraction(): ExtractionField[] {
  return [
    field("reference_officielle", "AO-2026-0451"),
    field("intitule_mission", "Etude d'assainissement de la zone urbaine"),
    field("client_maitre_ouvrage", "Ministere de l'Hydraulique"),
    field("pays", "Senegal"),
    field("date_limite_depot", "15 mars 2026"),
    field("zone_execution", "Non trouve")
  ];
}

// A. Successful flow: a full extraction maps every tender-identity field.
test("pickIdentityFieldsFromExtraction reads the five tender-identity fields by key", () => {
  const picked = pickIdentityFieldsFromExtraction(fullExtraction());

  assert.equal(picked.title, "Etude d'assainissement de la zone urbaine");
  assert.equal(picked.buyer, "Ministere de l'Hydraulique");
  assert.equal(picked.country, "Senegal");
  assert.equal(picked.deadline, "15 mars 2026");
  assert.equal(picked.reference, "AO-2026-0451");
});

test("buildExtractionIdentityPreview marks every detected field and parses the deadline", () => {
  const preview = buildExtractionIdentityPreview(fullExtraction());

  assert.equal(preview.title.detected, true);
  assert.equal(preview.title.value, "Etude d'assainissement de la zone urbaine");
  assert.equal(preview.buyer.detected, true);
  assert.equal(preview.country.detected, true);
  assert.equal(preview.country.value, "Senegal");
  assert.equal(preview.reference.detected, true);

  assert.equal(preview.dueDate.detected, true);
  assert.equal(preview.dueDate.parsedDate, "2026-03-15");
  assert.equal(preview.dueDate.value, "15 mars 2026");
});

// B. Partial extraction: fields the LLM could not find ("Non trouve") must
// read as not detected, never as an invented value - and a field missing
// from the extraction array entirely behaves the same way.
test("buildExtractionIdentityPreview reports 'Non trouve' and missing fields as not detected, never inventing a value", () => {
  const partial: ExtractionField[] = [
    field("intitule_mission", "Rehabilitation du reseau routier"),
    field("client_maitre_ouvrage", "Non trouve"),
    field("pays", "Non trouve"),
    field("date_limite_depot", "Non trouve")
    // reference_officielle is entirely absent from the extraction.
  ];

  const preview = buildExtractionIdentityPreview(partial);

  assert.equal(preview.title.detected, true);
  assert.equal(preview.title.value, "Rehabilitation du reseau routier");

  assert.equal(preview.buyer.detected, false);
  assert.equal(preview.buyer.value, "");
  assert.equal(preview.country.detected, false);
  assert.equal(preview.reference.detected, false);
  assert.equal(preview.reference.value, "");

  assert.equal(preview.dueDate.detected, false);
  assert.equal(preview.dueDate.parsedDate, null);
});

// C/free-text deadline: the LLM is instructed to copy dates verbatim rather
// than normalize them, so a deadline that isn't an unambiguous calendar date
// must surface as "not detected" (raw text still shown) instead of a guess.
test("buildExtractionIdentityPreview never guesses a due date from ambiguous free text", () => {
  const preview = buildExtractionIdentityPreview([
    field("date_limite_depot", "Des reception du dossier complet par voie electronique")
  ]);

  assert.equal(preview.dueDate.detected, false);
  assert.equal(preview.dueDate.parsedDate, null);
  assert.equal(preview.dueDate.value, "Des reception du dossier complet par voie electronique");
});

// An empty extraction (e.g. a stale/failed generation) must produce an
// entirely "not detected" preview - a safe empty state, not an error.
test("buildExtractionIdentityPreview handles an empty extraction safely", () => {
  const preview = buildExtractionIdentityPreview([]);

  for (const key of ["title", "buyer", "country", "reference"] as const) {
    assert.equal(preview[key].detected, false);
    assert.equal(preview[key].value, "");
  }
  assert.equal(preview.dueDate.detected, false);
  assert.equal(preview.dueDate.parsedDate, null);
});

// G. This preview is purely a read model: it must not be confused with the
// validated-extraction writer. Callers only ever get plain data back, never
// a side effect - so building a preview cannot accidentally validate the
// Fiche CDC or touch any persisted state.
test("buildExtractionIdentityPreview is a pure function with no persistence side effects", () => {
  const extraction = fullExtraction();
  const before = JSON.stringify(extraction);

  const preview1 = buildExtractionIdentityPreview(extraction);
  const preview2 = buildExtractionIdentityPreview(extraction);

  assert.equal(JSON.stringify(extraction), before, "input extraction must not be mutated");
  assert.deepEqual(preview1, preview2, "calling it twice must be perfectly idempotent");
});
