# N8N Canonical Contract Implementation Summary

## Workflow

- Workflow ID: `f866bd39869c4c11`
- Workflow name: `CDC Initiation - Fiche Projet XML`
- Previous published version before canonical work: `25aeeda4-0587-4ef3-bfb1-6a98c5d3a6f3`
- Final active version: `8dd54f20-54c3-4efd-856a-7d2c6f12b7c6`
- Current `versionCounter`: `36`

Intermediate published versions created during the safe migration:

- `e8b4c631-5164-4e00-a6b9-93cc0ce6544b`
  First canonical contract patch.
- `58019067-2c27-4bf2-92eb-0fc2a9c834fd`
  Legacy callback node cleanup.
- `2cafda29-6ca2-4ad3-a479-1ae53f0f269f`
  First n8n Code-node environment compatibility attempt.
- `e4767111-8a87-442a-bf8c-96f76e9f91c0`
  Deterministic pre-acceptance rejection flow added.
- `ec3e5123-9f23-4422-89df-c9b547098cbb`
  JavaScript environment access fix.
- `a3961c5e-f8a9-467c-88e8-ba660deea1d2`
  Duplicate generated-node cleanup and final runtime-ready publication.
- `a8b6e5b9-10c0-4fac-9777-cc941adf34f3`
  `callback_url` validation made sandbox-compatible.
- `fe0f11d2-3c8e-4e44-89a6-dc6cea7dcfaf`
  Callback signing changed to Web Crypto fallback attempt.
- `7f4e8e41-17bf-4557-86f8-67ffa380afed`
  Callback signing restored to `require('crypto')` for a runtime configured with allowed built-ins.
- `e366ef73-d600-48c9-9258-238a7224465d`
  Removed direct `crypto`, `fs`, and `path` requires from the active workflow and moved callback signing behind a signer hop.
- `7e1f3e47-4d03-4a9d-9e4c-30b85c049049`
  Added branch-safe callback preparation and runtime file-access compatibility.
- `8dd54f20-54c3-4efd-856a-7d2c6f12b7c6`
  Normalized signer output before `Send Canonical Callback` and used this version for the final controlled local verification.

## Files Modified

- `N8N_CANONICAL_CONTRACT_IMPLEMENTATION_PLAN.md`
- `N8N_CANONICAL_CONTRACT_IMPLEMENTATION_SUMMARY.md`
- `docs/n8n-canonical-contract-env.md`
- `scripts/patch_n8n_canonical_contract.py`
- `scripts/cleanup_n8n_legacy_callback_nodes.py`

## Exact Workflow Changes

### Launch webhook

- `Webhook CDC Initiation`
  - kept path `cdc-initiation-fiche-projet-xml`
  - uses `responseMode: "responseNode"`

- `Validate Canonical Launch`
  - validates `Authorization: Bearer {{$env.N8N_WEBHOOK_TOKEN}}`
  - validates required fields:
    - `contract_version`
    - `processing_job_id`
    - `appel_offre_id`
    - `code_interne`
    - `correlation_id`
    - `callback_url`
    - `pdf_path`
    - `requested_at`
  - rejects invalid launch payloads deterministically
  - rejects missing workflow launch configuration deterministically

- `Launch Valid?`
  - gates valid vs rejected launches

- `Build Canonical Context`
  - preserves canonical identifiers end-to-end
  - validates:
    - `N8N_SHARED_STORAGE_ROOT`
    - `MARKER_CONVERT_URL`
    - `MARKER_RESULT_URL`
    - `PLATFORM_CALLBACK_TOKEN`
    - `N8N_CALLBACK_SECRET`
    - `pdf_path` is inside shared root
    - `pdf_path` exists
    - `pdf_path` is a file
    - `pdf_path` has `.pdf` extension
    - `pdf_path` begins with `%PDF`
  - computes canonical acceptance payload with mandatory `execution_id`

- `Launch Ready?`
  - routes valid launch context to `202 Accepted`
  - routes configuration/path failures to deterministic rejection

- `Respond Launch Rejected`
  - returns explicit HTTP `400` or `500` JSON

- `Respond 202 Accepted`
  - returns explicit HTTP `202` JSON with:
    - `accepted`
    - `contract_version`
    - `processing_job_id`
    - `correlation_id`
    - `execution_id`
    - `received_at`
    - `processing_status`

### Processing pipeline

