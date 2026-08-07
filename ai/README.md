# Contrats IA FCI

Ce dossier formalise la **Phase 2.5** du module FCI de CONCEPT :

Fiche CDC -> prompt IA -> JSON structuré -> validation de schéma -> future persistance -> futur éditeur React

Cette phase crée uniquement les **contrats IA** pour les modules FCI `A` à `D`.

## Modules couverts

| Code | Module | Référent métier |
| --- | --- | --- |
| `A` | Commercial | `DC` |
| `B` | Finance | `DF` |
| `C` | Operations | `DO` |
| `D` | Strategy / Direction | `DG` |

Le **module E** n’est pas implémenté ici :

- le template Word contient bien une section retour d’expérience ;
- mais la base de connaissances n’est pas encore disponible ;
- la suite fonctionnelle devra être protégée par `knowledge_base_enabled`.

## Arborescence

- `templates/`
  - template Word audité
- `prompts/`
  - prompts IA module par module
- `schemas/`
  - contrats JSON Schema Draft 2020-12
- `examples/`
  - fixtures d’entrée et de sortie

## Audit du template Word réel

Template audité :

- `ai/templates/FCI_modele_generique version 4 final.docx`

Remarque :

- le nom réel du fichier diffère du chemin théorique initial `FCI_modele_generique_v4.docx`
- aucun renommage automatique n’a été imposé dans cette phase

### Structure extraite

1. **Titre global**
   - `FICHE CONTEXTE INTERNE (FCI)`
   - `Préparation de l’analyse SWOT et de la décision Go / No Go`

2. **Identification de l’opportunité**
   - `Référence interne / Code dossier`
   - `Intitulé de l’offre`
   - `Date de dépôt`
   - `Préparé par`
   - `Validé par`

3. **Fiches incluses dans ce document**
   - A commercial / veille concurrentielle
   - B finance
   - C ressources / opérations
   - D stratégie long terme
   - E retour d’expérience

4. **Détail des fiches**
   - `FICHE A. Veille concurrentielle, logistique du dépôt et logistique interne du dépôt`
   - `FICHE B. Analyse financière préliminaire`
   - `FICHE C. Disponibilité des ressources et partage des rôles du groupement`
   - `FICHE D. Positionnement stratégique long terme`
   - `FICHE E. Retour d’expérience`

### Incohérence détectée dans le DOCX

Le tableau de synthèse du template emploie une numérotation qui ne recopie pas parfaitement les lettres des sections détaillées du corps du document.

Pour la Phase 2.5, la règle retenue est :

- les **sections détaillées** du corps du document font foi ;
- les contrats IA sont donc alignés sur :
  - `A = commercial`
  - `B = finance`
  - `C = operations`
  - `D = strategy`

## Champs par module

### Module A

- `identification_opportunite`
- `concurrents_premiere_lecture`
- `positionnement_offre`
- `points_logistiques_internes`
- `synthese_commerciale`

### Module B

- `elements_financiers_internes`
- `cash_flow_par_jalon`
- `calculs_financiers`
- `synthese_financiere`

### Module C

- `disponibilite_des_experts_cles`
- `disponibilite_des_experts_non_cles`
- `capacite_absorption_globale`
- `repartition_des_composantes_techniques`
- `risques_coordination_mitigation`
- `synthese_operations`

### Module D

- `contexte_programme_valeur_strategique`
- `enjeux_reputationnels`
- `decision_strategique_preliminaire`
- `synthese_direction`

## Source types

Chaque champ IA utilise obligatoirement l’un de ces `source_type` :

- `fiche_cdc`
- `ai_inference`
- `internal_required`
- `unavailable`
- `not_applicable`

### Règles

- `internal_required`
  - `value = null`
  - `requires_human_input = true`
  - `confidence = "none"`
- `unavailable`
  - donnée absente du CDC et non confirmable à ce stade
- `ai_inference`
  - doit rester prudent et justifié

## Niveaux de confiance

- `high`
- `medium`
- `low`
- `none`

## Règles d’honnêteté et de non-invention

L’IA ne doit jamais inventer :

