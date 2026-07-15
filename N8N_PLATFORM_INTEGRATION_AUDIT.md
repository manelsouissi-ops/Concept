# 1. Executive Summary

The integration is not ready to connect as-is.

What already matches:
- `POST /api/generate` sends the same two multipart fields the active workflow validates: `code_interne` and `file`.
- The active workflow is already asynchronous at the trigger level (`Webhook CDC Initiation` uses `responseMode: "onReceived"`), which fits the app's 10 second acceptance handshake in [app/api/generate/route.ts](/C:/Users/lotfi/Documents/Concept/app/api/generate/route.ts).
- The callback route shape still matches the workflow success path for `{ xml, markdown, executionId }`.

Biggest blockers:
- The app and workflow disagree on error-stage vocabulary: the workflow now sends `"stage": "gemini"`, while the app type still only accepts `"marker" | "anonymization" | "groq" | "unknown"` in [lib/types.ts](/C:/Users/lotfi/Documents/Concept/lib/types.ts) and still hardcodes `"groq"` for malformed XML in [app/api/fiche/[code]/complete/route.ts](/C:/Users/lotfi/Documents/Concept/app/api/fiche/[code]/complete/route.ts).
- The workflow callback URL is hardcoded to `http://localhost:3000`, while the platform does not send a callback URL and does not own that part of the contract.
- The n8n webhook entrypoint has no confirmed request authentication in the active workflow, even though the app can optionally send `Authorization: Bearer <N8N_WEBHOOK_TOKEN>`.
- Business state is still split: Appel d'offres metadata, documents, jobs, and audit logs live in PostgreSQL, but fiche processing state and `n8nExecutionId` still live in `data/{code}/status.json`.
- The live n8n execution history is not stable enough yet. Recent executions `193` and `194` are marked `success` in n8n, but their stored execution payloads contain `Gemini Error Callback` and do not contain `Respond XML JSON`, so "workflow success" does not currently mean "application success."

Minimum required changes:
- Formalize the start-webhook and callback contracts.
- Make callback base URL configurable.
- Align error-stage values, including Gemini.
- Persist and require execution correlation consistently.
- Make callback handling idempotent.
- Make PostgreSQL authoritative for business/job state while keeping disk as artifact storage.

Recommendation: modify and stabilize the workflow contract before connecting the Appels d'offres workspace to it.

# 2. Current Platform Contract

## 2.1 Start request sent by the platform

Source:
- [app/api/generate/route.ts](/C:/Users/lotfi/Documents/Concept/app/api/generate/route.ts)
- [lib/storage.ts](/C:/Users/lotfi/Documents/Concept/lib/storage.ts)

Route:
- `POST /api/generate`

Input accepted by the platform route:
- multipart form-data
- fields:
  - `code_interne` required
  - `file` required on first generation, optional on regeneration
  - `force_regenerate` optional flag

What the platform writes before contacting n8n:
- `data/{code}/cdc.pdf`
- `data/{code}/status.json` with `status: "processing"`
- removes any existing `fiche.xml`
- removes any existing `cdc.md`

What the platform sends to n8n in `requestWebhookAcceptance()`:
- endpoint: `process.env.N8N_WEBHOOK_URL`
- method: `POST`
- content type: multipart form-data
- headers:
  - optional `Authorization: Bearer ${process.env.N8N_WEBHOOK_TOKEN}`
- body fields:
  - `code_interne`
  - `file`

What the platform does not send:
- Appel d'offres ID
- processing job ID
- callback URL
- correlation ID separate from `code_interne`
- callback secret

What the platform expects back immediately:
- any `2xx`
- optional execution ID from headers:
  - `x-n8n-execution-id`
  - `n8n-execution-id`
  - `x-execution-id`
  - `execution-id`
- optional execution ID from JSON:
  - `executionId`
  - `execution_id`
  - `id`
  - nested under `data` or `execution`

Handshake timeout:
- 10 seconds via `N8N_HANDSHAKE_TIMEOUT_MS = 10000`

