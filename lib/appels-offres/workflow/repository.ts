import { Pool } from "pg";
import {
  ensureAppelsOffresSchema,
  getAppelOffresRecordByCode
} from "../repository.ts";
import { ensureUserManagementSchema } from "../../users/repository.ts";
import type { DepartmentCode } from "../../users/types.ts";
import type { UserRole } from "../../auth/rbac.ts";
import type {
  AppendTenderWorkflowEventInput,
  FciAssignmentStatus,
  FciAssignableModuleCode,
  FciModuleAssignmentDetail,
  FciModuleAssignmentRecord,
  TenderWorkflowEventRecord,
  TenderWorkflowExplicitState,
  TenderWorkflowStateRecord,
  UpdateFciModuleAssignmentInput,
  UpsertFciModuleAssignmentInput
} from "./types.ts";

const WORKFLOW_STATES_TABLE = "public.appel_offres_workflow_states";
const WORKFLOW_EVENTS_TABLE = "public.appel_offres_workflow_events";
const FCI_ASSIGNMENTS_TABLE = "public.fci_module_assignments";

type GlobalWithPool = typeof globalThis & {
  __appelsOffresWorkflowPool?: Pool;
  __appelsOffresWorkflowSetupPromise?: Promise<void>;
};

type WorkflowStateRow = {
  id: number | string;
  appel_offres_id: number | string;
  current_state: TenderWorkflowExplicitState;
  last_transition_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
};

type WorkflowEventRow = {
  id: number | string;
  appel_offres_id: number | string;
  event_type: string;
  from_state: TenderWorkflowExplicitState | null;
  to_state: TenderWorkflowExplicitState;
  actor_user_id: number | string | null;
  actor_name: string | null;
  payload_json: Record<string, unknown> | null;
  created_at: string | Date;
};

type FciAssignmentRow = {
  id: number | string;
  appel_offres_id: number | string;
  appel_offres_code: string;
  module_code: FciAssignableModuleCode;
  assigned_user_id: number | string;
  assigned_role: UserRole;
  assigned_department_code: DepartmentCode | null;
  assigned_user_status: string | null;
  assigned_by_user_id: number | string;
  assigned_at: string | Date;
  reassigned_at: string | Date | null;
  assignment_status: FciAssignmentStatus;
  created_at: string | Date;
  updated_at: string | Date;
  assigned_user_name: string;
  assigned_user_email: string;
  assigned_by_name: string;
};

function getDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  return value ? value : null;
}

function getPool() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  const globalWithPool = globalThis as GlobalWithPool;
  if (!globalWithPool.__appelsOffresWorkflowPool) {
    globalWithPool.__appelsOffresWorkflowPool = new Pool({
      connectionString: databaseUrl
    });
  }

  return globalWithPool.__appelsOffresWorkflowPool;
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (value == null) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function mapWorkflowStateRow(row: WorkflowStateRow): TenderWorkflowStateRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    currentState: row.current_state,
    lastTransitionAt:
      normalizeTimestamp(row.last_transition_at) ?? new Date(0).toISOString(),
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString()
  };
}

function mapWorkflowEventRow(row: WorkflowEventRow): TenderWorkflowEventRecord {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    eventType: row.event_type,
    fromState: row.from_state,
    toState: row.to_state,
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    actorName: row.actor_name,
    payloadJson: row.payload_json,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString()
  };
}

