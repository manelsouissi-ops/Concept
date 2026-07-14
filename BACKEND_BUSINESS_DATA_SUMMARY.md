# Backend Business Data Summary

## What is now operational

- PostgreSQL now stores real business metadata for appels d'offres:
  - `priorite`
  - `responsable_commercial`
  - `archived_at`
  - `updated_at`
- Archive / unarchive is now supported without deleting disk artifacts.
- Dashboard KPIs now use real database-backed business data.
- The appels d'offres list now works with real:
  - search
  - status filtering
  - priority filtering
  - archived visibility
  - sorting
- The workspace header and overview now display stored:
  - priority
  - responsible commercial
  - archive state
  - last updated timestamp
- Real audit/history events are recorded for key lifecycle actions.
- Existing `data/{code}/` storage remains the source of truth for artifacts and is still synchronized into PostgreSQL metadata.

## Database changes

- Extended `public.appels_offres` with:
  - `priorite`
  - `responsable_commercial`
  - `archived_at`
- Preserved `deleted_at` for backward compatibility and mirror logic.
- Extended `public.audit_logs` with:
  - `details jsonb`
  - `actor text null`
- Added non-destructive indexes for:
  - `updated_at`
  - `archived_at`
  - `deleted_at`
  - `priorite`
  - `responsable_commercial`
  - audit history lookup

## Migration files

- SQL migration:
  - `scripts/sql/20260714_appels_offres_business_data.sql`
- Reconciliation / backfill script:
  - `scripts/reconcile-appels-offres-to-postgres.ts`

## APIs created or modified

- Modified:
  - `GET /api/appels-offres`
  - `POST /api/appels-offres`
  - `GET /api/appels-offres/[code]`
  - `PUT /api/appels-offres/[code]`
  - `DELETE /api/appels-offres/[code]` kept as backward-compatible archive alias
- Added:
  - `POST /api/appels-offres/[code]/archive`
  - `POST /api/appels-offres/[code]/unarchive`
  - `GET /api/appels-offres/[code]/history`
  - `GET /api/dashboard`

## Frontend pages connected

- `/dashboard`
  - real KPI cards
  - real recent activity
  - real recent appels d'offres
  - real required-action counts
- `/appels-offres`
  - real stored priority / responsable data
  - archive / unarchive actions
  - working list filters and sorting
- `/appels-offres/nouveau`
  - persists priority and responsable commercial
- `/appels-offres/[code]`
  - real overview metadata
  - archive state
  - real history data

## Audit events implemented

- `appel_offres.created`
- `appel_offres.updated`
- `appel_offres.cdc_uploaded`
- `appel_offres.analysis_launched`
- `appel_offres.status_changed`
- `fiche_cdc.saved`
- `fiche_cdc.validated`
- `appel_offres.archived`
- `appel_offres.unarchived`

Additional failure / lifecycle events were preserved where already useful for operations.

## Backfill / reconciliation support

- The reconciliation script scans existing `data/{code}/` folders.
- It creates missing PostgreSQL appel d'offres records conservatively.
- It defaults missing business metadata to:
  - `priorite = 'normale'`
  - `responsable_commercial = ''`
- It syncs document metadata from disk into `public.documents`.
- It reports missing or unreadable artifact bundles as warnings.
- It does not delete rows, folders, or files.

## Known limitations

- `responsable_commercial` is still free text because no `users` table exists yet.
- Persisted appel d'offres statuses remain the existing application-safe values:
  - `draft`
  - `processing`
  - `ready`
  - `error`
  - `archived`
  Business-facing French labels are mapped in the presentation layer.
- Reconciliation can create placeholder records titled with the folder code when disk artifacts exist without business metadata.
- No destructive cleanup of orphaned folders or rows is performed in this phase.

## Exact commands

Apply the SQL migration:

```powershell
psql "$env:DATABASE_URL" -f "scripts/sql/20260714_appels_offres_business_data.sql"
```

Ensure application schemas are ready:

```powershell
npm.cmd run db:setup
```

Reconcile existing disk bundles into PostgreSQL metadata:

```powershell
npm.cmd run db:reconcile:appels-offres
```

Run the application:

```powershell
npm.cmd run dev
```

## Validation performed

- `npm.cmd run typecheck`
- `npm.cmd run build:prod`

No automated test script is currently available in `package.json`.
No standalone lint script is currently available in `package.json`.

## What remains before returning to n8n integration

- Run the SQL migration on the target environment.
- Run the reconciliation script against the real `data/{code}` folders.
- Perform an end-to-end business flow check with real PostgreSQL data:
  - create appel d'offres
  - upload CDC
  - archive / unarchive
  - edit metadata
  - verify history and dashboard counts
- After that, the next recommended step is to resume the separate n8n / AI integration milestone with the business metadata layer now stable underneath it.
