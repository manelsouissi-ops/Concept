# Historical project ingestion pilot

Date: 2026-08-27
Scope: build and locally test the controlled ingestion infrastructure for
FCI C's historical project-reference RAG pilot. No historical CONCEPT
project/offer content was ingested. No live service was modified or
restarted. No FCI module was touched.

```text
INFRASTRUCTURE READY           = YES
SYNTHETIC INGESTION TESTS      = PASS (27 tests, real local Postgres + a
                                  one-time manual Ollama/Qdrant smoke test,
                                  zero external calls)
REAL APPROVED CORPUS           = NO
REAL PROJECT INGESTION         = NO
REAL PROJECT VECTORS           = 0
REAL RAG RETRIEVAL VERIFIED    = NO
LIVE FCI C CONNECTED           = NO
REAL INGESTION                 = BLOCKED — NO APPROVED PILOT SET FOUND
```

## 1. Scope

Layer A (build the safe canonical ingestion/storage infrastructure) is
complete. Layer B (ingest 5–20 explicitly approved real records) did not
run: an exhaustive, honest search for any approved pilot manifest, folder,
or authorization artifact found none (see §16). Per instructions, no
document was selected unilaterally and no historical directory was
scanned. This is the correct, expected outcome when no approval exists yet
— not a technical failure.

## 2. Canonical data model

`HistoricalProjectRecordInput` (`lib/appels-offres/fci/historical-project-ingestion.ts`):

**Required** (never guessed when missing — the record is rejected instead):
`sourceDocumentFilename`, `sourceDocumentSourcePath` (local-only, never
exposed), `sourceReference` (safe label), `approvedSummaryText` (the only
free text ever embedded), `reuseStatus`.

**Optional**, `null` when unknown, never fabricated: `projectCode`,
`sourceSection`, `title`, `year`, `country`, `sector`, `subsector`,
`projectType`, `client`, `fundingInstitution`, `natureOfServices`,
`technicalScope`, `technicalComponents[]`, `keyDeliverables[]`.

The type itself is the PII/consultant guard: there is no field anywhere in
this schema that could hold a CV, a consultant name, a phone/email, or a
current-staffing/availability claim — confirmed by a dedicated test that
inspects the type definition's own field list, not just a runtime check.

## 3. Postgres strategy: a new dedicated table, not a discriminator column

Two options were evaluated against the actual current schema (audited
read-only, see §16 for exact counts):

- **Option A** (extend `knowledge_base.knowledge_document_versions` with a
  `document_type` discriminator): reuses existing columns, but several
  already happen to fit CDC business metadata specifically and would need
  new, CDC-irrelevant columns added for project-specific fields
  (`subsector`, `nature_of_services`, `technical_scope`,
  `technical_components`, `key_deliverables`, `approved_summary_text`,
  `reuse_status`) — widening a shared table with fields meaningless for
  most of its rows, and requiring every future CDC reader to remember to
  filter by the new column.
- **Option B** (a new dedicated table, chosen):
  `knowledge_base.historical_project_records` links to the *existing*
  `knowledge_documents`/`knowledge_document_versions` tables via foreign
  key on `document_version_id` (UNIQUE — exactly one project record per
  document version), reusing their filename/source-path/sha256/version
  identity rather than duplicating it, while keeping project-specific
  business fields and the approval/indexing state in their own table.

Option B was chosen because it makes zero changes to any existing table,
column, constraint, or index — the strongest possible reading of "do not
destabilize existing CDC ingestion" (see §4) — while still avoiding
duplicated provenance metadata by referencing, not copying, document/
version identity.

**Migration**: `scripts/sql/20260827_historical_project_records.sql`,
purely additive (`CREATE TABLE IF NOT EXISTS`, new indexes only). Applied
to the local database this session. Verified before and after: existing
`knowledge_documents`/`knowledge_document_versions`/`knowledge_ingestion_runs`
row counts unchanged (all still 0), no existing constraint or column
altered. No destructive statement of any kind appears in the migration.

## 4. Postgres remains the source of truth

