# Analyse des logiciels par appel d'offres

## Objectif métier

Le module `Appel d'offres -> Analyse -> Logiciels` permet de comparer les besoins logiciels d'un CDC avec le catalogue interne déjà géré dans `Administration -> Logiciels`.

Cette première version reste entièrement exploitable sans IA :

- saisie manuelle des besoins, correspondances, manques, confirmations et sources ;
- édition complète des lignes ;
- revue humaine avec statut global `Brouillon -> A valider -> Valide` ;
- import optionnel d'un classeur `.xlsx` d'analyse pour accélérer les tests et la migration fonctionnelle.

## Relation avec Administration -> Logiciels

Le catalogue d'entreprise reste la seule source de vérité pour les logiciels de référence :

- `public.logiciels`
- `public.logiciel_aliases`

Le module d'analyse logiciels ne modifie pas ce catalogue.

Il crée des lignes transactionnelles propres à un seul appel d'offres :

- besoins logiciels détectés ;
- correspondances avec le catalogue ;
- manques ;
- questions de validation ;
- sources métier.

## Route principale

- Interface : `/appels-offres/[code]/analyse/logiciels`
- API agrégée : `/api/appels-offres/[code]/analyse/logiciels`
- Import preview : `/api/appels-offres/[code]/analyse/logiciels/import/preview`
- Import confirm : `/api/appels-offres/[code]/analyse/logiciels/import/confirm`

## Structure de page

La page expose :

1. un en-tête métier avec le code de l'appel d'offres ;
2. une sous-navigation Analyse :
   - `Logiciels`
   - `Compétences` (`Bientôt`)
   - `Risques` (`Bientôt`)
   - `Sources` (`Bientôt`)
3. une synthèse courte :
   - besoins identifiés
   - couverts
   - partiellement couverts
   - non couverts
   - à confirmer
4. cinq sections de travail :
   - `Besoins`
   - `Correspondances`
   - `Logiciels manquants`
   - `Points à confirmer`
   - `Sources`

## Entités PostgreSQL

### `public.software_analysis_reviews`

Statut global de la revue pour un appel d'offres et un scope d'analyse.

Scope actuellement implémenté :

- `logiciels`

Statuts :

- `draft`
- `submitted`
- `validated`

### `public.tender_software_requirements`

Un besoin logiciel identifié pour un appel d'offres.

Champs principaux :

- `requirement_text`
- `explicitness`
- `software_names_raw`
- `necessity_level`
- `justification`
- `risk_if_missing`
- `alternative_possible`
- `source_excerpt`
- `status`

### `public.tender_software_matches`

Une correspondance entre un nom logiciel brut et le catalogue interne.

Champs principaux :

- `software_name_raw`
- `logiciel_id`
- `match_type`
- `coverage_status`
- `necessity_level`
- `utility_text`
- `recommended_decision`
- `comment`
- `validated_by_user`
- `status`

### `public.tender_software_gaps`

Un besoin non couvert par le catalogue interne.

### `public.analysis_confirmations`

Questions à résoudre avant validation finale.

### `public.analysis_sources`

Sources, feuilles et commentaires métier utiles pour justifier la revue.

## Règles de matching

Le service de matching compare un nom logiciel brut avec :

1. `logiciels.name` normalisé ;
2. `logiciel_aliases.alias` normalisé ;
3. une correspondance conservatrice "possible" ;
4. sinon aucun match.

Comportement attendu :

- `exact` et `alias` peuvent être proposés automatiquement ;
- `possible` reste non validé tant qu'un utilisateur ne le confirme pas ;
- `none` ne crée aucune certitude artificielle ;
- le nom brut reste toujours conservé.

## Workflow manuel

Sans IA, un commercial peut :

- créer un besoin logiciel ;
- ajouter une correspondance vers un logiciel du catalogue ;
- déclarer un manque ;
- créer un point à confirmer ;
- ajouter une source ;
- relire et valider les lignes ;
- soumettre puis valider l'analyse globale.

## Import Excel de référence

L'import de test est limité au développement :

- upload manuel d'un `.xlsx` ;
- option locale de développement vers l'exemple privé ;
- preview obligatoire avant confirmation ;
- pas d'exposition du chemin privé dans l'interface ;
- import structuré des feuilles :
  - `02_Besoins`
  - `03_Par_logiciel`
  - `04_Manquants`
  - `05_Confirmations`
  - `06_Sources`

Feuilles volontairement non structurées dans cette version :

- `00_Logiciels_source`
- `01_Synthese`

## Flux de validation

Le statut global de l'analyse suit :

1. `Brouillon`
2. `A valider`
3. `Valide`

Actions disponibles :

- `Soumettre pour validation`
- `Valider l'analyse`
- `Rouvrir`

Il n'existe pas encore de restriction de rôle réelle dans le projet. Les actions restent donc visibles tant que l'autorisation n'est pas branchée.

## Audit

Les opérations significatives réutilisent `public.audit_logs`, par exemple :

- sauvegarde d'un besoin ;
- sauvegarde d'une correspondance ;
- sauvegarde d'un manque ;
- sauvegarde d'un point à confirmer ;
- sauvegarde d'une source ;
- soumission ;
- validation ;
- réouverture.

## Point d'intégration IA futur

La future intégration IA devra alimenter les mêmes tables transactionnelles au lieu d'ajouter un second modèle parallèle.

Le workflow attendu plus tard est :

- extraction CDC ;
- génération d'une analyse logiciels structurée ;
- insertion ou mise à jour des mêmes entités ;
- revue commerciale finale sur la même page.

## Limites actuelles

- seule la branche `Logiciels` est fonctionnelle ;
- l'import de test ne gère que le format `.xlsx` connu ;
- les correspondances "possibles" demandent encore une confirmation humaine ;
- les restrictions admin/dev ne sont pas reliées à un vrai système d'authentification ;
- l'import préserve la structure métier, mais ne reconstruit pas encore les liaisons besoin <-> correspondance de manière avancée.
