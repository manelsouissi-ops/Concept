alter table public.app_users
  add column if not exists password_hash text null,
  add column if not exists password_updated_at timestamptz null,
  add column if not exists failed_login_attempts integer not null default 0,
  add column if not exists locked_until timestamptz null;

create table if not exists public.app_user_sessions (
  id bigserial primary key,
  user_id bigint not null references public.app_users(id) on delete cascade,
  session_token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  invalidated_at timestamptz null,
  ip_address text null,
  user_agent text null
);

create unique index if not exists app_user_sessions_token_hash_uidx
  on public.app_user_sessions (session_token_hash);

create index if not exists app_user_sessions_user_id_idx
  on public.app_user_sessions (user_id, expires_at desc);

create table if not exists public.app_auth_audit_events (
  id bigserial primary key,
  user_id bigint null references public.app_users(id) on delete set null,
  email text null,
  event_type text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_auth_audit_events_user_id_idx
  on public.app_auth_audit_events (user_id, created_at desc);

create index if not exists app_auth_audit_events_email_idx
  on public.app_auth_audit_events (email, created_at desc);
