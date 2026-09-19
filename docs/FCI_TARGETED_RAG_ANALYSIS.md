# FCI targeted RAG analysis

Date: 2026-08-26  
Scope: architecture and planning only; no runtime, database, workflow, prompt, schema, or FCI-state change.

## 1. Executive summary

Targeted RAG can materially improve FCI quality, but not by maximizing automatic completion. Its strongest value is retrieving documented CONCEPT experience that the current validated Fiche cannot contain: comparable projects, cost and delivery lessons, client practices, methodologies, technical references, and documented commercial history. It is weakest—and often unsafe—for current availability, current pricing/margin parameters, assignment of responsibility, management priorities, and any final decision.

The application exposes 95 human-visible departmental field definitions: A 18, B 15, C 45, and D 17. This audit classifies them as 20 `RAG_FILL_CANDIDATE`, 21 `RAG_CONTEXT_ONLY`, 26 `HUMAN_ONLY`, 19 `NOT_RELEVANT_FOR_RAG`, and 9 `PROHIBITED_AUTOFILL`.

The best first pilot is FCI C return-of-experience retrieval for `rex_projet_reference`, using only approved historical project/offer records with strong provenance. It offers high value, has bounded evidence, and does not assert current resource availability. A second pilot should cover documented commercial history for FCI A. CV retrieval should wait for document-level and field-level authorization, purpose limitation, and PII-safe logging.

The repository already has useful local building blocks, but not a production-ready FCI knowledge layer. Historical CDC ingestion is isolated and local (Docling, Ollama, `qwen3-embedding:0.6b`, Qdrant, PostgreSQL), while its query helper is diagnostic only. The catalog currently models historical CDCs, not project/offer records, CVs, commercial memory, or finance history, and it does not yet carry the access-control metadata required for those domains.

The governing rule remains unchanged:

> AI proposes → the responsible department reviews and validates → DG makes the separate final Go/No-Go decision.

FCI D remains a strategic contribution. It is generated only from a validated Fiche plus human-validated A/B/C; `needs_review` never satisfies that gate.

## 2. Current FCI architecture discovered

### 2.1 Generation and lifecycle

1. A validated Fiche is read through `readSourceFicheSnapshot`; draft use is rejected for normal generation.
2. `/api/appels-offres/[code]/fci/[module]/generate` calls `prepareFciGeneration`.
3. Service authorization enforces area access, assignment/ownership, module role, and the A+B+C validation prerequisite for D.
4. `getFciAiRuntimeContract` loads the module prompt and dereferenced JSON Schema.
5. The service creates an official generation job and audit event, then sends the validated Fiche snapshot to the dedicated n8n workflow.
6. The current workflow is Gemini-specific. `FCI_GENERATION_PROVIDER` is recorded as metadata, but there is no real FCI provider abstraction or production local-RAG route.
7. A signed callback is contract-validated. A has deterministic shortlist/differentiator/transit guardrails; D has final-decision-language guardrails. B and C rely primarily on schema/prompt rules and human review.
8. The callback creates a version, changes the module to `needs_review`, and emits lifecycle notifications. A human edit/review and module-owner validation are distinct operations.
9. Only validated module data contributes downstream. D receives validated A/B/C context, never drafts.
10. The Go/No-Go report and final decision are separate. Final decision permission belongs to DG and accepts only `go` or `no_go` through the dedicated service.

### 2.2 Contracts and real field surface

There are two related representations:

- AI contract v1 (`ai/schemas/fci-*.schema.json`): model-facing structured data with `source_type`, confidence, `requires_human_input`, justification, and source references.
- Departmental form v2 (`rendering.ts`): normalized human-visible/editable fields used by the UI, validation, history, and exports.

This report maps the v2 human-visible field surface because it is the business form users actually complete. It also traces its v1 origin. The counts are field definitions, not multiplied by repeatable row count.

| Module | Human-visible fields | Repeatable sections |
| --- | ---: | --- |
| A | 18 | competitors |
| B | 15 | cash-flow milestones |
| C | 45 | key experts, non-key experts, means/capacity, role split |
| D | 17 | none |
| **Total** | **95** | |

Some v1 model fields are retained as `unmapped` during v2 normalization rather than displayed as active form fields: B calculations, preliminary cash-pressure, guarantee exposure and finance-review points; C operations synthesis; D direction synthesis. They should not be treated as active autofill targets until the product contract explicitly decides whether and where to display them.

### 2.3 Source and absence behavior

The AI contract supports `fiche_cdc`, `ai_inference`, `internal_required`, `unavailable`, and `not_applicable`. `internal_required` requires `value=null`, `confidence=none`, and `requires_human_input=true`. The normalized form preserves source, review status, confidence, justification, original AI value, and source references. Empty internal fields are presented as `human_required`.

Current source abbreviations used below:

- `AO/FICHE`: current AO database identity plus validated Fiche/current CDC.
- `CDC`: explicit current CDC facts, sometimes deterministically extracted.
- `AI(CDC)`: cautious inference from the current validated Fiche.
- `HUMAN`: current internal departmental input.
- `ABC-VALID`: human-validated FCI A/B/C context available only to D.
- `SYSTEM`: deterministic application logic.

### 2.4 Knowledge/RAG capability today

Implemented:

- isolated historical-CDC ingestion on loopback port 8092;
- Docling conversion, local `qwen3:14b` metadata extraction, local `qwen3-embedding:0.6b` embeddings;
- section-aware chunks and Qdrant collection `concept_historical_cdc`;
- immutable document versions, SHA-256, status, metadata, and ingestion-run catalog in PostgreSQL;
- payload identity, filename, source path, document/version IDs, section/subsection, chunk index/text, and optional page;
- duplicate detection and fail-closed ingestion stages;
- a diagnostic dense-query helper.

Not implemented or not production-ready:

- FCI-targeted retrieval or a shared FCI evidence contract;
- project/offer, methodology, CV/expert, commercial-memory, or finance-history collections;
- hybrid historical-KB query integration (the documentation says it is future work);
- authorization scope, confidentiality class, PII class, retention/purpose, source owner, validation status, or permitted consuming roles in the current KB catalog/vector payload;
- conflict sets and source-precedence evaluation;
- a production FCI local-provider abstraction.