Acceptance-side business sync:
- sets Appel d'offres status to `processing`
- creates `processing_jobs` row with `job_type = "fiche_generation"`
- writes audit logs such as:
  - `appel_offres.analysis_launched`
  - `fiche.generate.started`
  - `fiche.generate.accepted`

## 2.2 Callback expected by the platform

Source:
- [app/api/fiche/[code]/complete/route.ts](/C:/Users/lotfi/Documents/Concept/app/api/fiche/[code]/complete/route.ts)
- [app/api/fiche/[code]/status/route.ts](/C:/Users/lotfi/Documents/Concept/app/api/fiche/[code]/status/route.ts)
- [lib/types.ts](/C:/Users/lotfi/Documents/Concept/lib/types.ts)

Route:
- `POST /api/fiche/[code]/complete`

Authorization expected:
- header `X-Complete-Secret`
- must equal `process.env.N8N_COMPLETE_SECRET`

Success payload expected:

```json
{
  "xml": "string",
  "markdown": "string",
  "executionId": "string"
}
```

Failure payload expected by runtime checks:

```json
{
  "error": "string",
  "stage": "string",
  "executionId": "string"
}
```

Failure payload expected by platform types:
- `stage` should be one of:
  - `marker`
  - `anonymization`
  - `groq`
  - `unknown`

Duplicate/late callback protection:
- current fiche status must still be `processing`
- `executionId` is required in every callback
- if `status.json.n8nExecutionId` is set, it must match exactly

On success:
- validates and normalizes XML
- writes:
  - `data/{code}/fiche.xml`
  - `data/{code}/cdc.md`
  - `data/{code}/status.json` with `status: "draft"`
- sets Appel d'offres status to `ready`
- syncs documents metadata
- finishes latest `fiche_generation` job as `completed`
- appends `fiche.complete.succeeded`

On failure:
- writes `status.json` with `status: "error"`
- sets Appel d'offres status to `error`
- finishes latest `fiche_generation` job as `failed`
- appends `fiche.complete.failed`

On malformed XML:
- marks fiche error with stage `"groq"` in current app code
- appends `fiche.complete.invalid_xml`

## 2.3 Relevant environment variables

Observed repo env file:
- [C:/Users/lotfi/Documents/Concept/.env.local](</C:/Users/lotfi/Documents/Concept/.env.local>)

Observed keys only:
- `DATABASE_URL`
- `N8N_WEBHOOK_URL`
- `N8N_COMPLETE_SECRET`

Documented in [docs/env-variables.md](/C:/Users/lotfi/Documents/Concept/docs/env-variables.md):
- `DATABASE_URL`
- `N8N_WEBHOOK_URL`
- optional `N8N_WEBHOOK_TOKEN`
- `N8N_COMPLETE_SECRET`

Not documented there but required by the current active workflow:
- `GEMINI_API_KEY`

# 3. Current n8n Workflow

## 3.1 Active workflow identity

Confirmed from local n8n SQLite at `C:\Users\lotfi\.n8n\database.sqlite`:
- workflow ID: `f866bd39869c4c11`
- name: `CDC Initiation - Fiche Projet XML`
- active flag: `1`

Draft versus active version:
- `workflow_entity.activeVersionId = 25aeeda4-0587-4ef3-bfb1-6a98c5d3a6f3`
- `workflow_entity.versionId = 36ef9707-9982-48d5-b0c8-7c1abaa64ebb`
- `workflow_entity.updatedAt = 2026-07-14 09:07:29.073`
- latest publish event: version `25aeeda4-0587-4ef3-bfb1-6a98c5d3a6f3` activated on `2026-07-14 09:05:40.799`
- latest workflow history row: version `36ef9707-9982-48d5-b0c8-7c1abaa64ebb`, autosaved by `Manel manel.souissi@polytechnicien.tn` on `2026-07-14 09:07:29.077`

Interpretation:
- there is a published active version and a newer autosaved draft.
- the latest repo backup export corresponds to the published Gemini version, not the later autosaved draft.

Primary backup/export inspected:
- [tmp/n8n-workflow-backups/f866bd39869c4c11_after_gemini_error_literals_20260714_090540.json](/C:/Users/lotfi/Documents/Concept/tmp/n8n-workflow-backups/f866bd39869c4c11_after_gemini_error_literals_20260714_090540.json)

