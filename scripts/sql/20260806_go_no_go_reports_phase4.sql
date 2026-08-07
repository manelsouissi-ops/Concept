create table if not exists public.go_no_go_reports (
  id bigserial primary key,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  version integer not null,
  status text not null check (
    status in (
      'DRAFT',
      'READY_FOR_REVIEW',
      'PREPARED',
      'SUBMITTED_TO_DG',
      'SUPERSEDED',
      'ARCHIVED'
    )
  ),
  generated_from_fci_snapshot_at timestamptz null,
  generated_by_user_id bigint null,
  commercial_owner_user_id bigint null,
  prepared_by_user_id bigint null,
  prepared_at timestamptz null,
  submitted_by_user_id bigint null,
  submitted_at timestamptz null,
  reopened_at timestamptz null,
  supersedes_report_id bigint null references public.go_no_go_reports(id) on delete set null,
  executive_summary text null,
  project_overview text null,
  commercial_summary text null,
  financial_summary text null,
  operational_summary text null,
  key_strengths text null,
  key_risks text null,
  reservations text null,
  assumptions text null,
  unresolved_points text null,
  commercial_recommendation text null,
  ai_recommendation text null,
  recommended_decision text null check (
    recommended_decision is null or recommended_decision in ('go', 'no_go')
  ),
  source_snapshot_jsonb jsonb null,
  editable_payload_jsonb jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists go_no_go_reports_appel_version_uidx
on public.go_no_go_reports (appel_offres_id, version);

create index if not exists go_no_go_reports_appel_status_idx
on public.go_no_go_reports (appel_offres_id, status, version desc);

create table if not exists public.go_no_go_report_audit_events (
  id bigserial primary key,
  go_no_go_report_id bigint not null references public.go_no_go_reports(id) on delete cascade,
  appel_offres_id bigint not null references public.appels_offres(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'REPORT_GENERATED',
      'REPORT_EDITED',
      'REPORT_PREPARED',
      'REPORT_SUBMITTED',
      'REPORT_REOPENED',
      'REPORT_SUPERSEDED',
      'REPORT_EXPORTED'
    )
  ),
  actor_user_id bigint null,
  actor_name text null,
  payload_json jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists go_no_go_report_audit_events_report_idx
on public.go_no_go_report_audit_events (go_no_go_report_id, created_at desc);

create index if not exists go_no_go_report_audit_events_appel_idx
on public.go_no_go_report_audit_events (appel_offres_id, created_at desc);
