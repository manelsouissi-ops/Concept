begin;

create table if not exists public.fci_sets (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  source_fiche_version text not null,
  source_fiche_hash text not null,
  source_fiche_updated_at timestamptz not null,
  overall_status text not null check (
    overall_status in ('not_started', 'in_progress', 'needs_review', 'validated', 'failed')
  ) default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appel_offres_id)
);

create index if not exists fci_sets_appel_offres_id_idx
  on public.fci_sets (appel_offres_id);

create table if not exists public.fci_modules (
  id bigserial primary key,
  fci_set_id bigint not null references public.fci_sets(id) on delete cascade,
  module_code text not null check (module_code in ('A', 'B', 'C', 'D', 'E')),
  module_type text not null check (
    module_type in ('commercial', 'finance', 'operations', 'strategy', 'experience')
  ),
  status text not null check (
    status in ('not_started', 'generating', 'generated', 'needs_review', 'validated', 'failed', 'unavailable')
  ) default 'not_started',
  ai_generated_at timestamptz null,
  validated_at timestamptz null,
  validated_by text null,
  error_code text null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fci_set_id, module_code)
);

create index if not exists fci_modules_module_code_idx
  on public.fci_modules (module_code);

create index if not exists fci_modules_status_idx
  on public.fci_modules (status);

create index if not exists fci_modules_fci_set_id_idx
  on public.fci_modules (fci_set_id, created_at desc);

create table if not exists public.fci_module_data (
  id bigserial primary key,
  fci_module_id bigint not null references public.fci_modules(id) on delete cascade,
  data_json jsonb not null default '{}'::jsonb,
  source_summary_json jsonb null,
  confidence_json jsonb null,
  ai_notes_json jsonb null,
  version integer not null default 1,
  generated_from_fiche_version text null,
  generated_from_fiche_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fci_module_data
  drop constraint if exists fci_module_data_fci_module_id_key;

create unique index if not exists fci_module_data_module_version_uidx
  on public.fci_module_data (fci_module_id, version);

create index if not exists fci_module_data_module_created_at_idx
  on public.fci_module_data (fci_module_id, created_at desc, id desc);

create table if not exists public.fci_generation_jobs (
  id bigserial primary key,
  fci_module_id bigint not null references public.fci_modules(id) on delete cascade,
  trigger_type text not null check (
    trigger_type in ('manual', 'automatic', 'regeneration')
  ),
  provider text not null,
  model text not null,
  status text not null check (
    status in ('pending_integration', 'created', 'queued', 'running', 'completed', 'failed', 'cancelled')
  ) default 'created',
  execution_id text null,
  correlation_id text null,
  started_at timestamptz null,
  completed_at timestamptz null,
  error_code text null,
  error_message text null,
  created_at timestamptz not null default now()
);

alter table public.fci_generation_jobs
  drop constraint if exists fci_generation_jobs_status_check;

alter table public.fci_generation_jobs
  add constraint fci_generation_jobs_status_check
  check (
    status in (
      'pending_integration',
      'created',
      'queued',
      'running',
      'completed',
      'failed',
      'cancelled'
    )
  );

create index if not exists fci_generation_jobs_fci_module_status_idx
  on public.fci_generation_jobs (fci_module_id, status, created_at desc);

create unique index if not exists fci_generation_jobs_correlation_id_uidx
  on public.fci_generation_jobs (correlation_id)
  where correlation_id is not null;

create table if not exists public.fci_audit_events (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  fci_module_id bigint null references public.fci_modules(id) on delete set null,
  event_type text not null,
  actor text null,
  payload_json jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists fci_audit_events_appel_offres_created_at_idx
  on public.fci_audit_events (appel_offres_id, created_at desc);

create index if not exists fci_audit_events_fci_module_created_at_idx
  on public.fci_audit_events (fci_module_id, created_at desc);

commit;
