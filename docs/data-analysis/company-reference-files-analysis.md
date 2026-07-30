# Company Reference Files Analysis

## 1. Files inspected

### `data/imports/private/referentiels/Liste Logiciels_Techniques envoyé par Si Maher.xlsx`

- Format: `.xlsx`
- Purpose: technical software catalogue maintained as reusable company reference data
- Classification: master reference data
- Worksheets:
  - `Feuil2` - 12 used rows, 3 used columns

### `data/imports/private/exemples-analyse/Résultat analyse_logiciels_cdc_mballing (2).xlsx`

- Format: `.xlsx`
- Purpose: tender-specific software analysis result, structured as a human-readable review workbook
- Classification: generated analysis result
- Worksheets:
  - `00_Logiciels_source` - 13 used rows, 2 used columns
  - `01_Synthese` - 8 used rows, 2 used columns
  - `02_Besoins` - 20 used rows, 7 used columns
  - `03_Par_logiciel` - 13 used rows, 6 used columns
  - `04_Manquants` - 11 used rows, 5 used columns
  - `05_Confirmations` - 9 used rows, 2 used columns
  - `06_Sources` - 6 used rows, 3 used columns

### `data/imports/private/exemples-analyse/Résultat analyse_competences_CA21759.xls`

- Format: `.xls`
- Purpose: tender-specific competency analysis result, mixing structured tables with narrative analysis
- Classification: generated analysis result
- Worksheets:
  - `Synthèse` - 33 used rows, 3 used columns
  - `Compréhension du marché` - 16 used rows, 2 used columns
  - `Compétences explicites` - 22 used rows, 6 used columns
  - `Compétences implicites` - 19 used rows, 7 used columns
  - `Compétences insuffisantes` - 14 used rows, 6 used columns
  - `Compétences absentes` - 16 used rows, 11 used columns
  - `Profils nécessaires` - 17 used rows, 6 used columns
  - `Risques compétences` - 15 used rows, 11 used columns
  - `Synthèse compétences` - 38 used rows, 11 used columns

## 2. Technical software catalogue

### Workbook structure

- The workbook contains one worksheet: `Feuil2`.
- The data is simple and compact, but not fully import-ready.
- Row 1 is blank.
- The effective header row is row 2.
- No merged cells were detected.
- No formulas were detected.

### Worksheet structure

#### `Feuil2`

- Effective headers:
  - `Logiciels`
  - `Utilisation`
- There is also one leading blank column in the sheet layout. This should not be imported as a business field.
- Important structural signals:
  - blank title/spacing row before the header
  - free-text usage column
  - no explicit IDs, categories, domains, statuses, dates, or codes

### Important columns

- `Logiciels`
  - Business meaning: software name
  - Likely destination: `Administration -> Logiciels`
  - Data type: text
  - Notes:
    - some rows contain one software name
    - at least one row contains multiple names in the same cell, for example `CAD Earth, Global Mapper, Google Earth`
    - this indicates future normalization into one row per software
- `Utilisation`
  - Business meaning: usage description
  - Likely destination: `Administration -> Référentiels`
  - Data type: long text
  - Notes:
    - free-text descriptions such as design, hydraulic modeling, or mapping use cases
    - should likely remain raw text first, then optionally be normalized later into categories or domains

### Data quality

- Strengths:
  - very small workbook
  - understandable business intent
  - directly reusable as a first software seed list
- Weaknesses:
  - blank leading column
  - no stable technical identifier
  - no explicit software categories
  - no explicit technical domains
  - one cell can contain several software names
  - spelling and naming normalization will be required

### Duplicates

- No exact duplicate rows were detected in the sheet.
- Semantic duplication risk exists because:
  - the same usage text is repeated across several rows
  - naming may vary by spelling or capitalization, for example `Autocad`, `HecRas`, `EPASWIMM`

### Missing values

- The leading layout column is effectively empty and should be ignored.
- The main business columns appear materially populated in the sampled rows.

### Platform destination

