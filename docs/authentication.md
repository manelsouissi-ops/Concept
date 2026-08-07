# Authentification CONCEPT

## Vue d'ensemble

L'application utilise une authentification locale adossee a PostgreSQL :

- identite dans `public.app_users`
- mot de passe hache dans `app_users.password_hash`
- session opaque dans `public.app_user_sessions`
- cookie HTTP-only `concept_session`
- resolution du current user cote serveur avant toute page/API protegee

Le RBAC s'applique ensuite sur cet utilisateur authentifie.

## Flux de connexion

1. `POST /api/auth/login`
2. recherche de l'utilisateur par email normalise
3. verification :
   - `status = ACTIVE`
   - compte non verrouille
   - mot de passe valide
4. creation d'une session opaque
5. emission du cookie `concept_session`
6. redirection role-aware

Redirections post-login :

- `ADMIN` -> `/administration`
- autres roles -> `/dashboard`

Si le parametre `next` cible une route interdite pour le role connecte, la redirection retombe sur la route par defaut de ce role.

## Flux de deconnexion

1. `POST /api/auth/logout`
2. invalidation de la session en base
3. suppression du cookie
4. retour vers `/login`

## Stockage de session

- table : `public.app_user_sessions`
- token brut : seulement dans le cookie
- hash du token : HMAC-SHA256 derive de `AUTH_SECRET`
- TTL par defaut : `AUTH_SESSION_TTL_SECONDS`

## Pages protegees

Pages privees :

- `/administration/**`
- `/dashboard`
- `/appels-offres/**`
- `/fiche/**`
- `/profile`
- `/settings/**`

Comportement :

- sans session -> redirection vers `/login?next=...`
- session valide mais role insuffisant -> page `403`

Cas particulier `ADMIN` :

- `ADMIN` peut acceder a `/administration`, `/profile`, `/settings`
- `ADMIN` ne peut pas acceder aux surfaces metier :
  - `/dashboard`
  - `/appels-offres/**`
  - `/fiche/**`

## APIs protegees

APIs protegees par session et RBAC :

- administration utilisateurs
- administration logiciels
- dashboard business
- appels d'offres
- Fiche CDC
- FCI
- profil
- switcher de developpement

Reponses :

- non authentifie -> `401`
- authentifie sans droit -> `403`

Callbacks volontairement publics mais authentifies autrement :

- `/api/fiche/callbacks/n8n`
- `/api/fci/callbacks/n8n`
- `/api/fci/contracts/validate`
- `/api/fiche/[code]/complete`

## Variables d'environnement

Obligatoire :

- `AUTH_SECRET`

Local development recommande :

- `CONCEPT_DEV_ADMIN_PASSWORD`
- `CONCEPT_DEV_USER_PASSWORD`
- `AUTH_SESSION_TTL_SECONDS`
- `CONCEPT_ENABLE_DEV_USER_SWITCHER`

## Switcher de developpement

Le switcher de developpement n'est visible que si :

- `NODE_ENV=development`
- `CONCEPT_ENABLE_DEV_USER_SWITCHER=true`
- utilisateur courant = `ADMIN`

Il cree une vraie session pour l'utilisateur cible.
Il ne transforme pas `ADMIN` en super-role metier ; il sert seulement a tester les experiences des autres roles.

## Utilisateurs seed locaux

Utilisateurs seed :

- Bob Durand -> `ADMIN`
- Claire Martin -> `COMMERCIAL`
- Sophie Bernard -> `FINANCE`
- Marc Leroy -> `OPERATIONS`
- Isabelle Moreau -> `DIRECTION_GENERALE`

Les mots de passe seed peuvent etre alimentes par :

- `CONCEPT_DEV_ADMIN_PASSWORD`
- `CONCEPT_DEV_USER_PASSWORD`

## Trajectoire future

Avant production complete, il restera a ajouter :

- reset de mot de passe
- rotation / coffre-fort des secrets
- supervision securite
- federation SSO
- administration des sessions
