import * as XLSX from "xlsx";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { listSoftware } from "../administration/logiciels/repository.ts";
import {
  findSoftwareMatchCandidate,
  resolveCoverageStatusFromWorkbook
} from "./software-analysis-matching.ts";
import {
  getSoftwareAnalysisDetailByCode,
  saveConfirmationByCode,
  saveGapByCode,
  saveMatchByCode,
  saveRequirementByCode,
  saveSourceByCode
} from "./software-analysis-repository.ts";
import type {
  AnalysisConfirmationRecord,
  AnalysisSourceRecord,
  MatchImportCandidate,
  RequirementImportCandidate,
  SoftwareAnalysisDetail,
  SoftwareAnalysisImportCandidateResult,
  SoftwareAnalysisImportPreview,
  SoftwareAnalysisImportSectionSummary,
  SoftwareAnalysisImportSource,
  SoftwareAnalysisImportSummary,
  TenderSoftwareExplicitness,
  TenderSoftwareGapRecord,
  TenderSoftwareMatchRecord,
  TenderSoftwareRequirementRecord
} from "./software-analysis-types.ts";
import {
  buildConfirmationIdentityKey,
  buildGapIdentityKey,
  buildMatchIdentityKey,
  buildRequirementIdentityKey,
  buildSourceIdentityKey
} from "./software-analysis-validation.ts";

export const SOFTWARE_ANALYSIS_EXAMPLE_RELATIVE_PATH =
  "data/imports/private/exemples-analyse/Résultat analyse_logiciels_cdc_mballing (2).xlsx";

const WORKSHEET_NAMES = {
  requirements: "02_Besoins",
  matches: "03_Par_logiciel",
  gaps: "04_Manquants",
  confirmations: "05_Confirmations",
  sources: "06_Sources"
} as const;

type ParsedWorkbookSource = {
  fileName: string;
  buffer: Buffer;
};

type ExistingAnalysisContext = {
  requirements: TenderSoftwareRequirementRecord[];
  matches: TenderSoftwareMatchRecord[];
  gaps: TenderSoftwareGapRecord[];
  confirmations: AnalysisConfirmationRecord[];
  sources: AnalysisSourceRecord[];
};

type ParsedRequirementRow = Omit<
  RequirementImportCandidate,
  "existingId" | "result" | "messages"
>;
type ParsedMatchRow = Omit<
  MatchImportCandidate,
  | "existingId"
  | "result"
  | "messages"
  | "proposedLogicielId"
  | "proposedLogicielName"
  | "proposedMatchType"
  | "requiresConfirmation"
>;
type ParsedGapRow = SoftwareAnalysisImportPreview["gaps"][number];
type ParsedConfirmationRow = SoftwareAnalysisImportPreview["confirmations"][number];
type ParsedSourceRow = SoftwareAnalysisImportPreview["sources"][number];

function readCellValue(value: unknown) {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function normalizeHeader(value: string) {
  return value.trim().toLocaleLowerCase("fr-FR");
}

function isBlankRow(row: string[]) {
  return row.every((cell) => !cell.trim());
}

function getLocalExampleAbsolutePath() {
  return path.join(process.cwd(), ...SOFTWARE_ANALYSIS_EXAMPLE_RELATIVE_PATH.split("/"));
}

async function readWorkbookSource(source: SoftwareAnalysisImportSource): Promise<ParsedWorkbookSource> {
  if (source.kind === "uploaded_file") {
    return {
      fileName: source.fileName,
      buffer: source.buffer
    };
  }

  const absolutePath = getLocalExampleAbsolutePath();
  return {
    fileName: path.basename(absolutePath),
    buffer: await readFile(absolutePath)
  };
}

function openWorkbook(buffer: Buffer) {
  try {
    return XLSX.read(buffer, {
      type: "buffer",
      raw: false
    });
  } catch {
    throw new Error("Le fichier Excel d'analyse n'a pas pu etre lu.");
  }
}

function getWorksheetRows(workbook: XLSX.WorkBook, worksheetName: string) {
  const worksheet = workbook.Sheets[worksheetName];
  if (!worksheet) {
    throw new Error(`La feuille attendue \`${worksheetName}\` est introuvable dans le classeur.`);
  }

  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
    header: 1,
    raw: false,
    defval: ""
  });

  return rows.map((row) => row.map((value) => readCellValue(value)));
}