- `Logiciels` -> `Administration -> Logiciels`
- `Utilisation` -> `Administration -> Référentiels`
- Future optional normalization from `Utilisation`:
  - not suitable for direct strict import yet
  - could later feed `SoftwareDomain`, `SoftwareCategory`, or tagging tables after manual cleanup

## 3. Software analysis result

### Workbook structure

- The workbook is highly structured and consistent.
- Every worksheet uses the same visual pattern:
  - merged title row in row 1
  - blank separator row in row 2
  - effective header row in row 3
  - one logical table below
- Merged title cells were detected on every sheet.
- No formulas were detected.
- The workbook is clearly designed as a generated analysis report, not as a direct import workbook.

### Worksheet structure

#### `00_Logiciels_source`

- Headers:
  - `Logiciel`
  - `Utilisation indiquée dans l’Excel`
- Role:
  - snapshot of the source software catalogue used for the analysis
- Destination:
  - mostly human-readable reference only
  - could support `Administration -> Logiciels` verification

#### `01_Synthese`

- Headers:
  - `Rubrique`
  - `Conclusion`
- Role:
  - executive summary of the software analysis
- Destination:
  - human-readable reference only
  - selective storage possible as `AnalysisRecommendation`, but not required for first import phases

#### `02_Besoins`

- Headers:
  - `Besoin identifié dans le cahier des charges`
  - `Besoin explicite ou implicite`
  - `Logiciel(s) concerné(s)`
  - `Niveau de nécessité`
  - `Justification`
  - `Risque en cas d’absence`
  - `Alternative possible`
- Role:
  - normalized list of tender-specific software needs inferred from one CDC
- Destination:
  - `Appel d’offres -> Analyse -> Logiciels`
  - `Appel d’offres -> Analyse -> Risques`

#### `03_Par_logiciel`

- Headers:
  - `Logiciel`
  - `Utilité par rapport au cahier des charges`
  - `Niveau de nécessité`
  - `Besoin couvert`
  - `Décision recommandée`
  - `Commentaire`
- Role:
  - software-by-software suitability review
- Destination:
  - `Appel d’offres -> Analyse -> Logiciels`
  - `Appel d’offres -> Analyse -> Recommandations` in future if a recommendation entity is created

#### `04_Manquants`

- Headers:
  - `Besoin non couvert`
  - `Type de logiciel nécessaire`
  - `Pourquoi ce besoin est nécessaire`
  - `Niveau d’urgence`
  - `Exemple de logiciel ou de catégorie`
- Role:
  - missing software needs and gap analysis
- Destination:
  - `Appel d’offres -> Analyse -> Logiciels`
  - `Appel d’offres -> Analyse -> Risques`

#### `05_Confirmations`

- Headers:
  - `Point à confirmer`
  - `Question ou information à obtenir`
- Role:
  - manual follow-up questions before committing to a final business conclusion
- Destination:
  - `Appel d’offres -> Analyse -> Sources`
  - or a dedicated confirmation entity if follow-up workflows are later added

#### `06_Sources`

- Headers:
  - `Source`
  - `Fichier`
  - `Commentaire`
- Role:
  - provenance and evidence trail
- Destination:
  - `Appel d’offres -> Analyse -> Sources`

### Important columns

- Inputs and source evidence:
  - `Logiciel`
  - `Utilisation indiquée dans l’Excel`
  - `Source`
  - `Fichier`
- Tender analysis outputs:
  - `Besoin identifié dans le cahier des charges`
  - `Logiciel(s) concerné(s)`
  - `Niveau de nécessité`
  - `Besoin couvert`
  - `Décision recommandée`
  - `Niveau d’urgence`
- Risk and recommendation signals:
  - `Risque en cas d’absence`
  - `Alternative possible`
  - `Pourquoi ce besoin est nécessaire`
  - `Exemple de logiciel ou de catégorie`
  - `Question ou information à obtenir`

### Inputs

- The workbook appears to consume:
  - the software reference list
  - one CDC
  - human or AI interpretation of software needs

### Outputs

- Tender-specific software requirements
- Coverage assessment per software
- Missing software recommendations
- Confirmation questions
- Evidence and source references

