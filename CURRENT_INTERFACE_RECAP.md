# Current Interface Recap

Audit date: 2026-07-29. Read-only pass over the actual source in this repository — no code was changed to produce this document. Every claim below is cited to a real file path. Where the code and docs disagree, or where something is genuinely ambiguous, it is flagged explicitly rather than guessed.

---

## 1. Navigation map

### Routes (from `app/`)

| Route | File | Notes |
|---|---|---|
| `/` | `app/page.tsx` | Immediately `redirect("/dashboard")` |
| `/dashboard` | `app/dashboard/page.tsx` | Main landing page |
| `/appels-offres` | `app/appels-offres/page.tsx` | Tender list |
| `/appels-offres/nouveau` | `app/appels-offres/nouveau/page.tsx` | Create-tender form |
| `/appels-offres/[code]` | `app/appels-offres/[code]/page.tsx` | Tender detail workspace |
| `/appels-offres/[code]/analyse/logiciels` | `app/appels-offres/[code]/analyse/logiciels/page.tsx` | Per-tender software analysis |
| `/fiche/[code]` | `app/fiche/[code]/page.tsx` | Standalone Fiche CDC editor (same `FicheEditor` as the tender workspace's "Fiche CDC" tab) |
| `/administration/logiciels` | `app/administration/logiciels/page.tsx` | Software catalogue list |
| `/administration/logiciels/nouveau` | `app/administration/logiciels/nouveau/page.tsx` | Add a software record |
| `/administration/logiciels/[id]` | `app/administration/logiciels/[id]/page.tsx` | Software record detail |
| `/administration/logiciels/[id]/modifier` | `app/administration/logiciels/[id]/modifier/page.tsx` | Edit a software record |
| `/administration/logiciels/importer` | `app/administration/logiciels/importer/page.tsx` | Excel catalogue import (2-step preview/confirm) |
| `/initiation` | `app/initiation/page.tsx` | Explicitly labeled in its own `PageHeader`: *"Ancien point d'entrée conservé pour compatibilité, sans en faire le parcours principal"* — a legacy entry point, not part of the main flow |

No other page routes exist under `app/`.

### Sidebar (`components/app-shell.tsx`)

```
primaryNavigation (active, clickable):
  - Tableau de bord → /dashboard
  - Appels d'offres → /appels-offres

Administration (disclosure group):
  - Référentiels        [disabled, "Bientôt" tag]
  - Employés            [disabled, "Bientôt" tag]
  - Compétences         [disabled, "Bientôt" tag]
  - Logiciels           → /administration/logiciels   (active)

"Prochainement" group (greyed heading, non-clickable section):
  - Base de connaissances [disabled, "Bientôt" tag]
```

Exact code (`components/app-shell.tsx`):
```ts
const primaryNavigation = [Tableau de bord, Appels d'offres]  // both active
const upcomingNavigation = [Base de connaissances]            // disabled, rendered under "Prochainement"
const administrationNavigation = [Référentiels, Employés, Compétences (all disabled), Logiciels (active)]
```

Routes reachable **only** from inside another page, not from the sidebar: `/appels-offres/nouveau` (topbar "Nouvel appel d'offres" CTA), `/appels-offres/[code]` (row/card click), `/appels-offres/[code]/analyse/logiciels` (tender header overflow menu), `/fiche/[code]` and `/initiation` (no in-app link found to either — see Gaps §6).

---

## 2. Per-page breakdown

### Dashboard — `/dashboard` (`app/dashboard/page.tsx`, data from `lib/appels-offres/dashboard.ts`)

**Purpose:** one-glance view of all tenders + the single next thing to do.

- **Hero**: `<h1>Bonjour Bob</h1>` + subtitle "Voici l'état de vos appels d'offres aujourd'hui."
- **KPI strip** (5 cells, in order): Total, Nouveaux, En cours d'analyse, À valider, Terminés (`lib/appels-offres/dashboard.ts:150-181`). Total and À valider/En cours link to `/appels-offres?status=...`; Nouveaux and Terminés are non-clickable (they aggregate multiple raw statuses that the list page can't filter by a single value).
- **"Appels d'offres récents" table**: 5 most recently updated tenders (`components/dashboard-recent-appels-table.tsx`), columns Code / Intitulé / Client / Statut / Action.
- **"Actions prioritaires" panel**: up to 5 conditional items — Fiches CDC à valider, Analyses FCI à générer, Dossiers prêts pour l'offre, Dossiers à vérifier, Échéances proches (`app/dashboard/page.tsx`, `lib/appels-offres/dashboard.ts:157-224`), each with a CTA link into `/appels-offres?status=...`.
- **"Activité récente"**: 3-item compact `ActivityFeed`, no further link.

