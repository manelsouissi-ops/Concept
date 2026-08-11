# CONCEPT — Installation and Supervisor Handoff

This handoff was derived from the repository at `/home/concept/Concept`, its sanitized configuration shape, the local n8n database, and the Marker service found at `/home/concept/FastMarker-API` on 10 August 2026. Secret values are deliberately omitted.

## 1. Architecture overview

| Component | Current version | Address | Purpose |
|---|---:|---|---|
| CONCEPT / Next.js | Next 15.5.20, Node 22.23.2, npm 10.9.8 | `http://127.0.0.1:3000` | UI, authentication/RBAC, business workflow, callbacks and exports |
| PostgreSQL | 18.4 | `127.0.0.1:5432`, database `GONOGO` | Application system of record |
| n8n | 2.26.6 | `http://127.0.0.1:5678` | CDC extraction and FCI generation orchestration |
| Marker FastAPI | Marker PDF 1.10.2, Python 3.11 venv | `http://127.0.0.1:8000` | PDF-to-Markdown conversion |
| Callback signer | Python standard library | `http://127.0.0.1:8899/sign` | HMAC-SHA256 callback signing for CDC and FCI |
| Ollama | model `llama3.1` | `http://127.0.0.1:11434` | CDC anonymization inside n8n |
| Gemini API | remote HTTPS API | Google endpoint | CDC XML and FCI JSON generation |
| LibreOffice | 26.2.4.2 locally | command line | DOCX-to-PDF conversion |

The application sends CDC jobs to `/webhook/cdc-initiation-fiche-projet-xml` and FCI jobs to `/webhook/fci-module-generation`. n8n calls Marker/Ollama/Gemini, asks the local signer to sign the exact callback body, and calls the callback URL supplied by CONCEPT. `PLATFORM_PUBLIC_BASE_URL` must therefore resolve from n8n and must match the application port.

PostgreSQL was installed locally but its cluster was down during this audit. No service was listening at audit time. Static configuration and exports were validated; live database contents could not be re-read.

pgAdmin is not used by code or scripts and is not required.

## 2. Required files to transfer

Transfer these items through an encrypted channel:

1. The complete `Concept` repository, including `ai/templates/fci/*.docx`, `ai/prompts`, `ai/schemas`, `public/pdfjs`, `n8n/workflows`, and the lifecycle scripts in the repository root.
2. The separate Marker source directory. It is currently `/home/concept/FastMarker-API`; do not transfer its `.venv`, rebuild it.
3. A PostgreSQL custom-format dump of `GONOGO`. A dump is required to reproduce current users, RBAC data, dossiers, FCI state, Go/No-Go reports and audit history. The SQL files alone do not contain that data and are not a complete greenfield bootstrap (some later migrations expect `app_users` and `app_departments`, which application repositories create).
4. `data/` from the project, preserving permissions. It contains uploaded CDC PDFs plus generated XML, Markdown and status artifacts and is intentionally git-ignored.
5. The two required n8n exports:
   - `n8n/workflows/cdc-initiation-fiche-projet-xml.json` — current ID `f866bd39869c4c11`.
   - `n8n/workflows/fci-module-generation.json` — current ID `kEdTbJ7VBcg54Gkn`.
6. Optional legacy preservation export: `n8n/workflows/for-com-02-go-no-go.json`, current ID `3C2JWQ2H4aa1xb9G`. It queries legacy tables (`offres`, `fci_outputs`, `knowledge_base`, `feedback_corrections`, `resultats_gonogo`) and is not used by the current Next.js Go/No-Go implementation. Do not activate it on a clean current installation.
7. Secret values from `.env.local`, transferred separately and entered into a new `.env.local`. Never transfer secrets in this document or commit them.

Do not copy `node_modules`, `.next*`, the Marker `.venv`, logs, PIDs, or plaintext n8n credential exports. The n8n SQLite database may be archived encrypted if execution history is legally/operationally required, but workflow JSON plus recreated credentials is the safer installation method.

