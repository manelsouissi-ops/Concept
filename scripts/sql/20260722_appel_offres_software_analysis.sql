begin;

create table if not exists public.software_analysis_reviews (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  scope text not null check (scope in ('logiciels')) default 'logiciels',
  status text not null check (status in ('draft', 'submitted', 'validated')) default 'draft',
  submitted_at timestamptz null,
  validated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appel_offres_id, scope)
);

create index if not exists software_analysis_reviews_appel_scope_idx
  on public.software_analysis_reviews (appel_offres_id, scope);

create table if not exists public.tender_software_requirements (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  requirement_text text not null,
  explicitness text not null check (explicitness in ('explicit', 'implicit')),
  software_names_raw text null,
  necessity_level text not null,
  justification text null,
  risk_if_missing text null,
  alternative_possible text null,
  source_excerpt text null,
  status text not null check (status in ('draft', 'reviewed', 'validated', 'rejected')) default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tender_software_requirements_appel_idx
  on public.tender_software_requirements (appel_offres_id, created_at desc);

create table if not exists public.tender_software_matches (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  requirement_id bigint null references public.tender_software_requirements(id) on delete set null,
  logiciel_id bigint null references public.logiciels(id) on delete set null,
  software_name_raw text not null,
  match_type text not null check (match_type in ('exact', 'alias', 'manual', 'possible', 'none')),
  coverage_status text not null check (coverage_status in ('covered', 'partially_covered', 'not_covered', 'to_confirm')),
  necessity_level text not null,
  utility_text text null,
  recommended_decision text null,
  comment text null,
  validated_by_user boolean not null default false,
  status text not null check (status in ('draft', 'reviewed', 'validated', 'rejected')) default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tender_software_matches_appel_idx
  on public.tender_software_matches (appel_offres_id, created_at desc);

create index if not exists tender_software_matches_requirement_idx
  on public.tender_software_matches (requirement_id);

create table if not exists public.tender_software_gaps (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  requirement_id bigint null references public.tender_software_requirements(id) on delete set null,
  missing_need text not null,
  software_type_needed text null,
  why_needed text null,
  urgency_level text not null,
  example_software_or_category text null,
  recommended_action text null,
  status text not null check (status in ('draft', 'reviewed', 'validated', 'rejected')) default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tender_software_gaps_appel_idx
  on public.tender_software_gaps (appel_offres_id, created_at desc);

create table if not exists public.analysis_confirmations (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  scope text not null check (scope in ('logiciels')) default 'logiciels',
  topic text not null,
  question_text text not null,
  status text not null check (status in ('open', 'resolved', 'not_applicable')) default 'open',
  resolution_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists analysis_confirmations_appel_scope_idx
  on public.analysis_confirmations (appel_offres_id, scope, created_at desc);

create table if not exists public.analysis_sources (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  scope text not null check (scope in ('logiciels')) default 'logiciels',
  source_label text not null,
  file_name text null,
  sheet_name text null,
  source_excerpt text null,
  comment text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists analysis_sources_appel_scope_idx
  on public.analysis_sources (appel_offres_id, scope, created_at desc);

commit;
