import {
  appendAuditLog,
  getAppelOffresRecordByCode
} from "../repository.ts";
import type { AppelOffresRecord } from "../types.ts";
import { getUserById } from "../../users/repository.ts";
import type { UserRecord } from "../../users/types.ts";
import {
  canAccess,
  getAreaAccessDeniedMessage,
  type CurrentUser
} from "../../auth/rbac.ts";
import { getFallbackDevelopmentUser } from "../../auth/current-user.ts";
import { AuthError } from "../../auth/errors.ts";
import { appendFciAuditEvent, getFciDetailByAppelOffresCode, getFciSetByAppelOffresCode, listFciModulesByAppelOffresCode } from "../fci/repository.ts";
import { calculateFciOverallStatus, indexLatestModuleData } from "../fci/presentation.ts";
import type { FciModuleRecord } from "../fci/types.ts";
import {
  appendTenderWorkflowEvent,
  getFciAssignmentByAppelOffresIdAndModule,
  getWorkflowStateByAppelOffresId,
  getWorkflowStateByAppelOffresCode,
  listFciAssignmentsByAppelOffresId,
  listFciAssignmentsByAppelOffresCode,
  listFciAssignmentsByAssignedUserId,
  listTenderWorkflowEventsByAppelOffresId,
  upsertFciAssignment,
  upsertWorkflowState,
  updateFciAssignment
} from "./repository.ts";
import { listUsers } from "../../users/repository.ts";
import type {
  FciAssignableModuleCode,
  FciModuleAssignmentDetail,
  TenderWorkflowDerivedState,
  TenderWorkflowExplicitState
} from "./types.ts";
import {
  notifyAssignedUser,
  notifyCommercialUsers,
  notifyDirectionGeneraleUsers,
  notifyReadyForGoNoGoOnce
} from "../../notifications/orchestration.ts";
import {
  assertGoNoGoReportPreparedForSubmission,
  prepareGoNoGoReportForWorkflow,
  submitGoNoGoReportForWorkflow
} from "../go-no-go-report/service.ts";
import { assertCanCoordinateTender } from "../ownership.ts";

export type WorkflowServiceErrorCode =
  | "AO_NOT_FOUND"
  | "RBAC_FORBIDDEN"
  | "FCI_NOT_INITIALIZED"
  | "FCI_MODULE_NOT_ASSIGNABLE"
  | "ASSIGNMENT_NOT_FOUND"
  | "ASSIGNMENT_ALREADY_EXISTS"
  | "ASSIGNMENT_INVALID_TARGET"
  | "ASSIGNMENT_TARGET_INACTIVE"
  | "ASSIGNMENT_FORBIDDEN"
  | "WORKFLOW_TRANSITION_FORBIDDEN"
  | "READY_FOR_GONOGO_REQUIRED"
  | "GONOGO_NOT_PREPARED"
  | "REPORT_REQUIRED";

export class WorkflowServiceError extends Error {
  code: WorkflowServiceErrorCode;
  status: number;
  details: Record<string, unknown> | null;