function mapAssignmentRow(row: FciAssignmentRow): FciModuleAssignmentDetail {
  return {
    id: Number(row.id),
    appelOffresId: Number(row.appel_offres_id),
    appelOffresCode: row.appel_offres_code,
    moduleCode: row.module_code,
    assignedUserId: Number(row.assigned_user_id),
    assignedRole: row.assigned_role,
    assignedDepartmentCode: row.assigned_department_code,
    assignedUserStatus:
      row.assigned_user_status as FciModuleAssignmentRecord["assignedUserStatus"],
    assignedByUserId: Number(row.assigned_by_user_id),
    assignedAt: normalizeTimestamp(row.assigned_at) ?? new Date(0).toISOString(),
    reassignedAt: normalizeTimestamp(row.reassigned_at),
    assignmentStatus: row.assignment_status,
    createdAt: normalizeTimestamp(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: normalizeTimestamp(row.updated_at) ?? new Date(0).toISOString(),
    assignedUserName: row.assigned_user_name,
    assignedUserEmail: row.assigned_user_email,
    assignedByName: row.assigned_by_name
  };
}

async function ensureSchemaInternal(pool: Pool) {
  const client = await pool.connect();

  try {
    await client.query(`
      create table if not exists ${WORKFLOW_STATES_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        current_state text not null check (
          current_state in (
            'FCI_GENERATED',
            'FCI_ASSIGNED',
            'GONOGO_PREPARED',
            'SUBMITTED_TO_DG',
            'UNDER_DG_REVIEW',
            'GO_DECIDED',
            'NO_GO_DECIDED',
            'ARCHIVED'
          )
        ),
        last_transition_at timestamptz not null default now(),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (appel_offres_id)
      )
    `);
    await client.query(`
      create table if not exists ${WORKFLOW_EVENTS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        event_type text not null,
        from_state text null,
        to_state text not null,
        actor_user_id bigint null references public.app_users(id) on delete set null,
        actor_name text null,
        payload_json jsonb null,
        created_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create table if not exists ${FCI_ASSIGNMENTS_TABLE} (
        id bigserial primary key,
        appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
        module_code text not null check (module_code in ('B', 'C')),
        assigned_user_id bigint not null references public.app_users(id) on delete restrict,
        assigned_role text not null check (assigned_role in ('FINANCE', 'OPERATIONS')),
        assigned_department_code text null references public.app_departments(code) on delete set null,
        assigned_by_user_id bigint not null references public.app_users(id) on delete restrict,
        assigned_at timestamptz not null default now(),
        reassigned_at timestamptz null,
        assignment_status text not null check (
          assignment_status in ('assigned', 'in_progress', 'completed', 'validated')
        ) default 'assigned',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (appel_offres_id, module_code)
      )
    `);
    await client.query(`
      create index if not exists appel_offres_workflow_states_appel_idx
      on ${WORKFLOW_STATES_TABLE} (appel_offres_id)
    `);
    await client.query(`
      create index if not exists appel_offres_workflow_events_appel_idx
      on ${WORKFLOW_EVENTS_TABLE} (appel_offres_id, created_at desc)
    `);
    await client.query(`
      create index if not exists fci_module_assignments_assigned_user_idx
      on ${FCI_ASSIGNMENTS_TABLE} (assigned_user_id, updated_at desc)
    `);
    await client.query(`
      create index if not exists fci_module_assignments_status_idx
      on ${FCI_ASSIGNMENTS_TABLE} (assignment_status, updated_at desc)
    `);
  } finally {
    client.release();
  }
}

export async function ensureWorkflowSchema() {
  await ensureAppelsOffresSchema();
  await ensureUserManagementSchema();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const globalWithPool = globalThis as GlobalWithPool;
  if (!globalWithPool.__appelsOffresWorkflowSetupPromise) {
    globalWithPool.__appelsOffresWorkflowSetupPromise = ensureSchemaInternal(pool).catch(
      (error) => {
        globalWithPool.__appelsOffresWorkflowSetupPromise = undefined;
        throw error;
      }
    );
  }

  await globalWithPool.__appelsOffresWorkflowSetupPromise;
}

async function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  await ensureWorkflowSchema();
  return pool;
}

async function requireAppelOffresId(code: string) {
  const record = await getAppelOffresRecordByCode(code, { includeArchived: true });
  if (!record) {
    throw new Error("Appel d'offres introuvable.");
  }

  return record.id;
}

export async function getWorkflowStateByAppelOffresId(appelOffresId: number) {
  const pool = await requirePool();
  const result = await pool.query<WorkflowStateRow>(
    `
      select
        id,
        appel_offres_id,
        current_state,
        last_transition_at,
        created_at,
        updated_at
      from ${WORKFLOW_STATES_TABLE}
      where appel_offres_id = $1
      limit 1
    `,
    [appelOffresId]
  );

  return result.rows[0] ? mapWorkflowStateRow(result.rows[0]) : null;
}

export async function getWorkflowStateByAppelOffresCode(code: string) {
  const appelOffresId = await requireAppelOffresId(code);
  return getWorkflowStateByAppelOffresId(appelOffresId);
}

export async function listWorkflowStatesByAppelOffresCodes(codes: string[]) {
  if (codes.length === 0) {
    return new Map<string, TenderWorkflowStateRecord>();
  }

  const pool = await requirePool();
  const result = await pool.query<WorkflowStateRow & { code: string }>(
    `
      select
        states.id,
        states.appel_offres_id,
        states.current_state,
        states.last_transition_at,
        states.created_at,
        states.updated_at,
        appels.code as code
      from ${WORKFLOW_STATES_TABLE} states
      inner join public.appels_offres appels on appels.id = states.appel_offres_id
      where appels.code = any($1::text[])
    `,
    [codes]
  );

  const stateByCode = new Map<string, TenderWorkflowStateRecord>();
  for (const row of result.rows) {
    stateByCode.set(row.code, mapWorkflowStateRow(row));
  }

  return stateByCode;
}

