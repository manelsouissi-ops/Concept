begin;

-- At most one active (non-terminal) generation job per FCI module. Prevents
-- a rapid double-click on "Réessayer la génération" (or any other retry
-- trigger) from launching two concurrent generation attempts for the same
-- module. The application already guards this at the service layer; this
-- index closes the remaining check-then-insert race atomically.
create unique index if not exists fci_generation_jobs_module_active_uidx
  on public.fci_generation_jobs (fci_module_id)
  where status in ('created', 'queued', 'running');

commit;
