import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  createEmptyFciModulePayload,
  type FciFormField,
  type FciFormPayload
} from "./rendering.ts";
import type { FciAiSupportedModuleCode } from "./ai-contracts.ts";
import type { FciModulePresentation } from "./presentation.ts";
import { buildFciExportFileName } from "./export/filenames.ts";
import { buildFciExportSource } from "./export/mapping.ts";
import {
  buildDocxExportInstruction,
  cleanupExportTempDir,
  generateFciDocxArtifact,
  runDocxExportInstruction
} from "./export/docx-exporter.ts";
import { generateFciExportArtifact, parseFciExportFormat, FciExportError } from "./export/index.ts";
import { convertDocxToPdf, FciPdfConversionError } from "./export/pdf-converter.ts";
import { getFciTemplatePath } from "./export/templates.ts";

function fillField<TValue>(field: FciFormField, value: TValue): FciFormField {
  return {
    ...field,
    value,
    source: "human",
    review_status: "reviewed",
    confidence: value == null ? "none" : "high"
  } as FciFormField;
}

function setObjectField(
  payload: FciFormPayload,
  sectionKey: string,
  fieldKey: string,
  value: unknown
) {
  const section = payload.data[sectionKey] as Record<string, FciFormField>;
  section[fieldKey] = fillField(section[fieldKey], value);
}

function createRow(values: Record<string, unknown>) {
  const row: Record<string, unknown> = {
    row_id: `row-${Math.random().toString(36).slice(2, 8)}`
  };
  for (const [key, value] of Object.entries(values)) {
    row[key] = {
      value: value as string | number | boolean | string[] | null,
      source: "human",
      review_status: "reviewed",
      confidence: value == null ? "none" : "high",
      justification: "Fixture export.",
      source_references: []
    } satisfies FciFormField;
  }
  return row;
}

function createBasePayload(moduleCode: FciAiSupportedModuleCode) {
  const payload = createEmptyFciModulePayload(moduleCode, {
    codeInterne: "AO-20260727-0945",
    intituleOffre: "Mission de demonstration FCI",
    dateDepot: "2026-07-30",
    sourceFiche: {
      code_interne: "AO-20260727-0945",
      version: "validated:v1",
      hash: "hash-fixture",
      status: "validated",
      validated_at: "2026-07-30T10:30:00.000Z"
    }
  });

  setObjectField(payload, "identification_commune", "prepared_by_name", "Bob Durand");
  setObjectField(payload, "identification_commune", "validated_by_name", "Alice Martin");
  return payload;
}

