import type { BadgeTone } from "./presentation.ts";
import type { AppelOffresDetail } from "./types.ts";
import type {
  FciFormField,
  FciFormPayload,
  FciModuleDefinition
} from "./fci/rendering.ts";
import { getFciModuleDefinition, isFciFieldLike } from "./fci/rendering.ts";
import type { FciModulePresentation } from "./fci/presentation.ts";
import type {
  GoNoGoDecisionView,
  GoNoGoModuleSummaryView
} from "./go-no-go/service.ts";

export type DecisionCenterModuleCode = "A" | "B" | "C";

export type DecisionCenterContributionState = {
  moduleCode: DecisionCenterModuleCode;
  departmentLabel: string;
  statusLabel: string;
  statusTone: BadgeTone;
  validatedAt: string | null;
  validatedBy: string | null;
  ready: boolean;
  missingRequirement: string | null;
  blockingError: boolean;
};

export type DecisionCenterReadinessSummary = {
  ready: boolean;
  validatedCount: number;
  totalCount: number;
  statusTitle: string;
  statusDescription: string;
  explanation: string;
  entries: DecisionCenterContributionState[];
  validatedDepartments: string[];
  pendingDepartments: string[];
  blockingDepartments: string[];
};

export type DecisionCenterReviewCard = {
  moduleCode: DecisionCenterModuleCode;
  departmentLabel: string;
  statusLabel: string;
  statusTone: BadgeTone;
  validatedAt: string | null;
  validatedBy: string | null;
  executiveSummary: string;
  keyRisks: string[];
  reservations: string[];
  assumptions: string[];
  recommendation: string | null;
  safeErrorMessage: string | null;
  readOnly: true;
  showMutationControls: false;
};

type ReviewCandidate = {
  label: string;
  key: string;
  value: string;
};

type ReadinessInput = {
  moduleCode: DecisionCenterModuleCode;
  summary?: GoNoGoModuleSummaryView | null;
  modulePresentation?: FciModulePresentation | null;
  loadError?: boolean;
};

const CONTRIBUTING_MODULES: DecisionCenterModuleCode[] = ["A", "B", "C"];

const DEPARTMENT_LABELS: Record<DecisionCenterModuleCode, string> = {
  A: "Commercial",
  B: "Finance",
  C: "Operations"
};

const SUMMARY_KEYWORDS = [
  "synthese",
  "commentaire",
  "commentaires",
  "positionnement",
  "importance",
  "decision",
  "conclusion",
  "strategie"
];

const RISK_KEYWORDS = [
  "risque",
  "risques",
  "vulnerabilite",
  "pression",
  "exposition",
  "vigilance",
  "penalite",
  "sous performance",
  "perte"
];

const RESERVATION_KEYWORDS = [
  "reserve",
  "reserves",
  "condition",
  "conditions",
  "sous conditions"
];

const ASSUMPTION_KEYWORDS = [
  "hypothese",
  "hypotheses",
  "estime",
  "estimation",
  "source",
  "probabilite",
  "disponibilite",
  "delai"
];

const RECOMMENDATION_KEYWORDS = [
  "recommand",
  "action requise",
  "ajustement",
  "bonne pratique",
  "prioritaire",
  "conclusion"
];

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getDepartmentLabel(moduleCode: DecisionCenterModuleCode) {
  return getFciModuleDefinition(moduleCode)?.departmentLabel ?? DEPARTMENT_LABELS[moduleCode];
}

function mapContributionStatus(input: {
  rawStatus: string | null | undefined;
  hasBlockingError: boolean;
}) {
  if (input.hasBlockingError) {
    return {
      label: "En erreur",
      tone: "danger" as const
    };
  }

  switch (input.rawStatus) {
    case "validated":
      return { label: "Valide", tone: "success" as const };
    case "generating":
      return { label: "En cours", tone: "ai" as const };
    case "generated":
    case "needs_review":
      return { label: "A completer", tone: "warning" as const };
    case "failed":
    case "unavailable":
      return { label: "En erreur", tone: "danger" as const };
    default:
      return { label: "Non commence", tone: "neutral" as const };
  }
}

function getMissingRequirement(input: {
  rawStatus: string | null | undefined;
  hasBlockingError: boolean;
}) {
  if (input.hasBlockingError) {
    return "Une reprise par l'equipe concernee est necessaire.";
  }

  switch (input.rawStatus) {
    case "validated":
      return null;
    case "generating":
      return "La contribution est en cours de preparation.";
    case "generated":
    case "needs_review":
      return "La contribution doit etre completee puis validee.";
    default:
      return "La contribution n'a pas encore ete validee.";
  }
}

function getFieldDisplayValue(field: FciFormField) {
  const value = field.value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "Oui" : "Non";
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean);
    return items.length > 0 ? items.join(", ") : null;
  }

  return null;
}

