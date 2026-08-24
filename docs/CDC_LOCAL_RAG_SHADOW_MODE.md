# CDC local RAG controlled shadow mode

## A. Purpose

Run the validated local Qwen/RAG extraction beside the existing Gemini CDC extraction, solely to collect technical comparison evidence. Shadow output is never an official Fiche CDC source.

## B. Architecture

The active n8n CDC flow remains PDF → Marker/Docling → persisted `data/<code>/cdc.md` → Gemini → canonical callback. The callback first validates and persists Gemini XML, completes the processing job, and moves the tender to `fiche_a_valider`. A Next.js `after()` task then calls the loopback local-RAG `/v1/shadow` endpoint. The endpoint independently validates identity, extracts, validates canonical XML, compares 34 fields, and writes technical telemetry.

## C. Why Gemini remains authoritative

`finalizeProcessingSuccess` receives only normalized Gemini XML from the signed n8n callback. The shadow module has no Fiche write, validation, FCI, Go/No-Go, DG, notification, or business-audit dependency. Its artifact explicitly records `authoritative_provider: gemini`, `authoritative_persisted: true`, and `official_state_mutated_by_shadow: false`.

## D. Feature flag

`CDC_AI_PROVIDER=shadow` is the central authorization. `LOCAL_RAG_SHADOW_ENABLED=true` remains backward compatible only when `CDC_AI_PROVIDER` is unset. `CONFIDENTIAL_MODE=true` always overrides both and disables the shadow path. Disabled mode performs no local request.

Configuration:

- `LOCAL_RAG_SERVICE_URL=http://127.0.0.1:8091`
- `LOCAL_RAG_SERVICE_TOKEN=<local secret>`
- `LOCAL_RAG_CONTRACT_VERSION=local-cdc-shadow.v1`
- `LOCAL_RAG_SHADOW_TIMEOUT_MS=120000`

## E. Trigger point

The trigger is registered by `app/api/fiche/callbacks/n8n/route.ts` only for a newly applied successful canonical callback. It runs after the response lifecycle through Next.js `after()`. Duplicate, stale, failed, protected, or inapplicable callbacks do not schedule a shadow run.

## F. Local RAG request identity

The request contains exact numeric `appel_offre_id`, `code_interne`, numeric Markdown `document_id`, canonical persisted Markdown path, SHA-256, processing job, correlation ID, contract version, and the already-persisted Gemini XML. The Python service re-resolves all tender/document metadata from PostgreSQL and rejects path, hash, tender, document, or contract mismatches.

## G. Persistence mechanism

No database schema was added. The Python service retains its existing machine-local JSONL log. Next.js additionally writes one atomic technical artifact at `data/<code>/shadow/local-rag-<document-id>-<sha256>.json`. `data/*` is already Git-ignored. Official `fiche.xml`, `status.json`, database Fiche rows, processing jobs, audit history, workflow state, FCI, Go/No-Go and notifications are not shadow persistence targets.

## H. Comparison semantics

Every canonical extraction field has `field_name`, `gemini_value`, `local_value`, citations, and one conservative status: `EXACT_MATCH`, `NORMALIZED_MATCH`, `DIFFERENT`, `GEMINI_ONLY`, `LOCAL_ONLY`, or `BOTH_NULL`. Summary counts always total 34. Gemini is labelled authoritative, not ground truth. Normalization is limited to the established comparison logic and does not erase meaningful numeric/date differences.

## I. Failure behavior

Statuses are `SUCCESS`, `VALIDATION_FAILED`, `TIMEOUT`, `SERVICE_UNAVAILABLE`, and `ERROR`. HTTP 422 maps to validation failure. Abort maps to timeout; connection failures map to unavailable. These outcomes are persisted as technical artifacts and never thrown into an already successful official callback.

## J. Idempotency

The key is the exact `(appel_offre_id, document_id, document_hash)` tuple. The post-response trigger also requires `applied: true`, so duplicate canonical callbacks cannot schedule a second run. An exclusive lock plus the final deterministic artifact name prevents concurrent duplicate local jobs; the Python JSONL layer retains its processing-job/correlation idempotency check.

## K. Tender isolation

The local service verifies database ownership, path, SHA-256, code and IDs. Qdrant collections contain tender ID and hash, dense queries use exact tender/code filters, and BM25 is built from only that tender. There is no unfiltered fallback.

## L. Timeout behavior

The default timeout is 120 seconds, above the measured 45–76 second range while still bounded. It is configurable with a positive millisecond value. Timeout affects only the shadow artifact.

## M. Tests

Tests cover disabled behavior, successful separate storage, timeout, 422, unavailable service, identity payload, absence of mutation controls, 34-field status accounting, idempotency keys, and cross-tender collection identity. Existing callback idempotency ensures duplicate callbacks return `applied: false`.

## N. How to enable shadow mode locally

Start Ollama, Qdrant, PostgreSQL, and the local service using `.venv-rag/bin/python services/local-rag/server.py`. Set a shared local service token, `CONFIDENTIAL_MODE=false`, and `CDC_AI_PROVIDER=shadow`, then restart Next.js so server-side configuration is reloaded. Gemini remains authoritative in shadow mode.

## O. How to disable it immediately

Set `CDC_AI_PROVIDER=gemini` and `LOCAL_RAG_SHADOW_ENABLED=false`, then restart Next.js. The next official callback will not make a local-RAG request. Stopping the local service is also safe for the official workflow.

## P. Known limitations

This first integration uses machine-local files rather than a queryable database table and has no UI. `after()` is process-local; a hard process termination can lose an unstarted or unfinished shadow task, which is acceptable for observation but would require a durable technical queue for guaranteed execution. Artifacts contain tender-derived values and must remain local and access-controlled.

## Q. Exit criteria for moving beyond shadow mode

Remain in shadow mode until several structurally different blind tenders show stable, grounded results; operational telemetry shows acceptable timeout/failure rates; retention/access rules are approved; and a separately reviewed design provides durable execution. Any proposal to influence official Fiches or workflow decisions requires a new explicit authorization and safety review.