Example transfer commands, run from the old machine:

```bash
tar --exclude=node_modules --exclude=.next-dev --exclude=.next-prod \
  --exclude=tmp -czf concept-source-and-data.tar.gz Concept
tar --exclude=.venv --exclude=.git -czf fastmarker-api.tar.gz FastMarker-API
```

## 3. Ubuntu prerequisites

The audited host is Ubuntu 26.04. Install the base packages:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git build-essential \
  python3 python3-venv python3-pip python-is-python3 \
  postgresql-client-18 libreoffice
```

Marker is known working under Python 3.11.15. Recreate that environment with a Python 3.11 provider (for example `uv`) rather than assuming the operating system Python 3.14 is compatible:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Ollama is required by the exported CDC workflow:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.1
sudo systemctl enable --now ollama
```

## 4. Node.js and npm

Use Node.js 22 LTS. The exact audited versions are Node `22.23.2` and npm `10.9.8`. `package.json` has no `engines` constraint, but test scripts use Node's type-stripping support, so older Node releases are not recommended.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
cd ~/Concept
npm ci
sudo npm install --global n8n@2.26.6
```

Do not run a floating `npm install -g n8n`; pin `2.26.6`, matching the exports and local database.

## 5. PostgreSQL

Install PostgreSQL 18 from the PostgreSQL Apt repository if it is not already available:

```bash
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update
sudo apt install -y postgresql-18 postgresql-client-18
sudo systemctl enable --now postgresql
```

The actual connection shape is `postgresql://postgres:<secret>@localhost:5432/GONOGO`. A least-privilege application role is preferable on the replacement machine, but a restored dump must be tested with the chosen role.

Create an empty target only when preparing to restore:

```bash
sudo -u postgres psql -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE concept_user LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';"
sudo -u postgres createdb --owner=concept_user GONOGO
```

Exact backup command on the source machine:

```bash
cd ~/Concept
set -a; source .env.local; set +a
pg_dump --dbname="$DATABASE_URL" --format=custom --verbose \
  --file="concept-GONOGO-$(date +%F).dump"
pg_restore --list "concept-GONOGO-$(date +%F).dump" >/dev/null
```

Exact restore command on the new machine (target database must be empty):

```bash
sudo -u postgres dropdb --if-exists GONOGO
sudo -u postgres createdb --owner=concept_user GONOGO
sudo -u postgres pg_restore --dbname=GONOGO --no-owner --role=concept_user \
  --clean --if-exists --exit-on-error --verbose concept-GONOGO-YYYY-MM-DD.dump
psql 'postgresql://concept_user:REPLACE_WITH_URL_ENCODED_PASSWORD@127.0.0.1:5432/GONOGO' \
  -v ON_ERROR_STOP=1 -c 'select current_database(), current_user;'
```

For an existing older database, apply migrations in this exact filename order:

```bash
for migration in \
  scripts/sql/20260714_appels_offres_business_data.sql \
  scripts/sql/20260714_platform_n8n_contract.sql \
  scripts/sql/20260722_administration_logiciels.sql \
  scripts/sql/20260722_appel_offres_software_analysis.sql \
  scripts/sql/20260727_appels_offres_fci.sql \
  scripts/sql/20260727_appels_offres_fci_phase4_orchestration.sql \
  scripts/sql/20260802_authentication.sql \
  scripts/sql/20260806_appels_offres_workflow_phase2.sql \
  scripts/sql/20260806_app_notifications_phase3.sql \
  scripts/sql/20260806_appels_offres_commercial_ownership_phase5.sql \
  scripts/sql/20260806_go_no_go_reports_phase4.sql
do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
```

Prefer restoring the verified dump. The migration directory is additive history, not a declared migration framework or complete empty-database installer.

## 6. CONCEPT application

```bash
cd ~
git clone REPLACE_WITH_REPOSITORY_URL Concept
cd Concept
npm ci
cp env.example .env.local
chmod 600 .env.local
```

