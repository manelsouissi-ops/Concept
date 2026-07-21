# n8n Canonical Contract Environment

This file documents the local contract between the Next.js platform and the
active canonical n8n workflow.

## What belongs to which process

### Next.js platform env

These are read by the platform process through `lib/integrations/n8n-config.ts`.

- `DATABASE_URL`
- `N8N_WEBHOOK_URL`
- `N8N_WEBHOOK_TOKEN`
- `PLATFORM_CALLBACK_TOKEN`
- `N8N_CALLBACK_SECRET`
- `PLATFORM_PUBLIC_BASE_URL`
- `N8N_CONTRACT_VERSION`
- `N8N_LAUNCH_TIMEOUT_MS`
- `MAX_CDC_UPLOAD_BYTES`

### n8n runtime env

These are read by the active workflow itself and must exist in the n8n process
environment.

- `N8N_WEBHOOK_TOKEN`
- `N8N_CONTRACT_VERSION`
- `N8N_SHARED_STORAGE_ROOT`
- `MARKER_CONVERT_URL`
- `MARKER_STATUS_URL`
- `MARKER_RESULT_URL`
- `N8N_CALLBACK_SIGNER_URL`
- `PLATFORM_CALLBACK_TOKEN`
- `N8N_CALLBACK_TIMEOUT_MS`
- `GEMINI_API_KEY`

### Local signer helper env

The repository does not currently expose a Next.js callback-signing route.
Instead, the only signer implementation present in the codebase is the local
helper server in `scripts/n8n-tests/test_callback_capture_server.py`, which
reads:

- `N8N_CALLBACK_SECRET`
- `PLATFORM_CALLBACK_TOKEN`

## Variables that must match across processes

- `N8N_WEBHOOK_TOKEN`
  Must match between Next.js and the n8n workflow validation node.

- `N8N_CONTRACT_VERSION`
  Must match between Next.js launch requests, n8n launch validation, and
  Next.js callback validation.

- `PLATFORM_CALLBACK_TOKEN`
  Must match between Next.js callback verification and the n8n runtime value
  used on `Send Canonical Callback`.

- `N8N_CALLBACK_SECRET`
  Must match between the Next.js callback verifier and whichever signer service
  computes `X-Callback-Signature`.

## Verified local value patterns

### Shared storage root

Next.js writes uploaded CDC PDFs under `data/{code}/cdc.pdf` using
`lib/storage.ts` and `lib/appels-offres/storage.ts`.

Expected local pattern:

- `N8N_SHARED_STORAGE_ROOT=<absolute-path-to-repo>\data`

This is the same logical root used to build the canonical `pdf_path` sent to
n8n. For example, dossier `<appel-offres-code>` stores its source PDF at:

- `<absolute-path-to-repo>\data\<appel-offres-code>\cdc.pdf`

The active workflow's `Build Canonical Context` node rejects launches unless
`pdf_path` is an absolute Windows path under `N8N_SHARED_STORAGE_ROOT`.

### Marker endpoints

Expected Marker contract:

- host: loopback or another trusted internal host
- port: project-specific local Marker port
- convert endpoint: `POST <marker-base-url>/convert`
- status endpoint base: `<marker-base-url>/status`
- result endpoint base: `<marker-base-url>/result`

Behavior verified against the current local API contract:

- `POST /convert` is asynchronous and returns a JSON `job_id`
- `GET /status/{job_id}` is the polling endpoint
- `GET /result/{job_id}` fetches the final markdown payload after completion
- the workflow must append `/{job_id}` itself for both status and result lookups
- `MARKER_STATUS_URL` and `MARKER_RESULT_URL` should be normalized without
  trailing slashes before appending `/{job_id}`
- `MARKER_CONVERT_URL` is used as provided, so keep it exactly on `/convert`

The controlled local stub used by `scripts/n8n-tests/start_n8n_canonical_test.cmd`
should mirror the same `/status/{job_id}` then `/result/{job_id}` contract.

### Callback signer URL

There is no Next.js route in this repository that signs callback payloads for
n8n. The canonical callback receiver is `POST /api/fiche/callbacks/n8n`, but it
verifies signatures and does not generate them.

The local helper server route follows this pattern:

- `N8N_CALLBACK_SIGNER_URL=http://127.0.0.1:<signer-port>/sign`

Behavior verified from `scripts/n8n-tests/test_callback_capture_server.py`:

- binds to loopback on the configured signer port
- accepts `POST /sign`
- expects JSON fields `callback_timestamp` and `callback_raw_body`
- returns JSON with `callback_signature`
- does not require bearer auth
- is loopback-only, so it is reachable from local n8n on the same machine

### Callback receiver URL

Next.js builds the canonical callback URL from `PLATFORM_PUBLIC_BASE_URL`:

- `https://platform.example.com/api/fiche/callbacks/n8n`

That route is protected by:

- `Authorization: Bearer <PLATFORM_CALLBACK_TOKEN>`
- `X-Callback-Timestamp`
- `X-Callback-Signature: sha256=<hmac>`

### Gemini

The active workflow node `HTTP Request -> Gemini XML` reads:

- `Authorization: Bearer {{$env.GEMINI_API_KEY}}`

`GEMINI_API_KEY` is therefore required in the n8n runtime whenever the
execution reaches the LLM extraction branch.

## Startup order

Use this order for local development:

1. PostgreSQL
2. Marker
3. n8n with its runtime env block
4. Next.js

If you rely on the local signer helper at its configured loopback address, start it before any
workflow execution is allowed to reach the terminal callback step.

## Safe local PowerShell block for n8n

Use placeholders for secrets. Do not commit real values.

```powershell
$env:N8N_WEBHOOK_TOKEN="<copy from .env.local>"
$env:N8N_CONTRACT_VERSION="1.0"
$env:PLATFORM_CALLBACK_TOKEN="<copy from .env.local>"
$env:N8N_CALLBACK_SECRET="<copy from .env.local>"
$env:N8N_SHARED_STORAGE_ROOT="<absolute-path-to-repo>\data"
$env:MARKER_CONVERT_URL="http://127.0.0.1:<marker-port>/convert"
$env:MARKER_STATUS_URL="http://127.0.0.1:<marker-port>/status"
$env:MARKER_RESULT_URL="http://127.0.0.1:<marker-port>/result"
$env:N8N_CALLBACK_SIGNER_URL="http://127.0.0.1:<signer-port>/sign"
$env:GEMINI_API_KEY="<copy from .env.local if the run can reach the LLM node>"
n8n start
```

## Notes

- Do not hardcode platform secrets into tracked files.
- The workflow reads the callback target from launch payload field `callback_url`.
- The workflow reads the source PDF from launch payload field `pdf_path`.
- A common local launch blocker is a missing `N8N_SHARED_STORAGE_ROOT` in the
  n8n runtime.
