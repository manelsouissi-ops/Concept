# Benchmark RAG — Marker vs Docling

## Synthèse exécutive

Le benchmark compare les Markdown bruts produits à partir du même CDC, avec des réglages RAG identiques : chunks de 700 tokens, chevauchement de 100, recherche vectorielle top-8, embeddings `qwen3-embedding:0.6b`, génération `qwen3:4b` et distance Cosine.

Sur le run A/B mesuré, **Docling obtient 3 réponses correctes, 1 partielle et 4 échecs**, contre **0 réponse correcte et 8 échecs pour le contrôle Marker du même run**. Ce résultat Marker est toutefois instable : un baseline antérieur, avec le même jeu de questions, avait obtenu **3 réponses correctes, 1 partielle et 4 échecs**. La comparaison ne permet donc pas encore d'attribuer tout l'écart au parseur.

## Résultats par question

| # | Question | Réponse attendue | Résultat Marker — run A/B | Résultat Docling | Citation Marker | Citation Docling |
|---:|---|---|---|---|---|---|
| 1 | Référence officielle ? | `CI-PARU-365151-CS-QCBS/003/2024` | Information non disponible | Information non disponible | Non | Non |
| 2 | Nom du Client ? | UC-PARU | Information non disponible | Information non disponible | Non | Non |
| 3 | Pays du Client ? | Côte d'Ivoire | Information non disponible | Information non disponible | Non | Non |
| 4 | Date d'émission ? | `06/08/2024` | Information non disponible | Information non disponible | Non | Non |
| 5 | Numéro du crédit IDA ? | Crédit IDA N°66860 | Information non disponible | Crédit IDA N°66860 — **correct** | Non | Oui |
| 6 | Méthode de sélection ? | Sélection Fondée sur la Qualité et le Coût (SFQC) | Information non disponible | Sélection Fondée sur la Qualité et le Coût (SFQC) — **correct** | Non | Oui |
| 7 | Délai de la mission ? | 90 jours calendaires, soit 3 mois | Information non disponible | 90 jours calendaire — **partiel** | Non | Oui, validée manuellement¹ |
| 8 | Projet financé ? | Projet d'Assainissement et de Résilience Urbaine (PARU) | Information non disponible | Projet d'Assainissement et de Résilience Urbaine (PARU) — **correct** | Non | Oui |

¹ Le contrôle automatique avait rejeté la citation à cause des variantes « calendaire/calendaires » et « 03/3 mois ». Le chunk cité contient bien « 90 jours calendaire, soit 03 mois ».

## Scores

| Mesure | Marker — run A/B | Marker — baseline antérieur | Docling — run A/B |
|---|---:|---:|---:|
| Réponses correctes | 0/8 | 3/8 | 3/8 |
| Réponses partielles | 0/8 | 1/8 | 1/8 |
| Échecs | 8/8 | 4/8 | 4/8 |
| Citations correctes | 0/8 (0 %) | 4/8 (50 %) | 4/8 (50 %) après contrôle manuel |

Les huit valeurs attendues sont présentes dans les deux Markdown. Les échecs ne proviennent donc pas de données absentes.

La recherche top-8 retrouve une preuve directement exploitable pour 4 questions avec Marker et 5 avec Docling. Les deux parseurs échouent surtout sur le bloc d'identification : référence, client et date. Cela indique que le découpage et la stratégie de retrieval restent le principal problème de qualité. Le comportement différent des deux runs Marker montre également qu'il faut mesurer la stabilité de la génération sur plusieurs répétitions.

## Comparaison technique

| Indicateur mesuré | Marker | Docling |
|---|---:|---:|
| Taille du Markdown | 556 046 octets (0,56 Mo) | 7 104 178 octets (7,10 Mo) |
| Lignes | 3 574 | 3 649 |
| Chunks produits | 193 | 11 098 |
| Chunking | 0,227 s | 21,786 s |
| Embedding + indexation | 6,274 s | 305,695 s |
| Retrieval moyen par question | 0,093 s | 0,100 s |
| Génération groupée des 8 réponses | 1,639 s | 2,564 s |
| Utilisation GPU pendant la conversion Docling | Non mesuré | Non mesuré |

Docling préserve davantage de titres Markdown (344 contre 314) et produit certaines tables plus lisibles. En revanche, son export brut contient **17 images PNG en base64**, représentant **91,97 % du fichier**. Cela explique les 11 098 chunks et le temps d'indexation environ 49 fois supérieur. Il sépare aussi parfois les libellés de leurs valeurs, alors que Marker conserve mieux le bloc d'identification de la page de garde.

## Conclusion et décision proposée

**Docling est le meilleur résultat fonctionnel sur ce run A/B**, avec 3 réponses correctes et 1 partielle, ainsi qu'une légère amélioration du rappel top-8. C'est la principale raison de le considérer : sa structuration en titres et certaines tables offrent une base prometteuse pour les documents complexes.

Le passage à Docling ne doit cependant pas être généralisé dans son état brut. Avant intégration, il faut :

1. exclure les images base64 du texte indexé sans supprimer le texte utile ;
2. répéter chaque benchmark au moins trois fois pour mesurer la stabilité du LLM ;
3. améliorer le retrieval des champs courts de la page de garde ;
4. revalider les citations avec une normalisation robuste des variantes typographiques.

En l'état, la conclusion est **mixte** : Docling gagne sur les réponses du run observé et sur une partie de la structure, tandis que Marker reste nettement plus léger, rapide et propre pour l'indexation brute. Le retrieval demeure le principal chantier commun.
