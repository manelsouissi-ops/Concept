import type {
  FciAuditEventRecord,
  FciContributingModuleCode,
  FciDetail,
  FciGenerationJobRecord,
  FciModuleCode,
  FciModuleDataRecord,
  FciModuleRecord,
  FciSetOverallStatus
} from "./types.ts";
import {
  isFciContributingModuleCode,
  isFciModuleGeneratable,
  isHumanVisibleFciModuleCode
} from "./validation.ts";
import type { SourceFicheSnapshot } from "./source-fiche.ts";
import type { AppelOffresRecord } from "../types.ts";
import type { FicheStatus } from "../../types.ts";
import {
  buildUserPresentation,
  canGenerateFciModule,
  canMakeFinalDecision,
  canRegenerateFciModule,
  canValidateFciModule,
  canViewFciModule,
  canEditFciModule,
  getFciReadOnlyMessage,
  type CurrentUser,
  type UserPresentation
} from "../../auth/rbac.ts";
import {
  calculateFciPayloadCompletion,
  getFciDepartmentCode,
  getFciDepartmentLabel,
  getFciModuleDefinition,
  normalizeStoredFciModulePayload,
  validateFciModulePayloadForCompletion,
  type FciFormPayload
} from "./rendering.ts";

export type FciModuleAllowedAction =
  | "edit"
  | "regenerate"
  | "validate"
  | "view_history";

export type FciModuleFormStatus =
  | "not_started"
  | "draft"
  | "ready_for_review"
  | "completed";

export type FciModuleCompletionPresentation = {
  filled: number;
  total: number;
  percentage: number;
  human_inputs_required: number;
  ready_for_completion: boolean;
};

export type FciModuleSummaryPresentation = {
  module_code: FciModuleCode;
  module_type: FciModuleRecord["moduleType"];
  department_code: string;
  department_label: string;
  title: string;
  status: FciModuleRecord["status"];
  form_status: FciModuleFormStatus;
  latest_version: number | null;
  last_updated: string | null;
  last_saved_at: string | null;
  ai_generated_at: string | null;
  validated_at: string | null;
  validated_by: string | null;
  has_data: boolean;
  completion: FciModuleCompletionPresentation;
  current_error: {
    code: string | null;
    message: string | null;
    last_attempt_at: string | null;
  } | null;
  stale_source: boolean;
  missing_prerequisite_modules: Array<"A" | "B" | "C">;
  available_actions: FciModuleAllowedAction[];
  current_user: UserPresentation;
  permissions: {
    can_view: boolean;
    can_edit: boolean;
    can_generate: boolean;
    can_regenerate: boolean;
    can_validate: boolean;
    can_make_final_decision: boolean;
    read_only: boolean;
    read_only_message: string | null;
    generation_blocked_reason: string | null;
  };
};

export type FciWorkspacePresentation = {
  current_user: UserPresentation;
  appel_offres: {
    id: number;
    code: string;
    title: string;
    business_status: string | null;
    updated_at: string;
  };
  fci_set: {
    id: number;
    overall_status: FciSetOverallStatus;
    stored_overall_status: FciSetOverallStatus;
    created_at: string;
    updated_at: string;
  };
  source_fiche: {
    available: boolean;
    status: string | null;
    is_validated: boolean;
    version: string | null;
    updated_at: string | null;
    hash: string | null;
    set_version: string;
    set_updated_at: string;
    freshness: "current" | "stale" | "missing";
  };
  progress: {
    total_modules: number;
    enabled_modules: number;
    validated_modules: number;
    modules_with_data: number;
    percentage: number;
  };
  knowledge_base_enabled: boolean;
  enabled_modules: FciContributingModuleCode[];
  module_summaries: FciModuleSummaryPresentation[];
};

