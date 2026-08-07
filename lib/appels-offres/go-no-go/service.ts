import {
  appendAuditLog,
  archiveAppelOffres,
  getAppelOffresRecordByCode,
  setAppelOffresBusinessStatus
} from "../repository.ts";
import type { AppelOffresRecord } from "../types.ts";
import {
  getLatestGoNoGoDecisionByAppelOffresId,
  insertGoNoGoDecisionVersion,
  listGoNoGoDecisionVersionsByAppelOffresId
} from "./repository.ts";
import type {
  GoNoGoDecisionRecord,
  GoNoGoDecisionValue,
  GoNoGoStatus
} from "./types.ts";
import { FciServiceError, getFciWorkspace } from "../fci/service.ts";
import type { FciModuleCode, FciSetOverallStatus } from "../fci/types.ts";
import {
  deriveTenderWorkflowState,
  markTenderDecisionState,
  markTenderReopenedForDecision,
  markTenderUnderDgReview,
  WorkflowServiceError
} from "../workflow/service.ts";
import {
  getSubmittedGoNoGoReportForDecision,
  type GoNoGoReportWorkspaceView
} from "../go-no-go-report/service.ts";
import { notifyCommercialUsers } from "../../notifications/orchestration.ts";
import {
  buildUserPresentation,
  canAccess,
  canMakeFinalDecision,
  getAreaAccessDeniedMessage,
  type CurrentUser,
  type UserPresentation
} from "../../auth/rbac.ts";
import { getFallbackDevelopmentUser } from "../../auth/current-user.ts";
import { AuthError } from "../../auth/errors.ts";

export type GoNoGoServiceErrorCode =
  | "AO_NOT_FOUND"
  | "FCI_NOT_VALIDATED"
  | "RBAC_FORBIDDEN"
  | "INVALID_PAYLOAD"
  | "VERSION_CONFLICT"
  | "NO_DECISION_TO_REOPEN";

export class GoNoGoServiceError extends Error {
  code: GoNoGoServiceErrorCode;
  status: number;
  details: Record<string, unknown> | null;

