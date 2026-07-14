# 1. Executive Summary

The repository currently contains a focused Next.js prototype for CDC initiation and Fiche CDC review, plus a real n8n workflow integration, a disk-based storage model, and a PostgreSQL sync layer. The strongest implemented part is the Fiche CDC review/edit/validation experience: the XML schema is parsed and serialized consistently in the app, the review page is substantial, validation is blocked on unresolved Contrôle items, and the stored PDF/Markdown/XML can be surfaced in the UI.

What already works in code is narrower than the long-term platform vision. There is no opportunity management module, no authentication, no business user model, no audit-log model, no dashboard, no admin area, no employee/CV system, and no FCI generation UI. The current app is essentially a CDC upload and Fiche review tool, not yet a full “Plateforme de Gestion Intelligente des Appels d’Offres”.

The largest blockers to a stable MVP are:

- the end-to-end asynchronous Next.js ↔ n8n pipeline is still operationally unstable;
- business state is split between disk, PostgreSQL, and n8n’s internal SQLite;
- the app has no authentication or authorization at all;
- there is no first-class opportunity / processing job / audit trail data model in the application database.

Immediate priority: stabilize the async processing contract and persistence model before adding new features. In practice that means making one authoritative job state model, fixing the n8n completion path, and ensuring every started CDC either completes, errors, or times out deterministically.

# 2. Current Architecture

## Actual components

- Next.js app
  - Frontend pages and UI under `app/` and `components/`
  - Application API routes under `app/api/`
- File storage
  - Stored under `data/{code}/` via `lib/storage.ts`
- XML parsing/serialization
  - Implemented in `lib/fiche-xml.ts` with `fast-xml-parser`
- PostgreSQL sync/index layer
  - Implemented in `lib/db.ts`
  - Backfill/setup scripts in `scripts/setup-fiche-index.ts`, `scripts/backfill-fiches-to-postgres.ts`
- n8n orchestration
  - Not defined in repo as application code
  - Managed through direct SQLite edits and scripts under `scripts/`
  - Live workflow state exists in `C:\Users\lotfi\.n8n\database.sqlite`
- PDF rendering in frontend
  - `pdfjs-dist` assets copied under `public/pdfjs/`

## Not present in the repo

- No FastAPI service code
- No Marker server code
- No Ollama service code
- No Docker / Compose / deployment manifests
- No ORM or migration framework
- No auth system
- No test suite

## Text architecture diagram

```text
Browser
  -> Next.js pages
    -> /initiation
    -> /fiche/[code]

Next.js API
  -> POST /api/generate
       -> writes data/{code}/cdc.pdf + status.json
       -> POST multipart/form-data to n8n webhook
  -> GET /api/fiche/[code]/status
       -> reads status.json
  -> POST /api/fiche/[code]/complete
       -> accepts n8n callback
       -> validates XML
       -> writes fiche.xml + cdc.md + status.json
  -> GET/PUT /api/fiche/[code]
       -> reads/writes fiche.xml via XML parser
  -> POST /api/fiche/[code]/validate
       -> marks status validated
  -> GET /api/fiche/[code]/pdf
       -> streams stored PDF

Disk storage (current source of truth for fiche state)
  -> data/{code}/cdc.pdf
  -> data/{code}/cdc.md
  -> data/{code}/fiche.xml
  -> data/{code}/status.json

PostgreSQL (secondary synced index)
  -> cdc_fiches.fiches_projet

n8n (external orchestrator, hidden from browser)
  -> webhook receives code_interne + PDF
  -> FastAPI Marker conversion
  -> polling loop
  -> Groq XML extraction
  -> callback POST to Next.js /api/fiche/{code}/complete
```

## Actual technologies used

- Next.js `^15.0.0` in `package.json`
- React `^19.0.0`
- TypeScript `^5.7.2`
- Node.js runtime observed locally: `v24.13.1`
- PostgreSQL via `pg ^8.22.0`
- XML via `fast-xml-parser ^4.5.1`
- PDF rendering via `pdfjs-dist ^6.1.200`
- n8n internal database: SQLite
- Python observed locally: `3.11.9`

## Comparison with intended architecture

- Matches intended:
  - Next.js + TypeScript
  - n8n orchestration
  - local file storage prototype
  - PostgreSQL plus pgvector-backed index table