## 3.2 Reconstructed active workflow stages

Confirmed nodes in the published Gemini export:
1. `Webhook CDC Initiation`
2. `Validate Webhook Input`
3. `Prepare Upload Paths`
4. `Save Uploaded PDF`
5. `Convert PDF via FastAPI Marker`
6. `Init Marker Poll Guard`
7. `Wait 30s Before Marker Result`
8. `Increment Marker Poll Guard`
9. `Marker Timeout Reached?`
10. `Get Marker Result`
11. `Merge Marker Result With Guard`
12. `Check Marker Status`
13. `Read Markdown as Text`
14. `HTTP Request → Gemini XML`
15. `Clean XML Response`
16. `Respond XML JSON`
17. `Gemini Error Callback`
18. `Marker Job Failed`
19. `Marker Timeout`

No PostgreSQL operation exists in the active workflow.

## 3.3 Trigger and request handling

`Webhook CDC Initiation`:
- method: `POST`
- path: `cdc-initiation-fiche-projet-xml`
- `responseMode: "onReceived"`

`Validate Webhook Input` enforces:
- `code_interne` present
- binary `file` present

## 3.4 File handling and service calls

Hardcoded Windows/local paths:
- incoming PDF dir: `C:\Users\lotfi\.n8n-files\incoming`
- Marker output dir: `C:\Users\lotfi\.n8n-files\marker_output`

Hardcoded service URLs:
- Marker convert: `http://127.0.0.1:8000/convert`
- Marker result: `http://127.0.0.1:8000/result/{{ $json.job_id }}`
- Gemini endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`

Polling guard:
- wait step: 30 seconds
- max polls: `40`
- max elapsed: `1200000` ms
- effective ceiling: about 20 minutes

Marker status branches handled:
- `completed`
- `processing`
- `failed`

## 3.5 Gemini node and response extraction

`HTTP Request → Gemini XML`:
- method: `POST`
- authentication mode in node: `none`
- custom headers:
  - `Authorization: Bearer {{$env.GEMINI_API_KEY}}`
  - `Content-Type: application/json`
- model: `gemini-2.5-flash`
- error mode: `continueErrorOutput`

`Clean XML Response` currently extracts:
- `response?.choices?.[0]?.message?.content`

This matches the OpenAI-compatible Gemini endpoint shape and is therefore still compatible with the current XML extraction node.

## 3.6 Callback nodes

All callback nodes currently POST to:
- `http://localhost:3000/api/fiche/{code}/complete`

Shared callback headers:
- `X-Complete-Secret: {{$env.N8N_COMPLETE_SECRET}}`
- `Content-Type: application/json`

Payloads:
- `Respond XML JSON`
  - `{ xml, markdown, executionId: $execution.id }`
- `Marker Job Failed`
  - `{ error, stage: "marker", executionId: $execution.id }`
- `Marker Timeout`
  - `{ error: "Marker timeout exceeded", stage: "marker", executionId: $execution.id }`
- `Gemini Error Callback`
  - `{ error: $json.error?.message || "Gemini request failed", stage: "gemini", executionId: $execution.id }`

## 3.7 Disabled, disconnected, obsolete, and historical elements

Disabled nodes still present in the graph:
- `Code JS (anonymisation)`
- `HTTP Request → Ollama (anonymisation)`
- `Code JS (fusion Ollama)`

Obsolete history still present in local artifacts:
- Groq-era workflow backups in `tmp/n8n-workflow-backups/`
- Groq/Gemini patch scripts in `tmp/` and `scripts/`

