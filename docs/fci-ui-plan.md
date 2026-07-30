# Plan D'Interface Pour Les Futurs Formulaires FCI

## Objectif UX

Transformer les cinq modeles Word FCI en une experience web :

- plus simple a remplir
- compatible avec pre-remplissage IA
- lisible pour chaque responsable departemental
- exportable ensuite vers Word

Sans changer pour l'instant :

- la base de donnees
- les APIs
- les workflows n8n
- le schema applicatif existant

## Principes D'Interface

1. Un **espace FCI unique** par appel d'offres
2. Un **bloc source Fiche CDC** visible en haut
3. Un **module par fiche departementale**
4. Une **logique brouillon -> revue -> validation**
5. Des **badges de provenance** sur les champs pre-remplis

## Structure Générale Recommandée

### En-tête FCI

- Titre : `Fiches Contexte Interne`
- Sous-titre : `Preparation de l'analyse SWOT et de la decision Go / No Go`
- Meta source :
  - code dossier
  - version de la Fiche CDC
  - date de derniere mise a jour
  - etat global

### Barre de progression globale

Afficher :

- nombre de modules completes
- modules a completer
- modules en attente de validation
- modules bloques

Exemple d'etapes :

1. Identification commune
2. DC
3. DF
4. DO
5. DG
6. Export final

## Ordre D'Affichage Recommandé

1. Bloc commun `Identification`
2. Module `DC`
3. Module `DF`
4. Module `DO - Ressources`
5. Module `DO - Retour d'experience`
6. Module `DG`
7. Synthese de validation
8. Telechargements

Cet ordre suit une logique de travail :

- informations dossier
- lecture marche
- faisabilite financiere
- faisabilite operationnelle
- apprentissage historique
- arbitrage strategique

## Layout Recommandé Par Module

### Pattern standard

Chaque module doit utiliser la meme structure :

1. En-tete de module
2. Resume d'etat
3. Sections internes
4. Actions de sauvegarde
5. Validation du module

### En-tête de module

Afficher :

- nom de la fiche
- responsable attendu
- statut
- date de derniere modification
- source principale

### Resume d'etat

Contenu propose :

- `Pre-rempli par IA : X champs`
- `A completer : Y champs`
- `Commentaires requis : Z`

## Badges Et Indicateurs

### Badge `Pré-rempli`

Pour les champs issus du CDC, de la Fiche CDC ou d'une suggestion IA.

### Badge `À compléter`

Pour les champs encore vides et consideres necessaires a la completion.

### Badge `Saisie manuelle`

Pour les zones explicitement reservees a l'expertise humaine.

### Badge `À valider`

Pour les champs modifies depuis la derniere validation.

## Comportement De Sauvegarde

### Brouillon

- sauvegarde manuelle par section
- sauvegarde globale de module
- pas de validation bloquante forte

### Validation de completion

Avant de marquer un module `pret a valider`, verifier :

- bloc commun complet
- champs obligatoires du module renseignes
- groupes repetables minimaux renseignes
- commentaires humains obligatoires presents

### Validation finale

- le responsable departemental valide le module
- `Valide par` devient obligatoire
- horodatage de validation

## Plan Par Module

### Module DC

**Ordre de sections**

1. Concurrents et premiere lecture
2. Positionnement de notre offre
3. Points logistiques internes

**UI recommandée**

- Tableau editable pour `Concurrents`
- Deux grands champs de synthese pour `Positionnement`
- Carte compacte pour `Logistique`

### Module DF

**Ordre de sections**

1. Elements financiers internes
2. Cash flow par jalon
3. Synthese

**UI recommandée**

- Formulaire vertical pour B1
- Tableau repetable pour `Cash flow par jalon`
- Zone de synthese large en bas

### Module DO - Ressources

**Ordre de sections**

1. Experts cles
2. Experts non cles
3. Capacite d'absorption globale
4. Repartition des composantes techniques
5. Risques de coordination

**UI recommandée**

- Tableaux repetables avec ajout de ligne
- Calcul automatique de l'ecart sur les moyens
- Aides contextuelles pour les estimations si CDC incomplet

### Module DO - Retour d'expérience

**Ordre de sections**

1. Projet de reference
2. Ecarts entre offre et couts reels
3. Standards et habitudes du client
4. Recommandations pour cette offre

**UI recommandée**

- Champs longs et lisibles
- Mise en avant des zones `expertise humaine`
- Pas de generation automatique sur E3 / E4

### Module DG

**Ordre de sections**

1. Contexte programme et valeur strategique
2. Enjeux reputationnels
3. Decision strategique preliminaire

**UI recommandée**

- Cartes verticales de decision
- Enums visuels pour l'importance strategique
- Champ conditionnel pour `Sous conditions`

## Composants De Tableau Recommandés

### Concurrents

- table large desktop
- cartes compactes mobile

### Jalon cash flow

- colonnes courtes
- badge de risque par ligne

### Experts et moyens

- ligne ajoutable
- duplication rapide
- colonne derivee `Ecart` en lecture seule

### Composantes techniques

- support du pre-remplissage IA
- badge `A verifier` sur les lignes suggerees

## Comportement Des Champs IA

Pour chaque champ AI-fillable :

- afficher la valeur proposee
- afficher la source
- autoriser la modification
- permettre `Accepter`, `Modifier`, `Vider`

Pour chaque groupe repetable AI-fillable :

- possibilite d'accepter ligne par ligne
- possibilite d'ajouter une ligne manuelle
- possibilite de supprimer une suggestion

## Validation Et Complétude

### Indicateur par section

- `Complete`
- `Partielle`
- `A completer`

### Indicateur par module

- `Brouillon`
- `Pret pour validation`
- `Valide`

### Règles de complétude recommandées

- au moins une ligne pertinente dans chaque tableau central
- toutes les questions de decision renseignees
- toutes les zones `expertise humaine obligatoire` renseignees

## Téléchargements Finaux

### Boutons recommandés

- `Telecharger la fiche departementale`
- `Telecharger la FCI consolidee`
- `Exporter en Word`

### Conditions

- export departemental possible des qu'un module est valide
- export consolide possible quand tous les modules requis sont valides

## Ambiguïtés UX A Arbitrer

1. Faut-il separer `DO - Ressources` et `DO - Retour d'experience` en deux onglets ou un seul grand module ?
2. Le tableau generique `Fiches incluses` doit-il rester visible aux utilisateurs ou devenir un etat systeme ?
3. Le champ `Autres contraintes internes` doit-il etre expose dans DC ?
4. Le workflow final doit-il valider chaque module separement ou seulement la FCI consolidee ?

## Ordre D'Implémentation Recommandé

1. Ecran FCI global + bloc commun
2. Module DC
3. Module DF
4. Module DG
5. Module DO Ressources
6. Module DO Retour d'experience
7. Validation transversale
8. Export Word departemental
9. Export Word consolide

## Résultat Attendu

Le futur ecran ne doit pas ressembler a une simple transcription des tableaux Word.

Il doit devenir :

- un espace de travail web par module
- avec pre-remplissage intelligent
- revision humaine claire
- sauvegarde brouillon
- validation metier
- et export Word final conforme aux modeles sources