**Actions:** KPI/priority-panel links (navigation only); per-row `DashboardRowActionButton` (see §3 for the exact mapping).

### Appels d'offres list — `/appels-offres` (`app/appels-offres/page.tsx` + `components/appels-offres-list-view.tsx`)

**Purpose:** full searchable/filterable roster of every tender (active + archived).

- Toolbar: free-text search, Statut select, "Trier par" select (Dernière mise à jour / Date limite / Intitulé), "Filtres avancés" (Client, Pays, Priorité, "Afficher les archives").
- Tableau/Cartes toggle.
- **Table columns**: Code interne, Intitulé, Client, Statut, Date limite, Responsable, Actions.
- **Card view**: code, title, status badge, Client/Pays/Priorité/Date limite line, `statusDescription` + `currentStep` text, primary action button, CDC download link if a PDF exists.
- Pagination (10/page table, 6/page cards).

**Actions:** per-row `DashboardRowActionButton` (shared mapping, see §3); "..." overflow menu with Modifier, Télécharger le CDC (if present), Archiver/Désarchiver.

### Tender detail — `/appels-offres/[code]` (`app/appels-offres/[code]/page.tsx` + `components/appel-offres-workspace.tsx`)

**Purpose:** the single workspace to run one tender through its whole lifecycle.

**Header** (`components/workspace-header.tsx`): "Retour à la liste" link, code + title, status badge (shared mapping), exactly two facts — Client and Date limite — and an overflow menu (`components/workspace-action-menu.tsx`) holding Télécharger le CDC / Modifier la Fiche CDC / Archiver-Réactiver / **Analyse des logiciels** (a plain link into the software-analysis route, not a `WorkspaceAction`) plus, when applicable, Consulter/Réviser la Fiche CDC or Valider la Fiche CDC.

**Tabs**, in this order (`components/appel-offres-workspace.tsx:43-49`): **Aperçu → Documents → Fiche CDC → FCI → Historique**.

- **Aperçu**
  - "Prochaine action" card: one CTA button (`getOverviewPrimaryAction`), label/handler depends on state (Suivre l'analyse / Valider la Fiche CDC / Lancer-Relancer l'analyse / Réviser-Consulter la Fiche CDC / Modifier la Fiche CDC).
  - "Avancement" card: `X / Y étapes` + a slim progress bar + current-step text.
  - "Informations essentielles" section (single canonical metadata grid): Client, Pays, Responsable commercial, Date limite, Priorité, Référence, CDC source, Statut de la Fiche CDC, Dernière mise à jour.
  - "Activité récente": 3-item compact feed + "Voir tout l'historique" button that switches to the Historique tab.
- **Documents**
  - "CDC original" card: filename/size/date, Ouvrir + Télécharger links to `/api/appels-offres/[code]/pdf`.
  - "Fiche CDC" status card (`getBusinessFicheStatus`): Disponible / Validée / En cours de génération / À vérifier / En attente de génération, with an Ouvrir/Consulter button that switches to the Fiche CDC tab.
  - "Mettre à jour le CDC" card: file picker + "Remplacer le CDC" button → `PUT /api/appels-offres/[code]`.
