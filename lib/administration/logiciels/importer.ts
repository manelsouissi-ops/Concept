import * as XLSX from "xlsx";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  SoftwareImportCandidate,
  SoftwareImportPreview,
  SoftwareImportSource
} from "./types.ts";
import {
  normalizeSoftwareComparisonName,
  normalizeSoftwareDisplayName,
  splitSoftwareNameCandidates
} from "./normalization.ts";
import {
  applySoftwareImportPreview,
  listSoftwareByNormalizedNames
} from "./repository.ts";

export const SOFTWARE_CATALOGUE_WORKSHEET = "Feuil2";
export const SOFTWARE_CATALOGUE_RELATIVE_PATH =
  "data/imports/private/referentiels/Liste Logiciels_Techniques envoyé par Si Maher.xlsx";

type ParsedWorkbookSource = {
  fileName: string;
  buffer: Buffer;
};

function readCellValue(value: unknown) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function getLocalCatalogueAbsolutePath() {
  return path.join(
    process.cwd(),
    ...SOFTWARE_CATALOGUE_RELATIVE_PATH.split("/")
  );
}

async function readWorkbookSource(source: SoftwareImportSource): Promise<ParsedWorkbookSource> {
  if (source.kind === "uploaded_file") {
    return {
      fileName: source.fileName,
      buffer: source.buffer
    };
  }

  const absolutePath = getLocalCatalogueAbsolutePath();
  const buffer = await readFile(absolutePath);

  return {
    fileName: SOFTWARE_CATALOGUE_RELATIVE_PATH.split("/").at(-1) ?? "catalogue.xlsx",
    buffer
  };
}

export function findSoftwareWorkbookHeaders(rows: string[][]) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const cells = row.map((value) => value.trim().toLocaleLowerCase("fr-FR"));
    const logicielsColumnIndex = cells.findIndex((value) => value === "logiciels");
    const utilisationColumnIndex = cells.findIndex((value) => value === "utilisation");

    if (logicielsColumnIndex >= 0 && utilisationColumnIndex >= 0) {
      return {
        headerRowIndex: rowIndex,
        logicielsColumnIndex,
        utilisationColumnIndex
      };
    }
  }

  throw new Error(
    "Le classeur ne contient pas les en-tetes attendus `Logiciels` et `Utilisation`."
  );
}

function buildSkippedCandidate(rowNumber: number, originalCellValue: string, rawUsage: string, message: string) {
  return {
    rowNumber,
    originalCellValue,
    sourceName: null,
    proposedName: null,
    normalizedName: null,
    rawUsage,
    result: "skipped",
    messages: [message],
    splitFromMultiNameCell: false,
    existingSoftwareId: null,
    existingSoftwareName: null
  } satisfies SoftwareImportCandidate;
}

async function buildSoftwareImportPreviewFromRows(
  rows: string[][],
  sourceFileName: string,
  existingByNormalizedName = new Map<
    string,
    {
      id: number;
      name: string;
      descriptionRaw: string;
    }
  >()
) {
  const worksheetName = SOFTWARE_CATALOGUE_WORKSHEET;
  const {
    headerRowIndex,
    logicielsColumnIndex,
    utilisationColumnIndex
  } = findSoftwareWorkbookHeaders(rows);

  const candidates: SoftwareImportCandidate[] = [];
  let rowsSkipped = 0;
  let splitCells = 0;

  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const originalCellValue = readCellValue(row[logicielsColumnIndex]);
    const rawUsage = readCellValue(row[utilisationColumnIndex]);
    const rowNumber = rowIndex + 1;
    const hasAnyValue = row.some((value) => readCellValue(value).length > 0);

    if (!hasAnyValue) {
      rowsSkipped += 1;
      continue;
    }

    if (!originalCellValue) {
      rowsSkipped += 1;
      candidates.push(
        buildSkippedCandidate(
          rowNumber,
          "",
          rawUsage,
          "La ligne est ignoree car la cellule `Logiciels` est vide."
        )
      );
      continue;
    }

    const splitNames = splitSoftwareNameCandidates(originalCellValue);
    const isSplit = splitNames.length > 1;
    if (isSplit) {
      splitCells += 1;
    }

    for (const splitName of splitNames) {
      const proposedName = normalizeSoftwareDisplayName(splitName);
      const normalizedName = normalizeSoftwareComparisonName(proposedName);

      candidates.push({
        rowNumber,
        originalCellValue,
        sourceName: splitName,
        proposedName,
        normalizedName,
        rawUsage,
        result: "new",
        messages: isSplit
          ? [
              "Valeur decoupee en plusieurs noms a partir d'une liste separee par des virgules."
            ]
          : [],
        splitFromMultiNameCell: isSplit,
        existingSoftwareId: null,
        existingSoftwareName: null
      });
    }
  }

  const normalizedNames = [
    ...new Set(
      candidates
        .map((candidate) => candidate.normalizedName)
        .filter((value): value is string => Boolean(value))
    )
  ];
  const occurrences = new Map<string, number>();
  let newRecords = 0;
  let existingMatches = 0;
  let possibleDuplicates = 0;

  for (const candidate of candidates) {
    if (!candidate.normalizedName || !candidate.proposedName) {
      continue;
    }

    const currentCount = (occurrences.get(candidate.normalizedName) ?? 0) + 1;
    occurrences.set(candidate.normalizedName, currentCount);

    const existing = existingByNormalizedName.get(candidate.normalizedName);
    if (existing) {
      candidate.result = "existing";
      candidate.existingSoftwareId = existing.id;
      candidate.existingSoftwareName = existing.name;
      if (
        !existing.descriptionRaw.trim() &&
        candidate.rawUsage.trim()
      ) {
        candidate.messages.push("La description brute manque en base et pourra etre completee.");
      }
      if (candidate.sourceName && candidate.sourceName !== existing.name) {
        candidate.messages.push("Une variante du nom sera preservee en alias si necessaire.");
      }
      existingMatches += 1;
      continue;
    }

    if (currentCount > 1) {
      candidate.result = "warning";
      candidate.messages.push(
        "Doublon detecte dans ce fichier d'import. Une seule creation sera conservee."
      );
      possibleDuplicates += 1;
      continue;
    }

    newRecords += 1;
  }

  const warnings: string[] = [];
  if (splitCells > 0) {
    warnings.push(
      `${splitCells} cellule(s) ont ete decoupees en plusieurs noms de logiciels a partir de listes separees par des virgules.`
    );
  }
  if (possibleDuplicates > 0) {
    warnings.push(
      `${possibleDuplicates} candidat(s) en doublon ont ete detectes dans le fichier et seront deduplices a la confirmation.`
    );
  }

  return {
    sourceFileName,
    worksheetName,
    totalRowsInspected: Math.max(rows.length - headerRowIndex - 1, 0),
    validSoftwareCandidates: candidates.filter((candidate) => candidate.proposedName).length,
    newRecords,
    existingMatches,
    possibleDuplicates,
    rowsSkipped,
    splitCells,
    warnings,
    candidates
  } satisfies SoftwareImportPreview;
}