- Partially matches:
  - async n8n handshake/callback pattern exists, but is unstable in practice
  - Groq and Marker are wired through n8n, but not present in this repo
- Missing from repo:
  - application-owned opportunity database model
  - auth/permissions
  - audit logs
  - application-owned processing_jobs table
  - employee/CV data model
  - semantic search UI/API

# 3. Implemented Features

| Area | Feature | Status | Evidence | Notes |
|---|---|---|---|---|
| Shell app | Home redirects to initiation | Working | `app/page.tsx` | Minimal shell only |
| UI | `/initiation` upload page | Working | `app/initiation/page.tsx`, `components/initiation-form.tsx` | Accepts code + PDF, no opportunity context |
| UI | `/fiche/[code]` review page | Working | `app/fiche/[code]/page.tsx`, `components/fiche-editor.tsx` | Main user-facing workflow |
| UI | Markdown source preview | Working | `components/fiche-editor.tsx` lines 727-767 | Collapsible, warns if missing |
| UI | PDF viewer | Working | `components/fiche-editor.tsx` lines 769-787 and 1095-1295 | Uses `pdfjs-dist` from `public/pdfjs/` |
| UI | Source badge jump to Markdown/PDF | Implemented but unverified | `components/fiche-editor.tsx` lines 199-276, 476-497 | Markdown search is heuristic; page jump only works if source text contains page refs |
| UI | Poll processing status | Working | `components/fiche-editor.tsx` lines 343-398 | Polls every 5 seconds |
| API | Start async generation | Partial | `app/api/generate/route.ts` | Writes processing bundle and calls n8n, but recent workflow runs remain unstable |
| API | Completion callback endpoint | Partial | `app/api/fiche/[code]/complete/route.ts` | Contract exists, shared secret exists, but live executions have recently failed to reach completion reliably |
| API | Save edited fiche | Working | `app/api/fiche/[code]/route.ts`, `lib/storage.ts` `writeFicheBundle` | Only allowed when status is `draft` |
| API | Validate fiche | Working | `app/api/fiche/[code]/validate/route.ts` | Blocks validation if Contrôle resolutions remain unresolved |
| API | Serve stored PDF | Working | `app/api/fiche/[code]/pdf/route.ts` | Unauthenticated |
| Storage | Disk-based CDC bundle | Working | `lib/storage.ts` | Current application source of truth |
| Storage | Atomic single-file writes | Working | `lib/storage.ts` `writeFileAtomic` | Per-file atomic, not multi-file transactional |
| Fiche CDC | XML parse/serialize | Working | `lib/fiche-xml.ts` | Strict schema handling plus extra `resolutions` extension |
| Fiche CDC | Contrôle resolution model | Working | `lib/fiche-xml.ts`, `lib/types.ts`, `components/fiche-editor.tsx` | Not part of supervisor’s original canonical XML contract |
| Regeneration | Block overwrite of validated fiche unless confirmed | Working | `app/api/generate/route.ts` | Also blocks modified draft unless confirmed |
| Regeneration | Retry from fiche page using stored PDF | Working | `components/fiche-editor.tsx` `retryGeneration`, `app/api/generate/route.ts` `resolvePdfFile` | Requires stored `cdc.pdf` |
| Postgres | Sync fiche index to `cdc_fiches.fiches_projet` | Working | `lib/db.ts` and route calls | Secondary index only, not source of truth |
| Postgres | One-time backfill script | Working | `scripts/backfill-fiches-to-postgres.ts` | Uses disk as source |
| Opportunity management | Opportunity creation/list/detail | Missing | No matching pages, APIs, or tables used by app | Long-term goal not implemented here |
| Auth | Login/session/role system | Missing | No auth libraries or middleware in repo | Major MVP gap for internal use |
| Audit trail | User-level edit history | Missing | No audit table, no user tracking | Status timestamps only |
| Tests | Unit/integration/E2E tests | Missing | No test files or test scripts | Transitive `@playwright/test` appears only in lockfile |
| FastAPI service | PDF conversion service code | Missing | Not present in repo | External dependency only |
| n8n fallback mocks | Mock fiche generation path | Broken / obsolete | `lib/mock-fiche.ts`, `lib/storage.ts` `createDraftBundle` | Dead code; current `/api/generate` no longer uses it |