### Recommendations

- Recommendations are present in narrative form, not in a dedicated normalized structure.
- The most recommendation-oriented columns are:
  - `Décision recommandée`
  - `Alternative possible`
  - `Exemple de logiciel ou de catégorie`
  - `Question ou information à obtenir`

### Sources

- `06_Sources` is the clearest future source-evidence table in the current files.
- It should likely remain linked to one analysis run or one tender.

### Platform destination

- `00_Logiciels_source` -> human-readable reference only
- `01_Synthese` -> human-readable reference only, with optional future recommendation extraction
- `02_Besoins` -> `Appel d’offres -> Analyse -> Logiciels`
- `03_Par_logiciel` -> `Appel d’offres -> Analyse -> Logiciels`
- `04_Manquants` -> `Appel d’offres -> Analyse -> Logiciels` and `Appel d’offres -> Analyse -> Risques`
- `05_Confirmations` -> `Appel d’offres -> Analyse -> Sources` or future confirmations
- `06_Sources` -> `Appel d’offres -> Analyse -> Sources`

## 4. Competency analysis result

### Workbook structure

- The workbook is in legacy `.xls` format.
- This alone creates compatibility risk for automated import tooling.
- Visible values were successfully inspected, but direct formula detection is limited in `.xls` when using `xlrd`.
- The workbook mixes:
  - tabular sheets ready for row-by-row interpretation
  - narrative sheets with one or more logical blocks inside the same worksheet

### Worksheet structure

#### `Synthèse`

- Two logical sections appear in the same worksheet.
- First block:
  - `Élément analysé`
  - `Résultat synthétique`
  - `Commentaire`
- Second block:
  - `Point de synthèse`
  - `Analyse exécutive`
  - `Preuves ou vérifications à demander`
- Role:
  - executive and validation summary
- Destination:
  - mostly human-readable reference only
  - selected rows could later support confirmations or recommendations

#### `Compréhension du marché`

- Headers:
  - `Rubrique`
  - `Analyse`
- Role:
  - narrative interpretation of the market and mission context
- Destination:
  - human-readable reference only

#### `Compétences explicites`

- Headers:
  - `Compétence explicitement demandée`
  - `Domaine`
  - `Passage ou exigence justificative`
  - `Profil concerné`
  - `Niveau attendu`
  - `Rôle dans la mission`
- Role:
  - directly stated competency requirements in the CDC
- Destination:
  - `Appel d’offres -> Analyse -> Compétences`
  - `Appel d’offres -> Analyse -> Sources`

#### `Compétences implicites`

- Headers:
  - `Compétence implicitement nécessaire`
  - `Domaine`
  - `Élément du cahier des charges permettant de l’inférer`
  - `Pourquoi cette compétence est nécessaire`
  - `Risque si absente`
  - `Degré de nécessité`
  - `Recommandation`
- Role:
  - inferred competency requirements
- Destination:
  - `Appel d’offres -> Analyse -> Compétences`
  - `Appel d’offres -> Analyse -> Risques`

#### `Compétences insuffisantes`

- Headers:
  - `Compétence concernée`
  - `Formulation actuelle dans le cahier des charges`
  - `Pourquoi la formulation est insuffisante`
  - `Risque d’interprétation`
  - `Formulation améliorée proposée`
  - `Niveau de compétence à exiger`
- Role:
  - weakly specified competency clauses and recommended improvements
- Destination:
  - `Appel d’offres -> Analyse -> Compétences`
  - `Appel d’offres -> Analyse -> Risques`
  - partly human-readable recommendation support

#### `Compétences absentes`

- Headers:
  - `Compétence absente à ajouter`
  - `Nature de la compétence`
  - `Justification`
  - `Risque si elle n’est pas exigée`
  - `Niveau recommandé`
  - `Peut-elle être compensée par IA ou logiciel ?`
  - `Type d’agent IA ou de logiciel possible`
  - `Niveau de supervision humaine requis`
  - `Limites de la compensation numérique`
  - `Mode de vérification dans l’offre`
  - `Preuve attendue`