export type FciModulePresentation = {
  current_user: UserPresentation;
  appel_offres: {
    code: string;
    title: string;
    due_date: string | null;
  };
  module: {
    id: number;
    module_code: FciModuleCode;
    module_type: FciModuleRecord["moduleType"];
    department_code: string;
    department_label: string;
    title: string;
    status: FciModuleRecord["status"];
    form_status: FciModuleFormStatus;
    ai_generated_at: string | null;
    validated_at: string | null;
    validated_by: string | null;
    error_code: string | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
  };
  latest_data: {
    version: number;
    data: Record<string, unknown>;
    source_summary: Record<string, unknown> | null;
    confidence: Record<string, unknown> | null;
    ai_notes: Record<string, unknown> | null;
    generated_from_fiche_version: string | null;
    generated_from_fiche_hash: string | null;
    created_at: string;
      updated_at: string;
    } | null;
  completion: FciModuleCompletionPresentation;
  generation_job: {
    id: number;
    trigger_type: FciGenerationJobRecord["triggerType"];
    provider: string;
    model: string;
    status: FciGenerationJobRecord["status"];
    execution_id: string | null;
    correlation_id: string | null;
    started_at: string | null;
    completed_at: string | null;
    error_code: string | null;
    error_message: string | null;
    created_at: string;
  } | null;
  source_fiche: {
    available: boolean;
    status: string | null;
    is_validated: boolean;
    version: string | null;
    updated_at: string | null;
    hash: string | null;
  };
  stale_source: boolean;
  missing_prerequisite_modules: Array<"A" | "B" | "C">;
  allowed_actions: FciModuleAllowedAction[];
  permissions: {
    can_view: boolean;
    can_edit: boolean;
    can_generate: boolean;
    can_regenerate: boolean;
    can_validate: boolean;
    can_make_final_decision: boolean;
    read_only: boolean;
    read_only_message: string | null;
    generation_blocked_reason: string | null;
  };
  history_summary: {
    versions_count: number;
    jobs_count: number;
    audit_events_count: number;
    latest_version: number | null;
    latest_job_status: FciGenerationJobRecord["status"] | null;
  };
};

function isActiveJobStatus(status: FciGenerationJobRecord["status"]) {
  return [
    "created",
    "queued",
    "running"
  ].includes(status);
}

function isDepartmentalModuleCode(
  moduleCode: FciModuleCode
): moduleCode is "A" | "B" | "C" | "D" {
  return moduleCode === "A" || moduleCode === "B" || moduleCode === "C" || moduleCode === "D";
}

function buildPayloadDefaults(
  appelOffres: AppelOffresRecord,
  sourceFiche: SourceFicheSnapshot | null
) {
  return {
    codeInterne: appelOffres.code,
    intituleOffre: appelOffres.title,
    dateDepot: appelOffres.dueDate,
    sourceDeadline:
      sourceFiche?.fiche.extraction.find((field) => field.key === "date_limite_depot")?.value
      ?? null,
    preparedByName: null,
    validatedByName: null,
    sourceFiche: {
      code_interne: appelOffres.code,
      version: sourceFiche?.version ?? "unavailable",
      hash: sourceFiche?.hash ?? null,
      status: (sourceFiche?.status.status ?? "draft") as FicheStatus,
      validated_at: sourceFiche?.status.validatedAt ?? null
    }
  };
}

function normalizeLatestPayload(input: {
  appelOffres: AppelOffresRecord;
  latestData: FciModuleDataRecord | null;
  module: FciModuleRecord;
  sourceFiche: SourceFicheSnapshot | null;
}) {
  if (!input.latestData || !isDepartmentalModuleCode(input.module.moduleCode)) {
    return null;
  }

  return normalizeStoredFciModulePayload(
    input.module.moduleCode,
    input.latestData.dataJson,
    buildPayloadDefaults(input.appelOffres, input.sourceFiche)
  );
}

function getEmptyCompletion(): FciModuleCompletionPresentation {
  return {
    filled: 0,
    total: 0,
    percentage: 0,
    human_inputs_required: 0,
    ready_for_completion: false
  };
}

function buildCompletionPresentation(
  payload: FciFormPayload | null
): FciModuleCompletionPresentation {
  if (!payload) {
    return getEmptyCompletion();
  }

  const completion = calculateFciPayloadCompletion(payload, payload.module_code);
  const validationErrors = validateFciModulePayloadForCompletion(
    payload,
    payload.module_code
  );

  return {
    filled: completion.filled,
    total: completion.total,
    percentage: completion.percentage,
    human_inputs_required: completion.humanInputsRequired,
    ready_for_completion:
      completion.total > 0 &&
      completion.filled === completion.total &&
      validationErrors.length === 0
  };
}