# 4. End-to-End Workflow Audit

## Actual current flow

### Step 1. User lands on initiation page

- Input: browser request to `/initiation`
- Responsible component: `app/initiation/page.tsx`
- Output: upload form with code + PDF
- Persistence location: none
- Status: Working
- Detected issue: no opportunity context, no user identity, no roles

### Step 2. User submits code + PDF

- Input: `code_interne`, `file`
- Responsible component: `components/initiation-form.tsx`
- Output: `fetch("/api/generate", { method: "POST", body: FormData })`
- Persistence location: none yet
- Status: Working
- Detected issue: form still labels action “Generate”; there is no separate tracking page, only redirect to fiche page

### Step 3. Next.js creates processing bundle

- Input: multipart request
- Responsible component: `app/api/generate/route.ts`, `lib/storage.ts` `createProcessingBundle`
- Output:
  - writes `data/{code}/cdc.pdf`
  - writes `data/{code}/status.json` with `status = "processing"`
  - removes any existing `fiche.xml` and `cdc.md`
- Persistence location: disk
- Status: Partial
- Detected issues:
  - multi-file update is not transactional; `cdc.pdf`, `status.json`, deletion of XML/Markdown run in `Promise.all`
  - regenerate can wipe a previous draft’s XML/Markdown before n8n handshake succeeds
  - `createdAt` is reset on regeneration, so historical creation time is lost

### Step 4. Next.js requests n8n acceptance

- Input: stored `File` object + `code_interne`
- Responsible component: `app/api/generate/route.ts` `requestWebhookAcceptance`
- Output: POST to `N8N_WEBHOOK_URL` with multipart form-data:
  - `code_interne`
  - `file`
  - optional `Authorization: Bearer <N8N_WEBHOOK_TOKEN>`
- Persistence location: none
- Status: Implemented but unverified
- Detected issues:
  - app does not send a callback URL; n8n hardcodes the callback target
  - handshake timeout is 10 seconds, which is fine for async acceptance but fragile if n8n does not respond immediately
  - if handshake fails, route returns HTTP `202` with `{ status: "error" }` instead of a real error status

### Step 5. App records n8n execution ID if available

- Input: execution id parsed from response headers or JSON
- Responsible component: `app/api/generate/route.ts`, `lib/storage.ts` `updateProcessingExecutionId`
- Output: updates `status.json.n8nExecutionId`
- Persistence location: disk
- Status: Partial
- Detected issue: execution id is optional. If n8n does not return it, callback idempotency weakens because `/complete` then accepts any execution id while still processing.

### Step 6. Browser is redirected to fiche page

- Input: `202` response from `/api/generate`
- Responsible component: `components/initiation-form.tsx`
- Output: `router.push("/fiche/{code}")`
- Persistence location: none
- Status: Working
- Detected issue: because `/api/generate` returns `202` even on n8n contact failure, the UI still redirects to the fiche page for some failures

### Step 7. Fiche page polls status

- Input: `GET /api/fiche/{code}/status`
- Responsible component: `components/fiche-editor.tsx`
- Output:
  - if `processing`: show processing panel and poll every 5s
  - if `draft` / `validated`: fetch full fiche
  - if `error`: show retry UI
- Persistence location: none
- Status: Working
- Detected issue: there is no stale-job reconciler; stuck jobs remain in `processing` indefinitely

### Step 8. n8n processes CDC

- Input: webhook payload from app
- Responsible component: live workflow `f866bd39869c4c11` (“CDC Initiation - Fiche Projet XML”)
- Output:
  - Marker submission
  - Marker polling
  - markdown text
  - Groq XML extraction
  - callback POSTs to Next.js
- Persistence location:
  - n8n SQLite execution history
  - `.n8n-files` temporary files on local machine
- Status: Partial / unstable
- Detected issues:
  - active workflow contains disabled anonymization nodes still present in graph
  - hardcoded local service URLs and callback base URL
  - recent executions show `running`, `crashed`, `canceled`, `error`, and only some `success`
  - execution `174` completed “success” without reaching callback node, proving workflow-state success does not guarantee app-state success

### Step 9. n8n callback to Next.js

- Input:
  - success body `{ xml, markdown, executionId }`
  - failure body `{ error, stage, executionId }`
  - header `X-Complete-Secret`
