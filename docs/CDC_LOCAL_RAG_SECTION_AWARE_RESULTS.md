# Section-aware local RAG results

Date: 2026-08-11. Experimental only. Gemini remains authoritative/default; no n8n or production behavior was modified.

## Field-to-section map

All mappings are explicit in `services/local-rag/canonical.py`. Primary families are boosted; fallback and global dense/BM25 candidates remain eligible.

| Canonical tag | Primary family | Fallback | Shape |
|---|---|---|---|
| `reference_officielle` | front matter, procurement | financing | scalar |
| `intitule_mission` | front matter, scope | procurement | scalar |
| `client_maitre_ouvrage` | front matter, client authority | procurement | scalar |
| `pays` | front matter, procurement | client authority | scalar |
| `zone_execution` | sites, scope | schedule | list |
| `projet_rattachement` | financing, front matter | scope | scalar |
| `source_financement` | financing | front matter, procurement | scalar |
| `credit_financement` | financing, front matter | procurement | scalar |
| `secteur` | scope, technical | front matter | synthesis |
| `nature_prestation` | front matter, scope | procurement | synthesis |
| `type_procedure` | procurement, front matter | global | scalar |
| `methode_selection` | procurement | scope | scalar |
| `type_proposition` | procurement | global | scalar |
| `type_contrat` | procurement | global | scalar |
| `date_emission` | front matter, procurement | global | scalar |
| `date_limite_depot` | procurement | front matter | scalar |
| `langue_offre` | procurement, deliverables | global | scalar |
| `ponderation_technique_financiere` | procurement | global | scalar |
| `note_technique_minimale` | procurement | global | scalar |
| `duree_totale` | schedule | scope | scalar |
| `volume_hommes_mois` | personnel, schedule | global | table-derived |
| `nombre_profils_experts` | personnel | global | table-derived count |
| `phases_mission` | scope, schedule | deliverables | list |
| `livrables_principaux` | deliverables | schedule | table-derived list |
| `nombre_livrables_structurants` | deliverables | schedule | table-derived count |
| `profils_cles` | personnel | global | table-derived list |
| `disciplines_techniques` | personnel, technical | scope | synthesis |
| `nombre_sites` | sites | scope | derived count |
| `contraintes_site` | sites | technical, scope | list |
| `outils_methodes` | technical | scope, equipment | list |
| `moyens_materiels` | equipment | technical | list |
| `exigences_es` | environmental/social | technical, scope | list |
| `normes_referentiels` | standards, technical | procurement | list |
| `points_techniques_structurants` | technical, scope | sites | synthesis |

Each route also defines French/English lexical aliases and exclusion signals. Examples include excluding TOCs and placeholders for cover values, `crédit-temps` for financing identifiers, contract `ATTENDU QUE` boilerplate for the project financer, CV templates for profiles, and TECH methodology scoring tables for the actual required-profile list.

## Docling structure findings

- The Markdown has 3,648 lines, 58,173 words and many headings, but almost every heading is level 2. Markdown depth therefore does not express the true document hierarchy reliably.
- Page headers such as `Section 7. Termes de référence` and isolated page numbers are repeated as headings and must be ignored when finding semantic ancestry.
- Base semantic chunks can cross real boundaries: one observed chunk contained personnel, logistics, duration and the start of deliverables. Nearest-heading metadata alone was insufficient.
- The document contains a populated cover block before a large table of contents, followed by a second invitation/financing block. Keeping these as separate compact representations prevents TOC and contract-template dilution.
- Docling tables preserve pipes and cells but include large padding. Stripping cell padding while retaining the header and rows reduced context without destroying row/column relationships.
- The personnel table is split across a page boundary. Two compact table snippets are needed to recover all nine profiles.
- The deliverable schedule is a well-formed table with three structurally controlling report milestones.

## Metadata and retrieval

New metadata includes `section_heading`, `parent_heading`, `section_family`, `chunk_profile`, `chunk_index`, `document_id`, `appel_offre_id`, `code_interne`, and `source_filename`.

The primary test produced 464 experimental nodes: semantic chunks, heading-bounded structured sections, 49 compact tables, compact front matter, and compact invitation financing facts. Retrieval records dense, lexical, routed, fused and final ranks plus section/anchor boosts. Routing adds candidates but never removes global candidates; Qdrant filters remain tender-specific.

## Evidence audit for recovered fields

