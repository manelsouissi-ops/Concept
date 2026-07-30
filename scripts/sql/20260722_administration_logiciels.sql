begin;

create table if not exists public.logiciels (
  id bigserial primary key,
  name text not null,
  normalized_name text not null,
  description_raw text null,
  status text not null check (status in ('active', 'archived')) default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists logiciels_normalized_name_uidx
  on public.logiciels (normalized_name);

create index if not exists logiciels_status_idx
  on public.logiciels (status);

create index if not exists logiciels_updated_at_idx
  on public.logiciels (updated_at desc);

create table if not exists public.logiciel_aliases (
  id bigserial primary key,
  logiciel_id bigint not null references public.logiciels(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  source text not null check (source in ('manual', 'catalogue_import')),
  created_at timestamptz not null default now(),
  unique (logiciel_id, normalized_alias)
);

create index if not exists logiciel_aliases_logiciel_id_idx
  on public.logiciel_aliases (logiciel_id);

create index if not exists logiciel_aliases_normalized_alias_idx
  on public.logiciel_aliases (normalized_alias);

commit;