- Role:
  - missing competency gaps plus AI/software compensation analysis
- Destination:
  - `Appel d’offres -> Analyse -> Compétences`
  - `Appel d’offres -> Analyse -> Risques`
  - `Appel d’offres -> Analyse -> Sources`

#### `Profils nécessaires`

- Headers:
  - `Profil nécessaire`
  - `Rôle dans la mission`
  - `Compétences attendues`
  - `Niveau d’expérience recommandé`
  - `Caractère du profil`
  - `Activités ou livrables concernés`
- Role:
  - tender-specific required profiles, not a master employee list
- Destination:
  - `Appel d’offres -> Analyse -> Compétences`
  - not `Administration -> Employés`

#### `Risques compétences`

- Headers:
  - `Compétence manquante`
  - `Nature de la compétence`
  - `Partie du marché concernée`
  - `Risque opérationnel`
  - `Risque qualité`
  - `Risque délai`
  - `Niveau de criticité`
  - `Compensation possible par IA ou logiciel`
  - `Type d’outil envisageable`
  - `Risque résiduel après compensation`
  - `Mesure recommandée`
- Role:
  - competency risk register
- Destination:
  - `Appel d’offres -> Analyse -> Risques`
  - `Appel d’offres -> Analyse -> Compétences`

#### `Synthèse compétences`

- Headers:
  - `Compétence`
  - `Explicite ou implicite`
  - `Nature de la compétence`
  - `Justification dans le cahier des charges`
  - `Niveau de nécessité`
  - `Profil concerné`
  - `Risque si absente`
  - `Remplaçable ou assistable par IA / logiciel ?`
  - `Type d’agent IA ou logiciel recommandé`
  - `Supervision humaine requise`
  - `Preuve à demander au soumissionnaire`
- Role:
  - consolidated competency view for one tender
- Destination:
  - `Appel d’offres -> Analyse -> Compétences`
  - `Appel d’offres -> Analyse -> Risques`
  - `Appel d’offres -> Analyse -> Sources`

### Important columns

- Competency definition signals:
  - `Compétence explicitement demandée`
  - `Compétence implicitement nécessaire`
  - `Compétence concernée`
  - `Compétence absente à ajouter`
  - `Compétence`
- Domain and level signals:
  - `Domaine`
  - `Niveau attendu`
  - `Degré de nécessité`
  - `Niveau recommandé`
  - `Niveau de criticité`
- Profile signals:
  - `Profil concerné`
  - `Profil nécessaire`
  - `Niveau d’expérience recommandé`
  - `Caractère du profil`
- Evidence and recommendation signals:
  - `Passage ou exigence justificative`
  - `Élément du cahier des charges permettant de l’inférer`
  - `Preuve attendue`
  - `Preuve à demander au soumissionnaire`
  - `Mesure recommandée`

### Inputs

- One CDC and its business interpretation
- Internal or AI-driven analysis of competency needs
- No separate employee source workbook was found in the inspected files

### Outputs

- Explicit competency requirements
- Implicit competency requirements
- Missing competency gaps
- Risk analysis
- Suggested profiles
- Recommendations and evidence requests

### Experts or skills

- The workbook models skills and required profiles.
- It does not contain a real employee roster.
- `Profils nécessaires` should not be treated as `Administration -> Employés`.
- Any future `Employee`, `EmployeeCompetency`, or `EmployeeSoftware` entity would require a different source file.

### Gaps

- Gap-oriented sheets:
  - `Compétences insuffisantes`
  - `Compétences absentes`
  - `Risques compétences`
- These are clearly tender-specific and should not be loaded as master data.

### Platform destination