function deriveFormStatus(input: {
  module: FciModuleRecord;
  payload: FciFormPayload | null;
  completion: FciModuleCompletionPresentation;
}): FciModuleFormStatus {
  if (input.module.status === "validated") {
    return "completed";
  }

  if (!input.payload) {
    return "not_started";
  }

  if (input.completion.ready_for_completion) {
    return "ready_for_review";
  }

  return "draft";
}

function getSafeDepartmentCode(moduleCode: FciModuleCode) {
  return isDepartmentalModuleCode(moduleCode)
    ? getFciDepartmentCode(moduleCode)
    : "KB";
}

function getSafeDepartmentLabel(moduleCode: FciModuleCode) {
  return isDepartmentalModuleCode(moduleCode)
    ? getFciDepartmentLabel(moduleCode)
    : "Base de connaissances";
}

export function indexLatestModuleData(
  records: FciModuleDataRecord[]
): Map<number, FciModuleDataRecord> {
  const latestByModuleId = new Map<number, FciModuleDataRecord>();

  for (const record of records) {
    const current = latestByModuleId.get(record.fciModuleId);
    if (!current || record.version > current.version) {
      latestByModuleId.set(record.fciModuleId, record);
    }
  }

  return latestByModuleId;
}

export function groupModuleDataVersions(
  records: FciModuleDataRecord[]
): Map<number, FciModuleDataRecord[]> {
  const grouped = new Map<number, FciModuleDataRecord[]>();

  for (const record of records) {
    const existing = grouped.get(record.fciModuleId);
    if (existing) {
      existing.push(record);
    } else {
      grouped.set(record.fciModuleId, [record]);
    }
  }

  for (const values of grouped.values()) {
    values.sort((left, right) => right.version - left.version);
  }

  return grouped;
}

export function indexLatestGenerationJobs(
  records: FciGenerationJobRecord[]
): Map<number, FciGenerationJobRecord> {
  const latestByModuleId = new Map<number, FciGenerationJobRecord>();

  for (const record of records) {
    if (!latestByModuleId.has(record.fciModuleId)) {
      latestByModuleId.set(record.fciModuleId, record);
    }
  }

  return latestByModuleId;
}

export function groupGenerationJobs(
  records: FciGenerationJobRecord[]
): Map<number, FciGenerationJobRecord[]> {
  const grouped = new Map<number, FciGenerationJobRecord[]>();

  for (const record of records) {
    const existing = grouped.get(record.fciModuleId);
    if (existing) {
      existing.push(record);
    } else {
      grouped.set(record.fciModuleId, [record]);
    }
  }

  return grouped;
}

export function groupModuleAuditEvents(
  records: FciAuditEventRecord[]
): Map<number, FciAuditEventRecord[]> {
  const grouped = new Map<number, FciAuditEventRecord[]>();

  for (const record of records) {
    if (record.fciModuleId == null) {
      continue;
    }

    const existing = grouped.get(record.fciModuleId);
    if (existing) {
      existing.push(record);
    } else {
      grouped.set(record.fciModuleId, [record]);
    }
  }

  return grouped;
}

export function isModuleSourceStale(
  latestData: FciModuleDataRecord | null | undefined,
  sourceFiche: SourceFicheSnapshot | null
) {
  if (!latestData || !sourceFiche) {
    return false;
  }

  return (
    latestData.generatedFromFicheVersion !== sourceFiche.version ||
    latestData.generatedFromFicheHash !== sourceFiche.hash
  );
}

