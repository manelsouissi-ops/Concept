# Audit Des Modèles FCI

## Portée

Audit documentaire des cinq modèles Word suivants, sans modification de la plateforme :

- `ai/templates/fci/FCI_DC.docx`
- `ai/templates/fci/FCI_DF.docx`
- `ai/templates/fci/FCI_DG.docx`
- `ai/templates/fci/FCI_DO.docx`
- `ai/templates/fci/FCI_modele_generique version 4 final.docx`

## Méthode

- Lecture structurelle OOXML des paragraphes, titres, tableaux, en-têtes et pieds de page.
- Contrôle de présence des zones de formulaire avancées : aucun content control Word n'a ete detecte.
- Tentative de rendu visuel via le skill documents : non exploitable localement car `pdf2image` n'est pas disponible dans l'environnement courant. Le present audit repose donc sur la structure OOXML et le texte embarque.

## Résumé Des 5 Modèles

| Modèle | Rôle constaté | Sections métier | Particularités |
| --- | --- | --- | --- |
| `FCI_DC.docx` | Fiche departementale DC | Fiche A seulement | Veille concurrentielle + logistique interne de depot |
| `FCI_DF.docx` | Fiche departementale DF | Fiche B seulement | Analyse financiere preliminaire |
| `FCI_DG.docx` | Fiche departementale DG | Fiche D seulement | Positionnement strategique long terme |
| `FCI_DO.docx` | Fiche departementale DO | Fiches C et E | Ressources + partage des roles + retour d'experience |
| `FCI_modele_generique version 4 final.docx` | Modele consolide | Identification + A + B + C + D + E + tableau de suivi | Sert de reference de composition globale |

## Structure Commune A Tous Les Modèles

Les cinq fichiers partagent le meme bloc d'ouverture :

1. Titre FCI
2. Sous-titre : preparation de l'analyse SWOT et de la decision Go / No Go
3. Instruction centrale :
   - ne pas ressaisir les informations deja presentes dans le dossier AO
   - recopier certains elements signales par `▸CDC`
4. Bloc `Identification de l'opportunite`
5. Tableau d'identification commun :
   - reference interne / code dossier
   - intitule de l'offre
   - date de depot
   - prepare par
   - valide par

Ce bloc commun devra devenir un composant unique reutilisable dans le futur formulaire web.

## Détail Par Modèle

### 1. `FCI_DC.docx`

**Titre du document**

- `FICHE CONTEXTE INTERNE (FCI-DC)`

**Sections**

- Identification de l'opportunite
- `FICHE A. Veille concurrentielle, logistique du depot et Logistique interne du depot`
- `A1. Concurrents et premiere lecture`
- `A2. Positionnement de notre offre`
- `A3. Points logistiques internes`

**Sous-sections et consignes**

- Consigne concurrentielle :
  `Les noms et pays des concurrents figurent dans la liste restreinte... Recopie-les, puis renseigne l'analyse interne.`
- Consigne logistique :
  le mode de depot, le lieu, la date limite, la langue, les exemplaires et les pieces administratives doivent etre lus dans le CDC et non ressaisis.

**Tableaux**

- Tableau d'identification : 5 lignes, 2 colonnes
- Tableau A1 : 6 colonnes
  - Nom du concurrent
  - Pays
  - Points forts connus
  - Historique avec le client
  - Avantage principal pour ce CDC
  - Risque qu'il represente
- Tableau A2 : 3 lignes de champs longs
- Tableau A3 : 3 lignes de champs longs

**Types de champs observes**

- Texte libre
- Oui / Non dans `Representation locale existante`
- Date dans `Date de depot`

**Calculs / scoring**

- Aucun scoring explicite
- Aucun total

**Validation / signature**

- `Prepare par`
- `Valide par`

### 2. `FCI_DF.docx`

**Titre du document**

- `FICHE CONTEXTE INTERNE (FCI)`

**Sections**

- Identification de l'opportunite
- `FICHE B. Analyse financiere preliminaire`
- `B1. Elements financiers internes`
- `B2. Cash flow par jalon`
- `B3. Synthese`

**Consignes**

- Ne pas ressaisir monnaie, type de contrat, revision de prix, fiscalite, echeancier de paiement, cautions.

**Tableaux**

- Tableau d'identification
- Tableau B1 : 4 lignes de champs
- Tableau B2 : 4 colonnes
  - Jalon / Livrable
  - `% du montant`
  - Delai de paiement estime
  - Risque de cash flow
- Tableau B3 : commentaire general

**Types de champs observes**

- Montants
- Pourcentages
- Source / justification
- Delais
- Commentaires de risque

**Calculs / scoring**

- Pas de formule Excel integree
- Plusieurs valeurs sont candidates a un calcul web :
  - coefficient de charges de structure
  - marge cible
  - lecture risque de cash flow par jalon