The local CDC RAG service on port 8091 is a separate shadow extraction boundary. It is not a historical-knowledge service and is not authoritative for FCI.

## 3. Classification rules

- `RAG_FILL_CANDIDATE`: authoritative internal evidence can support a proposed value; provenance and human validation remain mandatory.
- `RAG_CONTEXT_ONLY`: evidence can inform analysis/review but must not directly populate the field.
- `HUMAN_ONLY`: the field is current, assigned, approved, or judged by a person.
- `NOT_RELEVANT_FOR_RAG`: current CDC/Fiche/AO or deterministic logic is already the correct source.
- `PROHIBITED_AUTOFILL`: historical evidence may be visible as background, but automatic population creates unacceptable decision/current-state risk.

All proposed values remain `to_review`; none becomes validated through retrieval.

## 4. FCI A — field-by-field RAG mapping

| Field | Business meaning | Current source | Current limitation | RAG category | Best RAG source | Evidence to retrieve | AI propose? | Human validation? | Risk | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `A.identification_commune.reference_interne_code_dossier` | Internal AO code | AO/FICHE | None | NOT_RELEVANT_FOR_RAG | — | — | Deterministic only | No | Low | NO |
| `A.identification_commune.intitule_offre` | Tender title | AO/FICHE | None | NOT_RELEVANT_FOR_RAG | — | — | Deterministic only | No | Low | NO |
| `A.identification_commune.date_depot` | Submission deadline | CDC/FICHE | Current source ambiguity is handled upstream | NOT_RELEVANT_FOR_RAG | — | — | No historical value | No | High if stale | NO |
| `A.identification_commune.prepared_by_name` | Form preparer | HUMAN | Current accountability | HUMAN_ONLY | — | Authenticated actor | No | Yes | Accountability | NO |
| `A.identification_commune.validated_by_name` | Department validator | HUMAN | Known only at validation | HUMAN_ONLY | — | Authenticated validator | No | Yes | Approval | NO |
| `A.a1_concurrents[].nom` | Competitor/group name | CDC shortlist | Empty when current CDC has no shortlist | RAG_FILL_CANDIDATE | Commercial memory | Explicit prior participation/shortlist record | Yes, labelled historical | Yes | Identity/staleness | P1 |
| `A.a1_concurrents[].pays` | Competitor country | CDC shortlist | May be absent | RAG_FILL_CANDIDATE | Commercial records | Explicit organization/country record | Yes | Yes | Entity resolution | P2 |
| `A.a1_concurrents[].points_forts_connus` | Documented strengths | HUMAN/null | Current guardrail correctly avoids invention | RAG_FILL_CANDIDATE | Validated bid reviews | Dated, attributed observation | Yes, only as documented | Yes | Bias/defamation | P1 |
| `A.a1_concurrents[].historique_client` | Competitor history with client | HUMAN/null | No current internal evidence | RAG_FILL_CANDIDATE | Commercial history | Prior tender/client participation and outcome | Yes | Yes | False association | P1 |
| `A.a1_concurrents[].avantage_principal` | Advantage in this CDC | AI/null | Requires comparison and judgment | RAG_CONTEXT_ONLY | Commercial history + current CDC | Prior documented capability and current requirement | No direct fill; analysis note | Yes | Unsupported judgment | P2 |
| `A.a1_concurrents[].risque_represente` | Competitive risk | AI/null | Requires current commercial judgment | RAG_CONTEXT_ONLY | Validated commercial reviews | Dated risk observations and comparable context | No direct fill | Yes | Bias/business judgment | P2 |
| `A.a2_positionnement.avantage_differentiel` | CONCEPT differentiator | HUMAN; A guardrail forces human-required | Current CDC requirements do not prove capability | RAG_FILL_CANDIDATE | Project references/offers | Validated reference proving matching capability | Yes, evidence-bound | Yes | Self-claim inflation | P1 |
| `A.a2_positionnement.vulnerabilite_principale` | Current vulnerability | HUMAN | Depends on current team/strategy | RAG_CONTEXT_ONLY | Lessons learned | Recurrent documented weaknesses relevant to scope | No direct fill | Yes | Stale/generalized weakness | P2 |
| `A.a2_positionnement.niveau_prix_cible` | Current target price | HUMAN | Current strategy/costing | PROHIBITED_AUTOFILL | Finance history (background only) | Historical ranges with dates, never a proposed target | No | Yes | Material pricing risk | NO |
| `A.a3_logistique_interne.delai_transit_jours` | Current internal submission transit | HUMAN | Process/location dependent now | HUMAN_ONLY | — | Current submission plan | No | Yes | Missed deadline | NO |
| `A.a3_logistique_interne.responsable_depot` | Accountable submitter | HUMAN | Assignment is current/legal | HUMAN_ONLY | — | Current assignment | No | Yes | Accountability | NO |
| `A.a3_logistique_interne.representation_locale_existante` | Current local presence | HUMAN | Must be confirmed now | HUMAN_ONLY | — | Current approved corporate record | No automatic fill | Yes | Legal/current-state | NO |
| `A.a3_logistique_interne.representation_locale_details` | Details of current presence | HUMAN | Conditional and current | HUMAN_ONLY | — | Current approved corporate record | No automatic fill | Yes | Legal/current-state | NO |

**A totals:** fill 5; context 3; human 6; not relevant 3; prohibited 1.

## 5. FCI B — field-by-field RAG mapping