export function calculateFciOverallStatus(input: {
  modules: FciModuleRecord[];
  latestDataByModuleId: Map<number, FciModuleDataRecord>;
  // Optional: whether the tender's Fiche CDC is CURRENTLY validated
  // (appelOffres.businessStatus === "fiche_validee" or a later state). When
  // explicitly false, individually-validated modules cannot make the set
  // overall "validated" - this prevents a tender from reading as
  // "ready for Go/No-Go" when its source Fiche CDC has since reverted to a
  // draft (e.g. after a CDC replacement), even though those modules were
  // legitimately validated against an earlier version. Omitted/undefined
  // preserves the previous behavior for existing callers.
  ficheCurrentlyValidated?: boolean;
}) {
  const enabledModules = input.modules.filter(
    (module) =>
      module.status !== "unavailable"
      && isFciContributingModuleCode(module.moduleCode)
  );

  if (enabledModules.length === 0) {
    return "not_started" satisfies FciSetOverallStatus;
  }

  if (enabledModules.every((module) => module.status === "validated")) {
    return input.ficheCurrentlyValidated === false
      ? "needs_review" satisfies FciSetOverallStatus
      : "validated" satisfies FciSetOverallStatus;
  }

  if (enabledModules.some((module) => module.status === "generating")) {
    return "in_progress" satisfies FciSetOverallStatus;
  }

  if (
    enabledModules.some((module) =>
      module.status === "generated" || module.status === "needs_review"
    )
  ) {
    return "needs_review" satisfies FciSetOverallStatus;
  }

  const anyHasData = enabledModules.some((module) =>
    input.latestDataByModuleId.has(module.id)
  );
  const anyFailed = enabledModules.some(
    (module) => module.status === "failed" || module.errorCode != null
  );
  const anyActivity = enabledModules.some((module) => module.status !== "not_started") || anyHasData;

  if (anyFailed && !anyHasData) {
    return "failed" satisfies FciSetOverallStatus;
  }

  if (anyActivity) {
    return "in_progress" satisfies FciSetOverallStatus;
  }

  return "not_started" satisfies FciSetOverallStatus;
}

export function buildFciProgress(input: {
  modules: FciModuleRecord[];
  latestDataByModuleId: Map<number, FciModuleDataRecord>;
}) {
  const enabledModules = input.modules.filter(
    (module) =>
      module.status !== "unavailable"
      && isFciContributingModuleCode(module.moduleCode)
  );
  const totalModules = enabledModules.length;
  const validatedModules = enabledModules.filter(
    (module) => module.status === "validated"
  ).length;
  const modulesWithData = enabledModules.filter((module) =>
    input.latestDataByModuleId.has(module.id)
  ).length;
  const percentage =
    totalModules === 0 ? 0 : Math.round((validatedModules / totalModules) * 100);

  return {
    total_modules: totalModules,
    enabled_modules: totalModules,
    validated_modules: validatedModules,
    modules_with_data: modulesWithData,
    percentage
  };
}

const FCI_D_PREREQUISITE_MODULES = ["A", "B", "C"] as const;

/**
 * FCI D synthesizes the Commercial/Finance/Operations contributions, so it
 * may only start once those three are human-validated - a completed AI
 * generation (needs_review) is not enough, since the content could still
 * change before validation. Shared by the service-level generation gate and
 * this presentation layer so the UI and the server enforce the same rule.
 */
export function getFciDMissingPrerequisiteModules(
  allModules: FciModuleRecord[]
): Array<"A" | "B" | "C"> {
  return FCI_D_PREREQUISITE_MODULES.filter((moduleCode) => {
    const module = allModules.find((item) => item.moduleCode === moduleCode);
    return module?.status !== "validated";
  });
}

const PREREQUISITE_MODULE_LABELS: Record<"A" | "B" | "C", string> = {
  A: "Commerciale",
  B: "Financiere",
  C: "Operations"
};

export function buildFciDWaitingMessage(missingModules: Array<"A" | "B" | "C">) {
  if (missingModules.length === 0) {
    return null;
  }

  const labels = missingModules.map((code) => PREREQUISITE_MODULE_LABELS[code]);
  return `En attente de validation des contributions ${labels.join(", ")}.`;
}