Replace every `CHANGE_ME` and every `/home/USER` path. Restore `data/` under `~/Concept/data`. It must be writable by the account running Next.js and readable by n8n. Preserve the four DOCX files in `ai/templates/fci`; module mappings are A→`FCI_DC.docx`, B→`FCI_DF.docx`, C→`FCI_DO.docx`, D→`FCI_DG.docx`.

Authentication uses an HTTP-only session cookie derived from `AUTH_SECRET`. Roles are `ADMIN`, `COMMERCIAL`, `FINANCE`, `OPERATIONS`, and `DIRECTION_GENERALE`. Production must keep `CONCEPT_ENABLE_DEV_USER_SWITCHER=false`. Development seed passwords are still sensitive and must not be defaults.

## 7. Marker service

The service was automatically located at `/home/concept/FastMarker-API`; set its replacement path in `MARKER_SERVICE_DIR`. Its checked-in `requirements.txt` contains the API layer but not the Marker CLI, so install both explicitly:

```bash
cd ~/FastMarker-API
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python -r requirements.txt
uv pip install --python .venv/bin/python marker-pdf==1.10.2
.venv/bin/marker_single --help >/dev/null
MARKER_DATA_ROOT="$HOME/.n8n-files" \
  .venv/bin/python -m uvicorn marker_api:app --host 127.0.0.1 --port 8000
```

Verify with `curl -f http://127.0.0.1:8000/docs`. Jobs are held in memory; restarting Marker loses pollable job state, although disk files remain under `MARKER_DATA_ROOT/incoming` and `marker_output`.

## 8. n8n

Start n8n once, create the owner account through `http://127.0.0.1:5678`, then import the two required JSON files from the UI or CLI:

```bash
cd ~/Concept
n8n import:workflow --input=n8n/workflows/cdc-initiation-fiche-projet-xml.json
n8n import:workflow --input=n8n/workflows/fci-module-generation.json
```

Activate both workflows after their runtime environment is loaded and dependencies pass. Imported workflow IDs may change; CONCEPT does not depend on those IDs. It depends on the webhook paths in `N8N_WEBHOOK_URL` and `FCI_N8N_WEBHOOK_URL`. Do not use `/webhook-test/`; production activation uses `/webhook/`.

The CDC and FCI exports have no n8n credential bindings. They require runtime environment variables: `GEMINI_API_KEY`, launch/callback tokens, contract versions, signer URLs, Marker URLs, file roots, and `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`. `start-concept.sh` loads these from `.env.local`. Keep n8n bound to localhost unless a reverse proxy, TLS and n8n authentication have been deliberately configured.

The optional legacy FOR-COM-02 export references the n8n credential named `Postgres CONCEPT loca` (type `postgres`) and legacy schema objects. Recreate that credential only for an intentional legacy recovery; do not expose its password or activate the workflow against the current schema.

Other inactive workflows found in the old n8n database were diagnostic/backfill/history artifacts and are not required by the application: `CDC Diagnostic - Direct Test`, `GoNoGo - CDC Automatisation`, `GoNoGo - Backfill Knowledge Vectors`, and `My workflow`.

## 9. Callback signer

The signer is still required by both exported active workflows. CONCEPT verifies HMAC-SHA256 over `<timestamp>.<raw JSON body>`. Run:

```bash
cd ~/Concept
set -a; source .env.local; set +a
python3 scripts/callback-signer.py
curl -f http://127.0.0.1:8899/health
```

`FCI_CALLBACK_HMAC_SECRET` must match the FCI callback verifier; `N8N_CALLBACK_SECRET` must match the CDC verifier. The current helper uses the FCI secret first. Therefore set both to the same high-entropy secret unless the workflows are changed to use separate signer instances.

## 10. Document generation

FCI DOCX export calls `python` and fills the checked-in templates directly using Python's standard ZIP/XML libraries; no `python-docx` package is required. The Go/No-Go DOCX report uses a separate standard-library exporter and does not use a template. `python-is-python3` supplies the expected `python` command.