Historical patch/maintenance scripts inspected:
- [scripts/migrate_n8n_cdc_async.py](/C:/Users/lotfi/Documents/Concept/scripts/migrate_n8n_cdc_async.py)
- [scripts/fix_n8n_cdc_responder_nodes.py](/C:/Users/lotfi/Documents/Concept/scripts/fix_n8n_cdc_responder_nodes.py)
- [scripts/fix_n8n_cdc_timeout_branch.py](/C:/Users/lotfi/Documents/Concept/scripts/fix_n8n_cdc_timeout_branch.py)
- [scripts/raise_n8n_cdc_marker_poll_ceiling.py](/C:/Users/lotfi/Documents/Concept/scripts/raise_n8n_cdc_marker_poll_ceiling.py)
- [tmp/patch_active_n8n_workflow_to_gemini.py](/C:/Users/lotfi/Documents/Concept/tmp/patch_active_n8n_workflow_to_gemini.py)
- [tmp/patch_active_n8n_gemini_error_literals.py](/C:/Users/lotfi/Documents/Concept/tmp/patch_active_n8n_gemini_error_literals.py)

## 3.8 Live execution evidence

Recent execution statuses from local n8n SQLite:
- `194 success`
- `193 success`
- `192 error`
- `191 error`
- `181 crashed`
- `180 crashed`
- `179 crashed`
- `178 canceled`

Confirmed from stored execution payload serialization for executions `193` and `194`:
- `Gemini Error Callback` is present
- `Respond XML JSON` is not present

This means recent n8n runs can be marked `success` even when they ended on the error-callback path. That is a confirmed contract/reliability problem.

# 4. Contract Comparison

| Contract element | Platform sends/expects | n8n sends/expects | Match? | Risk | Required change |
|---|---|---|---|---|---|
| Start endpoint | `process.env.N8N_WEBHOOK_URL` | Webhook path `cdc-initiation-fiche-projet-xml` | Partial | App owns URL indirectly; workflow path is hidden in env | Document and freeze one canonical start URL |
| Start method | `POST` | `POST` | Yes | Low | None |
| Start content type | multipart form-data | webhook input parser expects multipart body with binary file | Yes | Low | None |
| File field name | `file` | `Validate Webhook Input` expects `file` or first binary field | Yes | Low | Keep `file` canonical |
| Code field name | `code_interne` | `Validate Webhook Input` requires `code_interne` | Yes | Low | Keep canonical |
| Webhook auth | optional bearer token via `N8N_WEBHOOK_TOKEN` | no confirmed auth validation in active workflow | No | High | Add workflow-side auth or remove misleading optional token until supported |
| Callback URL | platform sends none | workflow hardcodes `http://localhost:3000/api/fiche/{code}/complete` | No | Critical | Make callback base URL configurable or pass explicit callback URL |
| Callback secret | platform expects `X-Complete-Secret` | workflow sends `{{$env.N8N_COMPLETE_SECRET}}` | Yes | Medium | Keep, but document and rotate through env only |
| Success payload | expects `{ xml, markdown, executionId }` | sends `{ xml, markdown, executionId }` | Yes | Low | None |
| Failure payload schema | expects `{ error, stage, executionId }` | sends same shape | Yes | Low | None |
| Failure stage vocabulary | app types allow `marker|anonymization|groq|unknown` | workflow sends `marker` and `gemini` | No | High | Add `gemini` to platform contract and remove legacy `groq` assumption |
| Malformed XML stage | app writes `"groq"` on invalid XML | workflow is Gemini-based | No | Medium | Change app-side malformed-XML stage to canonical provider-neutral or Gemini value |
| Execution ID acceptance | app accepts missing execution ID at start and stores `null` | workflow callbacks always send `$execution.id` | Partial | Medium | Require acceptance response to include execution ID and persist it |
| Appel d'offres / job correlation | platform does not send AO ID or job ID | workflow only uses `code_interne` and callback path | No | Medium | Add explicit processing job correlation in contract |
| Acceptance semantics | app expects short async acceptance | workflow trigger is `onReceived` | Yes | Low | Keep |
| Success meaning | app assumes callback success equals generated fiche | n8n `success` can still mean error callback path | No | High | Separate workflow run status from business completion status |

# 5. Status Mapping

## 5.1 Current platform business statuses

From [lib/appels-offres/presentation.ts](/C:/Users/lotfi/Documents/Concept/lib/appels-offres/presentation.ts):
- `brouillon`
- `cdc_importe`
- `en_attente_analyse`
- `analyse_en_cours`
- `fiche_a_valider`
- `fiche_validee`
- `erreur`
- `archive`