- **Fiche CDC** — renders `<FicheEditor>` (`components/fiche-editor.tsx`):
  - 32 extraction fields (`lib/types.ts:14-69`) grouped into 6 sections: Informations générales, Client et projet, Cadre commercial, Besoins techniques, Contraintes, Délais. Each field can "jump" to its source page in an inline PDF viewer.
  - 3 evaluation fields: Complexité technique, Difficulté terrain, Risque de sous-dimensionnement.
  - A "contrôle" resolution workflow over three buckets — champs non trouvés, incohérences, à vérifier — each row markable resolved/ignored/commented (`lib/types.ts:96-119`).
  - "Enregistrer les modifications" (`PUT /api/fiche/[code]`) and "Valider la Fiche CDC" buttons (`components/fiche-editor.tsx:1508-1527`); the editor locks once validated.
- **FCI** — a merged pane (this merge was an explicit, user-directed change made earlier in this session; the CDC-processing content used to live in its own "Analyse" tab):
  - "Analyse du CDC" section: Prochaine étape guidance card with one action button, a failure callout when applicable, `<ProcessingTimeline>` + a processing summary grid (Statut/Démarrage/Durée/Prochaine action), the CDC upload/relaunch form (`AppelOffresAnalysisPanel`) shown only while relevant, and a collapsible "Détails techniques" (job/execution/correlation IDs).
  - `<FciWorkspace>` (`components/fci/fci-workspace.tsx`): header (Initialiser la FCI / Actualiser / Ouvrir la Fiche CDC), overview grid (Statut global, Progression %, "À vérifier" count, Source Fiche CDC freshness), 4 module cards A–D (Ouvrir/Générer/Régénérer/Valider/Historique, gated by `available_actions`) plus a permanently-disabled Module E "Retour d'expérience" card, and a per-module detail view (field editor with source/confidence/justification per field, Enregistrer/Réinitialiser/Valider/Générer/Régénérer/Historique/Actualiser, confirm dialogs, stale-source and version-conflict handling).
- **Historique** — full `ActivityFeed`, all business-safe audit events, grouped by day.

### Software analysis — `/appels-offres/[code]/analyse/logiciels` (`components/software-analysis-workspace.tsx`)

**Purpose:** manually compare one tender's software needs against the company catalogue — **no AI involved**, per `docs/appels-offres/software-analysis.md`.

- Status line (Brouillon → À valider → Validé) + Soumettre pour validation / Valider l'analyse / Rouvrir buttons.
- Sub-nav: **Logiciels** (active) · Compétences / Risques / Sources — all three tagged "Bientôt" (`components/software-analysis-workspace.tsx:440-454`).
- Summary strip: Besoins identifiés, Couverts, Partiellement couverts, Non couverts, À confirmer.
- Optional Excel import panel — **development only** (`showDevelopmentImportOptions = process.env.NODE_ENV !== "production"`, `app/appels-offres/[code]/analyse/logiciels/page.tsx:30`).
- Five CRUD sections, each with an add/edit form and a table: **Besoins**, **Correspondances**, **Logiciels manquants**, **Points à confirmer**, **Sources**. Row actions vary by section (Modifier/Valider/Rejeter, Modifier/Confirmer/Marquer manquant, Modifier/Valider, Modifier/Résolu, Modifier).

### Administration → Logiciels (`app/administration/logiciels/*`)

**Purpose:** master reference catalogue of company software (`docs/administration/software-catalogue.md`).

- List page: search/filter + "Ajouter un logiciel" / "Mettre à jour le catalogue" actions.
- Detail page: Statut badge, Création/Dernière modification timestamps, "Utilisation brute" text, alias chips; Modifier + archive/reactivate toggle.
- New/Edit pages: name, `descriptionRaw`, aliases.
- Import page: 2-step preview → confirm Excel flow; a "local dev example" option reads a private workbook path directly, kept out of production per `showDevelopmentImportOptions`.

---

## 3. Data model & status

### Tender business status enum

Source: `lib/appels-offres/presentation.ts` (`BusinessStatusKey` / `AppelOffresBusinessStatus`, also declared in `lib/appels-offres/types.ts:10-18`). 8 values:

