# N8N Canonical Contract Implementation Plan

## Current workflow architecture

Active workflow:

- ID: `f866bd39869c4c11`
- Name: `CDC Initiation - Fiche Projet XML`
- Active flag: `1`

Version state confirmed from local n8n SQLite:

- published runtime version: `25aeeda4-0587-4ef3-bfb1-6a98c5d3a6f3`
- current autosaved draft version: `36ef9707-9982-48d5-b0c8-7c1abaa64ebb`
- published row timestamp: `2026-07-14 09:05:40.799`
- newer draft timestamp: `2026-07-14 09:07:29.077`

Important runtime nuance:

- `workflow_entity.nodes` is not identical to the published `activeVersionId`.
- The live draft has already drifted from the published version, including the webhook `responseMode`.
- We must update the published runtime version, not only the draft JSON in `workflow_entity`.

Published workflow stages:

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

Disabled and disconnected nodes:

- `Code JS (anonymisation)`
- `HTTP Request → Ollama (anonymisation)`
- `Code JS (fusion Ollama)`

These are currently disconnected and can remain disabled unless they interfere with validation.

## Contract gaps

### Launch webhook gaps

- The current workflow accepts legacy multipart input with `code_interne` and `file`.
- The canonical contract now requires a JSON launch payload with:
  - `contract_version`
  - `processing_job_id`
  - `appel_offre_id`
  - `code_interne`
  - `correlation_id`
  - `callback_url`
  - `pdf_path`
  - `requested_at`
- The current webhook does not validate these fields.
- The current webhook does not preserve all canonical identifiers through the pipeline.

### Launch authentication gaps

- The current workflow has no confirmed enforcement of `Authorization: Bearer <N8N_WEBHOOK_TOKEN>`.
- The canonical platform already sends this header.

### Acceptance-response gaps

- The published version correctly uses `responseMode: "onReceived"`.
- The draft has drifted and dropped that setting.
- The current workflow does not return the canonical `202 Accepted` JSON body.
- The current workflow does not guarantee `execution_id`, `processing_job_id`, `correlation_id`, `contract_version`, and `received_at` in the immediate response.

### PDF access gaps

- The current workflow saves an uploaded binary file to hardcoded local paths.
- The canonical contract requires n8n to read the platform-owned `pdf_path`.
- The workflow must validate the path and ensure it remains inside an allowed shared root.
- The workflow must stop depending on the old incoming-upload temp path for the canonical path.

### Callback gaps

- The current callback target is hardcoded to `http://localhost:3000/api/fiche/{code}/complete`.
- The canonical contract requires using the provided `callback_url`.
- The current callback schema is legacy and not canonical.
- The current callback auth uses `X-Complete-Secret`, but canonical callbacks require:
  - `Authorization: Bearer <PLATFORM_CALLBACK_TOKEN>`
  - `X-Contract-Version`
  - `X-Callback-Timestamp`
  - `X-Callback-Signature`

### Error-mapping gaps

- The current workflow sends provider-specific stage `gemini`.
- Canonical error stages must stay provider-neutral:
  - `WEBHOOK`
  - `UPLOAD`
  - `MARKER`
  - `MARKDOWN`
  - `ANONYMIZATION`
  - `LLM`
  - `XML`
  - `CALLBACK`
  - `UNKNOWN`

### Terminal-callback gaps

- The current workflow can succeed at the n8n execution layer even when the business path used `Gemini Error Callback`.
- The workflow must guarantee exactly one terminal callback per execution.
- Success and failure branches need a terminal guard to prevent double callback delivery.

## Exact files and artifacts to modify

### New documentation

- `N8N_CANONICAL_CONTRACT_IMPLEMENTATION_PLAN.md`
- `N8N_CANONICAL_CONTRACT_IMPLEMENTATION_SUMMARY.md`
- `docs/n8n-canonical-contract-env.md`

### New workflow mutation script

- create one new patch script under `scripts/` or `tmp/` that:
  - backs up the full SQLite database
  - backs up the active workflow JSON
  - patches nodes and connections
  - writes both `workflow_entity` and `workflow_history`
  - updates `versionId` and `activeVersionId`
  - records publish history

### Existing reference materials to reuse

- `CANONICAL_PLATFORM_N8N_CONTRACT.md`
- `N8N_PLATFORM_INTEGRATION_AUDIT.md`
- `tmp/n8n-workflow-backups/f866bd39869c4c11_after_gemini_error_literals_20260714_090540.json`
- `tmp/patch_active_n8n_workflow_to_gemini.py`
- `tmp/patch_active_n8n_gemini_error_literals.py`

## Nodes to modify

### `Webhook CDC Initiation`

- keep webhook path unless the existing `N8N_WEBHOOK_URL` already points to it
- enforce `responseMode: "onReceived"`
- treat input as canonical JSON rather than uploaded multipart binary

### `Validate Webhook Input`

- replace legacy multipart validation with canonical payload validation
- validate:
  - contract version
  - required identifiers
  - `callback_url`
  - `pdf_path`
  - timestamp format
- validate incoming bearer token
- reject deterministically on invalid auth or invalid payload

### `Prepare Upload Paths`

- replace with canonical context normalization
- preserve:
  - `processing_job_id`
  - `appel_offre_id`
  - `code_interne`
  - `correlation_id`
  - `callback_url`
  - `contract_version`
  - `pdf_path`
  - `execution_id`
  - `received_at`
  - `started_at`
- enforce shared-root validation for `pdf_path`
- derive Marker output directory from canonical inputs and configured roots

### `Save Uploaded PDF`