- Responsible component: `app/api/fiche/[code]/complete/route.ts`
- Output:
  - on success: normalize XML, write `fiche.xml`, write `cdc.md`, set status `draft`
  - on failure: set status `error`
- Persistence location: disk, then Postgres sync
- Status: Partial
- Detected issues:
  - callback URL is hardcoded in n8n to `http://localhost:3000/...`, which breaks if app runs elsewhere
  - duplicate callbacks rely only on current status + optional executionId match
  - no separate callback receipt log

### Step 10. Fiche review and validation

- Input: parsed XML + markdown + status
- Responsible component:
  - `GET /api/fiche/[code]`
  - `PUT /api/fiche/[code]`
  - `POST /api/fiche/[code]/validate`
  - `components/fiche-editor.tsx`
- Output:
  - editable extraction/evaluation
  - read-only Contrôle lists
  - mutable Contrôle resolutions
  - validated status
- Persistence location: disk, then PostgreSQL sync
- Status: Working
- Detected issue: no user attribution and no revision history

### Step 11. PostgreSQL sync

- Input: parsed fiche + status
- Responsible component: `lib/db.ts` `syncFicheIndexSafely`
- Output: upsert into `cdc_fiches.fiches_projet`
- Persistence location: PostgreSQL
- Status: Working
- Detected issues:
  - sync is best-effort only; failures are logged and ignored
  - index table lacks `modifiedAt`, `n8nExecutionId`, `errorReason`, `errorStage`
  - Postgres contains rows no longer aligned with current disk directories

## Lifecycle classification

| Step | Classification | Notes |
|---|---|---|
| Opportunity creation | Missing | No opportunity module in app |
| Manual internal code entry | Working | `components/initiation-form.tsx` |
| PDF upload | Working | Frontend + `/api/generate` |
| Disk storage of PDF | Working | `lib/storage.ts` |
| n8n launch | Partial | Async launch exists, but recent executions are unstable |
| Job creation | Partial | `status.json` acts as job state, but there is no formal `processing_jobs` table |
| Processing status tracking | Working | Status endpoint + polling |
| n8n callback receipt | Partial | Endpoint exists; live runs do not always complete correctly |
| Result persistence (XML/Markdown) | Partial | Works for completed runs; many live folders still lack outputs |
| Fiche display | Working for completed fiches | Processing/error pages handled separately |
| Editing | Working | Draft only |
| Validation | Working | Contrôle resolution gate enforced |
| Archiving | Missing | No archive model, no retention logic |

# 5. Next.js ↔ n8n Contract

## Current start webhook

- Config source: `process.env.N8N_WEBHOOK_URL` in `app/api/generate/route.ts`
- Optional auth: `process.env.N8N_WEBHOOK_TOKEN`
- HTTP method: `POST`
- Content type: `multipart/form-data`

## Current request payload sent by Next.js

Sent by `requestWebhookAcceptance()` in `app/api/generate/route.ts`:

- `code_interne`
- `file`

Optional header:

- `Authorization: Bearer <N8N_WEBHOOK_TOKEN>`

## Current response expected by Next.js

Expected from n8n acceptance response:

- any `2xx`
- optionally:
  - `x-n8n-execution-id`
  - `n8n-execution-id`
  - `x-execution-id`
  - `execution-id`
- if JSON:
  - `executionId`
  - `execution_id`
  - `id`
  - or nested under `data` / `execution`

## Current callback endpoint

- Route: `POST /api/fiche/[code]/complete`
- Auth: `X-Complete-Secret` must match `N8N_COMPLETE_SECRET`

## Current callback payloads expected by Next.js

Success:

```json
{
  "xml": "...",
  "markdown": "...",
  "executionId": "..."
}
```

Failure:

```json
{
  "error": "...",
  "stage": "marker|anonymization|groq|unknown",
  "executionId": "..."
}
```

## Current payloads emitted by active n8n workflow

Workflow `f866bd39869c4c11` currently emits:

- `Respond XML JSON`
  - POST to `http://localhost:3000/api/fiche/{code}/complete`
  - body `{ xml, markdown, executionId: $execution.id }`
- `Marker Job Failed`
  - body `{ error, stage: "marker", executionId: $execution.id }`
