# RBAC MVP

## Role summary

Roles actifs :

- `ADMIN`
- `COMMERCIAL`
- `FINANCE`
- `OPERATIONS`
- `DIRECTION_GENERALE`

Le role `ADMIN` est maintenant strictement technique. Il n'est plus traite comme un super-utilisateur metier.

## Permission matrix

| Role | Administration | Dashboard business | Appels d'offres | FCI view | FCI edit/generate/validate | Final Go / No-Go |
| --- | --- | --- | --- | --- | --- | --- |
| `ADMIN` | Oui | Non | Non | Non | Non | Non |
| `COMMERCIAL` | Non | Oui | Oui | Tous les modules A-D en lecture | Module `A / DC` uniquement | Non |
| `FINANCE` | Non | Oui | Oui | Tous les modules A-D en lecture | Module `B / DF` uniquement | Non |
| `OPERATIONS` | Non | Oui | Oui | Tous les modules A-D en lecture | Module `C / DO` uniquement | Non |
| `DIRECTION_GENERALE` | Non | Oui | Oui | Tous les modules A-D en lecture | Module `D / DG` uniquement | Oui |

## Central enforcement

La source unique reste `lib/auth/rbac.ts`.

Permissions techniques `ADMIN` :

- `admin.users.manage`
- `admin.reference_data.manage`
- `admin.settings.view`
- `profile.view`
- `profile.edit_self`
- `settings.view`

Permissions explicitement retirees a `ADMIN` :

- `dashboard.view`
- `tender.view`
- `tender.create`
- `fiche_cdc.view`
- `fiche_cdc.edit`
- `fiche_cdc.validate`
- `fci.view`
- `fci.edit`
- `fci.generate`
- `fci.regenerate`
- `fci.validate`
- `fci.final_decision`

Il n'existe plus de logique equivalente a `ADMIN = all permissions`.

## Landing and navigation

Apres connexion :

- `ADMIN` -> `/administration`
- autres roles -> `/dashboard`

Si un `next` pointe vers une route interdite pour `ADMIN`, la redirection retombe sur `/administration`.

Navigation `ADMIN` :

- `Administration`
- `Utilisateurs`
- `Logiciels`
- `Parametres`
- `Profil`

Navigation masquee pour `ADMIN` :

- `Tableau de bord`
- `Appels d'offres`
- toutes les entrees Fiche CDC / FCI / Go-No-Go

## Page protection

Pages metier interdites a `ADMIN` :

- `/dashboard`
- `/appels-offres/**`
- `/fiche/**`

Comportement :

- acces direct par `ADMIN` -> page `403`
- message : `Cette fonctionnalite est reservee aux equipes metier.`

## API protection

Les APIs metier refusent desormais `ADMIN` avec `403` sans exposer de payload business.

Protections ajoutees sur :

- APIs dashboard
- APIs appels d'offres
- APIs analyse / documents / historique CDC
- APIs Fiche CDC
- APIs FCI workspace / module / generation / regeneration / validation / export / history

Les callbacks restent publics et sont proteges par leurs propres secrets/signatures :

- `/api/fiche/callbacks/n8n`
- `/api/fci/callbacks/n8n`
- `/api/fci/contracts/validate`
- `/api/fiche/[code]/complete`

## Development switcher

Le commutateur de developpement reste disponible uniquement si :

- `NODE_ENV=development`
- `CONCEPT_ENABLE_DEV_USER_SWITCHER=true`
- l'utilisateur connecte est `ADMIN`

Libelle affiche :

- `Changer d'utilisateur - developpement`

Ce switcher ne modifie pas les permissions reelles du role `ADMIN`.
Il permet seulement d'ouvrir une session authentifiee comme un autre utilisateur seed pour tester les experiences metier.

## Server-side and UI behavior

- les checks critiques restent centralises ;
- les boutons ne suffisent pas a proteger les ecritures ;
- les modules FCI restent visibles seulement pour les roles metier ;
- `ADMIN` ne peut ni voir, ni editer, ni generer, ni exporter, ni valider un module FCI.

## Future work

Fonctionnalites `ADMIN` volontairement differees :

- gestion avancee des roles et habilitations fines
- journal d'audit technique
- supervision sante / erreurs plateforme
- administration des sessions
- reset de mot de passe
