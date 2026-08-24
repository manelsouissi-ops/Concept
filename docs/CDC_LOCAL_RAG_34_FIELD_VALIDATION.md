# Local RAG canonical Fiche CDC validation

Date: 2026-08-11. This is an experimental, non-authoritative validation. Gemini remains the W2 default and source of the persisted `fiche.xml`.

## Canonical inventory and strategy

Every extraction element is structurally required and requires a `source` attribute. A document absence is represented by the text `Non trouvé`; it is not represented by omitting a tag. All values are XML strings. Count fields are locally constrained to integers. Evidence is tender-scoped hybrid retrieval (dense + BM25 + RRF + deterministic reranking), with at most two chunks passed to a field prompt and one correction attempt.

| XML tag | Meaning/category | Source | Rule/evidence strategy | Implemented |
|---|---|---|---|---|
| `reference_officielle` | Official reference / identification | CDC | Populated multi-part identifier; reject template | yes |
| `intitule_mission` | Mission title / identification | CDC | Full populated title | yes |
| `client_maitre_ouvrage` | Client/authority / identification | CDC | Named contracting authority | yes |
| `pays` | Country / identification | CDC | Explicit client/project country | yes |
| `zone_execution` | Execution geography / identification | CDC | Explicit locations | yes |
| `projet_rattachement` | Parent project / identification | CDC | Named project, not financer | yes |
| `source_financement` | Financing source / identification | CDC | Institution/source, not credit number | yes |
| `credit_financement` | Financing identifier / identification | CDC | Credit/loan/grant number | yes |
| `secteur` | Sector / identification | CDC | Explicit mission domain | yes |
| `nature_prestation` | Service nature / identification | CDC | Consulting scope/category | yes |
| `type_procedure` | Procedure / procurement | CDC | Explicit procedure | yes |
| `methode_selection` | Selection method / procurement | CDC | Method and acronym | yes |
| `type_proposition` | Proposal type / procurement | CDC | PTC/PTS or equivalent | yes |
| `type_contrat` | Contract type / procurement | CDC | Remuneration/contract form | yes |
| `date_emission` | Issue date / procurement | CDC | Complete date; not deadline | yes |
| `date_limite_depot` | Submission deadline / procurement | CDC | Complete populated deadline; reject template | yes |
| `langue_offre` | Proposal language / procurement | CDC | Explicit required language | yes |
| `ponderation_technique_financiere` | T/F weighting / procurement | CDC | Preserve both weights | yes |
| `note_technique_minimale` | Minimum score / procurement | CDC | Preserve score/units | yes |
| `duree_totale` | Mission duration / duration | CDC | Preserve equivalent units | yes |
| `volume_hommes_mois` | Expert-month volume / duration | CDC | Explicit total and unit | yes |
| `nombre_profils_experts` | Key-profile count / duration | deterministic derivation from CDC list | Integer; cite complete list | yes |
| `phases_mission` | Mission phases / duration | CDC | Explicit stages | yes |
| `livrables_principaux` | Main deliverables / deliverables | CDC | Evidence-backed concise list | yes |
| `nombre_livrables_structurants` | Milestone count / deliverables | deterministic derivation from CDC schedule | Integer; cite schedule | yes |
| `profils_cles` | Key profiles / resources | CDC | Evidence-backed list | yes |
| `disciplines_techniques` | Disciplines / resources | CDC | Evidence-backed list | yes |
| `nombre_sites` | Site count / constraints | deterministic derivation from CDC locations | Integer; cite complete locations | yes |
| `contraintes_site` | Site constraints / constraints | CDC | Explicit constraints only | yes |
| `outils_methodes` | Methods/tools / constraints | CDC | Explicit methods/software/calculations | yes |
| `moyens_materiels` | Material means / constraints | CDC | Explicit equipment/resources | yes |
| `exigences_es` | E&S requirements / constraints | CDC | Explicit safeguards only | yes |
| `normes_referentiels` | Standards/frameworks / constraints | CDC | Named standards/codes | yes |
| `points_techniques_structurants` | Structuring technical points / constraints | CDC | Evidence-backed synthesis | yes |

The three evaluation nodes (`complexite_technique`, `difficulte_terrain`, `risque_sous_dimensionnement`) are semantic Qwen judgments over already-grounded extracted facts. Notes must be integers 1–5 and justifications are mandatory; under-sizing also requires `charge_estimee`. Qwen is explicitly forbidden to invent a replacement effort estimate. `champs_non_trouves`, `incoherences`, and `a_verifier` are application-owned deterministic controls. Missing fields are derived mechanically; no inconsistency is asserted without a validated deterministic rule.

