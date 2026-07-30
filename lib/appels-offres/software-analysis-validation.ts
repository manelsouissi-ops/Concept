import type {
  AnalysisConfirmationStatus,
  ConfirmationMutationInput,
  GapMutationInput,
  MatchMutationInput,
  RequirementMutationInput,
  SoftwareAnalysisTransitionAction,
  SourceMutationInput,
  TenderSoftwareCoverageStatus,
  TenderSoftwareExplicitness,
  TenderSoftwareMatchType,
  TenderSoftwareRowStatus
} from "./software-analysis-types.ts";
import {
  normalizeSoftwareComparisonName,
  normalizeSoftwareDisplayName
} from "../administration/logiciels/normalization.ts";

const ROW_STATUSES = new Set<TenderSoftwareRowStatus>([
  "draft",
  "reviewed",
  "validated",
  "rejected"
]);
const EXPLICITNESS_VALUES = new Set<TenderSoftwareExplicitness>(["explicit", "implicit"]);
const MATCH_TYPES = new Set<TenderSoftwareMatchType>([
  "exact",
  "alias",
  "manual",
  "possible",
  "none"
]);
const COVERAGE_STATUSES = new Set<TenderSoftwareCoverageStatus>([
  "covered",
  "partially_covered",
  "not_covered",
  "to_confirm"
]);
const CONFIRMATION_STATUSES = new Set<AnalysisConfirmationStatus>([
  "open",
  "resolved",
  "not_applicable"
]);
const REVIEW_ACTIONS = new Set<SoftwareAnalysisTransitionAction>([
  "submit",
  "validate",
  "reopen"
]);

function normalizeText(value: string, fieldLabel: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new Error(`${fieldLabel} est obligatoire.`);
  }
  return normalized;
}