function buildPayloadFixture(moduleCode: FciAiSupportedModuleCode) {
  const payload = createBasePayload(moduleCode);

  if (moduleCode === "A") {
    payload.data.a1_concurrents = [
      createRow({
        nom: "HydroPlan",
        pays: "Burkina Faso",
        points_forts_connus: "Bonne relation locale",
        historique_client: "Deja titulaire en 2024",
        avantage_principal: "Equipe deja mobilisable",
        risque_represente: "Prix agressif"
      }),
      createRow({
        nom: "GeoInfra",
        pays: "Cote d'Ivoire",
        points_forts_connus: "Base geotechnique solide",
        historique_client: "Mission proche en 2025",
        avantage_principal: "Methodologie terrain robuste",
        risque_represente: "Peut sous-coter les moyens"
      })
    ];
    setObjectField(payload, "a2_positionnement", "avantage_differentiel", "Presence regionale et references proches.");
    setObjectField(payload, "a2_positionnement", "vulnerabilite_principale", "Disponibilite de certains experts a confirmer.");
    setObjectField(payload, "a2_positionnement", "niveau_prix_cible", "1 250 000 000 FCFA");
    setObjectField(payload, "a3_logistique_interne", "delai_transit_jours", 4);
    setObjectField(payload, "a3_logistique_interne", "responsable_depot", "Mariam Ouattara");
    setObjectField(payload, "a3_logistique_interne", "representation_locale_existante", true);
    setObjectField(payload, "a3_logistique_interne", "representation_locale_details", "Bureau local actif depuis 2021.");
  }

  if (moduleCode === "B") {
    setObjectField(payload, "b1_elements_financiers", "budget_estime_marche", "950 000 EUR");
    setObjectField(payload, "b1_elements_financiers", "budget_estime_source", "Benchmark AO similaires 2024-2025");
    setObjectField(payload, "b1_elements_financiers", "taux_change", "1 EUR = 655,957 FCFA (BCEAO)");
    setObjectField(payload, "b1_elements_financiers", "coefficient_charges_structure", "12");
    setObjectField(payload, "b1_elements_financiers", "marge_cible", "15");
    payload.data.b2_jalons_cash_flow = [
      createRow({
        jalon_livrable: "Rapport de demarrage",
        pourcentage_montant: "20",
        delai_paiement_estime: "30 jours",
        risque_cash_flow: "Risque modere si validation client lente."
      })
    ];
    setObjectField(
      payload,
      "b3_synthese_financiere",
      "commentaires_generaux",
      "Maintenir une avance de tresorerie prudente sur les trois premiers mois."
    );
  }

  if (moduleCode === "C") {
    payload.data.c1_ressources_cles = [
      createRow({
        poste_expert: "Chef de mission",
        volume_demande_cdc: "12 hm",
        volume_reel_previsionnel: 14,
        suppleant: "Adjoint senior",
        volume_previsionnel_suppleant: 6,
        probabilite_disponibilite: "elevee",
        action_requise: "Bloquer le planning avant fin de semaine."
      })
    ];
    payload.data.c2_ressources_non_cles = [
      createRow({
        poste_expert: "Topographe",
        volume_previsionnel: 8,
        probabilite_disponibilite: "moyenne",
        action_requise: "Prevoir un vivier local."
      })
    ];
    payload.data.c3_moyens_capacite = [
      createRow({
        designation: "Vehicule 4x4",
        quantite_requise: 3,
        quantite_disponible: 2,
        membre_apporteur: "Concept",
        disponible_demarrage: true,
        ecart: 1
      })
    ];
    payload.data.c4_repartition_roles = [
      createRow({
        composante_tache: "Leves terrain",
        membre_responsable: "Concept",
        experts_affectes: "Topographe, logisticien",
        effort_client_vs_concept: "Client 10 j / Concept 15 j",
        commentaire_risque: "Coordination forte a maintenir."
      })
    ];
    setObjectField(payload, "c5_risques_coordination", "partenaires_non_eprouves", "Partenaire SIG jamais mobilise sur ce client.");
    setObjectField(payload, "c5_risques_coordination", "frequence_reunions_coordination", "Hebdomadaire");
    setObjectField(payload, "c5_risques_coordination", "penalites_internes_groupement", "Oui, a formaliser dans l'accord.");
    setObjectField(payload, "c5_risques_coordination", "controle_qualite_livrables", "Relecture croisee par le chef de file.");
    setObjectField(payload, "c5_risques_coordination", "risques_vis_a_vis_partenaires", "Risque de decalage calendrier.");
    setObjectField(payload, "c5_risques_coordination", "risques_consultants_externes", "Disponibilite des consultants a confirmer.");
    setObjectField(payload, "rex_projet_reference", "identite", "AO-2024-017 / Client Eau / Niger");
    setObjectField(payload, "rex_projet_reference", "niveau_similitude", "tres_similaire");
    setObjectField(payload, "rex_projet_reference", "differences_cles", "Perimetre geographique plus etendu ici.");
    setObjectField(payload, "rex_ecarts_couts", "postes_sous_estimes", "Carburant et per diem.");
    setObjectField(payload, "rex_ecarts_couts", "postes_surestimes", "Location equipements.");
    setObjectField(payload, "rex_ecarts_couts", "depassement_budgetaire", "8 % sur les missions terrain.");
    setObjectField(payload, "rex_standards_client", "standards_techniques", "Verifier les normes hydrauliques locales.");
    setObjectField(payload, "rex_standards_client", "habitudes_validation", "Deux cycles de revue minimum.");
    setObjectField(payload, "rex_standards_client", "risque_methodologie_non_adaptee", "Adapter les modeles de rapport au client.");
    setObjectField(payload, "rex_recommandations", "ajustements_dimensionnement", "Renforcer le lot topographie.");
    setObjectField(payload, "rex_recommandations", "points_vigilance_prioritaires", "Mobilisation, transport, validation.");
    setObjectField(payload, "rex_recommandations", "bonnes_pratiques", "Maintenir une coordination hebdomadaire stricte.");
  }

  if (moduleCode === "D") {
    setObjectField(payload, "d1_valeur_strategique", "programme_pluriannuel", true);
    setObjectField(payload, "d1_valeur_strategique", "programme_pluriannuel_details", "Deux phases complementaires attendues.");
    setObjectField(payload, "d1_valeur_strategique", "valeur_futurs_lots", "Environ 2 M EUR sur 24 mois.");
    setObjectField(payload, "d1_valeur_strategique", "positionnement_geographique", "Consolider la presence au Sahel.");
    setObjectField(payload, "d1_valeur_strategique", "valeur_reference", "Reference majeure en hydraulique.");
    setObjectField(payload, "d2_enjeux_reputationnels", "risque_sous_performance", "Impact fort sur les prequalifications.");
    setObjectField(payload, "d2_enjeux_reputationnels", "risque_perte", "Signal negatif sur ce segment.");
    setObjectField(payload, "d2_enjeux_reputationnels", "valeur_test_apprentissage", "Montage utile pour futurs groupements.");
    setObjectField(payload, "d3_decision_preliminaire", "importance_strategique_globale", "critique");
    setObjectField(payload, "d3_decision_preliminaire", "marche_prioritaire_direction", "sous_conditions");
    setObjectField(payload, "d3_decision_preliminaire", "conditions_priorisation", "Sous reserve de securiser le chef de mission.");
    setObjectField(payload, "d3_decision_preliminaire", "commentaires_strategiques", "Dossier a forte valeur reference, mais exposition execution sensible.");
  }

  return payload;
}

