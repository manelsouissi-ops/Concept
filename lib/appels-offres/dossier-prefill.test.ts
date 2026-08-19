import assert from "node:assert/strict";
import test from "node:test";
import {
  prefillDraftDossierIdentity,
  type DossierIdentity
} from "./extraction-identity.ts";
import type { ExtractionField } from "../types.ts";

function field(key: string, value: string): ExtractionField {
  return { key: key as ExtractionField["key"], label: key, value, source: "fixture" };
}

const extracted: ExtractionField[] = [
  field("intitule_mission", "Mission extraite"),
  field("client_maitre_ouvrage", "Client extrait"),
  field("pays", "Côte d'Ivoire"),
  field("date_limite_depot", "20 avril 2026 à 12h00"),
  field("reference_officielle", "DP-2026-42")
];

type TestDossier = DossierIdentity & { notes: string };

function dossier(overrides: Partial<TestDossier> = {}): TestDossier {
  return {
    code: "AO-20260818-1044",
    title: "Titre manuel",
    buyer: "Client manuel",
    country: "France",
    dueDate: "2026-01-10",
    reference: "REF-MANUELLE",
    notes: "inchangées",
    ...overrides
  };
}

test("A - fills a blank buyer in a draft", () => {
  assert.equal(prefillDraftDossierIdentity(dossier({ buyer: "" }), extracted, "draft").buyer, "Client extrait");
});

test("B - fills a blank country in a draft", () => {
  assert.equal(prefillDraftDossierIdentity(dossier({ country: " " }), extracted, "draft").country, "Côte d'Ivoire");
});

test("C - replaces an internal-code placeholder title", () => {
  assert.equal(
    prefillDraftDossierIdentity(dossier({ title: "AO-20260818-1044" }), extracted, "draft").title,
    "Mission extraite"
  );
});

test("D - fills a blank official reference", () => {
  assert.equal(prefillDraftDossierIdentity(dossier({ reference: "" }), extracted, "draft").reference, "DP-2026-42");
});

test("E - preserves every meaningful human-entered identity value", () => {
  assert.deepEqual(prefillDraftDossierIdentity(dossier(), extracted, "draft"), dossier());
});

test("F - ignores Non trouvé placeholders", () => {
  const placeholders = [
    field("intitule_mission", "Non trouvé"),
    field("client_maitre_ouvrage", "Non trouve"),
    field("pays", "Non trouvé"),
    field("reference_officielle", "Non trouvé")
  ];
  const blank = dossier({ title: "AO-20260818-1044", buyer: "", country: "", reference: "" });
  assert.deepEqual(prefillDraftDossierIdentity(blank, placeholders, "draft"), blank);
});

test("G - does not fill a blank deadline from invalid free text", () => {
  const result = prefillDraftDossierIdentity(
    dossier({ dueDate: "" }),
    [field("date_limite_depot", "Non trouvé")],
    "draft"
  );
  assert.equal(result.dueDate, "");
});

test("H - parses and fills a valid extracted deadline", () => {
  assert.equal(prefillDraftDossierIdentity(dossier({ dueDate: "" }), extracted, "draft").dueDate, "2026-04-20");
});

test("I - a reload after save is idempotent and preserves persisted values", () => {
  const first = prefillDraftDossierIdentity(
    dossier({ title: "AO-20260818-1044", buyer: "", country: "", dueDate: "", reference: "" }),
    extracted,
    "draft"
  );
  assert.deepEqual(prefillDraftDossierIdentity(first, extracted, "draft"), first);
});

test("J - a validated Fiche never prefills or overwrites dossier fields", () => {
  const current = dossier({ title: "AO-20260818-1044", buyer: "", country: "", dueDate: "", reference: "" });
  assert.strictEqual(prefillDraftDossierIdentity(current, extracted, "validated"), current);
});

test("K - pending and ambiguous deadlines remain blank", () => {
  for (const value of ["À confirmer", "sera communiqué ultérieurement", "15/03/2026 ou 22/03/2026"]) {
    const result = prefillDraftDossierIdentity(
      dossier({ dueDate: "" }),
      [field("date_limite_depot", value)],
      "draft"
    );
    assert.equal(result.dueDate, "");
  }
});

test("L - an existing human deadline survives every extraction semantic state", () => {
  const current = dossier({ dueDate: "2026-01-10" });
  for (const value of ["20 avril 2026", "À confirmer", "Non trouvé", "15/03/2026 ou 22/03/2026"]) {
    assert.equal(
      prefillDraftDossierIdentity(current, [field("date_limite_depot", value)], "draft").dueDate,
      "2026-01-10"
    );
  }
});
