# First controlled W2 local-AI shadow integration

Implementation date: 2026-08-11. Published workflow: `cdcExtractionV1` / `CONCEPT - CDC Extraction`. Gemini remains the default and authoritative provider.

## A. Existing W2 architecture

The published W2 contract is:

1. Validate bearer token, contract version, launch fields, and `Idempotency-Key`.
2. Verify `markdown_path` is exactly `{N8N_SHARED_STORAGE_ROOT}/{code_interne}/cdc.md`.
3. Read persisted Markdown and verify its byte size and SHA-256.
4. Send the complete Markdown to `gemini-3.6-flash` through Google's OpenAI-compatible endpoint.
5. Strip optional fences from Gemini's XML.
6. Validate the canonical Fiche structure: root, 34 extraction fields with `source`, three evaluation fields with `note`/justification, and three control fields.
7. Construct one canonical terminal callback, ask the existing signer for HMAC-SHA256, and POST it with the existing bearer/version/timestamp/signature headers.
8. CONCEPT verifies callback authentication and contract shape, matches job/correlation/execution/tender identity, rejects duplicate/late callbacks, parses and reserializes XML, then persists Markdown/XML/status and updates the job, tender status, and audit log.

## B. Integration point selected

The local comparison is inserted only after Markdown integrity and Gemini XML validation. This ensures the shadow request uses the same persisted artifact and never runs on an invalid authoritative result.

`gemini` bypasses the local service. `shadow` calls the service, logs the comparison, and then explicitly restores `Validate Success Payload` as the input to the unchanged Gemini success callback. Local HTTP errors use n8n's `continueRegularOutput`, so Gemini still completes.

`local` is recognized but routes to the existing signed failure callback with `LOCAL_CANONICAL_CONTRACT_NOT_READY`. This is intentional: the validated local result covers eight identification fields, while the authoritative XML requires 34 extraction fields plus evaluation/control.

## C. Files changed

- `services/local-rag/server.py`
- `services/local-rag/test_server.py`
- `services/local-rag/README.md`
- `n8n/workflows/concept-cdc-extraction.json`
- `scripts/n8n/patch-cdc-local-ai-shadow.mjs`
- `scripts/verify-cdc-local-ai-shadow.mjs`
- `env.example`
- `docs/env-variables.md`
- `docs/CDC_LOCAL_AI_SHADOW_INTEGRATION_REPORT.md`

The live n8n workflow record was backed up to `/tmp/cdcExtractionV1-before-local-shadow.json`, imported, published, and reactivated. It is active with 29 nodes and version `8b124ce5-59e1-49eb-a54a-2e0281ffac1d`. n8n was stopped during publication, so the definition will load on its next normal start.

## D. Local RAG service architecture

The dedicated loopback Python service is separate from Docling:

```text
W2 shadow request
  → authenticated local service
  → persisted-path/hash/tender metadata verification
  → deterministic chunks + structural metadata
  → qwen3-embedding:0.6b
  → isolated Qdrant collection
  → tender-scoped BM25
  → RRF + deterministic reranking
  → field-aware top-2 snippets
  → qwen3:14b
  → grounding/shape validation
  → at most one correction
  → structured candidate + comparison telemetry
```

The service uses a process lock for extraction, binds to `127.0.0.1` by default, and accepts a maximum 2 MiB JSON request. It does not parse PDFs or write business state.

## E. Feature flags/configuration

`CDC_AI_PROVIDER` supports:

- `gemini` — default; the former behavior is preserved.
- `shadow` — Gemini remains authoritative; local comparison is non-authoritative.
- `local` — currently fails closed through the canonical W2 failure callback.

Unknown values also fail safely through the canonical failure callback. `.env.local` was not changed, so this installation still defaults to Gemini.

Additional configuration:

- `LOCAL_RAG_SERVICE_URL=http://127.0.0.1:8091`
- `LOCAL_RAG_SERVICE_TOKEN` — dedicated bearer token
- `LOCAL_RAG_CONTRACT_VERSION=local-cdc-shadow.v1`
- `LOCAL_RAG_SHADOW_LOG_DIR=/tmp/concept-local-rag-shadow`

## F. Local structured contract

`local-cdc-shadow.v1` returns provider/model metadata, exact tender/document/hash identity, latency metrics, and these eight validated field objects:

```json
{
  "value": "...",
  "supported": true,
  "source_chunks": ["chunk_X"],
  "validation_passed": true,
  "correction_required": false
}
```

Every non-null value must be present in cited supplied evidence. Identifiers, dates, complete duration equivalence, placeholder rejection, and source membership are deterministically checked. Any remaining invalid field fails the local request closed.

## G. XML compatibility strategy

The shadow comparator maps only validated local fields to their existing canonical XML peers:

- `official_reference` → `reference_officielle`
- `client` → `client_maitre_ouvrage`
- `country` → `pays`
- `issue_date` → `date_emission`
- `credit_number` → `credit_financement`
- `selection_method` → `methode_selection`
- `mission_duration` → `duree_totale`
- `financed_project` → `projet_rattachement`

It does not invent a second Fiche format or serialize partial data into authoritative XML. Local-only mode remains blocked until the service validates all canonical extraction, evaluation, and control fields and its output can pass the existing XML parser/serializer unchanged.

## H. Shadow-mode behavior

Gemini XML remains the only callback result. The local candidate cannot change Fiche status, dossier status, persistence, notifications, or downstream actions.