function findExactHeaderRow(rows: string[][], expectedHeaders: string[]) {
  const expected = expectedHeaders.map(normalizeHeader);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = (rows[rowIndex] ?? []).map(normalizeHeader);
    const matches = expected.every((header, index) => row[index] === header);
    if (matches) {
      return rowIndex;
    }
  }

  throw new Error(
    `Le classeur ne contient pas les en-tetes attendus pour la feuille \`${expectedHeaders[0]}\`.`
  );
}

function parseRowsAfterHeader(rows: string[][], headerRowIndex: number) {
  const values = rows.slice(headerRowIndex + 1);
  while (values.length > 0 && isBlankRow(values[values.length - 1] ?? [])) {
    values.pop();
  }
  return values;
}

function toExplicitness(value: string): TenderSoftwareExplicitness {
  return normalizeHeader(value).includes("implic") ? "implicit" : "explicit";
}

function buildSectionSummary(results: SoftwareAnalysisImportCandidateResult[]): SoftwareAnalysisImportSectionSummary {
  return {
    detected: results.length,
    create: results.filter((value) => value === "new").length,
    update: results.filter((value) => value === "update").length,
    unchanged: results.filter((value) => value === "unchanged").length,
    skipped: results.filter((value) => value === "skipped").length,
    warnings: results.filter((value) => value === "warning").length
  };
}

function compareRequirementCandidate(
  row: ParsedRequirementRow,
  existing: TenderSoftwareRequirementRecord | undefined
) {
  if (!existing) {
    return "new" as const;
  }

  const unchanged =
    existing.requirementText === row.requirementText &&
    existing.explicitness === row.explicitness &&
    existing.softwareNamesRaw === row.softwareNamesRaw &&
    existing.necessityLevel === row.necessityLevel &&
    existing.justification === row.justification &&
    existing.riskIfMissing === row.riskIfMissing &&
    existing.alternativePossible === row.alternativePossible;

  return unchanged ? ("unchanged" as const) : ("update" as const);
}

function compareGapCandidate(
  row: {
    missingNeed: string;
    softwareTypeNeeded: string;
    whyNeeded: string;
    urgencyLevel: string;
    exampleSoftwareOrCategory: string;
  },
  existing: TenderSoftwareGapRecord | undefined
) {
  if (!existing) {
    return "new" as const;
  }

  const unchanged =
    existing.missingNeed === row.missingNeed &&
    existing.softwareTypeNeeded === row.softwareTypeNeeded &&
    existing.whyNeeded === row.whyNeeded &&
    existing.urgencyLevel === row.urgencyLevel &&
    existing.exampleSoftwareOrCategory === row.exampleSoftwareOrCategory;

  return unchanged ? ("unchanged" as const) : ("update" as const);
}

function compareConfirmationCandidate(
  row: {
    topic: string;
    questionText: string;
  },
  existing: AnalysisConfirmationRecord | undefined
) {
  if (!existing) {
    return "new" as const;
  }

  return existing.topic === row.topic && existing.questionText === row.questionText
    ? ("unchanged" as const)
    : ("update" as const);
}

function compareSourceCandidate(
  row: {
    sourceLabel: string;
    fileName: string;
    comment: string;
    sheetName: string;
  },
  existing: AnalysisSourceRecord | undefined
) {
  if (!existing) {
    return "new" as const;
  }

  const unchanged =
    existing.sourceLabel === row.sourceLabel &&
    existing.fileName === row.fileName &&
    existing.comment === row.comment &&
    existing.sheetName === row.sheetName;

  return unchanged ? ("unchanged" as const) : ("update" as const);
}

function compareMatchCandidate(
  row: Omit<
    MatchImportCandidate,
    | "existingId"
    | "result"
    | "messages"
    | "proposedLogicielId"
    | "proposedLogicielName"
    | "proposedMatchType"
    | "requiresConfirmation"
  >,
  existing: TenderSoftwareMatchRecord | undefined
) {
  if (!existing) {
    return "new" as const;
  }

  const unchanged =
    existing.softwareNameRaw === row.softwareNameRaw &&
    existing.necessityLevel === row.necessityLevel &&
    existing.coverageStatus === row.coverageStatus &&
    existing.utilityText === row.utilityText &&
    existing.recommendedDecision === row.recommendedDecision &&
    existing.comment === row.comment;

  return unchanged ? ("unchanged" as const) : ("update" as const);
}

