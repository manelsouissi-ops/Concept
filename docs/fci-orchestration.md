# FCI Orchestration

## Scope

This Phase 4 flow connects FCI module generation to a dedicated n8n workflow.
It does not modify the CDC workflow, Marker, CDC XML parsing, or the CDC callback route.

Supported modules:

- `A` - commercial
- `B` - finance
- `C` - operations
- `D` - strategy

Module `E` remains disabled behind `KNOWLEDGE_BASE_ENABLED`.

## End-to-end flow

1. `POST /api/appels-offres/[code]/fci/[module]/generate`
2. Concept validates the module and the source Fiche CDC
3. Concept creates `fci_generation_jobs`
4. Concept launches the dedicated FCI n8n webhook
5. n8n calls Gemini and validates JSON against the module schema
6. n8n signs the raw callback body
7. n8n posts `POST /api/fci/callbacks/n8n`
8. Concept verifies bearer token, timestamp, and HMAC signature
9. Concept validates the callback contract and the module payload again
10. Concept persists a new `fci_module_data` version
11. Concept updates job/module/set statuses and audit events

## Prompt and schema strategy

Chosen strategy: Concept sends the exact prompt text and JSON Schema in the launch request.

Why:

- keeps prompt/schema versioning under application control
- avoids mounting prompt files into n8n
- avoids duplicating long prompts inside workflow nodes
- lets the job persist `contract_version`, `prompt_version`, and `schema_version`

Source files:

- prompts: `ai/prompts/fci-*.md`
- schemas: `ai/schemas/fci-*.schema.json`
- registry: `lib/appels-offres/fci/contract-registry.ts`

## Launch contract

Concept sends:

```json
{
  "contract_version": "1.0",
  "generation_job_id": 123,
  "fci_set_id": 45,
  "fci_module_id": 67,
  "appel_offre_id": 89,
  "code_interne": "AO-20260727-0001",
  "module_code": "A",
  "module_type": "commercial",
  "trigger_type": "manual",
  "correlation_id": "corr_...",
  "callback_url": "https://platform.example.com/api/fci/callbacks/n8n",
  "source_fiche": {
    "version": "validated:2026-07-27T08:00:00.000Z",
    "hash": "sha256...",
    "status": "validated",
    "validated_at": "2026-07-27T08:00:00.000Z",
    "updated_at": "2026-07-27T08:00:00.000Z"
  },
  "fiche_cdc": {},
  "generation_metadata": {
    "schema_version": "1.0",
    "prompt_version": "1.0",
    "requested_at": "2026-07-27T08:05:00.000Z",
    "requested_by": null,
    "provider": "gemini",
    "model": "gemini-3.6-flash"
  },
  "prompt": {
    "text": "...",
    "version": "1.0"
  },
  "output_schema": {
    "version": "1.0",
    "json_schema": {}
  }
}
```

Acceptance response:

```json
{
  "contract_version": "1.0",
  "accepted": true,
  "generation_job_id": 123,
  "correlation_id": "corr_...",
  "execution_id": "456",
  "received_at": "2026-07-27T08:05:01.000Z",
  "processing_status": "RUNNING"
}
```

## Callback contracts

Success callback:

```json
{
  "event": "fci.generation.completed",
  "contract_version": "1.0",
  "generation_job_id": 123,
  "fci_set_id": 45,
  "fci_module_id": 67,
  "appel_offre_id": 89,
  "code_interne": "AO-20260727-0001",
  "module_code": "A",
  "correlation_id": "corr_...",
  "execution_id": "456",
  "status": "completed",
  "provider": "gemini",
  "model": "gemini-3.6-flash",
  "prompt_version": "1.0",
  "schema_version": "1.0",
  "source_fiche": {
    "version": "validated:2026-07-27T08:00:00.000Z",
    "hash": "sha256..."
  },
  "generated_at": "2026-07-27T08:06:10.000Z",
  "generation_parameters": {},
  "payload": {}
}
```

Failure callback:

```json
{
  "event": "fci.generation.failed",
  "contract_version": "1.0",
  "generation_job_id": 123,
  "fci_set_id": 45,
  "fci_module_id": 67,
  "appel_offre_id": 89,
  "code_interne": "AO-20260727-0001",
  "module_code": "A",
  "correlation_id": "corr_...",
  "execution_id": "456",
  "status": "failed",
  "provider": "gemini",
  "model": "gemini-3.6-flash",
  "prompt_version": "1.0",
  "schema_version": "1.0",
  "source_fiche": {
    "version": "validated:2026-07-27T08:00:00.000Z",
    "hash": "sha256..."
  },
  "generated_at": "2026-07-27T08:06:10.000Z",
  "generation_parameters": {},
  "error": {
    "code": "AI_SCHEMA_VALIDATION_FAILED",
    "message": "Safe message",
    "stage": "schema_validation",
    "retryable": true
  }
}
```