function normalizeOptionalText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeId(value: number | null | undefined, fieldLabel: string) {
  if (value == null) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldLabel} est invalide.`);
  }
  return value;
}

function assertRowStatus(value: string): TenderSoftwareRowStatus {
  if (!ROW_STATUSES.has(value as TenderSoftwareRowStatus)) {
    throw new Error("Le statut de validation est invalide.");
  }
  return value as TenderSoftwareRowStatus;
}

function assertCoverageStatus(value: string): TenderSoftwareCoverageStatus {
  if (!COVERAGE_STATUSES.has(value as TenderSoftwareCoverageStatus)) {
    throw new Error("Le statut de couverture est invalide.");
  }
  return value as TenderSoftwareCoverageStatus;
}

function assertMatchType(value: string): TenderSoftwareMatchType {
  if (!MATCH_TYPES.has(value as TenderSoftwareMatchType)) {
    throw new Error("Le type de correspondance est invalide.");
  }
  return value as TenderSoftwareMatchType;
}

function assertExplicitness(value: string): TenderSoftwareExplicitness {
  if (!EXPLICITNESS_VALUES.has(value as TenderSoftwareExplicitness)) {
    throw new Error("Le caractere explicite ou implicite est invalide.");
  }
  return value as TenderSoftwareExplicitness;
}

function assertConfirmationStatus(value: string): AnalysisConfirmationStatus {
  if (!CONFIRMATION_STATUSES.has(value as AnalysisConfirmationStatus)) {
    throw new Error("Le statut du point a confirmer est invalide.");
  }
  return value as AnalysisConfirmationStatus;
}

export function validateRequirementMutationInput(
  input: RequirementMutationInput
): RequirementMutationInput {
  return {
    id: normalizeId(input.id, "L'identifiant du besoin") ?? undefined,
    requirementText: normalizeText(input.requirementText, "Le besoin"),
    explicitness: assertExplicitness(input.explicitness),
    softwareNamesRaw: normalizeOptionalText(input.softwareNamesRaw),
    necessityLevel: normalizeText(input.necessityLevel, "Le niveau de necessite"),
    justification: normalizeOptionalText(input.justification),
    riskIfMissing: normalizeOptionalText(input.riskIfMissing),
    alternativePossible: normalizeOptionalText(input.alternativePossible),
    sourceExcerpt: normalizeOptionalText(input.sourceExcerpt),
    status: assertRowStatus(input.status)
  };
}

export function validateMatchMutationInput(input: MatchMutationInput): MatchMutationInput {
  const softwareNameRaw = normalizeSoftwareDisplayName(input.softwareNameRaw);
  if (!softwareNameRaw) {
    throw new Error("Le nom logiciel brut est obligatoire.");
  }

  const logicielId = normalizeId(input.logicielId, "Le logiciel rattache");
  const matchType = assertMatchType(input.matchType);
  if (matchType !== "none" && matchType !== "possible" && logicielId == null) {
    throw new Error("Une correspondance catalogue doit etre selectionnee.");
  }

  return {
    id: normalizeId(input.id, "L'identifiant de la correspondance") ?? undefined,
    requirementId: normalizeId(input.requirementId, "Le besoin rattache"),
    logicielId,
    softwareNameRaw,
    matchType,
    coverageStatus: assertCoverageStatus(input.coverageStatus),
    necessityLevel: normalizeText(input.necessityLevel, "Le niveau de necessite"),
    utilityText: normalizeOptionalText(input.utilityText),
    recommendedDecision: normalizeOptionalText(input.recommendedDecision),
    comment: normalizeOptionalText(input.comment),
    validatedByUser: Boolean(input.validatedByUser),
    status: assertRowStatus(input.status)
  };
}

export function validateGapMutationInput(input: GapMutationInput): GapMutationInput {
  return {
    id: normalizeId(input.id, "L'identifiant du manque") ?? undefined,
    requirementId: normalizeId(input.requirementId, "Le besoin rattache"),
    missingNeed: normalizeText(input.missingNeed, "Le besoin non couvert"),
    softwareTypeNeeded: normalizeOptionalText(input.softwareTypeNeeded),
    whyNeeded: normalizeOptionalText(input.whyNeeded),
    urgencyLevel: normalizeText(input.urgencyLevel, "Le niveau d'urgence"),
    exampleSoftwareOrCategory: normalizeOptionalText(input.exampleSoftwareOrCategory),
    recommendedAction: normalizeOptionalText(input.recommendedAction),
    status: assertRowStatus(input.status)
  };
}

export function validateConfirmationMutationInput(
  input: ConfirmationMutationInput
): ConfirmationMutationInput {
  return {
    id: normalizeId(input.id, "L'identifiant du point a confirmer") ?? undefined,
    topic: normalizeText(input.topic, "Le sujet"),
    questionText: normalizeText(input.questionText, "La question"),
    status: assertConfirmationStatus(input.status),
    resolutionNote: normalizeOptionalText(input.resolutionNote)
  };
}

export function validateSourceMutationInput(input: SourceMutationInput): SourceMutationInput {
  return {
    id: normalizeId(input.id, "L'identifiant de la source") ?? undefined,
    sourceLabel: normalizeText(input.sourceLabel, "Le libelle de la source"),
    fileName: normalizeOptionalText(input.fileName),
    sheetName: normalizeOptionalText(input.sheetName),
    sourceExcerpt: normalizeOptionalText(input.sourceExcerpt),
    comment: normalizeOptionalText(input.comment)
  };
}

export function validateSoftwareAnalysisTransitionAction(action: string) {
  if (!REVIEW_ACTIONS.has(action as SoftwareAnalysisTransitionAction)) {
    throw new Error("La transition d'analyse est invalide.");
  }
  return action as SoftwareAnalysisTransitionAction;
}

export function buildRequirementIdentityKey(input: {
  requirementText: string;
  explicitness: TenderSoftwareExplicitness;
  softwareNamesRaw: string;
}) {
  return [
    normalizeSoftwareComparisonName(input.requirementText),
    input.explicitness,
    normalizeSoftwareComparisonName(input.softwareNamesRaw)
  ].join("::");
}

export function buildMatchIdentityKey(input: {
  softwareNameRaw: string;
  necessityLevel: string;
  coverageStatus: TenderSoftwareCoverageStatus;
}) {
  return [
    normalizeSoftwareComparisonName(input.softwareNameRaw),
    normalizeSoftwareComparisonName(input.necessityLevel),
    input.coverageStatus
  ].join("::");
}

export function buildGapIdentityKey(input: {
  missingNeed: string;
  softwareTypeNeeded: string;
}) {
  return [
    normalizeSoftwareComparisonName(input.missingNeed),
    normalizeSoftwareComparisonName(input.softwareTypeNeeded)
  ].join("::");
}

export function buildConfirmationIdentityKey(input: {
  topic: string;
  questionText: string;
}) {
  return [
    normalizeSoftwareComparisonName(input.topic),
    normalizeSoftwareComparisonName(input.questionText)
  ].join("::");
}

export function buildSourceIdentityKey(input: {
  sourceLabel: string;
  fileName: string;
  comment: string;
}) {
  return [
    normalizeSoftwareComparisonName(input.sourceLabel),
    normalizeSoftwareComparisonName(input.fileName),
    normalizeSoftwareComparisonName(input.comment)
  ].join("::");
}
