begin;

create table if not exists public.appel_offres_workflow_states (
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
);

create table if not exists public.appel_offres_workflow_events (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  event_type text not null,
  from_state text null,
  to_state text not null,
  actor_user_id bigint null references public.app_users(id) on delete set null,
  actor_name text null,
  payload_json jsonb null,
  created_at timestamptz not null default now()
);

create table if not exists public.fci_module_assignments (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  module_code text not null check (module_code in ('B', 'C')),
  assigned_user_id bigint not null references public.app_users(id) on delete restrict,
  assigned_role text not null check (assigned_role in ('FINANCE', 'OPERATIONS')),
  assigned_department_code text null references public.app_departments(code) on delete set null,
  assigned_by_user_id bigint not null references public.app_users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  reassigned_at timestamptz null,
  assignment_status text not null default 'assigned' check (
    assignment_status in ('assigned', 'in_progress', 'completed', 'validated')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appel_offres_id, module_code)
);

create index if not exists appel_offres_workflow_states_appel_idx
  on public.appel_offres_workflow_states (appel_offres_id);

create index if not exists appel_offres_workflow_events_appel_idx
  on public.appel_offres_workflow_events (appel_offres_id, created_at desc);

create index if not exists fci_module_assignments_assigned_user_idx
  on public.fci_module_assignments (assigned_user_id, updated_at desc);

create index if not exists fci_module_assignments_status_idx
  on public.fci_module_assignments (assignment_status, updated_at desc);

commit;
