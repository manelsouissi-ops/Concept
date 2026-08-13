# CDC local RAG — first blind second-tender result

Date: 2026-08-12  
Branch: `feat/rbac`  
Implementation: current 34-field section-aware local RAG, run without tuning

## A. New tender identity

| Item | Value |
|---|---|
| `appel_offre_id` | `2138` |
| `code_interne` | `AO-20260812-0840` |
| `document_id` | `1980` |
| Source filename | `cdc.md` |
| Persisted Markdown | `/home/concept/Concept/data/AO-20260812-0840/cdc.md` |
| Markdown bytes | `662441` |
| SHA-256 | `4b69d9ff5c06038062f16b2d5b7bfe7b8c96744dfdd0cd6cb8bc24db55801345` |
| Fiche status | `draft` in `status.json`; no `cdc_fiches.fiches_projet` row |
| Business status | `analyse_en_cours` |

The database job `94` (`pj_ca99b673fdcb405bb9883c666d022df7`) completed successfully. Document processing execution `307` and CDC extraction execution `308` both report `COMPLETED`. The persisted Markdown hash in job metadata equals the hash above. The benchmark did not use the old tender.

## B. Confirmation that this is a different dossier

This dossier concerns PASEA water-supply works in Niakara/Kanawolo and Korhogo/Napié. It has a different tender ID, document ID, content hash, project, client, geography, procurement values, technical scope and personnel structure from `AO-20260810-0958`.

## C. Pipeline and source verification

The normal UI/upload pipeline produced `cdc.pdf`, `cdc.md`, `fiche.xml`, and `status.json`. Ground truth below was checked against the new 3,000+ line Markdown, not copied from the previous benchmark. The production Gemini XML was consulted only as a cross-check and was not used as RAG evidence.

The untouched local run failed closed with:

```text
422 LOCAL_VALIDATION_FAILED
credit_financement: financing identifier must contain its populated number
exigences_es: direct field evidence was supplied; null requires one correction attempt
```

Observation-only instrumentation on an identical second invocation captured the 34 attempted field outputs and retrieval audit at the exception frame. It did not alter routes, prompts, validation, ranking, Top-K, generation, or persisted business state.

## D. Complete 34-field result

