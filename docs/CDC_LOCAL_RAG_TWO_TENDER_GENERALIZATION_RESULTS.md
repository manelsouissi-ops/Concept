# CDC local RAG — two-tender generalization results

Date: 2026-08-12. Shadow/local evaluation only. Gemini remains authoritative.

## A. Objective

Improve the existing section-aware architecture through reusable document-pattern rules, without tender-specific identifiers, expected answers, production workflow changes, global Top-K growth, or weakened validation.

## B. Tender A baseline

`AO-20260810-0958`: 33/34 correct populated fields, one correctly missing field, zero unsupported claims, valid XML and evaluations, 5/5 stable, 45.86 s mean runtime.

## C. Tender B blind baseline

`AO-20260812-0840`: 7 correct, 9 partial, 6 incorrect, 12 incorrectly missing, zero correctly missing, zero unsupported claims. The service failed closed with 422 before XML/evaluations because the financing identifier and E&S result failed canonical validation. Runtime to failure was 43.34 s for 514 nodes.

## D. Cross-tender failure matrix (completed before implementation)

| Field | Tender A baseline | Tender B blind result | A evidence type | B evidence type | Failure class | Reusable document-pattern problem |
|---|---|---|---|---|---|---|
| `reference_officielle` | correct | correct | compact cover label/value | populated cover heading | none | Preserve structural cover priority. |
| `intitule_mission` | correct | incorrect | cover/invitation designation | cover designation versus TDR objective | current value displaced | Explicit designation must outrank generic objective prose. |
| `client_maitre_ouvrage` | correct | incorrectly missing | compact cover Client label | populated IC 2.1 organization | populated IC missed | Populated label/value and IC rows must outrank contract boilerplate. |
| `pays` | correct | incorrectly missing | compact cover | cover and invitation labels | populated cover missed | Structural label/value detection is too narrow. |
| `zone_execution` | correct | partial | site headings | two split site/personnel tables | multi-structure partial | Aggregate bounded same-family continuations. |
| `projet_rattachement` | correct | incorrect | financing invitation | current financing paragraph plus historical project context | historical confusion | Current financing/mission clause must outrank prior-project narrative. |
| `source_financement` | correct | correct | financing invitation | financing invitation | none | Existing financing-source behavior transfers. |
| `credit_financement` | correct | incorrect/rejected | compact populated credit label | populated Credit No versus generic agreement prose | populated identifier missed | Numbered label/value must outrank generic financing concepts. |
| `secteur` | correct | correct | scope narrative | technical/personnel scope | none | Grounded synthesis transfers, though evidence quality can improve. |
| `nature_prestation` | correct | incorrectly missing | cover/scope designation | mission title and operative scope | template displacement | Current mission designation must outrank generic forms. |
| `type_procedure` | correct | correct | official dossier heading | official dossier heading | none | Existing official-heading rule transfers. |
| `methode_selection` | correct | correct | populated IC | populated IC | none | Existing populated method signal transfers. |
| `type_proposition` | correct | incorrect | populated IC 15.2 | populated PTS versus PTC/PTS templates | enumerated template conflict | A single populated choice must outrank alternative descriptions. |
| `type_contrat` | correct | incorrect | populated procurement clause | explicit Section 8 versus generic contract discussion | current clause displaced | Operative/populated contract heading must outrank explanatory boilerplate. |
| `date_emission` | correct | incorrectly missing | compact cover date | populated cover and invitation date | populated cover missed | General label/value date detection is needed. |
| `date_limite_depot` | correctly missing | incorrectly missing | blank/template only | populated IC 17.7/17.9 | populated IC missed | Project-specific IC row must outrank generic deadline templates. |
| `langue_offre` | correct | correct | populated IC | populated IC | none | Existing behavior transfers. |
| `ponderation_technique_financiere` | correct | partial | populated T/F row | populated T/F row split in broad table | evidence compaction partial | Preserve complete structural row, not a single numeric fragment. |
| `note_technique_minimale` | correct | correct | explicit minimum row | explicit minimum row | none | Existing exact-statement rule transfers. |
| `duree_totale` | correct | partial | duration heading | populated IC with two site groups | generation partial | Preserve the full populated row and its continuation. |
| `volume_hommes_mois` | correct | incorrectly missing | total personnel row | IC minimum plus split personnel totals | multi-table missing | Aggregate populated totals across personnel continuations. |
| `nombre_profils_experts` | correct | incorrectly missing | explicit total row | fourteen numbered rows across tables | multi-table missing | Aggregate distinct numbered profiles without template rows. |
| `phases_mission` | correct | incorrectly missing | explicit APD/DAO stages | duration clause plus operative TDR phase headings | distributed evidence missing | Aggregate bounded schedule/deliverable phase structures. |
| `livrables_principaux` | correct | partial | compact deliverable table | long reporting section across chunks | multi-section partial | Select distinct operative report rows across continuations. |
| `nombre_livrables_structurants` | correct | incorrectly missing | three-row deliverable table | enumerated report types across chunks | multi-section count missing | Deduplicate and retain structured report labels. |
| `profils_cles` | correct | partial | two table parts | two site tables/multiple pages | multi-table partial | Gather all relevant personnel rows, not only the first table. |
| `disciplines_techniques` | correct | partial | aggregated profile tables | multiple personnel tables | multi-table partial | Aggregate profiles before semantic role-prefix removal. |
| `nombre_sites` | correct | incorrect | site section with three named sites | two independent site-group headings | derived-count error | Prefer explicit site-group structure over counting names in fragments. |
| `contraintes_site` | correct | incorrectly missing | adverse site narrative | operative/current constraints distributed in scope | routing miss | Current constraints need operative/current signals; templates must lose. |
| `outils_methodes` | correct | incorrectly missing | technical method section | operative tool obligations distributed in TDR | routing miss | Operative tool clauses must outrank TECH form instructions. |
| `moyens_materiels` | correct | partial | logistics section | logistics plus specialized resources in other sections | multi-section partial | Bounded equipment-family aggregation is needed. |
| `exigences_es` | correct | incorrectly missing/rejected | exact operative contract sentence | definitions outrank numerous operative TDR duties | definition conflict | Operative clauses must outrank definitions and qualifications. |
| `normes_referentiels` | correct | partial | technical fascicules | procurement rules plus mission NES/CCTP | multi-section partial | Aggregate applicable technical and project standards, not only boilerplate. |
| `points_techniques_structurants` | correct | partial | technical scope synthesis | works scope split across sections | multi-section partial | Bounded scope aggregation must cover distinct major works. |

