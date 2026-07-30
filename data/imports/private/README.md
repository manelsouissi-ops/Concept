# Fichiers d'import confidentiels

Ce dossier contient des fichiers internes et confidentiels de l'entreprise.

Ils ne doivent pas etre commites dans Git ni envoyes sur GitHub.

Ces fichiers sont actuellement uniquement des fichiers locaux de reference et d'import.

Ils ne sont pas utilises par l'application au runtime pour le moment.

Plus tard, le catalogue des logiciels pourra etre importe dans PostgreSQL.

Les deux fichiers de resultats d'analyse serviront de references fonctionnelles pour un futur module d'analyse IA.

## Emplacement attendu

| Type de fichier | Dossier |
| --- | --- |
| Liste des logiciels techniques | `referentiels/` |
| Resultat d'analyse des logiciels | `exemples-analyse/` |
| Resultat d'analyse des competences | `exemples-analyse/` |

## Arborescence

- `referentiels/`
  Le catalogue des logiciels techniques doit etre place ici.
- `exemples-analyse/`
  Les exemples de resultats d'analyse des logiciels et des competences doivent etre places ici.

## Exemples de fichiers attendus

- `referentiels/logiciels-techniques.xlsx`
- `exemples-analyse/exemple-analyse-logiciels.xlsx`
- `exemples-analyse/exemple-analyse-competences.xls`