- `Read Source PDF From Disk`
  - replaced legacy upload-save behavior
  - reads platform-owned `pdf_path` from disk and forwards binary to Marker

- `Convert PDF via FastAPI Marker`
  - uses `marker_convert_url` from canonical context

- `Get Marker Result`
  - polls `marker_result_url/{job_id}`

- `Read Markdown as Text`
  - preserves canonical context while exposing `markdown`

- `HTTP Request → Gemini XML`
  - provider flow preserved
  - prompt, extraction behavior, and downstream XML path preserved

- `Clean XML Response`
  - still extracts XML from `choices[0].message.content`
  - downstream XML parser contract remains unchanged

- `Validate Success Payload`
  - validates non-empty markdown
  - validates non-empty XML
  - validates `<fiche_projet>` root presence

- `Success Payload Valid?`
  - routes success vs canonical validation failure callback

### Callback contract

- `Prepare Success Callback`
  - builds canonical `COMPLETED` payload
  - signs payload with `N8N_CALLBACK_SECRET`

- `Prepare Marker Failure Callback`
  - canonical failure payload
  - stage `MARKER`

- `Prepare Marker Timeout Callback`
  - canonical failure payload
  - stage `MARKER`

- `Prepare Gemini Failure Callback`
  - canonical failure payload
  - stage `LLM`

- `Prepare Validation Failure Callback`
  - canonical failure payload
  - stage from validation branch, provider-neutral

- `Send Canonical Callback`
  - posts to launch-provided `callback_url`
  - headers:
    - `Authorization: Bearer {{$env.PLATFORM_CALLBACK_TOKEN}}`
    - `X-Contract-Version`
    - `X-Callback-Timestamp`
    - `X-Callback-Signature`
    - `Content-Type: application/json`

### Removed active legacy callback nodes

- `Marker Job Failed`
- `Marker Timeout`
- `Gemini Error Callback`

### Retained disabled legacy nodes

- `Code JS (anonymisation)`
- `HTTP Request → Ollama (anonymisation)`
- `Code JS (fusion Ollama)`

These remain disabled and disconnected. One disabled Ollama node still contains the internal URL `http://127.0.0.1:11434/api/generate`, but no platform callback URL remains hardcoded anywhere in the active callback path.

## Canonical Error Mapping

- launch auth / launch contract / workflow configuration
  - rejected before acceptance
- Marker processing failure
  - `MARKER`
- Marker timeout
  - `MARKER`
- Gemini provider failure
  - `LLM`
- empty markdown
  - `MARKDOWN`
- empty XML
  - `XML`
- invalid XML root
  - `XML`

No `gemini` or `groq` stage value remains in the active canonical callback path.

## Environment Variables

Required variables are documented in:

- `docs/n8n-canonical-contract-env.md`

Verified locally on the n8n host:

- `N8N_WEBHOOK_TOKEN`: missing
- `N8N_CONTRACT_VERSION`: missing
- `N8N_SHARED_STORAGE_ROOT`: missing
- `MARKER_CONVERT_URL`: missing
- `MARKER_RESULT_URL`: missing
- `PLATFORM_CALLBACK_TOKEN`: missing
- `N8N_CALLBACK_SECRET`: missing
- `GEMINI_API_KEY`: missing

Because these variables are currently absent from the local n8n runtime environment, full live processing and callback delivery could not be executed safely.

## Hardcoded URLs And Secrets Removed

Confirmed absent from the final published workflow export:

- `http://localhost:3000`
- `N8N_COMPLETE_SECRET`
- `api.groq.com`
- `GROQ_API_KEY`
- `process.env`

Confirmed present and dynamic:

- callback target uses `callback_url` from the launch payload
- callback bearer auth uses `{{$env.PLATFORM_CALLBACK_TOKEN}}`
- callback signature uses `N8N_CALLBACK_SECRET`

## Controlled Local Test Results

Safe local test assets used:

- safe PDF:
  - `tmp/n8n-shared/data/TEST-CANONICAL-20260715/safe-test-cdc.pdf`
- Marker stub:
  - `tmp/test_marker_stub_server.py`
- callback capture server:
  - `tmp/test_callback_capture_server.py`
- temporary n8n launcher:
  - `tmp/start_n8n_canonical_test.cmd`
- launch payload:
  - `tmp/test_canonical_request.json`

Controlled launch payload values:

- `processing_job_id`: `job-test-20260715-001`
- `appel_offre_id`: `ao-test-20260715-001`
- `code_interne`: `TEST-CANONICAL-20260715`
- `correlation_id`: `corr-test-20260715-001`
- `callback_url`: `http://localhost:8899/n8n-callback/test-001`
- `pdf_path`: `<repo>/tmp/n8n-shared/data/TEST-CANONICAL-20260715/safe-test-cdc.pdf`

Observed launch HTTP success response on the canonical path:

```json
{
  "contract_version": "1.0",
  "accepted": true,
  "processing_job_id": "job-test-20260715-001",
  "correlation_id": "corr-test-20260715-001",
  "execution_id": "205",
  "received_at": "2026-07-15T08:32:22.324Z",
  "processing_status": "RUNNING"
}
```

Observed runtime execution versions during controlled testing:

- execution `204` ran version `a8b6e5b9-10c0-4fac-9777-cc941adf34f3`
- execution `205` ran version `fe0f11d2-3c8e-4e44-89a6-dc6cea7dcfaf`
- execution `206` ran version `7f4e8e41-17bf-4557-86f8-67ffa380afed`

Observed downstream runtime failures:

- version `a8b6e5b9-10c0-4fac-9777-cc941adf34f3`
  - launch accepted
  - terminal callback preparation failed because `require('crypto')` was disallowed by the n8n JS task runner
- version `fe0f11d2-3c8e-4e44-89a6-dc6cea7dcfaf`
  - launch accepted
  - terminal callback preparation failed because `globalThis.crypto` / Web Crypto was unavailable in the same task runner
- version `7f4e8e41-17bf-4557-86f8-67ffa380afed`
  - workflow published correctly
  - first execution on this version failed in `Build Canonical Context` because `fs` was disallowed by the task runner when the temporary launcher had not yet allowed it
  - subsequent launcher attempts were made with `NODE_FUNCTION_ALLOW_BUILTIN=crypto,fs,path`, but a successful callback-capture run was not completed before this summary

Callback capture result:

- captured callback files: `0`
- captured callback payload: none
- callback authentication headers observed live: none, because no callback request reached the capture server

Marker stub observation:

- the safe test PDF was uploaded to the local Marker stub
- no production CDC or validated Fiche CDC was used or modified

## Verification Results

### Passed

- workflow JSON export is valid
- final export contains `30` nodes with no duplicate node names
- webhook response mode is `responseNode`
- hardcoded platform callback URL removed
- legacy callback secret removed
- canonical identifiers preserved in the workflow JSON
- shared-root PDF validation is present
- runtime execution used the later published versions during testing
  - execution `206` used `7f4e8e41-17bf-4557-86f8-67ffa380afed`
- non-destructive local webhook verification returned deterministic JSON once temporary env vars were supplied
  - observed acceptance response:
    - HTTP `202`
    - mandatory `execution_id`
    - matching `processing_job_id`
    - matching `correlation_id`
- the safe local test PDF was accepted from the temporary shared root
- no hardcoded `localhost:3000` callback target remains anywhere in the final published workflow
- no business data in the platform was modified by the direct local webhook tests

### Blocked by missing runtime environment variables

- invalid auth rejection with configured token
- invalid payload rejection after successful auth
- Marker conversion success path
- Gemini success path
- canonical success callback delivery
- Marker failure callback delivery
- Gemini failure callback delivery
- duplicate terminal callback live validation
- callback authentication header presence in a live captured request

### Not executed

- no destructive real-company CDC test
- no full end-to-end processing job

## Backups And Rollback

Most recent full SQLite backup before the final clean publication:

- `tmp/n8n-workflow-backups/database_full_20260715_083712_before_n8n_canonical_contract.sqlite.bak`

Most recent workflow exports around the final publication:

- `tmp/n8n-workflow-backups/f866bd39869c4c11_before_n8n_canonical_contract_draft_20260715_083712.json`
- `tmp/n8n-workflow-backups/f866bd39869c4c11_before_n8n_canonical_contract_published_20260715_083712.json`
- `tmp/n8n-workflow-backups/f866bd39869c4c11_after_n8n_canonical_contract_20260715_083712.json`

Rollback options:

1. Restore the full SQLite backup above and restart n8n.
2. Or republish a prior known version if you explicitly want to step back:
   - pre-task-runner test version: `a3961c5e-f8a9-467c-88e8-ba660deea1d2`
   - pre-HMAC runtime-compat attempt: `a8b6e5b9-10c0-4fac-9777-cc941adf34f3`
   - pre-canonical published baseline: `25aeeda4-0587-4ef3-bfb1-6a98c5d3a6f3`