- `Synthèse` -> human-readable reference only
- `Compréhension du marché` -> human-readable reference only
- `Compétences explicites` -> `Appel d’offres -> Analyse -> Compétences`
- `Compétences implicites` -> `Appel d’offres -> Analyse -> Compétences`
- `Compétences insuffisantes` -> `Appel d’offres -> Analyse -> Compétences` and `Appel d’offres -> Analyse -> Risques`
- `Compétences absentes` -> `Appel d’offres -> Analyse -> Compétences`, `Appel d’offres -> Analyse -> Risques`, `Appel d’offres -> Analyse -> Sources`
- `Profils nécessaires` -> `Appel d’offres -> Analyse -> Compétences`
- `Risques compétences` -> `Appel d’offres -> Analyse -> Risques`
- `Synthèse compétences` -> consolidated tender analysis, partly database-suitable and partly human-readable

## 5. Master data versus tender-specific data

| Data element | Master data | Tender-specific | AI-generated | Manual | Destination |
| --- | --- | --- | --- | --- | --- |
| `Logiciels` from `Feuil2` | Yes | No | No | Yes | `Administration -> Logiciels` |
| `Utilisation` from `Feuil2` | Yes | No | No | Yes | `Administration -> Référentiels` |
| `00_Logiciels_source` rows | No | Yes | Possibly | Mixed | Human-readable reference only |
| `02_Besoins` rows | No | Yes | Yes | Possibly reviewed | `Appel d’offres -> Analyse -> Logiciels` |
| `03_Par_logiciel` rows | No | Yes | Yes | Possibly reviewed | `Appel d’offres -> Analyse -> Logiciels` |
| `04_Manquants` rows | No | Yes | Yes | Possibly reviewed | `Appel d’offres -> Analyse -> Logiciels` and `Risques` |
| `05_Confirmations` rows | No | Yes | Yes | Yes | `Appel d’offres -> Analyse -> Sources` or confirmation storage |
| `06_Sources` rows | No | Yes | Mixed | Yes | `Appel d’offres -> Analyse -> Sources` |
| `Compétences explicites` rows | No | Yes | Yes | Possibly reviewed | `Appel d’offres -> Analyse -> Compétences` |
| `Compétences implicites` rows | No | Yes | Yes | Possibly reviewed | `Appel d’offres -> Analyse -> Compétences` |
| `Compétences insuffisantes` rows | No | Yes | Yes | Possibly reviewed | `Appel d’offres -> Analyse -> Compétences` and `Risques` |
| `Compétences absentes` rows | No | Yes | Yes | Possibly reviewed | `Appel d’offres -> Analyse -> Compétences`, `Risques`, `Sources` |
| `Profils nécessaires` rows | No | Yes | Yes | Possibly reviewed | `Appel d’offres -> Analyse -> Compétences` |
| `Risques compétences` rows | No | Yes | Yes | Possibly reviewed | `Appel d’offres -> Analyse -> Risques` |
| `Synthèse compétences` rows | No | Yes | Yes | Possibly reviewed | Mixed: analysis storage plus human-readable reference |
| `Synthèse` and `Compréhension du marché` narrative content | No | Yes | Yes | Possibly reviewed | Human-readable reference only |

## 6. Preliminary entity model