Approval state (`reuse_status`), canonical metadata, content hash, and
indexing state (`index_status`, `qdrant_point_id`, `qdrant_collection`,
`indexed_at`, error fields) all live in
`knowledge_base.historical_project_records`. Qdrant holds only a retrieval
vector plus a minimal filter/provenance payload (§8) keyed by the same
`document_version_id`. If they ever disagree, Postgres wins: the
reconciliation functions (§13) are explicitly built to detect Postgres
records with no vector, Qdrant vectors with no matching approved Postgres
record, and stale vector content — all resolvable by re-running ingestion
from the Postgres row, never the reverse.

## 5. Qdrant collection

- Name: `concept_historical_projects` (created this session — did not
  exist before; verified first via `GET /collections` that it was absent,
  per Step 37).
- Vector size: **1024**, confirmed empirically by a real local call to
  Ollama's `/api/embed` with `qwen3-embedding:0.6b` on a non-confidential
  probe string — not assumed from documentation.
- Distance metric: Cosine, matching the existing `concept_historical_cdc`
  collection's configuration exactly (verified by reading that collection's
  live config before creating the new one).
- Point ID strategy: the project record's own `document_version_id` bigint,
  used directly as the Qdrant point ID. This differs from the CDC
  collection's UUIDv5(document-version, sha256, chunk-index) scheme
  deliberately: CDCs are chunked (many points per version, needing chunk
  index to disambiguate), while this pilot's retrieval unit is one point
  per project/offer record (Step 9) — a already-unique, already-stable
  integer identity needs no further derivation.

## 6. Embedding model

Ollama `/api/embed`, `qwen3-embedding:0.6b`, reused directly from
`rex-project-rag.ts`'s `embedTextLocally` (no second embedding client was
written — Step 15). Loopback-only, enforced at runtime before every call.

## 7. Embedding-text contract

`buildProjectEmbeddingText` joins, in a fixed field order, only:
`sector`, `subsector`, `projectType`, `country`, `natureOfServices`,
`technicalScope`, `technicalComponents`, `keyDeliverables`, and
`approvedSummaryText` — skipping absent fields. Deliberately excludes
identity/administrative fields (`sourceReference`, `projectCode`, `title`,
`client`, `year`) which carry no retrieval signal. Same canonical record
version always produces the same text (tested).

## 8. Provenance

Every point's Qdrant payload (`HistoricalProjectQdrantPayload`) carries
`document_id`, `document_version_id`, `source_reference` (safe label, never
a raw filesystem path — the writer never even has access to the source
path at payload-build time), `section`, `title`, plus the filterable
business fields and `content_hash`. `client` is deliberately **not**
written to Qdrant: `rex-project-rag.ts`'s suggestion logic never reads it
today, and a client name is more business-sensitive than the other filter
fields — kept out under the "minimal payload" rule (Step 13) until a
concrete need and access-control review justify adding it. A dedicated
test proves a payload built by this pilot's writer round-trips correctly
through `rex-project-rag.ts`'s existing Qdrant reader.

## 9. Approval lifecycle

`reuse_status` is one of `approved_for_rag | pending_review | rejected |
archived`, **defaulting to `pending_review`** on insert — nothing becomes
retrievable merely by being stored. `ingestHistoricalProjectRecord` checks
this status immediately after the canonical-record upsert and returns
`"not_approved"` **before calling the embedder at all** for anything not
`approved_for_rag` (tested, with an assertion that the injected embedder
was never invoked). AI extraction of project facts, if ever added later,
would still land as `pending_review` — approval is never inferred from
extraction succeeding, from folder location, or from any other automatic
signal.

## 10. Idempotency / versioning

- `upsertKnowledgeDocumentVersion` mirrors the existing CDC service's
  convention: same filename + same sha256 → reuses the existing version,
  no duplicate row (tested). Same filename + different sha256 → new
  version row, `version_number` incremented (tested).
- `computeProjectContentHash` hashes the embedding text plus the metadata
  fields that could change between re-ingestions. Identical canonical
  content → identical hash (tested) → `ingestHistoricalProjectRecord`
  returns `"unchanged"` and does **not** call the embedder again (tested,
  embed-call-count asserted). Changed `approvedSummaryText` → new hash →
  `index_status` reset to `pending`, triggering a real re-embed on the next
  ingestion run.

## 11. Indexing-state behavior (partial-failure safety)

