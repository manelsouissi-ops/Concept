# Concept - CDC Initiation and Fiche Project Workflow

Concept is a Next.js + TypeScript application for launching and reviewing CDC processing jobs.

The current implementation focuses on:
- Uploading a CDC PDF with an internal code (`code_interne`)
- Triggering an asynchronous n8n workflow
- Receiving completion callbacks with generated XML + Markdown
- Reviewing/editing/validating the resulting fiche
- Keeping a synced index in PostgreSQL

## Tech Stack

- Next.js 15
- React 19
- TypeScript 5
- Node.js (recommended: 20+)
- PostgreSQL (via `pg`)
- XML parsing/serialization via `fast-xml-parser`
- PDF rendering via `pdfjs-dist`
- n8n webhook orchestration (external)

## Current Scope (What Exists)

Implemented:
- Initiation form (`/initiation`) for uploading PDF + code
- Generation endpoint (`POST /api/generate`) to create processing bundle and call n8n
- Fiche editor page (`/fiche/[code]`) with:
  - status polling
  - XML-backed editable fields
  - Markdown source panel
  - embedded PDF viewer
- Completion callback endpoint (`POST /api/fiche/[code]/complete`)
- Validation endpoint (`POST /api/fiche/[code]/validate`)
- Local file-based fiche storage under `data/`
- PostgreSQL sync/index scripts and helpers

Not implemented yet:
- Authentication/authorization
- Opportunity management module
- Full audit trail/user model
- Automated test suite

## Repository Structure

```text
app/
  initiation/page.tsx                # Upload and start workflow
  fiche/[code]/page.tsx              # Review/edit fiche
  api/generate/route.ts              # Start async pipeline
  api/fiche/[code]/...               # Fiche CRUD/status/validate/complete/pdf

components/
  initiation-form.tsx                # Frontend upload form
  fiche-editor.tsx                   # Main review/editor UI

lib/
  storage.ts                         # Disk storage for bundle files
  fiche-xml.ts                       # XML parse/serialize and mapping
  db.ts                              # Postgres sync/index helper layer
  types.ts                           # Shared types

data/
  <code>/status.json                 # Processing state
  <code>/fiche.xml                   # Generated/edited fiche XML
  <code>/cdc.md                      # Extracted markdown
  <code>/cdc.pdf                     # Uploaded CDC PDF

scripts/
  setup-fiche-index.ts               # Create/setup Postgres index schema
  backfill-fiches-to-postgres.ts     # Backfill data/* to Postgres index
  *.py                               # n8n maintenance/migration helper scripts
```

## Processing Flow

1. User uploads `code_interne` + CDC PDF on `/initiation`.
2. `POST /api/generate`:
   - writes `data/<code>/status.json` as `processing`
   - stores `data/<code>/cdc.pdf`
   - calls n8n webhook (`N8N_WEBHOOK_URL`)
3. UI redirects to `/fiche/<code>` and polls status.
4. n8n pipeline processes the CDC externally (Marker/Groq chain).
5. n8n calls `POST /api/fiche/<code>/complete` with:
   - success payload: XML + Markdown (+ optional executionId)
   - or error payload
6. App stores outputs (`fiche.xml`, `cdc.md`) and flips status to `draft` or `error`.
7. User edits fiche and validates it.

## API Overview

- `POST /api/generate`
  - multipart form-data: `code_interne`, `file`
  - compatibility route; launches analysis via the canonical n8n contract
- `POST /api/appels-offres/[code]/analyse`
  - canonical route that launches analysis for an existing appel d'offres
- `GET /api/fiche/[code]/status`
  - returns current processing state
- `GET /api/fiche/[code]`
  - returns parsed fiche for editing
- `PUT /api/fiche/[code]`
  - saves edited fiche XML
- `POST /api/fiche/[code]/validate`
  - validates fiche and updates status
- `POST /api/fiche/callbacks/n8n`
  - canonical n8n callback endpoint (bearer token + HMAC signature)
- `POST /api/fiche/[code]/complete`
  - legacy callback endpoint (shared secret header only); not called by the
    current n8n workflow, kept for backward compatibility only
- `GET /api/fiche/[code]/pdf`
  - streams stored CDC PDF

## Environment Variables

See `docs/env-variables.md` for the canonical reference (kept in sync with
`lib/integrations/n8n-config.ts`) and `.env.example` for a fillable template.

Required for app:
- `DATABASE_URL` - PostgreSQL connection string
- `N8N_WEBHOOK_URL` - canonical n8n launch webhook
- `N8N_WEBHOOK_TOKEN` - bearer token sent to the n8n launch webhook
- `PLATFORM_CALLBACK_TOKEN` - bearer token n8n must send back on the canonical callback
- `N8N_CALLBACK_SECRET` - HMAC secret verifying the canonical callback signature
- `PLATFORM_PUBLIC_BASE_URL` - base URL used to build the canonical callback URL for n8n

Optional (have defaults):
- `N8N_CONTRACT_VERSION` - defaults to `1.0`
- `N8N_LAUNCH_TIMEOUT_MS` - defaults to `10000`
- `MAX_CDC_UPLOAD_BYTES` - defaults to `52428800` (50 MB)

Legacy/optional:
- `N8N_COMPLETE_SECRET` - shared secret for the legacy `/api/fiche/[code]/complete`
  callback only; not part of the canonical contract and not used by the current
  n8n workflow

n8n side (set in the n8n process environment, not in this app's `.env.local`):
- `N8N_WEBHOOK_TOKEN`, `N8N_CONTRACT_VERSION`, `PLATFORM_CALLBACK_TOKEN`,
  `N8N_CALLBACK_SECRET`, `N8N_SHARED_STORAGE_ROOT`, `MARKER_CONVERT_URL`,
  `MARKER_STATUS_URL`, `MARKER_RESULT_URL`, `GEMINI_API_KEY` - see
  `docs/n8n-canonical-contract-env.md`

## Local Development

Install dependencies:

```bash
npm install
```

Run dev server:

```bash
npm run dev
```

Type check:

```bash
npm run typecheck
```

Production build and start:

```bash
npm run build:prod
npm run start:prod
```

### Postgres Index Setup

Create/setup index schema:

```bash
npm run db:setup
```

Backfill existing `data/` bundles to Postgres:

```bash
npm run db:backfill
```

## Data and State Notes

- The app currently uses `data/<code>/` on disk as the primary fiche state.
- PostgreSQL acts as a synced index layer, not the single source of truth.
- n8n workflow executions live outside this app (n8n runtime + its own DB).

## Operational Notes

- Async robustness depends on n8n callback reliability.
- If a job is stuck in `processing`, inspect:
  - n8n execution logs
  - callback secret/header correctness
  - webhook URL/token configuration
- Regeneration may overwrite draft artifacts depending on status and user confirmation.

## Security Notes

- There is no built-in auth yet; treat this as internal/prototype.
- The canonical callback (`/api/fiche/callbacks/n8n`) is protected by a bearer
  token (`PLATFORM_CALLBACK_TOKEN`) plus an HMAC signature over the request
  body (`N8N_CALLBACK_SECRET`) - set both, matching, in this app's env and in
  the n8n runtime env.
- The legacy callback (`/api/fiche/[code]/complete`) is protected only by a
  shared secret header (`N8N_COMPLETE_SECRET`); keep it set only if that route
  is still in use.
- Do not commit real secrets into source control.

## Key Docs

- `PROJECT_AUDIT.md` - deep technical audit and gap analysis
- `docs/env-variables.md` - environment variable definitions
- `docs/incidents.md` - incident/ops notes

## License

No license file is currently defined in this repository.
