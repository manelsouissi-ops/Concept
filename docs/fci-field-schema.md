# Schéma Fonctionnel Proposé Pour Les Formulaires FCI

## Principes

- Un **bloc commun** est partage par tous les modules FCI.
- Chaque grande fiche devient un **module web**.
- Les tableaux Word deviennent soit :
  - des **groupes repetables** de lignes
  - des **listes de champs longs**
- Les champs issus du CDC ou de la Fiche CDC sont **pre-remplissables**.
- Les champs de jugement interne restent **editables** et **soumis a revue humaine**.
- Les champs de validation ne doivent pas etre auto-generes.

## Types De Champs Recommandés

| Type | Usage web |
| --- | --- |
| `text` | texte court |
| `textarea` | texte long |
| `date` | date de depot |
| `number` | quantite, volume, delai |
| `percent` | marge, charges, probabilites |
| `currency` | budget, prix cible |
| `boolean` | oui / non |
| `enum` | choix fermes |
| `repeatable_group` | lignes de tableau ajoutables |
| `derived_number` | champ calcule et non saisi directement |
| `person_reference` | prepare par / valide par |

## Bloc Commun

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `common.code_interne` | Reference interne / code dossier | `text` | Identification | requis | yes | yes | no | correspondre au code AO existant | Tous modeles > Identification > ligne 1 |
| `common.intitule_offre` | Intitule de l'offre | `text` | Identification | requis | yes | yes | yes | 5 caracteres min | Tous modeles > Identification > ligne 2 |
| `common.date_depot` | Date de depot | `date` | Identification | requis | yes | yes | yes | date valide | Tous modeles > Identification > ligne 3 |
| `common.prepare_par` | Prepare par | `person_reference` | Identification | requis pour validation finale | no | no | yes | nom ou utilisateur interne obligatoire | Tous modeles > Identification > ligne 4 |
| `common.valide_par` | Valide par | `person_reference` | Identification | requis pour validation finale | no | no | yes | nom ou utilisateur interne obligatoire | Tous modeles > Identification > ligne 5 |

## Module DC - Fiche A

### Groupe répétable `concurrents`

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dc.concurrents[]` | Ligne concurrent | `repeatable_group` | A1 | optionnel au brouillon, au moins 1 ligne pour completion | yes | yes | yes | groupe repetable | `FCI_DC` > A1 |
| `dc.concurrents[].nom` | Nom du concurrent | `text` | A1 | requis si ligne creee | yes | yes | yes | texte non vide | `FCI_DC` > A1 > col 1 |
| `dc.concurrents[].pays` | Pays | `text` | A1 | requis si ligne creee | yes | yes | yes | texte non vide | `FCI_DC` > A1 > col 2 |
| `dc.concurrents[].points_forts_connus` | Points forts connus | `textarea` | A1 | optionnel | possible | yes | yes | 10 caracteres min si renseigne | `FCI_DC` > A1 > col 3 |
| `dc.concurrents[].historique_client` | Historique avec le client | `textarea` | A1 | optionnel | possible | yes | yes | texte libre | `FCI_DC` > A1 > col 4 |
| `dc.concurrents[].avantage_principal` | Avantage principal pour ce CDC | `textarea` | A1 | optionnel | possible | yes | yes | texte libre | `FCI_DC` > A1 > col 5 |
| `dc.concurrents[].risque_represente` | Risque qu'il represente | `textarea` | A1 | optionnel | possible | yes | yes | texte libre | `FCI_DC` > A1 > col 6 |

### A2 Positionnement

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dc.positionnement.avantage_differentiel` | Notre avantage differentiel principal | `textarea` | A2 | requis | possible | yes | yes | 15 caracteres min | `FCI_DC` > A2 > ligne 1 |
| `dc.positionnement.vulnerabilite_principale` | Notre vulnerabilite principale | `textarea` | A2 | requis | possible | yes | yes | 15 caracteres min | `FCI_DC` > A2 > ligne 2 |
| `dc.positionnement.niveau_prix_cible` | Niveau de prix cible estime | `textarea` | A2 | requis | possible | yes | yes | indiquer fourchette et monnaie | `FCI_DC` > A2 > ligne 3 |