`index_status` (`pending | indexed | failed`) is tracked independently of
`reuse_status`. A record can be `approved_for_rag` and still `pending` or
`failed` if embedding or the Qdrant upsert has not yet succeeded — it is
never silently reported as fully indexed on partial failure. Tested
explicitly: an embedding failure leaves the canonical Postgres row intact
(`reuse_status` unchanged, `index_status = 'failed'`,
`index_error_message` populated) rather than losing the record or
fabricating a success.

## 12. Reconciliation

Three pure comparison functions, each operating on already-fetched lists
(no live scheduler, per Step 18): `findApprovedRecordsMissingVectors`
(approved but `index_status != indexed`), `findOrphanVectorPointIds`
(Qdrant points with no matching approved+indexed Postgres row), and
`findStaleVectorRecords` (a stored vector's payload content hash no longer
matches the current Postgres content hash). All three are unit-tested.

## 13. De-approval

`deapproveHistoricalProjectRecord` sets `reuse_status` to
`rejected`/`archived`/`pending_review`, resets `index_status` back to
`pending` if the record currently has an indexed vector, and **itself**
calls `deleteHistoricalProjectVector` to remove the point from Qdrant —
this is a single function a caller can rely on to actually stop retrieval,
not two steps that could be forgotten (a review pass this session found
and closed exactly this gap in an earlier draft, where Qdrant cleanup was
left to the caller). Postgres is updated first, so a Qdrant deletion
failure still leaves the canonical de-approval recorded (tested); the
function reports `vectorDeleted: false` in that case, and the resulting
drift (Postgres says not-approved, a stale point still exists in Qdrant)
is exactly what `findOrphanVectorPointIds` is built to catch on a later
reconciliation pass. The Postgres row and its full audit trail are always
preserved, never deleted (tested). The real deletion call itself was also
verified working against the live local collection in a one-time manual
smoke test this session (§16).

## 14. PII exclusion

Enforced structurally, not by a best-effort filter: the canonical record
type has no field that could hold a CV, a consultant name, a phone number,
an email address, or a current-staffing/availability claim (tested by
inspecting the type definition itself). The only free text ever embedded
is `approvedSummaryText`, which by construction must already be an
approved, human-reviewed project/business summary — this pilot's ingestion
code has no document-parsing or text-extraction step of its own that could
accidentally copy incidental personal data out of a source PDF into the
canonical record.

## 15. Controlled pilot authorization boundary

`scripts/ingest-historical-project-records.ts` is a local CLI script (not
a web endpoint — Step 16), takes an explicit manifest file path as its only
argument, refuses to run against more than 20 entries, and does not scan
any directory on its own. It was written and typechecked this session but
**was not run with real data** — no approved manifest exists to run it
against (§16).

**Manifest contract** (`HistoricalProjectRecordInput`, one array entry per
approved record). The example below uses only synthetic placeholders — no
real CONCEPT project was used to produce it, and no such file has been
created in this repository:

```json
[
  {
    "sourceDocumentFilename": "example-project-01.pdf",
    "sourceDocumentSourcePath": "/path/to/approved/pilot/folder/example-project-01.pdf",
    "sourceReference": "historical-projects-pilot-2026/example-project-01",
    "sourceSection": "Résumé du projet",
    "approvedSummaryText": "One or two human-approved sentences describing the project's scope and relevance for REX reuse.",
    "reuseStatus": "approved_for_rag",
    "projectCode": null,
    "title": "Example water-sector supervision project",
    "year": "2023",
    "country": "Example Country",
    "sector": "Example sector",
    "subsector": "Example subsector",
    "projectType": "Example project type",
    "client": null,
    "fundingInstitution": "Example funding institution",
    "natureOfServices": "Example nature of services",
    "technicalScope": "Example technical scope",
    "technicalComponents": ["Example component A", "Example component B"],
    "keyDeliverables": ["Example deliverable A"]
  }
]
```

Any field left unknown for a real record must be `null` (or omitted for
the optional ones) rather than guessed — the ingestion code enforces this
by never fabricating a value for a field the caller did not supply.

## 16. Actual real-data status (truthful)