Pre-edit reusable failure groups:

1. populated structural values lose to templates or generic prose;
2. historical/background facts displace current-procurement facts;
3. split personnel/deliverable/scope tables are not aggregated;
4. definitions and qualifications displace operative obligations;
5. evidence compaction truncates complete populated rows or distributed lists.

## E. Dossier-agnostic patterns identified

1. Populated label/value pairs and populated IC rows need structural priority over document templates.
2. Current invitation/DP/TDR clauses need field-aware priority over historical-project narrative.
3. Personnel and report structures need bounded continuation aggregation with original citations.
4. Operative clauses (`doit`, `devra`, `veiller`, `mettre en œuvre`) need priority over definitions and qualifications for obligation fields.
5. A single enumerated choice must beat a chunk containing both allowed alternatives.

## F. Changes implemented

- Extended compact cover/invitation parsing to split label/value layouts, `Crédit No`, `Client`, dates and dossier headings.
- Added generic populated-value scoring for cover facts, IC clauses, identifiers, proposal/contract choices, selection method, dates, weights, duration, effort and phases.
- Increased penalties for placeholders, instructions and enumerated alternatives while retaining populated values in the same node.
- Added field-aware historical-context penalties for current-procurement facts.
- Added operative-clause boosts and definition/qualification penalties for obligation fields.
- Added bounded evidence selection: at most five personnel continuations, four deliverable/phase/site continuations and three other multi-section continuations. Original chunk IDs remain citations.
- Added a single strongest populated-clause rule for scalar fields; generic `PTC`+`PTS` chunks cannot qualify as a populated choice.
- Added exact, grounded constraint fallback after the existing initial generation plus one correction, mirroring the bounded E&S safety pattern.
- Preserved global dense/BM25 pools, RRF, final Top-K, canonical validation and tender filters.

## G. Change-by-change regression results

| Retained pattern | Tender A effect | Tender B effect | Regression decision |
|---|---|---|---|
| Populated structural priority | Core identity/procedure stayed grounded | Recovered title, client, country, current project, credit ID, nature, contract type, issue/deadline, weighting and effort | kept |
| Current/operative semantics | No unsupported values; correct E&S clause retained | Definitions no longer outrank operative E&S; valid XML emitted | kept |
| Bounded personnel/deliverable aggregation | Existing complete personnel/deliverable results retained | Profiles expanded from one row to all ten distinct role types; seven discipline families recovered; report coverage improved | kept |
| Scalar narrowing | PTC remained correct | Populated PTS replaced generic PTC/PTS alternatives | kept |
| Structured site continuations | Restored all three A sites after a partial intermediate result | No personnel-table contamination; B retained its ranked location evidence | kept |