### A3 Logistique interne

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dc.logistique.delai_transit_jours` | Delai de transit necessaire | `number` | A3 | optionnel | no | no | yes | entier >= 0 | `FCI_DC` > A3 > ligne 1 |
| `dc.logistique.responsable_depot` | Responsable du depot | `text` | A3 | requis | no | no | yes | texte non vide | `FCI_DC` > A3 > ligne 2 |
| `dc.logistique.representation_locale_existante` | Representation locale existante | `boolean` | A3 | requis | no | no | yes | oui / non | `FCI_DC` > A3 > ligne 3 |
| `dc.logistique.representation_locale_details` | Details representation locale | `textarea` | A3 | conditionnel | no | no | yes | requis si oui | `FCI_DC` > A3 > ligne 3 |
| `dc.logistique.autres_contraintes_internes` | Autres contraintes internes | `textarea` | A3 | optionnel | no | no | yes | seulement si le champ est retenu apres arbitrage | Modele generique > A3 > ligne 4 |

## Module DF - Fiche B

### B1 Eléments financiers internes

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `df.finances.budget_estime_marche` | Budget estime du marche | `currency` | B1 | optionnel | possible | yes | yes | montant positif si renseigne | `FCI_DF` > B1 > ligne 1 |
| `df.finances.budget_estime_source` | Source de l'estimation | `text` | B1 | conditionnel | no | no | yes | requis si budget renseigne | `FCI_DF` > B1 > ligne 1 |
| `df.finances.taux_change` | Taux de change applique | `text` | B1 | optionnel | no | no | yes | format libre + source | `FCI_DF` > B1 > ligne 2 |
| `df.finances.coefficient_charges_structure` | Coefficient de charges de structure | `percent` | B1 | requis | no | no | yes | 0 a 100 | `FCI_DF` > B1 > ligne 3 |
| `df.finances.marge_cible` | Marge cible visee | `percent` | B1 | requis | no | no | yes | 0 a 100 | `FCI_DF` > B1 > ligne 4 |

### Groupe répétable `jalons_cash_flow`

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `df.cash_flow.jalons[]` | Ligne jalon | `repeatable_group` | B2 | optionnel au brouillon, au moins 1 ligne pour completion | yes | yes | yes | groupe repetable | `FCI_DF` > B2 |
| `df.cash_flow.jalons[].jalon_livrable` | Jalon / Livrable | `text` | B2 | requis si ligne creee | yes | yes | yes | texte non vide | `FCI_DF` > B2 > col 1 |
| `df.cash_flow.jalons[].pourcentage_montant` | % du montant | `percent` | B2 | requis si ligne creee | yes | yes | yes | 0 a 100 | `FCI_DF` > B2 > col 2 |
| `df.cash_flow.jalons[].delai_paiement_estime` | Delai de paiement estime | `text` | B2 | optionnel | possible | yes | yes | texte libre ou jours | `FCI_DF` > B2 > col 3 |
| `df.cash_flow.jalons[].risque_cash_flow` | Risque de cash flow | `textarea` | B2 | optionnel | possible | yes | yes | texte libre | `FCI_DF` > B2 > col 4 |

### B3 Synthèse

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `df.synthese.commentaires_generaux` | Commentaires financiers generaux | `textarea` | B3 | requis | possible | yes | yes | 20 caracteres min | `FCI_DF` > B3 |

## Module DG - Fiche D

### D1 Valeur stratégique

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dg.strategie.programme_pluriannuel` | Inscription dans un programme pluriannuel | `boolean` | D1 | requis | possible | yes | yes | oui / non | `FCI_DG` > D1 > ligne 1 |
| `dg.strategie.programme_pluriannuel_details` | Valeur des futures phases | `textarea` | D1 | conditionnel | possible | yes | yes | requis si oui | `FCI_DG` > D1 > ligne 1 |
| `dg.strategie.valeur_futurs_lots` | Valeur estimee des futurs lots | `textarea` | D1 | optionnel | possible | yes | yes | texte libre | `FCI_DG` > D1 > ligne 2 |
| `dg.strategie.positionnement_geographique` | Positionnement geographique vise | `textarea` | D1 | requis | possible | yes | yes | 10 caracteres min | `FCI_DG` > D1 > ligne 3 |
| `dg.strategie.valeur_reference` | Valeur comme reference | `textarea` | D1 | requis | possible | yes | yes | 10 caracteres min | `FCI_DG` > D1 > ligne 4 |

