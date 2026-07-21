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
