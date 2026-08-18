# Mapping FOR-COM-02 Go/No-Go

The exporter reads only the immutable source snapshot of the selected Go/No-Go report. New snapshots retain the complete validated `data` payload for A/B/C/D; legacy snapshots fall back to their captured `facts`. Empty optional values stay empty. No current FCI draft is queried during rendering.

| Template field | Source | Source path / field | Fallback | Editable by | Notes |
|---|---|---|---|---|---|
| CODE OFFRE | Dossier | `dossier.code` / route code | None | System | Tender-scoped |
| TYPE D'OFFRE | Fiche CDC | `type_procedure`, then `type_proposition` | Blank | Fiche owner | No inference |
| INTITULE OFFRE | Dossier | Current dossier title | Fiche `intitule_mission` | Commercial upstream | Dossier title has priority |
| DUREE / DUREE TOTALE | Fiche CDC | `duree_totale` | Blank | Fiche owner | Validated snapshot |
| PRESTATIONS A FOURNIR | Fiche CDC | `nature_prestation`, then `livrables_principaux` | Blank | Fiche owner | Validated snapshot |
| COMPOSANTES DU PROJET | Fiche CDC | `phases_mission`, then `points_techniques_structurants` | Blank | Fiche owner | Validated snapshot |
| METHODE SELECTION | Fiche CDC | `methode_selection` | Blank | Fiche owner | Validated snapshot |
| FORCES | Commercial-reviewed report | `editable_payload.key_strengths` | Blank | Commercial | Reviewed value wins |
| FAIBLESSES | FCI A | `positionnement_offre.notre_vulnerabilite_principale` | Captured A fact; blank | Commercial/FCI A owner | Validated A only |
| OPPORTUNITES / MENACES | FCI D | `synthese_direction.opportunites_majeures`, `menaces_majeures` | Captured D facts; blank | DG/FCI D owner | Contribution, not final decision |
| RISQUES MAJEURS | Commercial-reviewed report | `editable_payload.key_risks` | Blank | Commercial | Consolidated reviewed value |
| PLAN CORRECTION RISQUES | Commercial-reviewed report | `editable_payload.reservations` | Blank | Commercial | Mitigation/reservations |
| CLIENT | Fiche CDC | `client_maitre_ouvrage` | Snapshot `dossier.buyer`; blank | Fiche owner | No live draft |
| FINANCEMENT | Fiche CDC | `source_financement`, then `credit_financement` | Blank | Fiche owner | Validated snapshot |
| PARTENAIRES | FCI A | `points_logistiques_internes.representation_locale_existante` | Captured A fact; blank | Commercial/FCI A owner | Only if present |
| DATE DE REMISE | Fiche CDC | `date_limite_depot` | Snapshot `dossier.due_date`; blank | Fiche owner | Validated snapshot |
| DATE LIMITE ECLAIRCISSEMENT | FCI A | `identification_opportunite.date_limite_eclaircissement` | Captured A fact; blank | Commercial/FCI A owner | Often unmapped |
| CONFERENCE PREPARATOIRE | FCI A | `identification_opportunite.conference_preparatoire` | Captured A fact; blank | Commercial/FCI A owner | Often unmapped |
| PRINCIPAUX CONCURRENTS | FCI A | `concurrents_premiere_lecture[]` | Empty template rows | Commercial/FCI A owner | Structured rows retained |
| BUDGET | FCI B | `elements_financiers_internes.budget_estime_du_marche` | Captured B fact; blank | Finance | Validated B only |
| OFFRES SIMILAIRES / MONTAGE | FCI A | `references_offres_similaires`, `montage_offre` | Captured A fact; blank | Commercial | Only reliable values render |
| COMMENTAIRES / AVIS DC | Commercial-reviewed report | `commercial_summary`, then `commercial_recommendation` | Blank | Commercial | Reviewed value wins |
| VOLUME PRESTATIONS CONCEPT | Fiche CDC | `volume_hommes_mois` | Blank | Fiche owner | Validated snapshot |
| VOLUME PRESTATION CLIENT | FCI C | `repartition_des_composantes_techniques[0].effort_estime_client_vs_concept` | Captured C fact; blank | Operations | No fabrication |
| CHARGE / MAITRISE TECHNIQUE | FCI C | `synthese_operations.niveau_complexite_operationnelle` | Captured C fact; blank | Operations | Validated C only |
| RESPONSABLE TECHNIQUE | FCI C | first `disponibilite_des_experts_cles[].poste_ou_expert` | Captured C fact; blank | Operations | Role/profile, not invented person |
| TEMPS PREPARATION / VISITE SITE | FCI C | `temps_preparation_offre`, `visite_site` | Captured C fact; blank | Operations | Usually unmapped |
| EXIGENCES CLIENT | Fiche CDC | `exigences_es`, then `normes_referentiels`, `contraintes_site` | Blank | Fiche owner | Validated snapshot |
| MOYENS MATERIELS | FCI C | `capacite_absorption_globale[]` | Empty template rows | Operations | Rows cloned if capacity exceeded |
| PERSONNEL CLE / APPUI | FCI C | `disponibilite_des_experts_cles[]`, `disponibilite_des_experts_non_cles[]` | Empty template rows | Operations | Structured grids retained |
| COMMENTAIRES / AVIS DO | Commercial-reviewed report | `operational_summary` | Blank | Commercial review | Reviewed consolidation wins |
| RESSOURCES FINANCIERES | FCI B | `cash_flow_par_jalon[]` | Empty template rows | Finance | Structured rows retained |
| TAUX DE CHANGE | FCI B | `elements_financiers_internes.taux_de_change_applique_et_source` | Captured B fact; blank | Finance | Validated B only |
| COEFFICIENT CHARGES | FCI B | `elements_financiers_internes.coefficient_de_charges_de_structure` | Captured B fact; blank | Finance | Validated B only |
| MODALITES PAIEMENT | FCI B | `synthese_financiere.commentaires_financiers_generaux` | Captured B fact; blank | Finance | Current schema has no dedicated field |
| AVANCE / FISCAL / CONTRAT / ASSURANCES | FCI B | `avance`, `immatriculation_fiscale`, `enregistrement_contrat`, `assurances` | Captured B facts; blank | Finance | Unmapped unless validated source provides them |
| CONTRIBUTION DG | FCI D | strategic comments / importance | Captured D fact; blank | DG/FCI D owner | Never treated as final decision |
| GO / GO AVEC RESERVES / NOGO | Final DG decision | `status` + `reserves` | All unchecked | DG | Rendering-only rule; enum unchanged |
| MOTIF / RESERVES / AUTEUR / DATE | Final DG decision | `rationale`, `reserves`, `decided_by`, `decided_at` | Blank | DG | No handwritten signature is created |

## Known fields without a reliable dedicated source

The current schemas do not reliably provide: offer-preparation time, site-visit status, clarification deadline, preparatory conference, similar-offer history, offer consortium/montage, contract time-spent share, optional-service cost, advance, tax-registration requirement, contract registration, insurance details, personnel tariffs, and several personnel-sharing columns. They remain blank unless the validated snapshot contains a matching explicit field.

The master template is never instrumented or written. The renderer extracts it into a temporary directory, edits `word/document.xml` in that copy, and packages a new DOCX. The original variable-length grids are retained; formatted rows are duplicated only when the captured array exceeds the virgin row capacity.
