# Appels d'Offres Phase 1 Plan

## Goal

Introduce `Appel d'offres` as the root business entity while keeping the existing Fiche CDC flow operational and backward-compatible.

## Constraints

- Reuse the existing `data/{code}/` bundle structure.
- Do not modify the n8n workflow.
- Do not modify AI prompts or parsing behavior.
- Do not break `/initiation`, `/api/generate`, or `/fiche/[code]`.
- Keep the new domain logic under `lib/appels-offres/`.

## Phase 1 Scope

1. Add the new root domain model and validation layer under `lib/appels-offres/`.
2. Create the foundational PostgreSQL tables:
   - `appels_offres`
   - `documents`
   - `processing_jobs`
   - `audit_logs`
3. Add CRUD APIs for:
   - listing and creating appels d'offres
   - reading, updating, and archiving a dossier by code
   - streaming the stored PDF
4. Add the pages:
   - `/appels-offres`
   - `/appels-offres/nouveau`
   - `/appels-offres/[code]`
5. Add application navigation so the new domain is reachable from the app shell.
6. Store metadata in PostgreSQL and source files in the existing disk bundle.
7. Add temporary processing statuses through the new `processing_jobs` table and root entity status field.

## Reuse Strategy

- Reuse `lib/storage.ts` path conventions and atomic disk-write behavior.
- Reuse the current `data/{code}/cdc.pdf`, `status.json`, `fiche.xml`, and `cdc.md` conventions.
- Reuse the current app shell styles in `app/globals.css`.
- Reuse the existing Node/Postgres setup pattern already used by the fiche index.

## Architecture Decisions

- `Appel d'offres` is now the root application entity.
- The existing Fiche CDC remains an attached artifact in the same bundle.
- The fiche review page stays intact and is linked from the new dossier detail page when the XML artifact exists.
- Existing fiche pipeline routes now sync the root `appels_offres` metadata non-blockingly so the architecture stays centered on the new root entity.

## Deliverables Implemented In Phase 1

- `lib/appels-offres/types.ts`
- `lib/appels-offres/validation.ts`
- `lib/appels-offres/storage.ts`
- `lib/appels-offres/repository.ts`
- `/api/appels-offres` route set
- `/appels-offres` page set
- app navigation updates
- PostgreSQL schema bootstrap integration

## Verification

- Run `npm run typecheck`
- Run `npm run build:prod`
- Fix all resulting issues before stopping

## Explicitly Out Of Scope

- Phase 2 workflows
- AI integration changes
- n8n workflow changes
- Groq/Gemini migration work
- authentication/authorization
- replacing the existing fiche review UX
