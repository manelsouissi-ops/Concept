# Backend Business Data Plan

## Current data model

### Application-owned appel d'offres metadata

- Table: `public.appels_offres`
- Current columns:
  - `id`
  - `code`
  - `title`
  - `reference`
  - `buyer`
  - `country`
  - `due_date`
  - `notes`
  - `status`
  - `source`
  - `created_at`
  - `updated_at`
  - `deleted_at`
- Current persisted status values:
  - `draft`
  - `processing`
  - `ready`
  - `error`
  - `archived`

### Related metadata tables

- `public.documents`
  - one row per artifact kind
  - currently supports `source_pdf`, `fiche_xml`, `fiche_markdown`, `status_json`
- `public.processing_jobs`
  - tracks upload / update / fiche generation jobs
- `public.audit_logs`
  - current shape is minimal:
    - `id`
    - `appel_offres_id`
    - `action`
    - `payload`
    - `created_at`

### Fiche CDC indexed data

- Separate table managed by `lib/db.ts`: `cdc_fiches.fiches_projet`
- Keeps Fiche CDC search / index metadata
- Must remain compatible and untouched in behavior except for optional audit hooks

### Disk storage

- Source of truth for artifacts remains `data/{code}/`
- Existing files already used by the app:
  - `cdc.pdf`
  - `cdc.md`
  - `fiche.xml`
  - `status.json`
- Existing metadata sync already reconciles `documents` rows from disk

### Users / commercial managers

- No `users` table found
- No existing FK target for `responsable_commercial`
- Temporary nullable `text` storage is the safest step for now

## Missing fields and functional gaps

- `priorite` is not stored in PostgreSQL
- `responsable_commercial` is not stored in PostgreSQL
- archiving uses `deleted_at` only, not the requested `archived_at`
- list API does not support filtering / sorting query parameters
- no dedicated archive / unarchive routes
- no dedicated history route
- no dashboard API
- audit logs do not yet store:
  - `details`
  - `actor`
- frontend placeholders still rely on derived values rather than stored business metadata
- current list / dashboard pages query repository functions directly instead of a dedicated dashboard API contract

## Routes to modify or add

### Existing routes to modify

- `GET /api/appels-offres`
  - add query params:
    - `search`
    - `status`
    - `priorite`
    - `pays`
    - `client`
    - `archived`
    - `sort`
- `POST /api/appels-offres`
  - accept and persist business fields
- `GET /api/appels-offres/[code]`
  - return full business record including archive and history summary fields
- `PUT /api/appels-offres/[code]`
  - persist business edits
- `app/dashboard/page.tsx`
  - connect to real dashboard API
- `app/appels-offres/page.tsx`
  - connect list filters to API
- `components/appel-offres-form.tsx`
  - submit `priorite` and `responsable_commercial`
- `components/appel-offres-workspace.tsx`
  - connect archive / unarchive, show stored values
- `components/appels-offres-list-view.tsx`
  - functional priority filter, archived toggle, row archive / unarchive actions

### New routes to add

- `GET /api/dashboard`
- `POST /api/appels-offres/[code]/archive`
- `POST /api/appels-offres/[code]/unarchive`
- `GET /api/appels-offres/[code]/history`

## Migration approach

### PostgreSQL schema

Adapt `public.appels_offres` with additive changes only:

- add `priorite text`
- add `responsable_commercial text`
- add `archived_at timestamptz`
- keep `updated_at`
- preserve existing rows and current status values

Adapt `public.audit_logs` in place:

- rename logical usage from `payload` to `details` at code level
- add `actor text null`
- keep compatibility with existing data

### Safe compatibility rules

- do not drop `deleted_at` immediately
- use `archived_at` as the new business archive field
- keep `deleted_at` mirrored for backward compatibility during this step
- keep current `status` column values; add a typed compatibility mapper to business labels instead of renaming persisted values

### Migration artifact

- create a SQL migration file under a new local migrations folder
- do not execute it automatically
- document exact apply command in the summary

### Backfill / reconciliation

- create a safe script that:
  - scans `data/{code}/`
  - ensures each folder has an appel d'offres record
  - sets missing `priorite` to `normale`
  - leaves `responsable_commercial` null when unknown
  - syncs document metadata from disk
  - preserves current statuses
  - reports mismatches without deleting anything

## Compatibility risks

- Current frontend still posts legacy field names (`code`, `title`, `buyer`, `reference`, `notes`), while the business brief names different fields.
  - mitigation: accept both legacy and business aliases in validation / API parsing.
- Current archive behavior depends on `DELETE /api/appels-offres/[code]`.
  - mitigation: preserve existing endpoint behavior or re-route it internally while adding new archive / unarchive endpoints.
- Current dashboard page computes KPIs by loading all detail records server-side.
  - mitigation: centralize KPI computation in `GET /api/dashboard`, then reuse the same logic in frontend.
- Existing audit rows use `payload`, while new spec asks for `details`.
  - mitigation: code should read whichever exists until migration is applied, then write the new shape consistently.
- Existing records may exist only on disk or only in PostgreSQL.
  - mitigation: reconciliation script should upsert carefully and never delete.

## Implementation order

1. Extend shared TypeScript domain types for:
   - priority
   - responsable commercial
   - archived timestamps
   - audit details / actor
2. Add a shared status compatibility module for business status mapping.
3. Add SQL migration script for `appels_offres` and `audit_logs`.
4. Update repository layer:
   - schema bootstrap compatibility
   - filtered listing
   - archive / unarchive
   - richer audit writes
   - history queries
5. Update form parsing to accept both current and business field names.
6. Update existing appel d'offres APIs.
7. Add new archive / unarchive / history / dashboard APIs.
8. Add audit events to fiche save / fiche validate / analysis launch / status transitions.
9. Add reconciliation / backfill script for disk folders and missing metadata.
10. Connect frontend list, dashboard, form, and workspace to the updated APIs.
11. Run validation:
   - `typecheck`
   - `build:prod`
   - available tests
   - `lint` only if present