| Field | Business meaning | Current source | Current limitation | RAG category | Best RAG source | Evidence to retrieve | AI propose? | Human validation? | Risk | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `B.identification_commune.reference_interne_code_dossier` | Internal AO code | AO/FICHE | None | NOT_RELEVANT_FOR_RAG | — | — | Deterministic only | No | Low | NO |
| `B.identification_commune.intitule_offre` | Tender title | AO/FICHE | None | NOT_RELEVANT_FOR_RAG | — | — | Deterministic only | No | Low | NO |
| `B.identification_commune.date_depot` | Submission deadline | CDC/FICHE | None after validation | NOT_RELEVANT_FOR_RAG | — | — | No | No | Staleness | NO |
| `B.identification_commune.prepared_by_name` | Form preparer | HUMAN | Current accountability | HUMAN_ONLY | — | Authenticated actor | No | Yes | Accountability | NO |
| `B.identification_commune.validated_by_name` | Finance validator | HUMAN | Approval-time fact | HUMAN_ONLY | — | Authenticated validator | No | Yes | Approval | NO |
| `B.b1_elements_financiers.budget_estime_marche` | Preliminary market budget | AI(CDC) | Often absent; history is not current budget | RAG_CONTEXT_ONLY | Similar contracts | Dated contract values and scope similarity | No direct fill unless current authoritative clause | Yes | False equivalence | P2 |
| `B.b1_elements_financiers.budget_estime_source` | Source of estimate | HUMAN | Provenance is manually entered | RAG_FILL_CANDIDATE | Document catalog | Exact document/version/clause behind estimate | Yes, as citation metadata | Yes | Wrong source | P1 |
| `B.b1_elements_financiers.taux_change` | Current rate and approved source | HUMAN | Time-sensitive policy/input | HUMAN_ONLY | — | Current approved finance source | No historical autofill | Yes | Material financial error | NO |
| `B.b1_elements_financiers.coefficient_charges_structure` | Current internal overhead coefficient | HUMAN | Confidential/current policy | PROHIBITED_AUTOFILL | Historical finance (background only) | Trends visible only to authorized Finance | No | Yes | Confidentiality/margin | NO |
| `B.b1_elements_financiers.marge_cible` | Current target margin | HUMAN | Management/commercial judgment | PROHIBITED_AUTOFILL | Historical finance (background only) | Prior outcomes, never proposed target | No | Yes | Pricing/decision risk | NO |
| `B.b2_jalons_cash_flow[].jalon_livrable` | Current payment milestone | CDC | Direct contractual fact | NOT_RELEVANT_FOR_RAG | — | Current clause | Current extraction only | Yes | Contract accuracy | NO |
| `B.b2_jalons_cash_flow[].pourcentage_montant` | Current milestone percentage | CDC | Direct contractual fact | NOT_RELEVANT_FOR_RAG | — | Current clause | Current extraction only | Yes | Contract accuracy | NO |
| `B.b2_jalons_cash_flow[].delai_paiement_estime` | Expected payment delay | AI(CDC) | Clause may be absent; actual history differs | RAG_FILL_CANDIDATE | Validated client payment history | Dated actual delay distributions plus contract clause | Yes, clearly historical estimate | Yes | Sensitive/stale | P1 |
| `B.b2_jalons_cash_flow[].risque_cash_flow` | Milestone cash-flow risk | AI(CDC) | Current internal exposure unavailable | RAG_CONTEXT_ONLY | Contract/payment history | Similar schedule, delays, guarantee timing | No direct verdict | Yes | Overconfidence | P1 |
| `B.b3_synthese_financiere.commentaires_generaux` | Finance synthesis | AI(CDC)+HUMAN | Needs current finance judgment | RAG_CONTEXT_ONLY | Authorized finance lessons | Evidence bundle of comparable conditions | Draft evidence notes only | Yes | Sensitive synthesis | P2 |

**B totals:** fill 2; context 3; human 3; not relevant 5; prohibited 2.

## 6. FCI C — field-by-field RAG mapping