PDF export first produces DOCX and then invokes headless LibreOffice. Verify it with:

```bash
python --version
libreoffice --version
libreoffice --headless --convert-to pdf --outdir /tmp /path/to/test.docx
```

If LibreOffice is absent, Word export remains available but the PDF endpoint returns `FCI_EXPORT_PDF_UNAVAILABLE`/HTTP 503.

## 11. Environment variables

Use `env.example` as the complete sanitized template. Required secrets are the database password, `AUTH_SECRET`, launch bearer tokens, callback bearer tokens, callback HMAC secrets and `GEMINI_API_KEY`. Optional/defaulted variables are annotated in that file. `N8N_COMPLETE_SECRET` is legacy and may stay empty when nothing calls `/api/fiche/[code]/complete`.

Generate independent secrets with `openssl rand -hex 32`. Do not paste real values into workflow JSON, shell history, tickets, or this guide.

## 12. Start everything

Manual order:

```bash
sudo systemctl start postgresql ollama
cd ~/FastMarker-API && MARKER_DATA_ROOT="$HOME/.n8n-files" .venv/bin/python -m uvicorn marker_api:app --host 127.0.0.1 --port 8000
cd ~/Concept && set -a && source .env.local && set +a && python3 scripts/callback-signer.py
cd ~/Concept && set -a && source .env.local && set +a && n8n start
cd ~/Concept && npm run dev -- --port 3000
```

For the managed local stack:

```bash
cd ~/Concept
./start-concept.sh
```

It avoids duplicate HTTP services, records only PIDs it starts under `tmp/concept-runtime`, writes logs under `tmp/concept-logs`, starts PostgreSQL if possible, and prints all URLs. Ollama is managed as a system service; the script warns if it is unavailable.

## 13. Stop everything

```bash
cd ~/Concept
./stop-concept.sh
```

It stops only PID-recorded CONCEPT, n8n, signer and Marker processes. It deliberately leaves shared PostgreSQL and Ollama system services running.

## 14. Health check

```bash
cd ~/Concept
./check-concept.sh
```

This checks required variables (without printing values), PostgreSQL readiness and an authenticated `select 1`, CONCEPT `/login`, n8n `/healthz`, Marker `/docs`, signer `/health`, and Ollama `/api/tags`.

## 15. End-to-end validation

Use separate active users for the role gates. The current implemented path is:

1. Sign in as `COMMERCIAL`; create a dossier in **Appels d'offres → Nouveau**, assign a commercial owner, and upload a real CDC PDF. Confirm `data/<CODE>/cdc.pdf` and the `documents` row exist.
2. Launch CDC analysis. Confirm n8n accepts the request (HTTP 202), Marker completes, Ollama anonymizes, Gemini generates XML, the signed callback reaches `/api/fiche/callbacks/n8n`, and the UI leaves “En cours d'analyse”.
3. Review the generated **Fiche CDC**, resolve/ignore/comment flagged controls, save it, then click **Valider la Fiche CDC**. A validated fiche is the source gate for FCI.
4. Initialize/generate FCI. Module A is Commercial; assign B to an active `FINANCE` user and C to an active `OPERATIONS` user. Although module D exists in templates/schema, current readiness is explicitly based on A/B/C.
5. As Finance and Operations, accept/work the assigned B/C modules, complete required fields and validate them. As Commercial, complete and validate A. Confirm workflow state progresses through `FCI_GENERATED`/`FCI_ASSIGNED`, derived `FCI_IN_PROGRESS`, then derived `READY_FOR_GONOGO` only when A/B/C are validated.
6. Sign back in as Commercial. Open Commercial preparation, generate the Go/No-Go report, review/edit/save every required section and export DOCX and PDF. Prepare the workflow; explicit state becomes `GONOGO_PREPARED`.
7. Submit the report to DG. Confirm state `SUBMITTED_TO_DG`, DG notification creation, and that DG can now access the dossier. Repeated submission is idempotent.
8. Sign in as `DIRECTION_GENERALE`, review the submitted material and record either GO or NO-GO with rationale/reserves. Confirm final state `GO_DECIDED` or `NO_GO_DECIDED`, audit events and notifications. A NO-GO closes the negative path; GO is the positive terminal decision implemented here.
9. Check the dossier History tab, PostgreSQL audit/workflow/report tables, and `./check-concept.sh`.