- `Marker Timeout`
  - body `{ error: "Marker timeout exceeded", stage: "marker", executionId: $execution.id }`

## Current mismatches and risks

1. Callback URL is hardcoded in n8n
   - Evidence: live workflow node `Respond XML JSON` in n8n SQLite
   - Impact: app must run on `localhost:3000` or callbacks fail

2. App does not send callback URL to n8n
   - Evidence: `app/api/generate/route.ts`
   - Impact: contract is implicit and environment-coupled

3. Execution ID can be absent from start response
   - Evidence: `pickExecutionIdFromJson`, `pickExecutionIdFromHeaders`
   - Impact: status file may keep `n8nExecutionId = null`, weakening duplicate-callback protection

4. `/api/generate` returns HTTP `202` even when n8n contact fails
   - Evidence: error branch in `app/api/generate/route.ts`
   - Impact: UI flow can treat technical failure as accepted job

5. Status vocabulary is not formalized in one shared contract file
   - App statuses: `processing`, `draft`, `validated`, `error`
   - n8n internal Marker statuses: `processing`, `completed`, `failed`
   - Impact: translation exists implicitly in workflow, not in shared typed contract

6. No duplicate callback receipt log
   - Impact: difficult to reconcile race conditions and repeated callbacks

## Recommended MVP contract

- Next.js start request to n8n:
  - `code_interne`
  - `file`
  - `callback_url`
  - `callback_secret` omitted from request body; better kept on n8n side
- n8n acceptance response:
  - `202`
  - `{ executionId, accepted: true }`
- n8n callback:
  - POST to provided callback URL
  - signed with shared secret
  - one canonical schema for success/failure
- App-side persistence:
  - create an application `processing_jobs` record before calling n8n
  - store `executionId`, status transitions, retries, and callback receipts

# 6. Database and Storage Audit

## File storage currently used by the app

Per `lib/storage.ts`, the app stores:

- `data/{code}/cdc.pdf`
- `data/{code}/cdc.md`
- `data/{code}/fiche.xml`
- `data/{code}/status.json`

`DATA_ROOT` is resolved from `lib/storage.ts` using `import.meta.url`, not `process.cwd()`, which is safer and stable across dev-server startup locations.

## Current on-disk state

Observed under `data/`:

- 19 project directories
- Status distribution:
  - `validated`: 4
  - `draft`: 2
  - `error`: 9
  - `processing`: 4
- 13 directories are missing both `fiche.xml` and `cdc.md`

This proves the end-to-end pipeline is not yet consistently completing.

## PostgreSQL tables currently present

### `cdc_fiches.fiches_projet`

Purpose:

- secondary synced index of fiche state
- not source of truth

Columns:

- `id`
- `code_interne`
- `status`
- `created_at`
- `validated_at`
- `raw_xml`
- `extraction jsonb`
- `evaluation jsonb`
- `controle jsonb`
- `embedding vector(1536)`

Indexes:

- PK on `id`
- unique on `code_interne`
- GIN on `extraction`

### Legacy / parallel public tables

These exist in PostgreSQL but are not driven by the current Next.js UI:

- `public.offres`
- `public.fci`
- `public.fci_outputs`
- `public.feedback_corrections`
- `public.knowledge_base`
- `public.knowledge_vectors`
- `public.resultats_gonogo`
- `public.concurrents`
- `public.partenaires_groupement`
- `public.personnel_cle`

These appear to belong to a broader or earlier Go/No-Go / FCI domain, not the current CDC initiation UI.

## n8n internal SQLite tables that matter operationally

In `C:\Users\lotfi\.n8n\database.sqlite`:

- `workflow_entity`
- `workflow_history`
- `workflow_publish_history`
- `workflow_published_version`
- `execution_entity`
- `execution_data`
- `shared_workflow`
- `credentials_entity`
- `user_api_keys`

Purpose:

- workflow definitions
- workflow version history
- execution history
- n8n credential/user state

This is orchestration state, not app business state.

## Current source-of-truth situation