| Field | Business meaning | Current source | Current limitation | RAG category | Best RAG source | Evidence to retrieve | AI propose? | Human validation? | Risk | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `C.identification_commune.reference_interne_code_dossier` | AO code | AO/FICHE | None | NOT_RELEVANT_FOR_RAG | — | — | Deterministic | No | Low | NO |
| `C.identification_commune.intitule_offre` | Tender title | AO/FICHE | None | NOT_RELEVANT_FOR_RAG | — | — | Deterministic | No | Low | NO |
| `C.identification_commune.date_depot` | Deadline | CDC/FICHE | None after validation | NOT_RELEVANT_FOR_RAG | — | — | No | No | Staleness | NO |
| `C.identification_commune.prepared_by_name` | Operations preparer | HUMAN | Current accountability | HUMAN_ONLY | — | Authenticated actor | No | Yes | Accountability | NO |
| `C.identification_commune.validated_by_name` | Operations validator | HUMAN | Approval-time fact | HUMAN_ONLY | — | Authenticated validator | No | Yes | Approval | NO |
| `C.c1_ressources_cles[].poste_expert` | Required key profile | CDC | Direct requirement | NOT_RELEVANT_FOR_RAG | — | Current profile clause | Current extraction only | Yes | Omission | NO |
| `C.c1_ressources_cles[].volume_demande_cdc` | CDC-requested effort | CDC | Direct requirement | NOT_RELEVANT_FOR_RAG | — | Current staffing table | Current extraction only | Yes | Numeric accuracy | NO |
| `C.c1_ressources_cles[].volume_reel_previsionnel` | CONCEPT planned effort | HUMAN | Current delivery plan | HUMAN_ONLY | — | Current staffing estimate | No | Yes | Capacity risk | NO |
| `C.c1_ressources_cles[].suppleant` | Named substitute | HUMAN | Current person/consent | HUMAN_ONLY | — | Current approved staffing | No | Yes | PII/commitment | NO |
| `C.c1_ressources_cles[].volume_previsionnel_suppleant` | Substitute effort | HUMAN | Current allocation | HUMAN_ONLY | — | Current staffing plan | No | Yes | Capacity risk | NO |
| `C.c1_ressources_cles[].probabilite_disponibilite` | Current expert availability | HUMAN | CV history cannot prove availability | PROHIBITED_AUTOFILL | CV context only | Qualifications may be shown separately | No | Yes | Staffing commitment | NO |
| `C.c1_ressources_cles[].action_requise` | Current staffing action | HUMAN | Operational assignment | HUMAN_ONLY | — | Current action owner/date | No | Yes | Accountability | NO |
| `C.c2_ressources_non_cles[].poste_expert` | Likely support profile | CDC/AI(CDC) | Often implicit | RAG_FILL_CANDIDATE | Methods/project staffing | Documented role on similar scope | Yes | Yes | Role overgeneralization | P1 |
| `C.c2_ressources_non_cles[].volume_previsionnel` | Planned support effort | HUMAN | Current plan | HUMAN_ONLY | — | Current estimate | No | Yes | Capacity risk | NO |
| `C.c2_ressources_non_cles[].probabilite_disponibilite` | Current availability | HUMAN | Historical work is not availability | PROHIBITED_AUTOFILL | CV context only | Experience, not availability | No | Yes | Staffing commitment | NO |
| `C.c2_ressources_non_cles[].action_requise` | Current staffing action | HUMAN | Current assignment | HUMAN_ONLY | — | Current action owner/date | No | Yes | Accountability | NO |
| `C.c3_moyens_capacite[].designation` | Required technical means | AI(CDC) | Requirements may be implicit | RAG_FILL_CANDIDATE | Methods/similar projects | Explicit means used for comparable task | Yes | Yes | Scope mismatch | P1 |
| `C.c3_moyens_capacite[].quantite_requise` | Quantity required | CDC/AI | Similar-project quantities are contextual | RAG_CONTEXT_ONLY | Historical execution plans | Dated quantities with scale/similarity | No direct fill | Yes | False sizing | P2 |
| `C.c3_moyens_capacite[].quantite_disponible` | Quantity available now | HUMAN | Current inventory/booking | HUMAN_ONLY | — | Current asset register | No | Yes | Capacity commitment | NO |
| `C.c3_moyens_capacite[].membre_apporteur` | Group member providing means | HUMAN | Current agreement | HUMAN_ONLY | — | Current approved group agreement | No | Yes | Legal commitment | NO |
| `C.c3_moyens_capacite[].disponible_demarrage` | Availability at start | HUMAN | Time-sensitive | PROHIBITED_AUTOFILL | Historical context only | Prior ownership does not prove availability | No | Yes | Delivery commitment | NO |
| `C.c3_moyens_capacite[].ecart` | Required minus available | SYSTEM | Deterministic once inputs exist | NOT_RELEVANT_FOR_RAG | — | — | Deterministic | No | Arithmetic | NO |
| `C.c4_repartition_roles[].composante_tache` | Current scope component | CDC | Direct scope decomposition | NOT_RELEVANT_FOR_RAG | — | Current CDC task | Current extraction only | Yes | Omission | NO |
| `C.c4_repartition_roles[].membre_responsable` | Responsible group member | HUMAN | Current negotiated allocation | HUMAN_ONLY | — | Approved current agreement | No | Yes | Legal/accountability | NO |
| `C.c4_repartition_roles[].experts_affectes` | Named assigned experts | HUMAN | Current assignment/consent | PROHIBITED_AUTOFILL | CV search context only | Candidate evidence separate from assignment | No | Yes | PII/commitment | NO |
| `C.c4_repartition_roles[].effort_client_vs_concept` | Internal effort comparison | HUMAN | Requires current estimate | HUMAN_ONLY | — | Current estimate versus CDC | No | Yes | Under-sizing | NO |
| `C.c4_repartition_roles[].commentaire_risque` | Task allocation risk | AI(CDC)+HUMAN | Lacks project lessons | RAG_CONTEXT_ONLY | Lessons/methodologies | Comparable coordination failure/mitigation | Contextual draft only | Yes | Overgeneralization | P1 |
| `C.c5_risques_coordination.partenaires_non_eprouves` | Prior collaboration status | HUMAN | History is not currently linked | RAG_FILL_CANDIDATE | Partner/project history | Explicit joint project record | Yes | Yes | Entity matching | P1 |
| `C.c5_risques_coordination.frequence_reunions_coordination` | Coordination cadence | HUMAN | Must suit current project | RAG_CONTEXT_ONLY | Methods/lessons | Cadence used and outcome on similar project | No direct fill | Yes | Copying stale process | P2 |
| `C.c5_risques_coordination.penalites_internes_groupement` | Current internal penalty risk | HUMAN | Depends on current agreement | HUMAN_ONLY | — | Current signed terms | No | Yes | Legal risk | NO |
| `C.c5_risques_coordination.controle_qualite_livrables` | Proposed QC approach | HUMAN | Reusable methods are not surfaced | RAG_FILL_CANDIDATE | Validated methodologies | Approved QC workflow/checkpoints | Yes | Yes | Method suitability | P1 |
| `C.c5_risques_coordination.risques_vis_a_vis_partenaires` | Partner risks | HUMAN | Prior lessons unavailable | RAG_CONTEXT_ONLY | Validated lessons | Explicit prior issue/mitigation | No direct fill | Yes | Reputation/bias | P2 |
| `C.c5_risques_coordination.risques_consultants_externes` | External consultant risks | HUMAN | Restricted evidence | RAG_CONTEXT_ONLY | Restricted lessons/CVs | Documented delivery issue, no inference | No direct fill | Yes | PII/reputation | P2 |
| `C.rex_projet_reference.identite` | Similar reference project | AI/empty | No project KB today | RAG_FILL_CANDIDATE | Project/offer KB | Validated project identity/reference | Yes | Yes | False reference | P1 |
| `C.rex_projet_reference.niveau_similitude` | Similarity classification | AI/empty | Needs structured comparison | RAG_FILL_CANDIDATE | Project + CDC characteristics | Matched scope/sector/country/deliverables | Yes, with matched dimensions | Yes | Superficial similarity | P1 |
| `C.rex_projet_reference.differences_cles` | Material differences | AI/empty | No comparable evidence | RAG_FILL_CANDIDATE | Project/offer KB | Explicit mismatched dimensions | Yes | Yes | Omitted differences | P1 |
| `C.rex_ecarts_couts.postes_sous_estimes` | Historically underestimated costs | AI/empty | Requires closeout evidence | RAG_FILL_CANDIDATE | Approved project closeout | Explicit estimated-versus-actual item | Yes | Yes | Sensitive finance | P1 |
| `C.rex_ecarts_couts.postes_surestimes` | Historically overestimated costs | AI/empty | Requires closeout evidence | RAG_FILL_CANDIDATE | Approved project closeout | Explicit estimated-versus-actual item | Yes | Yes | Sensitive finance | P2 |
| `C.rex_ecarts_couts.depassement_budgetaire` | Documented overall overrun | AI/empty | Must not be inferred | RAG_FILL_CANDIDATE | Approved project closeout | Explicit overrun amount/rate and cause | Yes | Yes | Sensitive finance | P2 |
| `C.rex_standards_client.standards_techniques` | Client/country standards used | HUMAN | Historical delivery evidence disconnected | RAG_FILL_CANDIDATE | Technical offers/deliverables | Explicit standard and project/date | Yes | Yes | Obsolete standard | P1 |
| `C.rex_standards_client.habitudes_validation` | Documented client validation practice | HUMAN | Institutional memory unavailable | RAG_FILL_CANDIDATE | Delivery correspondence/lessons | Explicit approval cycles and evidence | Yes | Yes | Confidential/stale | P1 |
| `C.rex_standards_client.risque_methodologie_non_adaptee` | Adaptation risk | HUMAN | Requires current comparison | RAG_CONTEXT_ONLY | Methods + lessons | Prior method constraints and current mismatch | No direct fill | Yes | Judgment | P1 |
| `C.rex_recommandations.ajustements_dimensionnement` | Recommended sizing adjustment | HUMAN | Needs current plan plus lessons | RAG_CONTEXT_ONLY | Closeout lessons | Documented under/over-sizing evidence | No direct fill | Yes | Capacity decision | P1 |
| `C.rex_recommandations.points_vigilance_prioritaires` | Current priority watchpoints | HUMAN | Priorities are current judgment | RAG_CONTEXT_ONLY | Lessons learned | Recurrent documented issues | No direct fill | Yes | Priority distortion | P1 |
| `C.rex_recommandations.bonnes_pratiques` | Practices to reuse | HUMAN | Reusable evidence unavailable | RAG_CONTEXT_ONLY | Approved methodologies/lessons | Practice, context, observed outcome | No direct fill | Yes | Context mismatch | P1 |