| Value | Label shown | Meaning (`getStatusDescription`) |
|---|---|---|
| `brouillon` | Brouillon | Dossier créé, encore incomplet (no CDC yet) |
| `cdc_importe` | CDC importé | CDC stocké, prêt pour l'analyse |
| `en_attente_analyse` | En attente d'analyse | L'analyse peut être lancée dès que l'équipe est prête |
| `analyse_en_cours` | Analyse en cours | Traitement du CDC en cours |
| `fiche_a_valider` | Fiche CDC à valider | Fiche disponible pour revue commerciale |
| `fiche_validee` | Fiche CDC validée | Fiche validée, le dossier peut avancer |
| `erreur` | Erreur (raw) | Erreur bloque le traitement |
| `archive` | Archivé | Dossier archivé, hors circuit actif |

There is a **second, lower-level** stored status (`AppelOffresStatus`, `lib/appels-offres/status.ts`): `draft`, `processing`, `ready`, `error`, `archived`. It's the raw pipeline/DB status; `mapBusinessStatusToStoredStatus` (`lib/appels-offres/repository.ts`) maps the richer business status onto it. Bob never sees this second enum directly.

### Shared status→label / status→action mapping

Source: `lib/appels-offres/dashboard-status.ts` (re-exported by `lib/appels-offres/dashboard.ts` for backward compatibility). Used identically by the dashboard, the list page, and the tender header — this is the single point of truth the earlier UX-alignment work established.

Predicates combine the business status above with the FCI set's `overall_status`:
- `isDossierProcessing`: `analyse_en_cours`, or `fiche_validee` + FCI `in_progress`.
- `isDossierBlocked`: `erreur`, or `fiche_validee` + FCI `failed`.
- `isDossierComplete`: `fiche_validee` + FCI `validated`.

`buildDashboardStatusDisplay(summary, fciStatus)`:
- Blocked → label **"À vérifier"**, tone `warning` (soft amber — never red).
- Processing → label **"En cours d'analyse"**, tone `ai`.
- Else → the raw `statusLabel`/`statusTone` from the table above.

`buildDashboardRowAction(code, summary, fciStatus)` (drives every "next step" button on dashboard/list/detail):

| Condition | kind | Label | Target |
|---|---|---|---|
| Blocked | `retry` | Réessayer | `/appels-offres/{code}` |
| Processing | `processing` | *(none — spinner badge)* | — |
| `fiche_a_valider` | `validate` | Valider la Fiche CDC | `/appels-offres/{code}?view=fiche` |
| `fiche_validee`, FCI not validated | `generate` | Générer les analyses | `/appels-offres/{code}?view=fci` |
| `fiche_validee`, FCI validated | `consult` | Consulter | `/appels-offres/{code}?view=fci` |
| `archive` | `consult` | Consulter | `/appels-offres/{code}` |
| anything else (brouillon/cdc_importe/en_attente_analyse) | `open` | Ouvrir | `/appels-offres/{code}` |

`DashboardRowActionButton` (`components/dashboard-row-action-button.tsx`) renders either the `<Link>` above, or — for `kind === "processing"` — a non-interactive spinner + "En cours…" span.

### Other key entities

- **Fiche CDC status** (`FicheStatus`, `lib/types.ts:1`): `processing | draft | validated | error`. Distinct from the tender's business status; feeds `summary.ficheStatusLabel` ("Validée"/"À valider"/"En cours"/"En erreur"/"Non générée").
- **FCI** (`lib/appels-offres/fci/types.ts`):
  - Module codes: `A B C D E`; only A–D are `FCI_GENERATABLE_MODULE_CODES`; E is always gated behind `KNOWLEDGE_BASE_ENABLED`.
  - `FciSetOverallStatus`: `not_started, in_progress, needs_review, validated, failed`.
  - `FciModuleStatus`: `not_started, generating, generated, needs_review, validated, failed, unavailable`.
  - `FciGenerationJobStatus`: `pending_integration, created, queued, running, completed, failed, cancelled`.
  - Every AI-authored field is an `FciAiField<T>` carrying `value`, `source_type` (`fiche_cdc | ai_inference | internal_required | unavailable | not_applicable`), `confidence` (`high | medium | low | none`), `requires_human_input`, `justification`, `source_references[]` (`lib/appels-offres/fci/ai-contracts.ts:42-57`).