Intermediate runs that made Tender A's zone or duration missing were not accepted as final; the selector was narrowed before final validation.

## H. Final Tender A result

Final confirmed output: 33 populated, one correctly missing (`date_limite_depot`), zero unsupported claims, valid XML and three valid evaluations. Source-based classification remains 33 correct and one correctly missing. The post-change zone is complete: Talweg d'Abobo 4 Étages, second Bocabo basin and Rosiers basin. No previously correct A field became incorrect or unsupported.

## I. Final Tender B result

Representative final confirmation:

| Metric | Blind baseline | Final |
|---|---:|---:|
| Populated | 22 attempts | 32 |
| Correct | 7 | 24 |
| Partial | 9 | 7 |
| Incorrect | 6 | 1 |
| Correctly missing | 0 | 0 |
| Incorrectly missing | 12 | 2 |
| Unsupported | 0 | 0 |
| Canonical XML/evaluations | no, 422 | valid |

Strict remaining partials are client (cover gives ONEP but omits the represented Ministry), execution zone (Kanawolo omitted in generation), distinct-profile count, principal deliverable coverage, profile coverage/count semantics, material resources and technical-scope coverage. `nombre_sites=3` is classified incorrect against the two explicit independent site groups. `nombre_livrables_structurants` and `normes_referentiels` remain incorrectly missing.

## J. Stability

- Tender A: three complete pre-final-site-refinement runs were 33/34 and value-identical; the site-only continuation refinement then received a successful full confirmation and restored the complete zone.
- Tender B: three complete runs all emitted valid XML. 31 fields were stable 3/3. `nombre_sites` varied (`3, 3, 2`) and `outils_methodes` varied (`null, null, populated`). The post-site full confirmation emitted 32/34.
- Stability is therefore strong for A and mostly stable, not fully stable, for B.

## K. Grounding / unsupported claims

Zero unsupported claims on both tenders. Every populated value cites supplied tender-scoped evidence, and invalid field output still rejects the entire candidate. No validator was weakened.

## L. Tender isolation

Passed. Tender identity continues to bind `appel_offre_id`, `code_interne`, `document_id`, persisted Markdown path and SHA-256. Collections remain tender/hash scoped, Qdrant dense retrieval uses exact tender/code filters, BM25 is built from one tender, and no unfiltered fallback exists. Negative mismatch/hash tests pass.

## M. Runtime

| Tender | Baseline | Final runs |
|---|---:|---:|
| A | 45.86 s mean | 53.14 s, 55.38 s, 63.71 s; post-site confirmation 55.37 s |
| B | 43.34 s to 422 failure | 55.38 s, 55.92 s, 75.85 s; post-site confirmation 56.37 s |

Final node counts are 454 for A and 507 for B. Typical embedding times were about 12–14 s, retrieval 8.7–10.1 s, routing 0.35–0.43 s, and generation about 29–31 s. The third runs had generation outliers. Evidence growth is bounded; correctness was prioritized over runtime.

## N. Remaining failures

- A: only the source-absent deadline remains missing. No incorrect/unsupported field remains under the validated A ground truth.
- B partial: client, zone, distinct-profile count semantics, deliverables, profile coverage, material resources, technical-scope coverage.
- B incorrect: `nombre_sites` is unstable and the representative confirmation returned 3 rather than two independent site groups.
- B incorrectly missing: structured deliverable count and applicable standards/references.
- B unstable: `nombre_sites`, `outils_methodes`.

## O. Generalization assessment

**ACCEPTABLE.** The same architecture now emits grounded, valid canonical XML for two genuinely different dossiers, restores Tender A, and improves Tender B from a 422/7-correct blind baseline to 24 correct with no unsupported claims. It is not strong generalization because B still has partial coverage and two unstable fields.

## P. W2 readiness classification

**B — ready for additional shadow validation.** Not A: two tenders do not establish broad generalization, and Tender B retains one incorrect derived count, two incorrectly missing fields and two unstable fields. A third genuinely different tender is required before controlled local-only W2 consideration.

Recommended next experiment: a third blind dossier with a different procurement template and a source-based ground truth established only after the untouched first run.
