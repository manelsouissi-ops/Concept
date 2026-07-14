# Business Data Verification Plan

## Environment summary

- Active environment file: `C:\Users\lotfi\Documents\Concept\.env.local`
- PostgreSQL target identified without exposing secrets:
  - scheme: `postgresql`
  - host: `localhost`
  - port: `5432`
  - database: `GONOGO`
- Current storage root: `data/{code}/`

## Safety checks completed before running changes

- Reviewed `scripts/sql/20260714_appels_offres_business_data.sql`
  - additive only
  - no `drop table`
  - no `drop column`
  - no row deletes
  - idempotent `create table if not exists`, `add column if not exists`, `create index if not exists`
- Reviewed `scripts/reconcile-appels-offres-to-postgres.ts`
  - scans `data/{code}/`
  - creates missing business rows only
  - syncs documents metadata from disk
  - does not delete folders, files, or database rows

## Backup recommendation

Before applying or reapplying any SQL in a shared environment, take a PostgreSQL backup of at least:

- `public.appels_offres`
- `public.documents`
- `public.processing_jobs`
- `public.audit_logs`
- `cdc_fiches.fiches_projet`

For this local verification pass, the migration already appears present, so the current plan is to avoid unnecessary reapplication.

## Initial live findings

- PostgreSQL is reachable.
- Required tables exist:
  - `public.appels_offres`
  - `public.documents`
  - `public.processing_jobs`
  - `public.audit_logs`
  - `cdc_fiches.fiches_projet`
- Required migration columns exist:
  - `appels_offres.priorite`
  - `appels_offres.responsable_commercial`
  - `appels_offres.archived_at`
  - `appels_offres.updated_at`
  - `audit_logs.details`
  - `audit_logs.actor`
- Required indexes and constraints exist.
- Migration appears already applied.
- Disk project folders found: `21`
- Database `public.appels_offres` records found before reconciliation: `0`
- Initial mismatch detected:
  - all `21` disk folders currently lack matching `public.appels_offres` rows

## Execution order

1. Confirm migration does not need to be applied again.
2. Run the reconciliation script non-destructively.
3. Reinspect disk/database alignment after reconciliation.
4. Run end-to-end business-data verification through the real app and database.
5. Fix only blocking or clearly incorrect issues discovered during verification.
6. Run `typecheck`, `build:prod`, and any available tests.
7. Produce `BUSINESS_DATA_VERIFICATION_REPORT.md`.

## Verification focus

- record creation and edit persistence
- archive / unarchive correctness
- audit trail completeness
- dashboard count accuracy
- compatibility with old disk bundles and fiche statuses
- no data loss on disk or in PostgreSQL