- **Documents** (`DocumentKind`, `lib/appels-offres/types.ts:24-28`): `source_pdf, fiche_xml, fiche_markdown, status_json`, stored on the filesystem under a per-code bundle (`lib/storage.ts`) and mirrored in `public.documents`.
- **Historique** = `public.audit_logs` rows mapped to business-friendly items by `mapAuditAction` (`lib/appels-offres/workspace.ts`), kinds: `created, cdc_received, cdc_replaced, analysis_started, analysis_completed, analysis_failed, fiche_generated, fiche_modified, fiche_validated, archived, reopened`.
- **Software analysis** (`lib/appels-offres/software-analysis-types.ts`): `SoftwareAnalysisReviewRecord.status ∈ {draft, submitted, validated}`; `TenderSoftwareMatchRecord.matchType ∈ {exact, alias, manual, possible, none}`; `.coverageStatus ∈ {covered, partially_covered, not_covered, to_confirm}`; `AnalysisConfirmationRecord.status ∈ {open, resolved, not_applicable}`.
- **Software catalogue** (`lib/administration/logiciels/types.ts`): `SoftwareRecord.status ∈ {active, archived}`.

---

## 4. Data sources & integrations

| Field / area | Source | Auto-extracted / manual / defaulted |
|---|---|---|
| CDC PDF | User upload on create or via "Mettre à jour le CDC" | Manual |
| 32 Fiche CDC extraction fields | Canonical n8n pipeline (Marker OCR → anonymization → LLM) → `POST /api/fiche/callbacks/n8n` | Auto-extracted, then human-editable in the Fiche CDC tab |
| 3 evaluation fields (complexité, difficulté terrain, risque) | Same pipeline | Auto-generated, editable |
| Fiche CDC "contrôle" flags (champs non trouvés / incohérences / à vérifier) | Same pipeline output | Auto-flagged, manually resolved |
| FCI module fields (A–D) | Dedicated FCI n8n webhook → Gemini → `POST /api/fci/callbacks/n8n` (signed, `lib/appels-offres/fci/service.ts`) | Mixed per-field: `ai_inference` (AI), `internal_required` (must be typed by Bob), `fiche_cdc` (copied from the Fiche), `unavailable`/`not_applicable` |
| Client / Pays / Titre | Extracted from the CDC by the same pipeline; fallback "En attente d'extraction" if empty | Auto-extracted |
| Responsable commercial, Priorité, Référence | No pipeline field feeds these | Manual / defaulted (`Priorité` defaults to "Normale") |
| Software catalogue (`Administration → Logiciels`) | Manual entry, or Excel import (`data/imports/private/referentiels/...xlsx`) via `/administration/logiciels/importer` | Implemented, production-usable |
| Per-tender software analysis rows | Manual entry, or a **development-only** Excel import (`showDevelopmentImportOptions`, `app/appels-offres/[code]/analyse/logiciels/page.tsx:30`) | Manual in production; dev-only import reads 5 of 7 sheets (`02_Besoins, 03_Par_logiciel, 04_Manquants, 05_Confirmations, 06_Sources`) — `00_Logiciels_source` and `01_Synthese` are intentionally left unstructured |
| Competency/skills analysis | Analyzed in `docs/data-analysis/company-reference-files-analysis.md` (a `.xls` workbook) with a full proposed entity model | **Not implemented** — no table, no import, no UI beyond the disabled "Compétences" tab |
| Employee/expert roster ("project base") | — | **Not implemented.** The doc explicitly states no employee source file was found; `Administration → Employés` is a disabled sidebar stub with no route |
| Equipment files | — | No mention anywhere in the codebase or docs found |
| Knowledge base (FCI Module E) | — | Stubbed behind `KNOWLEDGE_BASE_ENABLED`; no UI path to enable it, no backing data model beyond the flag check (`lib/appels-offres/fci/validation.ts:94-108`) |