**Validation / signature**

- `Prepare par`
- `Valide par`

### 3. `FCI_DG.docx`

**Titre du document**

- `FICHE CONTEXTE INTERNE (FCI-DG)`

**Sections**

- Identification de l'opportunite
- `FICHE D. Positionnement strategique long terme`
- `D1. Contexte programme et valeur strategique`
- `D2. Enjeux reputationnels`
- `D3. Decision strategique preliminaire`

**Tableaux**

- Tableau d'identification
- Tableau D1 : 4 lignes
- Tableau D2 : 3 lignes
- Tableau D3 : 3 lignes

**Choix / enums visibles**

- `Oui / Non`
- `Faible / Moyenne / Haute / Critique`
- `Oui / Non / Sous conditions`

**Champs metier dominants**

- valeur strategique
- positionnement geographique
- risque reputionnel
- priorite direction
- commentaire DG

**Calculs / scoring**

- Aucun calcul numerique explicite
- Evaluation strategique plutot qualitative

**Validation / signature**

- `Prepare par`
- `Valide par`

### 4. `FCI_DO.docx`

**Titre du document**

- `FICHE CONTEXTE INTERNE (FCI-DO)`

**Sections**

- Identification de l'opportunite
- `FICHE C. Disponibilite des ressources et partage des roles du groupement`
- `C1. Disponibilite des experts cles`
- `C2. Disponibilite des experts non cles`
- `C3. Capacite d'absorption globale`
- `C4. Repartition des composantes techniques`
- `C5. Risques de coordination et mitigation`
- `FICHE E. Retour d'experience sur projets similaires`
- `E1. Projet de reference`
- `E2. Ecarts entre offre initiale et couts reels`
- `E3. Standards et habitudes du client`
- `E4. Recommandations pour cette offre`

**Consignes et notes fortes**

- Si le volume de travail n'est pas disponible dans le CDC :
  - regarder des projets similaires
  - benchmarker par rapport a la duree totale du projet
  - multiplier par 3 a 4 pour les experts cles
- `C4` indique explicitement une extraction de taches a partir du CDC `en utilisant l'IA`
- `E3` et `E4` sont explicitement `rempli manuellement a partir d'expertise humaine`

**Tableaux**

- C1 : 7 colonnes
- C2 : 4 colonnes
- C3 : 6 colonnes
- C4 : 5 colonnes + ligne d'instruction
- C5 : 6 lignes de champs
- E1 a E4 : tableaux de 3 lignes de champs chacun

**Types de champs observes**

- Effectifs / volumes
- Probabilite de disponibilite
- Actions de mitigation
- Quantites et ecarts
- Oui / Non
- Commentaires de risque
- Retour d'experience narratif

**Calculs / scoring**

- `Ecart = Quantite requise - Quantite disponible`
- Benchmark manuel des volumes
- Pas de score global automatique dans le modele

**Validation / signature**

- `Prepare par`
- `Valide par`

### 5. `FCI_modele_generique version 4 final.docx`

**Titre du document**

- `FICHE CONTEXTE INTERNE (FCI)`

**Structure supplementaire**

- Bloc d'identification commun
- Tableau `Fiches incluses dans ce document`
- Consolidation des fiches A a E dans un seul fichier

**Tableau de suivi inclus**

Colonnes :

- Fiche
- Titre
- Responsable
- Validee

Lignes observees :

- A : Veille concurrentielle / DC
- A : Logistique interne du depot / DC
- B : Analyse financiere preliminaire / DF
- D : Disponibilite des ressources / DO
- D : Partage des roles groupement / DO
- E : Positionnement strategique / DG
- F : Retour d'experience / DO avec responsable de la division concernee

**Point important**

Les lettres du tableau de suivi ne correspondent pas parfaitement aux lettres des sections internes :

- la section `Disponibilite des ressources` est `FICHE C` dans le corps
- la section `Positionnement strategique` est `FICHE D` dans le corps
- la section `Retour d'experience` est `FICHE E` dans le corps
- mais le tableau de suivi parle de `D`, `E`, `F`

Cette incoherence doit etre validee avant implementation.

## Comparaison Avec Le Modèle Générique

### `FCI_DC` vs générique

**Couverture**

- `FCI_DC` reprend la `FICHE A` du modele generique.

**Differences**

- Le generique contient un champ supplementaire dans `A3` :
  - `Autres contraintes internes`
- Ce champ n'apparait pas dans `FCI_DC.docx`.

**Conclusion**

- `FCI_DC` n'est pas une copie parfaite du generique.
- Le schema web devra conserver `Autres contraintes internes` seulement apres arbitrage metier.

### `FCI_DF` vs générique

**Couverture**

- `FCI_DF` reprend la `FICHE B`.

**Differences observees**