| Entity | Purpose | Main fields | Source | Master or transactional |
| --- | --- | --- | --- | --- |
| `Software` | Company software catalogue | required: `name`; optional: `normalized_name`, `description_raw`, `status`; unique: normalized `name`; rels: many-to-many with `SoftwareDomain`, `SoftwareAlias`, tender matches | `Liste Logiciels_Techniques envoyé par Si Maher.xlsx` -> `Feuil2`.`Logiciels` | Master |
| `SoftwareAlias` | Preserve spelling variants and split combined names later | required: `software_id`, `alias`; optional: `source_note`; unique: (`software_id`, `alias`) | `Feuil2`.`Logiciels` where one cell contains several names or variant spellings | Master |
| `SoftwareUsageReference` | Keep raw usage descriptions attached to a software | required: `software_id`, `usage_raw`; optional: `normalized_domain`, `notes`; rels: belongs to `Software` | `Feuil2`.`Utilisation` | Master |
| `SoftwareDomain` | Optional normalized technical domain taxonomy when enough clean data exists | required: `label`; optional: `description`; unique: `label`; rels: many-to-many with `Software` | Not explicit in current files, only inferable from `Utilisation`; should be added only after manual curation | Master, later |
| `TenderSoftwareRequirement` | Store one software need identified for one tender | required: `appel_offres_id`, `requirement_text`, `explicitness`, `necessity_level`; optional: `justification`, `risk_if_missing`, `alternative`, `source_excerpt`; rels: belongs to tender, can link to `Software` and `AnalysisSource` | `Résultat analyse_logiciels_cdc_mballing (2).xlsx` -> `02_Besoins` | Transactional |
| `TenderSoftwareMatch` | Store software-by-software suitability against one tender | required: `appel_offres_id`, `software_name_raw`, `necessity_level`; optional: `software_id`, `utility_text`, `coverage_status`, `recommended_decision`, `comment`; unique: one row per tender/software if normalized; rels: belongs to tender, optionally to `Software` | `03_Par_logiciel` | Transactional |
| `TenderSoftwareGap` | Store missing or uncovered software needs | required: `appel_offres_id`, `missing_need`, `urgency_level`; optional: `software_type_needed`, `why_needed`, `example_software_or_category`; rels: belongs to tender | `04_Manquants` | Transactional |
| `Competency` | Reusable competency dictionary when stable labels emerge | required: `name`; optional: `normalized_name`, `domain`, `notes`; unique: normalized `name`; rels: many-to-many with tender requirements and profiles | `Compétences explicites`, `Compétences implicites`, `Synthèse compétences` | Reference, built from transactional evidence |
| `CompetencyDomain` | Normalized skill domain taxonomy | required: `label`; optional: `description`; unique: `label`; rels: many-to-many with `Competency` | `.xls` competency sheets using `Domaine` and `Nature de la compétence` | Reference |
| `TenderCompetencyRequirement` | Store competency requirements per tender | required: `appel_offres_id`, `competency_name_raw`, `requirement_kind`; optional: `competency_id`, `domain_raw`, `profile_raw`, `necessity_level`, `justification`, `source_excerpt`; rels: belongs to tender | `Compétences explicites`, `Compétences implicites`, `Synthèse compétences` | Transactional |
| `TenderCompetencyGap` | Store missing or insufficient competencies | required: `appel_offres_id`, `competency_name_raw`, `gap_kind`; optional: `justification`, `risk_text`, `recommended_level`, `improved_wording`, `ai_compensation_possible`; rels: belongs to tender | `Compétences insuffisantes`, `Compétences absentes` | Transactional |
| `TenderProfileRequirement` | Store required profiles for one tender | required: `appel_offres_id`, `profile_name`; optional: `role_in_mission`, `expected_competencies_raw`, `recommended_experience_level`, `profile_character`, `related_deliverables`; rels: belongs to tender, can link to competency requirements later | `Profils nécessaires` | Transactional |
| `TenderRisk` | Centralized risk storage across software and competencies | required: `appel_offres_id`, `risk_type`, `risk_text`; optional: `criticality_level`, `quality_risk`, `delay_risk`, `operational_risk`, `residual_risk`, `recommended_measure`; rels: belongs to tender, may link to software or competency rows | `02_Besoins`, `Compétences implicites`, `Compétences insuffisantes`, `Compétences absentes`, `Risques compétences`, `Synthèse compétences` | Transactional |
| `AnalysisSource` | Preserve evidence and provenance rows | required: `appel_offres_id`, `source_label`; optional: `file_name`, `comment`, `source_excerpt`, `sheet_name`; rels: belongs to tender, may link to requirements or risks | `06_Sources`, competency proof columns such as `Preuve attendue` and `Preuve à demander au soumissionnaire` | Transactional |
| `AnalysisConfirmation` | Store manual follow-up questions and unresolved points | required: `appel_offres_id`, `topic`; optional: `question_text`, `status`, `resolution_note`; rels: belongs to tender | `05_Confirmations`, `Synthèse`.`Preuves ou vérifications à demander` | Transactional |
| `AnalysisRecommendation` | Store higher-level AI or analyst recommendations | required: `appel_offres_id`, `recommendation_text`; optional: `scope`, `priority`, `related_entity_type`, `related_entity_id`; rels: belongs to tender | `01_Synthese`, `03_Par_logiciel`.`Décision recommandée`, `Compétences implicites`.`Recommandation`, `Risques compétences`.`Mesure recommandée` | Transactional |

