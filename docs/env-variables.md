# Environment Variables

## Next.js app

- `DATABASE_URL`
  PostgreSQL connection string used for the synced fiche index.

- `N8N_WEBHOOK_URL`
  Webhook URL used by `POST /api/generate` to start the CDC pipeline.

- `N8N_WEBHOOK_TOKEN`
  Optional bearer token sent to the n8n start webhook when required.

- `N8N_COMPLETE_SECRET`
  Shared secret required by `POST /api/fiche/[code]/complete`.
  The Next.js app reads it from `process.env.N8N_COMPLETE_SECRET` and expects the same value in the `X-Complete-Secret` header sent by n8n.

## n8n workflow

- `N8N_COMPLETE_SECRET`
  Must match the Next.js value so the workflow can call the completion callback successfully.