  constructor(
    code: WorkflowServiceErrorCode,
    message: string,
    status: number,
    details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "WorkflowServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type TenderWorkflowStateView = {
  appel_offres_id: number;
  code: string;
  explicit_state: TenderWorkflowExplicitState | null;
  derived_state: TenderWorkflowDerivedState | null;
  current_state: TenderWorkflowExplicitState | TenderWorkflowDerivedState | null;
  ready_for_gonogo: boolean;
  submitted_to_dg: boolean;
  under_dg_review: boolean;
  assignments_complete: boolean;
  assignments: FciModuleAssignmentDetail[];
};

const WORKFLOW_STATE_ORDER: Record<TenderWorkflowExplicitState, number> = {
  FCI_GENERATED: 1,
  FCI_ASSIGNED: 2,
  GONOGO_PREPARED: 3,
  SUBMITTED_TO_DG: 4,
  UNDER_DG_REVIEW: 5,
  GO_DECIDED: 6,
  NO_GO_DECIDED: 6,
  ARCHIVED: 7
};

function normalizeCurrentUser(currentUser?: CurrentUser | null) {
  return currentUser ?? getFallbackDevelopmentUser();
}

function requireActorUserId(currentUser: CurrentUser) {
  const parsed = parseActorUserId(currentUser, true);
  if (parsed == null) {
    throw new WorkflowServiceError(
      "RBAC_FORBIDDEN",
      "Le profil courant ne peut pas etre resolve pour cette operation.",
      403,
      { user_id: currentUser.id }
    );
  }

  return parsed;
}

function parseActorUserId(currentUser: CurrentUser, required = false) {
  const parsed = Number(currentUser.id);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  if (required) {
    throw new WorkflowServiceError(
      "RBAC_FORBIDDEN",
      "Le profil courant ne peut pas etre resolve pour cette operation.",
      403,
      { user_id: currentUser.id }
    );
  }

  return null;
}

function assertBusinessAccess(currentUser: CurrentUser) {
  if (canAccess(currentUser.role, "appels_offres")) {
    return;
  }

  throw new WorkflowServiceError(
    "RBAC_FORBIDDEN",
    getAreaAccessDeniedMessage("appels_offres", currentUser.role),
    403,
    { role: currentUser.role }
  );
}

function assertCommercialCoordinator(currentUser: CurrentUser) {
  if (currentUser.role === "COMMERCIAL") {
    return;
  }

  throw new WorkflowServiceError(
    "RBAC_FORBIDDEN",
    "Acces refuse : seul le Commercial peut coordonner ce workflow FCI / Go-No-Go.",
    403,
    { role: currentUser.role }
  );
}

async function requireAppelOffres(code: string): Promise<AppelOffresRecord> {
  const appelOffres = await getAppelOffresRecordByCode(code, { includeArchived: true });
  if (!appelOffres) {
    throw new WorkflowServiceError(
      "AO_NOT_FOUND",
      "Appel d'offres introuvable.",
      404,
      { code }
    );
  }

  return appelOffres;
}

async function requireInitializedFci(code: string) {
  const [appelOffres, set, modules] = await Promise.all([
    requireAppelOffres(code),
    getFciSetByAppelOffresCode(code),
    listFciModulesByAppelOffresCode(code)
  ]);

  if (!set || modules.length === 0) {
    throw new WorkflowServiceError(
      "FCI_NOT_INITIALIZED",
      "Les packages FCI doivent exister avant cette operation.",
      409,
      { code }
    );
  }

  return { appelOffres, set, modules };
}

function getAllowedAssignedRole(moduleCode: FciAssignableModuleCode) {
  return moduleCode === "B"
    ? "FINANCE"
    : moduleCode === "C"
      ? "OPERATIONS"
      : "DIRECTION_GENERALE";
}

function getAllowedDepartmentCode(moduleCode: FciAssignableModuleCode) {
  return moduleCode === "B"
    ? "FINANCE"
    : moduleCode === "C"
      ? "OPERATIONS"
      : "DIRECTION_GENERALE";
}

function ensureAssignableModule(moduleCode: string): asserts moduleCode is FciAssignableModuleCode {
  if (moduleCode === "B" || moduleCode === "C" || moduleCode === "D") {
    return;
  }

  throw new WorkflowServiceError(
    "FCI_MODULE_NOT_ASSIGNABLE",
    "Seuls les modules FCI B, C et D peuvent etre affectes.",
    422,
    { module_code: moduleCode }
  );
}

function hasModuleActivity(module: FciModuleRecord, hasData: boolean) {
  return module.status !== "not_started" || hasData;
}

function isSubmittedState(
  state: TenderWorkflowExplicitState | null | undefined
) {
  return (
    state === "SUBMITTED_TO_DG"
    || state === "UNDER_DG_REVIEW"
    || state === "GO_DECIDED"
    || state === "NO_GO_DECIDED"
    || state === "ARCHIVED"
  );
}

async function transitionWorkflowState(input: {
  appelOffresId: number;
  code: string;
  nextState: TenderWorkflowExplicitState;
  actorUserId?: number | null;
  actorName?: string | null;
  eventType: string;
  payload?: Record<string, unknown> | null;
  allowSameState?: boolean;
}) {
  const current = await getWorkflowStateByAppelOffresId(input.appelOffresId);
  const currentState = current?.currentState ?? null;

  if (currentState === input.nextState && !input.allowSameState) {
    return current;
  }

  if (
    currentState
    && WORKFLOW_STATE_ORDER[currentState] > WORKFLOW_STATE_ORDER[input.nextState]
    && input.nextState !== "UNDER_DG_REVIEW"
    && input.nextState !== "ARCHIVED"
  ) {
    throw new WorkflowServiceError(
      "WORKFLOW_TRANSITION_FORBIDDEN",
      "La transition de workflow demandee n'est pas autorisee.",
      409,
      {
        current_state: currentState,
        next_state: input.nextState
      }
    );
  }

  const next = await upsertWorkflowState(
    input.appelOffresId,
    input.nextState,
    new Date().toISOString()
  );
  await appendTenderWorkflowEvent({
    appelOffresId: input.appelOffresId,
    eventType: input.eventType,
    fromState: currentState,
    toState: input.nextState,
    actorUserId: input.actorUserId ?? null,
    actorName: input.actorName ?? null,
    payloadJson: input.payload ?? null
  });
  await appendAuditLog(
    input.code,
    `workflow.${input.eventType}`,
    {
      fromState: currentState,
      toState: input.nextState,
      ...(input.payload ?? {})
    },
    input.actorName ?? null
  );

  return next;
}

export async function recordFciGeneratedWorkflowState(
  code: string,
  currentUser?: CurrentUser | null
) {
  const actor = currentUser ? normalizeCurrentUser(currentUser) : null;
  const actorUserId = actor ? parseActorUserId(actor, false) : null;
  const { appelOffres } = await requireInitializedFci(code);
  const current = await getWorkflowStateByAppelOffresId(appelOffres.id);
  if (current && WORKFLOW_STATE_ORDER[current.currentState] >= WORKFLOW_STATE_ORDER.FCI_GENERATED) {
    return current;
  }

  return transitionWorkflowState({
    appelOffresId: appelOffres.id,
    code,
    nextState: "FCI_GENERATED",
    actorUserId,
    actorName: actor?.name ?? null,
    eventType: "state_changed",
    payload: { reason: "fci_generated" }
  });
}

export async function getAssignmentsForTender(code: string) {
  await requireAppelOffres(code);
  return listFciAssignmentsByAppelOffresCode(code);
}

export async function getAssignmentsForUser(currentUserOrUserId: CurrentUser | number) {
  const userId =
    typeof currentUserOrUserId === "number"
      ? currentUserOrUserId
      : requireActorUserId(currentUserOrUserId);

  return listFciAssignmentsByAssignedUserId(userId);
}

async function validateAssignmentTarget(
  moduleCode: FciAssignableModuleCode,
  assignedUserId: number
): Promise<UserRecord> {
  const user = await getUserById(assignedUserId);
  if (!user) {
    throw new WorkflowServiceError(
      "ASSIGNMENT_INVALID_TARGET",
      "Utilisateur cible introuvable pour cette affectation.",
      404,
      { assigned_user_id: assignedUserId }
    );
  }

  const expectedRole = getAllowedAssignedRole(moduleCode);
  const expectedDepartmentCode = getAllowedDepartmentCode(moduleCode);

  if (user.role !== expectedRole || user.departmentCode !== expectedDepartmentCode) {
    throw new WorkflowServiceError(
      "ASSIGNMENT_INVALID_TARGET",
      `Le module ${moduleCode} ne peut etre affecte qu'a un utilisateur ${expectedRole}.`,
      422,
      {
        module_code: moduleCode,
        assigned_user_id: user.id,
        assigned_role: user.role,
        expected_role: expectedRole
      }
    );
  }

  if (user.status !== "ACTIVE") {
    throw new WorkflowServiceError(
      "ASSIGNMENT_TARGET_INACTIVE",
      "Le module ne peut etre affecte qu'a un utilisateur actif.",
      422,
      {
        module_code: moduleCode,
        assigned_user_id: user.id,
        status: user.status
      }
    );
  }

  return user;
}

async function emitReadyForGoNoGoNotificationsIfNeeded(
  code: string,
  currentUser?: CurrentUser | null
) {
  const workflow = await deriveTenderWorkflowState(code);
  if (!workflow.ready_for_gonogo) {
    return workflow;
  }

  await notifyReadyForGoNoGoOnce({
    appelOffreCode: code,
    currentUser
  });

  return workflow;
}

async function bumpWorkflowToAssignedIfReady(
  code: string,
  appelOffresId: number,
  actor: CurrentUser
) {
  const assignments = await listFciAssignmentsByAppelOffresId(appelOffresId);
  const hasB = assignments.some((assignment) => assignment.moduleCode === "B");
  const hasC = assignments.some((assignment) => assignment.moduleCode === "C");
  const hasD = assignments.some((assignment) => assignment.moduleCode === "D");

  if (!hasB || !hasC || !hasD) {
    return getWorkflowStateByAppelOffresId(appelOffresId);
  }

  const current = await getWorkflowStateByAppelOffresId(appelOffresId);
  if (
    current
    && WORKFLOW_STATE_ORDER[current.currentState] > WORKFLOW_STATE_ORDER.FCI_ASSIGNED
  ) {
    return current;
  }

  return transitionWorkflowState({
    appelOffresId,
    code,
    nextState: "FCI_ASSIGNED",
    actorUserId: parseActorUserId(actor, false),
    actorName: actor.name,
    eventType: "state_changed",
    payload: { reason: "all_contributing_modules_assigned" }
  });
}

export async function assignFciModule(input: {
  code: string;
  moduleCode: FciAssignableModuleCode;
  assignedUserId: number;
  currentUser?: CurrentUser | null;
}) {
  const actor = normalizeCurrentUser(input.currentUser);
  assertBusinessAccess(actor);
  assertCommercialCoordinator(actor);
  await assertCanCoordinateTender(input.code, actor);
  ensureAssignableModule(input.moduleCode);

  const actorUserId = requireActorUserId(actor);
  const { appelOffres } = await requireInitializedFci(input.code);
  await recordFciGeneratedWorkflowState(input.code, actor);
  const targetUser = await validateAssignmentTarget(input.moduleCode, input.assignedUserId);
  const existing = await getFciAssignmentByAppelOffresIdAndModule(
    appelOffres.id,
    input.moduleCode
  );

  if (existing) {
    throw new WorkflowServiceError(
      "ASSIGNMENT_ALREADY_EXISTS",
      "Cette contribution est deja affectee. Utilisez la reaffectation pour la changer.",
      409,
      {
        module_code: input.moduleCode,
        assignment_id: existing.id,
        assigned_user_id: existing.assignedUserId
      }
    );
  }

  const assignment = await upsertFciAssignment(appelOffres.id, input.moduleCode, {
    assignedUserId: targetUser.id,
    assignedRole: targetUser.role,
    assignedDepartmentCode: targetUser.departmentCode,
    assignedByUserId: actorUserId,
    assignmentStatus: "assigned"
  });
  if (!assignment) {
    throw new WorkflowServiceError(
      "ASSIGNMENT_NOT_FOUND",
      "Affectation introuvable apres creation.",
      404,
      {
        module_code: input.moduleCode,
        assigned_user_id: targetUser.id
      }
    );
  }

  await appendFciAuditEvent({
    appelOffresId: appelOffres.id,
    eventType: "fci.assignment.created",
    actor: actor.name,
    payloadJson: {
      moduleCode: input.moduleCode,
      assignmentId: assignment.id,
      assignedUserId: targetUser.id,
      assignedUserName: targetUser.displayName
    }
  });

  await notifyAssignedUser({
    appelOffreCode: input.code,
    moduleCode: input.moduleCode,
    eventType: "FCI_ASSIGNED",
    recipientUserId: targetUser.id,
    recipientRole: targetUser.role,
    currentUser: actor,
    metadata: {
      assignedUserName: targetUser.displayName
    }
  });

  await bumpWorkflowToAssignedIfReady(input.code, appelOffres.id, actor);
  return assignment;
}

/** Assigns the single active Finance, Operations and DG contributors when FCI opens. */
export async function autoAssignFciContributors(input: {
  code: string;
  currentUser: CurrentUser;
}) {
  const results: FciModuleAssignmentDetail[] = [];
  for (const target of [
    { moduleCode: "B" as const, role: "FINANCE" as const },
    { moduleCode: "C" as const, role: "OPERATIONS" as const },
    { moduleCode: "D" as const, role: "DIRECTION_GENERALE" as const }
  ]) {
    const activeUsers = await listUsers({ role: target.role, status: "ACTIVE" });
    if (activeUsers.length !== 1) {
      await appendAuditLog(input.code, "fci.assignment.automatic_skipped", {
        moduleCode: target.moduleCode,
        role: target.role,
        activeUserCount: activeUsers.length,
        reason: "single_active_employee_required"
      }, input.currentUser.name);
      continue;
    }

    const existing = await getAssignmentsForTender(input.code);
    const current = existing.find((assignment) => assignment.moduleCode === target.moduleCode);
    if (current) {
      results.push(current);
      continue;
    }

    results.push(await assignFciModule({
      code: input.code,
      moduleCode: target.moduleCode,
      assignedUserId: activeUsers[0].id,
      currentUser: input.currentUser
    }));
  }
  return results;
}

export async function reassignFciModule(input: {
  code: string;
  moduleCode: FciAssignableModuleCode;
  assignedUserId: number;
  currentUser?: CurrentUser | null;
}) {
  const actor = normalizeCurrentUser(input.currentUser);
  assertBusinessAccess(actor);
  assertCommercialCoordinator(actor);
  await assertCanCoordinateTender(input.code, actor);
  ensureAssignableModule(input.moduleCode);

  const actorUserId = requireActorUserId(actor);
  const { appelOffres } = await requireInitializedFci(input.code);
  const existing = await getFciAssignmentByAppelOffresIdAndModule(
    appelOffres.id,
    input.moduleCode
  );
  if (!existing) {
    throw new WorkflowServiceError(
      "ASSIGNMENT_NOT_FOUND",
      "Aucune affectation existante a reattribuer pour ce module.",
      404,
      { module_code: input.moduleCode }
    );
  }

  const targetUser = await validateAssignmentTarget(input.moduleCode, input.assignedUserId);
  const reassignedAt = new Date().toISOString();
  const assignment = await updateFciAssignment(existing.id, {
    assignedUserId: targetUser.id,
    assignedRole: targetUser.role,
    assignedDepartmentCode: targetUser.departmentCode,
    assignedByUserId: actorUserId,
    assignedAt: reassignedAt,
    reassignedAt,
    assignmentStatus: "assigned"
  });

  if (!assignment) {
    throw new WorkflowServiceError(
      "ASSIGNMENT_NOT_FOUND",
      "Affectation introuvable apres reaffectation.",
      404,
      { assignment_id: existing.id }
    );
  }

  await appendFciAuditEvent({
    appelOffresId: appelOffres.id,
    eventType: "fci.assignment.changed",
    actor: actor.name,
    payloadJson: {
      moduleCode: input.moduleCode,
      assignmentId: assignment.id,
      previousAssignedUserId: existing.assignedUserId,
      previousAssignedUserName: existing.assignedUserName,
      assignedUserId: targetUser.id,
      assignedUserName: targetUser.displayName
    }
  });

  await notifyAssignedUser({
    appelOffreCode: input.code,
    moduleCode: input.moduleCode,
    eventType: "FCI_REASSIGNED",
    recipientUserId: targetUser.id,
    recipientRole: targetUser.role,
    currentUser: actor,
    metadata: {
      assignedUserName: targetUser.displayName,
      previousAssignedUserName: existing.assignedUserName
    }
  });

  await bumpWorkflowToAssignedIfReady(input.code, appelOffres.id, actor);
  return assignment;
}

export async function markAssignmentStarted(input: {
  code: string;
  moduleCode: FciAssignableModuleCode;
  currentUser?: CurrentUser | null;
}) {
  const actor = normalizeCurrentUser(input.currentUser);
  assertBusinessAccess(actor);
  ensureAssignableModule(input.moduleCode);

  const actorUserId = requireActorUserId(actor);
  const appelOffres = await requireAppelOffres(input.code);
  const assignment = await getFciAssignmentByAppelOffresIdAndModule(
    appelOffres.id,
    input.moduleCode
  );
  if (!assignment) {
    throw new WorkflowServiceError(
      "ASSIGNMENT_NOT_FOUND",
      "Le module n'est pas encore affecte.",
      404,
      { module_code: input.moduleCode }
    );
  }

  if (assignment.assignedUserId !== actorUserId) {
    throw new WorkflowServiceError(
      "ASSIGNMENT_FORBIDDEN",
      "Seul l'utilisateur affecte peut demarrer cette contribution.",
      403,
      {
        module_code: input.moduleCode,
        assigned_user_id: assignment.assignedUserId,
        actor_user_id: actorUserId
      }
    );
  }

  if (assignment.assignmentStatus !== "assigned") {
    return assignment;
  }

  const updated = await updateFciAssignment(assignment.id, {
    assignmentStatus: "in_progress"
  });
  if (!updated) {
    throw new WorkflowServiceError(
      "ASSIGNMENT_NOT_FOUND",
      "Affectation introuvable apres demarrage.",
      404,
      { assignment_id: assignment.id }
    );
  }

  await appendFciAuditEvent({
    appelOffresId: appelOffres.id,
    eventType: "fci.assignment.started",
    actor: actor.name,
    payloadJson: {
      moduleCode: input.moduleCode,
      assignmentId: assignment.id,
      assignedUserId: assignment.assignedUserId
    }
  });

  await notifyCommercialUsers({
    appelOffreCode: input.code,
    eventType: "FCI_STARTED",
    moduleCode: input.moduleCode,
    currentUser: actor
  });

  return updated;
}

export async function markAssignmentCompleted(input: {
  code: string;
  moduleCode: FciAssignableModuleCode;
  currentUser?: CurrentUser | null;
}) {
  const actor = normalizeCurrentUser(input.currentUser);
  const actorUserId = requireActorUserId(actor);
  const appelOffres = await requireAppelOffres(input.code);
  const assignment = await getFciAssignmentByAppelOffresIdAndModule(
    appelOffres.id,
    input.moduleCode
  );
  if (!assignment || assignment.assignedUserId !== actorUserId) {
    return assignment;
  }

  if (
    assignment.assignmentStatus === "completed"
    || assignment.assignmentStatus === "validated"
  ) {
    return assignment;
  }

  const updated = await updateFciAssignment(assignment.id, {
    assignmentStatus: "completed"
  });

  if (updated) {
    await appendFciAuditEvent({
      appelOffresId: appelOffres.id,
      eventType: "fci.assignment.completed",
      actor: actor.name,
      payloadJson: {
        moduleCode: input.moduleCode,
        assignmentId: assignment.id,
        assignedUserId: assignment.assignedUserId
      }
    });

    await notifyCommercialUsers({
      appelOffreCode: input.code,
      eventType: "FCI_COMPLETED",
      moduleCode: input.moduleCode,
      currentUser: actor
    });
  }

  return updated;
}

export async function markAssignmentValidated(input: {
  code: string;
  moduleCode: FciAssignableModuleCode;
  currentUser?: CurrentUser | null;
}) {
  const actor = normalizeCurrentUser(input.currentUser);
  const actorUserId = requireActorUserId(actor);
  const appelOffres = await requireAppelOffres(input.code);
  const assignment = await getFciAssignmentByAppelOffresIdAndModule(
    appelOffres.id,
    input.moduleCode
  );
  if (!assignment || assignment.assignedUserId !== actorUserId) {
    return assignment;
  }

  if (assignment.assignmentStatus === "validated") {
    return assignment;
  }

  const updated = await updateFciAssignment(assignment.id, {
    assignmentStatus: "validated"
  });

  if (updated) {
    await appendFciAuditEvent({
      appelOffresId: appelOffres.id,
      eventType: "fci.assignment.validated",
      actor: actor.name,
      payloadJson: {
        moduleCode: input.moduleCode,
        assignmentId: assignment.id,
        assignedUserId: assignment.assignedUserId
      }
    });

    await notifyCommercialUsers({
      appelOffreCode: input.code,
      eventType: "FCI_VALIDATED",
      moduleCode: input.moduleCode,
      currentUser: actor
    });
    await emitReadyForGoNoGoNotificationsIfNeeded(input.code, actor);
  }

  return updated;
}

export async function deriveTenderWorkflowState(code: string): Promise<TenderWorkflowStateView> {
  const appelOffres = await requireAppelOffres(code);
  const [workflowState, assignments, fciDetail] = await Promise.all([
    getWorkflowStateByAppelOffresId(appelOffres.id),
    listFciAssignmentsByAppelOffresCode(code),
    getFciDetailByAppelOffresCode(code)
  ]);

  // Readiness must not survive a Fiche CDC that has since reverted to a
  // draft (e.g. CDC replaced after FCI was already validated) - otherwise
  // ready_for_gonogo stays true on stale data. businessStatus is already
  // loaded on appelOffres, so this costs no extra I/O.
  const ficheCurrentlyValidated =
    appelOffres.businessStatus === "fiche_validee"
    || appelOffres.businessStatus === "offre_autorisee"
    || appelOffres.businessStatus === "offre_rejetee";
  const overallStatus = fciDetail
    ? calculateFciOverallStatus({
        modules: fciDetail.modules,
        latestDataByModuleId: indexLatestModuleData(fciDetail.moduleData),
        ficheCurrentlyValidated
      })
    : "not_started";

  const hasB = assignments.some((assignment) => assignment.moduleCode === "B");
  const hasC = assignments.some((assignment) => assignment.moduleCode === "C");
  const hasD = assignments.some((assignment) => assignment.moduleCode === "D");
  const assignmentsComplete = hasB && hasC && hasD;
  const modules = fciDetail?.modules.filter((module) =>
    module.moduleCode === "A" || module.moduleCode === "B" || module.moduleCode === "C" || module.moduleCode === "D"
  ) ?? [];
  const latestDataByModuleId = indexLatestModuleData(fciDetail?.moduleData ?? []);
  const anyActivity = modules.some((module) =>
    hasModuleActivity(module, latestDataByModuleId.has(module.id))
  ) || assignments.some((assignment) => assignment.assignmentStatus !== "assigned");

  let derivedState: TenderWorkflowDerivedState | null = null;
  if (overallStatus === "validated") {
    derivedState = "READY_FOR_GONOGO";
  } else if (assignmentsComplete || anyActivity) {
    derivedState = "FCI_IN_PROGRESS";
  }

  const explicitState =
    workflowState?.currentState
    ?? (fciDetail ? "FCI_GENERATED" : null);

  return {
    appel_offres_id: appelOffres.id,
    code,
    explicit_state: explicitState,
    derived_state: derivedState,
    current_state: derivedState === "READY_FOR_GONOGO" ? derivedState : explicitState ?? derivedState,
    ready_for_gonogo: derivedState === "READY_FOR_GONOGO",
    submitted_to_dg: isSubmittedState(explicitState),
    under_dg_review: explicitState === "UNDER_DG_REVIEW",
    assignments_complete: assignmentsComplete,
    assignments
  };
}

export async function prepareGoNoGo(
  code: string,
  currentUser?: CurrentUser | null
) {
  const actor = normalizeCurrentUser(currentUser);
  assertBusinessAccess(actor);
  assertCommercialCoordinator(actor);
  await assertCanCoordinateTender(code, actor);

  const workflow = await deriveTenderWorkflowState(code);
  if (!workflow.ready_for_gonogo) {
    throw new WorkflowServiceError(
      "READY_FOR_GONOGO_REQUIRED",
      "Le Go/No-Go ne peut etre prepare qu'une fois les quatre contributions departementales validees.",
      409,
      {
        explicit_state: workflow.explicit_state,
        derived_state: workflow.derived_state
      }
    );
  }

  if (
    workflow.explicit_state === "GONOGO_PREPARED"
    || workflow.explicit_state === "SUBMITTED_TO_DG"
    || workflow.explicit_state === "UNDER_DG_REVIEW"
    || workflow.explicit_state === "GO_DECIDED"
    || workflow.explicit_state === "NO_GO_DECIDED"
    || workflow.explicit_state === "ARCHIVED"
  ) {
    return getWorkflowStateByAppelOffresCode(code);
  }

  await prepareGoNoGoReportForWorkflow(code, actor);

  const next = await transitionWorkflowState({
    appelOffresId: workflow.appel_offres_id,
    code,
    nextState: "GONOGO_PREPARED",
    actorUserId: parseActorUserId(actor, false),
    actorName: actor.name,
    eventType: "gonogo_prepared",
    payload: { ready_for_gonogo: true }
  });

  await notifyCommercialUsers({
    appelOffreCode: code,
    eventType: "GONOGO_PREPARED",
    currentUser: actor,
    dedupeKey: `gonogo-prepared:${code}`,
    section: "go-no-go"
  });

  return next;
}

export async function submitGoNoGoToDg(
  code: string,
  currentUser?: CurrentUser | null
) {
  const actor = normalizeCurrentUser(currentUser);
  assertBusinessAccess(actor);
  assertCommercialCoordinator(actor);
  await assertCanCoordinateTender(code, actor);

  const workflow = await deriveTenderWorkflowState(code);
  if (!workflow.ready_for_gonogo) {
    throw new WorkflowServiceError(
      "READY_FOR_GONOGO_REQUIRED",
      "Le dossier doit etre pret pour Go/No-Go avant soumission a la Direction generale.",
      409,
      {
        explicit_state: workflow.explicit_state,
        derived_state: workflow.derived_state
      }
    );
  }

  await assertGoNoGoReportPreparedForSubmission(code, actor);

  if (
    workflow.explicit_state !== "GONOGO_PREPARED"
    && workflow.explicit_state !== "SUBMITTED_TO_DG"
    && workflow.explicit_state !== "UNDER_DG_REVIEW"
  ) {
    throw new WorkflowServiceError(
      "GONOGO_NOT_PREPARED",
      "Le package Go/No-Go doit etre prepare avant soumission a la Direction generale.",
      409,
      { explicit_state: workflow.explicit_state }
    );
  }

  if (
    workflow.explicit_state === "SUBMITTED_TO_DG"
    || workflow.explicit_state === "UNDER_DG_REVIEW"
  ) {
    return getWorkflowStateByAppelOffresCode(code);
  }

  await submitGoNoGoReportForWorkflow(code, actor);

  const next = await transitionWorkflowState({
    appelOffresId: workflow.appel_offres_id,
    code,
    nextState: "SUBMITTED_TO_DG",
    actorUserId: parseActorUserId(actor, false),
    actorName: actor.name,
    eventType: "submitted_to_dg",
    payload: {
      ready_for_gonogo: true,
      assignment_count: workflow.assignments.length
    }
  });

  await notifyDirectionGeneraleUsers({
    appelOffreCode: code,
    currentUser: actor
  });

  return next;
}

export async function markTenderUnderDgReview(
  code: string,
  currentUser?: CurrentUser | null
) {
  const actor = normalizeCurrentUser(currentUser);
  if (actor.role !== "DIRECTION_GENERALE") {
    return getWorkflowStateByAppelOffresCode(code);
  }

  const workflow = await deriveTenderWorkflowState(code);
  if (!isSubmittedState(workflow.explicit_state)) {
    throw new WorkflowServiceError(
      "RBAC_FORBIDDEN",
      "La Direction generale ne peut relire ce dossier qu'apres soumission par le Commercial.",
      403,
      {
        explicit_state: workflow.explicit_state,
        role: actor.role
      }
    );
  }

  if (
    workflow.explicit_state === "UNDER_DG_REVIEW"
    || workflow.explicit_state === "GO_DECIDED"
    || workflow.explicit_state === "NO_GO_DECIDED"
    || workflow.explicit_state === "ARCHIVED"
  ) {
    return getWorkflowStateByAppelOffresCode(code);
  }

  return transitionWorkflowState({
    appelOffresId: workflow.appel_offres_id,
    code,
    nextState: "UNDER_DG_REVIEW",
    actorUserId: parseActorUserId(actor, false),
    actorName: actor.name,
    eventType: "under_dg_review",
    payload: { source_state: workflow.explicit_state }
  });
}

export async function markTenderDecisionState(input: {
  code: string;
  decision: "go" | "no_go";
  currentUser?: CurrentUser | null;
}) {
  const actor = normalizeCurrentUser(input.currentUser);
  const workflow = await deriveTenderWorkflowState(input.code);
  const actorUserId = parseActorUserId(actor, false);
  const nextState =
    input.decision === "go" ? "GO_DECIDED" : "NO_GO_DECIDED";

  await transitionWorkflowState({
    appelOffresId: workflow.appel_offres_id,
    code: input.code,
    nextState,
    actorUserId,
    actorName: actor.name,
    eventType: input.decision === "go" ? "go_decided" : "no_go_decided",
    payload: { decision: input.decision }
  });

  if (input.decision === "no_go") {
    await transitionWorkflowState({
      appelOffresId: workflow.appel_offres_id,
      code: input.code,
      nextState: "ARCHIVED",
      actorUserId,
      actorName: actor.name,
      eventType: "archived",
      payload: { reason: "no_go_archive" },
      allowSameState: true
    });
  }

  return getWorkflowStateByAppelOffresCode(input.code);
}

export async function markTenderReopenedForDecision(
  code: string,
  currentUser?: CurrentUser | null
) {
  const actor = normalizeCurrentUser(currentUser);
  const workflow = await deriveTenderWorkflowState(code);

  return transitionWorkflowState({
    appelOffresId: workflow.appel_offres_id,
    code,
    nextState: "UNDER_DG_REVIEW",
    actorUserId: parseActorUserId(actor, false),
    actorName: actor.name,
    eventType: "decision_reopened",
    payload: { source_state: workflow.explicit_state },
    allowSameState: true
  });
}

export async function getTenderWorkflowEvents(code: string) {
  const appelOffres = await requireAppelOffres(code);
  return listTenderWorkflowEventsByAppelOffresId(appelOffres.id);
}

export async function listAssignableUsersForModule(
  moduleCode: FciAssignableModuleCode,
  currentUser?: CurrentUser | null
) {
  const actor = normalizeCurrentUser(currentUser);
  assertBusinessAccess(actor);
  assertCommercialCoordinator(actor);
  ensureAssignableModule(moduleCode);

  const expectedRole = getAllowedAssignedRole(moduleCode);
  const expectedDepartmentCode = getAllowedDepartmentCode(moduleCode);
  const users = await listUsers({
    role: expectedRole,
    department: expectedDepartmentCode,
    status: "ACTIVE"
  });

  return users.filter(
    (user) => user.role === expectedRole && user.departmentCode === expectedDepartmentCode
  );
}

export async function sendAssignmentReminder(input: {
  code: string;
  moduleCode: FciAssignableModuleCode;
  currentUser?: CurrentUser | null;
}) {
  const actor = normalizeCurrentUser(input.currentUser);
  assertBusinessAccess(actor);
  assertCommercialCoordinator(actor);
  await assertCanCoordinateTender(input.code, actor);
  ensureAssignableModule(input.moduleCode);

  const appelOffres = await requireAppelOffres(input.code);
  const assignment = await getFciAssignmentByAppelOffresIdAndModule(
    appelOffres.id,
    input.moduleCode
  );
  if (!assignment) {
    throw new WorkflowServiceError(
      "ASSIGNMENT_NOT_FOUND",
      "Cette contribution doit etre affectee avant de pouvoir etre relancee.",
      404,
      { module_code: input.moduleCode }
    );
  }

  const acceptedStatuses = new Set(["assigned", "in_progress", "completed"]);
  if (!acceptedStatuses.has(assignment.assignmentStatus)) {
    throw new WorkflowServiceError(
      "WORKFLOW_TRANSITION_FORBIDDEN",
      "Cette contribution ne peut pas etre relancee dans son etat actuel.",
      409,
      {
        module_code: input.moduleCode,
        assignment_status: assignment.assignmentStatus
      }
    );
  }

  await appendFciAuditEvent({
    appelOffresId: appelOffres.id,
    eventType: "fci.reminder.sent",
    actor: actor.name,
    payloadJson: {
      moduleCode: input.moduleCode,
      assignmentId: assignment.id,
      assignedUserId: assignment.assignedUserId
    }
  });

  await notifyAssignedUser({
    appelOffreCode: input.code,
    moduleCode: input.moduleCode,
    eventType: "REMINDER_SENT",
    recipientUserId: assignment.assignedUserId,
    recipientRole: assignment.assignedRole,
    currentUser: actor
  });

  return assignment;
}

export async function emitReadyForGoNoGoNotifications(
  code: string,
  currentUser?: CurrentUser | null
) {
  return emitReadyForGoNoGoNotificationsIfNeeded(code, currentUser);
}

export async function assertAssignmentAccess(input: {
  code: string;
  moduleCode: string;
  currentUser?: CurrentUser | null;
  requireAssignedUser?: boolean;
}) {
  const actor = normalizeCurrentUser(input.currentUser);
  assertBusinessAccess(actor);

  if (actor.role === "COMMERCIAL") {
    if (input.requireAssignedUser) {
      await assertCanCoordinateTender(input.code, actor);
    }
    return { actor, assignment: null };
  }

  if (actor.role === "DIRECTION_GENERALE") {
    if (input.moduleCode !== "D") {
      const workflow = await deriveTenderWorkflowState(input.code);
      if (!isSubmittedState(workflow.explicit_state)) {
        throw new WorkflowServiceError(
          "RBAC_FORBIDDEN",
          "La Direction generale ne peut consulter les autres FCI qu'apres soumission par le Commercial.",
          403,
          { role: actor.role, explicit_state: workflow.explicit_state }
        );
      }
      return { actor, assignment: null };
    }
  }

  if (actor.role === "FINANCE" && input.moduleCode !== "B") {
    throw new WorkflowServiceError(
      "ASSIGNMENT_FORBIDDEN",
      "La Finance ne peut acceder qu'a son module B affecte.",
      403,
      {
        role: actor.role,
        module_code: input.moduleCode
      }
    );
  }

  if (actor.role === "OPERATIONS" && input.moduleCode !== "C") {
    throw new WorkflowServiceError(
      "ASSIGNMENT_FORBIDDEN",
      "Les Operations ne peuvent acceder qu'a leur module C affecte.",
      403,
      {
        role: actor.role,
        module_code: input.moduleCode
      }
    );
  }

  if (actor.role === "DIRECTION_GENERALE" && input.moduleCode !== "D") {
    throw new WorkflowServiceError(
      "ASSIGNMENT_FORBIDDEN",
      "La Direction generale ne peut agir que sur son module D affecte.",
      403,
      { role: actor.role, module_code: input.moduleCode }
    );
  }

  ensureAssignableModule(input.moduleCode);
  const actorUserId = requireActorUserId(actor);
  const appelOffres = await requireAppelOffres(input.code);
  const assignment = await getFciAssignmentByAppelOffresIdAndModule(
    appelOffres.id,
    input.moduleCode
  );

  if (!assignment) {
    throw new WorkflowServiceError(
      "ASSIGNMENT_FORBIDDEN",
      `Le module ${input.moduleCode} n'est pas encore affecte.`,
      403,
      { module_code: input.moduleCode }
    );
  }

  if (assignment.assignedUserId !== actorUserId) {
    throw new WorkflowServiceError(
      "ASSIGNMENT_FORBIDDEN",
      `Le module ${input.moduleCode} est affecte a un autre utilisateur.`,
      403,
      {
        module_code: input.moduleCode,
        assigned_user_id: assignment.assignedUserId,
        actor_user_id: actorUserId
      }
    );
  }

  if (input.requireAssignedUser && actor.role !== assignment.assignedRole) {
    throw new WorkflowServiceError(
      "ASSIGNMENT_FORBIDDEN",
      `Seul l'utilisateur ${assignment.assignedRole} affecte peut agir sur ce module.`,
      403,
      {
        module_code: input.moduleCode,
        assigned_role: assignment.assignedRole,
        actor_role: actor.role
      }
    );
  }

  return { actor, assignment };
}

export async function assertTenderWorkflowAccess(
  code: string,
  currentUser?: CurrentUser | null
) {
  const actor = normalizeCurrentUser(currentUser);
  assertBusinessAccess(actor);

  if (actor.role === "COMMERCIAL") {
    return actor;
  }

  if (actor.role === "FINANCE") {
    await assertAssignmentAccess({
      code,
      moduleCode: "B",
      currentUser: actor
    });
    return actor;
  }

  if (actor.role === "OPERATIONS") {
    await assertAssignmentAccess({
      code,
      moduleCode: "C",
      currentUser: actor
    });
    return actor;
  }

  if (actor.role === "DIRECTION_GENERALE") {
    await assertAssignmentAccess({
      code,
      moduleCode: "D",
      currentUser: actor
    });
    return actor;
  }

  return actor;
}

export function toWorkflowErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return {
      status: error.status,
      body: {
        ok: false,
        error: { code: error.code, message: error.message, details: {} }
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

  const message =
    error instanceof Error ? error.message : "Erreur workflow inattendue.";

  return {
    status: 500,
    body: {
      ok: false,
      error: { code: "WORKFLOW_INTERNAL_ERROR", message, details: {} }
    }
  };
}
