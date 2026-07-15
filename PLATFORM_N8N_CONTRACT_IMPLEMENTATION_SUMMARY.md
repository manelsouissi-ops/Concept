# Platform n8n Contract Implementation Summary

## Scope completed

Implemented the platform side of the canonical Next.js <-> n8n contract defined in `CANONICAL_PLATFORM_N8N_CONTRACT.md` without modifying the n8n workflow and without redesigning the frontend.

The platform now exposes:

- canonical launch route: `POST /api/appels-offres/[code]/analyse`
- canonical callback route: `POST /api/fiche/callbacks/n8n`
- compatibility launch route: `POST /api/generate`
- compatibility callback route: `POST /api/fiche/[code]/complete`

## Files created

- `.env.example`
- `PLATFORM_N8N_CONTRACT_IMPLEMENTATION_PLAN.md`
- `PLATFORM_N8N_CONTRACT_IMPLEMENTATION_SUMMARY.md`
- `app/api/appels-offres/[code]/analyse/route.ts`
- `app/api/fiche/callbacks/n8n/route.ts`
- `lib/appels-offres/analysis.ts`
- `lib/integrations/n8n-contract.ts`
- `lib/integrations/n8n-config.ts`
- `lib/integrations/n8n-callback-auth.ts`
- `scripts/sql/20260714_platform_n8n_contract.sql`
- `scripts/verify-platform-n8n-contract.ts`

## Files modified

- `app/api/appels-offres/[code]/route.ts`
- `app/api/appels-offres/route.ts`
- `app/api/fiche/[code]/complete/route.ts`
- `app/api/fiche/[code]/status/route.ts`
- `app/api/fiche/[code]/validate/route.ts`
- `app/api/generate/route.ts`
- `docs/env-variables.md`
- `lib/appels-offres/presentation.ts`
- `lib/appels-offres/repository.ts`
- `lib/appels-offres/types.ts`
- `lib/storage.ts`
- `lib/types.ts`
- `package.json`

## Database changes

Minimal additive changes were introduced to support the canonical contract.

### `public.appels_offres`

- add `business_status`
- enforce canonical business-status values:
  - `brouillon`
  - `cdc_importe`
  - `en_attente_analyse`
  - `analyse_en_cours`
  - `fiche_a_valider`
  - `fiche_validee`
  - `erreur`
  - `archive`

### `public.processing_jobs`

- add `public_id`
- add `contract_version`
- add `correlation_id`
- add `execution_id`
- add `launch_accepted_at`
- add `callback_received_at`
- add `callback_status`
- add `callback_idempotency_key`
- add `retry_of_job_id`
- add `error_stage`
- add `error_code`
- expand status lifecycle to:
  - `created`
  - `queued`
  - `running`
  - `completed`
  - `failed`
  - `cancelled`
  - `retrying`
- add unique indexes:
  - `processing_jobs_public_id_uidx`
  - `processing_jobs_correlation_id_uidx`

## Migration files

- `scripts/sql/20260714_platform_n8n_contract.sql`

### Command to apply

Run:

```powershell
psql "$env:DATABASE_URL" -f scripts/sql/20260714_platform_n8n_contract.sql
```

## Environment variables

Documented and/or added:

- `DATABASE_URL`
- `N8N_WEBHOOK_URL`
- `N8N_WEBHOOK_TOKEN`
- `PLATFORM_CALLBACK_TOKEN`
- `N8N_CALLBACK_SECRET`
- `PLATFORM_PUBLIC_BASE_URL`
- `N8N_CONTRACT_VERSION`
- `N8N_LAUNCH_TIMEOUT_MS`
- `MAX_CDC_UPLOAD_BYTES`
- `N8N_COMPLETE_SECRET` for legacy callback compatibility only

Reminder:

- `GEMINI_API_KEY` remains n8n-side and is not consumed by the Next.js platform.

## Launch contract implementation

Implemented in:

- `lib/appels-offres/analysis.ts`
- `app/api/appels-offres/[code]/analyse/route.ts`
- `app/api/generate/route.ts`

Behavior:

- loads the Appel d'offres from PostgreSQL
- rejects archived dossiers
- requires an existing or newly uploaded CDC PDF
- protects validated or manually modified Fiche CDC data unless regeneration is explicit
- rejects concurrent active analysis jobs
- creates the processing job before contacting n8n
- generates `processing_job_id`, `correlation_id`, and `callback_url`
- sends the canonical JSON launch payload
- requires `HTTP 202`, `accepted=true`, and `execution_id`
- stores `execution_id`, marks the job `running`, mirrors compatibility status to `status.json`, and updates business status to `analyse_en_cours`
- marks launch failure deterministically as `failed` and returns a non-2xx response

## Callback contract implementation

Implemented in:

- `app/api/fiche/callbacks/n8n/route.ts`
- `lib/appels-offres/analysis.ts`
- `app/api/fiche/[code]/complete/route.ts` for legacy compatibility

Behavior:

- validates bearer token and HMAC signature
- validates `X-Contract-Version`
- validates the callback JSON envelope at runtime
- loads the job by `processing_job_id`
- verifies `processing_job_id`, `correlation_id`, `execution_id`, and `appel_offre_id`
- distinguishes duplicate, stale, and not-applicable callbacks
- validates Markdown non-emptiness on success
- validates XML using the existing strict parser before persistence
- protects validated Fiche CDC records from unintended overwrite
- persists Markdown and XML using existing atomic storage helpers
- updates PostgreSQL job state, business status, and audit events
- preserves previous jobs and existing artifacts on failure

## Idempotency behavior

Implemented rules:

- duplicate terminal callbacks are acknowledged with `applied: false`
- stale callbacks from older retries are acknowledged with `applied: false`
- callbacks with mismatched `correlation_id` or `execution_id` are rejected
- callbacks for jobs outside callback-acceptable states are ignored safely
- validated Fiche CDC files are protected unless regeneration is explicitly allowed
- each retry creates a fresh processing job and optionally links `retry_of_job_id`

## Status transitions

Canonical business progression:

- `brouillon`
- `cdc_importe`
- `en_attente_analyse`
- `analyse_en_cours`
- `fiche_a_valider`
- `fiche_validee`
- `erreur`
- `archive`

Processing job progression:

- `created`
- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`
- `retrying`

Compatibility note:

- `status.json` is still written for backward compatibility, but PostgreSQL is now the authoritative job source.

## Audit events

Added or standardized:

- `analysis_requested`
- `n8n_launch_accepted`
- `n8n_launch_failed`
- `callback_received`
- `analysis_completed`
- `analysis_failed`
- `late_callback_ignored`
- `duplicate_callback_ignored`
- `fiche_cdc_generated`

Existing validation and dossier events remain intact.

## Verification results

Executed successfully:

- `npm.cmd run typecheck`
- `npm.cmd run build:prod`
- `npm.cmd run verify:platform-n8n-contract`

Verification coverage:

- canonical launch-request validation
- mandatory `execution_id` on launch acceptance
- canonical success callback validation
- canonical failure callback validation
- callback HMAC and replay protection
- duplicate callback key stability
- provider-neutral stage mapping
- XML parser compatibility with canonical callback content

## Known limitations

- No live PostgreSQL-backed end-to-end launch/callback scenario was executed because the shell session did not expose a `DATABASE_URL`.
- The legacy callback route remains available for backward compatibility and should be removed after n8n switches fully to the canonical callback route.
- The legacy `status.json` compatibility layer remains intentionally in place and is still updated alongside PostgreSQL.

## What n8n must change next

The next task on the n8n side is to adopt the canonical contract fully:

1. Call `POST /api/appels-offres/[code]/analyse` or keep using `/api/generate` temporarily until the frontend is switched.
2. Accept the canonical JSON launch payload with:
   - `processing_job_id`
   - `appel_offre_id`
   - `code_interne`
   - `correlation_id`
   - `callback_url`
   - `pdf_path`
   - `contract_version`
3. Return immediate `202 Accepted` with:
   - `accepted: true`
   - `execution_id`
   - `processing_job_id`
   - `correlation_id`
   - `processing_status`
   - `received_at`
4. Send terminal callbacks to `POST /api/fiche/callbacks/n8n` with:
   - `Authorization: Bearer <PLATFORM_CALLBACK_TOKEN>`
   - `X-Contract-Version`
   - `X-Callback-Timestamp`
   - `X-Callback-Signature`
5. Stop using the legacy `POST /api/fiche/[code]/complete` route once the canonical callback is deployed.