function pushCandidate(
  candidates: ReviewCandidate[],
  input: {
    label: string;
    key: string;
    rawField: unknown;
  }
) {
  if (!isFciFieldLike(input.rawField)) {
    return;
  }

  const value = getFieldDisplayValue(input.rawField);
  if (!value) {
    return;
  }

  candidates.push({
    label: input.label,
    key: input.key,
    value
  });
}

function collectReviewCandidates(
  definition: FciModuleDefinition,
  payload: FciFormPayload
) {
  const candidates: ReviewCandidate[] = [];

  for (const section of definition.sections) {
    const sectionValue = payload.data[section.key];

    if (section.display === "table") {
      const rows = Array.isArray(sectionValue) ? sectionValue : [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          continue;
        }

        for (const field of section.fields) {
          if (field.conditional && !field.conditional(payload)) {
            continue;
          }

          pushCandidate(candidates, {
            label: field.label,
            key: field.key,
            rawField: (row as Record<string, unknown>)[field.key]
          });
        }
      }

      continue;
    }

    if (!sectionValue || typeof sectionValue !== "object" || Array.isArray(sectionValue)) {
      continue;
    }

    for (const field of section.fields) {
      if (field.conditional && !field.conditional(payload)) {
        continue;
      }

      pushCandidate(candidates, {
        label: field.label,
        key: field.key,
        rawField: (sectionValue as Record<string, unknown>)[field.key]
      });
    }
  }

  return candidates;
}

function matchesKeywords(candidate: ReviewCandidate, keywords: string[]) {
  const normalized = normalizeText(`${candidate.label} ${candidate.key}`);
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function dedupeValues(values: string[]) {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(value);
  }

  return next;
}

function formatCandidate(candidate: ReviewCandidate) {
  return `${candidate.label} : ${candidate.value}`;
}

function pickSummary(candidates: ReviewCandidate[]) {
  const summaryCandidate =
    candidates.find((candidate) => matchesKeywords(candidate, SUMMARY_KEYWORDS))
    ?? candidates[0]
    ?? null;

  return summaryCandidate ? formatCandidate(summaryCandidate) : "Aucune synthese disponible";
}

function pickList(candidates: ReviewCandidate[], keywords: string[]) {
  return dedupeValues(
    candidates
      .filter((candidate) => matchesKeywords(candidate, keywords))
      .map(formatCandidate)
  ).slice(0, 3);
}

function pickRecommendation(candidates: ReviewCandidate[]) {
  const recommendation =
    candidates.find((candidate) => matchesKeywords(candidate, RECOMMENDATION_KEYWORDS))
    ?? null;

  return recommendation ? formatCandidate(recommendation) : null;
}

export function sanitizeDecisionCenterModuleError(
  moduleCode: DecisionCenterModuleCode,
  error?: unknown
) {
  const departmentLabel = getDepartmentLabel(moduleCode);
  if (error) {
    console.error("[dg-decision-center] contribution load failed", {
      moduleCode,
      departmentLabel,
      error
    });
  }

  return `La contribution ${departmentLabel} n'a pas pu etre preparee correctement. Une reprise par l'equipe concernee est necessaire.`;
}

export function buildDecisionCenterReadiness(input: {
  modules: ReadinessInput[];
}) {
  const entries = CONTRIBUTING_MODULES.map((moduleCode) => {
    const current = input.modules.find((module) => module.moduleCode === moduleCode);
    const hasBlockingError = Boolean(
      current?.loadError
      || current?.modulePresentation?.module.error_code
      || current?.summary?.status === "failed"
    );
    const rawStatus = current?.summary?.status ?? current?.modulePresentation?.module.status ?? "not_started";
    const status = mapContributionStatus({ rawStatus, hasBlockingError });
    const ready = rawStatus === "validated" && !hasBlockingError;

    return {
      moduleCode,
      departmentLabel: current?.summary?.department_label ?? getDepartmentLabel(moduleCode),
      statusLabel: status.label,
      statusTone: status.tone,
      validatedAt:
        current?.summary?.validated_at
        ?? current?.modulePresentation?.module.validated_at
        ?? null,
      validatedBy:
        current?.summary?.validated_by
        ?? current?.modulePresentation?.module.validated_by
        ?? null,
      ready,
      missingRequirement: getMissingRequirement({ rawStatus, hasBlockingError }),
      blockingError: hasBlockingError
    } satisfies DecisionCenterContributionState;
  });

  const validatedCount = entries.filter((entry) => entry.ready).length;
  const validatedDepartments = entries
    .filter((entry) => entry.ready)
    .map((entry) => entry.departmentLabel);
  const blockingDepartments = entries
    .filter((entry) => entry.blockingError)
    .map((entry) => entry.departmentLabel);
  const pendingDepartments = entries
    .filter((entry) => !entry.ready && !entry.blockingError)
    .map((entry) => entry.departmentLabel);
  const ready = validatedCount === CONTRIBUTING_MODULES.length && blockingDepartments.length === 0;

  return {
    ready,
    validatedCount,
    totalCount: CONTRIBUTING_MODULES.length,
    statusTitle: ready ? "Pret pour decision" : "Decision non disponible",
    statusDescription: ready
      ? "Les contributions Commerciale, Financiere et Operationnelle sont validees."
      : `${validatedCount} contribution${validatedCount > 1 ? "s" : ""} sur ${CONTRIBUTING_MODULES.length} validee${validatedCount > 1 ? "s" : ""}.`,
    explanation: "La decision sera disponible lorsque les trois contributions auront ete validees.",
    entries,
    validatedDepartments,
    pendingDepartments,
    blockingDepartments
  } satisfies DecisionCenterReadinessSummary;
}