| Domain | Current source of truth | Problem |
|---|---|---|
| Stored PDF | Disk (`data/{code}/cdc.pdf`) | Acceptable for prototype |
| Markdown | Disk (`cdc.md`) | Missing for many runs |
| Fiche CDC XML | Disk (`fiche.xml`) | Missing for many runs |
| Fiche validation status | Disk (`status.json`) | Not normalized into main DB |
| Fiche search/index row | PostgreSQL `cdc_fiches.fiches_projet` | Secondary copy only |
| n8n execution state | n8n SQLite | Not owned by app |
| Opportunities | None in current app | Major missing domain |
| Users / permissions | None in current app | Major missing domain |
| Audit history | None in current app | Major missing domain |

## Inconsistencies already visible

1. Disk and Postgres are out of sync as datasets
   - disk has 19 project directories
   - `cdc_fiches.fiches_projet` has 24 rows
   - stale rows exist for codes not present in current `data/`

2. Postgres index omits important status metadata
   - no `modified_at`
   - no `n8nExecutionId`
   - no `errorReason`
   - no `errorStage`

3. Business data is split across four places
   - disk
   - PostgreSQL
   - n8n SQLite
   - JSON files

## Missing core MVP entities in the application database

These do not exist as app-owned tables in this repo:

- `users`
- `opportunities`
- `documents`
- `processing_jobs`
- `fiche_cdc` as primary business record
- `audit_logs`

## Recommended minimum MVP data model

- `users`
  - id, email, name, role, active
- `opportunities`
  - id, code_interne, title, client, status, created_at
- `documents`
  - id, opportunity_id, kind (`cdc_pdf`, `cdc_md`, `fiche_xml`), disk_path, created_at
- `processing_jobs`
  - id, opportunity_id, n8n_execution_id, status, started_at, finished_at, error_stage, error_reason
- `fiche_cdc`
  - id, opportunity_id, raw_xml, extraction jsonb, evaluation jsonb, controle jsonb, validated_at, validated_by
- `audit_logs`
  - id, entity_type, entity_id, action, actor_user_id, payload jsonb, created_at

## Recommended source of truth

For MVP:

- PostgreSQL should own business metadata and status transitions
- disk should store binaries and raw XML/Markdown artifacts
- n8n SQLite should remain internal orchestration state only

# 7. Security and Privacy Findings

## Critical

### No authentication or authorization in the application

- Evidence:
  - no auth library in `package.json`
  - no login route
  - no middleware
  - all fiche routes are public inside the app
- Impact:
  - anyone with access to the app can view, edit, validate, retry, and fetch stored PDFs
- Recommended correction:
  - add minimal auth before internal rollout
  - enforce at least authenticated commercial/admin roles for fiche review and validation

### Callback URL hardcoded to `http://localhost:3000`

- Evidence: active n8n workflow node `Respond XML JSON`
- Impact:
  - callbacks fail when app is not on port 3000
  - environment portability is broken
- Recommended correction:
  - pass callback base URL through env or explicit workflow config
  - stop hardcoding host/port inside workflow nodes

## High

### No application-owned audit trail

- Evidence:
  - no `audit_logs` table
  - no user attribution on save/validate
- Impact:
  - no traceability for business review decisions
- Recommended correction:
  - add audit log table and record save/validate/retry events

### Multi-file state transitions are not transactional

- Evidence:
  - `createProcessingBundle()` updates multiple files in `Promise.all`
  - `finalizeProcessingSuccess()` writes XML, Markdown, status in `Promise.all`
- Impact:
  - partial disk state possible on crash or mid-write failure
- Recommended correction:
  - stage whole bundle in temp dir and swap atomically, or persist authoritative status in DB first

### Unauthenticated PDF access endpoint

- Evidence: `GET /api/fiche/[code]/pdf`
- Impact:
  - stored tender documents can be fetched without auth
- Recommended correction:
  - protect route with auth/role checks

### Generate endpoint allows technical failure to look like accepted processing

- Evidence: `/api/generate` returns `202` with `{ status: "error" }` on n8n contact failure
- Impact:
  - misleading UI behavior, ambiguous job state
- Recommended correction:
  - return non-2xx for launch failure or a clearly separate accepted-vs-failed contract

## Medium

### File type validation trusts MIME too much

- Evidence: `isPdfFile()` plus MIME check in `/api/generate`
- Impact:
  - non-PDF files can be mislabeled
- Recommended correction:
  - verify magic bytes or run stricter server-side validation

### No upload size guard in app

- Evidence: no size check in form or API route
- Impact:
  - large PDF uploads can stress memory/disk/workflow