### D2 Enjeux réputationnels

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dg.reputation.risque_sous_performance` | Risque en cas de sous-performance | `textarea` | D2 | requis | possible | yes | yes | 10 caracteres min | `FCI_DG` > D2 > ligne 1 |
| `dg.reputation.risque_perte` | Risque en cas de perte | `textarea` | D2 | requis | possible | yes | yes | 10 caracteres min | `FCI_DG` > D2 > ligne 2 |
| `dg.reputation.valeur_test_apprentissage` | Valeur de test ou d'apprentissage | `textarea` | D2 | optionnel | possible | yes | yes | texte libre | `FCI_DG` > D2 > ligne 3 |

### D3 Décision stratégique préliminaire

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dg.decision.importance_strategique_globale` | Importance strategique globale | `enum` | D3 | requis | possible | yes | yes | `faible,moyenne,haute,critique` | `FCI_DG` > D3 > ligne 1 |
| `dg.decision.marche_prioritaire_direction` | Marche prioritaire pour la direction | `enum` | D3 | requis | no | no | yes | `oui,non,sous_conditions` | `FCI_DG` > D3 > ligne 2 |
| `dg.decision.marche_prioritaire_conditions` | Conditions de priorisation | `textarea` | D3 | conditionnel | no | no | yes | requis si `sous_conditions` | `FCI_DG` > D3 > ligne 2 |
| `dg.decision.commentaires_strategiques` | Commentaires strategiques de la DG | `textarea` | D3 | requis | no | no | yes | 20 caracteres min | `FCI_DG` > D3 > ligne 3 |

## Module DO - Fiche C

### Groupe répétable `experts_cles`

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `do.ressources.experts_cles[]` | Ligne expert cle | `repeatable_group` | C1 | optionnel au brouillon, au moins 1 ligne pour completion | yes | yes | yes | groupe repetable | `FCI_DO` > C1 |
| `do.ressources.experts_cles[].poste_expert` | Poste / Expert | `text` | C1 | requis si ligne creee | yes | yes | yes | texte non vide | `FCI_DO` > C1 > col 1 |
| `do.ressources.experts_cles[].volume_demande_cdc` | Volume de travail demande par le CDC | `number` | C1 | optionnel | yes | yes | yes | nombre >= 0 | `FCI_DO` > C1 > col 2 |
| `do.ressources.experts_cles[].volume_reel_previsionnel` | Volume de travail reel previsionnel | `number` | C1 | requis | no | no | yes | nombre >= 0 | `FCI_DO` > C1 > col 3 |
| `do.ressources.experts_cles[].suppleant` | Suppleant | `text` | C1 | optionnel | no | no | yes | texte libre | `FCI_DO` > C1 > col 4 |
| `do.ressources.experts_cles[].volume_previsionnel_suppleant` | Volume de travail previsionnel du suppleant | `number` | C1 | optionnel | no | no | yes | nombre >= 0 | `FCI_DO` > C1 > col 5 |
| `do.ressources.experts_cles[].probabilite_disponibilite` | Probabilite de disponibilite | `enum` | C1 | requis | possible | yes | yes | `faible,moyenne,elevee,a_confirmer` recommande | `FCI_DO` > C1 > col 6 |
| `do.ressources.experts_cles[].action_requise` | Action requise | `textarea` | C1 | optionnel | possible | yes | yes | texte libre | `FCI_DO` > C1 > col 7 |

### Groupe répétable `experts_non_cles`

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `do.ressources.experts_non_cles[]` | Ligne expert non cle | `repeatable_group` | C2 | optionnel | yes | yes | yes | groupe repetable | `FCI_DO` > C2 |
| `do.ressources.experts_non_cles[].poste_expert` | Poste / Expert | `text` | C2 | requis si ligne creee | yes | yes | yes | texte non vide | `FCI_DO` > C2 > col 1 |
| `do.ressources.experts_non_cles[].volume_previsionnel` | Volume de travail reel previsionnel | `number` | C2 | optionnel | possible | yes | yes | nombre >= 0 | `FCI_DO` > C2 > col 2 |
| `do.ressources.experts_non_cles[].probabilite_disponibilite` | Probabilite de disponibilite | `enum` | C2 | requis si ligne creee | possible | yes | yes | enum a confirmer | `FCI_DO` > C2 > col 3 |
| `do.ressources.experts_non_cles[].action_requise` | Action requise | `textarea` | C2 | optionnel | possible | yes | yes | texte libre | `FCI_DO` > C2 > col 4 |