Telemetry is JSONL under the configured non-business directory. Records include job/correlation/tender identity, local evidence and metrics, missing values, and disagreements. The pair `(processing_job_id, correlation_id)` is idempotent: the replay test returned `duplicate` and the file remained one line.

If the service is unavailable, n8n logs `cdc_local_ai_shadow` with `shadow_ok=false` and continues with the already validated Gemini result.

## I. Tender isolation result

Passed:

- real extraction required `appel_offre_id=1812`, `code_interne=AO-20260810-0958`, `document_id=1759`, exact persisted path, and exact SHA-256;
- mismatched `document_id=999` returned HTTP 409 `TENDER_DOCUMENT_MISMATCH`;
- invalid evidence hash returned HTTP 409 `MARKDOWN_INTEGRITY_MISMATCH`;
- dense and BM25 corpora contain only the resolved tender, with no unfiltered fallback.

## J. Gemini regression result

`npm run test:gemini` passed:

- model list: HTTP 200;
- `gemini-3.6-flash` native generation: HTTP 200 / `OK`;
- OpenAI-compatible generation used by W2: HTTP 200 / `OK`.

The structural W2 verifier confirms `gemini` remains the default and follows the existing Gemini → XML validation → signed callback path.

## K. Local AI result

Real extraction for `AO-20260810-0958` returned all eight fields with grounding validation passed and no correction required. Final measured service request:

- 207 chunks;
- embedding dimension 1,024;
- local validation passed;
- unsupported claims 0.

## L. Gemini versus local comparison

The final shadow comparison used the existing persisted Gemini `fiche.xml`, not a new business-state launch:

- agreements: 8/8;
- disagreements: 0;
- missing compared fields: 0;
- local persisted: false;
- Gemini authoritative: true.

The comparator accepts normalized subset/wording equivalents but treats transposed dates as different. For example, Gemini's longer client string contains the same UC-PARU value, and both SFQC wording variants agree; `06/08/2024` cannot agree with `08/06/2024`.

## M. Performance comparison

The final local shadow request took 11.46 seconds:

- embeddings: 6.39 s;
- retrieval: 0.78 s total across eight fields;
- generation: 3.62 s;
- remaining indexing/validation/service overhead: approximately 0.67 s.

Recent successful full W2 Gemini executions in n8n took approximately 25.8–29.8 seconds end-to-end. The current safest shadow baseline runs local comparison after Gemini validation, so enabling shadow adds about 11.5 seconds before callback. Parallelization was deliberately deferred because correctness and authoritative-path isolation take priority.

## N. Failure/fallback behavior

- Shadow + Ollama/Qdrant/service failure: Gemini continues; local failure is logged, never persisted.
- Local mode failure or current full-contract gap: canonical signed W2 failure; no silent Gemini fallback.
- Unknown provider: canonical signed failure.
- Invalid/missing evidence or metadata mismatch: local HTTP 409/422; fail closed.
- One correction maximum after validation failure.
- No dependency was stopped to simulate outages. Unit tests injected Ollama and Qdrant unavailability, and the workflow structural test proves shadow HTTP errors continue only into the authoritative Gemini success payload.

## O. Security/idempotency result

- Dedicated bearer token; no reuse of launch/callback credentials.
- Loopback bind by default.
- Exact path, SHA-256, tender ID, code, and document ID verification against PostgreSQL.
- Separate per-tender/hash Qdrant collection and tender-only BM25 corpus.
- Existing signed callback authentication, contract version, job/correlation/execution checks, stale-attempt handling, duplicate callback handling, and validated-Fiche overwrite protection are unchanged.
- Shadow telemetry replay is idempotent and contains no business-state mutation.

Tests passed:

- 7 local-service unit tests;
- local service health and authentication;
- real local extraction;
- real shadow comparison;
- metadata/hash negative tests;
- replay/duplicate telemetry;
- workflow graph/safety verifier;
- `verify:platform-n8n-contract`;
- `npm run typecheck`;
- `npm run build:prod`;
- `git diff --check`.

## P. Is controlled local-only W2 testing safe?

**No—not yet.** Controlled shadow testing is safe and implemented. Local-only W2 testing is deliberately blocked because the proven local contract covers eight fields, not the entire canonical 34-field extraction plus evaluation/control schema.

## Q. Remaining blockers

1. Extend and benchmark local extraction for all remaining canonical XML fields.
2. Define evidence-backed evaluation/control rules and validate their notes/justifications.
3. Convert the full local result through the existing Fiche serializer and pass the unchanged canonical XML validator.
4. Run shadow mode across multiple representative tenders and layouts.
5. Add a supervised service process definition and retention policy for telemetry.
6. Reduce shadow latency, preferably by parallel local extraction with a safe join after Gemini validation.
7. Execute an explicitly authorized live n8n shadow launch/callback test in a disposable/non-business tender environment. This task avoided such a launch because it would mutate processing and Fiche business state.

## R. Exact rollback procedure

The rollback is recoverable and does not require database/schema changes:

```bash
n8n import:workflow --input=/tmp/cdcExtractionV1-before-local-shadow.json
n8n publish:workflow --id=cdcExtractionV1
n8n update:workflow --id=cdcExtractionV1 --active=true
```

Then restart n8n if it is running, unset `CDC_AI_PROVIDER`, `LOCAL_RAG_SERVICE_URL`, `LOCAL_RAG_SERVICE_TOKEN`, and `LOCAL_RAG_CONTRACT_VERSION`, and stop the local service. Gemini becomes the sole path. Shadow logs under `/tmp/concept-local-rag-shadow*` are non-business telemetry and may be removed separately according to local retention policy.

No commit or push was performed.
