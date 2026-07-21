# WORKSPACE_EXPERIENCE_V1 Plan

## Current workspace structure

The current Appel d'offres detail experience is split across:

- `app/appels-offres/[code]/page.tsx`
- `components/appel-offres-workspace.tsx`
- `components/appel-offres-analysis-panel.tsx`
- `components/fiche-editor.tsx`
- `lib/appels-offres/presentation.ts`
- `lib/appels-offres/repository.ts`
- `lib/appels-offres/analysis.ts`
- `lib/storage.ts`

The current workspace already has the five required sections:

- `overview`
- `documents`
- `processing`
- `fiche`
- `history`

The data is real, but the presentation is still close to an internal admin view:

- the header uses the stored `title` directly, even when it is temporarily equal to the internal code
- overview cards expose generic status summaries but not a project-grade identity or action model
- processing uses a percentage-based progress abstraction and a simple job summary rather than evidence-based stages
- history shows raw audit action names
- documents are listed, but without a strong distinction between original artifact and generated artifact
- the Fiche CDC editor is functional, but it still feels like an editable XML-backed form instead of a generated-review workflow

## Available real backend data

The current platform already exposes enough data to build a stronger business workspace without redesigning backend architecture.

### Appel d'offres metadata

From `AppelOffresDetail` and PostgreSQL:

- internal code
- stored title
- buyer / client
- country
- reference
- due date
- notes
- priority
- responsible commercial
- stored status
- stored business status
- created at
- updated at
- archived at

### Processing data

From `processing_jobs` and `lib/appels-offres/analysis.ts`:

- job type
- job status
- public job id
- retry origin
- contract version
- correlation id
- execution id
- launch accepted timestamp
- callback received timestamp
- finished timestamp
- error stage
- error code
- error message
- retryable flag in callback metadata when present

### Activity data

From `audit_logs`:

- action name
- actor
- details payload
- timestamp

Real audit events already include:

- creation
- metadata updates
- PDF upload
- analysis requested
- n8n accepted
- callback received
- success / failure
- fiche saved
- fiche validated
- archive / unarchive

### Document data

From `documents` and filesystem sync:

- source PDF
- generated XML
- generated Markdown
- status JSON
- filename
- mime type
- size
- created / updated timestamps

### Fiche CDC data

From XML + status bundle:

- extraction fields and groups
- field values
- source text
- evaluation values
- control items and resolutions
- fiche status
- created / modified / validated timestamps
- error reason and stage
- n8n execution id

## Missing data that must not be invented

The UI must not fabricate:

- real extraction confidence scores
- exact provider internals for business users
- document stages that are not evidenced by job state, fiche state, or audit records
- future FCI completion data
- Go / No-Go decisions
- validator identity, unless actually stored
- final extracted project title if the current title is still only the internal code
- exact PDF conversion / anonymization sub-step timestamps if they are not persisted today

## Key UX gaps to address

### Workspace identity

- Detect the temporary compatibility case where `title === code` and display `Intitule en attente d'extraction`.
- Surface business-safe fallback values such as `Non renseigne`, `A extraire`, and `En attente d'analyse`.
- Replace the current mixed action row with a state-driven primary action and smaller secondary actions.

### Section navigation

- Keep the five sections.
- Add count badges where counts are real:
  - documents count
  - history count
- Make the active section clearer.
- Persist tab changes back to the URL using `?view=...`.

### Overview

- Replace generic cards with a project summary, current next action, key documents, and recent activity.
- Keep metadata editing reusable through the existing `AppelOffresForm`, but present it as a supporting panel rather than the first thing the user sees.

### Processing

- Replace the percentage-style process card with a true evidence-based timeline.
- Map technical jobs and audit signals to user-facing stages.
- Keep technical execution details hidden behind an expandable admin-oriented section.
- Reuse the existing retry endpoint and concurrency guard from `launchAnalysisForAppelOffres`.

### Fiche CDC

- Reframe the editor as review and validation.
- Group extraction fields into business sections using the existing extraction field group definitions.
- Add field-level generated / empty / modified / validated visual states where derivable from current data.
- Preserve the existing XML-backed save and validate pattern instead of replacing it wholesale.

### History

- Transform raw audit action names into business-readable labels.
- Combine audit events and job milestones into a clearer activity feed.
- Hide noisy duplicate / late callback internals unless needed for the business timeline.

### Dashboard and list refinements

- Improve the “Actions requises” usefulness with direct links and urgency framing.
- Improve long-code rendering, deadline clarity, and status alignment in tables.

## Progress-stage mapping

The current `buildProgressStepper()` includes future disabled FCI / decision steps and a percentage model. For this milestone, the processing section should move to stage evidence.

### Proposed user-facing timeline stages

1. `Dossier cree`
2. `CDC recu`
3. `PDF enregistre`
4. `Analyse lancee`
5. `Analyse IA`
6. `Fiche CDC generee`
7. `Resultat disponible`

### Evidence rules

- `Dossier cree`:
  always complete when the record exists.
- `CDC recu`:
  complete when source PDF exists or a CDC upload audit event exists.
