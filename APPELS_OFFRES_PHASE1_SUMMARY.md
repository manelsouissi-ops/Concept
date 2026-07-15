# Appels d'Offres Phase 1 Summary

## What Was Added

- A new root domain under `lib/appels-offres/` for:
  - domain types
  - form validation
  - disk storage helpers
  - PostgreSQL repository access
- Foundational PostgreSQL tables:
  - `appels_offres`
  - `documents`
  - `processing_jobs`
  - `audit_logs`
- CRUD APIs:
  - `GET /api/appels-offres`
  - `POST /api/appels-offres`
  - `GET /api/appels-offres/[code]`
  - `PUT /api/appels-offres/[code]`
  - `DELETE /api/appels-offres/[code]`
  - `GET /api/appels-offres/[code]/pdf`
- Pages:
  - `/appels-offres`
  - `/appels-offres/nouveau`
  - `/appels-offres/[code]`
- Application navigation in the shared layout

## Storage Model

- The implementation reuses the existing `data/{code}/` bundle.
- Source PDFs are stored as `data/{code}/cdc.pdf`.
- Existing fiche artifacts remain:
  - `data/{code}/fiche.xml`
  - `data/{code}/cdc.md`
  - `data/{code}/status.json`
- The new `documents` table indexes those artifacts without changing their on-disk format.

## Backward Compatibility

- `/initiation` remains available.
- `/api/generate` remains available.
- `/fiche/[code]` remains available.
- The existing fiche review/editor flow was not removed or replaced.
- The fiche completion path now syncs root dossier metadata and attached artifact records, but its request/response behavior stays intact.

## Root Entity Behavior

- `Appel d'offres` is now the primary entity in the application model.
- The existing fiche bundle is treated as an attached artifact of that root entity.
- The dossier detail page exposes:
  - dossier metadata
  - indexed documents
  - temporary job status
  - attached fiche presence
  - direct links to the stored PDF and fiche page

## Temporary Processing Statuses

- Root dossier status uses:
  - `draft`
  - `processing`
  - `ready`
  - `error`
  - `archived`
- Temporary work is tracked in `processing_jobs`.
- Phase 1 uses those jobs for:
  - manual dossier creation
  - manual dossier update with PDF replacement
  - fiche generation sync from the existing pipeline

## Script Integration

- The existing `scripts/setup-fiche-index.ts` bootstrap now also creates the new Appels d'offres tables.

## Verification Completed

- `npm run typecheck` passed
- `npm run build:prod` passed

## Phase 2 Not Started

- No Phase 2 work was implemented.
- Work stops here pending review.