### Entities not yet justified by the inspected files

- `Employee`
- `EmployeeCompetency`
- `EmployeeSoftware`
- `SoftwareCategory`

These may become valid later, but the current files do not provide a real employee source file or a clean software category taxonomy.

## 7. Data quality and import risks

- Header cleanliness issues:
  - the software catalogue has a leading blank layout column
  - several workbooks use title rows and blank spacing rows before the real header
- Duplicate and normalization risks:
  - repeated business meanings exist even where exact duplicate rows were not detected
  - software naming is not normalized
  - combined software names appear in one cell
- Spelling and variant risks:
  - likely spelling/casing variants such as `Autocad`, `HecRas`, `EPASWIMM`
  - future normalization rules will be required
- Mixed structure risks:
  - `Synthèse` in the competency workbook contains multiple logical tables in one worksheet
  - `Compréhension du marché` is narrative, not import-oriented
  - the software analysis workbook is report-oriented with merged title cells
- Missing taxonomy risks:
  - no explicit software categories
  - no explicit reusable technical domains for software
  - profile names are tender-specific, not a company roster
- Free-text risks:
  - many important columns are long narrative fields
  - these should be stored as raw text first
  - aggressive normalization too early would create data loss
- Formula risks:
  - no formulas were detected in the `.xlsx` files
  - formula detection in the `.xls` workbook is limited by the legacy file format and reader capabilities, so formulas cannot be fully ruled out without Excel-native inspection
- Confidentiality risks:
  - the analysis workbooks contain tender-specific interpretations and recommendations
  - they may also include sensitive commercial reasoning and should remain local/private
- Encoding and accent risks:
  - column names contain accents and curly apostrophes
  - import logic must preserve UTF-8 safely
- `.xls` compatibility risks:
  - legacy format support is weaker than `.xlsx`
  - future import tooling should either convert `.xls` to `.xlsx` first or explicitly support legacy parsing
- Potential data-loss risks:
  - splitting combined software names
  - collapsing narrative recommendations into rigid enums too early
  - dropping source/proof columns during normalization

## 8. Recommended implementation order

1. Clean the software catalogue workbook structure.
2. Create the software reference schema around `Software`, `SoftwareAlias`, and raw usage text.
3. Import software master data only after manual normalization of names and multi-name cells.
4. Build CRUD screens and APIs for `Administration -> Logiciels`.
5. Add optional reference support for software usage/domain tagging only after enough clean repeated patterns exist.
6. Model tender software analysis with `TenderSoftwareRequirement`, `TenderSoftwareMatch`, `TenderSoftwareGap`, `AnalysisSource`, and `AnalysisConfirmation`.
7. Import or generate software-analysis rows per `Appel d’offres` from structured result files.
8. Model competency analysis with `Competency`, `CompetencyDomain`, `TenderCompetencyRequirement`, `TenderCompetencyGap`, and `TenderProfileRequirement`.
9. Add unified tender risk storage so software and competency gaps can be surfaced consistently.
10. Add higher-level recommendations only after the base tender analysis entities are stable.
11. Add employees only when a real employee source file is available.
12. Keep narrative summary sheets as reference artifacts unless a later business need justifies partial extraction.

## 9. Open questions

- Should `Utilisation` in the software catalogue stay as raw text only, or should it later be split into formal software domains?
- Is there an official company-controlled naming standard for software names and aliases?
- Will future competency analysis always come from AI-generated workbooks, or can users edit/import them manually?
- Should `05_Confirmations` become a real follow-up workflow in the application, or remain an exported reference artifact?
- Is there a real employee or expert master source file planned for `Administration -> Employés`?
- Should `.xls` files be accepted long-term, or should they be converted to `.xlsx` before any import pipeline is built?
