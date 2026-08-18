import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildForCom02Document } from "./for-com-02-mapping.ts";
import type { GoNoGoReportEditablePayload } from "./types.ts";

const templatePath = path.join(process.cwd(), "lib/appels-offres/go-no-go-report/templates/FOR_COM_02_GONOGO_TEMPLATE.docx");
const exporterPath = path.join(process.cwd(), "lib/appels-offres/go-no-go-report/python_docx_report_exporter.py");

const reviewed: GoNoGoReportEditablePayload = {
  executive_summary: "Synthèse revue",
  project_overview: "Projet revu",
  commercial_summary: "AVIS COMMERCIAL REVU",
  financial_summary: "Avis finance revu",
  operational_summary: "AVIS OPERATIONS REVU",
  key_strengths: "FORCE COMMERCIALE REVUE",
  key_risks: "RISQUE CONSOLIDE REVU",
  reservations: "PLAN DE MITIGATION REVU",
  assumptions: "Hypothèse",
  unresolved_points: "Aucun",
  commercial_recommendation: "GO proposé",
  ai_recommendation: null,
  recommended_decision: "go"
};

const sourceSnapshot = {
  dossier: { code: "AO-UNIQUE-42", title: "Titre brut interdit", buyer: "Client dossier", due_date: "2026-09-01" },
  source_fiche: {
    extraction: [
      { key: "intitule_mission", value: "Titre fiche" },
      { key: "type_procedure", value: "AO OUVERT" },
      { key: "duree_totale", value: "24 mois" },
      { key: "nature_prestation", value: "Supervision" },
      { key: "phases_mission", value: "Études puis suivi" },
      { key: "methode_selection", value: "SFQC" },
      { key: "client_maitre_ouvrage", value: "CLIENT UNIQUE" },
      { key: "source_financement", value: "BANQUE UNIQUE" },
      { key: "date_limite_depot", value: "2026-09-15" },
      { key: "volume_hommes_mois", value: "36 H-M" },
      { key: "exigences_es", value: "Plan HSE" }
    ]
  },
  modules: {
    A: { data: {
      positionnement_offre: { notre_vulnerabilite_principale: { value: "FAIBLESSE A" } },
      concurrents_premiere_lecture: [{ nom_du_concurrent: { value: "CONCURRENT UNIQUE" }, pays: { value: "SN" }, risque_qu_il_represente: { value: "Prix" } }]
    } },
    B: { data: {
      elements_financiers_internes: {
        budget_estime_du_marche: { value: "10 M EUR" },
        taux_de_change_applique_et_source: { value: "1 EUR = 655 XOF" },
        coefficient_de_charges_de_structure: { value: "1.2" }
      },
      cash_flow_par_jalon: [{ jalon_livrable: { value: "Démarrage" }, delai_paiement_estime: { value: "30 jours" } }]
    } },
    C: { data: {
      capacite_absorption_globale: [{ designation_du_moyen: { value: "4x4 UNIQUE" }, quantite_requise: { value: "2" } }],
      disponibilite_des_experts_cles: [{ poste_ou_expert: { value: "CHEF UNIQUE" }, volume_travail_reel_previsionnel: { value: "12 H-M" } }],
      disponibilite_des_experts_non_cles: [{ poste_ou_expert: { value: "APPUI UNIQUE" } }],
      synthese_operations: { niveau_complexite_operationnelle: { value: "Élevé" } }
    } },
    D: { data: {
      synthese_direction: { opportunites_majeures: { value: ["OPPORTUNITE DG"] }, menaces_majeures: { value: ["MENACE DG"] } },
      decision_strategique_preliminaire: { importance_strategique_globale: { value: "CONTRIBUTION DG, PAS DECISION" } }
    } }
  }
};