function buildModulePresentationFixture(
  moduleCode: FciAiSupportedModuleCode,
  status: FciModulePresentation["module"]["status"] = "needs_review"
): FciModulePresentation {
  const payload = buildPayloadFixture(moduleCode);
  const id = { A: 11, B: 12, C: 13, D: 14 }[moduleCode];
  const department = { A: "DC", B: "DF", C: "DO", D: "DG" }[moduleCode];
  const title = {
    A: "Direction Commerciale",
    B: "Direction Financiere",
    C: "Direction Operationnelle",
    D: "Direction Generale"
  }[moduleCode];

  return {
    appel_offres: {
      code: "AO-20260727-0945",
      title: "Mission de demonstration FCI",
      due_date: "2026-07-30"
    },
    module: {
      id,
      module_code: moduleCode,
      module_type:
        moduleCode === "A"
          ? "commercial"
          : moduleCode === "B"
            ? "finance"
            : moduleCode === "C"
              ? "operations"
              : "strategy",
      department_code: department,
      department_label: title,
      title,
      status,
      form_status: status === "validated" ? "completed" : "ready_for_review",
      ai_generated_at: "2026-07-30T10:00:00.000Z",
      validated_at: status === "validated" ? "2026-07-30T11:00:00.000Z" : null,
      validated_by: status === "validated" ? "Alice Martin" : null,
      error_code: null,
      error_message: null,
      created_at: "2026-07-30T09:00:00.000Z",
      updated_at: "2026-07-30T11:05:00.000Z"
    },
    latest_data: {
      version: 2,
      data: payload,
      source_summary: {
        source_fiche_version: payload.source_fiche.version,
        source_fiche_hash: payload.source_fiche.hash
      },
      confidence: null,
      ai_notes: null,
      generated_from_fiche_version: payload.source_fiche.version,
      generated_from_fiche_hash: payload.source_fiche.hash,
      created_at: "2026-07-30T10:00:00.000Z",
      updated_at: "2026-07-30T10:30:00.000Z"
    },
    completion: {
      filled: 10,
      total: 10,
      percentage: 100,
      human_inputs_required: 0,
      ready_for_completion: true
    },
    generation_job: null,
    source_fiche: {
      available: true,
      status: "validated",
      is_validated: true,
      version: payload.source_fiche.version,
      updated_at: "2026-07-30T10:30:00.000Z",
      hash: payload.source_fiche.hash
    },
    stale_source: false,
    allowed_actions: ["edit", "validate", "regenerate", "view_history"],
    history_summary: {
      versions_count: 2,
      jobs_count: 1,
      audit_events_count: 3,
      latest_version: 2,
      latest_job_status: "completed"
    }
  };
}