- `PDF enregistre`:
  complete when source PDF document metadata exists.
- `Analyse lancee`:
  complete when a `fiche_generation` job exists.
- `Analyse IA`:
  active when the latest `fiche_generation` job is `created`, `queued`, `running`, or `retrying`.
- `Fiche CDC generee`:
  complete when `fiche.xml` exists or fiche status is `draft` / `validated`.
- `Resultat disponible`:
  complete when fiche status is `draft` or `validated`.

### Failure mapping

- `webhook` => failure on `Analyse lancee`
- `upload`, `marker`, `markdown`, `anonymization`, `llm`, `xml`, `callback`, `unknown` => failure on `Analyse IA` or final generation stage depending on result availability

The UI should show:

- completed
- active
- waiting
- failed

but never fabricated percentages.

## Validation-state model

The current fiche status system is:

- `processing`
- `draft`
- `validated`
- `error`

This should be presented as a business review model:

- `A verifier` -> backed by `draft`
- `En cours de validation` -> local editing / saving state while draft remains editable
- `Validee` -> backed by `validated`

Field-level presentation can be derived minimally:

- generated: original draft field with no local change in current client state
- modified: user-edited current field value during the session or persisted modified draft
- validated: global validation complete, plus read-only state
- non renseigne: empty field value

Because the persisted schema does not currently store per-field validation metadata, section- or field-level validation must remain visual and lightweight in this milestone.

## Activity-feed model

Use real audit logs as the primary source, with optional processing job enrichment.

### Should be business-visible

- dossier cree
- informations modifiees
- CDC importe
- analyse demandee
- analyse acceptee
- analyse terminee
- fiche CDC generee
- fiche CDC enregistree
- fiche CDC validee
- dossier archive / reactive

### Should be hidden or deprioritized in business mode

- duplicate callback ignored
- late callback ignored
- callback not applicable noise
- raw provider technical strings

### Feed behavior

- newest first
- short label
- timestamp
- optional actor if present
- optional contextual subtext from audit details

## Components to add or refactor

### New components

- `WorkspaceHeader`
- `WorkspaceTabs`
- `WorkspaceSectionCount`
- `WorkspaceActionMenu`
- `ProcessingTimeline`
- `ProcessingTimelineStep`
- `ActivityFeed`
- `ActivityFeedItem`
- `DocumentArtifactCard`
- `FicheReviewSection`
- `FicheReviewField`
- `ValidationBadge`
- `BusinessEmptyState`

### Existing components to refactor

- `components/appel-offres-workspace.tsx`
- `components/appel-offres-analysis-panel.tsx`
- `components/fiche-editor.tsx`
- `components/appels-offres-list-view.tsx`
- `app/dashboard/page.tsx`
- `lib/appels-offres/presentation.ts`

## Future FCI and Go / No-Go extension points

Do not implement new tabs now, but keep the architecture ready for:

- an FCI summary panel after `fiche_validee`
- department contribution modules
- risk review summary
- decision summary card
- future Go / No-Go activity events

The right extension point is the workspace overview and/or a future new section once real backend support exists, not placeholder tabs in this milestone.

## Responsive strategy

- Header stacks into code / title / meta / actions blocks on smaller widths.
- Section tabs become horizontally scrollable instead of wrapping into confusing rows.
- Processing timeline shifts from multi-column to vertical stacked cards on narrow widths.
- Documents and history remain readable with compact cards and safe horizontal table overflow only where required.
- Fiche CDC review sections remain single-column on mobile.

## Accessibility strategy

- Preserve semantic tabs with `aria-selected`.
- Add visible focus styling to tab buttons, menus, retry actions, and validate actions.
- Use text + icon + color for statuses.
- Keep error and save messages readable and announced in the document flow.
- Use buttons for actions, not clickable generic containers.
- Ensure ellipsized long codes still expose full value via `title`.

## Rollout order

1. Add shared workspace helpers in `lib/appels-offres/presentation.ts`:
   - title fallback
   - stage mapping
   - activity formatting
   - action visibility helpers
2. Create `WORKSPACE_EXPERIENCE_V1_PLAN.md`.
3. Refactor workspace header and tabs with URL persistence.
4. Refactor overview and document presentation.
5. Replace processing summary with timeline + safe failure experience.
6. Refactor Fiche CDC review presentation while reusing save / validate APIs.
7. Improve history feed.
8. Refine dashboard and list tables.
9. Add focused tests for title fallback, stage mapping, safe errors, and action visibility.
10. Run typecheck, build, and local browser checks on safe records.

## Risks

- The current persisted fiche schema does not store per-field validation ownership or validator identity, so validation UX must remain aligned with available data.
- The current status bundle does not persist granular provider sub-step timestamps, so the timeline must stay honest about which stages are evidenced directly and which are inferred from canonical job state.
- Some files still contain earlier encoding artifacts; touching user-facing copy should keep the new work ASCII-safe and consistent with the repo’s current conventions.
- The in-app browser backend was unavailable in the previous session, so browser inspection may remain partially blocked by tooling rather than application code.