| Field | Generated value | Principal evidence sent (family / heading / chunk) | Classification | Source-grounded assessment |
|---|---|---|---|---|
| `reference_officielle` | CI-ONEP-480176-CS-QCBS | procurement / Demande de Propositions / `chunk_section_2_0` | CORRECT | Exact official reference at the cover. |
| `intitule_mission` | assurer l'exécution technique et la gestion fiduciaire de la Composante 2… | scope / Objet des TDR / `chunk_section_128_0` | INCORRECT | This is ONEP's project role, not the mission title. The title starts “Suivi et contrôle des travaux…”. |
| `client_maitre_ouvrage` | Non trouvé | client_authority / Signature du Contrat / `chunk_section_64_1` | INCORRECTLY_MISSING | The populated IC 2.1 names the Ministry represented by ONEP. |
| `pays` | Non trouvé | procurement / NB / `chunk_table_24_0` | INCORRECTLY_MISSING | “Pays : Côte d'Ivoire” is populated on the cover and invitation. |
| `zone_execution` | Niakara, Korhogo, Napié et localités environnantes | scope / personnel-site tables / `chunk_table_40_0`, `chunk_table_42_0` | PARTIAL | Kanawolo is omitted. |
| `projet_rattachement` | PREMU | financing / Contexte / `chunk_103` | INCORRECT | This procurement is attached to PASEA; PREMU is historical context. |
| `source_financement` | Association Internationale de Développement (IDA) | financing / Services de Consultant / `chunk_3` | CORRECT | Directly supported. |
| `credit_financement` | accord de crédit (rejected) | financing / Services de Consultant / `chunk_3` | INCORRECT | Generic wording is not the identifier `IDA-7562-CI`; canonical validation rejected it. |
| `secteur` | approvisionnement en eau potable en milieu urbain | scope / expert tables / `chunk_table_39_0` | CORRECT | Supported throughout the scope, although the selected evidence was not ideal. |
| `nature_prestation` | Non trouvé | procurement/template / `chunk_table_6_0` | INCORRECTLY_MISSING | The source repeatedly states “Suivi et contrôle des travaux”. |
| `type_procedure` | Demande de Propositions (DP) / Services de Consultants | procurement / Dossier de DP / `chunk_section_18_0` | CORRECT | Exact procedure heading. |
| `methode_selection` | SFQC | procurement / Données particulières / `chunk_table_7_0` | CORRECT | Directly supported. |
| `type_proposition` | PTC ou PTS | personnel/template / Remarques spécifiques / `chunk_27` | INCORRECT | Populated IC 15.2 requires PTS only. |
| `type_contrat` | rémunération forfaitaire | procurement / Négociations / `chunk_37` | INCORRECT | Section 8 specifies remuneration by time spent. |
| `date_emission` | Non trouvé | procurement / Données particulières / `chunk_table_11_0` | INCORRECTLY_MISSING | Cover and invitation state `01/09/2025`. |
| `date_limite_depot` | Non trouvé | procurement/template / `chunk_table_6_0` | INCORRECTLY_MISSING | IC 17.7/17.9 states `16/10/2025`, 10:00 GMT. |
| `langue_offre` | Française | procurement / Données particulières / `chunk_table_8_0` | CORRECT | Directly supported. |
| `ponderation_technique_financiere` | 30 | procurement / NB / `chunk_table_25_0` | PARTIAL | Only F was returned; the source says T=70 and F=30. |
| `note_technique_minimale` | 75 points | procurement / NB / `chunk_table_24_0` | CORRECT | Exact minimum score. |
| `duree_totale` | 31 months for Niakara/Kanawolo; 29 months for Korhogo… | procurement / IC 14.1.2 / `chunk_table_10_0` | PARTIAL | Core durations are correct, but Napié and the eight-month stagger are omitted. |
| `volume_hommes_mois` | Non trouvé | personnel/template / FIN-3 and TECH-6 | INCORRECTLY_MISSING | IC 14.1.3 and the personnel total explicitly state 184 expert-months. |
| `nombre_profils_experts` | Non trouvé | personnel/template / TECH-6 | INCORRECTLY_MISSING | Fourteen numbered principal expert profiles are present. |
| `phases_mission` | Non trouvé | scope / personnel tables | INCORRECTLY_MISSING | Mobilization, works, guarantee and closure phases are explicit in IC 14.1.2 and the TDR. |
| `livrables_principaux` | generic periodic reports, monthly reports/PVs, CAD/PDF/office formats | deliverables / Production des rapports / `chunk_section_143_0` | PARTIAL | Supported, but it misses the explicitly enumerated principal report types. |
| `nombre_livrables_structurants` | Non trouvé | deliverables/template / TECH forms | INCORRECTLY_MISSING | The production-of-reports section contains an explicit structured series of ten report types. |
| `profils_cles` | Chef de mission and expert Ingénieur Génie Civil | personnel / first site table / `chunk_table_38_0` | PARTIAL | Only one of fourteen profiles is returned. |
| `disciplines_techniques` | génie civil | personnel / first site table / `chunk_table_38_0` | PARTIAL | Hydraulics, electromechanics/electricity, water treatment, topography, HSE and social safeguards are omitted. |
| `nombre_sites` | 3 | personnel / two site tables | INCORRECT | The TDR describes two independent site groups/missions, not three. |
| `contraintes_site` | Non trouvé | technical/template TECH-4 / `chunk_73` | INCORRECTLY_MISSING | Independent distant sites, an eight-month stagger, surface-water works and continuity constraints are stated. |
| `outils_methodes` | Non trouvé | technical/template TECH-4 / `chunk_section_82_0` | INCORRECTLY_MISSING | Telemanagement/automation, mobile geolocation/cartography, GED and planning tools are stated. |
| `moyens_materiels` | vehicles, office equipment and furniture | equipment / Consultant installations / `chunk_154` | PARTIAL | Supported subset; computing/mobile, internet and testing/laboratory resources are omitted. |
| `exigences_es` | Non trouvé (rejected) | environmental_social / definitions / `chunk_section_30_0` | INCORRECTLY_MISSING | Direct duties exist in IC 10.1 and TDR sections for Code of Conduct, PGES-C, PPSPS, PPGED, PHSSE, PGMO, MGP and NES. |
| `normes_referentiels` | Anti-Corruption Directives, Sanctions Framework, Procurement Regulations | standards / Fraud and Corruption / `chunk_20` | PARTIAL | Supported procurement references, but mission-critical NES and CCTP references are omitted. |
| `points_techniques_structurants` | 530 m³/h intake and 500 m³/h treatment unit | scope / Korhogo/Napié / `chunk_106` | PARTIAL | Supported subset of a much larger network, storage, pumping, power and automation scope. |