- Recommended correction:
  - enforce max size in app and in reverse proxy/server config

### Weak duplicate-callback protection when execution ID is missing

- Evidence:
  - `n8nExecutionId` can remain null
  - `/complete` only compares execution id if current status already has one
- Impact:
  - wrong callback could complete the wrong processing fiche if code collisions occur
- Recommended correction:
  - require execution id from acceptance response and persist it before accepting completion

### Hardcoded local Windows paths in workflow

- Evidence:
  - active n8n workflow uses `C:\Users\lotfi\.n8n-files\...`
  - scripts use Windows absolute paths
- Impact:
  - non-portable setup
- Recommended correction:
  - move to env-configured paths

## Low

### Obsolete mock/stub code still present

- Evidence: `lib/mock-fiche.ts`, `createDraftBundle()` unused
- Impact:
  - confusion during maintenance
- Recommended correction:
  - remove once no longer needed, after pipeline is stable

### Fast XML parsing not explicitly constrained beyond current schema

- Evidence: `fast-xml-parser` defaults in `lib/fiche-xml.ts`
- Impact:
  - low, because XML source is controlled by the pipeline, but not ideal for broader trust boundaries
- Recommended correction:
  - keep XML source internal only and validate strictly, as already partly done

# 8. Missing MVP Features

## Must have before demo

- Stable async end-to-end processing for at least one real CDC
- Reliable n8n callback completion into Next.js
- One clear processing status lifecycle with no stuck “processing” jobs
- Basic operator-friendly error handling when generation fails

## Must have before internal use

- Authentication
- Role-based authorization for review/validation
- Application-owned `processing_jobs` and `opportunities`
- Audit logging for edits/validation/retries
- Secure PDF access
- Clear callback host configuration independent of `localhost:3000`

## Can wait until later

- Similar-project search
- Employee/CV database
- Competency matching
- Semantic search UI
- Full FCI generation/distribution workflow
- Notifications and statistics dashboards

# 9. Technical Debt and Risks

- `lib/mock-fiche.ts` is dead code and still shapes stored sample data.
- `lib/storage.ts` contains both old synchronous draft-bundle logic and current async processing logic.
- `createDraftBundle()` is unused but still maintained.
- n8n maintenance depends on many one-off DB mutation scripts under `scripts/`, which is brittle.
- `tmp/n8n-workflow-backups/` contains many workflow snapshots and historical fix artifacts inside the repo.
- The active workflow still contains disabled anonymization nodes, which increases graph complexity.
- Hardcoded localhost URLs exist in workflow/script logic.
- Hardcoded Windows paths exist in workflow/script logic.
- Postgres index rows and disk folders already diverge.
- No migration system exists; schema evolution is ad hoc in code.
- `npm start` is not a valid project command; only `dev`, `build:prod`, and `start:prod` exist.
- `package.json` has no `"type": "module"`, causing warnings for TS/ESM helper scripts.
- The current XML format extends the supervisor’s schema with `<resolutions>`, creating contract drift.
- Sample XML sources still use generic `cdc.md > field` citations, which undermines the intended trust mechanism.

# 10. Recommended MVP Architecture

Reuse as much current code as possible.

## Keep

- Next.js UI and API routes
- `lib/fiche-xml.ts`
- `lib/storage.ts` as artifact storage layer
- `components/fiche-editor.tsx`
- `cdc_fiches.fiches_projet` as a starting point for fiche indexing
- n8n as orchestration engine

## Simplify

- Make PostgreSQL the authority for:
  - opportunity metadata
  - processing job state
  - validation status
  - audit events
- Keep disk only for:
  - `cdc.pdf`
  - `cdc.md`
  - `fiche.xml`

## Minimum stable architecture

```text
Next.js app
  owns:
    users
    roles
    opportunities
    processing_jobs
    validated fiche state
    audit logs

Disk
  stores:
    raw and generated artifacts

n8n
  orchestrates:
    Marker
    optional anonymization
    Groq extraction
    callback only

PostgreSQL
  stores:
    business truth
    searchable fiche index
```

## Do not redesign yet

Avoid introducing:

- S3/MinIO migration
- full opportunity CRM
- semantic search UI
- large auth frameworks if a small internal auth system will do

First stabilize the current CDC → Fiche loop.

# 11. Prioritised Action Plan

