# Environment Variables

## Platform (Next.js)

- `DATABASE_URL`
  PostgreSQL connection string used by the Appels d'offres repository, processing jobs, documents, and audit logs.

- `N8N_WEBHOOK_URL`
  Canonical n8n launch webhook used by `POST /api/appels-offres/[code]/analyse` and the compatibility route `POST /api/generate`.

- `N8N_WEBHOOK_TOKEN`
  Bearer token sent by the platform when launching a canonical analysis request to n8n.

- `PLATFORM_CALLBACK_TOKEN`
  Bearer token that n8n must send back to `POST /api/fiche/callbacks/n8n`.

- `N8N_CALLBACK_SECRET`
  Shared HMAC secret used to verify `X-Callback-Signature` on the canonical n8n callback route.

- `PLATFORM_PUBLIC_BASE_URL`
  Public base URL used by the platform to generate the canonical callback URL shared with n8n.

- `N8N_CONTRACT_VERSION`
  Contract version enforced on both launch and callback exchanges. Defaults to `1.0`.

- `N8N_LAUNCH_TIMEOUT_MS`
  Maximum wait time for the immediate `202 Accepted` response from n8n. Defaults to `10000`.

- `MAX_CDC_UPLOAD_BYTES`
  Maximum accepted CDC PDF size in bytes. Defaults to `52428800` (50 MB).

- `PROCESSING_JOB_TIMEOUT_MINUTES`
  Maximum time a `processing_jobs` row may stay in `created`/`queued`/`running`/`retrying`
  before it is treated as stale. Checked lazily on read (`listAppelsOffres`,
  `getAppelOffresDetailByCode` in `lib/appels-offres/repository.ts`), not by a background
  worker. A stale job is marked `failed` (`error_stage: callback`, `error_code:
  PROCESSING_JOB_TIMEOUT`) and its tender's `business_status` moves from
  `analyse_en_cours` to `erreur` ("A verifier"), unblocking a normal retry. Defaults to `15`.

## Cross-process contract

- `N8N_WEBHOOK_TOKEN`
  Must match between the Next.js process and the active n8n workflow launch validator.

- `N8N_CONTRACT_VERSION`
  Must match between the Next.js launch sender, the active n8n workflow, and the Next.js callback receiver.

- `PLATFORM_CALLBACK_TOKEN`
  Must match between the Next.js callback receiver and the n8n runtime callback sender.

- `N8N_CALLBACK_SECRET`
  Must match between the Next.js callback receiver and the callback signer used by n8n.

## Legacy compatibility

- `N8N_COMPLETE_SECRET`
  Compatibility secret still accepted by `POST /api/fiche/[code]/complete`.
  This is no longer part of the canonical contract and should only be kept while the old n8n callback route remains in use.

## n8n-side reminder

- `GEMINI_API_KEY`
  Required by the n8n workflow provider configuration, not by the Next.js platform.

- `N8N_SHARED_STORAGE_ROOT`
  Must point to the same logical data root that Next.js uses for `pdf_path`.
  In a standard local checkout this is the repository `data/` directory exposed
  as an absolute path, for example `<repo-root>\data`.

- `MARKER_CONVERT_URL`
- `MARKER_STATUS_URL`
- `MARKER_RESULT_URL`
- `N8N_CALLBACK_SIGNER_URL`
  These are runtime-only n8n values. See `docs/n8n-canonical-contract-env.md` for the
  verified local values, startup order, and safe PowerShell block.

## Controlled local CDC AI shadow

- `CDC_AI_PROVIDER`
  CDC extraction provider selector consumed by W2. Supported values are `gemini`, `shadow`,
  and `local`. It defaults to `gemini`. `shadow` keeps Gemini authoritative and records a
  local comparison. `local` currently fails closed because the validated local contract
  covers eight identification fields rather than the entire canonical Fiche XML.

- `LOCAL_RAG_SERVICE_URL`
  Loopback URL for the dedicated local semantic extraction service. Defaults operationally
  to `http://127.0.0.1:8091` when configured in n8n.

- `LOCAL_RAG_SERVICE_TOKEN`
  Dedicated bearer token shared only by n8n and the local RAG service. It must not reuse a
  callback or launch token.

- `LOCAL_RAG_CONTRACT_VERSION`
  Local structured-result contract. The first shadow integration requires
  `local-cdc-shadow.v1`.

- `LOCAL_RAG_SHADOW_LOG_DIR`
  Non-business JSONL telemetry directory used by the local service. Defaults to
  `/tmp/concept-local-rag-shadow`; it must not point into a tender data directory.