- Pas de difference de structure metier notable.
- Le titre du document n'inclut pas le suffixe departemental `-DF`, contrairement a `FCI-DC`, `FCI-DG`, `FCI-DO`.

### `FCI_DG` vs générique

**Couverture**

- `FCI_DG` reprend la `FICHE D` du corps du modele generique.

**Differences observees**

- Pas de difference de structure notable.
- L'incoherence porte surtout sur la lettre de suivi dans le tableau generique, pas sur la fiche elle-meme.

### `FCI_DO` vs générique

**Couverture**

- `FCI_DO` fusionne la `FICHE C` et la `FICHE E` du corps du modele generique.

**Differences observees**

- Pas de difference metier majeure detectee sur les champs.
- La responsabilite `DO avec responsable de la division concernee` n'apparait que dans le tableau de suivi du generique, pas dans le document departemental lui-meme.

## Champs Communs Partagés

### Bloc d'identification

- Reference interne / code dossier
- Intitule de l'offre
- Date de depot
- Prepare par
- Valide par

### Meta-regles communes

- Les donnees `▸CDC` sont candidates a une pre-alimentation depuis la Fiche CDC ou le dossier AO.
- Les analyses internes restent a relire et valider par le responsable departemental.
- La validation humaine est implicite dans tous les modeles.

## Champs Spécifiques Par Département

### DC

- concurrents
- positionnement concurrentiel
- vulnérabilite de l'offre
- prix cible estime
- logistique interne du depot

### DF

- budget estime
- change
- charges de structure
- marge cible
- cash flow par jalon

### DG

- valeur strategique long terme
- risque reputionnel
- priorite de direction

### DO

- disponibilite experts cles
- disponibilite experts non cles
- moyens et capacite d'absorption
- repartition des roles du groupement
- risques de coordination
- retour d'experience sur projets similaires

## Champs Dupliqués Ou Redondants

- Bloc d'identification dans tous les documents
- `Prepare par` et `Valide par`
- Champs `▸CDC` recopies dans plusieurs fiches
- Les notions de risque apparaissent dans toutes les fiches mais avec des angles differents

## Champs Destinés A L'IA

### Clairement AI-fillables

- Recopie des champs `▸CDC`
- Liste initiale des concurrents et pays
- Proposition initiale des composantes / taches en `C4`
- Premiere synthese des risques recurrentiels ou de cash flow
- Recherche de projets similaires a partir d'une future base historique

### AI-fillables mais obligatoirement éditables

- Points forts connus
- Historique avec le client
- Avantage principal
- Risques de cash flow
- Probabilite de disponibilite
- Commentaires / risques
- Differences cles entre projet courant et projet similaire

## Champs Clairement Humains

- `Prepare par`
- `Valide par`
- Commentaires strategiques de la DG
- `E3. Standards et habitudes du client`
- `E4. Recommandations pour cette offre`
- Arbitrages `Go / No Go`
- Toute justification engageant la direction

## Champs Qui Ne Doivent Pas Etre Générés Automatiquement

- Validation finale departementale
- Signature / approbation
- Priorisation definitive direction
- Informations sensibles non presentes dans le dossier source
- Tout commentaire explicitement note comme `rempli manuellement a partir d'expertise humaine`

## Ambiguïtés A Faire Valider Par Un Responsable

1. **Lettrage du modele generique**
   - tableau de suivi A / B / D / E / F
   - corps du document A / B / C / D / E

2. **Propriete du retour d'experience**
   - DO seul
   - DO + responsable de division
   - ou futur module knowledge base distinct

3. **Champ `Autres contraintes internes`**
   - present dans le generique
   - absent du DC departemental

4. **Probabilite de disponibilite**
   - aucune echelle definie
   - necessite un enum web stable

5. **Effort estime client vs effort estime Concept**
   - une cellule de comparaison est prevue
   - le format exact n'est pas impose

6. **Gestion des cases `Validee` du tableau generique**
   - simple case de suivi documentaire
   - ou vrai etat de workflow departemental

7. **Champ `Marche prioritaire pour la direction`**
   - le sens de `Sous conditions` doit etre explicite dans le formulaire

## Ordre D'Implémentation Recommandé

1. Bloc commun d'identification FCI
2. Module DC
3. Module DF
4. Module DG
5. Module DO section C
6. Module DO section E
7. Ecran de suivi consolide du modele generique
8. Export Word final par departement
9. Export Word consolide

## Conclusion

Les cinq DOCX sont suffisamment structures pour etre transformes en formulaires web par sections et tableaux repetables. Le point de vigilance principal n'est pas technique mais metier :

- le lettrage incoherent du modele generique
- la repartition de responsabilite DO / DG / division concernee
- la frontiere entre pre-remplissage IA, copie CDC et saisie humaine obligatoire