export function buildDecisionCenterReviewCard(input: {
  moduleCode: DecisionCenterModuleCode;
  modulePresentation: FciModulePresentation | null;
  payload: FciFormPayload | null;
  loadError?: boolean;
}) {
  const departmentLabel =
    input.modulePresentation?.module.department_label
    ?? getDepartmentLabel(input.moduleCode);
  const hasBlockingError = Boolean(
    input.loadError
    || input.modulePresentation?.module.error_code
    || input.modulePresentation?.module.status === "failed"
  );
  const rawStatus = input.modulePresentation?.module.status ?? "not_started";
  const status = mapContributionStatus({ rawStatus, hasBlockingError });
  const definition = getFciModuleDefinition(input.moduleCode);
  const candidates =
    input.payload && definition
      ? collectReviewCandidates(definition, input.payload)
      : [];

  return {
    moduleCode: input.moduleCode,
    departmentLabel,
    statusLabel: status.label,
    statusTone: status.tone,
    validatedAt: input.modulePresentation?.module.validated_at ?? null,
    validatedBy: input.modulePresentation?.module.validated_by ?? null,
    executiveSummary: candidates.length > 0 ? pickSummary(candidates) : "Aucune synthese disponible",
    keyRisks: pickList(candidates, RISK_KEYWORDS),
    reservations: pickList(candidates, RESERVATION_KEYWORDS),
    assumptions: pickList(candidates, ASSUMPTION_KEYWORDS),
    recommendation: pickRecommendation(candidates),
    safeErrorMessage: hasBlockingError
      ? sanitizeDecisionCenterModuleError(
          input.moduleCode,
          input.loadError ? new Error("module_load_failed") : input.modulePresentation?.module.error_message
        )
      : null,
    readOnly: true as const,
    showMutationControls: false as const
  } satisfies DecisionCenterReviewCard;
}

function mapFicheStatus(status: AppelOffresDetail["ficheStatus"] | null) {
  switch (status?.status) {
    case "validated":
      return "Validee";
    case "draft":
      return "Generee a relire";
    case "processing":
      return "En cours de generation";
    case "error":
      return "En erreur";
    default:
      return "Non disponible";
  }
}

function mapDecisionStatus(input: {
  decision: GoNoGoDecisionView | null;
  readiness: DecisionCenterReadinessSummary;
}) {
  if (input.decision?.status === "go") {
    return {
      label: "GO decide",
      tone: "success" as BadgeTone
    };
  }

  if (input.decision?.status === "no_go") {
    return {
      label: "NO-GO decide",
      tone: "danger" as BadgeTone
    };
  }

  if (input.decision?.status === "reouvert") {
    return {
      label: "Decision rouverte",
      tone: "warning" as BadgeTone
    };
  }

  if (input.readiness.ready) {
    return {
      label: "A arbitrer",
      tone: "warning" as BadgeTone
    };
  }

  return {
    label: "En attente des contributions",
    tone: "neutral" as BadgeTone
  };
}

function getLatestTimestamp(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

export function buildDecisionCenterHeader(input: {
  appel: AppelOffresDetail;
  dossierStatus: {
    label: string;
    tone: BadgeTone;
  };
  decision: GoNoGoDecisionView | null;
  readiness: DecisionCenterReadinessSummary;
}) {
  const decisionStatus = mapDecisionStatus({
    decision: input.decision,
    readiness: input.readiness
  });

  return {
    dossierCode: input.appel.code,
    projectTitle: input.appel.title,
    client: input.appel.buyer || "En attente d'extraction",
    deadline: input.appel.dueDate,
    dossierStatusLabel: input.dossierStatus.label,
    dossierStatusTone: input.dossierStatus.tone,
    ficheStatusLabel: mapFicheStatus(input.appel.ficheStatus ?? null),
    decisionStatusLabel: decisionStatus.label,
    decisionStatusTone: decisionStatus.tone,
    lastRelevantUpdate: getLatestTimestamp([
      input.decision?.decided_at,
      input.decision?.created_at,
      input.appel.ficheStatus?.validatedAt ?? null,
      input.appel.ficheStatus?.modifiedAt ?? null,
      input.appel.updatedAt
    ])
  };
}