function inspectDocx(docxPath: string) {
  const script = `
import json, zipfile, sys
from xml.etree import ElementTree as ET
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
out={}
with zipfile.ZipFile(sys.argv[1]) as zf:
    out['entries']=zf.namelist()
    for name in ['word/document.xml','word/header1.xml']:
        if name in out['entries']:
            root=ET.fromstring(zf.read(name))
            texts=[]
            for p in root.findall('.//w:p', ns):
                parts=[t.text or '' for t in p.findall('.//w:t', ns)]
                txt=''.join(parts).strip()
                if txt:
                    texts.append(' '.join(txt.split()))
            out[name]=texts
print(json.dumps(out, ensure_ascii=False))
`;
  const result = spawnSync("python", ["-c", script, docxPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8"
    }
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout) as {
    entries: string[];
    "word/document.xml"?: string[];
    "word/header1.xml"?: string[];
  };
}

test("parseFciExportFormat accepts only docx and pdf", () => {
  assert.equal(parseFciExportFormat("docx"), "docx");
  assert.equal(parseFciExportFormat("pdf"), "pdf");
  assert.throws(() => parseFciExportFormat("zip"), FciExportError);
});

test("draft filenames include BROUILLON and completed filenames do not", () => {
  const draft = buildFciExportFileName(
    buildFciExportSource(buildModulePresentationFixture("A", "needs_review")),
    "docx",
    new Date("2026-07-30T12:00:00.000Z")
  );
  const completed = buildFciExportFileName(
    buildFciExportSource(buildModulePresentationFixture("A", "validated")),
    "pdf",
    new Date("2026-07-30T12:00:00.000Z")
  );

  assert.match(draft, /BROUILLON\.docx$/);
  assert.doesNotMatch(completed, /BROUILLON/);
  assert.match(completed, /\.pdf$/);
});

test("module A DOCX export preserves template structure and writes mapped values", async () => {
  const beforeTemplate = readFileSync(getFciTemplatePath("A"));
  const presentation = buildModulePresentationFixture("A", "needs_review");
  const source = buildFciExportSource(presentation);
  const { docxPath, tempDir } = await generateFciDocxArtifact(source);

  try {
    const inspection = inspectDocx(docxPath);
    assert.ok(inspection.entries.includes("word/document.xml"));
    assert.ok(
      inspection["word/document.xml"]?.some((line) => line.includes("HydroPlan"))
    );
    assert.ok(
      inspection["word/document.xml"]?.some((line) => line.includes("Oui"))
    );
    assert.ok(
      inspection["word/header1.xml"]?.some((line) => line.includes("BROUILLON"))
    );
  } finally {
    await cleanupExportTempDir(tempDir);
  }

  const afterTemplate = readFileSync(getFciTemplatePath("A"));
  assert.deepEqual(afterTemplate, beforeTemplate);
});

test("module B DOCX export formats percentages and financial synthesis", async () => {
  const source = buildFciExportSource(buildModulePresentationFixture("B", "validated"));
  const { docxPath, tempDir } = await generateFciDocxArtifact(source);

  try {
    const inspection = inspectDocx(docxPath);
    assert.ok(
      inspection["word/document.xml"]?.some((line) => line.includes("15 %"))
    );
    assert.ok(
      inspection["word/document.xml"]?.some((line) =>
        line.includes("Maintenir une avance de tresorerie prudente")
      )
    );
  } finally {
    await cleanupExportTempDir(tempDir);
  }
});

test("module C DOCX export includes repeatable rows and return-of-experience sections", async () => {
  const source = buildFciExportSource(buildModulePresentationFixture("C", "needs_review"));
  const { docxPath, tempDir } = await generateFciDocxArtifact(source);

  try {
    const inspection = inspectDocx(docxPath);
    assert.ok(
      inspection["word/document.xml"]?.some((line) => line.includes("Vehicule 4x4"))
    );
    assert.ok(
      inspection["word/document.xml"]?.some((line) => line.includes("AO-2024-017"))
    );
    assert.ok(
      inspection["word/document.xml"]?.some((line) => line.includes("Tres similaire"))
    );
  } finally {
    await cleanupExportTempDir(tempDir);
  }
});