export function buildFciModuleAllowedActions(input: {
  module: FciModuleRecord;
  latestData: FciModuleDataRecord | null;
  latestJob: FciGenerationJobRecord | null;
  sourceFiche: SourceFicheSnapshot | null;
  knowledgeBaseEnabled: boolean;
  currentUser: CurrentUser;
  missingPrerequisiteModules?: Array<"A" | "B" | "C">;
}) {
  const actions: FciModuleAllowedAction[] = ["view_history"];
  const generatable = isFciModuleGeneratable(input.module.moduleCode);
  const activeJob = input.latestJob ? isActiveJobStatus(input.latestJob.status) : false;
  const sourceValidated = input.sourceFiche?.isValidated ?? false;
  const canEdit = canEditFciModule(input.currentUser.role, input.module.moduleCode);
  const canValidate = canValidateFciModule(input.currentUser.role, input.module.moduleCode);
  const canRegenerate = canRegenerateFciModule(input.currentUser.role, input.module.moduleCode);
  const prerequisitesMissing = (input.missingPrerequisiteModules?.length ?? 0) > 0;

  if (canEdit && input.latestData && input.module.status !== "generating") {
    if (input.module.status !== "validated") {
      actions.unshift("validate");
    }
    actions.unshift("edit");
  }

  if (input.module.moduleCode === "E" && !input.knowledgeBaseEnabled) {
    return actions;
  }

  if (generatable && !activeJob && sourceValidated && !prerequisitesMissing) {
    // Also expose "regenerate" when there is no data yet but the last
    // generation attempt failed (module.error_code set): this is the retry
    // path for a first-time generation failure (e.g. AO-20260812-0840/FCI A,
    // a Gemini 503 with no prior successful data), not just for re-running
    // on top of an existing draft.
    if ((input.latestData || input.module.errorCode != null) && canRegenerate) {
      actions.unshift("regenerate");
    }
  }

  if (!canValidate) {
    return actions.filter((action) => action !== "validate");
  }

  return [...new Set(actions)];
}

function buildFciModulePermissions(
  currentUser: CurrentUser,
  moduleCode: FciModuleCode,
  missingPrerequisiteModules: Array<"A" | "B" | "C"> = []
) {
  const canView = canViewFciModule(currentUser.role, moduleCode);
  const canEdit = canEditFciModule(currentUser.role, moduleCode);
  const prerequisitesMissing = missingPrerequisiteModules.length > 0;
  const canGenerate = canGenerateFciModule(currentUser.role, moduleCode) && !prerequisitesMissing;
  const canRegenerate = canRegenerateFciModule(currentUser.role, moduleCode) && !prerequisitesMissing;
  const canValidate = canValidateFciModule(currentUser.role, moduleCode);
  const canMakeDecision = canMakeFinalDecision(currentUser.role);
  const readOnlyMessage = getFciReadOnlyMessage(currentUser.role, moduleCode);

  return {
    can_view: canView,
    can_edit: canEdit,
    can_generate: canGenerate,
    can_regenerate: canRegenerate,
    can_validate: canValidate,
    can_make_final_decision: canMakeDecision,
    read_only: canView && !canEdit,
    read_only_message: readOnlyMessage,
    generation_blocked_reason: buildFciDWaitingMessage(missingPrerequisiteModules)
  };
}

export function buildFciModuleSummary(input: {
  appelOffres: AppelOffresRecord;
  module: FciModuleRecord;
  latestData: FciModuleDataRecord | null;
  latestJob: FciGenerationJobRecord | null;
  sourceFiche: SourceFicheSnapshot | null;
  knowledgeBaseEnabled: boolean;
  currentUser: CurrentUser;
  allModules?: FciModuleRecord[];
}): FciModuleSummaryPresentation {
  const staleSource = isModuleSourceStale(input.latestData, input.sourceFiche);
  const normalizedPayload = normalizeLatestPayload({
    appelOffres: input.appelOffres,
    latestData: input.latestData,
    module: input.module,
    sourceFiche: input.sourceFiche
  });
  const completion = buildCompletionPresentation(normalizedPayload);
  const formStatus = deriveFormStatus({
    module: input.module,
    payload: normalizedPayload,
    completion
  });
  const definition = isDepartmentalModuleCode(input.module.moduleCode)
    ? getFciModuleDefinition(input.module.moduleCode)
    : null;
  const missingPrerequisiteModules = input.module.moduleCode === "D"
    ? getFciDMissingPrerequisiteModules(input.allModules ?? [])
    : [];
  const permissions = buildFciModulePermissions(
    input.currentUser,
    input.module.moduleCode,
    missingPrerequisiteModules
  );

  return {
    module_code: input.module.moduleCode,
    module_type: input.module.moduleType,
    department_code: getSafeDepartmentCode(input.module.moduleCode),
    department_label: getSafeDepartmentLabel(input.module.moduleCode),
    title: definition?.title ?? input.module.moduleCode,
    status: input.module.status,
    form_status: formStatus,
    latest_version: input.latestData?.version ?? null,
    last_updated: input.latestData?.updatedAt ?? input.module.updatedAt,
    last_saved_at: input.latestData?.updatedAt ?? null,
    ai_generated_at: input.module.aiGeneratedAt,
    validated_at: input.module.validatedAt,
    validated_by: input.module.validatedBy,
    has_data: input.latestData != null,
    completion,
    current_error:
      input.module.errorCode || input.module.errorMessage
        ? {
            code: input.module.errorCode,
            message: input.module.errorMessage,
            last_attempt_at: input.latestJob?.completedAt ?? input.latestJob?.createdAt ?? null
          }
        : null,
    stale_source: staleSource,
    missing_prerequisite_modules: missingPrerequisiteModules,
    available_actions: buildFciModuleAllowedActions({
      module: input.module,
      latestData: input.latestData,
      latestJob: input.latestJob,
      sourceFiche: input.sourceFiche,
      knowledgeBaseEnabled: input.knowledgeBaseEnabled,
      currentUser: input.currentUser,
      missingPrerequisiteModules
    }),
    current_user: buildUserPresentation(input.currentUser),
    permissions
  };
}