function hash(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function mapDecision(status: "go" | "no_go" | "a_decider", reserves: string | null = null) {
  return buildForCom02Document({
    code: "AO-UNIQUE-42",
    title: "TITRE DOSSIER UNIQUE",
    sourceSnapshot,
    reviewed,
    decision: { version: 1, status, decision: status === "a_decider" ? null : status, rationale: "RATIONALE DG", reserves, decided_by: "Diane DG", decided_at: "2026-08-18T10:00:00Z", created_at: "2026-08-18T10:00:00Z" }
  });
}

test("FOR-COM-02 mapping gives reviewed values priority and maps validated A/B/C/D", () => {
  const result = mapDecision("go");
  assert.equal(result.fields.code, "AO-UNIQUE-42");
  assert.equal(result.fields.title, "TITRE DOSSIER UNIQUE");
  assert.equal(result.fields.duration, "24 mois");
  assert.equal(result.fields.commercialComments, "AVIS COMMERCIAL REVU");
  assert.equal(result.fields.exchangeRate, "1 EUR = 655 XOF");
  assert.equal(result.fields.operationsComments, "AVIS OPERATIONS REVU");
  assert.equal(result.fields.dgContribution, "CONTRIBUTION DG, PAS DECISION");
  assert.equal(result.fields.strengths, "FORCE COMMERCIALE REVUE");
  assert.equal(result.fields.majorRisks, "RISQUE CONSOLIDE REVU");
  assert.equal(result.tables.competitors[0][0], "CONCURRENT UNIQUE");
  assert.equal(result.tables.equipment[0][0], "4x4 UNIQUE");
  assert.equal(result.tables.keyPersonnel[0][0], "CHEF UNIQUE");
  assert.equal(result.tables.supportPersonnel[0][0], "APPUI UNIQUE");
  assert.equal(result.tables.financialResources[0][0], "1");
  assert.match(result.tables.financialResources[0][1], /Démarrage/);
  assert.doesNotMatch(JSON.stringify(result), /AUTRE-DOSSIER/);
});

test("final decision rendering distinguishes pending, GO, GO with reserves and NOGO", () => {
  assert.deepEqual(mapDecision("a_decider").decision, { go: false, goWithReserves: false, noGo: false });
  assert.deepEqual(mapDecision("go").decision, { go: true, goWithReserves: false, noGo: false });
  assert.deepEqual(mapDecision("go", "Sous réserve").decision, { go: false, goWithReserves: true, noGo: false });
  assert.deepEqual(mapDecision("no_go").decision, { go: false, goWithReserves: false, noGo: true });
});

test("renderer copies the valid master, preserves branding/layout, and never mutates it", () => {
  const before = hash(templatePath);
  const temp = mkdtempSync(path.join(os.tmpdir(), "for-com-02-test-"));
  const outputPath = path.join(temp, `${randomUUID()}.docx`);
  const instructionPath = path.join(temp, "instruction.json");
  writeFileSync(instructionPath, JSON.stringify({ outputPath, templatePath, mapping: mapDecision("go", "Sous réserve") }));
  const result = spawnSync("python3", [exporterPath, instructionPath], { encoding: "utf8" });
  try {
    assert.equal(result.status, 0, result.stderr);
    const zipTest = spawnSync("unzip", ["-t", outputPath], { encoding: "utf8" });
    assert.equal(zipTest.status, 0, zipTest.stderr);
    const document = spawnSync("unzip", ["-p", outputPath, "word/document.xml"], { encoding: "utf8" }).stdout;
    const header = spawnSync("unzip", ["-p", outputPath, "word/header1.xml"], { encoding: "utf8" }).stdout;
    assert.match(document, /AO-UNIQUE-42/);
    assert.match(document, /TITRE DOSSIER UNIQUE/);
    assert.match(document, /CLIENT UNIQUE/);
    assert.match(document, /CONCURRENT UNIQUE/);
    assert.match(document, /1 EUR = 655 XOF/);
    assert.match(document, /CHEF UNIQUE/);
    assert.match(document, /CONTRIBUTION DG, PAS DECISION/);
    assert.match(document, /Diane DG/);
    assert.match(header, /ANALYSE_OFFRE GO_NOGO/);
    assert.match(header, /FOR - COM/);
    assert.doesNotMatch(document, /handwritten|signature data/i);
    assert.equal(hash(templatePath), before);
  } finally {
    if (process.env.KEEP_FOR_COM_02_ARTIFACT === "1") {
      console.log(`FOR_COM_02_ARTIFACT=${outputPath}`);
    } else {
      rmSync(temp, { recursive: true, force: true });
    }
  }
});
