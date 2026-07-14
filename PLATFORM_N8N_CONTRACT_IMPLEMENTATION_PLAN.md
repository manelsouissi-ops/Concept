# Platform N8N Contract Implementation Plan

## Current platform behavior

- Launch path:
  - `POST /api/generate` in [app/api/generate/route.ts](/C:/Users/lotfi/Documents/Concept/app/api/generate/route.ts)
  - accepts multipart `code_interne`, optional `file`, optional `force_regenerate`
  - writes `data/{code}/cdc.pdf` and `status.json` before contacting n8n
  - sends multipart webhook to n8n
  - accepts any `2xx`
  - treats missing execution id as valid
  - returns HTTP `202` even when launch failed
- No current canonical route:
  - `/api/appels-offres/[code]/analyse` does not exist yet
- Current callback path:
  - `POST /api/fiche/[code]/complete` in [app/api/fiche/[code]/complete/route.ts](/C:/Users/lotfi/Documents/Concept/app/api/fiche/[code]/complete/route.ts)
  - authenticated only by `X-Complete-Secret`
  - identifies the attempt by `code` and optional `status.json.n8nExecutionId`
  - no `processing_job_id`
  - no `correlation_id`
  - no HMAC or replay protection
- Current source of truth split:
  - PostgreSQL owns Appels d'offres, documents, processing jobs, audit logs
  - disk `status.json` still drives fiche processing state
  - dashboard/workspace summaries derive business state from mixed PostgreSQL + disk artifacts
- Current processing job schema:
  - status values only: `processing`, `completed`, `failed`
  - no contract identifiers
  - no callback receipt state
  - no retry lineage

## Contract gaps

1. Launch request does not match the canonical contract:
   - uses multipart instead of JSON
   - does not send `processing_job_id`
   - does not send `appel_offre_id`
   - does not send `correlation_id`
   - does not send `callback_url`
   - does not send `pdf_path`
2. Launch acceptance is too loose:
   - does not require HTTP `202`
   - does not require `accepted = true`
   - does not require `execution_id`
3. Callback route does not match the canonical contract:
   - path is code-based instead of generic
   - no bearer token auth
   - no HMAC validation
   - no timestamp freshness check
   - no contract version validation
4. PostgreSQL does not yet own the contract state:
   - no persistent `processing_job_id`
   - no `correlation_id`
   - no `execution_id`
   - no callback status / receipt time
   - no retry lineage
   - no canonical error stage / code
5. The current launch flow deletes draft artifacts too early:
   - `createProcessingBundle()` removes `fiche.xml` and `cdc.md` before launch acceptance
6. Business status is not explicitly stored in PostgreSQL using canonical values:
   - current `appels_offres.status` is coarse (`draft|processing|ready|error|archived`)
   - workspace and dashboard derive business status heuristically
7. Idempotency is incomplete:
   - duplicate callbacks are not tracked by canonical tuple
   - late callbacks from retries are not explicitly classified as stale

## Exact files to modify

Platform contract and env/config:
- `lib/integrations/n8n-contract.ts` (new)
- `lib/integrations/n8n-config.ts` (new)
- `lib/integrations/n8n-callback-auth.ts` (new)
- `docs/env-variables.md`
- `.env.example` (new)

Platform orchestration services:
- `lib/appels-offres/analysis.ts` (new)
- `lib/appels-offres/repository.ts`
- `lib/appels-offres/types.ts`
- `lib/appels-offres/status.ts`
- `lib/appels-offres/presentation.ts`
- `lib/storage.ts`
- `lib/appels-offres/storage.ts`
- `lib/types.ts`

Routes:
- `app/api/appels-offres/[code]/analyse/route.ts` (new)
- `app/api/fiche/callbacks/n8n/route.ts` (new)
- `app/api/generate/route.ts`
- `app/api/fiche/[code]/complete/route.ts`
- `app/api/fiche/[code]/status/route.ts`
- `app/api/fiche/[code]/validate/route.ts`
- `app/api/appels-offres/route.ts`
- `app/api/appels-offres/[code]/route.ts`

Verification and migration artifacts:
- `scripts/sql/20260714_platform_n8n_contract.sql` (new)
- `scripts/verify-platform-n8n-contract.ts` (new)
- `package.json`
- `PLATFORM_N8N_CONTRACT_IMPLEMENTATION_SUMMARY.md` (new)

## Additive database changes

### `public.processing_jobs`

Additive columns required:
- `public_id text`
- `contract_version text`
- `correlation_id text`
- `execution_id text`
- `launch_accepted_at timestamptz`
- `callback_received_at timestamptz`
- `callback_status text`
- `callback_idempotency_key text`
- `retry_of_job_id bigint`
- `error_stage text`
- `error_code text`

Constraint updates:
- expand `status` to canonical lifecycle values:
  - `created`
  - `queued`
  - `running`
  - `completed`
  - `failed`
  - `cancelled`
  - `retrying`

Compatibility/backfill:
- backfill existing rows:
  - `processing -> running`
  - `completed -> completed`
  - `failed -> failed`
- backfill `public_id` for legacy rows as deterministic legacy ids

### `public.appels_offres`

Additive column required:
- `business_status text`

Purpose:
- store canonical business status without breaking the coarse legacy `status` column

Compatibility:
- keep existing `status` column as a compatibility mirror
- update both together going forward