function buildSourceFreshness(
  sourceFiche: SourceFicheSnapshot | null,
  setSourceVersion: string
) {
  if (!sourceFiche) {
    return "missing" as const;
  }

  return sourceFiche.version === setSourceVersion ? "current" : "stale";
}

export function buildFciWorkspacePresentation(input: {
  appelOffres: AppelOffresRecord;
  detail: FciDetail;
  sourceFiche: SourceFicheSnapshot | null;
  knowledgeBaseEnabled: boolean;
  currentUser: CurrentUser;
}): FciWorkspacePresentation {
  const latestDataByModuleId = indexLatestModuleData(input.detail.moduleData);
  const latestJobsByModuleId = indexLatestGenerationJobs(input.detail.generationJobs);
  const overallStatus = calculateFciOverallStatus({
    modules: input.detail.modules,
    latestDataByModuleId
  });

  return {
    current_user: buildUserPresentation(input.currentUser),
    appel_offres: {
      id: input.appelOffres.id,
      code: input.appelOffres.code,
      title: input.appelOffres.title,
      business_status: input.appelOffres.businessStatus,
      updated_at: input.appelOffres.updatedAt
    },
    fci_set: {
      id: input.detail.set.id,
      overall_status: overallStatus,
      stored_overall_status: input.detail.set.overallStatus,
      created_at: input.detail.set.createdAt,
      updated_at: input.detail.set.updatedAt
    },
    source_fiche: {
      available: input.sourceFiche != null,
      status: input.sourceFiche?.status.status ?? null,
      is_validated: input.sourceFiche?.isValidated ?? false,
      version: input.sourceFiche?.version ?? null,
      updated_at: input.sourceFiche?.updatedAt ?? null,
      hash: input.sourceFiche?.hash ?? null,
      set_version: input.detail.set.sourceFicheVersion,
      set_updated_at: input.detail.set.sourceFicheUpdatedAt,
      freshness: buildSourceFreshness(
        input.sourceFiche,
        input.detail.set.sourceFicheVersion
      )
    },
    progress: buildFciProgress({
      modules: input.detail.modules,
      latestDataByModuleId
    }),
    knowledge_base_enabled: input.knowledgeBaseEnabled,
    enabled_modules: input.detail.modules
      .filter(
        (module) =>
          module.status !== "unavailable"
          && isHumanVisibleFciModuleCode(module.moduleCode)
      )
      .map((module) => module.moduleCode as FciContributingModuleCode),
    module_summaries: input.detail.modules
      .filter((module) => isHumanVisibleFciModuleCode(module.moduleCode))
      .map((module) =>
        buildFciModuleSummary({
          appelOffres: input.appelOffres,
          module,
          latestData: latestDataByModuleId.get(module.id) ?? null,
          latestJob: latestJobsByModuleId.get(module.id) ?? null,
          sourceFiche: input.sourceFiche,
          knowledgeBaseEnabled: input.knowledgeBaseEnabled,
          currentUser: input.currentUser,
          allModules: input.detail.modules
        })
      )
  };
}

