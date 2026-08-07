begin;

alter table public.appels_offres
  add column if not exists commercial_owner_user_id bigint null references public.app_users(id) on delete set null,
  add column if not exists commercial_owner_assigned_at timestamptz null,
  add column if not exists commercial_owner_assigned_by_user_id bigint null references public.app_users(id) on delete set null,
  add column if not exists commercial_owner_previous_user_id bigint null references public.app_users(id) on delete set null,
  add column if not exists commercial_owner_reason text null,
  add column if not exists commercial_owner_updated_at timestamptz null;

create index if not exists appels_offres_commercial_owner_user_idx
  on public.appels_offres (commercial_owner_user_id, updated_at desc);

create table if not exists public.appel_offre_commercial_ownership_events (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  previous_owner_user_id bigint null references public.app_users(id) on delete set null,
  new_owner_user_id bigint not null references public.app_users(id) on delete restrict,
  changed_by_user_id bigint null references public.app_users(id) on delete set null,
  reason text null,
  metadata_jsonb jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists appel_offre_commercial_ownership_events_appel_idx
  on public.appel_offre_commercial_ownership_events (appel_offres_id, created_at desc);

create index if not exists appel_offre_commercial_ownership_events_new_owner_idx
  on public.appel_offre_commercial_ownership_events (new_owner_user_id, created_at desc);

commit;

-- Active dossiers that still require explicit commercial ownership assignment:
-- select
--   code,
--   title,
--   responsable_commercial,
--   status,
--   business_status,
--   updated_at
-- from public.appels_offres
-- where archived_at is null
--   and deleted_at is null
--   and commercial_owner_user_id is null
-- order by updated_at desc, code asc;
