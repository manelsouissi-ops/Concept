begin;

create table if not exists public.appels_offres (
  id bigserial primary key,
  code text not null unique,
  title text not null,
  reference text null,
  buyer text null,
  country text null,
  due_date date null,
  notes text null,
  priorite text null,
  responsable_commercial text null,
  status text not null check (status in ('draft', 'processing', 'ready', 'error', 'archived')),
  source text not null check (source in ('manual', 'fiche-flow')) default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz null,
  deleted_at timestamptz null
);

alter table public.appels_offres
  add column if not exists priorite text null,
  add column if not exists responsable_commercial text null,
  add column if not exists archived_at timestamptz null,
  add column if not exists deleted_at timestamptz null;

update public.appels_offres
set
  priorite = coalesce(priorite, 'normale'),
  archived_at = coalesce(archived_at, deleted_at)
where priorite is null or (archived_at is null and deleted_at is not null);

alter table public.appels_offres
  drop constraint if exists appels_offres_priorite_check;

alter table public.appels_offres
  add constraint appels_offres_priorite_check
  check (priorite in ('basse', 'normale', 'haute', 'critique'));

create index if not exists appels_offres_updated_at_idx
  on public.appels_offres (updated_at desc);

create index if not exists appels_offres_archived_at_idx
  on public.appels_offres (archived_at desc nulls last);

create index if not exists appels_offres_deleted_at_idx
  on public.appels_offres (deleted_at);

create index if not exists appels_offres_priorite_idx
  on public.appels_offres (priorite);

create index if not exists appels_offres_responsable_idx
  on public.appels_offres (responsable_commercial);

create table if not exists public.documents (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  kind text not null check (kind in ('source_pdf', 'fiche_xml', 'fiche_markdown', 'status_json')),
  file_name text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appel_offres_id, kind)
);

create index if not exists documents_appel_offres_id_idx
  on public.documents (appel_offres_id);

create table if not exists public.processing_jobs (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  job_type text not null check (job_type in ('appel_offres_upload', 'appel_offres_update', 'fiche_generation')),
  status text not null check (status in ('processing', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  error_message text null,
  metadata jsonb null
);

create index if not exists processing_jobs_appel_offres_id_started_at_idx
  on public.processing_jobs (appel_offres_id, started_at desc);

create table if not exists public.audit_logs (
  id bigserial primary key,
  appel_offres_id bigint null references public.appels_offres(id) on delete set null,
  action text not null,
  payload jsonb null,
  details jsonb null,
  actor text null,
  created_at timestamptz not null default now()
);

alter table public.audit_logs
  add column if not exists payload jsonb null,
  add column if not exists details jsonb null,
  add column if not exists actor text null;

update public.audit_logs
set details = payload
where details is null and payload is not null;

create index if not exists audit_logs_appel_offres_id_created_at_idx
  on public.audit_logs (appel_offres_id, created_at desc);

commit;