export function buildFciModulePresentation(input: {
  appelOffres: AppelOffresRecord;
  module: FciModuleRecord;
  latestData: FciModuleDataRecord | null;
  versions: FciModuleDataRecord[];
  latestJob: FciGenerationJobRecord | null;
  jobs: FciGenerationJobRecord[];
  auditEvents: FciAuditEventRecord[];
  sourceFiche: SourceFicheSnapshot | null;
  knowledgeBaseEnabled: boolean;
  currentUser: CurrentUser;
  allModules?: FciModuleRecord[];
}): FciModulePresentation {
  const staleSource = isModuleSourceStale(input.latestData, input.sourceFiche);
  const normalizedPayload = normalizeLatestPayload({
    appelOffres: input.appelOffres,
    latestData: input.latestData,
    module: input.module,
    sourceFiche: input.sourceFiche
  });
  const completion = buildCompletionPresentation(normalizedPayload);
  const formStatus = deriveFormStatus({
    module: input.module,
    payload: normalizedPayload,
    completion
  });
  const definition = isDepartmentalModuleCode(input.module.moduleCode)
    ? getFciModuleDefinition(input.module.moduleCode)
    : null;
  const missingPrerequisiteModules = input.module.moduleCode === "D"
    ? getFciDMissingPrerequisiteModules(input.allModules ?? [])
    : [];
  const permissions = buildFciModulePermissions(
    input.currentUser,
    input.module.moduleCode,
    missingPrerequisiteModules
  );

  return {
    current_user: buildUserPresentation(input.currentUser),
    appel_offres: {
      code: input.appelOffres.code,
      title: input.appelOffres.title,
      due_date: input.appelOffres.dueDate
    },
    module: {
      id: input.module.id,
      module_code: input.module.moduleCode,
      module_type: input.module.moduleType,
      department_code: getSafeDepartmentCode(input.module.moduleCode),
      department_label: getSafeDepartmentLabel(input.module.moduleCode),
      title: definition?.title ?? input.module.moduleCode,
      status: input.module.status,
      form_status: formStatus,
      ai_generated_at: input.module.aiGeneratedAt,
      validated_at: input.module.validatedAt,
      validated_by: input.module.validatedBy,
      error_code: input.module.errorCode,
      error_message: input.module.errorMessage,
      created_at: input.module.createdAt,
      updated_at: input.module.updatedAt
    },
    latest_data: input.latestData
      ? {
          version: input.latestData.version,
          data: normalizedPayload ?? input.latestData.dataJson,
          source_summary: input.latestData.sourceSummaryJson,
          confidence: input.latestData.confidenceJson,
          ai_notes: input.latestData.aiNotesJson,
          generated_from_fiche_version: input.latestData.generatedFromFicheVersion,
          generated_from_fiche_hash: input.latestData.generatedFromFicheHash,
          created_at: input.latestData.createdAt,
          updated_at: input.latestData.updatedAt
        }
      : null,
    completion,
    generation_job: input.latestJob
      ? {
          id: input.latestJob.id,
          trigger_type: input.latestJob.triggerType,
          provider: input.latestJob.provider,
          model: input.latestJob.model,
          status: input.latestJob.status,
          execution_id: input.latestJob.executionId,
          correlation_id: input.latestJob.correlationId,
          started_at: input.latestJob.startedAt,
          completed_at: input.latestJob.completedAt,
          error_code: input.latestJob.errorCode,
          error_message: input.latestJob.errorMessage,
          created_at: input.latestJob.createdAt
        }
      : null,
    source_fiche: {
      available: input.sourceFiche != null,
      status: input.sourceFiche?.status.status ?? null,
      is_validated: input.sourceFiche?.isValidated ?? false,
      version: input.sourceFiche?.version ?? null,
      updated_at: input.sourceFiche?.updatedAt ?? null,
      hash: input.sourceFiche?.hash ?? null
    },
    stale_source: staleSource,
    missing_prerequisite_modules: missingPrerequisiteModules,
    allowed_actions: buildFciModuleAllowedActions({
      module: input.module,
      latestData: input.latestData,
      latestJob: input.latestJob,
      sourceFiche: input.sourceFiche,
      knowledgeBaseEnabled: input.knowledgeBaseEnabled,
      currentUser: input.currentUser,
      missingPrerequisiteModules
    }),
    permissions,
    history_summary: {
      versions_count: input.versions.length,
      jobs_count: input.jobs.length,
      audit_events_count: input.auditEvents.length,
      latest_version: input.latestData?.version ?? null,
      latest_job_status: input.latestJob?.status ?? null
    }
  };
}