External services this app actually calls (env vars per `docs/env-variables.md` and `docs/fci-orchestration.md`):
- Canonical CDC pipeline: `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_TOKEN`, `PLATFORM_CALLBACK_TOKEN`, `N8N_CALLBACK_SECRET`, `N8N_CONTRACT_VERSION`.
- FCI pipeline: `FCI_N8N_WEBHOOK_URL`, `FCI_N8N_WEBHOOK_TOKEN`, `FCI_CALLBACK_BEARER_TOKEN`, `FCI_CALLBACK_HMAC_SECRET`, `FCI_GENERATION_PROVIDER`/`MODEL`, `GEMINI_API_KEY` (n8n-side only).
- Both callback routes verify bearer token + HMAC signature and are idempotent by design (`lib/appels-offres/fci/service.ts:1123-1153`, `lib/appels-offres/analysis.ts:963-1037`).

---

## 5. Workflow as built

Step-by-step trace of everything a commercial user can actually complete today:

1. **Create** — topbar "Nouvel appel d'offres" → `/appels-offres/nouveau` → `AppelOffresForm` (code + PDF upload) → `POST /api/appels-offres` (`app/api/appels-offres/route.ts`). The record is created (`businessStatus: brouillon`) and analysis is launched in the same request.
2. **Auto-processing** — the server calls `launchAnalysisForAppelOffres` (`lib/appels-offres/analysis.ts`), which creates a `processing_job` and POSTs to the canonical n8n webhook; on 202 acceptance, `businessStatus → analyse_en_cours` and Bob is redirected into the tender page (flash `created-processing`, landing on what is now the FCI tab via the legacy `view=processing` alias).
3. **Callback** — n8n eventually calls `POST /api/fiche/callbacks/n8n`. On success, Fiche CDC files are written and `businessStatus → fiche_a_valider`; on failure, `businessStatus → erreur`.
4. **Review the Fiche CDC** — guided by the dashboard's "Fiches CDC à valider" item / the tender's single "Prochaine action" button, Bob opens the Fiche CDC tab, edits the 32 extracted fields, resolves flagged discrepancies, saves, then clicks **"Valider la Fiche CDC"** → `businessStatus → fiche_validee`, editor locks.
5. **Generate FCI modules** — Bob opens the FCI tab (FCI generation is only permitted once the Fiche CDC is validated — enforced server-side in `requireValidatedSourceFiche`, `lib/appels-offres/fci/service.ts:253-278`), initializes the workspace if needed, and for each of modules A–D clicks **"Générer"** → the FCI n8n webhook → Gemini → signed callback → module becomes `needs_review` with AI-authored fields.
6. **Review and validate each module** — Bob edits fields as needed (each save creates a new version) and clicks **"Valider le module"**; blocked while there are unsaved edits, and requires an explicit acknowledgement if the source Fiche CDC has since changed ("stale source").
7. **All modules validated** → the FCI set's `overall_status → validated`; this tender now counts toward the dashboard's "Terminés" KPI and the "Dossiers prêts pour l'offre" priority bucket.
8. **Optional, in parallel at any point**: Bob can open "Analyse des logiciels" from the tender's overflow menu and manually build/validate the software-needs-vs-catalogue comparison (Besoins → Correspondances → Manquants → Confirmations → Sources → Soumettre → Valider). This is a separate review track, not gated by or gating the Fiche CDC/FCI flow.
9. **Archiving** is available at any point (header overflow menu) and is reversible — it removes the tender from the default active list without deleting any files; it is a side-action, not a forward workflow step.