## 5.2 Current persisted Appel d'offres statuses

From [lib/appels-offres/types.ts](/C:/Users/lotfi/Documents/Concept/lib/appels-offres/types.ts):
- `draft`
- `processing`
- `ready`
- `error`
- `archived`

## 5.3 Current persisted fiche statuses

From [lib/types.ts](/C:/Users/lotfi/Documents/Concept/lib/types.ts) and `status.json`:
- `processing`
- `draft`
- `validated`
- `error`

## 5.4 Current processing job statuses

From [lib/appels-offres/types.ts](/C:/Users/lotfi/Documents/Concept/lib/appels-offres/types.ts):
- `processing`
- `completed`
- `failed`

Processing job types:
- `appel_offres_upload`
- `appel_offres_update`
- `fiche_generation`

## 5.5 Current n8n internal statuses and branches

Marker statuses handled by workflow:
- `completed`
- `processing`
- `failed`

n8n workflow execution statuses observed in SQLite:
- `success`
- `error`
- `crashed`
- `canceled`

## 5.6 Recommended canonical mapping

Recommended business mapping without changing anything yet:

| Canonical business state | Appel d'offres table | Fiche status / artifact state | Processing job state | n8n/Marker state |
|---|---|---|---|---|
| `brouillon` | `draft` | no source PDF or incomplete AO | none | none |
| `cdc_importe` | `ready` | source PDF present, no fiche generation yet | last upload/update `completed` | none |
| `en_attente_analyse` | `ready` | source PDF present, no active fiche run | no active `fiche_generation` | none |
| `analyse_en_cours` | `processing` | fiche `status.json = processing` | `fiche_generation = processing` | Marker `processing` or n8n active |
| `fiche_a_valider` | `ready` | fiche status `draft` or `fiche.xml` present | last `fiche_generation = completed` | success callback path completed |
| `fiche_validee` | `ready` | fiche status `validated` | last `fiche_generation = completed` | completed historically |
| `erreur` | `error` | fiche status `error` or failed latest job | `failed` | Marker failed / Gemini failed / callback error |
| `archive` | `archived` | unchanged artifacts | any historical | any historical |

Important finding:
- today the UI/business mapping still depends on both PostgreSQL and disk artifacts, not on one authoritative persisted state.

# 6. Source-of-Truth Findings

## 6.1 Current ownership by data category

| Data category | Current owner | Evidence |
|---|---|---|
| Appel d'offres metadata | PostgreSQL `public.appels_offres` | [lib/appels-offres/repository.ts](/C:/Users/lotfi/Documents/Concept/lib/appels-offres/repository.ts) |
| Documents metadata | PostgreSQL `public.documents`, synced from disk | [lib/appels-offres/repository.ts](/C:/Users/lotfi/Documents/Concept/lib/appels-offres/repository.ts), [lib/appels-offres/storage.ts](/C:/Users/lotfi/Documents/Concept/lib/appels-offres/storage.ts) |
| Processing jobs | PostgreSQL `public.processing_jobs` | [lib/appels-offres/repository.ts](/C:/Users/lotfi/Documents/Concept/lib/appels-offres/repository.ts) |
| Audit history | PostgreSQL `public.audit_logs` | [lib/appels-offres/repository.ts](/C:/Users/lotfi/Documents/Concept/lib/appels-offres/repository.ts) |
| Fiche processing state | disk `data/{code}/status.json` | [lib/storage.ts](/C:/Users/lotfi/Documents/Concept/lib/storage.ts) |
| n8n execution ID | disk `status.json.n8nExecutionId` | [lib/storage.ts](/C:/Users/lotfi/Documents/Concept/lib/storage.ts) |
| Source PDF | disk `data/{code}/cdc.pdf` | [lib/storage.ts](/C:/Users/lotfi/Documents/Concept/lib/storage.ts) |
| Markdown artifact | disk `data/{code}/cdc.md` | [lib/storage.ts](/C:/Users/lotfi/Documents/Concept/lib/storage.ts) |
| Fiche CDC XML | disk `data/{code}/fiche.xml` | [lib/storage.ts](/C:/Users/lotfi/Documents/Concept/lib/storage.ts) |
| Fiche validation state | disk status + Postgres sync index + audit log | [app/api/fiche/[code]/validate/route.ts](/C:/Users/lotfi/Documents/Concept/app/api/fiche/[code]/validate/route.ts), [lib/db.ts](/C:/Users/lotfi/Documents/Concept/lib/db.ts) |
| Search/index copy | PostgreSQL `cdc_fiches.fiches_projet` | [lib/db.ts](/C:/Users/lotfi/Documents/Concept/lib/db.ts) |
| Orchestration runtime | n8n SQLite | local `C:\Users\lotfi\.n8n\database.sqlite` |

