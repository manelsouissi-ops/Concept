# Frontend Redesign Plan

## Problèmes actuels

- L'application utilise encore une mise en page de type landing page avec un grand hero, beaucoup d'espace vide et une navigation haute très arrondie.
- La navigation principale n'installe pas un cadre d'application interne durable avec sidebar, topbar, breadcrumb et actions contextuelles.
- La page `/appels-offres` ressemble davantage à une vitrine qu'à un écran métier dense avec filtres, vue tableau et informations de pilotage.
- La page `/appels-offres/nouveau` expose un formulaire fonctionnel, mais pas encore un parcours de saisie professionnel avec résumé latéral et zone d'import plus claire.
- La page `/appels-offres/[code]` centralise déjà plusieurs éléments utiles, mais reste structurée comme une succession de sections simples au lieu d'un workspace métier à onglets.
- La route `/fiche/[code]` contient une logique métier précieuse et doit être conservée, mais son intégration visuelle reste trop proche du style historique.
- Certaines informations demandées par la cible produit ne sont pas encore supportées par le backend actuel, notamment `priorité`, `responsable commercial`, `annexes`, `FCI` et les référentiels métiers.

## Routes à faire évoluer

- `/` : redirection vers `/dashboard`.
- `/dashboard` : nouvelle page opérationnelle avec KPIs, actions requises, activité récente et appels d'offres récents.
- `/appels-offres` : refonte en liste métier avec toolbar, vue tableau / cartes et état vide propre.
- `/appels-offres/nouveau` : refonte en formulaire bi-colonne avec résumé latéral et import document plus guidé.
- `/appels-offres/[code]` : refonte en workspace avec onglets et intégration directe de la Fiche CDC.
- `/fiche/[code]` : conservation de la logique existante avec meilleure intégration au nouveau shell.
- `/initiation` : conservation pour compatibilité, sans en faire un point d'entrée principal.

## Composants à réutiliser

- `components/fiche-editor.tsx` : coeur métier de la relecture et validation Fiche CDC.
- `components/appel-offres-analysis-panel.tsx` : point d'entrée existant pour lancer ou relancer l'analyse.
- `components/appel-offres-form.tsx` : logique de création / mise à jour à faire évoluer, plutôt que remplacer.
- API existantes :
  - `/api/appels-offres`
  - `/api/appels-offres/[code]`
  - `/api/appels-offres/[code]/pdf`
  - `/api/generate`
  - `/api/fiche/[code]`
  - `/api/fiche/[code]/status`
  - `/api/fiche/[code]/validate`

## Composants à créer ou structurer

- `AppShell` : sidebar, topbar, breadcrumb, recherche globale placeholder, actions contextuelles.
- `Sidebar` : navigation principale, groupes secondaires et items désactivés pour les modules futurs.
- `Topbar` : titre de page, breadcrumb, recherche, notifications, avatar, action principale.
- `PageHeader` : entête standard pour dashboard, liste, création et workspace.
- `StatusBadge` : badges cohérents métier en français.
- `StatCard` : cartes KPI du dashboard.
- `EmptyState` : état vide cohérent et réutilisable.
- `FilterBar` / `SearchInput` : filtres client-side sur la liste des appels d'offres.
- `DataTable` : tableau métier dense et responsive.
- `WorkspaceTabs` : onglets du workspace avec placeholders propres pour les modules futurs.
- `ProgressStepper` : lecture métier de l'avancement d'un appel d'offres.
- `ActivityTimeline` : timeline à partir des événements réels disponibles.
- `ProcessingStatus` : résumé métier du traitement sans exposer les détails n8n à l'utilisateur standard.
- `PlaceholderPanel` : panneau "Bientôt disponible" pour FCI, connaissances et référentiels non encore implémentés.

## Contraintes fonctionnelles retenues

- Ne pas modifier le workflow n8n.
- Ne pas casser la logique existante de Fiche CDC.
- Ne pas remplacer les appels backend existants par des mocks.
- Ne pas inventer silencieusement des données absentes du modèle actuel.
- Afficher les champs non encore supportés comme indisponibles, non renseignés ou bientôt disponibles.

## Ordre d'implémentation

1. Mettre en place le nouveau shell d'application global.
2. Ajouter les composants UI réutilisables de base.
3. Créer la page `/dashboard` avec agrégations réelles à partir des appels d'offres existants.
4. Refaire `/appels-offres` avec toolbar, vue tableau et état vide.
5. Refaire `/appels-offres/nouveau` avec zone d'import améliorée et panneau latéral de synthèse.
6. Refaire `/appels-offres/[code]` en workspace à onglets.
7. Intégrer `FicheEditor` dans l'onglet `Fiche CDC` tout en conservant `/fiche/[code]`.
8. Ajouter les placeholders propres pour les modules non encore implémentés.
9. Ajuster les états responsive, loading, empty et error.
10. Exécuter validation finale (`lint` si disponible, `typecheck`, `build:prod`) et documenter le résultat.