### Groupe répétable `moyens_capacite`

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `do.capacite.moyens[]` | Ligne moyen | `repeatable_group` | C3 | optionnel | possible | yes | yes | groupe repetable | `FCI_DO` > C3 |
| `do.capacite.moyens[].designation` | Designation du moyen | `text` | C3 | requis si ligne creee | possible | yes | yes | texte non vide | `FCI_DO` > C3 > col 1 |
| `do.capacite.moyens[].quantite_requise` | Quantite requise | `number` | C3 | requis si ligne creee | possible | yes | yes | entier >= 0 | `FCI_DO` > C3 > col 2 |
| `do.capacite.moyens[].quantite_disponible` | Quantite disponible | `number` | C3 | requis si ligne creee | no | no | yes | entier >= 0 | `FCI_DO` > C3 > col 3 |
| `do.capacite.moyens[].membre_apporteur` | Membre du groupement qui l'apporte | `text` | C3 | optionnel | no | no | yes | texte libre | `FCI_DO` > C3 > col 4 |
| `do.capacite.moyens[].disponible_demarrage` | Disponible au demarrage | `boolean` | C3 | requis si ligne creee | no | no | yes | oui / non | `FCI_DO` > C3 > col 5 |
| `do.capacite.moyens[].ecart` | Ecart requise moins disponible | `derived_number` | C3 | derive | no | yes | no | calcul automatique | `FCI_DO` > C3 > col 6 |

### Groupe répétable `composantes_techniques`

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `do.roles.composantes[]` | Ligne composante | `repeatable_group` | C4 | optionnel | yes | yes | yes | groupe repetable | `FCI_DO` > C4 |
| `do.roles.composantes[].composante_tache` | Composante / Tache | `text` | C4 | requis si ligne creee | yes | yes | yes | texte non vide | `FCI_DO` > C4 > col 1 |
| `do.roles.composantes[].membre_responsable` | Membre responsable | `text` | C4 | requis si ligne creee | possible | yes | yes | texte non vide | `FCI_DO` > C4 > col 2 |
| `do.roles.composantes[].experts_affectes` | Experts affectes | `textarea` | C4 | optionnel | possible | yes | yes | texte libre | `FCI_DO` > C4 > col 3 |
| `do.roles.composantes[].effort_client_vs_concept` | Effort estime client vs effort estime Concept | `textarea` | C4 | optionnel | possible | yes | yes | format a confirmer | `FCI_DO` > C4 > col 4 |
| `do.roles.composantes[].commentaire_risque` | Commentaire / Risque | `textarea` | C4 | optionnel | possible | yes | yes | texte libre | `FCI_DO` > C4 > col 5 |

### C5 Risques de coordination

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `do.risques.partenaires_non_eprouves` | Partenaires non encore eprouves | `textarea` | C5 | optionnel | no | no | yes | texte libre | `FCI_DO` > C5 > ligne 1 |
| `do.risques.frequence_reunions_coordination` | Frequence des reunions de coordination | `text` | C5 | optionnel | no | no | yes | texte libre | `FCI_DO` > C5 > ligne 2 |
| `do.risques.penalites_internes_groupement` | Risque de penalites internes au groupement | `textarea` | C5 | optionnel | no | no | yes | texte libre | `FCI_DO` > C5 > ligne 3 |
| `do.risques.controle_qualite_livrables` | Controle qualite des livrables partenaires | `textarea` | C5 | requis | no | no | yes | 10 caracteres min | `FCI_DO` > C5 > ligne 4 |
| `do.risques.risques_vis_a_vis_partenaires` | Risques vis-a-vis des partenaires | `textarea` | C5 | optionnel | no | no | yes | texte libre | `FCI_DO` > C5 > ligne 5 |
| `do.risques.risques_consultants_externes` | Risques vis-a-vis des consultants externes | `textarea` | C5 | optionnel | no | no | yes | texte libre | `FCI_DO` > C5 > ligne 6 |

## Module DO - Fiche E Retour D'Expérience