## Callback authentication

The FCI callback route reuses the proven CDC callback auth pattern:

- `Authorization: Bearer <FCI_CALLBACK_BEARER_TOKEN>`
- `X-Contract-Version: <FCI_N8N_CONTRACT_VERSION>`
- `X-Callback-Timestamp: <ISO timestamp>`
- `X-Callback-Signature: sha256=<hex>`

Signature input:

```text
<timestamp>.<raw request body>
```

Digest:

- HMAC-SHA256
- hex output
- constant-time comparison in Concept

## Idempotency

Concept computes a callback idempotency key from:

- `generation_job_id`
- `correlation_id`
- `execution_id`
- `status`
- `event`

Behavior:

- first identical callback: persisted
- repeated identical callback: `200` with `idempotent=true`
- conflicting duplicate: `409 CALLBACK_CONFLICT`

## Status transitions

Typical path:

- `not_started -> generating -> needs_review -> validated`

Regeneration:

- `validated -> generating -> needs_review` on success
- `validated -> generating -> validated` on failure

Initial failure with no previous data:

- module returns to `not_started`
- latest job becomes `failed`
- module error fields remain populated for the UI

## Database mappings

`public.fci_generation_jobs` now stores:

- `contract_version`
- `schema_version`
- `prompt_version`
- `generation_parameters`
- `source_fiche_version`
- `source_fiche_hash`
- `callback_received_at`
- `execution_id`
- `correlation_id`

`public.fci_module_data` stores:

- full validated AI envelope in `data_json`
- source snapshot in `source_summary_json`
- summary/confidence snapshot in `confidence_json`
- AI notes and warnings in `ai_notes_json`
- exact source traceability in `generated_from_fiche_version` and `generated_from_fiche_hash`

## Environment variables

Next.js / Concept:

- `FCI_N8N_WEBHOOK_URL`
- `FCI_N8N_WEBHOOK_TOKEN`
- `FCI_CALLBACK_BEARER_TOKEN`
- `FCI_CALLBACK_HMAC_SECRET`
- `FCI_CALLBACK_MAX_AGE_SECONDS`
- `FCI_GENERATION_PROVIDER`
- `FCI_GENERATION_MODEL`
- `PLATFORM_PUBLIC_BASE_URL`

n8n runtime:

- `FCI_N8N_WEBHOOK_TOKEN`
- `FCI_N8N_CONTRACT_VERSION`
- `FCI_CALLBACK_BEARER_TOKEN`
- `FCI_GENERATION_MODEL`
- `GEMINI_API_KEY`
- `FCI_CALLBACK_SIGNER_URL`

signer runtime:

- `FCI_CALLBACK_HMAC_SECRET`

The local helper `scripts/n8n-tests/test_callback_capture_server.py` now accepts
the FCI-specific callback secret and bearer token first, while still falling back
to the older canonical CDC names when needed.

## Workflow export

Repository export path:

- `n8n/workflows/fci-module-generation.json`

Generation script:

- `node scripts/build-fci-workflow-export.mjs`

Timestamped backup path:

- `tmp/n8n-workflow-backups/fci-module-generation_export_<timestamp>.json`

Recommended workflow name:

- `FCI Module Generation - Gemini JSON`

## Local test procedure

1. ensure PostgreSQL is reachable
2. run `npm.cmd run db:setup`
3. run `node scripts/build-fci-workflow-export.mjs`
4. configure the FCI environment variables in Concept, n8n, and the signer runtime
5. import the dedicated FCI workflow in n8n as inactive
6. verify the webhook path is `POST /webhook/fci-module-generation`
7. activate the workflow only after checking launch auth, validation, and callback signing
8. trigger `POST /api/appels-offres/[code]/fci/A/generate`
9. confirm one signed callback hits `POST /api/fci/callbacks/n8n`
10. confirm one new `fci_module_data` version is created

## Rollback

1. deactivate the dedicated FCI workflow
2. restore the previous workflow export or n8n backup
3. remove the new FCI env vars if needed
4. if required, roll back only the additive Phase 4 columns via SQL after data review

## Production checklist

- FCI workflow uses its own webhook URL
- FCI workflow does not call Marker or the CDC callback route
- Gemini key exists in n8n runtime only
- callback signer is configured
- `FCI_CALLBACK_BEARER_TOKEN` matches between n8n and Concept
- `FCI_CALLBACK_HMAC_SECRET` matches between n8n and Concept
- `FCI_GENERATION_MODEL` matches the activated Gemini model