- marges internes
- trésorerie disponible
- disponibilité réelle des experts
- capacités réelles du matériel
- validation de la direction
- historique client non fourni
- concurrents non explicitement connus
- priorités stratégiques internes

## Structure commune

Tous les modules suivent la même enveloppe :

- `contract_version`
- `module_code`
- `module_type`
- `generated_at`
- `source_fiche` *(voir ci-dessous — non produit par Gemini)*
- `summary` *(voir ci-dessous — non produit par Gemini)*
- `data`
- `ai_notes`
- `validation_warnings`

## Métadonnées fournies par CONCEPT

`source_fiche` et `summary` sont des métadonnées plateforme, pas une sortie
du modèle : Gemini n'a aucun moyen fiable de connaître le `validated_at`
réel de la fiche, et lui demander de recalculer un résumé de complétion
produisait des violations de schéma systématiques (champs manquants, clés
en trop, énumération invalide) sans jamais apporter d'information que la
plateforme n'avait pas déjà.

Depuis la Phase 2.5.1, les prompts demandent explicitement à Gemini
d'omettre ces deux clés, et `ai-validation.ts` ne les exige plus ni ne les
valide dans la réponse brute du modèle (`fci-common.schema.json` -
`module_envelope_base`). `applyFciSuccessCallback`
(`lib/appels-offres/fci/service.ts`) reconstruit `source_fiche` à partir du
job de génération et calcule `summary` à partir des `requires_human_input`
déjà validés dans `data` (voir `lib/appels-offres/fci/callback-derivation.ts`)
avant persistance - ce qui est envoyé par Gemini pour ces deux clés, s'il y
en a, est ignoré.

## Validation de schéma

Validateur local :

- `lib/appels-offres/fci/ai-validation.ts`

Harnais hors-ligne :

- `scripts/test-fci-ai-contracts.ts`

Commande :

```bash
npm run test:fci-contracts
```

Cette validation :

1. charge les fixtures
2. valide chaque module
3. teste plusieurs cas négatifs
4. échoue si un contrat devient incompatible

## Consommation future par n8n

Une future orchestration n8n devra :

1. charger la Fiche CDC normalisée
2. injecter `source_fiche`
3. choisir le prompt du module
4. appeler Gemini
5. parser le JSON
6. valider avec `validateFciAiPayload(...)`
7. refuser toute sortie invalide
8. persister seulement un payload validé

## Rendu futur côté UI

Le futur workspace React devra exploiter, pour chaque champ :

- `value`
- `source_type`
- `confidence`
- `requires_human_input`
- `justification`
- `source_references`

Cela permettra :

- d’indiquer l’origine d’un champ
- de visualiser les inférences
- de demander une complétion humaine
- d’expliquer la provenance d’une valeur

## Mapping recommandé vers la base actuelle

La base créée en Phase 2 peut déjà stocker les contrats sans migration obligatoire.

### Mapping proposé

| Payload IA | Colonne actuelle |
| --- | --- |
| payload complet validé | `fci_module_data.data_json` |
| résumé des métadonnées source | `fci_module_data.source_summary_json` |
| synthèse de confiance agrégée, si souhaitée | `fci_module_data.confidence_json` |
| `ai_notes` et avertissements de validation | `fci_module_data.ai_notes_json` |

### Point d’attention

Il n’existe pas encore de colonne dédiée pour :

- les erreurs détaillées de validation
- les métadonnées d’appel LLM
- les traces de prompt/réponse

Ce n’est pas bloquant pour Phase 2.5, mais une migration additive pourra être utile plus tard si l’on veut historiser l’exécution IA.

## Politique de version

Version initiale :

- `1.0`

Règles recommandées :

- ajout optionnel compatible -> mineure
- renommage ou suppression d’un champ -> majeure
- ne jamais changer silencieusement un contrat déjà consommé par des données persistées

## Commandes de validation

```bash
npm run test:fci-contracts
npm run typecheck
npm run build:prod
```

## Hypothèses retenues

- le corps détaillé du template Word est prioritaire sur son tableau de synthèse en cas d’incohérence ;
- `source_fiche.version` reste une chaîne pour rester compatible avec la Phase 2 déjà implémentée ;
- le test Gemini live reste volontairement hors périmètre de la Phase 2.5.
