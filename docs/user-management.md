# User Management

## Objective

This module introduces a persisted identity layer for CONCEPT without adding authentication yet.

It provides:

- a real `app_users` domain model in PostgreSQL;
- departments and user statuses;
- an editable `/profile` experience;
- an administration area for user lifecycle management;
- a development-only current-user switcher;
- RBAC integration driven by the selected persisted user instead of a hardcoded Bob-only fallback.

The authentication milestone will later connect to this model.

## Architecture

### Domain and persistence

User management lives under `lib/users/`:

- `types.ts`: user, department, status, and development-switcher types
- `presentation.ts`: labels, initials, and UI-facing helpers
- `validation.ts`: payload parsing and business validation
- `repository.ts`: PostgreSQL schema setup, seed data, CRUD operations, and development user selection
- `client.ts`: browser-side fetch helpers for profile, administration, and development switching
- `http.ts`: shared API response helpers
- `settings.ts`: placeholder settings navigation model

### Database objects

The repository ensures these tables exist:

- `public.app_departments`
- `public.app_users`
- `public.app_runtime_settings`

`public.app_runtime_settings` stores the currently selected development user:

- `development.current_user_id`

This allows permission changes without restart and without custom headers.

## Identity model

### User

Main fields:

- `id`
- `first_name`
- `last_name`
- `display_name`
- `email`
- `normalized_email`
- `job_title`
- `department_code`
- `role`
- `status`
- `avatar_url`
- `phone`
- `language`
- `timezone`
- `created_at`
- `updated_at`
- `last_login_at`

### Statuses

- `ACTIVE`
- `INACTIVE`
- `INVITED`
- `LOCKED`

### Departments

- `COMMERCIAL`
- `FINANCE`
- `OPERATIONS`
- `DIRECTION_GENERALE`
- `ADMINISTRATION`

## Roles and RBAC

Roles reuse the existing RBAC model:

- `ADMIN`
- `COMMERCIAL`
- `FINANCE`
- `OPERATIONS`
- `DIRECTION_GENERALE`

The current user is now resolved from the persisted development user in the database.

That current user feeds:

- `canAccess(...)`
- `canViewFciModule(...)`
- `canEditFciModule(...)`
- `canMakeFinalDecision(...)`

No manual testing headers are required anymore.

## Seed users

The repository seeds realistic internal users:

- Bob Durand — `ADMIN` / `ADMINISTRATION`
- Claire Martin — `COMMERCIAL` / `COMMERCIAL`
- Sophie Bernard — `FINANCE` / `FINANCE`
- Marc Leroy — `OPERATIONS` / `OPERATIONS`
- Isabelle Moreau — `DIRECTION_GENERALE` / `DIRECTION_GENERALE`

Bob remains the default development user.

## Development switcher

Visible only when `NODE_ENV !== "production"`.

Behavior:

- the top-right user dropdown exposes the available seeded users;
- selecting a user updates `public.app_runtime_settings`;
- the app refreshes immediately;
- permissions, navigation access, and FCI edit rights change without restart.

This switcher is intentionally separate from authentication.

## UI surfaces

### App shell

The shell now shows:

- avatar or initials;
- name;
- role;
- department;
- dropdown links to:
  - `/profile`
  - `/settings`
  - development switcher in development mode

### Profile

`/profile` allows the current user to edit:

- first name
- last name
- email
- phone
- department
- job title
- avatar URL
- language
- timezone

Read-only profile context:

- role
- account status
- last login
- created date

### Administration → Utilisateurs

Pages:

- `/administration/utilisateurs`
- `/administration/utilisateurs/nouveau`
- `/administration/utilisateurs/[id]`
- `/administration/utilisateurs/[id]/modifier`

Supported actions:

- create user
- edit user
- activate user
- deactivate user
- search/filter by role, department, and status

### Settings placeholders

Pages:

- `/settings`
- `/settings/general`
- `/settings/profile`
- `/settings/notifications`
- `/settings/security`

These pages are intentionally non-functional placeholders, but they follow the same application design system and are ready to receive future settings capabilities.

## API routes

### Administration

- `GET /api/administration/utilisateurs`
- `POST /api/administration/utilisateurs`
- `GET /api/administration/utilisateurs/[id]`
- `PUT /api/administration/utilisateurs/[id]`
- `POST /api/administration/utilisateurs/[id]/activate`
- `POST /api/administration/utilisateurs/[id]/deactivate`

These routes are protected by the existing administration RBAC gate.

### Profile

- `GET /api/profile`
- `PATCH /api/profile`

### Development switching

- `GET /api/development/current-user`
- `PUT /api/development/current-user`

Available only outside production mode.

## Validation and safeguards

Validation currently enforces:

- required first name
- required last name
- valid email format
- unique email at persistence level
- valid department code
- valid role
- valid status

API behavior:

- unauthorized administration access returns `403`
- duplicate email returns `409`
- invalid payload returns `400`
- unknown user returns `404`

## Future authentication integration

This module is intentionally authentication-ready, but not authenticated.

The next milestone can safely add:

- a real user principal from session/auth middleware
- password or SSO providers
- invite/onboarding flows
- lockout and audit controls
- user-specific notification preferences
- avatar uploads instead of URL-only storage

To integrate production authentication, the main remaining steps are:

1. Replace the development user resolver with a session-backed resolver.
2. Map the authenticated identity to `public.app_users`.
3. Persist `last_login_at` during successful sign-in.
4. Restrict the development switcher to local development only.
5. Add security and audit requirements around user activation, locking, and admin actions.