**C totals:** fill 12; context 9; human 13; not relevant 7; prohibited 4.

## 7. FCI D — field-by-field RAG mapping

| Field | Business meaning | Current source | Current limitation | RAG category | Best RAG source | Evidence to retrieve | AI propose? | Human validation? | Risk | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `D.identification_commune.reference_interne_code_dossier` | AO code | AO/FICHE | None | NOT_RELEVANT_FOR_RAG | — | — | Deterministic | No | Low | NO |
| `D.identification_commune.intitule_offre` | Tender title | AO/FICHE | None | NOT_RELEVANT_FOR_RAG | — | — | Deterministic | No | Low | NO |
| `D.identification_commune.date_depot` | Deadline | CDC/FICHE | None after validation | NOT_RELEVANT_FOR_RAG | — | — | No | No | Staleness | NO |
| `D.identification_commune.prepared_by_name` | DG contributor | HUMAN | Current accountability | HUMAN_ONLY | — | Authenticated actor | No | Yes | Accountability | NO |
| `D.identification_commune.validated_by_name` | DG validator | HUMAN | Approval-time fact | HUMAN_ONLY | — | Authenticated validator | No | Yes | Approval | NO |
| `D.d1_valeur_strategique.programme_pluriannuel` | Current CDC belongs to program | CDC/FICHE | Direct current fact | NOT_RELEVANT_FOR_RAG | — | Current program clause | Current extraction only | Yes | Misclassification | NO |
| `D.d1_valeur_strategique.programme_pluriannuel_details` | Program/future-phase details | AI(CDC) | Details may be distributed historically | RAG_FILL_CANDIDATE | Program/project archive | Explicit program phases and document date | Yes | Yes | Stale program | P2 |
| `D.d1_valeur_strategique.valeur_futurs_lots` | Potential value of future lots | AI(CDC) | Often speculative | RAG_CONTEXT_ONLY | Authoritative program documents | Explicit pipeline/lot evidence, not extrapolation | No direct estimate | Yes | Forecast risk | P2 |
| `D.d1_valeur_strategique.positionnement_geographique` | Strategic geographic positioning | AI(CDC)+ABC-VALID | Internal strategy absent | RAG_CONTEXT_ONLY | Institutional/project history | Existing footprint and validated experience | No direct strategy choice | Yes | Management judgment | P1 |
| `D.d1_valeur_strategique.valeur_reference` | Value as future reference | AI(CDC)+ABC-VALID | Needs comparable outcome history | RAG_CONTEXT_ONLY | Validated project references | Reference eligibility/use in later bids | No direct strategic rating | Yes | Self-claim | P1 |
| `D.d2_enjeux_reputationnels.risque_sous_performance` | Reputation risk if delivery fails | AI(CDC)+ABC-VALID | Historical consequences unavailable | RAG_CONTEXT_ONLY | Lessons/incidents | Documented consequences and mitigations | Context only | Yes | Sensitive reputation | P1 |
| `D.d2_enjeux_reputationnels.risque_perte` | Reputation/relationship risk if bid lost | AI(CDC)+ABC-VALID | Easy to speculate | RAG_CONTEXT_ONLY | Commercial/institutional history | Explicit prior relationship or program continuity | Context only | Yes | Unsupported narrative | P2 |
| `D.d2_enjeux_reputationnels.valeur_test_apprentissage` | Learning value | AI(CDC)+ABC-VALID | Internal capability roadmap absent | RAG_CONTEXT_ONLY | Lessons/project portfolio | Documented gaps and learning outcomes | Context only | Yes | Strategic judgment | P2 |
| `D.d3_decision_preliminaire.importance_strategique_globale` | DG strategic importance | DG_INPUT | Management judgment | PROHIBITED_AUTOFILL | Evidence bundle only | Context from current Fiche, validated ABC, history | No | Yes | Decision substitution | NO |
| `D.d3_decision_preliminaire.marche_prioritaire_direction` | DG priority | DG_INPUT | Current management policy | PROHIBITED_AUTOFILL | Evidence bundle only | Context, never a priority value | No | Yes | Decision substitution | NO |
| `D.d3_decision_preliminaire.conditions_priorisation` | Conditions if prioritized | DG_INPUT | Current management conditions | HUMAN_ONLY | — | DG-entered conditions | No | Yes | Governance | NO |
| `D.d3_decision_preliminaire.commentaires_strategiques` | DG strategic comments | DG_INPUT | Deliberative contribution | HUMAN_ONLY | — | DG-authored statement | No | Yes | Governance | NO |