function parseRequirements(rows: string[][]) {
  const headerRowIndex = findExactHeaderRow(rows, [
    "Besoin identifié dans le cahier des charges",
    "Besoin explicite ou implicite",
    "Logiciel(s) concerné(s)",
    "Niveau de nécessité",
    "Justification",
    "Risque en cas d’absence",
    "Alternative possible"
  ]);

  return parseRowsAfterHeader(rows, headerRowIndex)
    .map((row, index) => ({
      rowNumber: headerRowIndex + index + 2,
      requirementText: readCellValue(row[0]),
      explicitness: toExplicitness(readCellValue(row[1])),
      softwareNamesRaw: readCellValue(row[2]),
      necessityLevel: readCellValue(row[3]),
      justification: readCellValue(row[4]),
      riskIfMissing: readCellValue(row[5]),
      alternativePossible: readCellValue(row[6])
    }))
    .filter((row) => row.requirementText);
}

function parseMatches(rows: string[][]) {
  const headerRowIndex = findExactHeaderRow(rows, [
    "Logiciel",
    "Utilité par rapport au cahier des charges",
    "Niveau de nécessité",
    "Besoin couvert",
    "Décision recommandée",
    "Commentaire"
  ]);

  return parseRowsAfterHeader(rows, headerRowIndex)
    .map((row, index) => ({
      rowNumber: headerRowIndex + index + 2,
      softwareNameRaw: readCellValue(row[0]),
      utilityText: readCellValue(row[1]),
      necessityLevel: readCellValue(row[2]),
      coverageStatus: resolveCoverageStatusFromWorkbook(readCellValue(row[3])),
      recommendedDecision: readCellValue(row[4]),
      comment: readCellValue(row[5])
    }))
    .filter((row) => row.softwareNameRaw);
}

function parseGaps(rows: string[][]) {
  const headerRowIndex = findExactHeaderRow(rows, [
    "Besoin non couvert",
    "Type de logiciel nécessaire",
    "Pourquoi ce besoin est nécessaire",
    "Niveau d’urgence",
    "Exemple de logiciel ou de catégorie"
  ]);

  return parseRowsAfterHeader(rows, headerRowIndex)
    .map((row, index) => ({
      rowNumber: headerRowIndex + index + 2,
      missingNeed: readCellValue(row[0]),
      softwareTypeNeeded: readCellValue(row[1]),
      whyNeeded: readCellValue(row[2]),
      urgencyLevel: readCellValue(row[3]),
      exampleSoftwareOrCategory: readCellValue(row[4])
    }))
    .filter((row) => row.missingNeed);
}

function parseConfirmations(rows: string[][]) {
  const headerRowIndex = findExactHeaderRow(rows, [
    "Point à confirmer",
    "Question ou information à obtenir"
  ]);

  return parseRowsAfterHeader(rows, headerRowIndex)
    .map((row, index) => ({
      rowNumber: headerRowIndex + index + 2,
      topic: readCellValue(row[0]),
      questionText: readCellValue(row[1])
    }))
    .filter((row) => row.topic || row.questionText)
    .map((row) => ({
      ...row,
      topic: row.topic || "Point a confirmer"
    }));
}

function parseSources(rows: string[][]) {
  const headerRowIndex = findExactHeaderRow(rows, ["Source", "Fichier", "Commentaire"]);

  return parseRowsAfterHeader(rows, headerRowIndex)
    .map((row, index) => ({
      rowNumber: headerRowIndex + index + 2,
      sourceLabel: readCellValue(row[0]),
      fileName: readCellValue(row[1]),
      comment: readCellValue(row[2]),
      sheetName: WORKSHEET_NAMES.sources
    }))
    .filter((row) => row.sourceLabel || row.fileName || row.comment)
    .map((row) => ({
      ...row,
      sourceLabel: row.sourceLabel || "Source"
    }));
}

