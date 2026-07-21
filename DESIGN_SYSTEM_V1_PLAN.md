# DESIGN_SYSTEM_V1_PLAN

## Objective

Establish a coherent branded CONCEPT design system across the existing platform without changing business workflows, backend architecture, database schema, or the canonical n8n contract.

The platform should feel like internal CONCEPT software for AI-assisted tender processing and human validation, not a generic blue admin dashboard.

## Current UI Audit

### Current inconsistencies

- The color system is still blue-centric:
  - `--accent` and most interactive states use blue
  - primary buttons, progress bars, upload highlights, topbar highlights, and page eyebrow chips all use the same blue family
- The sidebar branding is generic:
  - only a placeholder `C` mark is shown
  - no real CONCEPT logo integration
  - sidebar dark tone is near black/navy instead of a CONCEPT-aligned dark green/navy
- Status semantics are partially inconsistent:
  - info, processing, progress, and “AI-like” states all share the same blue styling
  - there is no dedicated AI accent system yet
- Component surfaces are mostly consistent structurally, but not semantically:
  - cards, empty states, placeholders, tables, and dropzones all use similar light gray/blue treatments
  - nested surface hierarchy is not clearly tokenized
- Typography is structurally fine but not fully normalized:
  - headers and metadata use mixed scales
  - some headings are stronger than necessary for enterprise density
- Error messaging is still too technical in places:
  - the new create route currently surfaces raw backend messages
  - environment or infrastructure issues can leak into user-facing messages
- The app shell is solid functionally but visually uneven:
  - active nav state is too subtle and blue-based
  - topbar controls do not yet feel like part of a branded system
- Some placeholder and disabled states are visually noisy or repetitive:
  - multiple “Bientôt disponible” labels compete for attention
  - disabled modules are not yet visually tiered

### Reusable styles already present

- `app/globals.css` already centralizes most layout and component styles
- Existing primitives are worth preserving and refining:
  - `PageHeader`
  - `StatusBadge`
  - `EmptyState`
  - `StatCard`
  - `PlaceholderPanel`
- Existing structural patterns are reusable:
  - `section-card`
  - `workspace-card`
  - `toolbar-card`
  - `tabs-card`
  - `callout`
  - `progress-bar`
  - `upload-dropzone`
- The app shell structure is already sound:
  - fixed/collapsible sidebar
  - sticky topbar
  - responsive layout behavior
- The Appels d’offres workspace already has a strong information architecture that can be restyled rather than redesigned

## Brand Token Definitions

### Core brand colors

- Green family
  - `--brand-green-50`
  - `--brand-green-100`
  - `--brand-green-500`
  - `--brand-green-600`
  - `--brand-green-700`
  - `--brand-green-800`
- Purple family
  - `--brand-purple-50`
  - `--brand-purple-100`
  - `--brand-purple-500`
  - `--brand-purple-600`

### Semantic surfaces

- `--surface-page`
- `--surface-card`
- `--surface-muted`
- `--surface-sidebar`
- `--surface-sidebar-hover`
- `--surface-sidebar-active`

### Semantic text

- `--text-primary`
- `--text-secondary`
- `--text-muted`
- `--text-inverse`

### Borders

- `--border-subtle`
- `--border-strong`

### Semantic statuses

- `--status-success`
- `--status-warning`
- `--status-error`
- `--status-info`

### Effects and shape

- `--shadow-sm`
- `--shadow-md`
- `--radius-sm`
- `--radius-md`
- `--radius-lg`
- `--radius-xl`

### Token application rules

- Green becomes the default business/action accent
- Purple is reserved for AI-specific actions and states only
- Existing hardcoded blue values should be replaced progressively with semantic variables
- Inline colors should be avoided except where a temporary bridge is unavoidable

## Logo Integration Strategy

- Use the official local asset as the source of truth
- Target path:
  - `public/concept-logo.png`
- If `public/concept-logo.png` is missing but `public/logo-concept.png` exists, copy it rather than editing the original
- The original image will not be destructively modified
- Display strategy:
  - create a dedicated `BrandLogo` component
  - use `next/image`
  - place the logo in a compact framed container in the sidebar
  - preserve the square aspect ratio
  - avoid cropping important text or certification details