Read-only Postgres audit at the start of this session (re-verified, not
assumed from prior reports):

```
knowledge_base.knowledge_documents          : 0
knowledge_base.knowledge_document_versions  : 0
knowledge_base.knowledge_ingestion_runs     : 0
```

Approved-pilot-set search performed: checked for a dedicated pilot folder,
a committed/internal approved manifest, an existing approved record list,
`KB_SOURCE_DIR` or any similar environment pointer, and any file/directory
matching "approved"/"pilot manifest" naming under the repository and the
user's home directory (excluding tool caches). **None found.** No
recursive scan of the historical archive was performed, consistent with
instructions.

**Final counts, real data only:**

```
canonical project records total : 0
approved_for_rag                : 0
pending_review                  : 0
failed                          : 0
indexed vectors                 : 0
missing vectors                 : 0
orphan vectors                  : 0
```

All 25 automated tests in `historical-project-ingestion.test.ts` use
synthetic fixtures (fabricated filenames, fabricated sha256 hashes,
generic non-confidential text like "Hydraulique urbaine" / "Togo" as
placeholder values) against the real local test Postgres database, with
full cleanup after each run (verified: 0 rows before and after). One
additional, non-automated manual verification was performed once this
session: a real call to local Ollama (`qwen3-embedding:0.6b`, confirmed
1024-dimensional) followed by a real upsert and a real delete against the
newly created `concept_historical_projects` Qdrant collection, using a
synthetic point ID (999999001, clearly out of range of any real
`document_version_id`) and synthetic text — proving the end-to-end local
wiring genuinely works, then immediately cleaned up. The collection's
final point count is 0.

## 17. Tests

27 tests in `lib/appels-offres/fci/historical-project-ingestion.test.ts`:
canonical validation (4), embedding-text/content-hash determinism (3),
Qdrant payload shape and point-ID strategy (2), PII/no-mutation structural
guards (3), reconciliation (3), Postgres-backed idempotency/versioning (2),
approval-gate behavior (2), full ingestion orchestration — indexed,
unchanged, not-approved, failed (4), de-approval including a Qdrant-failure
path that still de-approves in Postgres (2), index-status transitions (1),
and one cross-module retrieval-compatibility round-trip
test against `rex-project-rag.ts`. All pass. Existing `rex-project-rag.ts`
(22), FCI A/B/C/D provider/quality/lifecycle/RBAC/readiness regression
suites (104 non-DB + 47 DB-dependent) were re-run unmodified and continue
to pass — zero regressions.

## 18. Limitations

- Zero real historical project data exists anywhere in this system; the
  entire pipeline is proven against synthetic fixtures plus one manual
  local smoke test, not against real CONCEPT project content.
- No human review/approval workflow (UI or otherwise) exists yet for
  moving a record from `pending_review` to `approved_for_rag` — today that
  transition can only happen by directly constructing an already-approved
  `HistoricalProjectRecordInput`, which itself presumes an external,
  already-completed human approval process feeding the ingestion script's
  manifest.
- `client` is intentionally not indexed in Qdrant (§8); if a future need
  requires filtering by client, that requires its own access-control
  review, not just a field addition.
- The reconciliation functions are pure comparison logic only — there is
  no scheduled job or admin UI running them yet (deliberately, per Step 18).

## 19. Next step toward FCI C retrieval verification

Obtain an explicitly approved 5–20-record historical project/offer
manifest from the business (a designated folder, an internal approved
list, or an equivalent unambiguous authorization artifact). Only then:
run `scripts/ingest-historical-project-records.ts` against exactly that
manifest, verify counts/provenance/idempotency against the real records,
and perform a real local-only retrieval smoke test using
`rex-project-rag.ts` against one authorized current tender context —
still without connecting anything to live FCI C. Live FCI C UI/API
integration remains a separate, later milestone.

## 20. Relationship to the deterministic closest-CDC search

As already established in `docs/FCI_C_TARGETED_RAG_PILOT.md`: no 21-point
closest-CDC algorithm is implemented in this codebase today. This
project-reference corpus and collection are not a substitute for it and
were not built to become one. They answer a different question —
"which CONCEPT-delivered project provides citable REX evidence" — using
semantic similarity over project records, never CDC proximity.