export function buildSoftwareAnalysisImportPreviewFromWorkbook(input: {
  appelOffresId: number;
  fileName: string;
  buffer: Buffer;
  existing: ExistingAnalysisContext;
  catalogue: Awaited<ReturnType<typeof listSoftware>>;
}) {
  const workbook = openWorkbook(input.buffer);
  const requirementsRows = parseRequirements(
    getWorksheetRows(workbook, WORKSHEET_NAMES.requirements)
  );
  const matchesRows = parseMatches(getWorksheetRows(workbook, WORKSHEET_NAMES.matches));
  const gapsRows = parseGaps(getWorksheetRows(workbook, WORKSHEET_NAMES.gaps));
  const confirmationRows = parseConfirmations(
    getWorksheetRows(workbook, WORKSHEET_NAMES.confirmations)
  );
  const sourceRows = parseSources(getWorksheetRows(workbook, WORKSHEET_NAMES.sources));

  const scopedExisting = {
    requirements: input.existing.requirements.filter(
      (requirement) => requirement.appelOffresId === input.appelOffresId
    ),
    matches: input.existing.matches.filter((match) => match.appelOffresId === input.appelOffresId),
    gaps: input.existing.gaps.filter((gap) => gap.appelOffresId === input.appelOffresId),
    confirmations: input.existing.confirmations.filter(
      (item) => item.appelOffresId === input.appelOffresId
    ),
    sources: input.existing.sources.filter((item) => item.appelOffresId === input.appelOffresId)
  };

  const requirementsByKey = new Map(
    scopedExisting.requirements.map((requirement) => [
      buildRequirementIdentityKey(requirement),
      requirement
    ])
  );
  const matchesByKey = new Map(
    scopedExisting.matches.map((match) => [
      buildMatchIdentityKey(match),
      match
    ])
  );
  const gapsByKey = new Map(
    scopedExisting.gaps.map((gap) => [buildGapIdentityKey(gap), gap])
  );
  const confirmationsByKey = new Map(
    scopedExisting.confirmations.map((item) => [
      buildConfirmationIdentityKey(item),
      item
    ])
  );
  const sourcesByKey = new Map(
    scopedExisting.sources.map((item) => [buildSourceIdentityKey(item), item])
  );

  const requirements = requirementsRows.map((row) => {
    const existing = requirementsByKey.get(buildRequirementIdentityKey(row));
    const result = compareRequirementCandidate(row, existing);
    return {
      existingId: existing?.id ?? null,
      ...row,
      result,
      messages: []
    } satisfies RequirementImportCandidate;
  });

  const matches = matchesRows.map((row) => {
    const matchCandidate = findSoftwareMatchCandidate(row.softwareNameRaw, input.catalogue);
    const existing = matchesByKey.get(buildMatchIdentityKey(row));
    const requiresConfirmation = matchCandidate.matchType === "possible";
    const result = requiresConfirmation
      ? ("warning" as const)
      : compareMatchCandidate(row, existing);

    return {
      existingId: existing?.id ?? null,
      ...row,
      proposedLogicielId: matchCandidate.software?.id ?? null,
      proposedLogicielName: matchCandidate.software?.name ?? null,
      proposedMatchType: matchCandidate.matchType,
      requiresConfirmation,
      result,
      messages: [matchCandidate.explanation]
    } satisfies MatchImportCandidate;
  });

  const gaps = gapsRows.map((row) => {
    const existing = gapsByKey.get(buildGapIdentityKey(row));
    const result = compareGapCandidate(row, existing);
    return {
      existingId: existing?.id ?? null,
      ...row,
      result,
      messages: []
    };
  });

  const confirmations = confirmationRows.map((row) => {
    const existing = confirmationsByKey.get(buildConfirmationIdentityKey(row));
    const result = compareConfirmationCandidate(row, existing);
    return {
      existingId: existing?.id ?? null,
      ...row,
      result,
      messages: []
    };
  });

  const sources = sourceRows.map((row) => {
    const existing = sourcesByKey.get(buildSourceIdentityKey(row));
    const result = compareSourceCandidate(row, existing);
    return {
      existingId: existing?.id ?? null,
      ...row,
      sourceExcerpt: "",
      result,
      messages: []
    };
  });

  const warnings = [
    ...matches
      .filter((candidate) => candidate.requiresConfirmation)
      .map(
        (candidate) =>
          `La correspondance \`${candidate.softwareNameRaw}\` doit etre confirmee manuellement avant validation.`
      )
  ];

  return {
    sourceFileName: input.fileName,
    warnings,
    sections: {
      requirements: buildSectionSummary(requirements.map((candidate) => candidate.result)),
      matches: buildSectionSummary(matches.map((candidate) => candidate.result)),
      gaps: buildSectionSummary(gaps.map((candidate) => candidate.result)),
      confirmations: buildSectionSummary(confirmations.map((candidate) => candidate.result)),
      sources: buildSectionSummary(sources.map((candidate) => candidate.result))
    },
    requirements,
    matches,
    gaps,
    confirmations,
    sources
  } satisfies SoftwareAnalysisImportPreview;
}

