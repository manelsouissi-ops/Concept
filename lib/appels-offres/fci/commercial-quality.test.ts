import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FciCommercialPayload } from "./ai-contracts.ts";
import {
  applyCommercialGenerationGuardrails,
  extractCommercialShortlistFromMarkdown
} from "./commercial-quality.ts";
import { getFciModuleDefinition } from "./rendering.ts";

const shortlistMarkdown = `
La présente DP a été adressée aux Consultants inscrits sur la liste restreinte, dont les noms figurent ci-après :

| N° | Nom du Consultant ou Firme | Pays | Adresse |
|---|---|---|---|
| 1 | SEURECA-VEOLIA | France | Paris |
| 2 | Groupement TERRABO IC/SETEC | Côte d'Ivoire | Abidjan |
| 3 | Groupement IGIP AFRIQUE/GITECH-IGIP/CONCEPT AFRICA/CONCEPT SA | Bénin | Cotonou |
| 4 | Groupement TAEP EUROPE/GAUFF CONSULTANT AFRIQUE/CTH | France | Paris |
| 5 | Groupement ARTELIA CI/SONED AFRIQUE/ARTELIA PASSION & SOLUTION/SHERE | France | Abidjan |
| 6 | Groupement HELVOS/INGEROP | Suisse | Genève |
| 7 | Groupement CIRA/ECTP | Mali | Bamako |

Section suivante
`;

function sampleCommercial() {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), "ai/examples/fci-commercial.sample.json"), "utf8")
  ) as FciCommercialPayload;
}

test("explicit CDC shortlist produces seven factual competitor rows and retains CONCEPT", () => {
  const entries = extractCommercialShortlistFromMarkdown(shortlistMarkdown);
  assert.equal(entries.length, 7);
  assert.equal(entries.some((entry) => entry.name.includes("CONCEPT AFRICA/CONCEPT SA")), true);

  const guarded = applyCommercialGenerationGuardrails(sampleCommercial(), {
    shortlistedConsultants: entries
  });
  assert.equal(guarded.data.concurrents_premiere_lecture.length, 7);
  assert.equal(
    guarded.data.concurrents_premiere_lecture.some((row) =>
      row.nom_du_concurrent.value?.includes("CONCEPT AFRICA/CONCEPT SA")
    ),
    true
  );
});

test("no explicit shortlist produces no fabricated competitors", () => {
  assert.deepEqual(extractCommercialShortlistFromMarkdown("CDC sans liste de consultants."), []);
  const guarded = applyCommercialGenerationGuardrails(sampleCommercial(), {
    shortlistedConsultants: []
  });
  assert.deepEqual(guarded.data.concurrents_premiere_lecture, []);
});

test("commercial guardrails blank prose transit and preserve integer days", () => {
  const prose = sampleCommercial();
  (prose.data.points_logistiques_internes.delai_de_transit_necessaire as { value: unknown }).value =
    "Déposer avant le 16/10/2025";
  const blanked = applyCommercialGenerationGuardrails(prose, { shortlistedConsultants: [] });
  assert.equal(blanked.data.points_logistiques_internes.delai_de_transit_necessaire.value, null);

  const numeric = sampleCommercial();
  numeric.data.points_logistiques_internes.delai_de_transit_necessaire.value = 3;
  const preserved = applyCommercialGenerationGuardrails(numeric, { shortlistedConsultants: [] });
  assert.equal(preserved.data.points_logistiques_internes.delai_de_transit_necessaire.value, 3);
});

test("CDC requirements cannot become an unsupported CONCEPT differentiator", () => {
  const payload = sampleCommercial();
  payload.data.positionnement_offre.notre_avantage_differentiel_principal = {
    value: "CONCEPT maîtrise les projets AEP complexes.",
    source_type: "ai_inference",
    confidence: "high",
    requires_human_input: false,
    justification: "Exigences du CDC",
    source_references: []
  };
  const guarded = applyCommercialGenerationGuardrails(payload, { shortlistedConsultants: [] });
  const differentiator = guarded.data.positionnement_offre.notre_avantage_differentiel_principal;
  assert.equal(differentiator.value, null);
  assert.equal(differentiator.source_type, "internal_required");
  assert.equal(differentiator.requires_human_input, true);
});

test("active FCI A contract and specialized UI contain no GO or operations-only field", () => {
  const prompt = readFileSync(path.join(process.cwd(), "ai/prompts/fci-commercial.md"), "utf8");
  const schema = readFileSync(path.join(process.cwd(), "ai/schemas/fci-commercial.schema.json"), "utf8");
  assert.equal(schema.includes("recommandation_revue_commerciale"), false);
  assert.equal(schema.includes("risques_client"), false);
  assert.equal(schema.includes("autres_contraintes_internes"), false);
  assert.match(prompt, /ne contient aucune recommandation finale GO\/NO-GO/i);

  const definition = getFciModuleDefinition("A");
  assert.ok(definition);
  const visiblePaths = new Set(
    definition.sections.flatMap((section) =>
      section.fields.map((field) => `${section.key}.${field.key}`)
    )
  );
  assert.equal(visiblePaths.has("a1_concurrents.nom"), true);
  assert.equal(visiblePaths.has("a2_positionnement.avantage_differentiel"), true);
  assert.equal(visiblePaths.has("a3_logistique_interne.delai_transit_jours"), true);
});

test("human-owned commercial fields stay null and human-required", () => {
  const guarded = applyCommercialGenerationGuardrails(sampleCommercial(), {
    shortlistedConsultants: []
  });
  const data = guarded.data;
  for (const field of [
    data.identification_opportunite.prepare_par,
    data.identification_opportunite.valide_par,
    data.positionnement_offre.notre_avantage_differentiel_principal,
    data.positionnement_offre.niveau_de_prix_cible_estime,
    data.points_logistiques_internes.responsable_depot,
    data.points_logistiques_internes.representation_locale_existante
  ]) {
    assert.equal(field.value, null);
    assert.equal(field.requires_human_input, true);
  }
});
