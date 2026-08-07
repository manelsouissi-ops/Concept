# CONCEPT Platform — Full Audit

Audit date: 2026-08-02
Repository: `C:\Users\lotfi\Documents\Concept`
Branch reviewed: `feat/rbac` (HEAD `3a1eded`, plus uncommitted working-tree changes)
Method: direct reading of source code, `docs/`, root-level planning/summary documents, and `git log`. No code was changed to produce this report. Every major claim is cited to a real file path (and line number where practical). Anything that could not be vebrified from the repository is explicitly flagged as **AMBIGUITY**.

---

## 1. Overview & Purpose

CONCEPT is a Next.js 15 / React 19 / TypeScript internal platform for managing **Appels d'offres** (tenders/RFPs). Per `README.md:1-3`, the project started as "Concept - CDC Initiation and Fiche Project Workflow": upload a CDC (**Cahier des Charges**, the tender's requirements document) PDF, trigger an asynchronous n8n pipeline that extracts and structures the document (Marker → LLM → XML), and let a human reviewer edit and validate the resulting "Fiche CDC" (`README.md:1-10, 75-88`).

The business problem it solves, as captured in `PROJECT_AUDIT.md` and `APPELS_OFFRES_IMPLEMENTATION_PLAN.md:42-47`, is that the original prototype was "essentially a CDC upload and Fiche review tool," with no real tender/opportunity object, no departmental workflow, and no audit trail. The platform was subsequently rebuilt around a proper root business entity, **`Appel d'offres`**, with the Fiche CDC as an attached artifact rather than the primary object (`APPELS_OFFRES_IMPLEMENTATION_PLAN.md:42-47`). It has since grown a second major capability: **FCI** (department-specific structured forms — see Glossary, §10) generated per tender for Commercial, Finance, Operations, and Direction Générale, each independently AI-drafted, human-edited, and validated, feeding toward a final Go/No-Go decision (`docs/rbac-mvp.md:1-27`, `docs/fci-orchestration.md:1-16`).

**Intended user.** The primary day-to-day user is a commercial employee (`COMMERCIAL` role), who creates tenders and owns FCI module A. The platform also serves `FINANCE`, `OPERATIONS`, and `DIRECTION_GENERALE` roles (each owning one FCI module) and an `ADMIN` role with full access, including user and software-catalogue administration (`lib/auth/rbac.ts:81-86`, `docs/rbac-mvp.md:11-19`).

**"Digital assistant, not an AI app" principle.** **AMBIGUITY:** this exact phrase (or "calm status" / "contextual actions" in English / "hidden technical complexity") does **not** appear anywhere in the repository — a case-insensitive full-text search across every Markdown file, including `README.md`, found zero matches. The closest attested language toward this idea:
- `FRONTEND_REDESIGN_PLAN.md`: the `ProcessingStatus` component should be "a business summary of processing **without exposing n8n details** to the standard user" (paraphrased from French).
- `DESIGN_SYSTEM_V1_PLAN.md`: "The target feel is dense but **calm**, suitable for enterprise operations."
- `WORKSPACE_EXPERIENCE_V1_PLAN.md`: an explicit rule that "the UI must not fabricate... progress percentages" or stages "not evidenced by job state."
- `FRONTEND_REDESIGN_PLAN.md` lists "actions contextuelles" (French for "contextual actions") as a required `AppShell` capability.
If the "digital assistant, not an AI app" framing came from a verbal briefing or a document not present in this repository, it cannot be substantiated here.

---

## 2. Conception & Design Decisions

*(This section reflects a dedicated read of all root-level `*_PLAN.md`/`*_SUMMARY.md` documents, `docs/fci-template-audit.md`, `docs/fci-field-schema.md`, `docs/fci-ui-plan.md`, and related files, cross-checked against `git log`.)*

