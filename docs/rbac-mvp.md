# RBAC MVP

## Roles

- `ADMIN`
- `COMMERCIAL`
- `FINANCE`
- `OPERATIONS`
- `DIRECTION_GENERALE`

## Permission matrix

| Role | Dashboard | Appels d'offres | Administration | FCI view | FCI edit | FCI generate/regenerate | FCI validate | Final Go / No-Go |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ADMIN` | Yes | Yes | Yes | All modules | All modules | All modules | All modules | Yes |
| `COMMERCIAL` | Yes | Yes | No | All modules | `A / DC` only | `A / DC` only | `A / DC` only | No |
| `FINANCE` | Yes | Yes | No | All modules | `B / DF` only | `B / DF` only | `B / DF` only | No |
| `OPERATIONS` | Yes | Yes | No | All modules | `C / DO` only | `C / DO` only | `C / DO` only | No |
| `DIRECTION_GENERALE` | Yes | Yes | No | All modules | `D / DG` only | `D / DG` only | `D / DG` only | Yes |

## FCI module mapping

- `A` -> Direction Commerciale
- `B` -> Direction Financiere
- `C` -> Direction Operationnelle
- `D` -> Direction Generale

## Server-side enforcement

The MVP does not rely on hidden buttons alone.

- Administration pages and APIs are restricted to `ADMIN`.
- FCI read APIs still expose all departmental modules to all business roles.
- FCI write actions are enforced in the service layer:
  - draft save
  - generation
  - regeneration
  - validation / completion
- Unauthorized writes return `403` with a French `RBAC_FORBIDDEN` error payload.

## UI behavior

- The active user name and role are visible in the global shell and in the FCI workspace header.
- Every FCI module stays visible for every business role.
- Non-owner roles see modules in read-only mode.
- Read-only modules show a clear informational message.
- Save / reset / generate / regenerate / validate actions are hidden when the current role is not allowed to perform them.
- Existing exports remain available when module data exists.

## Temporary development user

There is not yet a real authentication system or user table for the platform.

The MVP therefore uses a temporary development-user abstraction:

- default user name: `Bob Durand`
- default role: `ADMIN`
- request header overrides supported for tests and manual QA:
  - `x-concept-dev-role`
  - `x-concept-dev-name`
- optional environment override:
  - `CONCEPT_DEV_ROLE`

This keeps the RBAC policy centralized while remaining easy to replace with real authentication later.

## Future authentication integration

When a real identity layer is introduced, replace only the current-user resolver:

1. map the authenticated user to `CurrentUser`
2. persist user roles in the database
3. remove development-header overrides outside local development
4. keep the RBAC policy helpers unchanged

## Known limitations

- There is no full user-management UI yet.
- There is no dedicated final Go / No-Go API route yet; the MVP prepares the permission model for it with `canMakeFinalDecision(...)`.
- The MVP is intentionally scoped to the current tender-management and FCI flows and does not introduce full authentication.