export async function upsertWorkflowState(
  appelOffresId: number,
  currentState: TenderWorkflowExplicitState,
  lastTransitionAt = new Date().toISOString()
) {
  const pool = await requirePool();
  const result = await pool.query<WorkflowStateRow>(
    `
      insert into ${WORKFLOW_STATES_TABLE} (
        appel_offres_id,
        current_state,
        last_transition_at,
        created_at,
        updated_at
      )
      values ($1, $2, $3, now(), now())
      on conflict (appel_offres_id)
      do update set
        current_state = excluded.current_state,
        last_transition_at = excluded.last_transition_at,
        updated_at = now()
      returning
        id,
        appel_offres_id,
        current_state,
        last_transition_at,
        created_at,
        updated_at
    `,
    [appelOffresId, currentState, lastTransitionAt]
  );

  return mapWorkflowStateRow(result.rows[0]);
}

export async function appendTenderWorkflowEvent(input: AppendTenderWorkflowEventInput) {
  const pool = await requirePool();
  const result = await pool.query<WorkflowEventRow>(
    `
      insert into ${WORKFLOW_EVENTS_TABLE} (
        appel_offres_id,
        event_type,
        from_state,
        to_state,
        actor_user_id,
        actor_name,
        payload_json,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
      returning
        id,
        appel_offres_id,
        event_type,
        from_state,
        to_state,
        actor_user_id,
        actor_name,
        payload_json,
        created_at
    `,
    [
      input.appelOffresId,
      input.eventType,
      input.fromState,
      input.toState,
      input.actorUserId ?? null,
      input.actorName ?? null,
      input.payloadJson ? JSON.stringify(input.payloadJson) : null
    ]
  );

  return mapWorkflowEventRow(result.rows[0]);
}

export async function listTenderWorkflowEventsByAppelOffresId(appelOffresId: number) {
  const pool = await requirePool();
  const result = await pool.query<WorkflowEventRow>(
    `
      select
        id,
        appel_offres_id,
        event_type,
        from_state,
        to_state,
        actor_user_id,
        actor_name,
        payload_json,
        created_at
      from ${WORKFLOW_EVENTS_TABLE}
      where appel_offres_id = $1
      order by created_at desc, id desc
    `,
    [appelOffresId]
  );

  return result.rows.map(mapWorkflowEventRow);
}

export async function getFciAssignmentByAppelOffresIdAndModule(
  appelOffresId: number,
  moduleCode: FciAssignableModuleCode
) {
  const pool = await requirePool();
  const result = await pool.query<FciAssignmentRow>(
    `
      select
        assignments.id,
        assignments.appel_offres_id,
        appels.code as appel_offres_code,
        assignments.module_code,
        assignments.assigned_user_id,
        assignments.assigned_role,
        assignments.assigned_department_code,
        assigned_user.status as assigned_user_status,
        assignments.assigned_by_user_id,
        assignments.assigned_at,
        assignments.reassigned_at,
        assignments.assignment_status,
        assignments.created_at,
        assignments.updated_at,
        assigned_user.display_name as assigned_user_name,
        assigned_user.email as assigned_user_email,
        assigned_by.display_name as assigned_by_name
      from ${FCI_ASSIGNMENTS_TABLE} assignments
      inner join public.appels_offres appels on appels.id = assignments.appel_offres_id
      inner join public.app_users assigned_user on assigned_user.id = assignments.assigned_user_id
      inner join public.app_users assigned_by on assigned_by.id = assignments.assigned_by_user_id
      where assignments.appel_offres_id = $1
        and assignments.module_code = $2
      limit 1
    `,
    [appelOffresId, moduleCode]
  );

  return result.rows[0] ? mapAssignmentRow(result.rows[0]) : null;
}

export async function listFciAssignmentsByAppelOffresId(appelOffresId: number) {
  const pool = await requirePool();
  const result = await pool.query<FciAssignmentRow>(
    `
      select
        assignments.id,
        assignments.appel_offres_id,
        appels.code as appel_offres_code,
        assignments.module_code,
        assignments.assigned_user_id,
        assignments.assigned_role,
        assignments.assigned_department_code,
        assigned_user.status as assigned_user_status,
        assignments.assigned_by_user_id,
        assignments.assigned_at,
        assignments.reassigned_at,
        assignments.assignment_status,
        assignments.created_at,
        assignments.updated_at,
        assigned_user.display_name as assigned_user_name,
        assigned_user.email as assigned_user_email,
        assigned_by.display_name as assigned_by_name
      from ${FCI_ASSIGNMENTS_TABLE} assignments
      inner join public.appels_offres appels on appels.id = assignments.appel_offres_id
      inner join public.app_users assigned_user on assigned_user.id = assignments.assigned_user_id
      inner join public.app_users assigned_by on assigned_by.id = assignments.assigned_by_user_id
      where assignments.appel_offres_id = $1
      order by assignments.module_code asc
    `,
    [appelOffresId]
  );

  return result.rows.map(mapAssignmentRow);
}