**D totals:** fill 1; context 6; human 4; not relevant 4; prohibited 2.

## 8. Top 10 targeted RAG opportunities

### 1. FCI C — comparable reference project

- **Fields:** `rex_projet_reference.*`
- **Current problem:** active fields exist but the current Fiche cannot supply CONCEPT reference history.
- **Historical source:** validated project records, technical offers, completion records.
- **Retrieval query:** match current sector, scope, disciplines, deliverables, geography, client type, complexity and scale.
- **Expected evidence:** project ID, dates, role, scope, matched and differing characteristics, validation status.
- **Use:** propose identity, similarity dimensions and differences with citations.
- **Human verification:** Operations confirms eligibility and accuracy.
- **Why high value:** directly improves a three-field evidence gap without claiming current availability.

### 2. FCI C — client standards and validation habits

- **Fields:** `rex_standards_client.standards_techniques`, `habitudes_validation`.
- **Current problem:** institutional delivery knowledge is manual.
- **Historical source:** approved deliverables, client comments, acceptance logs, lessons learned.
- **Retrieval query:** same client/country/sector plus validation and standards terms.
- **Expected evidence:** named standard/version, approval cycles, dated source.
- **Use:** evidence-bound proposal with staleness warning.
- **Human verification:** Operations confirms current applicability.
- **Why high value:** actionable for methodology and planning.

### 3. FCI C — approved quality-control methodology

- **Fields:** `c5_risques_coordination.controle_qualite_livrables`.
- **Current problem:** reusable CONCEPT methods are not available to generation.
- **Historical source:** approved technical methodologies and QA plans.
- **Retrieval query:** deliverable type, disciplines, group structure, QA/QC checkpoints.
- **Expected evidence:** approved workflow, roles, gates, project context.
- **Use:** propose a tailored draft, not claim current assignment.
- **Human verification:** Operations approves adaptation.
- **Why high value:** reusable, evidence-rich, operationally concrete.

### 4. FCI A — documented competitor/client history

- **Fields:** `a1_concurrents[].historique_client`, `points_forts_connus`.
- **Current problem:** current deterministic guardrail correctly leaves these empty.
- **Historical source:** validated commercial reviews and tender outcomes.
- **Retrieval query:** normalized competitor entity + client + sector/country.
- **Expected evidence:** dated participation/result and explicitly recorded observation.
- **Use:** propose historical statements with source/date qualifiers.
- **Human verification:** Commercial checks entity resolution and relevance.
- **Why high value:** fills a major commercial-memory gap while retaining review.

### 5. FCI A — evidence-backed CONCEPT differentiator

- **Fields:** `a2_positionnement.avantage_differentiel`.
- **Current problem:** current CDC requirements cannot prove CONCEPT capability; guardrail forces human input.
- **Historical source:** validated references, completion certificates, approved offers.
- **Retrieval query:** current must-have requirements against documented CONCEPT delivery evidence.
- **Expected evidence:** exact reference, role, delivered capability, date.
- **Use:** propose narrowly worded differentiator tied to proof.
- **Human verification:** Commercial approves claim for use.
- **Why high value:** replaces unsupported self-claims with auditable evidence.

### 6. FCI C — documented cost-estimation lessons

- **Fields:** `rex_ecarts_couts.*`.
- **Current problem:** no closeout knowledge is connected.
- **Historical source:** approved estimate-versus-actual closeouts.
- **Retrieval query:** similar project type, work package, geography and cost category.
- **Expected evidence:** explicit variance, unit/currency/date, documented cause.
- **Use:** propose historical facts only; never current budget/margin.
- **Human verification:** Operations and Finance jointly confirm access/use.
- **Why high value:** supports sizing and vigilance without setting current financial policy.

### 7. FCI C — support profiles and technical means

- **Fields:** `c2_ressources_non_cles[].poste_expert`, `c3_moyens_capacite[].designation`.
- **Current problem:** supporting needs may be implicit in the current CDC.
- **Historical source:** comparable methods, staffing plans and project execution files.
- **Retrieval query:** task/deliverable/discipline to documented roles and means.
- **Expected evidence:** role/means used, project context, source section.
- **Use:** propose required categories, never names or availability.
- **Human verification:** Operations confirms necessity.
- **Why high value:** improves completeness while cleanly separating requirements from availability.

### 8. FCI C — prior partner collaboration

- **Fields:** `c5_risques_coordination.partenaires_non_eprouves`.
- **Current problem:** prior collaboration evidence is not linked.
- **Historical source:** validated consortium/project records.
- **Retrieval query:** normalized partner entity + joint project role.
- **Expected evidence:** project/date/roles and explicit completion status.
- **Use:** propose “documented prior collaboration” or “not documented,” not a quality judgment.
- **Human verification:** Operations/Commercial confirms identity.
- **Why high value:** answers a factual coordination question.

### 9. FCI B — historical client payment delay

- **Fields:** `b2_jalons_cash_flow[].delai_paiement_estime`, with context for `risque_cash_flow`.
- **Current problem:** contractual terms do not show actual timing.
- **Historical source:** authorized, validated payment history.
- **Retrieval query:** client, contract type, milestone type, period.
- **Expected evidence:** aggregated dated delays with sample size; no raw sensitive transaction detail in general logs.
- **Use:** propose a clearly historical range, never current liquidity/capacity.
- **Human verification:** Finance mandatory.
- **Why high value:** useful evidence, but only after strict finance authorization.

