# User Management

## Objectif

Le module `User Management` fournit la couche d'identite persisted de CONCEPT et alimente :

- l'authentification locale ;
- le RBAC centralise ;
- l'administration des utilisateurs ;
- le profil utilisateur ;
- le switcher de developpement.

## Objets de base

Tables principales :

- `public.app_users`
- `public.app_departments`
- `public.app_runtime_settings`

`public.app_runtime_settings` conserve l'utilisateur cible du switcher de developpement.

## Utilisateurs

Champs fonctionnels principaux :

- nom / prenom / display name
- email / normalized_email
- role
- department_code
- status
- job_title
- phone
- language
- timezone
- last_login_at

Statuts :

- `ACTIVE`
- `INACTIVE`
- `INVITED`
- `LOCKED`

Departements seeds :

- `ADMINISTRATION`
- `COMMERCIAL`
- `FINANCE`
- `OPERATIONS`
- `DIRECTION_GENERALE`

## Roles actuels

- `ADMIN`
- `COMMERCIAL`
- `FINANCE`
- `OPERATIONS`
- `DIRECTION_GENERALE`

Important :

- `ADMIN` est un role d'administration technique
- `ADMIN` ne voit plus les contenus metier appels d'offres / Fiche CDC / FCI
- les roles metier gardent l'acces au dashboard et aux appels d'offres

## Seed users

Utilisateurs seeds locaux :

- Bob Durand -> `ADMIN` / `ADMINISTRATION`
- Claire Martin -> `COMMERCIAL` / `COMMERCIAL`
- Sophie Bernard -> `FINANCE` / `FINANCE`
- Marc Leroy -> `OPERATIONS` / `OPERATIONS`
- Isabelle Moreau -> `DIRECTION_GENERALE` / `DIRECTION_GENERALE`

Bob reste le compte d'administration par defaut pour le developpement.

## Se connecter en local

Variables requises dans `.env.local` :

- `DATABASE_URL` - connexion PostgreSQL (requise avant tout : le schema
  d'authentification, les sessions et les utilisateurs seed y sont stockes).
- `AUTH_SECRET` - secret utilise pour signer les jetons de session.
- `CONCEPT_DEV_ADMIN_PASSWORD` - mot de passe local pour le compte `ADMIN`
  seed (`bob.durand@concept.local`), lu par `lib/auth/config.ts`. Actif
  uniquement quand `NODE_ENV=development`.
- `CONCEPT_DEV_USER_PASSWORD` - mot de passe local partage par les quatre
  comptes metier seed (`claire.martin@concept.local`,
  `sophie.bernard@concept.local`, `marc.leroy@concept.local`,
  `isabelle.moreau@concept.local`).

Ces mots de passe ne sont jamais codes en dur : ils sont lus depuis
l'environnement au demarrage et hashes (`lib/auth/repository.ts:
seedDevelopmentPasswords`) sur les seeds qui n'ont pas encore de
`password_hash`, uniquement en developpement.

Pour se connecter : ouvrir `/login`, saisir `bob.durand@concept.local` et la
valeur de `CONCEPT_DEV_ADMIN_PASSWORD` (ou un des quatre emails seed metier
avec `CONCEPT_DEV_USER_PASSWORD`). Une connexion reussie pose le cookie de
session `concept_session` et redirige vers la page par defaut du role
(`/administration` pour `ADMIN`, `/dashboard` pour les autres roles).

## Surfaces UI

### Administration

Pages principales :

- `/administration`
- `/administration/utilisateurs`
- `/administration/utilisateurs/nouveau`
- `/administration/utilisateurs/[id]`
- `/administration/utilisateurs/[id]/modifier`
- `/administration/logiciels`

Actions reservees a `ADMIN` :

- creer un utilisateur
- modifier un utilisateur
- activer / desactiver
- attribuer role et departement
- gerer les donnees de reference techniques

### Profil

`/profile` reste accessible a tous les roles, y compris `ADMIN`.

### Parametres

`/settings/**` reste accessible a tous les roles authentifies.

## Restrictions `ADMIN`

Le role `ADMIN` ne doit pas etre utilise comme super-role metier.

Restrictions explicites :

- pas d'acces au dashboard business
- pas d'acces a `/appels-offres/**`
- pas d'acces a `/fiche/**`
- pas d'acces aux modules FCI
- pas d'export FCI
- pas de validation metier

## APIs

Routes d'administration :

- `GET /api/administration/utilisateurs`
- `POST /api/administration/utilisateurs`
- `GET /api/administration/utilisateurs/[id]`
- `PUT /api/administration/utilisateurs/[id]`
- `POST /api/administration/utilisateurs/[id]/activate`
- `POST /api/administration/utilisateurs/[id]/deactivate`

Ces routes renvoient `403` pour tout role non-`ADMIN`.

Routes profil :

- `GET /api/profile`
- `PATCH /api/profile`

## Switcher de developpement

Disponible uniquement si :

- `NODE_ENV=development`
- `CONCEPT_ENABLE_DEV_USER_SWITCHER=true`
- utilisateur courant = `ADMIN`

Libelle UI :

- `Changer d'utilisateur - developpement`

Le switcher permet de tester l'experience d'un role metier sans modifier le modele RBAC.

## Validation et garde-fous

- unicite email en base
- validation des roles
- validation des departements
- validation des statuts
- `403` sur les APIs d'administration non autorisees

## Evolutions futures

Hors scope actuel :

- onboarding / invitation complete
- reset de mot de passe
- audit avance des actions admin
- gestion des sessions utilisateur
- permissions fines par fonctionnalite