export async function previewSoftwareImport(source: SoftwareImportSource) {
  const workbookSource = await readWorkbookSource(source);
  const existingByNormalizedName = await listSoftwareByNormalizedNamesFromWorkbookSource(
    workbookSource
  );
  return previewSoftwareImportBuffer(
    workbookSource.buffer,
    workbookSource.fileName,
    existingByNormalizedName
  );
}

export async function confirmSoftwareImport(source: SoftwareImportSource) {
  const preview = await previewSoftwareImport(source);
  return applySoftwareImportPreview(preview);
}

async function listSoftwareByNormalizedNamesFromWorkbookSource(source: ParsedWorkbookSource) {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(source.buffer, {
      type: "buffer",
      raw: false
    });
  } catch {
    throw new Error("Le fichier Excel n'a pas pu etre lu.");
  }

  const worksheet = workbook.Sheets[SOFTWARE_CATALOGUE_WORKSHEET];
  if (!worksheet) {
    if (!workbook.SheetNames.length) {
      throw new Error("Le fichier Excel n'a pas pu etre lu.");
    }

    throw new Error(
      `La feuille attendue \`${SOFTWARE_CATALOGUE_WORKSHEET}\` est introuvable dans le classeur.`
    );
  }

  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
    header: 1,
    raw: false,
    defval: ""
  });

  const parsedRows = rows.map((row) => row.map((value) => readCellValue(value)));
  const {
    headerRowIndex,
    logicielsColumnIndex
  } = findSoftwareWorkbookHeaders(parsedRows);

  const normalizedNames = [
    ...new Set(
      parsedRows
        .slice(headerRowIndex + 1)
        .flatMap((row) => {
          const originalCellValue = readCellValue(row[logicielsColumnIndex]);
          return splitSoftwareNameCandidates(originalCellValue).map((value) =>
            normalizeSoftwareComparisonName(value)
          );
        })
        .filter(Boolean)
    )
  ];

  return listSoftwareByNormalizedNames(normalizedNames);
}

export function previewSoftwareImportBuffer(
  buffer: Buffer,
  sourceFileName: string,
  existingByNormalizedName = new Map<
    string,
    {
      id: number;
      name: string;
      descriptionRaw: string;
    }
  >()
) {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      raw: false
    });
  } catch {
    throw new Error("Le fichier Excel n'a pas pu etre lu.");
  }

  const worksheet = workbook.Sheets[SOFTWARE_CATALOGUE_WORKSHEET];
  if (!worksheet) {
    if (!workbook.SheetNames.length) {
      throw new Error("Le fichier Excel n'a pas pu etre lu.");
    }

    throw new Error(
      `La feuille attendue \`${SOFTWARE_CATALOGUE_WORKSHEET}\` est introuvable dans le classeur.`
    );
  }

  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
    header: 1,
    raw: false,
    defval: ""
  });

  return buildSoftwareImportPreviewFromRows(
    rows.map((row) => row.map((value) => readCellValue(value))),
    sourceFileName,
    existingByNormalizedName
  );
}