  constructor(
    code: GoNoGoServiceErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "GoNoGoServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type GoNoGoModuleSummaryView = {
  module_code: FciModuleCode;
  department_code: string;
  department_label: string;
  status: string;
  validated_at: string | null;
  validated_by: string | null;
  completion_percentage: number;
};

export type GoNoGoDecisionView = {
  version: number;
  status: GoNoGoStatus;
  decision: GoNoGoDecisionValue | null;
  rationale: string | null;
  reserves: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

export type GoNoGoView = {
  current_user: UserPresentation;
  appel_offres: {
    code: string;
    title: string;
    business_status: string | null;
  };
  fci: {
    overall_status: FciSetOverallStatus;
    modules: GoNoGoModuleSummaryView[];
  };
  report: {
    id: number | null;
    version: number | null;
    status: string | null;
    is_stale: boolean;
    submitted_at: string | null;
    prepared_at: string | null;
    editable_payload: GoNoGoReportWorkspaceView["report"]["editable_payload"] | null;
    legacy_notice: string | null;
  };
  decision: GoNoGoDecisionView | null;
  history: GoNoGoDecisionView[];
  workflow: {
    explicit_state: string | null;
    derived_state: string | null;
    submitted_to_dg: boolean;
    under_dg_review: boolean;
  };
  permissions: {
    can_decide: boolean;
    can_reopen: boolean;
  };
};

export type DecideGoNoGoPayload = {
  decision: GoNoGoDecisionValue;
  rationale: string;
  reserves: string | null;
  expectedVersion: number | null;
};

export type ReopenGoNoGoPayload = {
  reason: string;
  expectedVersion: number | null;
};

export type DecideGoNoGoResult = {
  decision: GoNoGoDecisionView;
  applied: boolean;
  idempotent: boolean;
};

function normalizeCurrentUser(currentUser?: CurrentUser | null) {
  return currentUser ?? getFallbackDevelopmentUser();
}

function assertCanViewGoNoGo(currentUser: CurrentUser) {
  if (canAccess(currentUser.role, "appels_offres")) {
    return;
  }

  throw new GoNoGoServiceError(
    "RBAC_FORBIDDEN",
    getAreaAccessDeniedMessage("appels_offres", currentUser.role),
    403,
    { role: currentUser.role }
  );
}

function assertCanDecide(currentUser: CurrentUser) {
  if (canMakeFinalDecision(currentUser.role)) {
    return;
  }

  throw new GoNoGoServiceError(
    "RBAC_FORBIDDEN",
    "Acces refuse : seule la Direction generale peut decider du Go/No-Go.",
    403,
    { role: currentUser.role }
  );
}

async function requireAppelOffres(code: string): Promise<AppelOffresRecord> {
  const appelOffres = await getAppelOffresRecordByCode(code, { includeArchived: true });
  if (!appelOffres) {
    throw new GoNoGoServiceError("AO_NOT_FOUND", "Appel d'offres introuvable.", 404, { code });
  }

  return appelOffres;
}

// The FCI workspace is not initialized until the Fiche CDC has been validated
// at least once (see requireInitializedDetail in fci/service.ts) - that is a
// normal, early state for a brand-new tender, not an error for this screen:
// it just means the Go/No-Go gate is not open yet.
async function loadFciContext(code: string, actor: CurrentUser) {
  try {
    const workspace = await getFciWorkspace(code, actor);
    return {
      overallStatus: workspace.fci_set.overall_status,
      moduleSummaries: workspace.module_summaries
    };
  } catch (error) {
    if (error instanceof FciServiceError && error.code === "FCI_NOT_INITIALIZED") {
      return {
        overallStatus: "not_started" as FciSetOverallStatus,
        moduleSummaries: []
      };
    }

    throw error;
  }
}

function mapDecisionView(record: GoNoGoDecisionRecord): GoNoGoDecisionView {
  return {
    version: record.version,
    status: record.status,
    decision: record.decision,
    rationale: record.rationale,
    reserves: record.reserves,
    decided_by: record.decidedBy,
    decided_at: record.decidedAt,
    created_at: record.createdAt
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseRequiredText(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new GoNoGoServiceError(
      "INVALID_PAYLOAD",
      `Le champ ${fieldName} est obligatoire.`,
      422,
      { field: fieldName }
    );
  }

  return value.trim();
}

function parseOptionalText(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function parseExpectedVersion(value: unknown) {
  if (value == null) {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new GoNoGoServiceError(
      "INVALID_PAYLOAD",
      "La version attendue est invalide.",
      422,
      { field: "expected_version" }
    );
  }

  return numeric;
}

export function parseDecideGoNoGoPayload(body: unknown): DecideGoNoGoPayload {
  if (!isPlainObject(body)) {
    throw new GoNoGoServiceError("INVALID_PAYLOAD", "Le corps de la requete doit etre un objet JSON.", 422);
  }

  const decisionRaw = body.decision;
  if (decisionRaw !== "go" && decisionRaw !== "no_go") {
    throw new GoNoGoServiceError(
      "INVALID_PAYLOAD",
      "Le champ decision doit valoir 'go' ou 'no_go'.",
      422,
      { field: "decision" }
    );
  }

  return {
    decision: decisionRaw,
    rationale: parseRequiredText(body.rationale, "rationale"),
    reserves: parseOptionalText(body.reserves),
    expectedVersion: parseExpectedVersion(body.expected_version)
  };
}

export function parseReopenGoNoGoPayload(body: unknown): ReopenGoNoGoPayload {
  if (!isPlainObject(body)) {
    throw new GoNoGoServiceError("INVALID_PAYLOAD", "Le corps de la requete doit etre un objet JSON.", 422);
  }

  return {
    reason: parseRequiredText(body.reason, "reason"),
    expectedVersion: parseExpectedVersion(body.expected_version)
  };
}

export async function getGoNoGoView(
  code: string,
  currentUser?: CurrentUser | null
): Promise<GoNoGoView> {
  const actor = normalizeCurrentUser(currentUser);
  assertCanViewGoNoGo(actor);

  const appelOffres = await requireAppelOffres(code);
  let workflow = await deriveTenderWorkflowState(code);
  if (actor.role === "DIRECTION_GENERALE") {
    await markTenderUnderDgReview(code, actor);
    workflow = await deriveTenderWorkflowState(code);
  }
  const fciContext = await loadFciContext(code, actor);
  const latest = await getLatestGoNoGoDecisionByAppelOffresId(appelOffres.id);
  const history = await listGoNoGoDecisionVersionsByAppelOffresId(appelOffres.id);
  const submittedReport = await getSubmittedGoNoGoReportForDecision(code);
  const canDecideRole = canMakeFinalDecision(actor.role);
  const isValidated = fciContext.overallStatus === "validated";
  const hasOpenDecision = !latest || latest.status === "reouvert";
  const hasActiveDecision = latest != null && (latest.status === "go" || latest.status === "no_go");

  return {
    current_user: buildUserPresentation(actor),
    appel_offres: {
      code: appelOffres.code,
      title: appelOffres.title,
      business_status: appelOffres.businessStatus
    },
    fci: {
      overall_status: fciContext.overallStatus,
      modules: fciContext.moduleSummaries.map((summary) => ({
        module_code: summary.module_code,
        department_code: summary.department_code,
        department_label: summary.department_label,
        status: summary.status,
        validated_at: summary.validated_at,
        validated_by: summary.validated_by,
        completion_percentage: summary.completion.percentage
      }))
    },
    report: {
      id: submittedReport.report?.id ?? null,
      version: submittedReport.report?.version ?? null,
      status: submittedReport.report?.status ?? null,
      is_stale: submittedReport.isStale,
      submitted_at: submittedReport.report?.submittedAt ?? null,
      prepared_at: submittedReport.report?.preparedAt ?? null,
      editable_payload: submittedReport.report?.editablePayloadJson
        ? ((submittedReport.report.editablePayloadJson as unknown) as GoNoGoReportWorkspaceView["report"]["editable_payload"])
        : null,
      legacy_notice:
        !submittedReport.report && hasActiveDecision
          ? "Rapport consolide non disponible pour cette ancienne decision."
          : null
    },
    decision: latest ? mapDecisionView(latest) : null,
    history: history.map(mapDecisionView),
    workflow: {
      explicit_state: workflow.explicit_state,
      derived_state: workflow.derived_state,
      submitted_to_dg: workflow.submitted_to_dg,
      under_dg_review: actor.role === "DIRECTION_GENERALE"
        ? true
        : workflow.under_dg_review
    },
    permissions: {
      can_decide:
        canDecideRole
        && isValidated
        && submittedReport.report != null
        && !submittedReport.isStale
        && hasOpenDecision
        && (
          workflow.explicit_state === "SUBMITTED_TO_DG"
          || workflow.explicit_state === "UNDER_DG_REVIEW"
        ),
      can_reopen: canDecideRole && hasActiveDecision
    }
  };
}

export async function decideGoNoGo(
  code: string,
  payload: DecideGoNoGoPayload,
  currentUser?: CurrentUser | null
): Promise<DecideGoNoGoResult> {
  const actor = normalizeCurrentUser(currentUser);
  const appelOffres = await requireAppelOffres(code);
  assertCanDecide(actor);
  const workflow = await deriveTenderWorkflowState(code);
  const submittedReport = await getSubmittedGoNoGoReportForDecision(code);
  if (
    workflow.explicit_state !== "SUBMITTED_TO_DG"
    && workflow.explicit_state !== "UNDER_DG_REVIEW"
    && workflow.explicit_state !== "GO_DECIDED"
    && workflow.explicit_state !== "NO_GO_DECIDED"
    && workflow.explicit_state !== "ARCHIVED"
  ) {
    throw new GoNoGoServiceError(
      "RBAC_FORBIDDEN",
      "La decision Go/No-Go n'est disponible pour la Direction generale qu'apres soumission du Commercial.",
      403,
      { explicit_state: workflow.explicit_state }
    );
  }
  if (!submittedReport.report || submittedReport.isStale) {
    throw new GoNoGoServiceError(
      "RBAC_FORBIDDEN",
      "La decision Go/No-Go n'est possible qu'a partir d'un rapport soumis et a jour.",
      403,
      {
        has_report: submittedReport.report != null,
        report_is_stale: submittedReport.isStale
      }
    );
  }
  await markTenderUnderDgReview(code, actor);

  const fciContext = await loadFciContext(code, actor);
  if (fciContext.overallStatus !== "validated") {
    throw new GoNoGoServiceError(
      "FCI_NOT_VALIDATED",
      "La decision Go/No-Go n'est possible qu'apres validation des FCI contributives (A, B, C).",
      409,
      { overall_status: fciContext.overallStatus }
    );
  }

  const latest = await getLatestGoNoGoDecisionByAppelOffresId(appelOffres.id);

  if (latest && (latest.status === "go" || latest.status === "no_go")) {
    const isIdentical =
      latest.decision === payload.decision
      && (latest.rationale ?? "") === payload.rationale
      && (latest.reserves ?? null) === (payload.reserves ?? null);

    if (isIdentical) {
      return { decision: mapDecisionView(latest), applied: false, idempotent: true };
    }
    // A conflicting decide over an already-decided tender never overwrites the
    // existing row in place - it appends a new version, same as everywhere
    // else FCI/Go-No-Go state is versioned (fci_module_data, this table).
  }

  if (payload.expectedVersion != null && (latest?.version ?? null) !== payload.expectedVersion) {
    throw new GoNoGoServiceError(
      "VERSION_CONFLICT",
      "La decision Go/No-Go a change depuis votre derniere lecture.",
      409,
      {
        expected_version: payload.expectedVersion,
        actual_version: latest?.version ?? null
      }
    );
  }

  const decidedAt = new Date().toISOString();
  const created = await insertGoNoGoDecisionVersion(appelOffres.id, {
    status: payload.decision,
    decision: payload.decision,
    rationale: payload.rationale,
    reserves: payload.reserves,
    decidedBy: actor.name,
    decidedAt
  });

  if (payload.decision === "go") {
    await setAppelOffresBusinessStatus(code, "offre_autorisee", {
      goNoGoVersion: created.version,
      decidedBy: actor.name
    });
  } else {
    // Reuses the existing archive path so No-Go keeps behaving like every
    // other archived tender everywhere else in the app (lists, dashboard),
    // while still recording the specific outcome on this table and in the
    // audit log below.
    await archiveAppelOffres(code, { businessStatus: "offre_rejetee" });
  }

  await appendAuditLog(
    code,
    payload.decision === "go" ? "go_no_go.decided_go" : "go_no_go.decided_no_go",
    {
      version: created.version,
      rationale: payload.rationale,
      reserves: payload.reserves,
      decidedBy: actor.name
    },
    actor.name
  );

  await markTenderDecisionState({
    code,
    decision: payload.decision,
    currentUser: actor
  });

  await notifyCommercialUsers({
    appelOffreCode: code,
    eventType: "DG_DECISION_MADE",
    currentUser: actor,
    metadata: {
      decision: payload.decision
    },
    dedupeKey: `dg-decision:${code}:${created.version}`,
    section: "go-no-go"
  });

  return { decision: mapDecisionView(created), applied: true, idempotent: false };
}

export async function reopenGoNoGo(
  code: string,
  payload: ReopenGoNoGoPayload,
  currentUser?: CurrentUser | null
): Promise<{ decision: GoNoGoDecisionView }> {
  const actor = normalizeCurrentUser(currentUser);
  const appelOffres = await requireAppelOffres(code);
  assertCanDecide(actor);

  const latest = await getLatestGoNoGoDecisionByAppelOffresId(appelOffres.id);
  if (!latest || (latest.status !== "go" && latest.status !== "no_go")) {
    throw new GoNoGoServiceError(
      "NO_DECISION_TO_REOPEN",
      "Aucune decision Go/No-Go active a reouvrir pour ce dossier.",
      409
    );
  }

  if (payload.expectedVersion != null && latest.version !== payload.expectedVersion) {
    throw new GoNoGoServiceError(
      "VERSION_CONFLICT",
      "La decision Go/No-Go a change depuis votre derniere lecture.",
      409,
      {
        expected_version: payload.expectedVersion,
        actual_version: latest.version
      }
    );
  }

  const created = await insertGoNoGoDecisionVersion(appelOffres.id, {
    status: "reouvert",
    decision: null,
    rationale: payload.reason,
    reserves: null,
    decidedBy: null,
    decidedAt: null
  });

  await appendAuditLog(
    code,
    "go_no_go.reopened",
    {
      version: created.version,
      previousDecision: latest.decision,
      reason: payload.reason
    },
    actor.name
  );

  await markTenderReopenedForDecision(code, actor);

  return { decision: mapDecisionView(created) };
}

export function toGoNoGoErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: { code: error.code, message: error.message, details: {} }
      }
    };
  }

  if (error instanceof GoNoGoServiceError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: { code: error.code, message: error.message, details: error.details ?? {} }
      }
    };
  }

  if (error instanceof FciServiceError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: { code: error.code, message: error.message, details: error.details ?? {} }
      }
    };
  }

  if (error instanceof WorkflowServiceError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: { code: error.code, message: error.message, details: error.details ?? {} }
      }
    };
  }

  const message = error instanceof Error ? error.message : "Erreur Go/No-Go inattendue.";

  return {
    status: 500,
    body: {
      ok: false,
      error: { code: "GO_NO_GO_INTERNAL_ERROR", message, details: {} }
    }
  };
}
