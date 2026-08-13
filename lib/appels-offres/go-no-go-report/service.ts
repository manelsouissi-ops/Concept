import { appendAuditLog, getAppelOffresRecordByCode } from "../repository.ts";
import type { AppelOffresRecord } from "../types.ts";
import {
  getFciDetailByAppelOffresCode,
  listFciModuleDataVersions
} from "../fci/repository.ts";
import { indexLatestModuleData } from "../fci/presentation.ts";
import type {
  FciDetail,
  FciJsonObject,
  FciModuleCode,
  FciModuleDataRecord,
  FciModuleRecord
} from "../fci/types.ts";
import { readSourceFicheSnapshot } from "../fci/source-fiche.ts";
import {
  appendGoNoGoReportAuditEvent,
  getLatestGoNoGoReportByAppelOffresId,
  insertGoNoGoReport,
  listGoNoGoReportAuditEventsByAppelOffresId,
  listGoNoGoReportsByAppelOffresId,
  updateGoNoGoReport
} from "./repository.ts";
import type {
  GoNoGoReportEditablePayload,
  GoNoGoReportRecommendation,
  GoNoGoReportRecord,
  GoNoGoReportStatus
} from "./types.ts";
import { getLatestGoNoGoDecisionByAppelOffresId } from "../go-no-go/repository.ts";
import { listFciAssignmentsByAppelOffresId } from "../workflow/repository.ts";
import {
  buildUserPresentation,
  canAccess,
  canMakeFinalDecision,
  getAreaAccessDeniedMessage,
  type CurrentUser
} from "../../auth/rbac.ts";
import { getFallbackDevelopmentUser } from "../../auth/current-user.ts";
import { AuthError } from "../../auth/errors.ts";
import { createNotification } from "../../notifications/service.ts";
import { notifyDirectionGeneraleUsers } from "../../notifications/orchestration.ts";
import { assertCanCoordinateTender, getCommercialOwnership } from "../ownership.ts";

export type GoNoGoReportServiceErrorCode =
  | "AO_NOT_FOUND"
  | "RBAC_FORBIDDEN"
  | "FCI_NOT_VALIDATED"
  | "REPORT_NOT_FOUND"
  | "REPORT_INVALID_STATE"
  | "REPORT_VALIDATION_FAILED"
  | "REPORT_SOURCE_STALE"
  | "REPORT_FINAL_DECISION_EXISTS"
  | "INVALID_PAYLOAD"
  | "VERSION_CONFLICT";

export class GoNoGoReportServiceError extends Error {
  code: GoNoGoReportServiceErrorCode;
  status: number;
  details: Record<string, unknown> | null;