- no longer valid for canonical launches because the platform already owns the PDF file
- replace with a path-validation/readiness node or disable it if no longer needed

### `Convert PDF via FastAPI Marker`

- adapt to read the file from canonical `pdf_path`
- if Marker still requires multipart upload, read the PDF from disk and send it as binary without altering business content

### `Read Markdown as Text`

- preserve context object fields so downstream nodes still have canonical identifiers

### `HTTP Request → Gemini XML`

- preserve prompt, model, and XML extraction behavior
- ensure downstream context survives the AI request and error output path

### `Clean XML Response`

- keep current Gemini OpenAI-compatible extraction path
- add canonical success-payload validation:
  - markdown non-empty
  - xml non-empty
  - XML root looks like `fiche_projet`

### `Respond XML JSON`

- replace legacy callback with canonical success callback
- use `callback_url`
- sign request
- include canonical payload shape with nested `result`

### `Gemini Error Callback`

- replace with canonical failure callback
- map Gemini errors to `LLM`

### `Marker Job Failed`

- replace with canonical failure callback
- map to `MARKER`

### `Marker Timeout`

- replace with canonical failure callback
- map to `MARKER`

## Nodes to add

Planned additions:

1. `Build Canonical Context`
   - normalize and preserve all canonical fields immediately after validation

2. `Respond 202 Accepted`
   - explicit responder node or equivalent response branch
   - returns canonical acceptance body before long-running processing begins

3. `Build Callback Auth`
   - compute:
     - raw callback payload
     - `X-Callback-Timestamp`
     - `X-Callback-Signature`

4. `Send Success Callback`
   - canonical success HTTP callback

5. `Send Failure Callback`
   - canonical failure HTTP callback

6. `Terminal Callback Guard`
   - guarantee one terminal callback per execution
   - likely stored in workflow static data or guarded branch state

7. `Validate XML Output`
   - minimum structural check before choosing success callback

## Nodes to disable or remove

Disable or remove only if unused after patch:

- `Save Uploaded PDF`
  - expected to become obsolete under canonical `pdf_path`

Keep disabled and disconnected unless they create runtime noise:

- `Code JS (anonymisation)`
- `HTTP Request → Ollama (anonymisation)`
- `Code JS (fusion Ollama)`

## Active-version update strategy

Because n8n runtime uses published workflow history:

1. Back up the full database.
2. Back up the current workflow JSON.
3. Patch workflow JSON from the published version baseline, not from memory.
4. Write the new workflow into:
   - `workflow_entity.nodes`
   - `workflow_entity.connections`
   - `workflow_entity.settings`
5. Generate a new version ID.
6. Set:
   - `workflow_entity.versionId = <new_version_id>`
   - `workflow_entity.activeVersionId = <new_version_id>`
7. Insert a new non-autosaved row into `workflow_history`.
8. Insert a publish row into `workflow_publish_history`.
9. Preserve history; do not delete prior rows.
10. Restart or reload n8n only if required to guarantee the active runtime picks up the new published version.

## Required environment variables

Platform-to-n8n:

- `N8N_WEBHOOK_TOKEN`
- `N8N_CONTRACT_VERSION`

n8n-to-platform:

- `PLATFORM_CALLBACK_TOKEN`
- `N8N_CALLBACK_SECRET`
- `N8N_CALLBACK_TIMEOUT_MS` if we choose an explicit timeout variable

Shared storage and processing:

- `N8N_SHARED_STORAGE_ROOT`
- `N8N_MARKER_OUTPUT_ROOT`
- `MARKER_CONVERT_URL`
- `MARKER_RESULT_URL`

Provider/runtime:

- `GEMINI_API_KEY`

Optional if local path translation is needed:

- `N8N_PLATFORM_DATA_ROOT`
- `N8N_RUNTIME_DATA_ROOT`

## Rollback strategy

1. Restore the full SQLite backup created immediately before mutation.
2. Restore the workflow JSON backup if a row-level restore is preferred.
3. Set `workflow_entity.activeVersionId` back to the previous published version if needed.
4. Restart n8n if the runtime already loaded the new version.
5. Confirm the active workflow ID and version in SQLite after rollback.

## Test scenarios

1. Invalid launch payload
   - expect rejection
   - no Marker request
   - no callback

2. Invalid launch auth
   - expect rejection
   - no processing

3. Valid launch acceptance
   - immediate `202`
   - canonical acceptance JSON
   - real `execution_id`

4. Successful processing
   - Marker success
   - markdown extracted
   - XML generated
   - exactly one signed success callback

5. Marker failure
   - exactly one signed failure callback
   - stage `MARKER`

6. Gemini failure
   - exactly one signed failure callback
   - stage `LLM`

7. XML validation failure
   - failure callback
   - stage `XML`

8. Callback URL variation
   - uses provided `callback_url`
   - no localhost fallback

9. Duplicate terminal prevention
   - no success-then-failure double callback
   - no duplicate retries with same execution

10. Active runtime verification
   - SQLite reflects the new published version
   - n8n runtime activates the correct version on restart if restart is needed

## Risks

- The draft/published version split means a draft-only patch would be ineffective at runtime.
- Direct SQLite mutation is operationally sensitive and must remain atomic.
- n8n 2.26.6 may cache active workflows until restart.
- The switch from uploaded binary input to `pdf_path` may require a new disk-read approach for Marker uploads.
- The workflow currently has no DB-backed callback guard, so guard logic must stay deterministic within one execution.
- Hardcoded local service URLs may still exist for Marker and need env-backed replacement without breaking local runtime.