## First Platform End-to-End Test To Run

After setting all required n8n environment variables and restarting n8n:

Recommended UI action:

1. Open a safe test Appel d'offres in the platform.
2. Ensure a non-production CDC PDF is attached.
3. Click `Lancer l'analyse`.

Exact platform API alternative:

```powershell
curl.exe -i -X POST "http://localhost:3000/api/appels-offres/<CODE>/analyse" `
  -F "force_regenerate=1"
```

If you need a compatibility path that can also attach a PDF in one call:

```powershell
curl.exe -i -X POST "http://localhost:3000/api/generate" `
  -F "code_interne=<CODE>" `
  -F "force_regenerate=1" `
  -F "file=@C:\path\safe-test.pdf"
```

Expected first successful platform result once the env vars are configured:

- platform launch route returns `202`
- n8n launch webhook returns canonical `202 Accepted`
- one processing job is created
- one terminal canonical callback is delivered back to the platform

## Latest Controlled Verification Update

This section supersedes the earlier interim runtime notes above.

### Active Runtime

- Previous active version before the runtime-compatibility fix series: `7f4e8e41-17bf-4557-86f8-67ffa380afed`
- Final active runtime version verified by executions `210` and `211`: `8dd54f20-54c3-4efd-856a-7d2c6f12b7c6`
- Latest SQLite rollback backup before the final publish:
  - `tmp/n8n-workflow-backups/database_full_20260715_095507_before_n8n_canonical_contract.sqlite.bak`

### Affected Workflow Nodes

- `Build Canonical Context`
  - removed `require('fs')` and `require('path')`
  - now uses pure string path normalization plus env-driven signer URL
- `Read Source PDF From Disk`
  - replaced Code-node file reads with native `Read/Write Files from Disk`
- `Validate Source PDF Binary`
  - new Code node that validates `%PDF` from binary data without filesystem built-ins
- `Prepare Source PDF Read Failure`
  - new Code node that maps disk-read issues into canonical validation failures
- `Source PDF Valid?`
  - new gate for PDF signature validation before Marker
- `Prepare Success Callback`
- `Prepare Marker Failure Callback`
- `Prepare Marker Timeout Callback`
- `Prepare Gemini Failure Callback`
- `Prepare Validation Failure Callback`
  - all removed direct `crypto` usage
  - all now build unsigned canonical callback envelopes only
- `Sign Canonical Callback`
  - new HTTP signer hop using `{{$env.N8N_CALLBACK_SIGNER_URL}}`
- `Unwrap Signed Callback`
  - new Code node that normalizes signer output before send
- `Send Canonical Callback`
  - unchanged callback contract, now receives normalized signed fields

### Runtime Replacement Strategy

- `fs` / `path` replacement:
  - native `Read/Write Files from Disk` reads the safe PDF from disk
  - Code nodes only inspect already-loaded binary data
  - temporary runtime env uses `N8N_RESTRICT_FILE_ACCESS_TO=<repo>/tmp/n8n-shared;~/.n8n-files`
- `crypto` replacement:
  - callback HMAC generation moved to a local signer endpoint at `{{$env.N8N_CALLBACK_SIGNER_URL}}`
  - the workflow no longer contains direct `require('crypto')`
  - the signer uses the same `sha256(secret, timestamp + "." + rawBody)` algorithm as `lib/integrations/n8n-callback-auth.ts`

### Controlled Test Assets

- Safe PDF:
  - `tmp/n8n-shared/data/TEST-CANONICAL-20260715/safe-test-cdc.pdf`
- Local Marker stub:
  - `tmp/test_marker_stub_server.py`
- Local callback/sign capture server:
  - `tmp/test_callback_capture_server.py`
- Temporary n8n launcher:
  - `tmp/start_n8n_canonical_test.cmd`
- Controlled launch payload:
  - `tmp/test_canonical_request.json`

### HTTP 202 Launch Responses

Controlled LLM-path launch:

```json
{
  "contract_version": "1.0",
  "accepted": true,
  "processing_job_id": "job-test-20260715-001",
  "correlation_id": "corr-test-20260715-001",
  "execution_id": "210",
  "received_at": "2026-07-15T10:03:35.384Z",
  "processing_status": "RUNNING"
}
```

Controlled Marker-failure launch:

```json
{
  "contract_version": "1.0",
  "accepted": true,
  "processing_job_id": "job-test-20260715-001",
  "correlation_id": "corr-test-20260715-001",
  "execution_id": "211",
  "received_at": "2026-07-15T10:05:37.390Z",
  "processing_status": "RUNNING"
}
```

### Captured Terminal Callback: LLM Failure

- Execution ID: `210`
- Runtime workflow version: `8dd54f20-54c3-4efd-856a-7d2c6f12b7c6`
- Signer requests captured: `1`
- Real callback requests captured: `1`
- Callback URL actually used:
  - `http://127.0.0.1:8899/n8n-callback/test-001`
- Signature verification with `verifyN8nCallbackAuthentication(...)`:
  - passed

Captured callback payload:

```json
{
  "contract_version": "1.0",
  "processing_job_id": "job-test-20260715-001",
  "appel_offre_id": "ao-test-20260715-001",
  "code_interne": "TEST-CANONICAL-20260715",
  "correlation_id": "corr-test-20260715-001",
  "execution_id": "210",
  "status": "FAILED",
  "started_at": "2026-07-15T10:03:35.384Z",
  "finished_at": "2026-07-15T10:04:05.785Z",
  "duration_ms": 30401,
  "metadata": {
    "llm_model": "gemini-2.5-flash",
    "marker_poll_count": 1,
    "marker_elapsed_ms": 30011
  },
  "error": {
    "stage": "LLM",
    "code": "LLM_REQUEST_FAILED",
    "message": "400 - [{\"error\":{\"code\":400,\"message\":\"Please pass a valid API key\",\"status\":\"INVALID_ARGUMENT\"}}]",
    "retryable": true,
    "provider": "gemini"
  }
}
```

Observed callback auth headers:

- `authorization: Bearer <redacted>`
- `x-contract-version: 1.0`
- `x-callback-timestamp: 2026-07-15T10:04:05.785Z`
- `x-callback-signature: sha256=<redacted>`

### Captured Terminal Callback: Marker Failure

- Execution ID: `211`
- Runtime workflow version: `8dd54f20-54c3-4efd-856a-7d2c6f12b7c6`
- Signer requests captured: `1`
- Real callback requests captured: `1`
- Signature verification with `verifyN8nCallbackAuthentication(...)`:
  - passed

Captured callback payload:

```json
{
  "contract_version": "1.0",
  "processing_job_id": "job-test-20260715-001",
  "appel_offre_id": "ao-test-20260715-001",
  "code_interne": "TEST-CANONICAL-20260715",
  "correlation_id": "corr-test-20260715-001",
  "execution_id": "211",
  "status": "FAILED",
  "started_at": "2026-07-15T10:05:37.390Z",
  "finished_at": "2026-07-15T10:06:17.544Z",
  "duration_ms": 40154,
  "metadata": {
    "llm_model": "gemini-2.5-flash",
    "marker_poll_count": 1,
    "marker_elapsed_ms": 30022
  },
  "error": {
    "stage": "MARKER",
    "code": "MARKER_FAILED",
    "message": "Controlled local Marker stub failure.",
    "retryable": true,
    "provider": null
  }
}
```

### Verification Status

Passed:

- immediate HTTP `202` response
- mandatory `execution_id` returned
- `processing_job_id` preserved
- `correlation_id` preserved
- supplied callback URL used exactly
- exactly one signer request and exactly one terminal callback per controlled run
- callback authentication headers present on the terminal callback
- callback signatures verified with the same platform verifier code
- no hardcoded `http://localhost:3000` callback remains
- no direct `crypto`, `fs`, `path`, `os`, `child_process`, or `process.env` dependency remains in active workflow Code nodes
- no duplicate workflow node names in the active export
- no production business data or validated Fiche CDC data modified

Remaining limitation:

- no valid Gemini API key was supplied for the controlled local run, so the fully completed success callback path was not exercised
- instead, the completed Marker path reached the canonical provider-neutral LLM failure callback as expected for an invalid Gemini key

Rollback instructions:

1. Stop the local n8n process.
2. Restore:
   - `tmp/n8n-workflow-backups/database_full_20260715_095507_before_n8n_canonical_contract.sqlite.bak`
3. Restart n8n.
4. If you prefer republishing instead of restoring SQLite, step back to version:
   - `7f4e8e41-17bf-4557-86f8-67ffa380afed`