**The flow stops here.** Nothing in the codebase represents a next step after "FCI modules validated" (and, separately, "software analysis validated"). There is no screen, route, table, or even a disabled stub for: preparing/exporting an offer document, a Go/No-Go decision, submission tracking, or a competency/skills equivalent of the software analysis. The only forward-looking placeholders are disabled UI tags ("Bientôt") with no backing implementation (see §6).

---

## 6. Gaps & stubs

Everything present in the UI but non-functional, disabled, or dev-only:

| Item | Where | State |
|---|---|---|
| "Base de connaissances" sidebar link | `components/app-shell.tsx` | Disabled, "Bientôt" tag, no route exists |
| "Référentiels" sidebar link | `components/app-shell.tsx` | Disabled, "Bientôt", no route exists |
| "Employés" sidebar link | `components/app-shell.tsx` | Disabled, "Bientôt", no route exists |
| "Compétences" sidebar link | `components/app-shell.tsx` | Disabled, "Bientôt", no route exists |
| "Compétences" sub-nav (inside Analyse) | `components/software-analysis-workspace.tsx:440-454` | Disabled, "Bientôt" |
| "Risques" sub-nav (inside Analyse) | same | Disabled, "Bientôt" |
| "Sources" sub-nav (inside Analyse) | same | Disabled, "Bientôt" — **note:** a functional "Sources" *section* already exists inside the working "Logiciels" branch; the disabled sub-nav tab of the same name is a different, not-yet-built thing. Flagging this naming overlap rather than assuming they're the same feature. |
| FCI Module E ("Retour d'expérience") | `components/fci/fci-overview.tsx:111-124` | Always rendered disabled ("Base de connaissances non disponible"); gated by `KNOWLEDGE_BASE_ENABLED` env flag with no UI toggle |
| Software-analysis Excel import | `app/appels-offres/[code]/analyse/logiciels/page.tsx:30` | Functional but hidden in production (`NODE_ENV !== "production"` check) |
| Competency/skills analysis (whole feature) | `docs/data-analysis/company-reference-files-analysis.md` | Fully designed on paper (entity model, source workbook analysis) but **zero implementation** — no table, no API, no page beyond the disabled tab |
| Employee/expert roster | — | No implementation; docs confirm no source file exists yet |
| Role-based authorization | `docs/appels-offres/software-analysis.md`, `docs/administration/software-catalogue.md` | Explicitly documented as absent — all validate/submit/import actions are visible to anyone who can reach the page |
| `/initiation` page | `app/initiation/page.tsx` | Explicitly labeled legacy/compatibility in its own page header |
| `/api/generate` route | `app/api/generate/route.ts`, `docs/env-variables.md` | Documented legacy/compatibility alias of `POST /api/appels-offres/[code]/analyse` |
| `/api/fiche/[code]/complete` route | `app/api/fiche/[code]/complete/route.ts`, `docs/env-variables.md` | Documented legacy/compatibility predecessor of the canonical `/api/fiche/callbacks/n8n` callback |
| Offer preparation / Go-No-Go / submission tracking | — | Not present anywhere — not even as a disabled stub |

---

## Ambiguities flagged (not guessed)

1. **"Analyse" vs "FCI" tab** — the current single-FCI-tab structure (CDC-processing content stacked above the FCI module workspace) reflects a deliberate merge made earlier in this same session, on explicit user instruction to follow that literal wording. A BPMN diagram drawn against an older screenshot of this app would likely still show a separate "Analyse" step — worth confirming which point in time the diagram is meant to represent.
2. **"Sources" naming collision** — see the table in §6; the working Sources section (per-tender software analysis) and the disabled Sources sub-nav tab share a label but are not confirmed to be the same feature.
3. **`/fiche/[code]` and `/initiation` reachability** — no in-app link to either was found by this audit; they may be dead code, intentionally bookmark-only entry points, or reachable from an integration this audit didn't cover (e.g., an external system linking directly to `/fiche/[code]`).
4. **KNOWLEDGE_BASE_ENABLED** — no `.env` value for this flag was inspected as part of this read-only audit (deliberately avoided touching environment/config), so whether Module E is actually reachable in any deployed environment is unconfirmed either way.