- Sidebar brand lockup:
  - logo in framed box
  - `CONCEPT`
  - product subtitle: `Gestion intelligente des appels d'offres`
- Optional secondary full-logo presentation can be introduced on larger surfaces later if needed, but not required for this milestone

## Typography Strategy

- Keep the current font stack unless a practical rendering issue appears
- Normalize hierarchy using restrained sizes:
  - page title
  - section title
  - card title
  - body
  - label
  - metadata
  - helper text
- Reduce visual noise by:
  - using fewer all-caps treatments
  - keeping metadata lighter
  - improving line-height consistency
- The target feel is dense but calm, suitable for enterprise operations

## Components To Create Or Refactor

### New or expanded primitives

- `BrandLogo`
- `InfoBanner`
- `ErrorBanner`
- `AiBadge`
- `UploadDropzone` abstraction if duplication is worth reducing
- `ProgressStep` if the current stepper/timeline styling benefits from shared semantics
- `TimelineItem` if timeline duplication becomes material

### Refactors of existing primitives

- `PageHeader`
- `StatusBadge`
- `EmptyState`
- `StatCard`
- `PlaceholderPanel`

### Components/pages to restyle first

- `AppShell`
- dashboard page
- Appels d’offres list
- Nouvel appel d’offres
- Appel d’offres workspace
- processing/analysis panel
- Fiche CDC page/editor if already present in the current flow

## Responsive Strategy

- Preserve the current sidebar collapse behavior
- Keep the existing app shell breakpoints, but visually tighten them
- Ensure:
  - the sidebar logo remains readable on desktop
  - the topbar does not overflow on laptop widths
  - sticky action bars do not obscure content on narrow screens
  - upload zone remains central and usable on tablet/mobile widths
  - data tables remain scrollable rather than broken
- Prefer stacking and density adjustments over alternate mobile-only layouts

## Accessibility Considerations

- Maintain readable contrast across:
  - sidebar
  - badges
  - banners
  - disabled states
  - focus states
- Add clear `:focus-visible` behavior based on the new semantic tokens
- Ensure the logo has descriptive alt text
- Do not rely on color alone for:
  - status
  - error state
  - AI state
  - archived/disabled state
- Preserve semantic buttons, labels, and keyboard interactions already present

## Rollout Sequence

1. Add this plan file and confirm the design audit baseline.
2. Add logo asset at `public/concept-logo.png` if missing.
3. Introduce brand tokens in `app/globals.css`.
4. Refine the app shell:
   - sidebar
   - topbar
   - active/hover states
5. Refactor core primitives:
   - `BrandLogo`
   - `StatusBadge`
   - `PageHeader`
   - buttons
   - cards
   - banners
6. Apply the system to high-impact pages:
   - dashboard
   - Appels d’offres list
   - Nouvel appel d’offres
   - workspace
   - processing panel
7. Improve Fiche CDC review styling without changing behavior.
8. Replace technical create/launch failure messages with business-safe wording.
9. Run typecheck, build, and targeted tests.
10. Summarize changes in `DESIGN_SYSTEM_V1_SUMMARY.md`.

## Risks

- The current app relies heavily on a single large `globals.css`; broad token changes can create regressions across pages if not applied carefully.
- Some existing text files display mojibake in the terminal output; edits should avoid making encoding issues worse.
- The new create-flow work is still uncommitted and must be preserved while the design system is layered on top.
- The square logo contains a lot of detail; an over-small sidebar rendering could harm readability.
- Purple overuse would conflict with the product principle; it must stay scoped to AI-related UI only.
- Some technical errors originate in backend exception text; user-facing sanitization may require route-level handling rather than CSS-only changes.
- Fiche CDC styling can sprawl if treated like a full redesign; scope must remain presentational.

## Success Criteria

- The product reads immediately as CONCEPT-branded software.
- Green becomes the main business/action accent.
- Purple is reserved for AI-specific operations and statuses.
- The shell, buttons, cards, banners, tables, and statuses look coherent across the audited pages.
- The new Appels d’offres creation flow remains minimal and visually central.
- Technical backend errors are no longer exposed directly to business users on the create page.
