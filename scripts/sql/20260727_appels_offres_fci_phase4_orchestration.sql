begin;

alter table public.fci_generation_jobs
  add column if not exists contract_version text null;

alter table public.fci_generation_jobs
  add column if not exists schema_version text null;

alter table public.fci_generation_jobs
  add column if not exists prompt_version text null;

alter table public.fci_generation_jobs
  add column if not exists generation_parameters jsonb null;

alter table public.fci_generation_jobs
  add column if not exists source_fiche_version text null;

alter table public.fci_generation_jobs
  add column if not exists source_fiche_hash text null;

alter table public.fci_generation_jobs
  add column if not exists callback_received_at timestamptz null;

commit;