### 2.1 Why `Appel d'offres` became the root entity
- `APPELS_OFFRES_IMPLEMENTATION_PLAN.md:42-47`: *"`Appel d'offres` is now the root application entity. The existing Fiche CDC remains an attached artifact in the same bundle."*
- `UX_PHASE1_REFINEMENT_SUMMARY.md` documents the front-end consequence: navigation was pruned to `Tableau de bord / Appels d'offres / Nouvel appel d'offres`, `/initiation` was removed from primary navigation (kept only as a legacy route — confirmed in code: `components/app-shell.tsx:195-200` marks it "Legacy" and it's not in the sidebar), and copy changed from "dossier" to "appel d'offres" throughout.

### 2.2 Why PostgreSQL + filesystem split, and why PostgreSQL became authoritative
- The original prototype used disk (`data/{code}/`) as the source of truth and Postgres as a "secondary synced index" (`PROJECT_AUDIT.md`, per `README.md:183-187`, still true today: *"The app currently uses `data/<code>/` on disk as the primary fiche state. PostgreSQL acts as a synced index layer, not the single source of truth."*).
- `CANONICAL_PLATFORM_N8N_CONTRACT.md` codifies a data-ownership rule: *"Platform owns persistent business data. n8n owns only transient execution state and temporary files."* Its state-ownership table assigns PDF/Markdown/XML to Platform-owned persisted storage even though n8n generates them transiently.
- `N8N_PLATFORM_INTEGRATION_AUDIT.md` §6.3 recommends making PostgreSQL authoritative for job/processing state while treating `cdc_fiches.fiches_projet` as "a searchable projection, not the operational source of truth" — implemented per `PLATFORM_N8N_CONTRACT_IMPLEMENTATION_SUMMARY.md` ("PostgreSQL is now the authoritative job source").
- **Current architectural reality (per `PROJECT_AUDIT_2026.md`, Technical Architecture Review):** the split still exists today and is flagged as the platform's second-biggest structural weakness — "PostgreSQL for core metadata, filesystem storage under `data/{code}` for PDF/XML/derived artifacts, a mirrored fiche representation in PostgreSQL" without strong transactional guarantees.

### 2.3 Why the canonical n8n contract has its specific shape (JSON envelope, correlation IDs, provider-neutral error stages)
- `N8N_PLATFORM_INTEGRATION_AUDIT.md` is the diagnostic that forced this redesign: it found the pre-canonical integration unsafe to connect as-is — a hardcoded `http://localhost:3000` callback URL, an error-stage vocabulary that hadn't been updated after a Groq→Gemini provider migration, and evidence that n8n executions could be marked "success" while the actual pipeline had failed on the Gemini step ("workflow success does not currently mean application success").
- `CANONICAL_PLATFORM_N8N_CONTRACT.md` (v1.0) is the resulting specification. Its rationale for provider-neutral stage names: *"Provider-specific names such as GROQ, GEMINI, or OLLAMA must not be used as canonical stages... This keeps the contract stable even if the LLM provider changes."* Verified in code: `lib/integrations/n8n-contract.ts` defines `N8N_ERROR_STAGES` as `WEBHOOK, UPLOAD, MARKER, MARKDOWN, ANONYMIZATION, LLM, XML, CALLBACK, UNKNOWN` — generic pipeline stages, no provider names.
- Idempotency design: distinct `processing_job_id` (business record), `correlation_id` (per-attempt idempotency key), and `execution_id` (n8n's own run id) exist specifically so retries and duplicate/late callbacks can be classified deterministically without corrupting state (`CANONICAL_PLATFORM_N8N_CONTRACT.md` §9; implemented in `lib/appels-offres/repository.ts` processing_jobs schema, see §5).
- `N8N_CANONICAL_CONTRACT_IMPLEMENTATION_SUMMARY.md` documents the difficulty of implementing this inside n8n's JS task-runner sandbox (no `require('crypto')`, `fs`, `path`, or direct `process.env` access), which led to a dedicated local HMAC "signer hop" service (`N8N_CALLBACK_SIGNER_URL`) so the workflow could produce `X-Callback-Signature` without calling Node's `crypto` module directly.

### 2.4 Why FCI has a department split (DC/DF/DO/DG) plus a "generic" consolidated model
- `docs/fci-template-audit.md`: the split is inherited directly from five pre-existing Word templates found under `ai/templates/fci/` (`FCI_DC.docx`, `FCI_DF.docx`, `FCI_DG.docx`, `FCI_DO.docx`, and a "modèle générique"), not invented by engineering. DC→Fiche A (competitive/logistics watch), DF→Fiche B (financial analysis), DG→Fiche D (strategic positioning), DO→Fiches C+E (resources & feedback).
- The same audit explicitly flags an **unresolved inconsistency**: the generic template's tracking table uses letters `A/B/D/E/F` while each department's own document body uses `A/B/C/D/E` — logged as "to be validated before implementation," with no later document confirming resolution.
- `docs/fci-field-schema.md` operationalizes this into a namespaced field schema (`common.*`, `dc.*`, `df.*`, `do.*`, `dg.*`) with an explicit design rule: the generic/consolidated template *"must not introduce a second data schema — it must reuse `common.*`, `dc.*`, `df.*`, `do.*`, `dg.*`."*
- `docs/fci-ui-plan.md` mirrors this at the UI layer and adds a governance rule: certain fields (e.g. `E3. Standards et habitudes du client`, `E4. Recommandations`, all Go/No-Go arbitrations) are marked "expertise humaine" and must stay empty until a human fills them — never AI-prefilled.

### 2.5 BPMN / formal process model
A repo-wide search for "BPMN" returns exactly **one** hit, in `CURRENT_INTERFACE_RECAP.md:264`, and it is a hypothetical aside by that document's own author ("a BPMN diagram drawn against an older screenshot... would likely still show a separate 'Analyse' step — worth confirming"), not a reference to an actual diagram. **No BPMN file, image, or dedicated process-modeling doc exists anywhere in the repository.** The de-facto process model is instead expressed as the tender status enum and FCI module lifecycle (see §5).

### 2.6 ADRs / decision log
There is no `docs/adr/` or `decisions/` directory. Architecture rationale lives as prose inside the paired `*_PLAN.md` / `*_SUMMARY.md` documents at the repo root and inside `CANONICAL_PLATFORM_N8N_CONTRACT.md`, which functions as the closest thing to a formal spec/ADR (it even closes with a supremacy clause: *"If platform behavior and n8n behavior conflict, this document wins."*).

### 2.7 UX principles applied, with code locations
- **Async, non-blocking pipeline** (avoids UI hangs on long AI jobs): `docs/incidents.md` ("2026-07-09 — Synchronous webhook coupling was the wrong shape") documents the original synchronous design breaking on real CDCs and the fix — `POST /api/generate` now returns `202 Accepted` immediately and the UI polls status. This pattern persists today across `GET /api/fiche/[code]/status` (polled every 5s by `components/fiche-editor.tsx`) and the FCI workspace (`components/fci/fci-workspace.tsx`, polls every 4s while any module is `generating`).
- **No fabricated progress**: `WORKSPACE_EXPERIENCE_V1_PLAN.md`'s rule against fake percentages/stages is reflected in `components/processing-timeline.tsx` and the FCI `summary.completion_percentage` field, which is computed server-side from actual field-fill state rather than a hardcoded UI value (`lib/appels-offres/fci/presentation.ts`, per the data-model agent's findings).
- **Hiding technical orchestration from business users, exposing it on demand**: the FCI/analysis tab shows a business-facing status card by default with a collapsed `<details>` "Détails techniques" panel (Job ID / Execution ID / Correlation ID / contract version) — `components/appel-offres-workspace.tsx` (per §4).
- **Read-only clarity over hidden buttons**: `docs/rbac-mvp.md:30` states explicitly, "The MVP does not rely on hidden buttons alone" — every FCI module stays visible for every role, with a clear read-only message for non-owners, rather than disappearing UI (`lib/auth/rbac.ts:206-221`, rendered in `components/fci/fci-module-card.tsx`).

---

## 3. Tech Stack & Architecture

### 3.1 Stack (from `package.json`)
- **Framework**: Next.js `^15.0.0` (App Router), React `^19.0.0` / React DOM `^19.0.0`.
- **Language**: TypeScript `^5.7.2`, strict-mode scripts (`npm run typecheck` → `tsc --noEmit`).
- **Database**: PostgreSQL via `pg ^8.22.0` (raw SQL, no ORM — schema is created/migrated imperatively by `ensure*Schema()` functions in each `repository.ts`, see §5).
- **XML**: `fast-xml-parser ^4.5.1` (Fiche CDC XML parse/serialize, `lib/fiche-xml.ts`).
- **PDF**: `pdfjs-dist ^6.1.200` (client-side PDF.js viewer served from `/public/pdfjs/pdf.mjs`).
- **Excel**: `xlsx ^0.18.5` (software-catalogue and software-analysis import).
- **JSON Schema validation**: `ajv ^8.17.1` (Ajv 2020-12, ai-generated FCI payload validation).
- **Auth (new, uncommitted)**: `bcryptjs ^3.0.3` — added to `package.json` but not yet part of any committed change (see §8).
- **Dev tooling**: `cross-env`, `dotenv`, `@types/*`.
- No ORM, no test framework dependency is declared in `package.json` (tests use Node's built-in test runner via `node --experimental-strip-types`, per `package.json:11`, `:15`), no CSS framework (styling is a single large `app/globals.css`, flagged as technical debt in `PROJECT_AUDIT_2026.md` §Technical Debt #3).

### 3.2 High-level architecture
```
Browser (React 19 client components)
   │
   ▼
Next.js App Router
   ├── app/**/page.tsx        — server components, page-level data fetching + RBAC page gates
   └── app/api/**/route.ts    — API routes (thin handlers)
        │
        ▼
lib/ domain layer (no ORM — hand-written SQL)
   ├── lib/appels-offres/            — tender CRUD, status, dashboard, workspace mapping, analysis launch
   ├── lib/appels-offres/fci/        — FCI module set/data/jobs, AI contracts, exports
   ├── lib/appels-offres/software-analysis-*  — per-tender software gap analysis
   ├── lib/administration/logiciels/ — software catalogue
   ├── lib/users/                    — app_users/app_departments, dev-user switcher
   ├── lib/auth/                     — RBAC policy (rbac.ts) + current-user resolution
   ├── lib/integrations/             — canonical CDC/Fiche n8n contract
   └── lib/fiche-xml.ts, lib/db.ts   — legacy Fiche CDC XML + pgvector index
        │
   ┌────┴─────────────────────────┐
   ▼                               ▼
PostgreSQL (public schema +      Filesystem: data/{code}/
cdc_fiches schema)               cdc.pdf, fiche.xml, cdc.md, status.json
   │
   ▼
Two separate n8n contracts:
 1. Canonical CDC/Fiche contract  → POST {N8N_WEBHOOK_URL} launch,  POST /api/fiche/callbacks/n8n callback
 2. Dedicated FCI contract        → POST {FCI_N8N_WEBHOOK_URL} launch, POST /api/fci/callbacks/n8n callback
        │
        ▼
n8n workflow runtime (external, own SQLite DB, workflow id f866bd39869c4c11 "CDC Initiation - Fiche Projet XML")
   Marker (PDF→Markdown) → anonymization → Gemini (gemini-3.6-flash, OpenAI-compatible endpoint) → XML/JSON
        │
        ▼
Signed callback (HMAC-SHA256 + bearer token) back to Next.js
```
(Architecture confirmed both by direct code reading — §5, §7 — and by `PROJECT_AUDIT_2026.md`'s own "Architecture discovered" diagram, which matches.)

### 3.3 Document-processing pipeline end to end

**A) CDC → Fiche CDC pipeline (canonical contract)**
1. User uploads a CDC PDF via `/appels-offres/nouveau` or `/initiation` → `POST /api/appels-offres` or `POST /api/generate`.
2. The platform stores the PDF to `data/{code}/cdc.pdf`, creates an `appels_offres` row and a `processing_jobs` row (`job_type: appel_offres_upload` or `fiche_generation`), then calls `launchAnalysisForAppelOffres(...)` (`lib/appels-offres/analysis.ts`), which POSTs a canonical launch request to `N8N_WEBHOOK_URL` with headers `Authorization: Bearer {N8N_WEBHOOK_TOKEN}` and `X-Contract-Version` (`lib/integrations/n8n-config.ts`, `lib/integrations/n8n-contract.ts:34-43`).
3. n8n runs **Marker** (PDF→Markdown chunking/conversion — inferred from the `MARKER` error stage in `N8N_ERROR_STAGES` and the `MARKER_CONVERT_URL`/`MARKER_STATUS_URL`/`MARKER_RESULT_URL` env vars in `docs/env-variables.md:62-64`; the Marker service integration itself lives in the external n8n workflow, not in this Next.js repo), merges/anonymizes the resulting Markdown, then calls **Gemini** (`gemini-3.6-flash`, via Google's OpenAI-compatible endpoint `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, per `docs/gemini-api-diagnostic.md:56-74`) to produce structured XML.
4. n8n signs the callback body (`HMAC-SHA256` over `{timestamp}.{raw body}`, via a dedicated signer hop since n8n's task runner cannot call `crypto` directly — `N8N_CANONICAL_CONTRACT_IMPLEMENTATION_SUMMARY.md`) and POSTs to `PLATFORM_PUBLIC_BASE_URL + /api/fiche/callbacks/n8n` with `Authorization: Bearer {PLATFORM_CALLBACK_TOKEN}`, `X-Callback-Timestamp`, `X-Callback-Signature: sha256=...`.
5. `app/api/fiche/callbacks/n8n/route.ts` verifies auth (`lib/integrations/n8n-callback-auth.ts`), validates the payload (`validateCallbackPayload`), and calls `applyCanonicalN8nCallback(...)` (`lib/appels-offres/analysis.ts`) to persist the XML/Markdown, flip status to `draft`/`error`, and write an audit log.
6. A legacy path exists: `POST /api/fiche/[code]/complete` (shared-secret-only auth via `N8N_COMPLETE_SECRET`/`X-Complete-Secret`), which converts its simpler body into the same canonical envelope and calls the identical `applyCanonicalN8nCallback` — kept for backward compatibility (`README.md:107-109`, `docs/env-variables.md:46-50`).
7. The user reviews/edits the Fiche CDC in `FicheEditor` and validates it (`POST /api/fiche/[code]/validate`), which requires zero unresolved `controle` items and flips business status to `fiche_validee`.

**B) Fiche CDC → FCI pipeline (dedicated FCI contract)**
1. Once a tender has a validated Fiche CDC, a user with the right department role opens the FCI tab and clicks "Générer" on their module → `POST /api/appels-offres/{code}/fci/{module}/generate`.
2. The platform builds a launch payload that embeds the **full prompt text** and **JSON Schema** for that module (loaded from `ai/prompts/fci-*.md` and `ai/schemas/fci-*.schema.json`, versioned via `lib/appels-offres/fci/contract-registry.ts`) plus the full `fiche_cdc` payload, and POSTs it to `FCI_N8N_WEBHOOK_URL` (`lib/appels-offres/fci/service.ts`, `lib/appels-offres/fci/n8n-contract.ts:36-72`).
3. n8n calls Gemini with that exact prompt/schema, validates the JSON response against the schema itself, then signs and POSTs a callback to `PLATFORM_PUBLIC_BASE_URL + /api/fci/callbacks/n8n`.
4. `app/api/fci/callbacks/n8n/route.ts` verifies auth (same HMAC pattern, FCI-specific secret `FCI_CALLBACK_HMAC_SECRET`), checks content-type, contract version, then calls `applyFciN8nCallback(...)`, which **re-validates** the payload against the module's Ajv JSON Schema (`lib/appels-offres/fci/ai-validation.ts`) before persisting a new `fci_module_data` version.
5. The module status becomes `needs_review`; a department user edits/saves the draft (`PUT /api/appels-offres/{code}/fci/{module}`) and validates it (`POST .../validate`), or exports it to Word/PDF (`GET .../export?format=docx|pdf`, using templates in `ai/templates/fci/`).

**Env vars governing both pipelines**: fully enumerated in `docs/env-variables.md` (canonical) and `docs/fci-orchestration.md:247-267` (FCI-specific) — see §7 for the complete list and the platform-vs-n8n-side split.

---

## 4. Page-by-Page Inventory

*(Produced by an exhaustive read of every `app/**/page.tsx` and its rendered components. File:line citations are preserved as gathered.)*

### `/` — `app/page.tsx`
Immediately calls `redirect("/dashboard")` (`app/page.tsx:4`). No content of its own. **Note:** `PROJECT_AUDIT_2026.md` flags this as inconsistent with a stated product direction that `/` should lead into the Appels d'offres flow rather than the dashboard.

### Root layout — `app/layout.tsx`
Wraps every route. Resolves the current user via `resolveCurrentUserFromServerHeaders()` (`app/layout.tsx:18`, `lib/auth/current-user.ts:72`) — there is no real authentication; "current user" always resolves through a development-mode, database-persisted user-switcher, with a hardcoded fallback identity `Bob Durand`/`ADMIN` (`lib/auth/current-user.ts:9-30`). Outside production it also loads `getDevelopmentUserState()` for the dev switcher (`app/layout.tsx:19-29`). Renders `AppShell` (`components/app-shell.tsx`) around all page content.

`AppShell` provides:
- Sidebar: "Tableau de bord" (`/dashboard`), "Appels d'offres" (`/appels-offres`) always enabled; an "Administration" group with "Utilisateurs"/"Logiciels" — disabled for non-`ADMIN` via `canAccess(currentUser.role, "administration")` (`app-shell.tsx:305-308`); permanently-disabled placeholders "Référentiels", "Employés", "Compétences"; an "Upcoming" group with a disabled "Base de connaissances".
- Topbar: mobile sidebar toggle, breadcrumb, a disabled notifications bell ("Bientôt disponibles"), a user menu linking to `/profile` and `/settings`, a disabled "Déconnexion" link, and — dev mode only — a "Mode développement" user switcher (`PUT /api/development/current-user` then `router.refresh()`).
- A contextual primary CTA in the topbar (e.g. "Nouvel appel d'offres") driven by route metadata.

### `/dashboard` — `app/dashboard/page.tsx` (+ `loading.tsx`)
**Purpose**: landing page with aggregate stats, recent tenders, priority actions, recent activity, from `getDashboardData()` (`lib/appels-offres/dashboard.ts`). **Who**: all roles (no server-side RBAC gate; a `dashboard.view` permission constant exists in `lib/auth/rbac.ts:15` but is never enforced here).
Sections:
1. Hero banner — **hardcoded** `"Bonjour Bob"` (`app/dashboard/page.tsx:184`), regardless of who is actually signed in.
2. Stats strip (Total / Nouveaux / En cours d'analyse / À valider / Terminés) — each cell links to `/appels-offres?status=...` when count > 0.
3. "Appels d'offres récents" table (`DashboardRecentAppelsTable`) with "Voir tout" → `/appels-offres`; each row has a status-aware action button (`DashboardRowActionButton`).
4. "Actions prioritaires" — up to 5 conditional task items (fiches à valider, analyses FCI à générer, dossiers prêts pour l'offre, dossiers à vérifier, échéances proches), each linking into a filtered `/appels-offres` view.
5. "Activité récente" — `ActivityFeed` of the 3 latest events, using a **hardcoded** "now" reference (`2026-07-22T12:00:00+02:00`, `app/dashboard/page.tsx:99`) for relative-date labels, not `Date.now()`.
6. Empty state (zero tenders): CTA → `/appels-offres/nouveau`.
7. On any thrown error, renders an `EmptyState` with the error message instead of crashing.

### `/appels-offres` — `app/appels-offres/page.tsx` (+ `loading.tsx`)
**Purpose**: search/filter/list all tenders (including archived). **Who**: all roles.
Controls (`components/appels-offres-list-view.tsx`): search box (code/title/client/country/status), status select, sort select; "Filtres avancés" (client, pays, priorité, "Afficher les archives" checkbox); Tableau/Cartes view toggle; pagination. Per row: click → `/appels-offres/{code}`; status-driven quick action button; `⋯` menu → "Modifier" (→ detail), "Télécharger le CDC" (`GET /api/appels-offres/{code}/pdf`, if a source PDF exists), "Archiver"/"Désarchiver" (`POST .../archive` or `/unarchive`, with a confirm prompt).

### `/appels-offres/nouveau` — `app/appels-offres/nouveau/page.tsx` (+ `loading.tsx`)
Renders `AppelOffresForm` in `mode="create"`: auto-suggested code + PDF upload. Submit → `POST /api/appels-offres` (multipart), server creates the record and launches analysis, returns a `redirect_url` the client follows (defaults to `/appels-offres/{code}?view=fci`); on launch failure the API still returns 201 with a `launch-failed` redirect so the user lands on the workspace with a warning banner. "Annuler" → `/appels-offres`.
**AMBIGUITY**: `AppelOffresForm`'s `mode="edit"` branch (`components/appel-offres-form.tsx:324-602` — full dossier form, "Archiver", "Voir le CDC") is fully built but is **not wired to any route** — dossier editing in practice happens inside the workspace's Fiche CDC/Documents tabs instead. Likely dead code pending a future `/appels-offres/[code]/modifier` route.

### `/appels-offres/[code]` — `app/appels-offres/[code]/page.tsx` (+ `loading.tsx`)
**Purpose**: the main per-tender workspace. Loads detail + FCI overall status, syncs stored-document metadata, interprets `?view=`/`?flash=` query params. **Who**: all roles view it; RBAC applies at the action level inside the FCI tab.

Renders `AppelOffresWorkspace` (`components/appel-offres-workspace.tsx`) with `WorkspaceHeader` and 5 tabs (`components/workspace-tabs.tsx`): **Aperçu, Documents, Fiche CDC, FCI, Historique** (`appel-offres-workspace.tsx:45-51`). Tab switches update `?view=` via `router.replace`.

**Header**: "Retour à la liste"; code/title/status badge/client/deadline; `⋯` menu built by `buildWorkspaceActions(appel)` (`lib/appels-offres/workspace.ts:405-516`): "Réviser/Consulter la Fiche CDC" (if a fiche exists), "Valider la Fiche CDC" (if `ficheStatus === draft`), "Télécharger le CDC" (if a source PDF exists), "Modifier la Fiche CDC" (always), "Archiver"/"Réactiver"; plus a static "Analyse des logiciels" link.

**Aperçu tab**: "Prochaine action" card (single dynamic primary button from `getOverviewPrimaryAction`); "Avancement" progress card; "Informations essentielles" read-only summary; "Activité récente" (3 items) with a button that switches to Historique.

**Documents tab**: "CDC original" card ("Ouvrir"/"Télécharger" → `GET /api/appels-offres/{code}/pdf`, or empty state); "Fiche CDC" card (status badge + "Ouvrir/Consulter" switching tabs); "Mettre à jour le CDC" card (file picker → `PUT /api/appels-offres/{code}`, replaces the PDF, sets status `processing`, creates an `appel_offres_update` job).

**Fiche CDC tab**: renders `FicheEditor` (`components/fiche-editor.tsx`) — detailed below.

**FCI tab**: two stacked sections:
1. "Analyse du CDC" — status-toned guidance card with a single primary action (launch/retry analysis, validate fiche, or open fiche); failure callout on job failure; `ProcessingTimeline` + summary grid; `AppelOffresAnalysisPanel` (upload/launch/re-launch controls, shown while not running and no fiche yet / retry available / launch is the primary action); collapsible "Détails techniques" (Job ID / Execution ID / Correlation ID / contract version / callback status / error stage/code).
2. `FciWorkspace` (`components/fci/fci-workspace.tsx`) — see below.

**Historique tab**: full `ActivityFeed` (`variant="history"`) from `buildWorkspaceActivityFeed(appel)`.

Action dispatch (`appel-offres-workspace.tsx:714-747`): `launch-analysis` → `POST /api/appels-offres/{code}/analyse` then switch to FCI tab; `open-processing` → FCI tab; `open-fiche`/`validate-fiche` → Fiche tab; `download-cdc` → open PDF; `edit-overview` → Fiche tab; `archive`/`unarchive` → `POST .../archive` or `/unarchive`. Flash banners: `created-processing`, `launch-failed`, `analysis-started`.

**FCI Workspace detail** (`components/fci/fci-workspace.tsx`): loads `GET /api/appels-offres/{code}/fci`, polls every 4s (max 30 attempts) while any module is `generating`.
- **Not-initialized state**: `FciEmptyState` + "Initialiser la FCI" → `POST /api/appels-offres/{code}/fci/initialize`.
- `FciHeader`: code/title, overall status badge, progression %, validated-module count, source fiche version, current user; buttons "Initialiser la FCI" (if no modules yet), "Actualiser", "Ouvrir la Fiche CDC".
- `FciOverview`: stat cards (statut global, progress bar, "à vérifier" count, source status); warning if source fiche still `draft`; grid of `FciModuleCard`s for modules A–D.
  - Each `FciModuleCard`: module code/department label, status badge, description, progression %, obligatoires filled/total, last-saved date, validated-by/date, generating note, RBAC read-only message, error callout. Buttons: "Ouvrir/Continuer", "Générer" (if `generate` in `available_actions`), "Régénérer" (if allowed), "Valider" (if allowed), "Historique" (always); all disabled while another action is in flight.
- Selecting a module (`?fciModule=A|B|C|D`) opens `FciModuleView` — the single-module editor:
  - Loads module + history in parallel; builds an editable payload (existing / empty scaffold / raw-JSON fallback for unrecognized historical payloads).
  - `FciModuleHeader` (title, back, contract-version badge); callouts for read-only, version conflict ("Recharger la dernière version" / "Conserver mes modifications"), validation errors, stale source, unvalidated source, already-validated-but-dirty, unsupported payload.
  - Summary grid: progression, statut formulaire, source (version + freshness), génération IA (model + job status).
  - Sticky action bar (`components/fci/fci-module-actions.tsx` + `fci-module-actions-state.ts`), RBAC- and dirty-state-gated:
    - *Primary*: "Enregistrer le brouillon" (`can_edit`, needs dirty) → `PUT .../fci/{module}`; "Marquer comme terminé" (`can_validate` + allowed, blocked if dirty) → confirm dialog (with explicit stale-source acknowledgement if needed) → `POST .../validate`; "Lancer la génération" (`can_generate` + allowed) → confirm → `POST .../generate`; "Relancer la génération" (`can_regenerate` + allowed) → confirm → `POST .../regenerate`.
    - *Secondary*: "Réinitialiser les modifications" (local revert, no API call); "Voir l'historique" (scroll); "Actualiser" (reload).
    - *Export*: "Télécharger Word"/"Télécharger PDF" (whenever data exists) → `GET .../export?format=docx|pdf`.
  - RBAC mapping (client- and server-enforced): module **A** → `COMMERCIAL`, **B** → `FINANCE`, **C** → `OPERATIONS`, **D** → `DIRECTION_GENERALE`; `ADMIN` can act on any module; every other role is read-only with the message "Lecture seule : seul {rôle} peut modifier ce module." (`lib/auth/rbac.ts:206-221`).
  - **AMBIGUITY**: module **E** and the `canMakeFinalDecision` RBAC helper are both defined in `lib/auth/rbac.ts` but have **no reachable UI surface** — only A–D appear in `getFciModuleDefinitions()`; no page/component calls `canMakeFinalDecision`. A "final Go/No-Go decision" concept exists in the permission model but is not wired into any screen yet.

### `/appels-offres/[code]/analyse/logiciels` — `app/appels-offres/[code]/analyse/logiciels/page.tsx`
**Purpose**: compares CDC software requirements against the internal software catalogue. **Who**: all roles.
`SoftwareAnalysisWorkspace`: topbar ("Retour au dossier", status badge); header actions ("Soumettre pour validation" if `draft`, "Valider l'analyse" if `submitted`, "Rouvrir" otherwise, dev-only Excel-import toggle outside production); sub-nav ("Logiciels" active; "Compétences"/"Risques"/"Sources" disabled, "Bientôt"); summary grid (identified/covered/partially/not-covered/to-confirm counts); dev-only Excel import panel (`POST .../import/preview` then `/import/confirm`); five editable sections — **Besoins** (validate/reject), **Correspondances** (confirm/mark-missing, with auto-suggested catalogue matches), **Logiciels manquants** (validate), **Points à confirmer** (mark resolved), **Sources** — each with an inline add/edit form posting a discriminated `action` to `POST /api/appels-offres/{code}/analyse/logiciels`.

### `/initiation` — `app/initiation/page.tsx`
**Purpose**: legacy entry point generating a Fiche CDC directly from a code + PDF, bypassing the Appel d'offres workflow. Not in the sidebar (breadcrumb-flagged "Legacy"). `InitiationForm` → `POST /api/generate`; on 409 with `requiresConfirmation`, offers "Confirmer et écraser" (`force_regenerate=true`). The server auto-creates a compatibility `appels_offres` record if none exists.

### `/fiche/[code]` — `app/fiche/[code]/page.tsx` (+ `loading.tsx`)
Standalone Fiche CDC review page (same `FicheEditor` used inside the workspace's Fiche CDC tab, without `onReviewStateChange`).

**`FicheEditor` detail** (`components/fiche-editor.tsx`): polls `GET /api/fiche/{code}/status` every 5s while `processing`.
- Processing state: elapsed-time card.
- Unavailable/error state: explains failure cause, "Relancer l'analyse" (if error) → `POST /api/generate` with `force_regenerate=true`.
- Loaded state: "Informations du dossier" (editable, disabled once locked i.e. status ≠ `draft`); "Informations extraites par l'IA" (grouped textareas, each with a review-state badge and a "Source :" button that jumps to the matching Markdown line and PDF page); "Données commerciales" (per-field note 1–5 + justification, "Charge estimée" for the sous-dimensionnement risk field); "Contraintes et points à vérifier" (three lists — champs non trouvés / incohérences / à vérifier — each with a resolution-status select); "Sources et remarques IA" (Markdown viewer + PDF.js-based `PdfViewerPanel`). Footer (only when unlocked): "Enregistrer les modifications" (`PUT /api/appels-offres/{code}` then `PUT /api/fiche/{code}`); "Valider la Fiche CDC" (disabled unless draft, not pending, zero unresolved items) → confirm → save + `POST /api/fiche/{code}/validate`.

### `/administration/logiciels` — `app/administration/logiciels/page.tsx`
`ADMIN`-only (`requireAreaAccessForPage("administration")`, else `forbidden()`). Header: "Mettre à jour le catalogue" → `/importer`; "Ajouter un logiciel" → `/nouveau`. `SoftwareListView`: search + status filter; per-row "Ouvrir", `⋯` menu "Modifier"/"Archiver"/"Réactiver" (`POST .../archive` or `/reactivate`).

### `/administration/logiciels/nouveau`, `/[id]`, `/[id]/modifier`, `/importer`
All `ADMIN`-only. `nouveau`: `SoftwareForm mode="create"` → `POST /api/administration/logiciels`. `[id]`: detail (404 on bad/missing id), status toggle. `[id]/modifier`: `SoftwareForm mode="edit"` → `PUT /api/administration/logiciels/{id}`. `importer`: `SoftwareImportWorkflow` — step indicator, `.xlsx` dropzone, dev-only local-source option, "Analyser le fichier" → `POST .../import/preview`, "Confirmer la mise à jour" → `POST .../import/confirm`.

### `/administration/utilisateurs` — `app/administration/utilisateurs/page.tsx`
`ADMIN`-only. Header "Créer un utilisateur" → `/nouveau`. `UserListView`: search + Role/Département/Statut filters; per-row "Ouvrir", `⋯` menu "Modifier"/"Désactiver"/"Activer" (`POST .../activate` or `/deactivate`).

### `/administration/utilisateurs/nouveau`, `/[id]`, `/[id]/modifier`
All `ADMIN`-only. `nouveau`: `UserForm mode="create"` → `POST /api/administration/utilisateurs`. `[id]`: `UserDetailView` (identity hero, status toggle, full detail list). `[id]/modifier`: `UserForm mode="edit"` → `PUT /api/administration/utilisateurs/{id}`.

### `/profile` — `app/profile/page.tsx`
Self-service edit for the current (dev-resolved) user; no RBAC gate. `ProfileForm`: editable Prénom/Nom/Email/Téléphone/Fonction/Département/Avatar URL/Langue/Fuseau (role and status are **not** editable here — "gérés par l'administration"). Submit → `PATCH /api/profile`.

### `/settings`, `/settings/general`, `/settings/notifications`, `/settings/profile`, `/settings/security`
All render the shared `SettingsPlaceholder` component with a different `activeSection`. **All five are static "coming soon" placeholders with no forms and no API calls.** `/settings/security` mentions upcoming auth/session/SSO features. **AMBIGUITY**: `/settings/profile`'s description implies it complements `/profile`, but it renders no real data — the only functional profile editor is `/profile`.

### API Routes Summary

| Resource | Route | Methods | Behavior |
|---|---|---|---|
| Appels d'offres | `app/api/appels-offres/route.ts` | GET, POST | List/filter; create (multipart PDF) + auto-launch analysis, returns `redirect_url`. |
| | `.../[code]/route.ts` | GET, PUT, DELETE | Detail; update fields / replace PDF (409 if mid-processing); archive. |
| | `.../[code]/archive`, `/unarchive` | POST | Idempotent archive/reactivate + audit log. |
| | `.../[code]/pdf` | GET | Streams the stored CDC PDF. |
| | `.../[code]/history` | GET | Full audit-log history. |
| | `.../[code]/analyse` | POST | Launch/relaunch AI analysis (canonical contract), 202. |
| | `.../[code]/analyse/logiciels` | GET, POST | Software-analysis detail; discriminated-action mutation endpoint. |
| | `.../analyse/logiciels/import/{preview,confirm}` | POST | Excel import preview/confirm for one tender's analysis. |
| FCI | `.../fci` | GET | Full FCI workspace presentation for the current user. |
| | `.../fci/initialize` | POST | Creates the A–D module set. |
| | `.../fci/[module]` | GET, PUT | Module presentation; save draft (optimistic concurrency via `expected_version`). |
| | `.../fci/[module]/generate`, `/regenerate` | POST | Launch AI generation/regeneration (RBAC-checked), 202. |
| | `.../fci/[module]/validate` | POST | Mark module validated. |
| | `.../fci/[module]/history` | GET | Version/job/audit history. |
| | `.../fci/[module]/export` | GET | Word/PDF export (`?format=`). |
| | `app/api/fci/callbacks/n8n` | POST | HMAC+bearer-authenticated FCI callback receiver. |
| | `app/api/fci/contracts/validate` | POST | Bearer-protected schema-validate-without-persist endpoint for n8n. |
| Administration — Logiciels | `app/api/administration/logiciels/*` | GET/POST/PUT | `ADMIN`-gated catalogue CRUD, archive/reactivate, import preview/confirm. |
| Administration — Utilisateurs | `app/api/administration/utilisateurs/*` | GET/POST/PUT | `ADMIN`-gated user CRUD, activate/deactivate. |
| Fiche | `app/api/fiche/[code]/route.ts` | GET, PUT | Read/save fiche bundle. |
| | `.../status` | GET | Lightweight polling endpoint. |
| | `.../validate` | POST | Validate (409 if not draft or unresolved control items remain). |
| | `.../complete` | POST | Legacy callback (shared-secret header only). |
| | `.../pdf` | GET | Streams the source PDF. |
| | `app/api/fiche/callbacks/n8n` | POST | Canonical HMAC+bearer callback receiver. |
| Generate | `app/api/generate/route.ts` | POST | Legacy compatibility launch entry point (`/initiation`). |
| Profile | `app/api/profile/route.ts` | GET, PATCH | Current user's own profile. |
| Dashboard | `app/api/dashboard/route.ts` | GET | Aggregate dashboard payload. |
| Development | `app/api/development/current-user/route.ts` | GET, PUT | Dev-mode only (404 in production); dev-user switcher. |

**Cross-cutting notes**: there is no real authentication anywhere in the reviewed routing tree (see §6, §8); `app/dashboard/page.tsx` hardcodes both the greeting name and a "now" reference date; `AppelOffresForm`'s edit mode and FCI module E / `canMakeFinalDecision` are built but not reachable from the UI; `/settings/profile` is a placeholder distinct from the functional `/profile`.

---

## 5. Data Model

*(Every entity below is a real PostgreSQL table created imperatively by an `ensure*Schema()` function in the corresponding `repository.ts`; there is no ORM/migration framework — schema is idempotent `CREATE TABLE IF NOT EXISTS` plus additive `ALTER TABLE` statements run at process start.)*

### `appels_offres` (`lib/appels-offres/repository.ts:325-340`, type `lib/appels-offres/types.ts:70`)
Fields: `id`, `code` (unique), `title`, `reference`, `buyer`, `country`, `due_date`, `notes`, `priorite` (`basse|normale|haute|critique`), `responsable_commercial`, `status` (see enum below), `business_status` (nullable, see enum below), `source` (`manual|fiche-flow`), `created_at`, `updated_at`, `archived_at`, `deleted_at` (legacy, always written together with `archived_at` — **AMBIGUITY**: effectively redundant with `archived_at`). Parent of `documents`, `processing_jobs`, `audit_logs`, `fci_sets`, `software_analysis_reviews`, and the software-analysis tables (mostly `ON DELETE CASCADE`).

### `documents` (`:390-402`)
`id`, `appel_offres_id` (FK), `kind` (`source_pdf|fiche_xml|fiche_markdown|status_json`), `file_name`, `storage_path`, `mime_type`, `size_bytes`; unique `(appel_offres_id, kind)`.

### `processing_jobs` (`:404-506`)
`id`, `appel_offres_id` (FK), `public_id` (unique), `job_type` (`appel_offres_upload|appel_offres_update|fiche_generation`), `status` (`created|queued|running|completed|failed|cancelled|retrying`), `started_at`, `finished_at`, `contract_version`, `correlation_id` (partial unique), `execution_id`, `launch_accepted_at`, `callback_received_at`, `callback_status` (`completed|failed|cancelled`), `callback_idempotency_key`, `retry_of_job_id` (self-FK), `error_stage` (`webhook|upload|marker|markdown|anonymization|llm|xml|callback|unknown`), `error_code`, `error_message`, `metadata` (jsonb).

### `audit_logs` (`:508-523`)
`id`, `appel_offres_id` (FK, nullable, `ON DELETE SET NULL`), `action` (free text, e.g. `appel_offres.status_changed`, `appel_offres.archived`, `software_analysis.requirement_saved`), `payload`/`details` (both jsonb, always written identically — `payload` appears deprecated), `actor`, `created_at`.

### `fci_sets` (`lib/appels-offres/fci/repository.ts:228-241`)
One per tender (`unique (appel_offres_id)`). `source_fiche_version`, `source_fiche_hash`, `source_fiche_updated_at`, `overall_status` (`not_started|in_progress|needs_review|validated|failed`).

### `fci_modules` (`:243-262`)
`fci_set_id` (FK), `module_code` (`A|B|C|D|E`, unique per set), `module_type` (`commercial|finance|operations|strategy|experience`), `status` (`not_started|generating|generated|needs_review|validated|failed|unavailable`), `ai_generated_at`, `validated_at`, `validated_by`, `error_code`, `error_message`. Module `E` is only enabled behind `KNOWLEDGE_BASE_ENABLED` (`lib/appels-offres/fci/validation.ts:94-108`).

### `fci_module_data` (`:264-334`)
Append-only, versioned (`version` int, unique `(fci_module_id, version)`): `data_json`, `source_summary_json`, `confidence_json`, `ai_notes_json`, `generated_from_fiche_version`, `generated_from_fiche_hash`.

### `fci_generation_jobs` (`:279-357`)
`fci_module_id` (FK), `trigger_type` (`manual|automatic|regeneration` — **AMBIGUITY**: `automatic` declared but no writer found), `provider`, `model`, `status` (`pending_integration|created|queued|running|completed|failed|cancelled` — **AMBIGUITY**: `pending_integration` declared but no writer found), `contract_version`, `schema_version`, `prompt_version`, `generation_parameters`, `source_fiche_version`, `source_fiche_hash`, `execution_id`, `correlation_id` (partial unique), timestamps, `error_code`, `error_message`.

### `fci_audit_events` (`:359-368`)
`appel_offres_id` (FK), `fci_module_id` (nullable FK), `event_type` (free text: `fci.initialized`, `fci.module_data.saved`, `fci.generation.requested`, `fci.generation.completed`, `fci.generation.failed`, `fci.module.validated`, etc.), `actor`, `payload_json`.

### `software_analysis_reviews` (`lib/appels-offres/software-analysis-repository.ts:267-278`)
One per `(appel_offres_id, scope)` (`scope` currently only `logiciels`); `status` (`draft|submitted|validated`) with transitions: `submit` (draft→submitted), `validate` (submitted→validated), `reopen` (submitted/validated→draft).

### `tender_software_requirements`, `tender_software_matches`, `tender_software_gaps`, `analysis_confirmations`, `analysis_sources`
Per-tender software-gap-analysis tables (all `appel_offres_id`-scoped). Requirements: `explicitness` (`explicit|implicit`), shared row `status` (`draft|reviewed|validated|rejected`). Matches: FK to requirement + to `logiciels` catalogue, `match_type` (`exact|alias|manual|possible|none`), `coverage_status` (`covered|partially_covered|not_covered|to_confirm`). Gaps: FK to requirement, free-text urgency/recommended action. Confirmations: `status` (`open|resolved|not_applicable`). Sources: free-text provenance metadata.

### `logiciels` + `logiciel_aliases` (`lib/administration/logiciels/repository.ts:100-158`)
Catalogue: `name`, `normalized_name` (unique), `description_raw`, `status` (`active|archived`). Aliases: `alias`, `normalized_alias`, `source` (`manual|catalogue_import`), unique `(logiciel_id, normalized_alias)`.

### `app_departments`, `app_users`, `app_runtime_settings` (`lib/users/repository.ts:187-267`)
Departments: `code` (`COMMERCIAL|FINANCE|OPERATIONS|DIRECTION_GENERALE|ADMINISTRATION`) primary key, `name`. Users: `first_name`, `last_name`, `display_name`, `email`/`normalized_email` (unique), `job_title`, `department_code` (FK), `role` (`ADMIN|COMMERCIAL|FINANCE|OPERATIONS|DIRECTION_GENERALE`), `status` (`ACTIVE|INACTIVE|INVITED|LOCKED`), `avatar_url`, `phone`, `language`, `timezone`, `last_login_at`. Five seed users, one per role. Runtime settings: generic `setting_key`/`setting_value` store; known key `development.current_user_id` → `{userId}`, the dev-user-switcher pointer.

### `cdc_fiches.fiches_projet` (legacy Fiche CDC index, `lib/db.ts:104-142`, separate schema, uses `pgvector`)
`code_interne` (unique, links to `appels_offres.code` by convention, no formal FK), `status` (`processing|draft|validated|error` — distinct system from tender status, see below), `raw_xml`, `extraction`/`evaluation`/`controle` (jsonb indexes built from the XML), `embedding vector(1536)` — **AMBIGUITY**: column exists but no code path found that ever populates it with a real value; always inserted as `null`, presumably reserved for future semantic search.

### Tender status enums (business vs stored) — the most layered part of the model
There are **four** parallel/derived status concepts:
1. **Stored coarse status** — `appels_offres.status`: `draft | processing | ready | error | archived` (`lib/appels-offres/types.ts:3-8`).
2. **Stored business status** — `appels_offres.business_status` (nullable): `brouillon | cdc_importe | en_attente_analyse | analyse_en_cours | fiche_a_valider | fiche_validee | erreur | archive` (`:10-18`). `setAppelOffresBusinessStatus` writes both columns together, deriving the coarse status from the business one.
3. **Derived presentation status** — `BusinessStatusKey` (`lib/appels-offres/presentation.ts:15-23`, a separately-declared but value-identical type): if `business_status` is set, use it directly; otherwise derive from Fiche status + processing-job state, as a fallback for legacy rows. Each value has a French label, a badge tone, a description, a "next action" prompt, and a progress percentage.
4. **Fiche CDC document status** — `FicheStatus` (`lib/types.ts:1`): `processing | draft | validated | error` — the status of the extraction document itself, separate from the tender.

A fifth, non-stored layer — `lib/appels-offres/dashboard-status.ts` — overlays the FCI overall status onto the business status purely for dashboard/row-action display (`retry|processing|validate|generate|consult|open`), without writing anything back.

### FCI module/job status lifecycle
`fci_modules.status` transitions (all logic in `lib/appels-offres/fci/service.ts`): `not_started` (on init) → `generating` (launch accepted) → `needs_review` (AI callback success, or human manual save) → `validated` (human validates; sticky — further saves stay `validated`). On failure, the module status is typically **restored** to its previous stable value with `error_code`/`error_message` populated, rather than literally set to `failed` — **AMBIGUITY**: unclear from the code whether `status = 'failed'` is ever actually persisted versus always resolving back to a prior stable state.
`fci_generation_jobs.status`: `created` → `queued` → `running` (n8n acceptance) → `completed` (success callback) or `failed`/`cancelled` (failure callback or launch exception).
`fci_sets.overall_status` is recalculated after every module-state change: `not_started` (nothing enabled) → `validated` (all validated) → `in_progress` (any generating) → `needs_review` (any needs review) → `failed` (any failed with no stored data yet) → `in_progress` (fallback, any activity).
Idempotency: callbacks are de-duplicated via a hash of `generation_job_id:correlation_id:execution_id:status:event`; an identical repeat returns `200 {idempotent:true}`; a conflicting duplicate returns `409 CALLBACK_CONFLICT`.

---

## 6. Roles & Permissions

### 6.1 Model as documented (`docs/rbac-mvp.md`)
Five roles: `ADMIN`, `COMMERCIAL`, `FINANCE`, `OPERATIONS`, `DIRECTION_GENERALE`. Permission matrix (`docs/rbac-mvp.md:11-19`): all roles see the dashboard and Appels d'offres list; only `ADMIN` sees Administration; every role can *view* every FCI module; each business role can edit/generate/regenerate/validate only its own module (`A`→Commercial, `B`→Finance, `C`→Operations, `D`→Direction Générale); only `ADMIN` and `DIRECTION_GENERALE` can make the "Final Go/No-Go" decision. Enforcement is explicitly **not** hidden-buttons-only — the doc states server-side write enforcement.

### 6.2 Model as actually implemented (`lib/auth/rbac.ts`) — verified, with discrepancies flagged
- `canAccess(role, area)` — pure `AREA_ACCESS` lookup: `dashboard`/`appels_offres` → all roles, `administration` → `ADMIN` only. Matches docs.
- `canViewFciModule(role, moduleCode)` — `ADMIN` always true; **module `E` is unconditionally `false` for every non-admin role**, independent of the separate `KNOWLEDGE_BASE_ENABLED` flag that also gates module E elsewhere. **This is a real gap in `docs/rbac-mvp.md`**, which only says "All modules" are viewable and never mentions module E's extra restriction.
- `canEditFciModule`, and its aliases `canValidateFciModule`, `canGenerateFciModule`, `canRegenerateFciModule` — all four are the same check: `ADMIN` or exact role match to `FCI_EDITOR_ROLE_BY_MODULE[module]`. There is no independent "can validate but not generate" split in code, despite the doc listing them as separate matrix columns — in practice they always move together per role.
- `canMakeFinalDecision(role)` — `ADMIN || DIRECTION_GENERALE`, matches the doc, but as noted in §4 has no calling UI.
- `RBAC_PERMISSIONS` / `rolePermissions` (`lib/auth/rbac.ts:14-24, 88-127`) — a permission-string abstraction that is **defined but never consulted** by any of the `can*` functions or found to have any importer elsewhere in the codebase. Dead scaffolding, not the real enforcement mechanism.
- `lib/auth/rbac.test.ts` exercises exactly the documented matrix for modules A–D and confirms it is accurate for that scope (it does not test module E).

### 6.3 Current-user resolution — a real documentation/code contradiction
`docs/rbac-mvp.md:50-64` documents a "temporary development user" mechanism using request headers (`x-concept-dev-role`, `x-concept-dev-name`) and an env var (`CONCEPT_DEV_ROLE`). **A full-repo grep found these strings nowhere in the codebase — only inside the doc itself.** The real, currently-implemented mechanism (per `docs/user-management.md`, confirmed in code) is a **Postgres-persisted switcher**: `app_runtime_settings.development.current_user_id` (`lib/users/repository.ts:23, 768-806`), manipulated via a dropdown in `components/app-shell.tsx:477-511` that calls `PUT /api/development/current-user`. `lib/auth/current-user.ts:68-74` shows `resolveCurrentUserFromRequest`'s `request` parameter is explicitly unused (`_request`), and `resolveCurrentUserFromServerHeaders()` takes no arguments at all — headers cannot be read by either function. On any resolution error (e.g. missing `DATABASE_URL`), the fallback is a **hardcoded** `Bob Durand`/`ADMIN` identity (`current-user.ts:9-30`), never influenced by any header or env var. `docs/rbac-mvp.md`'s "Temporary development user" section should be treated as stale.

### 6.4 Enforcement pattern
- `lib/auth/server.ts`: `requireAreaAccessForRequest` (API routes → JSON `403 {code: "RBAC_FORBIDDEN"}`) and `requireAreaAccessForPage` (pages → Next.js `forbidden()` boundary). Every Administration page and API route calls one of these (full citation list produced during research — every `app/administration/**` and `app/api/administration/**` file).
- FCI write enforcement happens **in the service layer**, not the route handler: `assertCanEditModule`/`assertCanGenerateModule`/`assertCanValidateModule` (`lib/appels-offres/fci/service.ts:128-174`), each throwing a `403 RBAC_FORBIDDEN` `FciServiceError`. This matches `docs/rbac-mvp.md`'s claim precisely.
- **AMBIGUITY**: no explicit `canViewFciModule` call was found in the FCI **read** routes (`GET .../fci`, `GET .../fci/[module]`) during this review — view-gating for module E in particular may be enforced only client-side/presentation-side, which would be a gap if confirmed by a deeper trace.
- `components/app-shell.tsx:305-308` uses `canAccess` only to visually **disable** (not hide) the Administration sidebar items — real enforcement is server-side, this is UX polish on top.

### 6.5 Seed users (`lib/users/repository.ts:25-88`)
Bob Durand (`ADMIN`/`ADMINISTRATION`), Claire Martin (`COMMERCIAL`), Sophie Bernard (`FINANCE`), Marc Leroy (`OPERATIONS`), Isabelle Moreau (`DIRECTION_GENERALE`) — one per role, all seeded `ACTIVE`. Bob is the default dev user.

### 6.6 In-progress, uncommitted real authentication (discovered during this audit, not yet documented anywhere)
As of this audit, `git status` shows six **new, uncommitted, untracked** files not covered by `docs/rbac-mvp.md`, `docs/user-management.md`, or any committed history: `lib/auth/config.ts`, `lib/auth/errors.ts`, `lib/auth/passwords.ts`, `lib/auth/paths.ts`, `lib/auth/repository.ts` (606 lines), `lib/auth/session.ts` (168 lines). `bcryptjs ^3.0.3` was added to `package.json` (uncommitted diff) to support it. Reading these files directly:
- `lib/auth/passwords.ts` — `bcrypt.hash(value, 12)` / `bcrypt.compare`, with a dummy-hash constant-time-safe comparison when no stored hash exists (timing-attack mitigation for unknown emails).
- `lib/auth/config.ts` — reads `AUTH_SECRET` (required, throws if missing), `AUTH_SESSION_TTL_SECONDS` (default 12h), builds `httpOnly`/`sameSite=lax`/`secure-in-production` cookie options under cookie name `concept_session`; also reads `CONCEPT_DEV_ADMIN_PASSWORD`/`CONCEPT_DEV_USER_PASSWORD`/`CONCEPT_ENABLE_DEV_USER_SWITCHER` (development-only, gated by `NODE_ENV === "development"`).
- `lib/auth/session.ts` — `authenticateWithPassword({email, password, ipAddress, userAgent})`: looks up the user, checks `status === "ACTIVE"` (rejecting `LOCKED`/`INVITED`/`INACTIVE`) and a time-based `lockedUntil`, verifies the password hash, records success/failure, and creates a session token. Also exposes `resolveAuthenticatedSession`, `logoutAuthenticatedSession`, and `createDevelopmentUserSession` (an admin-initiated impersonation session, distinct from the current dev-switcher).
- `lib/auth/repository.ts` creates two new tables (`create table if not exists ${SESSIONS_TABLE}`, `${AUTH_AUDIT_TABLE}` — line-level names not fully captured in this pass) for session storage and a login-attempt/audit trail.
- **This is real, session/password-based authentication infrastructure — exactly the top item on `PROJECT_AUDIT_2026.md`'s "20 Highest-Value Missing Features" list.** However, it is **not yet wired into any page or API route**: a repo-wide search found no login/`connexion` page and no route importing `authenticateWithPassword` or `resolveAuthenticatedSession`. It should be treated as **in-progress scaffolding, not a shipped capability** — flag this prominently in the "Current State" section of any report to a supervisor, since it materially changes the security posture described by `PROJECT_AUDIT_2026.md` (score 3/10) once wired up, but changes nothing yet as of this audit.

---

## 7. Integrations

### 7.1 Two separate n8n contracts
The platform maintains **two independent n8n integration contracts**, each with its own webhook URL, secrets, and callback route — they do not share infrastructure beyond a common HMAC-verification helper.

**A) Canonical CDC/Fiche contract** (`lib/integrations/`)
- Config (`n8n-config.ts`): requires `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_TOKEN`, `PLATFORM_CALLBACK_TOKEN`, `N8N_CALLBACK_SECRET`, `PLATFORM_PUBLIC_BASE_URL`; optional `N8N_CONTRACT_VERSION` (default `1.0`), `N8N_LAUNCH_TIMEOUT_MS` (default 10000), `MAX_CDC_UPLOAD_BYTES` (default 50MB).
- Contract (`n8n-contract.ts`): launch payload `{contract_version, processing_job_id, appel_offre_id, code_interne, correlation_id, callback_url, pdf_path, requested_at}`; acceptance `{accepted, processing_job_id, correlation_id, execution_id, received_at, processing_status: QUEUED|RUNNING}`; callback envelope with `status: COMPLETED|FAILED|CANCELLED` (**uppercase**), success adds `result: {markdown, xml}`, failure adds `error: {stage, code, message, retryable, provider?}` where `stage ∈ {WEBHOOK, UPLOAD, MARKER, MARKDOWN, ANONYMIZATION, LLM, XML, CALLBACK, UNKNOWN}` — includes `MARKER`, confirming this pipeline runs an actual Marker PDF-conversion stage.
- Callback route: `POST /api/fiche/callbacks/n8n` — bearer + timestamp + HMAC-SHA256 (`X-Callback-Signature: sha256=...` over `{timestamp}.{raw body}`), `X-Contract-Version` check, then `applyCanonicalN8nCallback(...)`.
- Legacy shim: `POST /api/fiche/[code]/complete` — much weaker auth (single shared secret `N8N_COMPLETE_SECRET` via `X-Complete-Secret` header, no HMAC/timestamp), converts its simpler body into the same canonical envelope and funnels into the identical `applyCanonicalN8nCallback`.

**B) Dedicated FCI contract** (`lib/appels-offres/fci/`)
- Config (`n8n-config.ts`): separate env namespace — `FCI_N8N_WEBHOOK_URL` (required), `FCI_N8N_WEBHOOK_TOKEN` (falls back to `N8N_WEBHOOK_TOKEN`), `FCI_CALLBACK_BEARER_TOKEN` (falls back to `PLATFORM_CALLBACK_TOKEN`), `FCI_CALLBACK_HMAC_SECRET` (its own secret, no fallback), `FCI_CALLBACK_MAX_AGE_SECONDS` (default 300s), `FCI_GENERATION_PROVIDER` (default `gemini`), `FCI_GENERATION_MODEL` (required, no default).
- Contract version defaults from a central registry (`lib/appels-offres/fci/contract-registry.ts`), not a hardcoded literal.
- Launch payload is much richer: includes numeric FK ids (`generation_job_id`, `fci_set_id`, `fci_module_id`, `appel_offre_id`), `module_code`/`module_type`, `trigger_type`, the full `source_fiche` snapshot, the **entire `fiche_cdc` payload**, and — the key design decision (§2.3) — the **exact prompt text and JSON Schema inline** (`prompt: {text, version}`, `output_schema: {version, json_schema}`).
- Callback envelope has an `event: "fci.generation.completed"|"fci.generation.failed"` discriminator (the canonical contract has no equivalent) and **lowercase** `status` (`completed|failed|cancelled`) — a genuine casing inconsistency between the two contracts.
- Error stages (`request_validation, module_selection, prompt_loading, gemini_request, gemini_response, json_parse, schema_validation, callback_delivery, internal`) — **no `marker` stage**, confirming the FCI pipeline never touches PDF/Marker processing, matching `docs/fci-orchestration.md`'s production checklist.
- `sanitizeFciCallbackErrorMessage` — a defense-in-depth helper (not present in the canonical contract) that detects and strips accidental HTML error bodies (e.g. a forwarded Next.js 404 page) before persisting/rendering them, and truncates over-long messages.
- Callback route: `POST /api/fci/callbacks/n8n` — rejects non-JSON `Content-Type` with `415`, same bearer+HMAC scheme with FCI-specific config, `X-Contract-Version` check, `validateFciCallbackPayload`, then `applyFciN8nCallback(...)`. All error responses carry a machine-readable `code` field (more structured than the canonical route's bare `{error: string}`).
- Idempotency: exact behavior matches `docs/fci-orchestration.md` — identical repeat callback → `200 {applied:false, idempotent:true}`; conflicting duplicate (same job, different payload) → `409 CALLBACK_CONFLICT`; extensive cross-field consistency checks (module id/code, set/appel_offre, code_interne, correlation_id, execution_id, source_fiche version/hash) each return distinct 409 codes before the AI payload is even re-validated.
- Launch call (`requestFciN8nLaunch`, `service.ts:885-971`): `AbortController` timeout (`FCI_N8N_LAUNCH_TIMEOUT_MS`, default 10s), sends `Authorization: Bearer`, `X-Contract-Version`, `Idempotency-Key: {correlation_id}`; requires HTTP `202`; validates and cross-checks the acceptance body's `generation_job_id`/`correlation_id` even on success. All webhook URLs are redacted (`sanitizeUrlForLogs`) before appearing in logs/error details.

### 7.2 Gemini
- Model in production use: `gemini-3.6-flash`, called by n8n via Google's **OpenAI-compatible** endpoint `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` (not the native `generateContent` endpoint) — `docs/gemini-api-diagnostic.md:56-74`.
- `GEMINI_API_KEY` is **n8n-runtime-only** — the Next.js platform never reads it directly (`lib/integrations/n8n-config.ts` and `lib/appels-offres/analysis.ts` do not reference it, confirmed in `docs/gemini-api-diagnostic.md:23-33`). It must be injected into the n8n process environment separately, outside the files tracked by Git.
- `docs/gemini-api-diagnostic.md` (dated 2026-07-23) documents a real incident: the workflow was previously pinned to `gemini-2.5-flash`, which became unavailable for new users; diagnosis via `npm run test:gemini` (`scripts/test-gemini.mjs`) confirmed the key itself was valid and reachable on both the native and OpenAI-compatible endpoints, and the workflow was repointed to `gemini-3.6-flash`, resolving the block.

### 7.3 Marker
Marker (PDF→Markdown conversion) is referenced only indirectly from this repository: as the `MARKER` error stage in the canonical contract's `N8N_ERROR_STAGES`, and via three env vars documented in `docs/env-variables.md:62-64` (`MARKER_CONVERT_URL`, `MARKER_STATUS_URL`, `MARKER_RESULT_URL`) that must be set **in the n8n runtime**, not in this app. **AMBIGUITY**: no Marker client code, API wrapper, or configuration exists inside this Next.js repository — the actual Marker integration lives entirely inside the external n8n workflow (`f866bd39869c4c11`), which is not part of this codebase and was not available to audit directly.

### 7.4 Prompt/schema management for FCI
`ai/prompts/fci-{commercial,finance,operations,strategy}.md` and `ai/schemas/fci-{commercial,finance,operations,strategy,common}.schema.json` exist on disk and are loaded (`readFileSync`) and cached at runtime by `lib/appels-offres/fci/ai-runtime.ts`; their **version numbers** are centralized separately in `lib/appels-offres/fci/contract-registry.ts` rather than embedded in the files. Validation of returned AI JSON uses **Ajv (2020-12 dialect)** with `allErrors: true` (`lib/appels-offres/fci/ai-validation.ts`) — genuine JSON-Schema validation, not hand-rolled checks. Also present: `ai/examples/*.sample.json` (one sample payload per module), `ai/templates/fci/*.docx` (the five original Word templates used both as design reference and as live export templates), `ai/README.md`.

### 7.5 Workflow artifacts in-repo
`n8n/workflows/fci-module-generation.json` is checked into the repo (generated via `node scripts/build-fci-workflow-export.mjs`, per `docs/fci-orchestration.md:277-293`), timestamped backups land in `tmp/n8n-workflow-backups/`. **AMBIGUITY**: no equivalent export for the canonical CDC/Fiche workflow was found under `n8n/` — it's unclear whether that workflow's definition is checked in anywhere or lives only in the live n8n instance's own SQLite database (`C:\Users\lotfi\.n8n\database.sqlite`, workflow id `f866bd39869c4c11`, per `docs/gemini-api-diagnostic.md:37-39`).

---

## 8. Current State

This section combines the platform's own contemporaneous self-audit (`PROJECT_AUDIT_2026.md`, dated 2026-07-20, "Overall score: 64/100") with what this review additionally confirmed in the newest code.

### 8.1 Fully working
- Tender (Appel d'offres) CRUD, list/search/filter, archive/unarchive, PDF storage and streaming.
- Async CDC → Fiche CDC pipeline: upload, launch, signed callback, human review/edit, validation gate (blocks on unresolved `controle` items).
- FCI module generation for A–D: launch, signed callback with re-validation, draft save with optimistic concurrency, human validation, Word/PDF export.
- Software-catalogue administration and per-tender software-gap analysis workflow, including Excel import with preview/confirm.
- User administration (`/administration/utilisateurs`) and self-service profile editing (`/profile`), backed by a real `app_users` table.
- RBAC policy enforcement for Administration pages/APIs and FCI write actions, confirmed accurate against its own test suite for modules A–D.

### 8.2 Partial / uneven
- **Persistence model** is split across PostgreSQL, filesystem (`data/{code}/`), and a mirrored legacy Fiche index (`cdc_fiches.fiches_projet`) with "best-effort" synchronization (`syncFicheIndexSafely()` warns and continues on failure) rather than transactional guarantees (`PROJECT_AUDIT_2026.md`, Backend Review, Technical Architecture Review).
- **Large stateful components** still concentrate significant logic: `components/fiche-editor.tsx`, `components/appel-offres-workspace.tsx`, `components/appel-offres-form.tsx` (`PROJECT_AUDIT_2026.md`, Frontend Review; confirmed by this review's page inventory in §4, which found these are among the largest/most multi-responsibility client components).
- **Homepage redirect** (`/` → `/dashboard`) is called out as inconsistent with a stated Appel-d'offres-first product direction (`PROJECT_AUDIT_2026.md`, Product Architecture Review; confirmed in code at `app/page.tsx:4`).
- **Legacy compatibility surface** remains live: `/initiation`, `POST /api/generate`, `POST /api/fiche/[code]/complete` all still function, expanding the maintenance/security surface (§4, §7).

### 8.3 Stubbed / "Bientôt" (confirmed in code, not just docs)
- `/settings`, `/settings/general`, `/settings/notifications`, `/settings/profile`, `/settings/security` — all five render `SettingsPlaceholder` with static "coming soon" content and zero API calls.
- The Administration sidebar items "Référentiels", "Employés", "Compétences" and the "Base de connaissances" group are permanently disabled placeholders in `components/app-shell.tsx`.
- The notifications bell in the topbar is disabled ("Bientôt disponibles"); "Déconnexion" is a disabled link.
- FCI module **E** (`experience`) and the `canMakeFinalDecision` (Go/No-Go) permission exist in the data/permission model but have no reachable UI.
- The software-analysis sub-nav tabs "Compétences", "Risques", "Sources" are disabled placeholders next to the working "Logiciels" tab.
- `AppelOffresForm`'s `mode="edit"` UI is fully built but unreachable from routing.

### 8.4 Known issues and incidents (`docs/incidents.md`, `docs/gemini-api-diagnostic.md`)
- **Fixed**: shared `.next` build directory between `next dev` and `next start` caused one process to silently corrupt the other's served assets; fixed by giving each mode its own `distDir` via `NEXT_DIST_DIR` + `cross-env` (`next.config.ts`, `package.json` scripts).
- **Fixed**: the original synchronous n8n webhook call caused timeouts on real CDC PDFs; replaced with the current async accept-then-callback pattern.
- **Fixed**: `gemini-2.5-flash` became unavailable for new users mid-project; the active n8n workflow was repointed to `gemini-3.6-flash` on 2026-07-23 after a full diagnostic (`docs/gemini-api-diagnostic.md`).
- **Open, low-severity**: orphaned `data/{code}.tmp-*` directories can be left behind if the Node process is killed mid-upload (no crash-recovery sweep exists yet).
- **Open**: if an n8n execution is cancelled manually and never calls back, a Fiche can stay stuck in `processing` indefinitely — manual regenerate is the only escape hatch; no stale-job reaper exists.
- **Open, per `N8N_CANONICAL_CONTRACT_IMPLEMENTATION_SUMMARY.md`**: at the time that document was written, only the canonical contract's **failure** paths had been exercised against a real signed callback in controlled local testing; a fully successful `COMPLETED` callback had not been verified end-to-end locally (no valid Gemini key in that test environment at the time). No later document in this repository confirms a first successful live run — **AMBIGUITY: current true/false status of an end-to-end successful canonical-contract run is not verifiable from repository contents alone.**

### 8.5 Documentation/code contradictions found during this audit
- `docs/rbac-mvp.md`'s "Temporary development user" section (header/env overrides) does not match the actual, DB-persisted dev-user-switcher implementation (§6.3) — the doc is stale.
- `docs/rbac-mvp.md`'s permission matrix omits that FCI module E is view-restricted to `ADMIN` only in code (§6.2).

### 8.6 Security posture, and the one material update this audit found beyond `PROJECT_AUDIT_2026.md`
`PROJECT_AUDIT_2026.md` scored Security **3/10**, its stated reason for withholding production approval, citing "no real user authentication or authorization layer... visible around business APIs." That remains true for every **committed** route as of this audit — RBAC (`lib/auth/rbac.ts`) governs *authorization* (what a resolved user may do) but there is still no *authentication* (proving who the user is) anywhere in the committed code; the "current user" is always either a DB-persisted dev-switcher selection or a hardcoded fallback (§6.3).

However, this audit found **new, uncommitted, untracked work already underway** to close exactly this gap: `lib/auth/{config,errors,passwords,paths,repository,session}.ts` (913 lines total) implement bcrypt password hashing, session tokens with `httpOnly`/`secure`-in-production cookies, login/logout with failed-attempt tracking and account-status/lockout checks, and a distinct admin-initiated impersonation path. **This is not yet wired into any page or API route** — no login page exists, and no route imports these functions — so it changes nothing about the platform's *current* exposed security posture, but it is directly relevant to a "current state" report: real authentication is in active development, not merely planned in a document.

---

## 9. Build History

*(Chronological, from `git log --format="%h %ad %s" --date=short --reverse`, cross-referenced against the paired `*_PLAN.md`/`*_SUMMARY.md` documents. All commits are on `main`/`feature/n8n-integration` except the last, which is the tip of `feat/rbac`.)*

1. **`1a3034e` — 2026-07-14 — Initial commit: Concept CDC initiation app with documentation.** The original prototype: `/initiation` upload page, `/fiche/[code]` review flow, disk-based `data/{code}/` storage, XML parse/serialize, a Postgres sync index, first n8n integration. No tender object, no auth, no audit trail — exactly the state `PROJECT_AUDIT.md` was written against.

2. **`eb7c1f7` — 2026-07-14 — Milestone 1: Complete Appels d'Offres platform with business data layer.** One large commit implementing `APPELS_OFFRES_IMPLEMENTATION_PLAN.md`, `BACKEND_BUSINESS_DATA_PLAN.md`, `FRONTEND_REDESIGN_PLAN.md`, and `UX_PHASE1_REFINEMENT_SUMMARY.md` together: adds `appels_offres`/`documents`/`processing_jobs`/`audit_logs`, the full tender CRUD API, the redesigned `AppShell`, `/dashboard`, and the workspace-style `/appels-offres/[code]` page, while preserving `/initiation`/`/api/generate`/`/fiche/[code]` for backward compatibility. `BUSINESS_DATA_VERIFICATION_REPORT.md` (same commit) records a live verification pass that found and fixed one bug (Postgres `timestamptz` objects breaking dashboard sort) and pronounced the layer "ready for controlled internal testing."

3. **`4f127e4` — 2026-07-14 — Add canonical platform-n8n integration contract.** Documentation-only: `N8N_PLATFORM_INTEGRATION_AUDIT.md` (the diagnostic that found the pre-canonical integration unsafe — hardcoded callback URL, stale error-stage vocabulary, "success" masking real failures) and `CANONICAL_PLATFORM_N8N_CONTRACT.md` (the resulting v1.0 spec).

4. **`3359ace` — 2026-07-14 — Implement platform-side canonical n8n integration.** Implements the Next.js half of the contract: `POST /api/appels-offres/[code]/analyse`, `POST /api/fiche/callbacks/n8n`, `lib/integrations/{n8n-contract,n8n-config,n8n-callback-auth}.ts`, an additive SQL migration adding `business_status` to `appels_offres` and correlation/execution columns to `processing_jobs`, while keeping `/api/generate` and `/api/fiche/[code]/complete` as compatibility wrappers.

5. **`d99fea7` — 2026-07-15 — Milestone 2: Canonical n8n integration completed.** Implements the n8n side: republishes the live workflow (`f866bd39869c4c11`) through roughly a dozen iterations to satisfy the canonical payload/callback shape and HMAC signing, working around n8n's JS sandbox restrictions via a dedicated signer hop. Local testing captured real signed `FAILED` callbacks; a fully successful `COMPLETED` callback was not exercised locally at that time.

6. **`7ac7cd7` — 2026-07-21 — feat(appels-offres): improve creation validation and safe analysis errors.** Hardens tender creation and analysis-launch validation and error surfacing.

7. **`004d065` — 2026-07-21 — feat(workspace): improve appel d'offres workspace, dashboard, and list experience.** Early iteration on the workspace/list/dashboard, later formalized in `WORKSPACE_EXPERIENCE_V1_PLAN.md`.

8. **`79f888e` — 2026-07-21 — feat(design): add CONCEPT branding and shared interface styling.** First substantial branding pass on `app/globals.css` plus `components/ai-badge.tsx` — green as the default business accent, purple reserved for AI-specific states, replacing a generic placeholder logo.

9. **`f617915` — 2026-07-21 — test(appels-offres): add validation and workspace coverage.** Adds `create-form.test.ts` and `user-errors.test.ts`.

10. **`7309d5f` — 2026-07-21 — docs: update project environment and interface documentation.** Commits `DESIGN_SYSTEM_V1_{PLAN,SUMMARY}.md` and `WORKSPACE_EXPERIENCE_V1_{PLAN,SUMMARY}.md`, retroactively documenting commits 6–9.

11. **`26b64de` — 2026-07-30 — feat: complete FCI workflow, exports and supporting platform updates.** The largest commit in the repository's history (100+ files). Adds, in one shot: the entire FCI module (types, repository, service, AI contracts/runtime/validation, DOCX/PDF export pipeline including a Python exporter, the dedicated FCI n8n contract, both FCI API routes), the Administration → Logiciels software-catalogue module, the per-tender software-analysis module, the five FCI Word templates, and every `docs/fci-*.md`/`docs/administration/*`/`docs/appels-offres/*` document referenced in this audit. Also adds `PROJECT_AUDIT_2026.md` and `CURRENT_INTERFACE_RECAP.md` — this is the commit where the platform's own self-audit was produced.

12. **`3a1eded` — 2026-08-02 — feat(identity): add persisted users, profiles and RBAC management.** (70 files, 5,364 insertions.) Adds the persisted `app_users`/`app_departments`/`app_runtime_settings` model, `/profile` and `/settings/*` pages, the `AppShell` user-menu/dev-switcher integration, and the `lib/auth/rbac.ts` authorization layer with its test suite — directly addressing the "Critical: no authentication or authorization" finding from the very first `PROJECT_AUDIT.md`. This is the current tip of `feat/rbac`, which is a linear fast-forward of `main`.

**Beyond the last commit — current uncommitted state (as of this audit, 2026-08-02):** `git status` shows only `next-env.d.ts`, `package-lock.json`, `package.json` as modified-tracked files, plus six **new untracked files**: `lib/auth/config.ts`, `lib/auth/errors.ts`, `lib/auth/passwords.ts`, `lib/auth/paths.ts`, `lib/auth/repository.ts`, `lib/auth/session.ts` — real password/session-based authentication scaffolding (bcrypt hashing, session cookies, login attempt tracking), not yet wired into any route (§6.6, §8.6). This is the newest work in the repository and is not documented anywhere yet.

---

## 10. Glossary

- **CDC — Cahier des Charges.** The tender's requirements/specification document, uploaded as a PDF and processed into a structured "Fiche CDC."
- **Fiche CDC / Fiche projet.** The structured, human-reviewable extraction of a CDC — stored as XML (legacy `cdc_fiches.fiches_projet` table, `lib/fiche-xml.ts`) and mirrored into the `appels_offres` bundle. Has its own status: `processing | draft | validated | error`.
- **FCI.** A set of department-specific structured internal forms/briefs generated per tender (modules A–D, one per department), used to assemble the internal go/no-go dossier. **AMBIGUITY**: the acronym's full expansion is never spelled out anywhere in the repository (checked `docs/`, `README.md`, and every `*.md` file read for this audit) — no definition string was found. Based on consistent usage across `docs/rbac-mvp.md`, `docs/fci-orchestration.md`, `docs/fci-field-schema.md`, and the module templates (`ai/templates/fci/FCI_DC.docx` etc.), it functions as an internal scoping/briefing sheet per department feeding a Go/No-Go decision; a supervisor or product owner should confirm the exact expansion (a plausible French candidate is "Fiche de Cadrage Interne," but this is **not confirmed by any repository text** and should not be presented as fact).
- **DC / DF / DO / DG.** Direction Commerciale, Direction Financière, Direction Opérationnelle, Direction Générale — the four departments each owning one FCI module (`docs/fci-template-audit.md`). In the `fci_modules.module_code` scheme these map to letters `A` (DC/commercial), `B` (DF/finance), `C` (DO/operations), `D` (DG/strategy) — see `lib/appels-offres/fci/validation.ts:77-92`. A fifth code, `E` ("experience"/retour d'expérience), also traces to DO per the template audit but is disabled behind `KNOWLEDGE_BASE_ENABLED` and hidden from non-admin roles.
- **Appel d'offres.** Tender / call for bids — the platform's root business entity as of Milestone 1 (§9.2).
- **Go/No-Go.** The final bid/no-bid decision. Modeled in permissions (`canMakeFinalDecision`, restricted to `ADMIN`/`DIRECTION_GENERALE`) but, per §4 and §8.3, has no dedicated UI or API route yet — `docs/rbac-mvp.md:78` itself notes "There is no dedicated final Go / No-Go API route yet."
- **RBAC.** Role-Based Access Control — the platform's authorization model (§6), distinct from authentication, which (as of this audit) is only in early, unwired development (§6.6).
- **Marker.** External PDF→Markdown conversion stage run inside the n8n pipeline (not present as code in this repository — see §7.3).
- **Contract version / correlation ID / execution ID.** Three distinct identifiers in the n8n integration design: `contract_version` pins the JSON schema of the exchange; `correlation_id` is the platform's own idempotency key per launch attempt; `execution_id` is n8n's internal run identifier, used for cross-checking but not for idempotency itself (§2.3, §7.1).
