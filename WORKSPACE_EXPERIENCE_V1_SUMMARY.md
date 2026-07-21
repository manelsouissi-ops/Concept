# WORKSPACE_EXPERIENCE_V1 Summary

## Workspace redesign

The Appel d'offres detail page now behaves more like a project workspace and less like a raw data screen.

- The workspace header now emphasizes:
  - extracted project title or a safe fallback
  - internal code
  - client
  - country
  - status
  - deadline
  - responsible commercial
  - priority
  - last update
- Temporary compatibility titles equal to the internal code are now shown as:
  `Intitule en attente d'extraction`
- Header actions are now context-sensitive instead of always showing the same buttons.
- Workspace tabs now preserve the selected section in the URL and support the alias:
  `?view=fiche-cdc`

## Processing-stage mapping

The processing section no longer relies on the old percentage-driven progress display.

It now maps real backend evidence into a business timeline:

1. `Dossier cree`
2. `CDC recu`
3. `PDF enregistre`
4. `Analyse lancee`
5. `Analyse IA`
6. `Fiche CDC generee`
7. `Resultat disponible`

Evidence comes from:

- PostgreSQL `processing_jobs`
- audit events
- synced document metadata
- fiche status bundle

Failure staging is mapped conservatively:

- webhook failures => launch stage
- marker / markdown / llm / similar processing failures => AI analysis stage
- xml / callback failures => fiche generation stage

No fake progress percentages are shown in the new workspace processing experience.

## Fiche CDC validation flow

The Fiche CDC section now presents the extracted content as a review workflow:

- grouped into business-oriented review sections
- field badges show `Genere`, `Modifie`, `Valide`, or `Non renseigne`
- empty values display `Aucune information detectee`
- existing save and validate APIs were preserved
- final validation now asks for confirmation before calling the validation endpoint
- once validated, the fiche remains locked in the existing repository pattern

The implementation reuses:

- `PUT /api/fiche/[code]`
- `POST /api/fiche/[code]/validate`
- existing audit logging
- existing business-status update logic

## Activity-feed implementation

The history and recent-activity views now use business-readable activity labels instead of raw audit action names.

Examples:

- `Dossier cree`
- `CDC importe`
- `Analyse demandee`
- `Analyse lancee`
- `Analyse terminee`
- `Fiche CDC generee`
- `Fiche CDC enregistree`
- `Fiche CDC validee`

Low-value callback-noise events such as duplicate and stale callbacks are hidden from the business feed.

## Document presentation

The Documents section now distinguishes:

- original document
- generated artifact
- treatment trace artifact

Each real document card shows:

- file name
- artifact type
- availability
- size
- creation time
- supported action when available

No local filesystem paths are exposed.

## Dashboard refinements

- Recent dossiers now use title fallback handling.
- Long codes are constrained visually while keeping the full value in the title tooltip.
- Deadline cells now highlight urgency using real deadline proximity.
- “Actions requises” now link into the Appels d'offres list with useful status or sort context.
- Recent activity now uses business-readable labels.

## List refinements

- Long internal codes now render with safe truncation styling.
- Placeholder titles now show `Intitule en attente d'extraction`.
- Deadline cells now surface overdue and near-deadline states.
- The list and card views now show the current real step instead of made-up percentage progress.
- Initial status and sort filters can be driven from the URL.

## Components created

- `components/workspace-header.tsx`
- `components/workspace-tabs.tsx`
- `components/workspace-action-menu.tsx`
- `components/processing-timeline.tsx`
- `components/activity-feed.tsx`

## Backend endpoints reused or added

No canonical n8n contract changes were made.

Reused endpoints:

- `POST /api/appels-offres/[code]/analyse`
- `POST /api/appels-offres/[code]/archive`
- `POST /api/appels-offres/[code]/unarchive`
- `PUT /api/fiche/[code]`
- `POST /api/fiche/[code]/validate`
- `GET /api/fiche/[code]/status`
- `GET /api/appels-offres/[code]/pdf`

Minimal behavior refinement:

- `app/api/generate/route.ts` now sanitizes technical errors before returning them to the UI.

## Helper modules and tests

Added:

- `lib/appels-offres/workspace.ts`
- `lib/appels-offres/workspace.test.ts`
- `lib/appels-offres/user-errors.test.ts`

Test coverage added for:

- title fallback behavior
- processing-stage mapping
- quick-action visibility during active processing
- technical-error sanitization

## Verification results

Passed:

- `node --test --experimental-strip-types lib\appels-offres\create-form.test.ts lib\appels-offres\validation.test.ts lib\appels-offres\workspace.test.ts lib\appels-offres\user-errors.test.ts`
- `npm.cmd run typecheck`
- `npm.cmd run build:prod`

Local route checks returned HTTP `200` for:

- `/dashboard`
- `/appels-offres`
- `/appels-offres/nouveau`
- `/appels-offres/<appel-offres-code>?view=overview`
- `/appels-offres/<appel-offres-code>?view=documents`
- `/appels-offres/<appel-offres-code>?view=processing`
- `/appels-offres/<appel-offres-code>?view=fiche-cdc`
- `/appels-offres/<appel-offres-code>?view=history`

## Browser checks completed

- Route verification was completed through local HTTP checks and successful production build output.

## Known limitations

- Per-field validation ownership and validator identity are not yet persisted in the current fiche schema, so field review states remain UI-derived rather than fully audited per field.
- The current processing timeline uses real job state and artifacts, but it still cannot show granular provider sub-step timestamps that are not persisted today.

## Future FCI and Go / No-Go extension plan

This milestone keeps the current five-section workspace intact while preparing the next phase through:

- a stronger project header
- a clearer fiche validation state
- cleaner activity and document surfaces
- a processing timeline that can later feed FCI and Go / No-Go views

The recommended future extension path is:

1. keep the current workspace root
2. add real FCI data once backend support exists
3. add department contributions and risk synthesis
4. add Go / No-Go summary and decision history

No fake FCI or decision tabs were added in this milestone.

## Exact local command to test

Development:

```powershell
npm.cmd run dev
```

Production-style local run:

```powershell
npm.cmd run build:prod
npm.cmd run start:prod
```

## Exact test URLs

- `/dashboard`
- `/appels-offres`
- `/appels-offres/nouveau`
- `/appels-offres/<appel-offres-code>?view=overview`
- `/appels-offres/<appel-offres-code>?view=documents`
- `/appels-offres/<appel-offres-code>?view=processing`
- `/appels-offres/<appel-offres-code>?view=fiche-cdc`
- `/appels-offres/<appel-offres-code>?view=history`