## 6.2 Places where business state is still read from multiple systems

State still read from disk:
- `readFicheStatus()`
- `readExistingStatus()`
- artifact existence checks in [lib/appels-offres/storage.ts](/C:/Users/lotfi/Documents/Concept/lib/appels-offres/storage.ts)
- business-status mapping in [lib/appels-offres/presentation.ts](/C:/Users/lotfi/Documents/Concept/lib/appels-offres/presentation.ts)

State still read from PostgreSQL:
- Appel d'offres list/detail routes
- processing jobs
- audit logs
- documents metadata
- fiche index sync layer

State still read from n8n SQLite:
- workflow versions
- execution history
- operational debugging only

State still derived from callback payload:
- `executionId`
- error stage
- error message
- raw XML/Markdown success payload

## 6.3 Minimum transition to make PostgreSQL authoritative

Smallest stable transition:
1. Keep disk as artifact storage only:
   - `cdc.pdf`
   - `cdc.md`
   - `fiche.xml`
2. Persist authoritative fiche-processing state in PostgreSQL:
   - canonical status
   - execution ID
   - error stage
   - error message
   - started/finished timestamps
3. Make the UI and business-status mapper read the canonical state from PostgreSQL first.
4. Leave `cdc_fiches.fiches_projet` as a searchable projection, not the operational source of truth.

# 7. Security Findings

| Severity | Finding | Evidence | Impact | Required correction |
|---|---|---|---|---|
| Critical | Active n8n webhook has no confirmed request authentication | Published workflow trigger has no auth config and no validation node for `Authorization` | Anyone who can reach the webhook URL can attempt to start runs | Add workflow-side auth validation or protected n8n webhook auth before connection |
| Critical | Callback base URL is hardcoded to `http://localhost:3000` | `Respond XML JSON`, `Marker Job Failed`, `Marker Timeout`, `Gemini Error Callback` | Environment lock-in; callbacks fail outside that host/port | Make callback base URL configurable |
| High | Error-stage contract is inconsistent after Groq→Gemini migration | App types still allow `groq`; workflow sends `gemini`; app still writes malformed-XML stage `groq` | Wrong error classification, broken typing, brittle downstream logic | Add canonical provider stage support and remove legacy Groq assumption |
| High | Optional webhook bearer token is not enforced by the active workflow | App can send `N8N_WEBHOOK_TOKEN`; workflow has no confirmed validator | False sense of protection | Either enforce it in n8n or remove it from platform contract until implemented |
| High | Replay/idempotency protection is incomplete | Callback only checks current `processing` state plus optional stored execution ID | Late or duplicate callbacks are not cleanly idempotent | Require persisted correlation key and idempotent callback receipts |
| Medium | Execution ID is optional at start acceptance | [app/api/generate/route.ts](/C:/Users/lotfi/Documents/Concept/app/api/generate/route.ts) stores `null` if missing | Weakens callback correlation | Require execution ID in acceptance response |
| Medium | PDF validation is MIME-based only | `resolvePdfFile()` only checks `application/pdf` | Non-PDF content can be mislabeled | Add magic-byte validation |
| Medium | No upload size limit in app route | No size guard in start flow | Memory/disk pressure and oversized jobs | Enforce upload size limits |
| Medium | Sensitive CDC content passes through local workflow and AI provider calls | Workflow reads markdown and posts full prompt body to Gemini | Confidential tender content exposure needs explicit operational approval | Document data-handling boundary and secure logs/runtime |
| Low | Historical migration script contains local default secret fallback | [scripts/migrate_n8n_cdc_async.py](/C:/Users/lotfi/Documents/Concept/scripts/migrate_n8n_cdc_async.py) | Confusing and risky if reused casually | Remove fallback secret from maintenance scripts |