### E1 Projet de référence

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `do.rex.projet_reference.identite` | Nom et reference du projet similaire | `text` | E1 | requis | possible | yes | yes | texte non vide | `FCI_DO` > E1 > ligne 1 |
| `do.rex.projet_reference.niveau_similitude` | Niveau et type de similitude | `enum` | E1 | requis | possible | yes | yes | `tres_similaire,similaire,partiel` | `FCI_DO` > E1 > ligne 2 |
| `do.rex.projet_reference.differences_cles` | Differences cles a noter | `textarea` | E1 | requis | possible | yes | yes | 10 caracteres min | `FCI_DO` > E1 > ligne 3 |

### E2 Ecarts coûts

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `do.rex.ecarts_couts.postes_sous_estimes` | Postes de couts sous-estimes | `textarea` | E2 | optionnel | possible | yes | yes | texte libre | `FCI_DO` > E2 > ligne 1 |
| `do.rex.ecarts_couts.postes_surestimes` | Postes de couts surestimes | `textarea` | E2 | optionnel | possible | yes | yes | texte libre | `FCI_DO` > E2 > ligne 2 |
| `do.rex.ecarts_couts.depassement_budgetaire` | Depassement budgetaire global constate | `textarea` | E2 | optionnel | possible | yes | yes | pourcentage + causes si renseigne | `FCI_DO` > E2 > ligne 3 |

### E3 Standards et habitudes du client

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `do.rex.standards_client.standards_techniques` | Standards techniques du pays ou client | `textarea` | E3 | requis | no | no | yes | expertise humaine obligatoire | `FCI_DO` > E3 > ligne 1 |
| `do.rex.standards_client.habitudes_validation` | Habitudes de validation des livrables | `textarea` | E3 | requis | no | no | yes | expertise humaine obligatoire | `FCI_DO` > E3 > ligne 2 |
| `do.rex.standards_client.risque_methodologie_non_adaptee` | Risque de methodologie non adaptee | `textarea` | E3 | requis | no | no | yes | expertise humaine obligatoire | `FCI_DO` > E3 > ligne 3 |

### E4 Recommandations pour cette offre

| Field key | Libellé | Type | Section | Requis / optionnel | AI pre-fill | Revue humaine | Editable | Règles de validation | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `do.rex.recommandations.ajustements_dimensionnement` | Ajustements sur le dimensionnement | `textarea` | E4 | requis | no | no | yes | expertise humaine obligatoire | `FCI_DO` > E4 > ligne 1 |
| `do.rex.recommandations.points_vigilance_prioritaires` | Points de vigilance prioritaires | `textarea` | E4 | requis | no | no | yes | 3 points attendus idealement | `FCI_DO` > E4 > ligne 2 |
| `do.rex.recommandations.bonnes_pratiques` | Bonnes pratiques a reproduire | `textarea` | E4 | requis | no | no | yes | expertise humaine obligatoire | `FCI_DO` > E4 > ligne 3 |

## Schéma Du Modèle Générique

Le modele generique ne doit pas introduire un deuxieme schema de donnees. Il doit reutiliser :

- `common.*`
- `dc.*`
- `df.*`
- `do.*`
- `dg.*`

Et ajouter uniquement deux ensembles meta :

| Field key | Libellé | Type | Usage |
| --- | --- | --- | --- |
| `generic.included_sections[]` | Fiches incluses | `repeatable_group` | pilotage de completude documentaire |
| `generic.included_sections[].validated` | Validee | `boolean` | coche documentaire / workflow de validation |

## Règles Transverses Recommandées

1. Tous les champs `▸CDC` doivent conserver la trace de leur source.
2. Tous les champs AI-prefill doivent afficher :
   - valeur proposee
   - indicateur `Pre-rempli`
   - etat `A verifier`
3. Les champs marques expertise humaine doivent rester vides tant qu'un utilisateur ne les complete pas.
4. Les tableaux repetables doivent autoriser :
   - ajout manuel
   - suppression
   - reordonnancement si necessaire
5. Les validations doivent distinguer :
   - **brouillon** : peu bloquant
   - **pret pour validation** : completude forte

## Points A Confirmer Avant Implémentation

- enum officiel de probabilite de disponibilite
- format attendu du champ `effort estime client vs Concept`
- maintien ou retrait du champ `Autres contraintes internes`
- interpretation fonctionnelle des cases `Validee` du modele generique