The legacy n8n FOR-COM-02 workflow is not part of steps 6–8; the current report, submission, DG decision and reopen actions are implemented in Next.js API/service code.

## 16. Troubleshooting

- **Port already in use:** run `ss -ltnp | grep -E ':(3000|5432|5678|8000|8899|11434)\b'`. Do not let Next.js auto-hop: free port 3000 or change both `CONCEPT_APP_PORT` and `PLATFORM_PUBLIC_BASE_URL`, then ensure n8n can reach the new URL.
- **PostgreSQL connection failure:** run `pg_lsclusters`, `sudo systemctl status postgresql`, `pg_isready -h 127.0.0.1 -p 5432`, then `psql "$DATABASE_URL" -c 'select 1'`. URL-encode special password characters.
- **n8n credentials/config missing:** required current workflows use environment variables, not saved credential bindings. Restart n8n after updating `.env.local`. The legacy workflow alone requires its PostgreSQL credential.
- **Webhook mismatch:** activate workflows and use `/webhook/...`, not `/webhook-test/...`. Confirm the exact two paths in `env.example`; workflow IDs are irrelevant to the application.
- **Marker unavailable:** inspect `tmp/concept-logs/marker.log`, verify the Python 3.11 venv, run `.venv/bin/marker_single --help`, and check `MARKER_DATA_ROOT` permissions.
- **Ollama unavailable:** `systemctl status ollama`, `curl http://127.0.0.1:11434/api/tags`, and `ollama list`; pull `llama3.1` if absent.
- **Signer/callback rejected:** confirm bearer tokens independently, ensure both HMAC variables match the signer policy, synchronize system time, and verify `PLATFORM_PUBLIC_BASE_URL` is reachable from n8n.
- **Stale Next.js cache/chunks:** stop CONCEPT, move `.next-dev` aside (or delete only that generated directory), run `npm ci`, and restart. Never delete `data/`.
- **PDF conversion unavailable:** install/check LibreOffice, ensure `/tmp` is writable, and test a DOCX manually with headless conversion.
- **Environment variable missing:** run `./check-concept.sh`; compare variable names with `env.example`, never values with documentation.
- **Database migration mismatch:** stop writes, take a new `pg_dump`, apply each SQL file with `-v ON_ERROR_STOP=1`, and inspect the first failure. Do not mark a migration as applied manually; restore the known-good dump if the base schema is incomplete.

## 17. Final verification checklist

- [ ] Source, `data/`, Marker source and the verified PostgreSQL dump were transferred.
- [ ] Node 22, npm, n8n 2.26.6, PostgreSQL 18, Python 3.11 Marker venv, Ollama `llama3.1`, and LibreOffice are installed.
- [ ] `.env.local` contains no placeholders and is mode 600.
- [ ] Required CDC and FCI workflows are imported and active; legacy FOR-COM-02 is inactive.
- [ ] `./start-concept.sh` succeeds and `./check-concept.sh` reports all passes.
- [ ] CDC → validated Fiche CDC → FCI A/B/C → assignments → report → DG submission → GO and NO-GO paths were tested with role-appropriate accounts.
- [ ] DOCX and PDF exports open successfully.
- [ ] A fresh post-install database backup was taken and restore-tested.

Remaining manual work is unavoidable: securely supply secrets, transfer/restore the live database and git-ignored `data/`, create the first n8n owner, import/activate workflows, confirm Gemini access, and perform the role-based end-to-end test. Because PostgreSQL was down during this audit, a source-machine operator must start it and create/verify the final dump before transfer.