## E–J. Classification summary

| Metric | Count |
|---|---:|
| Total fields | 34 |
| Populated attempts | 22 |
| Canonically accepted populated fields | 21 |
| Correct | 7 |
| Partial | 9 |
| Incorrect | 6 |
| Correctly missing | 0 |
| Incorrectly missing | 12 |
| Unsupported claims | 0 |
| Semantic conflicts | 6 incorrect values plus 9 partial values |

“Unsupported” is reserved for a claim absent from the source. The incorrect populated values above are traceable to real passages, but those passages have the wrong field semantics (historical context, generic wording, or templates).

## K. Retrieval diagnostics for failures

The service audit records the final evidence sent to Qwen. The observation-only top-eight audit below reports the best located correct-evidence candidate where it was visible. `> top 8` means it did not appear in the top eight of dense, BM25, RRF, or final reranking; the unchanged service only sent final Top-2 (Top-1 for constraints/E&S), so no artificial full-corpus rank was invented.

| Field(s) | Correct evidence rank diagnostic | Evidence actually sent | Canonical result | Primary failure layer |
|---|---|---|---|---|
| title | correct cover `chunk_0`: dense 4, final outside top 8 | TDR objective at final 1 | accepted wrong value | section routing/reranking, generation |
| client | correct IC 2.1: > top 8 | contract-signature boilerplate | accepted null | candidate generation/routing |
| country | correct dossier candidate: RRF 45, final 8 | unrelated NB/pricing tables | accepted null | routing/reranking |
| zone | complete candidate `chunk_table_44_0`: RRF 60, final 6 | fragmented site tables final 1–2 | accepted partial list | evidence compaction/generation |
| project | PASEA `chunk_3`: dense 22, BM25 24, RRF 1, final 8 | historical PREMU at final 2 | accepted wrong value | section reranking/generation |
| credit | populated invitation candidate: BM25 7, RRF 10, final 8; exact ID was not in Top-2 | generic “accord de crédit” | rejected | reranking, canonical validation |
| nature | correct cover `chunk_section_2_0`: dense 9, RRF 18, final 7 | template/table fragments | accepted null | routing/reranking |
| proposal type | PTS candidate `chunk_1`: dense 5, BM25 8, RRF 2, final 7 | PTC/PTS alternative at final 1 | accepted semantic conflict | exclusion/reranking, generation |
| contract type | correct populated value: > top 8 | negotiation boilerplate | accepted wrong value | candidate generation/routing |
| issue date | correct cover candidate: RRF 52, final 5 | unrelated IC table | accepted null | routing/reranking |
| deadline | correct IC 17.7/17.9: > top 8 | generic/template date material | accepted null | candidate generation/routing |
| weighting | correct T=70/F=30: > top 8 | financial-weight fragment | accepted partial | evidence compaction/generation |
| duration | correct IC 14.1.2 was final 1 | same correct passage | accepted partial | generation |
| expert-months, profile count, phases | correct populated tables/IC: > top 8 | blank proposal templates or unrelated expert fragments | accepted null | candidate generation/routing |
| deliverables | enumerated report section mostly outside final Top-2; one candidate RRF 34/final 7 | introductory report-format passage | partial/null | routing and evidence compaction |
| profiles, disciplines | complete two-table evidence: > top 8 as a whole | first table fragment and section intro | accepted partial | chunk/table fragmentation and compaction |
| site count/constraints | explicit two-mission/stagger evidence: > top 8 | two personnel tables or TECH-4 template | wrong/null | section-family classification/routing |
| tools | operative TDR evidence: > top 8 | TECH-4 template and contract equipment clause | accepted null | candidate generation/routing |
| materials | correct subset at dense 6, BM25 5, RRF 2, final 2 | same subset | accepted partial | evidence coverage/generation |
| E&S | operative TDR `chunk_131`: dense 7, BM25 3, RRF 1, but outside final Top-8 | definition-only chunk at final 1 | rejected null | section reranking, canonical validation |
| standards | NES candidate present lexically but not sent; procurement references sent | anti-corruption/procurement passages | accepted partial | routing/evidence compaction |
| technical points | complete works evidence: > top 8 as a whole | one scope fragment | accepted partial | chunk coverage/evidence compaction |