# 8. Reliability Findings

| Scenario | Current behavior | Risk | Required correction |
|---|---|---|---|
| n8n unavailable when analysis starts | App writes processing bundle, then marks fiche/appel as error and still returns HTTP `202` with `{ status: "error" }` | UI can treat launch failure like accepted work | Return a real failure status or explicit rejected job contract |
| n8n accepts request but crashes | App remains dependent on callback; no stale-job reaper | Fiche can stay stuck in `processing` | Add timeout/reconciliation job |
| Marker stays processing forever | Workflow guard stops after about 20 minutes and sends `Marker Timeout` if branch behaves correctly | Long-running jobs remain expensive and still depend on timeout branch working | Keep guard, add platform-side stale-job monitoring |
| Marker fails | Workflow sends `Marker Job Failed` callback | Depends on callback host/secret still being valid | Keep, but make callback target configurable |
| Gemini fails | Workflow sends `Gemini Error Callback`; recent n8n runs show overall `success` despite error path | n8n success metrics are misleading | Track business completion separately from n8n execution status |
| malformed XML | App marks fiche error with legacy stage `groq` | Wrong provider classification | Make malformed-XML stage provider-neutral or `gemini` |
| empty Markdown | Gemini node throws if markdown is blank | Error path exists, but overall run can still look successful in n8n | Record business-level failure explicitly |
| duplicate callback | Non-processing state returns `409` | Not idempotent for replays | Return idempotent acknowledgement for already-applied callback |
| late callback from older retry | App only compares execution ID if one was previously stored | Old callback can win when acceptance ID was never persisted | Require execution ID on acceptance and callback |
| platform restart | Disk artifacts survive; in-memory state does not matter much | Stuck processing remains stuck without sweeper | Add recovery/reconcile job |
| n8n restart | Executions may crash/cancel | Platform may never hear back | Add stale-job handling and manual replay procedure |
| database write failure during callback sync | App writes disk first, then best-effort syncs Postgres projections and business tables | Split-brain between artifacts and metadata | Make DB state authoritative or add compensating reconciliation |
| disk write failure | Callback/start route fails mid-transition | Partial artifact state possible | Use staged bundle writes for whole-state transitions |
| callback succeeds but PostgreSQL update fails | `syncAppelOffresSafely()` and `syncFicheIndexSafely()` swallow errors | UI metadata can drift from saved artifacts | Add alerting/retry/reconciliation for sync failures |
| callback fails after files were written | Success path writes disk before all metadata sync completes | Disk and business state can diverge | Reorder or reconcile with authoritative DB state |
| user retries while another run is active | Route blocks only when `status.json.status === "processing"` | If disk state drifts, concurrency control is weak | Base concurrency on authoritative processing job state plus execution correlation |

# 9. Obsolete or Risky Workflow Elements

- Disabled nodes still present in active graph:
  - `Code JS (anonymisation)`
  - `HTTP Request → Ollama (anonymisation)`
  - `Code JS (fusion Ollama)`
- Old provider history still present in workflow artifacts:
  - Groq backups under [tmp/n8n-workflow-backups](/C:/Users/lotfi/Documents/Concept/tmp/n8n-workflow-backups)
- Hardcoded callback URLs:
  - `http://localhost:3000/api/fiche/{code}/complete`
- Hardcoded Windows paths:
  - `C:\Users\lotfi\.n8n-files\incoming`
  - `C:\Users\lotfi\.n8n-files\marker_output`
- Hardcoded local service URLs:
  - `http://127.0.0.1:8000/convert`
  - `http://127.0.0.1:8000/result/{job_id}`