export async function previewSoftwareAnalysisImport(code: string, source: SoftwareAnalysisImportSource) {
  const [workbookSource, current, catalogue] = await Promise.all([
    readWorkbookSource(source),
    getSoftwareAnalysisDetailByCode(code),
    listSoftware({ status: "all" })
  ]);

  return buildSoftwareAnalysisImportPreviewFromWorkbook({
    appelOffresId: current.review.appelOffresId,
    fileName: workbookSource.fileName,
    buffer: workbookSource.buffer,
    existing: current,
    catalogue
  });
}

export async function confirmSoftwareAnalysisImport(code: string, source: SoftwareAnalysisImportSource) {
  const preview = await previewSoftwareAnalysisImport(code, source);

  for (const requirement of preview.requirements) {
    await saveRequirementByCode(code, {
      id: requirement.existingId ?? undefined,
      requirementText: requirement.requirementText,
      explicitness: requirement.explicitness,
      softwareNamesRaw: requirement.softwareNamesRaw,
      necessityLevel: requirement.necessityLevel,
      justification: requirement.justification,
      riskIfMissing: requirement.riskIfMissing,
      alternativePossible: requirement.alternativePossible,
      sourceExcerpt: "",
      status: requirement.result === "unchanged" ? "reviewed" : "draft"
    });
  }

  for (const match of preview.matches) {
    await saveMatchByCode(code, {
      id: match.existingId ?? undefined,
      requirementId: null,
      logicielId: match.proposedLogicielId,
      softwareNameRaw: match.softwareNameRaw,
      matchType: match.proposedMatchType,
      coverageStatus: match.requiresConfirmation ? "to_confirm" : match.coverageStatus,
      necessityLevel: match.necessityLevel,
      utilityText: match.utilityText,
      recommendedDecision: match.recommendedDecision,
      comment: match.comment,
      validatedByUser: !match.requiresConfirmation && match.proposedLogicielId != null,
      status: match.requiresConfirmation ? "draft" : "reviewed"
    });
  }

  for (const gap of preview.gaps) {
    await saveGapByCode(code, {
      id: gap.existingId ?? undefined,
      requirementId: null,
      missingNeed: gap.missingNeed,
      softwareTypeNeeded: gap.softwareTypeNeeded,
      whyNeeded: gap.whyNeeded,
      urgencyLevel: gap.urgencyLevel,
      exampleSoftwareOrCategory: gap.exampleSoftwareOrCategory,
      recommendedAction: "",
      status: gap.result === "unchanged" ? "reviewed" : "draft"
    });
  }

  for (const confirmation of preview.confirmations) {
    await saveConfirmationByCode(code, {
      id: confirmation.existingId ?? undefined,
      topic: confirmation.topic,
      questionText: confirmation.questionText,
      status: "open",
      resolutionNote: ""
    });
  }

  for (const sourceRow of preview.sources) {
    await saveSourceByCode(code, {
      id: sourceRow.existingId ?? undefined,
      sourceLabel: sourceRow.sourceLabel,
      fileName: sourceRow.fileName,
      sheetName: sourceRow.sheetName,
      sourceExcerpt: "",
      comment: sourceRow.comment
    });
  }

  const createdRecords = [
    ...preview.requirements,
    ...preview.matches,
    ...preview.gaps,
    ...preview.confirmations,
    ...preview.sources
  ].filter((candidate) => candidate.result === "new").length;
  const updatedRecords = [
    ...preview.requirements,
    ...preview.matches,
    ...preview.gaps,
    ...preview.confirmations,
    ...preview.sources
  ].filter((candidate) => candidate.result === "update" || candidate.result === "warning").length;
  const unchangedRecords = [
    ...preview.requirements,
    ...preview.matches,
    ...preview.gaps,
    ...preview.confirmations,
    ...preview.sources
  ].filter((candidate) => candidate.result === "unchanged").length;
  const skippedRecords = 0;

  return {
    sourceFileName: preview.sourceFileName,
    warnings: preview.warnings,
    createdRecords,
    updatedRecords,
    unchangedRecords,
    skippedRecords,
    sectionSummaries: preview.sections
  } satisfies SoftwareAnalysisImportSummary;
}