Dense and BM25 candidate generation frequently found useful passages, but section routing and field-specific reranking did not generalize to this document's layout. Several fields also need evidence spanning multiple tables/chunks, while the current compaction supplies only two snippets.

## L. Previously difficult six fields

| Field | Result |
|---|---|
| `type_procedure` | CORRECT |
| `type_proposition` | INCORRECT — returned template alternatives instead of populated PTS |
| `note_technique_minimale` | CORRECT |
| `disciplines_techniques` | PARTIAL — only génie civil |
| `contraintes_site` | INCORRECTLY_MISSING |
| `exigences_es` | INCORRECTLY_MISSING and caused fail-closed validation |

Only two of the six previous fixes generalized fully.

## M. Tender isolation

- Collection: `concept_local_rag_shadow_2138_4b69d9ff5c06`
- Every node carries `appel_offre_id=2138`, `code_interne=AO-20260812-0840`, and `document_id=1980`.
- The collection name is keyed by the new tender ID and new document hash.
- Request validation checked the database identity, persisted path and exact SHA-256.
- Retrieval retains the exact tender/code filters and has no unfiltered fallback.
- Existing mismatch/hash/isolation tests pass.

No chunk from `AO-20260810-0958` was reused.

## N. Runtime

The observation run reached the field-validation boundary with:

| Metric | Result |
|---|---:|
| Document/node count | 514 |
| Embedding/index preparation | 14.112 s embedding; Qdrant upsert is included in total but not separately exposed by the service |
| Retrieval | 8.130 s |
| Section routing | 0.004 s |
| Field generation | 19.676 s |
| Total to failure | 43.342 s |

Evaluation generation did not run, so this is not a successful end-to-end runtime. It is nevertheless close to the previous tender's 45.86 s successful mean, despite 514 versus approximately 464 nodes.

## O. Comparison with AO-20260810-0958

| Metric | Previous validated tender | Blind second tender |
|---|---:|---:|
| Populated/canonical | 33/34 | no canonical result; 22 attempts, 21 populated fields passed validation |
| Correct | 33 | 7 |
| Partial | 0 target conflicts | 9 |
| Incorrect | 0 target conflicts | 6 |
| Correctly missing | 1 | 0 |
| Incorrectly missing | 0 target fields | 12 |
| Unsupported | 0 | 0 |
| End-to-end completion | yes | no, 422 |

## P. Generalization assessment

**FAILED GENERALIZATION.**

Tender isolation and factual grounding remained safe, and seven fields transferred cleanly. However, the pipeline did not produce canonical XML, only two of the six previously difficult fields fully generalized, and 27 of 34 fields were partial, incorrect, or incorrectly missing. The dominant issue is layout/section generalization: correct evidence often exists but is outranked by templates, historical context, definitions, or fragmented personnel tables.

## Q. Recommended next step

Stop here for review, as required. Preserve this baseline before any tuning. If a follow-up is authorized, start with dossier-agnostic diagnostics for populated cover/IC tables, historical-context exclusion, multi-table personnel aggregation, deliverable-table coverage, and operative E&S clauses. Re-run both tenders after each narrowly justified change. This test alone does not support controlled W2 readiness.

## Validation note

The existing local RAG, canonical, section-routing and tender-isolation tests were run unchanged. TypeScript typechecking and whitespace validation were also run. Canonical parser validation of this blind extraction is **not applicable/passed=false** because the service stopped before building XML; the three evaluation entries were likewise not generated.