- Draft-versus-active workflow version split in live n8n state:
  - active published version `25aeeda4-0587-4ef3-bfb1-6a98c5d3a6f3`
  - newer autosaved draft `36ef9707-9982-48d5-b0c8-7c1abaa64ebb`
- Stale scripts that can mislead future maintenance:
  - Groq-era patch scripts
  - migration scripts with local defaults
- Stale documentation:
  - [README.md](/C:/Users/lotfi/Documents/Concept/README.md) still describes the app mainly as `/initiation` + `/fiche`
  - [PROJECT_AUDIT.md](/C:/Users/lotfi/Documents/Concept/PROJECT_AUDIT.md) is historical and does not reflect the current Appels d'offres platform architecture

# 10. Minimum Integration Plan

1. Freeze one canonical contract for start webhook, acceptance response, and completion callback.
2. Make callback base URL configurable from environment or explicit workflow configuration.
3. Require n8n to return `executionId` at acceptance time and persist it before the platform treats the run as accepted.
4. Extend the platform error-stage contract to include Gemini or move to provider-neutral stage values.
5. Make callback processing idempotent and replay-safe.
6. Move authoritative fiche-processing state into PostgreSQL while keeping disk as artifact storage.
7. Enforce real webhook authentication on the n8n entrypoint.
8. Add stale-job reconciliation for runs that never callback.
9. Validate end-to-end success and failure paths against the published active workflow version, not a draft.
10. Only then connect the Appels d'offres workspace UX to the analysis launch flow.

# 11. Required Changes by Component

## Next.js

- Formalize the n8n start contract in one shared module or documented schema.
- Require and persist acceptance `executionId`.
- Align callback error-stage handling with Gemini.
- Make callback handling idempotent.
- Stop treating n8n launch failure as accepted processing.
- Read canonical processing state from PostgreSQL rather than disk-only fiche status.

## PostgreSQL

- Store authoritative fiche-processing state, including:
  - execution ID
  - started/finished timestamps
  - error stage
  - error message
- Keep `public.processing_jobs` as the source for active-run coordination.
- Keep `cdc_fiches.fiches_projet` as a projection/index, not operational state.

## n8n

- Add or enforce webhook authentication.
- Make callback base URL configurable.
- Ensure acceptance response always exposes execution ID.
- Validate that success path reaches `Respond XML JSON`.
- Validate that every failure path reaches a callback node.
- Remove or clearly isolate obsolete disabled nodes if they are no longer part of the supported design.

## Environment configuration

- Add documented `GEMINI_API_KEY` requirement for n8n.
- Add documented callback base URL variable.
- Decide whether `N8N_WEBHOOK_TOKEN` is required and enforce it consistently.
- Keep `N8N_COMPLETE_SECRET` shared between app and workflow only via env.

## Documentation

- Update env docs to include Gemini and callback-base settings.
- Replace stale architecture docs that still center `/initiation` as the platform.
- Document the active published workflow version and rollback/export procedure.

## Tests

- Contract test for start-webhook acceptance parsing.
- Contract test for callback success and failure payloads.
- Replay/idempotency test for duplicate callbacks.
- End-to-end test for one successful run and one failure run against the published workflow version.

# 12. Go / No-Go Recommendation

Not ready; stabilize workflow first.

Why:
- The platform and workflow do not yet share one stable contract for authentication, callback URL ownership, execution correlation, and provider error stages.
- The live workflow history shows runs marked `success` that actually ended on the Gemini error callback path.
- The platform still reads key business/processing state from disk `status.json`, while the Appels d'offres layer already expects PostgreSQL-backed business truth.

The smallest safe path is to stabilize the workflow contract and state ownership first, then connect the Appels d'offres workspace to the analysis flow.

## Terminal Summary

- Current readiness: not ready to integrate.
- Biggest blocker: the active workflow/callback contract is still unstable and partially hardcoded, especially callback URL, authentication, and Gemini error-stage handling.
- First recommended action: freeze and implement one canonical Next.js <-> n8n contract around acceptance `executionId`, callback URL ownership, webhook auth, and callback error stages before any UI connection work.