export async function listFciAssignmentsByAppelOffresCode(code: string) {
  const appelOffresId = await requireAppelOffresId(code);
  return listFciAssignmentsByAppelOffresId(appelOffresId);
}

export async function listFciAssignmentsByAssignedUserId(assignedUserId: number) {
  const pool = await requirePool();
  const result = await pool.query<FciAssignmentRow>(
    `
      select
        assignments.id,
        assignments.appel_offres_id,
        appels.code as appel_offres_code,
        assignments.module_code,
        assignments.assigned_user_id,
        assignments.assigned_role,
        assignments.assigned_department_code,
        assigned_user.status as assigned_user_status,
        assignments.assigned_by_user_id,
        assignments.assigned_at,
        assignments.reassigned_at,
        assignments.assignment_status,
        assignments.created_at,
        assignments.updated_at,
        assigned_user.display_name as assigned_user_name,
        assigned_user.email as assigned_user_email,
        assigned_by.display_name as assigned_by_name
      from ${FCI_ASSIGNMENTS_TABLE} assignments
      inner join public.appels_offres appels on appels.id = assignments.appel_offres_id
      inner join public.app_users assigned_user on assigned_user.id = assignments.assigned_user_id
      inner join public.app_users assigned_by on assigned_by.id = assignments.assigned_by_user_id
      where assignments.assigned_user_id = $1
      order by assignments.updated_at desc, assignments.id desc
    `,
    [assignedUserId]
  );

  return result.rows.map(mapAssignmentRow);
}

export async function upsertFciAssignment(
  appelOffresId: number,
  moduleCode: FciAssignableModuleCode,
  input: UpsertFciModuleAssignmentInput
) {
  const pool = await requirePool();
  await pool.query(
    `
      insert into ${FCI_ASSIGNMENTS_TABLE} (
        appel_offres_id,
        module_code,
        assigned_user_id,
        assigned_role,
        assigned_department_code,
        assigned_by_user_id,
        assigned_at,
        reassigned_at,
        assignment_status,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
      on conflict (appel_offres_id, module_code)
      do update set
        assigned_user_id = excluded.assigned_user_id,
        assigned_role = excluded.assigned_role,
        assigned_department_code = excluded.assigned_department_code,
        assigned_by_user_id = excluded.assigned_by_user_id,
        assigned_at = excluded.assigned_at,
        reassigned_at = excluded.reassigned_at,
        assignment_status = excluded.assignment_status,
        updated_at = now()
    `,
    [
      appelOffresId,
      moduleCode,
      input.assignedUserId,
      input.assignedRole,
      input.assignedDepartmentCode,
      input.assignedByUserId,
      input.assignedAt ?? new Date().toISOString(),
      input.reassignedAt ?? null,
      input.assignmentStatus
    ]
  );

  return getFciAssignmentByAppelOffresIdAndModule(appelOffresId, moduleCode);
}

export async function updateFciAssignment(
  assignmentId: number,
  input: UpdateFciModuleAssignmentInput
) {
  const assignments: string[] = ["updated_at = now()"];
  const values: Array<string | number | null> = [assignmentId];

  const push = (column: string, value: string | number | null) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };

  if (input.assignedUserId !== undefined) {
    push("assigned_user_id", input.assignedUserId);
  }

  if (input.assignedRole !== undefined) {
    push("assigned_role", input.assignedRole);
  }

  if (input.assignedDepartmentCode !== undefined) {
    push("assigned_department_code", input.assignedDepartmentCode);
  }

  if (input.assignedByUserId !== undefined) {
    push("assigned_by_user_id", input.assignedByUserId);
  }

  if (input.assignedAt !== undefined) {
    push("assigned_at", input.assignedAt);
  }

  if (input.reassignedAt !== undefined) {
    push("reassigned_at", input.reassignedAt);
  }

  if (input.assignmentStatus !== undefined) {
    push("assignment_status", input.assignmentStatus);
  }

  const pool = await requirePool();
  const result = await pool.query<{ appel_offres_id: number | string; module_code: FciAssignableModuleCode }>(
    `
      update ${FCI_ASSIGNMENTS_TABLE}
      set ${assignments.join(", ")}
      where id = $1
      returning
        appel_offres_id,
        module_code
    `,
    values
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return getFciAssignmentByAppelOffresIdAndModule(
    Number(row.appel_offres_id),
    row.module_code
  );
}

export async function closeWorkflowPool() {
  const globalWithPool = globalThis as GlobalWithPool;
  if (globalWithPool.__appelsOffresWorkflowPool) {
    await globalWithPool.__appelsOffresWorkflowPool.end();
    globalWithPool.__appelsOffresWorkflowPool = undefined;
    globalWithPool.__appelsOffresWorkflowSetupPromise = undefined;
  }
}