## Status transitions

### Business status transitions

- `BROUILLON -> CDC_IMPORTE`
  - when source PDF is stored
- `CDC_IMPORTE -> EN_ATTENTE_ANALYSE`
  - when analysis is requested and Processing Job is created
- `EN_ATTENTE_ANALYSE -> ANALYSE_EN_COURS`
  - when n8n returns valid `202 Accepted`
- `ANALYSE_EN_COURS -> FICHE_CDC_A_VALIDER`
  - on valid success callback
- `ANALYSE_EN_COURS -> ERREUR`
  - on valid failure callback or deterministic launch failure
- `FICHE_CDC_A_VALIDER -> FICHE_CDC_VALIDEE`
  - when commercial validates the fiche
- `ERREUR -> EN_ATTENTE_ANALYSE`
  - on retry request
- `* -> ARCHIVE`
  - on archive action

### Processing job status transitions

- `CREATED`
  - row inserted before n8n contact
- `QUEUED`
  - request payload validated and dispatch is starting
- `RUNNING`
  - canonical acceptance received with `execution_id`
- `COMPLETED`
  - success callback applied
- `FAILED`
  - failure callback applied or launch failed deterministically
- `CANCELLED`
  - reserved for future explicit cancellation
- `RETRYING`
  - used only as compatibility / audit transition when a new retry attempt is initiated

## Idempotency rules

Launch:
- each attempt gets a new:
  - `processing_job_id`
  - `correlation_id`
- duplicate client retries while an active fiche-generation job exists:
  - reject with `409`

Callback:
- canonical duplicate key:
  - `processing_job_id + correlation_id + execution_id + terminal status`
- store one `callback_idempotency_key` on the job
- if the same callback arrives again:
  - return `200`
  - `acknowledged = true`
  - `applied = false`

Late callback from old retry:
- if callback references an older job than the latest accepted/terminal job for the same Appel d'offre:
  - authenticate it
  - classify it as stale
  - ignore without changing business state
  - emit `late_callback_ignored`

Execution mismatch:
- if `execution_id` differs from the persisted execution id for that job:
  - reject

Correlation mismatch:
- if `correlation_id` differs from the persisted correlation id for that job:
  - reject

Validated fiche protection:
- do not overwrite a validated fiche unless the job metadata explicitly records an allowed regeneration request

## Compatibility strategy

- Keep `data/{code}/` directories unchanged.
- Keep `status.json` writes for backward compatibility.
- PostgreSQL becomes authoritative; `status.json` becomes a mirrored compatibility artifact only.
- Keep `/api/generate` as a compatibility route:
  - it will ensure/create the Appel d'offre record if needed
  - then delegate to the same launch service used by `/api/appels-offres/[code]/analyse`
- Keep `/api/fiche/[code]/complete` as a deprecated compatibility callback path for the current live n8n workflow:
  - internally adapt the old payload into canonical job logic where possible
- Add the canonical callback route required by the contract:
  - `/api/fiche/callbacks/n8n`

## Implementation order

1. Add the typed runtime contract module and env/config helpers.
2. Extend PostgreSQL schema support in repository bootstrap and add SQL migration file.
3. Extend repository types and queries for canonical processing job fields and `business_status`.
4. Add storage helpers for:
   - safe PDF path normalization
   - legacy processing-state mirroring without deleting existing fiche artifacts
5. Implement the shared launch service.
6. Add `POST /api/appels-offres/[code]/analyse`.
7. Convert `/api/generate` into a compatibility wrapper over the same launch service.
8. Implement the canonical callback service and route.
9. Convert `/api/fiche/[code]/complete` into a compatibility adapter.
10. Update fiche status route to prefer PostgreSQL job state over `status.json`.
11. Update validation route to set canonical business status.
12. Update presentation/status helpers so dashboard/workspace reflect PostgreSQL job/business state.
13. Add verification script and update docs/env examples.
14. Run typecheck, build, and verification script.

## Validation plan

Contract validation:
- validate canonical launch payload generation
- validate acceptance response parser
- validate callback payload parser
- validate callback HMAC verification

Launch behavior:
- Processing Job row is created before contacting n8n
- `execution_id` is mandatory
- non-`202` launch fails deterministically
- launch failure marks job `failed`

Success callback:
- correct identifiers accepted
- Markdown/XML persisted
- fiche index synchronized
- Processing Job marked `completed`
- Appel d'offre business status becomes `fiche_a_valider`

Failure callback:
- canonical error stage/code persisted
- job marked `failed`
- Appel d'offre business status becomes `erreur`
- existing artifacts preserved

Idempotency:
- duplicate callback returns `applied = false`
- stale callback is ignored
- execution mismatch rejected
- validated fiche overwrite blocked unless explicit regenerate authorization exists

Build validation:
- `npm.cmd run typecheck`
- `npm.cmd run build:prod`
- `node --experimental-strip-types scripts/verify-platform-n8n-contract.ts`

## Rollback strategy

Code rollback:
- revert the platform-side changes only
- keep the old compatibility routes available until the n8n side is migrated

Database rollback:
- additive changes only
- no destructive rollback required for safe revert
- old code will ignore the new nullable columns

Operational rollback:
- if the canonical callback route is not yet used by n8n, the old `/api/fiche/[code]/complete` compatibility route can continue serving the current workflow during transition