| Priority | Task | Why | Files or components concerned | Estimated complexity | Dependency |
|---|---|---|---|---|---|
| P0 — Blocking | Fix the active n8n workflow so every successful execution reaches `Respond XML JSON` and every failed one reaches `Marker Job Failed` or `Marker Timeout` | Current async pipeline is not reliably closing the loop | n8n workflow `f866bd39869c4c11`, n8n SQLite workflow state | Medium | None |
| P0 — Blocking | Remove hardcoded callback base URL and make callback target configurable | Current workflow is bound to `localhost:3000` | active n8n workflow, docs, env handling | Low | None |
| P0 — Blocking | Introduce an application `processing_jobs` table and persist state transitions there | `status.json` alone is not enough for stable async operations | Postgres schema, Next.js API routes | Medium | Database design |
| P1 — Required for MVP | Change `/api/generate` so launch failure is not returned as successful `202` acceptance | Current UX and job semantics are misleading | `app/api/generate/route.ts`, `components/initiation-form.tsx` | Low | None |
| P1 — Required for MVP | Add stale-job reconciliation for jobs stuck in `processing` | Current live data already contains stuck jobs | `status.json` handling, app API or maintenance script | Medium | `processing_jobs` strongly recommended |
| P1 — Required for MVP | Add minimal auth and role checks for fiche review/validation/PDF access | Required before internal use | app routes, middleware, user schema | Medium | User model |
| P1 — Required for MVP | Add audit logging for save, validate, retry, callback, and error transitions | Needed for business traceability | Postgres schema, API routes | Medium | User/process models |
| P1 — Required for MVP | Normalize XML contract decisions with supervisor, especially `<resolutions>` and source citations | Current app schema has drift from canonical contract | `lib/fiche-xml.ts`, `lib/types.ts`, n8n prompt/workflow | Medium | Supervisor decision |
| P2 — Important after MVP | Remove obsolete mock/sync-generation code and stale helper artifacts | Reduces confusion and maintenance cost | `lib/mock-fiche.ts`, unused storage functions, `tmp/` strategy | Low | Pipeline stable |
| P2 — Important after MVP | Add file-size and content validation for uploads | Improves safety and reliability | `components/initiation-form.tsx`, `app/api/generate/route.ts` | Low | None |
| P2 — Important after MVP | Add basic automated tests for XML parsing, callback handling, and validation gate | Needed for regression safety | test setup, `lib/fiche-xml.ts`, API routes | Medium | Test tooling |
| P3 — Future evolution | Connect opportunity lifecycle, FCI workflow, semantic search, and knowledge base into one app-owned model | Long-term platform vision | new features across app, DB, n8n | High | Stable MVP |

# 12. Suggested Next Development Sprint

No more than 8 tasks, all specific and testable:

1. Add a `processing_jobs` PostgreSQL table and write to it on generate, callback success, callback failure, and validation.
2. Refactor `/api/generate` so n8n launch failure returns a real failure status and does not masquerade as accepted processing.
3. Make the n8n callback base URL configurable through env or explicit workflow configuration instead of hardcoded `localhost:3000`.
4. Fix the active n8n workflow so the success path always reaches `Respond XML JSON` and timeout/failure paths always emit callbacks.
5. Add a stale-processing recovery path that marks jobs failed after a ceiling or allows explicit requeue with recorded reason.
6. Add minimal authentication and restrict fiche review/validation/PDF routes to authenticated users.
7. Add audit logging for draft save, validation, regenerate, callback success, and callback error.
8. Add three critical automated tests:
   - XML parse/serialize round-trip
   - `/api/fiche/[code]/complete` success/failure contract
   - validation blocked when Contrôle items remain unresolved

# 13. Open Questions for the Supervisor

- Is the application expected to preserve the supervisor’s canonical XML contract exactly, or is the added `<resolutions>` block approved as an application extension?
- Should the application own opportunities now, or is manual `code_interne` entry acceptable for the first internal demo?
- What exact roles are required for the first internal release: only Commercial and Administrator, or also Finance / Operations / Management?
- Is PostgreSQL expected to become the primary source of truth immediately for fiche/job metadata, or can disk remain authoritative for the first demo?
- Should source citations in XML be strict real references like page/section labels, and if so, what citation format is considered acceptable?