  constructor(
    code: GoNoGoReportServiceErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "GoNoGoReportServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type GoNoGoReportValidationIssue = {
  field: keyof GoNoGoReportEditablePayload | "source_snapshot";
  message: string;
};

export type SaveGoNoGoReportPayload = GoNoGoReportEditablePayload & {
  expectedVersion: number | null;
};

export type GoNoGoReportWorkspaceView = {
  current_user: ReturnType<typeof buildUserPresentation>;
  appel_offres: {
    code: string;
    title: string;
    business_status: string | null;
  };
  report: {
    id: number | null;
    version: number | null;
    status: GoNoGoReportStatus | null;
    is_stale: boolean;
    generated_from_fci_snapshot_at: string | null;
    prepared_at: string | null;
    submitted_at: string | null;
    editable_payload: GoNoGoReportEditablePayload | null;
    legacy_notice: string | null;
  };
  source_readiness: {
    source_snapshot_at: string | null;
    fiche_cdc_version: string | null;
    modules: Array<{
      module_code: "A" | "B" | "C" | "D";
      status: string;
      version: number | null;
      validated_at: string | null;
      validated_by: string | null;
    }>;
  };
  history: Array<{
    id: number;
    version: number;
    status: GoNoGoReportStatus;
    submitted_at: string | null;
    prepared_at: string | null;
    created_at: string;
  }>;
  permissions: {
    can_generate: boolean;
    can_edit: boolean;
    can_prepare: boolean;
    can_submit: boolean;
    can_regenerate: boolean;
    can_export: boolean;
    can_view_submitted: boolean;
  };
};

type ContributingModuleContext = {
  module: FciModuleRecord;
  latestData: FciModuleDataRecord;
};

type SourceSnapshot = FciJsonObject & {
  generated_at: string;
  ai: {
    used: boolean;
    mode: string;
    model: string | null;
    prompt_version: string | null;
    schema_version: string | null;
  };
  dossier: Record<string, unknown>;
  source_fiche: Record<string, unknown>;
  modules: Record<string, unknown>;
  assignments: Record<string, unknown>[];
};

type SourceSnapshotModuleState = {
  module_code: "A" | "B" | "C" | "D";
  version: number;
  validated_at: string | null;
  generated_from_fiche_version: string | null;
  generated_from_fiche_hash: string | null;
};

function normalizeCurrentUser(currentUser?: CurrentUser | null) {
  return currentUser ?? getFallbackDevelopmentUser();
}

function parseActorUserId(currentUser: CurrentUser) {
  const parsed = Number(currentUser.id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function assertCommercialCoordinator(currentUser: CurrentUser) {
  if (currentUser.role === "COMMERCIAL") {
    return;
  }

  throw new GoNoGoReportServiceError(
    "RBAC_FORBIDDEN",
    "Acces refuse : seul le Commercial peut preparer le rapport Go/No-Go.",
    403,
    { role: currentUser.role }
  );
}

function assertBusinessAccess(currentUser: CurrentUser) {
  if (canAccess(currentUser.role, "appels_offres")) {
    return;
  }

  throw new GoNoGoReportServiceError(
    "RBAC_FORBIDDEN",
    getAreaAccessDeniedMessage("appels_offres", currentUser.role),
    403,
    { role: currentUser.role }
  );
}

async function requireAppelOffres(code: string): Promise<AppelOffresRecord> {
  const appelOffres = await getAppelOffresRecordByCode(code, { includeArchived: true });
  if (!appelOffres) {
    throw new GoNoGoReportServiceError(
      "AO_NOT_FOUND",
      "Appel d'offres introuvable.",
      404,
      { code }
    );
  }

  return appelOffres;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseExpectedVersion(value: unknown) {
  if (value == null) {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new GoNoGoReportServiceError(
      "INVALID_PAYLOAD",
      "La version attendue est invalide.",
      422,
      { field: "expected_version" }
    );
  }

  return numeric;
}

function parseOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

export function parseSaveGoNoGoReportPayload(body: unknown): SaveGoNoGoReportPayload {
  if (!isPlainObject(body)) {
    throw new GoNoGoReportServiceError(
      "INVALID_PAYLOAD",
      "Le corps de la requete doit etre un objet JSON.",
      422
    );
  }

  return {
    executive_summary: parseOptionalText(body.executive_summary),
    project_overview: parseOptionalText(body.project_overview),
    commercial_summary: parseOptionalText(body.commercial_summary),
    financial_summary: parseOptionalText(body.financial_summary),
    operational_summary: parseOptionalText(body.operational_summary),
    key_strengths: parseOptionalText(body.key_strengths),
    key_risks: parseOptionalText(body.key_risks),
    reservations: parseOptionalText(body.reservations),
    assumptions: parseOptionalText(body.assumptions),
    unresolved_points: parseOptionalText(body.unresolved_points),
    commercial_recommendation: parseOptionalText(body.commercial_recommendation),
    ai_recommendation:
      typeof body.ai_recommendation === "string"
        ? body.ai_recommendation.trim() || null
        : null,
    recommended_decision:
      body.recommended_decision === "go" || body.recommended_decision === "no_go"
        ? body.recommended_decision
        : null,
    expectedVersion: parseExpectedVersion(body.expected_version)
  };
}

function buildEmptyEditablePayload(): GoNoGoReportEditablePayload {
  return {
    executive_summary: "",
    project_overview: "",
    commercial_summary: "",
    financial_summary: "",
    operational_summary: "",
    key_strengths: "",
    key_risks: "",
    reservations: "",
    assumptions: "",
    unresolved_points: "",
    commercial_recommendation: "",
    ai_recommendation: null,
    recommended_decision: null
  };
}

function humanizeKey(key: string) {
  return key.replaceAll("_", " ").trim();
}

function normalizeScalarValue(value: unknown) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

type ExtractedFact = {
  label: string;
  value: string | null;
  sourceType: string | null;
  requiresHumanInput: boolean;
};

function extractFactsFromPayload(
  value: unknown,
  prefix = ""
): ExtractedFact[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      extractFactsFromPayload(item, prefix ? `${prefix} ${index + 1}` : `${index + 1}`)
    );
  }

  if (!isPlainObject(value)) {
    return [];
  }

  if ("value" in value) {
    const label = prefix || "champ";
    return [
      {
        label,
        value: normalizeScalarValue(value.value),
        sourceType: typeof value.source_type === "string" ? value.source_type : null,
        requiresHumanInput: value.requires_human_input === true
      }
    ];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) =>
    extractFactsFromPayload(
      nestedValue,
      prefix ? `${prefix} > ${humanizeKey(key)}` : humanizeKey(key)
    )
  );
}

function uniqueLines(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function joinLines(lines: string[], fallback = "Information non disponible") {
  return lines.length > 0 ? lines.join("\n") : fallback;
}

function summarizeFacts(moduleCode: "A" | "B" | "C" | "D", facts: ExtractedFact[]) {
  const availableFacts = facts.filter((fact) => fact.value);
  const missingFacts = facts.filter(
    (fact) =>
      !fact.value
      || fact.requiresHumanInput
      || fact.sourceType === "internal_required"
      || fact.sourceType === "unavailable"
  );
  const riskFacts = facts.filter((fact) => {
    const text = `${fact.label} ${fact.value ?? ""}`.toLowerCase();
    return text.includes("risque")
      || text.includes("bloc")
      || text.includes("retard")
      || text.includes("cash")
      || text.includes("capacite");
  });
  const strengthFacts = facts.filter((fact) => {
    const text = `${fact.label} ${fact.value ?? ""}`.toLowerCase();
    return text.includes("avantage")
      || text.includes("force")
      || text.includes("atout")
      || text.includes("differentiel");
  });
  const reservationFacts = facts.filter((fact) => {
    const text = `${fact.label} ${fact.value ?? ""}`.toLowerCase();
    return text.includes("reserve")
      || text.includes("condition")
      || text.includes("confirmer");
  });
  const assumptionFacts = facts.filter((fact) => {
    const text = `${fact.label} ${fact.value ?? ""}`.toLowerCase();
    return text.includes("hypoth")
      || text.includes("estimer")
      || text.includes("prevision");
  });

  const summaryLines = availableFacts
    .slice(0, 6)
    .map((fact) => `${fact.label}: ${fact.value}`);
  const unresolvedLines = missingFacts
    .slice(0, 8)
    .map((fact) => `${fact.label}: ${fact.value ?? "Information non disponible"}`);
  const riskLines = uniqueLines(
    riskFacts.slice(0, 8).map((fact) => `${fact.label}: ${fact.value ?? "Information non disponible"}`)
  );
  const strengthLines = uniqueLines(
    strengthFacts.slice(0, 8).map((fact) => `${fact.label}: ${fact.value ?? "Information non disponible"}`)
  );
  const reservationLines = uniqueLines(
    reservationFacts.slice(0, 8).map((fact) => `${fact.label}: ${fact.value ?? "A confirmer"}`)
  );
  const assumptionLines = uniqueLines(
    assumptionFacts.slice(0, 8).map((fact) => `${fact.label}: ${fact.value ?? "A confirmer"}`)
  );

  const recommendationFallback =
    moduleCode === "A"
      ? "A confirmer par le Commercial."
      : moduleCode === "B"
        ? "A confirmer par la Finance."
        : moduleCode === "C"
          ? "A confirmer par les Operations."
          : "A confirmer par la Direction Generale.";

  return {
    summary: joinLines(summaryLines),
    unresolved: joinLines(unresolvedLines, "Aucun point non resolu explicite."),
    risks: joinLines(riskLines, "Information non disponible"),
    strengths: joinLines(strengthLines, "Information non disponible"),
    reservations: joinLines(reservationLines, "A confirmer"),
    assumptions: joinLines(assumptionLines, "A confirmer"),
    recommendation: availableFacts[0]?.value ?? recommendationFallback,
    facts: availableFacts.map((fact) => ({
      label: fact.label,
      value: fact.value,
      source_type: fact.sourceType,
      requires_human_input: fact.requiresHumanInput
    })),
    missing_facts: missingFacts.map((fact) => ({
      label: fact.label,
      source_type: fact.sourceType,
      requires_human_input: fact.requiresHumanInput
    }))
  };
}

function pickProjectOverview(appelOffres: AppelOffresRecord, sourceFiche: {
  version: string;
  hash: string;
  updatedAt: string;
  fiche: { extraction: Array<{ label: string; value: string | null }> };
}) {
  const extractionLines = sourceFiche.fiche.extraction
    .slice(0, 6)
    .map((field) => `${field.label}: ${field.value ?? "Information non disponible"}`);

  return joinLines(
    [
      `Code dossier: ${appelOffres.code}`,
      `Projet: ${appelOffres.title}`,
      `Client: ${appelOffres.buyer || "Information non disponible"}`,
      `Pays: ${appelOffres.country || "Information non disponible"}`,
      `Date limite: ${appelOffres.dueDate ?? "Information non disponible"}`,
      `Version Fiche CDC: ${sourceFiche.version}`,
      ...extractionLines
    ],
    "Information non disponible"
  );
}

async function requireValidatedContributingSources(code: string) {
  const [appelOffres, sourceFiche, fciDetail] = await Promise.all([
    requireAppelOffres(code),
    readSourceFicheSnapshot(code),
    getFciDetailByAppelOffresCode(code)
  ]);

  if (!sourceFiche) {
    throw new GoNoGoReportServiceError(
      "FCI_NOT_VALIDATED",
      "La Fiche CDC doit etre validee avant generation du rapport Go/No-Go.",
      409,
      { code }
    );
  }

  if (!fciDetail) {
    throw new GoNoGoReportServiceError(
      "FCI_NOT_VALIDATED",
      "Les quatre contributions departementales doivent exister et etre validees avant generation du rapport.",
      409,
      { code }
    );
  }

  const latestDataByModuleId = indexLatestModuleData(fciDetail.moduleData);
  const contributingModules: ContributingModuleContext[] = [];
  for (const moduleCode of ["A", "B", "C", "D"] as const) {
    const module = fciDetail.modules.find((entry) => entry.moduleCode === moduleCode);
    if (!module || module.status !== "validated") {
      throw new GoNoGoReportServiceError(
        "FCI_NOT_VALIDATED",
        `La contribution ${moduleCode} doit etre validee avant generation du rapport.`,
        409,
        { module_code: moduleCode }
      );
    }

    const latestData = latestDataByModuleId.get(module.id) ?? null;
    if (!latestData) {
      throw new GoNoGoReportServiceError(
        "FCI_NOT_VALIDATED",
        `La contribution ${moduleCode} ne contient aucune version exploitable.`,
        409,
        { module_code: moduleCode }
      );
    }

    contributingModules.push({ module, latestData });
  }

  const assignments = await listFciAssignmentsByAppelOffresId(appelOffres.id);
  const hasB = assignments.some((assignment) => assignment.moduleCode === "B");
  const hasC = assignments.some((assignment) => assignment.moduleCode === "C");
  const hasD = assignments.some((assignment) => assignment.moduleCode === "D");
  if (!hasB || !hasC || !hasD) {
    throw new GoNoGoReportServiceError(
      "FCI_NOT_VALIDATED",
      "Les contributions Financiere, Operationnelle et Direction Generale doivent rester affectees avant generation du rapport.",
      409,
      { has_b: hasB, has_c: hasC, has_d: hasD }
    );
  }

  return {
    appelOffres,
    sourceFiche,
    fciDetail,
    contributingModules,
    assignments
  };
}

function normalizeEditablePayloadFromRecord(
  report: GoNoGoReportRecord | null
): GoNoGoReportEditablePayload | null {
  if (!report) {
    return null;
  }

  const payload = isPlainObject(report.editablePayloadJson)
    ? report.editablePayloadJson
    : null;

  if (!payload) {
    return {
      executive_summary: report.executiveSummary ?? "",
      project_overview: report.projectOverview ?? "",
      commercial_summary: report.commercialSummary ?? "",
      financial_summary: report.financialSummary ?? "",
      operational_summary: report.operationalSummary ?? "",
      key_strengths: report.keyStrengths ?? "",
      key_risks: report.keyRisks ?? "",
      reservations: report.reservations ?? "",
      assumptions: report.assumptions ?? "",
      unresolved_points: report.unresolvedPoints ?? "",
      commercial_recommendation: report.commercialRecommendation ?? "",
      ai_recommendation: report.aiRecommendation ?? null,
      recommended_decision: report.recommendedDecision ?? null
    };
  }

  return {
    executive_summary: typeof payload.executive_summary === "string" ? payload.executive_summary : "",
    project_overview: typeof payload.project_overview === "string" ? payload.project_overview : "",
    commercial_summary: typeof payload.commercial_summary === "string" ? payload.commercial_summary : "",
    financial_summary: typeof payload.financial_summary === "string" ? payload.financial_summary : "",
    operational_summary: typeof payload.operational_summary === "string" ? payload.operational_summary : "",
    key_strengths: typeof payload.key_strengths === "string" ? payload.key_strengths : "",
    key_risks: typeof payload.key_risks === "string" ? payload.key_risks : "",
    reservations: typeof payload.reservations === "string" ? payload.reservations : "",
    assumptions: typeof payload.assumptions === "string" ? payload.assumptions : "",
    unresolved_points: typeof payload.unresolved_points === "string" ? payload.unresolved_points : "",
    commercial_recommendation:
      typeof payload.commercial_recommendation === "string"
        ? payload.commercial_recommendation
        : "",
    ai_recommendation:
      typeof payload.ai_recommendation === "string"
        ? payload.ai_recommendation
        : null,
    recommended_decision:
      payload.recommended_decision === "go" || payload.recommended_decision === "no_go"
        ? payload.recommended_decision
        : null
  };
}

function buildReportPatchFromEditablePayload(payload: GoNoGoReportEditablePayload) {
  return {
    executiveSummary: payload.executive_summary,
    projectOverview: payload.project_overview,
    commercialSummary: payload.commercial_summary,
    financialSummary: payload.financial_summary,
    operationalSummary: payload.operational_summary,
    keyStrengths: payload.key_strengths,
    keyRisks: payload.key_risks,
    reservations: payload.reservations,
    assumptions: payload.assumptions,
    unresolvedPoints: payload.unresolved_points,
    commercialRecommendation: payload.commercial_recommendation,
    aiRecommendation: payload.ai_recommendation,
    recommendedDecision: payload.recommended_decision,
    editablePayloadJson: payload satisfies FciJsonObject
  };
}

function getActiveReport(reports: GoNoGoReportRecord[]) {
  return reports.find(
    (report) => report.status !== "SUPERSEDED" && report.status !== "ARCHIVED"
  ) ?? null;
}

function getSubmittedReport(reports: GoNoGoReportRecord[]) {
  return reports.find((report) => report.status === "SUBMITTED_TO_DG") ?? null;
}

function getSnapshotModuleState(
  report: GoNoGoReportRecord | null,
  moduleCode: "A" | "B" | "C" | "D"
): SourceSnapshotModuleState | null {
  const modules = report?.sourceSnapshotJson?.modules;
  if (!isPlainObject(modules)) {
    return null;
  }

  const moduleState = modules[moduleCode];
  if (!isPlainObject(moduleState)) {
    return null;
  }

  const version = Number(moduleState.version);
  if (!Number.isInteger(version) || version < 1) {
    return null;
  }

  return {
    module_code: moduleCode,
    version,
    validated_at:
      typeof moduleState.validated_at === "string" ? moduleState.validated_at : null,
    generated_from_fiche_version:
      typeof moduleState.generated_from_fiche_version === "string"
        ? moduleState.generated_from_fiche_version
        : null,
    generated_from_fiche_hash:
      typeof moduleState.generated_from_fiche_hash === "string"
        ? moduleState.generated_from_fiche_hash
        : null
  };
}

export async function isGoNoGoReportStale(
  code: string,
  report: GoNoGoReportRecord | null
) {
  if (!report?.sourceSnapshotJson) {
    return false;
  }

  let current;
  try {
    current = await requireValidatedContributingSources(code);
  } catch (error) {
    if (error instanceof GoNoGoReportServiceError && error.code === "FCI_NOT_VALIDATED") {
      // Active legacy dossiers with an A/B/C report but no validated D must
      // be treated as stale, not crash workspace loading or be decision-ready.
      return true;
    }
    throw error;
  }
  const snapshotSource = report.sourceSnapshotJson.source_fiche;
  if (
    !isPlainObject(snapshotSource)
    || snapshotSource.version !== current.sourceFiche.version
    || snapshotSource.hash !== current.sourceFiche.hash
  ) {
    return true;
  }

  for (const moduleCode of ["A", "B", "C", "D"] as const) {
    const snapshotModule = getSnapshotModuleState(report, moduleCode);
    const currentModule = current.contributingModules.find(
      (entry) => entry.module.moduleCode === moduleCode
    );
    if (!snapshotModule || !currentModule) {
      return true;
    }

    if (snapshotModule.version !== currentModule.latestData.version) {
      return true;
    }

    if (snapshotModule.validated_at !== currentModule.module.validatedAt) {
      return true;
    }
  }

  return false;
}

function buildValidationIssues(
  report: GoNoGoReportRecord | null,
  payload: GoNoGoReportEditablePayload | null,
  isStale: boolean
): GoNoGoReportValidationIssue[] {
  const editable = payload ?? buildEmptyEditablePayload();
  const issues: GoNoGoReportValidationIssue[] = [];
  const requiredFields: Array<keyof GoNoGoReportEditablePayload> = [
    "executive_summary",
    "commercial_summary",
    "financial_summary",
    "operational_summary",
    "key_risks",
    "commercial_recommendation"
  ];

  for (const field of requiredFields) {
    if (!editable[field]?.trim()) {
      issues.push({
        field,
        message: "Ce champ est obligatoire avant preparation."
      });
    }
  }

  if (!editable.recommended_decision) {
    issues.push({
      field: "recommended_decision",
      message: "La proposition GO / NO-GO est obligatoire avant preparation."
    });
  }

  if (!report?.sourceSnapshotJson) {
    issues.push({
      field: "source_snapshot",
      message: "Le rapport doit conserver un snapshot source avant preparation."
    });
  }

  if (isStale) {
    issues.push({
      field: "source_snapshot",
      message: "Le rapport repose sur un snapshot source obsolete. Regenerez une nouvelle version."
    });
  }

  return issues;
}

async function buildGeneratedDraft(
  code: string
): Promise<{
  editablePayload: GoNoGoReportEditablePayload;
  sourceSnapshot: SourceSnapshot;
  appelOffres: AppelOffresRecord;
}> {
  const context = await requireValidatedContributingSources(code);
  const generatedAt = new Date().toISOString();
  const summaryByModule = new Map<"A" | "B" | "C" | "D", ReturnType<typeof summarizeFacts>>();
  const moduleSnapshots: Record<string, unknown> = {};
  const allStrengths: string[] = [];
  const allRisks: string[] = [];
  const allReservations: string[] = [];
  const allAssumptions: string[] = [];
  const allUnresolved: string[] = [];

  for (const entry of context.contributingModules) {
    const facts = extractFactsFromPayload(entry.latestData.dataJson);
    const summary = summarizeFacts(entry.module.moduleCode as "A" | "B" | "C" | "D", facts);
    summaryByModule.set(entry.module.moduleCode as "A" | "B" | "C" | "D", summary);
    allStrengths.push(...summary.strengths.split("\n"));
    allRisks.push(...summary.risks.split("\n"));
    allReservations.push(...summary.reservations.split("\n"));
    allAssumptions.push(...summary.assumptions.split("\n"));
    allUnresolved.push(...summary.unresolved.split("\n"));
    moduleSnapshots[entry.module.moduleCode] = {
      module_id: entry.module.id,
      version: entry.latestData.version,
      status: entry.module.status,
      validated_at: entry.module.validatedAt,
      validated_by: entry.module.validatedBy,
      generated_from_fiche_version: entry.latestData.generatedFromFicheVersion,
      generated_from_fiche_hash: entry.latestData.generatedFromFicheHash,
      summary_status: isPlainObject(entry.latestData.dataJson.summary)
        ? entry.latestData.dataJson.summary.status ?? null
        : null,
      completion_percentage: isPlainObject(entry.latestData.dataJson.summary)
        ? entry.latestData.dataJson.summary.completion_percentage ?? null
        : null,
      facts: summary.facts.slice(0, 20),
      missing_facts: summary.missing_facts.slice(0, 20)
    };
  }

  const projectOverview = pickProjectOverview(context.appelOffres, {
    version: context.sourceFiche.version,
    hash: context.sourceFiche.hash,
    updatedAt: context.sourceFiche.updatedAt,
    fiche: context.sourceFiche.fiche as {
      extraction: Array<{ label: string; value: string | null }>;
    }
  });
  const executiveSummary = joinLines(
    [
      `Rapport consolide genere le ${generatedAt} a partir des quatre contributions departementales validees.`,
      `Projet: ${context.appelOffres.title}`,
      `Client: ${context.appelOffres.buyer || "Information non disponible"}`,
      `Points forts: ${uniqueLines(allStrengths).slice(0, 3).join(" ; ") || "Information non disponible"}`,
      `Risques majeurs: ${uniqueLines(allRisks).slice(0, 3).join(" ; ") || "Information non disponible"}`
    ],
    "Information non disponible"
  );

  const editablePayload: GoNoGoReportEditablePayload = {
    executive_summary: executiveSummary,
    project_overview: projectOverview,
    commercial_summary:
      summaryByModule.get("A")?.summary ?? "Information non disponible",
    financial_summary:
      summaryByModule.get("B")?.summary ?? "Information non disponible",
    operational_summary:
      summaryByModule.get("C")?.summary ?? "Information non disponible",
    key_strengths: joinLines(uniqueLines(allStrengths), "Information non disponible"),
    key_risks: joinLines(uniqueLines(allRisks), "Information non disponible"),
    reservations: joinLines(uniqueLines(allReservations), "A confirmer"),
    assumptions: joinLines(uniqueLines(allAssumptions), "A confirmer"),
    unresolved_points: joinLines(uniqueLines(allUnresolved), "Aucun point non resolu explicite."),
    commercial_recommendation:
      summaryByModule.get("A")?.recommendation ?? "A confirmer par le Commercial.",
    ai_recommendation: null,
    recommended_decision: null
  };

  const sourceSnapshot: SourceSnapshot = {
    generated_at: generatedAt,
    ai: {
      used: false,
      mode: "deterministic_fallback",
      model: null,
      prompt_version: null,
      schema_version: "phase4.v1"
    },
    dossier: {
      code: context.appelOffres.code,
      title: context.appelOffres.title,
      buyer: context.appelOffres.buyer,
      due_date: context.appelOffres.dueDate,
      country: context.appelOffres.country,
      business_status: context.appelOffres.businessStatus,
      updated_at: context.appelOffres.updatedAt
    },
    source_fiche: {
      version: context.sourceFiche.version,
      hash: context.sourceFiche.hash,
      validated_at: context.sourceFiche.status.validatedAt ?? null,
      extraction: context.sourceFiche.fiche.extraction.slice(0, 12)
    },
    modules: moduleSnapshots,
    assignments: context.assignments.map((assignment) => ({
      module_code: assignment.moduleCode,
      assigned_user_id: assignment.assignedUserId,
      assigned_role: assignment.assignedRole,
      assigned_department_code: assignment.assignedDepartmentCode,
      assignment_status: assignment.assignmentStatus,
      assigned_at: assignment.assignedAt,
      reassigned_at: assignment.reassignedAt
    }))
  };

  return {
    editablePayload,
    sourceSnapshot,
    appelOffres: context.appelOffres
  };
}

function ensureNoFinalDecision(
  latestDecision: Awaited<ReturnType<typeof getLatestGoNoGoDecisionByAppelOffresId>>
) {
  if (latestDecision && (latestDecision.status === "go" || latestDecision.status === "no_go")) {
    throw new GoNoGoReportServiceError(
      "REPORT_FINAL_DECISION_EXISTS",
      "Le rapport Go/No-Go ne peut plus etre regenere apres une decision finale DG.",
      409,
      { decision_status: latestDecision.status, decision_version: latestDecision.version }
    );
  }
}

async function supersedeReport(
  code: string,
  report: GoNoGoReportRecord,
  actor: CurrentUser,
  payload: Record<string, unknown>
) {
  const actorUserId = parseActorUserId(actor);
  await updateGoNoGoReport(report.id, {
    status: "SUPERSEDED",
    reopenedAt: new Date().toISOString()
  });
  await appendGoNoGoReportAuditEvent({
    goNoGoReportId: report.id,
    appelOffresId: report.appelOffresId,
    eventType: "REPORT_SUPERSEDED",
    actorUserId,
    actorName: actor.name,
    payloadJson: payload
  });
  await appendAuditLog(
    code,
    "go_no_go_report.superseded",
    payload,
    actor.name
  );

  if (actorUserId != null) {
    await createNotification({
      recipientUserId: actorUserId,
      recipientRole: actor.role,
      appelOffreCode: code,
      eventType: "GONOGO_REPORT_REOPENED",
      actorUserId,
      metadata: {
        actorName: actor.name,
        reportVersion: report.version
      },
      section: "go-no-go"
    });
  }
}

export async function generateGoNoGoReport(
  code: string,
  currentUser?: CurrentUser | null,
  options?: { forceNewVersion?: boolean }
) {
  const actor = normalizeCurrentUser(currentUser);
  assertBusinessAccess(actor);
  assertCommercialCoordinator(actor);
  await assertCanCoordinateTender(code, actor);

  const [appelOffres, latestDecision, reports] = await Promise.all([
    requireAppelOffres(code),
    (async () => {
      const record = await requireAppelOffres(code);
      return getLatestGoNoGoDecisionByAppelOffresId(record.id);
    })(),
    (async () => {
      const record = await requireAppelOffres(code);
      return listGoNoGoReportsByAppelOffresId(record.id);
    })()
  ]);
  ensureNoFinalDecision(latestDecision);

  const activeReport = getActiveReport(reports);
  if (activeReport && !options?.forceNewVersion) {
    return activeReport;
  }

  const actorUserId = parseActorUserId(actor);
  if (activeReport) {
    await supersedeReport(code, activeReport, actor, {
      reason: "new_report_version_generated",
      previous_report_id: activeReport.id,
      previous_report_version: activeReport.version
    });
  }

  const nextVersion = (reports[0]?.version ?? 0) + 1;
  const generated = await buildGeneratedDraft(code);
  const status: GoNoGoReportStatus =
    buildValidationIssues(null, generated.editablePayload, false).length === 0
      ? "READY_FOR_REVIEW"
      : "DRAFT";

  const created = await insertGoNoGoReport(appelOffres.id, {
    version: nextVersion,
    status,
    generatedFromFciSnapshotAt: generated.sourceSnapshot.generated_at,
    generatedByUserId: actorUserId,
    commercialOwnerUserId: (await getCommercialOwnership(code)).owner.userId ?? actorUserId,
    supersedesReportId: activeReport?.id ?? null,
    sourceSnapshotJson: generated.sourceSnapshot,
    ...buildReportPatchFromEditablePayload(generated.editablePayload)
  });

  await appendGoNoGoReportAuditEvent({
    goNoGoReportId: created.id,
    appelOffresId: appelOffres.id,
    eventType: "REPORT_GENERATED",
    actorUserId,
    actorName: actor.name,
    payloadJson: {
      version: created.version,
      status: created.status
    }
  });
  await appendAuditLog(
    code,
    "go_no_go_report.generated",
    {
      report_id: created.id,
      version: created.version,
      status: created.status
    },
    actor.name
  );
  if (actorUserId != null) {
    await createNotification({
      recipientUserId: actorUserId,
      recipientRole: actor.role,
      appelOffreCode: code,
      eventType: created.status === "READY_FOR_REVIEW"
        ? "GONOGO_REPORT_READY_FOR_REVIEW"
        : "GONOGO_REPORT_GENERATED",
      actorUserId,
      metadata: {
        actorName: actor.name,
        reportVersion: created.version
      },
      section: "go-no-go"
    });
  }

  return created;
}

async function requireReportForEditing(
  code: string,
  currentUser?: CurrentUser | null
) {
  const actor = normalizeCurrentUser(currentUser);
  assertBusinessAccess(actor);
  assertCommercialCoordinator(actor);
  await assertCanCoordinateTender(code, actor);

  const appelOffres = await requireAppelOffres(code);
  const reports = await listGoNoGoReportsByAppelOffresId(appelOffres.id);
  const activeReport = getActiveReport(reports);
  if (!activeReport) {
    throw new GoNoGoReportServiceError(
      "REPORT_NOT_FOUND",
      "Aucun rapport Go/No-Go actif n'est disponible pour ce dossier.",
      404,
      { code }
    );
  }

  const latestDecision = await getLatestGoNoGoDecisionByAppelOffresId(appelOffres.id);
  ensureNoFinalDecision(latestDecision);

  return {
    actor,
    appelOffres,
    reports,
    activeReport
  };
}

export async function saveGoNoGoReportDraft(
  code: string,
  payload: SaveGoNoGoReportPayload,
  currentUser?: CurrentUser | null
) {
  const { actor, activeReport } = await requireReportForEditing(code, currentUser);

  if (payload.expectedVersion != null && activeReport.version !== payload.expectedVersion) {
    throw new GoNoGoReportServiceError(
      "VERSION_CONFLICT",
      "Le rapport a change depuis votre derniere lecture.",
      409,
      {
        expected_version: payload.expectedVersion,
        actual_version: activeReport.version
      }
    );
  }

  if (activeReport.status === "SUBMITTED_TO_DG") {
    throw new GoNoGoReportServiceError(
      "REPORT_INVALID_STATE",
      "Un rapport deja soumis a la DG ne peut pas etre modifie. Regenerez une nouvelle version.",
      409,
      { status: activeReport.status }
    );
  }

  const stale = await isGoNoGoReportStale(code, activeReport);
  const nextStatus: GoNoGoReportStatus =
    buildValidationIssues(activeReport, payload, stale).length === 0
      ? "READY_FOR_REVIEW"
      : "DRAFT";

  const updated = await updateGoNoGoReport(activeReport.id, {
    status: nextStatus,
    ...buildReportPatchFromEditablePayload(payload)
  });
  if (!updated) {
    throw new GoNoGoReportServiceError(
      "REPORT_NOT_FOUND",
      "Rapport Go/No-Go introuvable apres sauvegarde.",
      404
    );
  }

  await appendGoNoGoReportAuditEvent({
    goNoGoReportId: updated.id,
    appelOffresId: updated.appelOffresId,
    eventType: "REPORT_EDITED",
    actorUserId: parseActorUserId(actor),
    actorName: actor.name,
    payloadJson: {
      version: updated.version,
      status: updated.status
    }
  });
  await appendAuditLog(
    code,
    "go_no_go_report.edited",
    {
      report_id: updated.id,
      version: updated.version,
      status: updated.status
    },
    actor.name
  );
  if (stale) {
    const actorUserId = parseActorUserId(actor);
    if (actorUserId != null) {
      await createNotification({
        recipientUserId: actorUserId,
        recipientRole: actor.role,
        appelOffreCode: code,
        eventType: "GONOGO_REPORT_STALE",
        actorUserId,
        metadata: {
          actorName: actor.name,
          reportVersion: updated.version
        },
        section: "go-no-go"
      });
    }
  }

  return updated;
}

export async function prepareGoNoGoReportForWorkflow(
  code: string,
  currentUser?: CurrentUser | null
) {
  const { actor, activeReport } = await requireReportForEditing(code, currentUser);
  const editablePayload = normalizeEditablePayloadFromRecord(activeReport);
  const stale = await isGoNoGoReportStale(code, activeReport);
  const issues = buildValidationIssues(activeReport, editablePayload, stale);
  if (issues.length > 0) {
    throw new GoNoGoReportServiceError(
      "REPORT_VALIDATION_FAILED",
      "Le rapport Go/No-Go doit etre complet et a jour avant preparation.",
      422,
      { validation_errors: issues }
    );
  }

  const updated = await updateGoNoGoReport(activeReport.id, {
    status: "PREPARED",
    preparedByUserId: parseActorUserId(actor),
    preparedAt: new Date().toISOString()
  });
  if (!updated) {
    throw new GoNoGoReportServiceError(
      "REPORT_NOT_FOUND",
      "Rapport Go/No-Go introuvable apres preparation.",
      404
    );
  }

  await appendGoNoGoReportAuditEvent({
    goNoGoReportId: updated.id,
    appelOffresId: updated.appelOffresId,
    eventType: "REPORT_PREPARED",
    actorUserId: parseActorUserId(actor),
    actorName: actor.name,
    payloadJson: {
      version: updated.version
    }
  });
  await appendAuditLog(
    code,
    "go_no_go_report.prepared",
    {
      report_id: updated.id,
      version: updated.version
    },
    actor.name
  );
  const actorUserId = parseActorUserId(actor);
  if (actorUserId != null) {
    await createNotification({
      recipientUserId: actorUserId,
      recipientRole: actor.role,
      appelOffreCode: code,
      eventType: "GONOGO_REPORT_PREPARED",
      actorUserId,
      metadata: {
        actorName: actor.name,
        reportVersion: updated.version
      },
      section: "go-no-go"
    });
  }

  return updated;
}

export async function submitGoNoGoReportForWorkflow(
  code: string,
  currentUser?: CurrentUser | null
) {
  const { actor, activeReport } = await requireReportForEditing(code, currentUser);
  if (activeReport.status !== "PREPARED" && activeReport.status !== "SUBMITTED_TO_DG") {
    throw new GoNoGoReportServiceError(
      "REPORT_INVALID_STATE",
      "Le dernier rapport doit etre PREPARED avant soumission a la DG.",
      409,
      { status: activeReport.status }
    );
  }

  const stale = await isGoNoGoReportStale(code, activeReport);
  if (stale) {
    throw new GoNoGoReportServiceError(
      "REPORT_SOURCE_STALE",
      "Le rapport soumis serait obsolete. Regenerez une nouvelle version avant envoi a la DG.",
      409,
      { report_id: activeReport.id, version: activeReport.version }
    );
  }

  if (activeReport.status === "SUBMITTED_TO_DG") {
    return activeReport;
  }

  const updated = await updateGoNoGoReport(activeReport.id, {
    status: "SUBMITTED_TO_DG",
    submittedByUserId: parseActorUserId(actor),
    submittedAt: new Date().toISOString()
  });
  if (!updated) {
    throw new GoNoGoReportServiceError(
      "REPORT_NOT_FOUND",
      "Rapport Go/No-Go introuvable apres soumission.",
      404
    );
  }

  await appendGoNoGoReportAuditEvent({
    goNoGoReportId: updated.id,
    appelOffresId: updated.appelOffresId,
    eventType: "REPORT_SUBMITTED",
    actorUserId: parseActorUserId(actor),
    actorName: actor.name,
    payloadJson: {
      version: updated.version
    }
  });
  await appendAuditLog(
    code,
    "go_no_go_report.submitted",
    {
      report_id: updated.id,
      version: updated.version
    },
    actor.name
  );
  const actorUserId = parseActorUserId(actor);
  if (actorUserId != null) {
    await createNotification({
      recipientUserId: actorUserId,
      recipientRole: actor.role,
      appelOffreCode: code,
      eventType: "GONOGO_REPORT_SUBMITTED",
      actorUserId,
      metadata: {
        actorName: actor.name,
        reportVersion: updated.version
      },
      section: "go-no-go"
    });
  }
  await notifyDirectionGeneraleUsers({
    appelOffreCode: code,
    eventType: "GONOGO_REPORT_SUBMITTED",
    currentUser: actor
  });

  return updated;
}

export async function assertGoNoGoReportPreparedForSubmission(
  code: string,
  currentUser?: CurrentUser | null
) {
  const { activeReport } = await requireReportForEditing(code, currentUser);
  if (activeReport.status !== "PREPARED" && activeReport.status !== "SUBMITTED_TO_DG") {
    throw new GoNoGoReportServiceError(
      "REPORT_INVALID_STATE",
      "Le dernier rapport doit etre PREPARED avant soumission a la DG.",
      409,
      { status: activeReport.status }
    );
  }

  const stale = await isGoNoGoReportStale(code, activeReport);
  if (stale) {
    throw new GoNoGoReportServiceError(
      "REPORT_SOURCE_STALE",
      "Le rapport soumis serait obsolete. Regenerez une nouvelle version avant envoi a la DG.",
      409,
      { report_id: activeReport.id, version: activeReport.version }
    );
  }

  return activeReport;
}

export async function regenerateGoNoGoReport(
  code: string,
  currentUser?: CurrentUser | null
) {
  return generateGoNoGoReport(code, currentUser, { forceNewVersion: true });
}

export async function getSubmittedGoNoGoReportForDecision(
  code: string
): Promise<{ report: GoNoGoReportRecord | null; isStale: boolean }> {
  const appelOffres = await requireAppelOffres(code);
  const reports = await listGoNoGoReportsByAppelOffresId(appelOffres.id);
  const submittedReport = getSubmittedReport(reports);

  if (!submittedReport) {
    return { report: null, isStale: false };
  }

  return {
    report: submittedReport,
    isStale: await isGoNoGoReportStale(code, submittedReport)
  };
}

export async function getGoNoGoReportWorkspace(
  code: string,
  currentUser?: CurrentUser | null
): Promise<GoNoGoReportWorkspaceView> {
  const actor = normalizeCurrentUser(currentUser);
  assertBusinessAccess(actor);

  const appelOffres = await requireAppelOffres(code);
  const [fciDetail, reports, latestDecision] = await Promise.all([
    getFciDetailByAppelOffresCode(code),
    listGoNoGoReportsByAppelOffresId(appelOffres.id),
    getLatestGoNoGoDecisionByAppelOffresId(appelOffres.id)
  ]);

  const activeReport = getActiveReport(reports);
  const submittedForDg =
    actor.role === "DIRECTION_GENERALE"
      ? getSubmittedReport(reports)
      : activeReport;

  if (
    actor.role === "DIRECTION_GENERALE"
    && !submittedForDg
    && latestDecision
    && (latestDecision.status === "go" || latestDecision.status === "no_go")
  ) {
    return {
      current_user: buildUserPresentation(actor),
      appel_offres: {
        code: appelOffres.code,
        title: appelOffres.title,
        business_status: appelOffres.businessStatus
      },
      report: {
        id: null,
        version: null,
        status: null,
        is_stale: false,
        generated_from_fci_snapshot_at: null,
        prepared_at: null,
        submitted_at: null,
        editable_payload: null,
        legacy_notice: "Rapport consolide non disponible pour cette ancienne decision."
      },
      source_readiness: {
        source_snapshot_at: null,
        fiche_cdc_version: null,
        modules: []
      },
      history: [],
      permissions: {
        can_generate: false,
        can_edit: false,
        can_prepare: false,
        can_submit: false,
        can_regenerate: false,
        can_export: false,
        can_view_submitted: false
      }
    };
  }

  if (actor.role === "DIRECTION_GENERALE" && !submittedForDg) {
    throw new GoNoGoReportServiceError(
      "RBAC_FORBIDDEN",
      "La Direction generale ne peut consulter le rapport Go/No-Go qu'apres soumission du Commercial.",
      403,
      { role: actor.role }
    );
  }

  const referenceReport = submittedForDg ?? activeReport;
  const isStale = referenceReport
    ? await isGoNoGoReportStale(code, referenceReport)
    : false;
  const canGenerate = actor.role === "COMMERCIAL" && !latestDecision;
  const canEdit =
    actor.role === "COMMERCIAL"
    && referenceReport != null
    && referenceReport.status !== "SUBMITTED_TO_DG";
  const canPrepare =
    actor.role === "COMMERCIAL"
    && referenceReport != null
    && referenceReport.status !== "SUBMITTED_TO_DG"
    && !isStale;
  const canSubmit =
    actor.role === "COMMERCIAL"
    && referenceReport?.status === "PREPARED"
    && !isStale;
  const canRegenerate =
    actor.role === "COMMERCIAL"
    && !(latestDecision && (latestDecision.status === "go" || latestDecision.status === "no_go"));
  const canExport = actor.role === "COMMERCIAL" || actor.role === "DIRECTION_GENERALE";
  const canViewSubmitted =
    actor.role === "DIRECTION_GENERALE"
    ? referenceReport?.status === "SUBMITTED_TO_DG"
    : Boolean(referenceReport);

  const modules = fciDetail
    ? await Promise.all(
        (["A", "B", "C", "D"] as const).map(async (moduleCode) => {
          const module = fciDetail.modules.find((entry) => entry.moduleCode === moduleCode) ?? null;
          if (!module) {
            return {
              module_code: moduleCode,
              status: "not_started",
              version: null,
              validated_at: null,
              validated_by: null
            };
          }

          const versions = await listFciModuleDataVersions(module.id);
          return {
            module_code: moduleCode,
            status: module.status,
            version: versions[0]?.version ?? null,
            validated_at: module.validatedAt,
            validated_by: module.validatedBy
          };
        })
      )
    : [];

  const sourceSnapshotAt =
    typeof referenceReport?.sourceSnapshotJson?.generated_at === "string"
      ? referenceReport.sourceSnapshotJson.generated_at
      : null;
  const ficheVersion =
    typeof referenceReport?.sourceSnapshotJson?.source_fiche === "object"
      && referenceReport.sourceSnapshotJson.source_fiche != null
      && "version" in referenceReport.sourceSnapshotJson.source_fiche
      && typeof (referenceReport.sourceSnapshotJson.source_fiche as Record<string, unknown>).version === "string"
      ? ((referenceReport.sourceSnapshotJson.source_fiche as Record<string, unknown>).version as string)
      : null;

  return {
    current_user: buildUserPresentation(actor),
    appel_offres: {
      code: appelOffres.code,
      title: appelOffres.title,
      business_status: appelOffres.businessStatus
    },
    report: {
      id: referenceReport?.id ?? null,
      version: referenceReport?.version ?? null,
      status: referenceReport?.status ?? null,
      is_stale: isStale,
      generated_from_fci_snapshot_at: referenceReport?.generatedFromFciSnapshotAt ?? null,
      prepared_at: referenceReport?.preparedAt ?? null,
      submitted_at: referenceReport?.submittedAt ?? null,
      editable_payload: normalizeEditablePayloadFromRecord(referenceReport),
      legacy_notice: null
    },
    source_readiness: {
      source_snapshot_at: sourceSnapshotAt,
      fiche_cdc_version: ficheVersion,
      modules
    },
    history: reports.map((report) => ({
      id: report.id,
      version: report.version,
      status: report.status,
      submitted_at: report.submittedAt,
      prepared_at: report.preparedAt,
      created_at: report.createdAt
    })),
    permissions: {
      can_generate: canGenerate,
      can_edit: canEdit,
      can_prepare: canPrepare,
      can_submit: canSubmit,
      can_regenerate: canRegenerate,
      can_export: canExport,
      can_view_submitted: canViewSubmitted
    }
  };
}

export async function getGoNoGoReportAuditTrail(
  code: string,
  currentUser?: CurrentUser | null
) {
  const actor = normalizeCurrentUser(currentUser);
  assertBusinessAccess(actor);
  const appelOffres = await requireAppelOffres(code);
  return listGoNoGoReportAuditEventsByAppelOffresId(appelOffres.id);
}

export function toGoNoGoReportErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: { code: error.code, message: error.message, details: {} }
      }
    };
  }

  if (error instanceof GoNoGoReportServiceError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: { code: error.code, message: error.message, details: error.details ?? {} }
      }
    };
  }

  const message =
    error instanceof Error ? error.message : "Erreur rapport Go/No-Go inattendue.";

  return {
    status: 500,
    body: {
      ok: false,
      error: { code: "GO_NO_GO_REPORT_INTERNAL_ERROR", message, details: {} }
    }
  };
}