| Field | Section/snippets | Relevant evidence | Final local value | Direct support |
|---|---|---|---|---|
| `reference_officielle` | front matter / `chunk_front_matter_0` | `DP No : CI-PARU-365151-CS-QCBS/003/2024` | same identifier | yes |
| `intitule_mission` | invitation / `chunk_7` | `Désignation de la Mission : Etudes techniques détaillées...` | mission wording | yes, slightly shorter than Gemini |
| `client_maitre_ouvrage` | front matter | `Client : Unité de Coordination...` | UC-PARU wording | yes, partial |
| `zone_execution` | sites / `chunk_109` | location headings for Abobo and Rosiers | two named areas | yes, partial |
| `projet_rattachement` | financing matter | `coût du Projet d'Assainissement et de Résilience Urbaine (PARU)` | PARU | yes |
| `source_financement` | financing matter | `financement de l'Association Internationale de Développement (IDA)` | IDA | yes |
| `credit_financement` | financing matter | `Prêt/Crédit/Don No : Crédit IDA N°66860` | same credit | yes |
| `secteur` | scope | assainissement and urban drainage passages | assainissement/drainage | yes, partial |
| `nature_prestation` | front matter/scope | detailed studies and DAO specifications | same scope | yes |
| `type_contrat` | procurement table | `Rémunération forfaitaire` | same | yes |
| `duree_totale` | schedule / `chunk_section_171_0` | `90 jours calendaire, soit 03 mois` | 90 days | yes, unit equivalence incomplete |
| `nombre_profils_experts` | personnel continuation table | `Total Personnel clé | 09` | 09 | yes |
| `phases_mission` | scope / `chunk_section_143_0` | APD stage and DAO specifications stage | two phases | yes |
| `livrables_principaux` | deliverable table | three report rows | three controlling reports | yes, ancillary outputs omitted |
| `nombre_livrables_structurants` | deliverable table | three rows | 3 | yes |
| `profils_cles` | two personnel table parts | nine named expert rows | all nine profiles | yes |
| `nombre_sites` | sites section | Abobo 4 Étages, Bocabo, Rosiers | 3 | yes |
| `moyens_materiels` | logistics section | secretariat, transport, IT and laboratories | same resources | yes, partial |
| `normes_referentiels` | technical section | Fascicules 2, 7 and 62 | same fascicules | yes, partial |
| `points_techniques_structurants` | technical scope | SBN, complementary surveys and dimensioning | evidence-backed synthesis | yes, partial |

`contraintes_site` and `exigences_es` are cited but semantically mis-targeted: the former returns locations instead of constraints, and the latter returns expert experience requirements rather than the actual project E&S obligations. Grounding validation correctly proves textual support but cannot alone prove field semantics.

## Benchmark comparison

| Metric | Previous | Section-aware final |
|---|---:|---:|
| Canonical elements | 34 | 34 |
| Populated | 12 | 29 |
| `Non trouvé` | 22 | 5 |
| Correctly `Non trouvé` | 1 | 1 |
| Incorrectly missing | 21 | 4 |
| Known semantic conflicts | 3 | 0 remaining in their prior form |
| Other semantic conflicts found by expanded audit | not measured | 2 |
| Unsupported claims | 0 | 0 |
| Canonical XML valid | yes | yes |
| Total runtime | 30–35 s | 49.27 s |

Manual source-based classification for AO-20260810-0958: 17 correctly/semantically populated, 10 supported but partial, 1 correctly missing, 4 incorrectly missing, 2 semantic conflicts, 0 unsupported.

The three specifically requested conflicts changed as follows:

- `source_financement`: fixed; contract BIRD boilerplate is excluded and the invitation financing facts yield IDA.
- `phases_mission`: fixed; the scope section yields the two APD/DAO stages.
- `disciplines_techniques`: the previous conflicting synthesis is now rejected to `Non trouvé`; this is safer but remains an incorrect missing field and therefore a blocker.

## Multi-document and readiness

AO-20260810-0828 produced 25/34 populated fields, zero unsupported claims and valid canonical XML in 54.27 seconds. It is another conversion of the same procurement dossier, not a genuinely different tender. No generalization claim is made.

Classification: **B — READY FOR MORE SHADOW TESTING**, not local-only testing. Remaining blockers are the four incorrectly missing fields (`type_procedure`, `type_proposition`, `note_technique_minimale`, `disciplines_techniques`), two semantic targeting failures (`contraintes_site`, `exigences_es`), incomplete list/synthesis coverage, run-to-run variability, and absence of a second genuinely different persisted tender.