### 10. FCI D — comparable strategic/reputational lessons

- **Fields:** `d2_enjeux_reputationnels.*`, context for `d1_valeur_strategique.*`.
- **Current problem:** D sees current Fiche and validated ABC but not institutional lessons.
- **Historical source:** validated project outcomes, incident/lesson records, strategic reviews approved for reuse.
- **Retrieval query:** similar client/program/geography/visibility/complexity.
- **Expected evidence:** documented risk/outcome/mitigation and date.
- **Use:** attach a context dossier; do not populate DG priority or final decision.
- **Human verification:** DG mandatory.
- **Why high value:** improves strategic evidence without crossing the decision boundary.

## 9. Protected human/current fields

These fields must deliberately remain current/human even with a mature KB:

- **Identity and approval:** every `prepared_by_name`, `validated_by_name`.
- **Commercial current strategy:** target price; current vulnerability remains a human judgment even if lessons are shown.
- **Submission accountability:** transit plan, responsible submitter, current local-representation confirmation/details.
- **Finance policy/current parameters:** exchange rate/source, structural-charge coefficient, target margin. Historical values may be restricted context but never copied forward.
- **Current staffing and commitments:** planned effort, substitutes, availability probability, action owners, available quantities, startup availability, group member responsibility, assigned experts.
- **Current agreements:** groupement penalties and responsibility allocation.
- **DG judgment:** strategic importance, direction priority, prioritization conditions and DG comments.
- **Final Go/No-Go:** outside every FCI and never produced by RAG or FCI D.

`PROHIBITED_AUTOFILL` is stronger than merely low confidence: retrieval may support a reviewer-facing evidence panel, but the field value must remain untouched.

## 10. Knowledge source mapping

| Knowledge domain | FCI use | Minimum source types | Current repository readiness |
| --- | --- | --- | --- |
| Current CDC/Fiche | A/B/C/D current facts | Validated Fiche, persisted CDC | Implemented; local RAG is shadow/experimental |
| Historical CDC | Similar requirements, clauses, scopes | Approved historical CDC versions | Ingestion foundation implemented; diagnostic retrieval only |
| Project/offer knowledge | C references/methods/lessons; A differentiators; D context | Approved offers, contracts, completion/lesson records | Not implemented as a domain |
| Consultant/CV knowledge | Candidate experience/context only | Approved CV version and consent/purpose metadata | Not implemented; high-confidentiality controls required |
| Commercial memory | Competitors, participation, documented observations | Validated bid reviews/outcomes | Not implemented as a domain |
| Finance history | Payment/contract patterns, restricted lessons | Validated aggregated finance records | Not implemented; strict Finance-only access required |
| Validated FCI A/B/C | D strategic context | Latest human-validated versions only | Implemented for D |

AI-generated prose must never be re-indexed as authoritative evidence merely because it was generated. If retained for traceability, it must be classified as derivative/non-authoritative and excluded from evidence retrieval unless subsequently validated and promoted by an authorized human workflow.

## 11. Proposed targeted retrieval architecture

```text
Current CDC
    ↓
Human-validated Fiche + immutable source version/hash
    ↓
FCI gate and module-specific retrieval policy
    ├─ A → commercial memory + approved project references
    ├─ B → authorized contract/payment history only
    ├─ C → projects/methodologies/lessons; restricted CV context
    └─ D → validated A/B/C + approved strategic lessons
    ↓
Small field/query-group retrieval requests
    ↓
Domain ACL + document validation/status filters
    ↓
Hybrid retrieval (metadata filters + lexical + dense + rerank)
    ↓
Evidence validator, deduplication and conflict grouping
    ↓
FCI generation receives current facts plus bounded evidence packets
    ↓
Schema validation + module guardrails + provenance checks
    ↓
AI proposal (`needs_review` / human-required gaps preserved)
    ↓
Department human review and validation
    ↓
D only after validated A+B+C
    ↓
Separate DG Go/No-Go workflow
```

Do not send the archive or even an entire retrieved document to every module. Define query groups by field intent, for example `commercial_competitor_history`, `reference_project_similarity`, `client_validation_practice`, and `historical_payment_delay`. Each group should have an allowlist of domains, source classes, roles, output fields and maximum chunks.

Suggested evidence packet:

```text
request_id, module_code, target_fields, query_concept
knowledge_domain, access_scope, confidentiality_class
document_id, document_version_id, source_hash
source_reference/path-safe label, project_or_ao_code
source_type, validation_status, source_owner
document_date/year, effective/expiry date when applicable
chunk_id/index, section, subsection, page
excerpt, lexical_score, dense_score, rerank_score
retrieved_at, processing_version
conflict_group, supersedes_document_version_id
```

Only approved excerpts needed for the target fields should reach the model. Raw paths, secrets, personal contact details and irrelevant CV sections should not enter prompts or logs.

## 12. Provenance, conflict, security and access control

### Provenance and grounding

- Every populated RAG-derived field must cite at least one permitted document version and chunk.
- A citation must support the specific claim, not merely share a topic.
- Store retrieval scores for diagnostics, but never equate vector similarity with factual confidence.
- Preserve dates, units, currencies, role, project and source status.
- A model justification is derivative, not source evidence.
- Empty or unsupported retrieval must preserve `null`/human-required behavior.

### Source precedence

Recommended precedence is field-sensitive:

1. current validated CDC/Fiche for current tender facts;
2. current approved structured internal fact for current company state;
3. latest human-validated FCI contribution for D context;
4. authoritative historical structured record;
5. approved historical source document;
6. human-entered internal note explicitly marked as such;
7. AI inference only as a labelled proposal.

Historical evidence must never override a contradictory current CDC or approved current internal fact.

### Conflicting evidence

- Do not silently choose the top-scoring chunk.
- Group conflicts by normalized entity/field and expose both values, dates and sources.
- Prefer an explicitly superseding version or authoritative/current source according to precedence.
- If precedence does not resolve the conflict, leave the field null or context-only and require human review.
- Record the conflict in `validation_warnings` and in a reviewer-visible evidence panel.

