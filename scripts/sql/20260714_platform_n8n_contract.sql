-- Additive migration for the canonical platform <-> n8n contract.
-- Safe to run multiple times.

alter table public.appels_offres
add column if not exists business_status text null;

alter table public.appels_offres
drop constraint if exists appels_offres_business_status_check;

alter table public.appels_offres
add constraint appels_offres_business_status_check
check (
  business_status is null
  or business_status in (
    'brouillon',
    'cdc_importe',
    'en_attente_analyse',
    'analyse_en_cours',
    'fiche_a_valider',
    'fiche_validee',
    'erreur',
    'archive'
  )
);

alter table public.processing_jobs
add column if not exists public_id text null,
add column if not exists contract_version text null,
add column if not exists correlation_id text null,
add column if not exists execution_id text null,
add column if not exists launch_accepted_at timestamptz null,
add column if not exists callback_received_at timestamptz null,
add column if not exists callback_status text null,
add column if not exists callback_idempotency_key text null,
add column if not exists retry_of_job_id bigint null,
add column if not exists error_stage text null,
add column if not exists error_code text null;

update public.processing_jobs
set status = case status
  when 'processing' then 'running'
  when 'completed' then 'completed'
  when 'failed' then 'failed'
  else status
end
where status in ('processing', 'completed', 'failed');

update public.processing_jobs
set public_id = concat('legacy_pj_', id)
where public_id is null;

alter table public.processing_jobs
drop constraint if exists processing_jobs_status_check;

alter table public.processing_jobs
add constraint processing_jobs_status_check
check (status in ('created', 'queued', 'running', 'completed', 'failed', 'cancelled', 'retrying'));

alter table public.processing_jobs
drop constraint if exists processing_jobs_callback_status_check;

alter table public.processing_jobs
add constraint processing_jobs_callback_status_check
check (
  callback_status is null
  or callback_status in ('completed', 'failed', 'cancelled')
);

alter table public.processing_jobs
drop constraint if exists processing_jobs_error_stage_check;

alter table public.processing_jobs
add constraint processing_jobs_error_stage_check
check (
  error_stage is null
  or error_stage in (
    'webhook',
    'upload',
    'marker',
    'markdown',
    'anonymization',
    'llm',
    'xml',
    'callback',
    'unknown'
  )
);

create unique index if not exists processing_jobs_public_id_uidx
on public.processing_jobs (public_id);

create unique index if not exists processing_jobs_correlation_id_uidx
on public.processing_jobs (correlation_id)
where correlation_id is not null;
