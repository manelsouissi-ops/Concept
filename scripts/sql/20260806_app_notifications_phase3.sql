begin;

create table if not exists public.app_notifications (
  id bigserial primary key,
  recipient_user_id bigint not null references public.app_users(id) on delete cascade,
  recipient_role text null,
  appel_offre_code text not null,
  module_code text null,
  event_type text not null,
  title text not null,
  message text not null,
  action_url text not null,
  is_read boolean not null default false,
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  actor_user_id bigint null references public.app_users(id) on delete set null,
  metadata jsonb null,
  dedupe_key text null
);

create index if not exists app_notifications_recipient_idx
  on public.app_notifications (recipient_user_id, created_at desc);

create index if not exists app_notifications_unread_idx
  on public.app_notifications (recipient_user_id, is_read, created_at desc);

create unique index if not exists app_notifications_dedupe_key_uidx
  on public.app_notifications (dedupe_key)
  where dedupe_key is not null;

commit;