test("module D DOCX export uses French enum labels and combined conditional fields", async () => {
  const source = buildFciExportSource(buildModulePresentationFixture("D", "validated"));
  const { docxPath, tempDir } = await generateFciDocxArtifact(source);

  try {
    const inspection = inspectDocx(docxPath);
    assert.ok(
      inspection["word/document.xml"]?.some((line) => line.includes("Critique"))
    );
    assert.ok(
      inspection["word/document.xml"]?.some((line) => line.includes("Sous conditions"))
    );
  } finally {
    await cleanupExportTempDir(tempDir);
  }
});

test("empty repeatable tables render a clear placeholder instead of raw JSON", async () => {
  const presentation = buildModulePresentationFixture("B", "needs_review");
  const payload = presentation.latest_data?.data as FciFormPayload;
  payload.data.b2_jalons_cash_flow = [];
  const source = buildFciExportSource(presentation);
  const { docxPath, tempDir } = await generateFciDocxArtifact(source);

  try {
    const inspection = inspectDocx(docxPath);
    assert.ok(
      inspection["word/document.xml"]?.some((line) => line.includes("Non renseigné"))
    );
  } finally {
    await cleanupExportTempDir(tempDir);
  }
});

test("missing latest FCI data is rejected before export", async () => {
  const presentation = buildModulePresentationFixture("A", "needs_review");
  presentation.latest_data = null;
  await assert.rejects(
    () => generateFciExportArtifact(presentation, "docx"),
    (error: unknown) =>
      error instanceof FciExportError
      && error.code === "FCI_EXPORT_DATA_NOT_FOUND"
  );
});

test("unsupported module export is rejected safely", async () => {
  const presentation = buildModulePresentationFixture("A", "needs_review") as unknown as FciModulePresentation;
  presentation.module.module_code = "E" as never;
  await assert.rejects(
    () => generateFciExportArtifact(presentation, "docx"),
    (error: unknown) =>
      error instanceof FciExportError
      && error.code === "FCI_EXPORT_MODULE_UNSUPPORTED"
  );
});

test("template structure mismatches fail safely", async () => {
  const presentation = buildModulePresentationFixture("A", "needs_review");
  const source = buildFciExportSource(presentation);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "concept-fci-test-"));
  const outputPath = path.join(tempDir, "broken.docx");
  const instruction = buildDocxExportInstruction(source, outputPath);
  instruction.repeatableTables[0].header = ["Entete introuvable"];

  try {
    await assert.rejects(
      () => runDocxExportInstruction(instruction, tempDir),
      /introuvable/i
    );
  } finally {
    await cleanupExportTempDir(tempDir);
  }
});

test("PDF conversion reports an explicit error when no converter is available", async () => {
  await assert.rejects(
    () => convertDocxToPdf("dummy.docx", os.tmpdir(), { converter: null }),
    (error: unknown) =>
      error instanceof FciPdfConversionError
      && error.code === "PDF_CONVERTER_UNAVAILABLE"
      && error.message === "L’export PDF n’est pas disponible sur cet environnement. Le téléchargement Word reste disponible."
  );
});

test("PDF conversion can succeed with an injected converter runner", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "concept-fci-pdf-"));
  const inputPath = path.join(tempDir, "sample.docx");
  await fs.writeFile(inputPath, "docx-placeholder", "utf8");

  try {
    const result = await convertDocxToPdf(inputPath, tempDir, {
      converter: {
        kind: "word",
        executablePath: "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE"
      },
      runner: async () => {
        const outputPath = path.join(tempDir, "sample.pdf");
        await fs.writeFile(outputPath, Buffer.from("%PDF-1.4\n"), "utf8");
        return { stdout: "", stderr: "" };
      }
    });

    assert.equal(result.converterKind, "word");
    const pdfBuffer = await fs.readFile(result.outputPath);
    assert.ok(pdfBuffer.length > 0);
  } finally {
    await cleanupExportTempDir(tempDir);
  }
});
