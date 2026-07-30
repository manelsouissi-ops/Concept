# Administration - Logiciels

## Purpose

The `Administration -> Logiciels` module centralizes the company software catalogue used as master reference data.

It provides:

- software listing;
- business search and filtering;
- manual creation and update;
- archive/reactivate instead of hard deletion;
- a safe two-step import flow for the confidential catalogue workbook;
- alias preservation for future AI matching and reconciliation.

## Business usage

The import page is intended for a business or administration user who manages the internal software catalogue.

Typical use cases:

- first catalogue import;
- update from a newer Excel file;
- bulk addition of new software references;
- comparison of a new Excel catalogue against software already stored in the platform.

It is not used for every tender.

## Who should use the import page

- administration or catalogue-management users should use the import page;
- commercial users do not need this page for day-to-day tender work;
- the current application does not yet provide a full authorization system for restricting access by role.

TODO:

- restrict catalogue import controls to authorized administration roles when real role-based authorization is introduced.

## Database entities

### `public.logiciels`

Minimal master-data table for software records.

Fields:

- `id`
- `name`
- `normalized_name`
- `description_raw`
- `status`
- `created_at`
- `updated_at`

Notes:

- `name` is the display value shown in the UI.
- `normalized_name` is the comparison value used to prevent duplicate imports.
- `description_raw` stores the raw `Utilisation` text from the workbook.
- `status` currently supports `active` and `archived`.

### `public.logiciel_aliases`

Optional alias table linked to one software record.

Fields:

- `id`
- `logiciel_id`
- `alias`
- `normalized_alias`
- `source`
- `created_at`

Notes:

- aliases preserve source variants without overwriting the display name silently;
- `source` distinguishes manual aliases from catalogue-import aliases.

## Workbook source structure

Current supported source workbook:

- `data/imports/private/referentiels/Liste Logiciels_Techniques envoyé par Si Maher.xlsx`

Expected structure:

- worksheet: `Feuil2`
- row 1: blank
- row 2: effective header row
- one leading blank layout column
- useful headers:
  - `Logiciels`
  - `Utilisation`

Only this workbook structure is supported by the initial import service.

## Normalization behavior

Software-name normalization is intentionally conservative.

Rules:

- trim leading and trailing whitespace;
- collapse repeated internal whitespace;
- compare names case-insensitively;
- keep the display name as entered after safe whitespace cleanup;
- preserve accents in the display value;
- do not auto-merge uncertain product variants.

Examples of conservative handling:

- capitalization-only variants can match the same normalized software;
- uncertain product-name differences are not merged automatically;
- existing manually edited display names are not silently overwritten by imports.

## Multiple-name splitting

Some `Logiciels` cells may contain several software names separated by commas.

Current behavior:

- clear short comma-separated name lists are split into multiple software candidates;
- each candidate keeps the same raw `Utilisation` text;
- the original full cell value is preserved in the preview report;
- long descriptive comma-separated text is not split automatically.

This keeps the importer explicit and testable while avoiding destructive assumptions.

## Preview/import flow

### Step 1 - Preview

The preview reads the workbook and returns:

- source filename;
- detected worksheet;
- total rows inspected;
- valid software candidates;
- new records;
- existing matches;
- possible duplicates;
- skipped rows;
- split cells;
- warnings.

For each candidate it shows:

- original cell value;
- proposed software name;
- raw usage;
- result:
  - `new`
  - `existing`
  - `warning`
  - `skipped`

Preview means:

- the file is analyzed;
- the platform compares incoming software with the current catalogue;
- no write is made yet.

### Step 2 - Confirm

After explicit confirmation the server:

- inserts new software records;
- adds aliases when a useful source variant must be preserved;
- fills missing `description_raw` values safely on existing records;
- skips duplicate candidates inside the same import batch.

The import is designed to be idempotent:

- the same normalized name is not inserted twice;
- existing records are matched rather than duplicated;
- only safe missing fields are enriched automatically.

Confirmation means:

- the validated changes are finally applied;
- new software can be created;
- existing software stays in place without duplication;
- useful source variants can be stored as aliases.

### Duplicate handling

The platform handles duplicates conservatively:

- exact or capitalization-only matches are treated as existing software;
- a source name that matches an existing software but uses a preserved variant can be added as an alias;
- uncertain matches are left for review rather than merged automatically.

## Confidentiality rules

The catalogue workbook is confidential.

Rules:

- keep `data/imports/private/` ignored by Git;
- never expose the workbook through `/public`;
- never return the raw filesystem path to the browser;
- do not copy confidential workbook values into committed fixtures or docs;
- do not upload the workbook to external services.

## Known limitations

- only the current `.xlsx` catalogue workbook structure is supported;
- the importer does not handle `.xls` files;
- manual alias editing is simple text-based input in this first version;
- capitalization-only differences can be preserved as aliases, but broader semantic matching is deferred;
- no employee, competency, FCI, SWOT, or Go / No-Go modeling is included here.

## How to run the import locally

1. Ensure PostgreSQL is available and `DATABASE_URL` is configured for the Next.js process.
2. Start the application locally.
3. Open `/administration/logiciels`.
4. Click `Mettre a jour le catalogue`.
5. Select an `.xlsx` file from your computer.
6. Click `Analyser le fichier`.
7. Review the preview.
8. Click `Confirmer la mise a jour`.

## Local source path used during development

The development import page can read the protected local workbook directly from:

- `data/imports/private/referentiels/`

The file remains local and is never moved or exposed publicly.

This option is a development convenience and should not be the primary production workflow for business administrators.