### Confidentiality and authorization

- Keep parsing, embeddings, vectors and generation local for confidential archives; no external API fallback.
- Apply authorization before retrieval and again before returning excerpts.
- Enforce module/role/purpose access: Commercial A, Finance B, Operations C, DG D, with additional document restrictions.
- CV collection requires purpose limitation, consent/legal basis, minimal indexed fields, PII redaction in logs, and deletion/version-retention handling.
- Finance history should use aggregates where possible and be Finance/DG restricted.
- Commercial observations need author/date/validation status; unvalidated opinion must not become a competitor fact.
- Qdrant payload filters are defense-in-depth, not the sole authorization layer.
- PostgreSQL should be the authoritative catalog for document status and ACL decisions.
- Do not expose unrestricted source paths; use stable safe references.
- Audit retrieval request, user, role, target fields, filters and returned document IDs without logging confidential excerpts by default.

The current KB schema lacks these controls and therefore must not be generalized to CV/finance/commercial archives without a catalog/ACL design step.

## 13. Recommended implementation order

### Phase 0 — contracts and governance

Define the domain taxonomy, evidence packet, ACL model, approved-source lifecycle, conflict behavior, retention, and test fixtures. Add no FCI prompt integration yet.

### Pilot 1 — FCI C project-reference retrieval

Use 5–20 approved, non-PII project/offer records. Target only `rex_projet_reference.*`. Evaluate evidence precision, similarity explanation, differences, citations, conflict handling and human usefulness. Do not target staffing availability.

### Pilot 2 — FCI C methodology and client-practice evidence

Target QC methodology, standards, validation habits and lessons. Keep recommendations context-only. Require explicit reviewer acceptance before values enter a form.

### Pilot 3 — FCI A documented commercial memory

Use validated competitor participation/history and CONCEPT reference evidence. Establish entity resolution, observation validation, date/staleness and reputation safeguards.

### Pilot 4 — restricted CV/expert retrieval

Only after ACL/PII controls are tested. Retrieve documented qualification/experience as candidate context; never infer availability or assign a person.

### Pilot 5 — Finance and DG context

Start with contract/payment history aggregates for B and an evidence panel for D. Do not autofill current finance policy, DG priority, or any final decision.

Each pilot should run shadow-only against synthetic and approved historical cases, compare field-level support/unsupported-claim rates, and require human usefulness scoring before expansion.

## 14. Open questions and missing data

1. Which archived document classes are approved for reuse, and who owns their validation?
2. Do project closeouts contain reliable estimate-versus-actual cost fields, or only narrative reports?
3. Is commercial win/loss and competitor history stored in a structured source with author/date, or only informal files?
4. What is the lawful purpose, retention period and field-level visibility for CV data?
5. Are partner identities normalized sufficiently for safe entity matching?
6. Which client correspondence may be indexed, and what confidential/legal restrictions apply?
7. Should RAG-derived values enter the editable field as `to_review`, or initially appear only in an evidence side panel?
8. Who may promote a historical document/note to “approved authoritative internal evidence”?
9. How should source expiry/staleness be defined per domain (rates, standards, client practice, qualifications)?
10. Should currently unmapped AI v1 synthesis fields become visible, be retired, or remain callback metadata?
11. The current KB schema is historical-CDC-specific. Should future domains share one catalog with domain-specific metadata, or separate catalogs/collections under one authorization service?
12. What quantitative acceptance thresholds should pilots use beyond schema validity: citation precision, unsupported claims, conflict recall, human edit distance and review time?

## 15. Final answer to the supervisor

**Oui, un RAG ciblé peut améliorer sensiblement le remplissage et surtout la qualité des FCI, mais seulement sur les champs pour lesquels CONCEPT possède une preuve historique/interne autorisée et traçable.**

Il aidera le plus sur la FCI C (projets de référence, méthodes, standards client, retours d'expérience et moyens requis) puis sur la FCI A (historique documenté des concurrents et références prouvant un différenciateur). Il peut apporter un contexte prudent à la FCI B et à la FCI D, avec des restrictions plus fortes.

Il ne doit délibérément pas remplir les paramètres financiers courants, le prix/marge cible, les disponibilités actuelles, les affectations de personnes ou de responsabilités, les priorités de la Direction, ni aucune décision Go/No-Go. En absence de preuve autorisée, le bon résultat reste `null`, non documenté ou saisie humaine requise—not a plausible completion.

The right objective is therefore **higher evidence quality and reviewer usefulness**, not a higher automatic completion percentage.

## Appendix A — classification totals

| Module | RAG_FILL_CANDIDATE | RAG_CONTEXT_ONLY | HUMAN_ONLY | NOT_RELEVANT_FOR_RAG | PROHIBITED_AUTOFILL | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 5 | 3 | 6 | 3 | 1 | 18 |
| B | 2 | 3 | 3 | 5 | 2 | 15 |
| C | 12 | 9 | 13 | 7 | 4 | 45 |
| D | 1 | 6 | 4 | 4 | 2 | 17 |
| **Total** | **20** | **21** | **26** | **19** | **9** | **95** |

## Appendix B — principal repository evidence inspected

- FCI prompts and schemas under `ai/prompts/` and `ai/schemas/`.
- FCI runtime, contracts, schema validation, source Fiche, service, repository, presentation, form normalization/rendering, commercial and strategy guardrails under `lib/appels-offres/fci/`.
- FCI API routes and signed callback/contract validation routes.
- FCI UI/editor/source-reference components under `components/fci/`.
- Go/No-Go decision/report services, workflow state, assignments, DG decision UI and notification orchestration.
- Historical KB documentation, SQL catalog, service, query helper, tests, local startup scripts and inactive n8n workflows.
- Local CDC RAG server, canonical/routing logic, shadow boundary and provider/confidential-mode policy.
- Existing RAG benchmark documentation concerning hybrid retrieval, reranking, embeddings and grounding limitations.

