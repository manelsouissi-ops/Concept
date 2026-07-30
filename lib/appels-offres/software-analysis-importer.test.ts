import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { buildSoftwareAnalysisImportPreviewFromWorkbook } from "./software-analysis-importer.ts";
import type { SoftwareRecord } from "../administration/logiciels/types.ts";

function buildWorkbookBuffer() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Analyse"],
      [""],
      [
        "Besoin identifié dans le cahier des charges",
        "Besoin explicite ou implicite",
        "Logiciel(s) concerné(s)",
        "Niveau de nécessité",
        "Justification",
        "Risque en cas d’absence",
        "Alternative possible"
      ],
      ["Cartographie SIG", "Explicite", "QGIS", "Haute", "Analyse", "Blocage", "ArcGIS"]
    ]),
    "02_Besoins"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Analyse"],
      [""],
      [
        "Logiciel",
        "Utilité par rapport au cahier des charges",
        "Niveau de nécessité",
        "Besoin couvert",
        "Décision recommandée",
        "Commentaire"
      ],
      ["QGIS", "Cartographie", "Haute", "Oui", "Conserver", ""],
      ["HEC RAS", "Hydraulique", "Moyenne", "À confirmer", "Vérifier", ""]
    ]),
    "03_Par_logiciel"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Analyse"],
      [""],
      [
        "Besoin non couvert",
        "Type de logiciel nécessaire",
        "Pourquoi ce besoin est nécessaire",
        "Niveau d’urgence",
        "Exemple de logiciel ou de catégorie"
      ],
      ["Modeleur 3D", "Modeleur", "Visualisation", "Haute", "Civil 3D"]
    ]),
    "04_Manquants"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Analyse"],
      [""],
      ["Point à confirmer", "Question ou information à obtenir"],
      ["Licences", "Confirmer le nombre de licences"]
    ]),
    "05_Confirmations"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Analyse"],
      [""],
      ["Source", "Fichier", "Commentaire"],
      ["CDC", "cdc.pdf", "Chapitre 4"]
    ]),
    "06_Sources"
  );

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

const catalogue: SoftwareRecord[] = [
  {
    id: 1,
    name: "QGIS",
    normalizedName: "qgis",
    descriptionRaw: "SIG",
    status: "active",
    createdAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z",
    aliases: []
  },
  {
    id: 2,
    name: "HECRAS",
    normalizedName: "hecras",
    descriptionRaw: "Hydraulique",
    status: "active",
    createdAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:00.000Z",
    aliases: []
  }
];

test("buildSoftwareAnalysisImportPreviewFromWorkbook detects workbook sections and possible matches", () => {
  const preview = buildSoftwareAnalysisImportPreviewFromWorkbook({
    appelOffresId: 1,
    fileName: "analyse.xlsx",
    buffer: buildWorkbookBuffer(),
    existing: {
      requirements: [],
      matches: [],
      gaps: [],
      confirmations: [],
      sources: []
    },
    catalogue
  });

  assert.equal(preview.sections.requirements.detected, 1);
  assert.equal(preview.sections.matches.detected, 2);
  assert.equal(preview.sections.gaps.detected, 1);
  assert.equal(preview.matches[0]?.proposedMatchType, "exact");
  assert.equal(preview.matches[1]?.proposedMatchType, "possible");
  assert.equal(preview.matches[1]?.result, "warning");
});

test("buildSoftwareAnalysisImportPreviewFromWorkbook is idempotent on re-import for the same tender", () => {
  const preview = buildSoftwareAnalysisImportPreviewFromWorkbook({
    appelOffresId: 1,
    fileName: "analyse.xlsx",
    buffer: buildWorkbookBuffer(),
    existing: {
      requirements: [
        {
          id: 11,
          appelOffresId: 1,
          requirementText: "Cartographie SIG",
          explicitness: "explicit",
          softwareNamesRaw: "QGIS",
          necessityLevel: "Haute",
          justification: "Analyse",
          riskIfMissing: "Blocage",
          alternativePossible: "ArcGIS",
          sourceExcerpt: "",
          status: "draft",
          createdAt: "2026-07-22T10:00:00.000Z",
          updatedAt: "2026-07-22T10:00:00.000Z"
        }
      ],
      matches: [],
      gaps: [],
      confirmations: [],
      sources: []
    },
    catalogue
  });

  assert.equal(preview.sections.requirements.unchanged, 1);
  assert.equal(preview.sections.requirements.create, 0);
});

test("buildSoftwareAnalysisImportPreviewFromWorkbook ignores existing rows from another tender", () => {
  const preview = buildSoftwareAnalysisImportPreviewFromWorkbook({
    appelOffresId: 1,
    fileName: "analyse.xlsx",
    buffer: buildWorkbookBuffer(),
    existing: {
      requirements: [
        {
          id: 22,
          appelOffresId: 999,
          requirementText: "Cartographie SIG",
          explicitness: "explicit",
          softwareNamesRaw: "QGIS",
          necessityLevel: "Haute",
          justification: "Analyse",
          riskIfMissing: "Blocage",
          alternativePossible: "ArcGIS",
          sourceExcerpt: "",
          status: "draft",
          createdAt: "2026-07-22T10:00:00.000Z",
          updatedAt: "2026-07-22T10:00:00.000Z"
        }
      ],
      matches: [],
      gaps: [],
      confirmations: [],
      sources: []
    },
    catalogue
  });

  assert.equal(preview.sections.requirements.create, 1);
  assert.equal(preview.sections.requirements.unchanged, 0);
});