## Canonical interpretation rules for disputed fields

These rules define the application contract independently of any benchmark Fiche. A populated item must remain directly grounded in its cited CDC evidence.

| Field | Canonical interpretation |
|---|---|
| `duree_totale` | The consultant assignment execution period, from commencement through completion of required services. Prefer an explicit total; otherwise use the complete mandatory phase sum/range. Exclude proposal validity, the wider project or works duration, defect-liability monitoring, and a maximum contract period unless explicitly included in the assignment. |
| `nombre_profils_experts` | Count distinct mandatory key-expert profile categories once. Exclude support/non-key personnel, alternates, optional profiles, and repeated deployment of one profile. An explicit total controls only when it has that same scope. |
| `nombre_sites` | Count distinct explicitly identified physical execution locations once. Lots, components, structures, and repeated mentions are not additional sites. Return `Non trouvé` when available evidence cannot support a complete count. |
| `type_procedure` | Use the populated procurement document/notice taxonomy: request for proposals, invitation for bids, request for expressions of interest, or another explicitly titled procedure. It is distinct from `methode_selection`, `type_proposition`, and `type_contrat`; the populated title has priority over generic instructions. |
| `nature_prestation` | Return the primary explicitly required service category, such as study/design, supervision/control, audit, or technical assistance. Add secondary categories only when separately mandated. |
| `phases_mission` | **EXHAUSTIVE:** normalized unique list of explicitly named mandatory consultant-assignment phases. Activities, deliverables, works phases, and optional extensions are excluded. |
| `livrables_principaux` | **EXHAUSTIVE:** normalized unique list of explicitly required formal deliverables or approval milestones. Routine correspondence, internal working papers, and template examples are excluded. |
| `disciplines_techniques` | **EXHAUSTIVE:** normalized unique technical specialties represented by mandatory key profiles or required workstreams. Remove role prefixes and exclude management-only or support roles. |
| `outils_methodes` | **EXHAUSTIVE:** normalized unique mandatory methods, investigations, calculations, models, and software/tool uses. Exclude generic methodology prose and optional examples. |
| `moyens_materiels` | **EXHAUSTIVE:** normalized unique consultant-provided equipment, instruments, vehicles, laboratory, and software resources explicitly required. Exclude client-provided resources and examples. |
| `exigences_es` | **EXHAUSTIVE:** normalized unique project/contract E&S duties, safeguards, mitigation, and compliance requirements. Background descriptions and expert qualifications are excluded. |
| `normes_referentiels` | **EXHAUSTIVE:** normalized unique named standards, codes, regulations, manuals, and reference frameworks explicitly made applicable. A generic statement that rules apply is insufficient. |
| `points_techniques_structurants` | **STRUCTURING_ONLY:** normalized unique source-explicit technical features that materially shape scope, design, or delivery. Minor tasks, generic quality statements, and inferred conclusions are excluded. |

For every exhaustive list, “exhaustive” means exhaustive within the bounded evidence supplied to extraction. Candidate selection currently aggregates relevant structured sections only for fields with an implemented bounded continuation strategy; other list fields can still be partial and must not be treated as exhaustive without adjudication. Extraction must never widen a list using uncited source text.

## Results

AO-20260810-0958 produced a structurally complete 34-field candidate in 34.75 s (207 chunks, 1024-dimensional embeddings). The unchanged `parseFiche` validator accepted 34 extraction fields, 3 evaluations, and all controls. Content comparison against the persisted Gemini fiche gave 5 exact, 4 semantically matching, 3 conflicting, and 22 missing fields. All populated local claims cited supplied tender-scoped chunks, but citation grounding does not make a value semantically correct (for example `source_financement` incorrectly selected the credit identifier).

AO-20260810-0828 also produced a 34-element valid local structure in 34.70 s in the preceding field-scoped run, with 9 populated values. It is a second conversion of the same procurement dossier, not an independent tender, so it proves only structural/repeat-run behavior and not multi-tender generalization.

The readiness gate therefore fails. The local-only W2 branch remains deliberately blocked. Missing/conflicting content is rejected or exposed in shadow telemetry; it is never persisted. Gemini remains authoritative and default.
