import type { FciModuleCode } from "@/lib/appels-offres/fci/types.ts";
import type { DepartmentCode, UserStatus } from "@/lib/users/types.ts";

export const USER_ROLES = [
  "ADMIN",
  "COMMERCIAL",
  "FINANCE",
  "OPERATIONS",
  "DIRECTION_GENERALE"
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const RBAC_PERMISSIONS = [
  "admin.users.manage",
  "admin.reference_data.manage",
  "admin.settings.view",
  "profile.view",
  "profile.edit_self",
  "settings.view",
  "dashboard.view",
  "tender.view",
  "tender.create",
  "fiche_cdc.view",
  "fiche_cdc.edit",
  "fiche_cdc.validate",
  "fci.view",
  "fci.edit",
  "fci.validate",
  "fci.generate",
  "fci.regenerate",
  "fci.final_decision"
] as const;

export type Permission = (typeof RBAC_PERMISSIONS)[number];

export type AppArea =
  | "administration"
  | "dashboard"
  | "appels_offres"
  | "profile"
  | "settings";

export type CurrentUser = {
  id: string;
  firstName: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  departmentCode: DepartmentCode;
  departmentLabel: string;
  jobTitle: string;
  avatarUrl: string | null;
  phone: string | null;
  language: string;
  timezone: string;
  lastLoginAt: string | null;
  createdAt: string;
  isDevelopmentUser: boolean;
};

export type UserPresentation = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  role_label: string;
  status: UserStatus;
  department_code: DepartmentCode;
  department_label: string;
  job_title: string;
  avatar_url: string | null;
  phone: string | null;
  language: string;
  timezone: string;
  last_login_at: string | null;
  created_at: string;
  is_development_user: boolean;
};

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrateur",
  COMMERCIAL: "Commercial",
  FINANCE: "Finance",
  OPERATIONS: "Operations",
  DIRECTION_GENERALE: "Direction generale"
};

const AREA_PERMISSION: Record<AppArea, Permission> = {
  administration: "admin.users.manage",
  dashboard: "dashboard.view",
  appels_offres: "tender.view",
  profile: "profile.view",
  settings: "settings.view"
};

const FCI_EDITOR_ROLE_BY_MODULE: Partial<Record<FciModuleCode, UserRole>> = {
  A: "COMMERCIAL",
  B: "FINANCE",
  C: "OPERATIONS"
};

export const rolePermissions: Record<UserRole, readonly Permission[]> = {
  ADMIN: [
    "admin.users.manage",
    "admin.reference_data.manage",
    "admin.settings.view",
    "profile.view",
    "profile.edit_self",
    "settings.view"
  ],
  COMMERCIAL: [
    "profile.view",
    "profile.edit_self",
    "settings.view",
    "dashboard.view",
    "tender.view",
    "tender.create",
    "fiche_cdc.view",
    "fiche_cdc.edit",
    "fiche_cdc.validate",
    "fci.view",
    "fci.edit",
    "fci.validate",
    "fci.generate",
    "fci.regenerate"
  ],
  FINANCE: [
    "profile.view",
    "profile.edit_self",
    "settings.view",
    "dashboard.view",
    "tender.view",
    "fiche_cdc.view",
    "fci.view",
    "fci.edit",
    "fci.validate",
    "fci.generate",
    "fci.regenerate"
  ],
  OPERATIONS: [
    "profile.view",
    "profile.edit_self",
    "settings.view",
    "dashboard.view",
    "tender.view",
    "fiche_cdc.view",
    "fci.view",
    "fci.edit",
    "fci.validate",
    "fci.generate",
    "fci.regenerate"
  ],
  DIRECTION_GENERALE: [
    "profile.view",
    "profile.edit_self",
    "settings.view",
    "dashboard.view",
    "tender.view",
    "fiche_cdc.view",
    "fci.view",
    "fci.final_decision"
  ]
};

function normalizePathname(pathname: string) {
  const [path] = pathname.split("?");
  return path || "/";
}

export function hasPermission(role: UserRole, permission: Permission) {
  return rolePermissions[role].includes(permission);
}

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}

export function parseUserRole(value: unknown): UserRole | null {
  if (!isUserRole(value)) {
    return null;
  }

  return value;
}

export function getUserRoleLabel(role: UserRole) {
  return ROLE_LABELS[role];
}

export function buildUserPresentation(user: CurrentUser): UserPresentation {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    role_label: getUserRoleLabel(user.role),
    status: user.status,
    department_code: user.departmentCode,
    department_label: user.departmentLabel,
    job_title: user.jobTitle,
    avatar_url: user.avatarUrl,
    phone: user.phone,
    language: user.language,
    timezone: user.timezone,
    last_login_at: user.lastLoginAt,
    created_at: user.createdAt,
    is_development_user: user.isDevelopmentUser
  };
}

export function canAccess(role: UserRole, area: AppArea) {
  return hasPermission(role, AREA_PERMISSION[area]);
}

export function getDefaultAuthenticatedPath(role: UserRole) {
  return role === "ADMIN" ? "/administration" : "/dashboard";
}

export function canAccessPath(role: UserRole, pathname: string) {
  const normalized = normalizePathname(pathname);

  if (normalized === "/administration" || normalized.startsWith("/administration/")) {
    return canAccess(role, "administration");
  }

  if (normalized === "/dashboard") {
    return canAccess(role, "dashboard");
  }

  if (
    normalized === "/appels-offres"
    || normalized.startsWith("/appels-offres/")
    || normalized === "/fiche"
    || normalized.startsWith("/fiche/")
    || normalized === "/initiation"
  ) {
    return canAccess(role, "appels_offres");
  }

  if (normalized === "/profile") {
    return canAccess(role, "profile");
  }

  if (normalized === "/settings" || normalized.startsWith("/settings/")) {
    return canAccess(role, "settings");
  }

  return false;
}

export function canViewFciModule(role: UserRole, moduleCode: FciModuleCode) {
  if (role === "ADMIN") {
    return false;
  }

  return moduleCode !== "E" && canAccess(role, "appels_offres");
}

export function getFciEditableRole(moduleCode: FciModuleCode) {
  return FCI_EDITOR_ROLE_BY_MODULE[moduleCode] ?? null;
}

// Reverse lookup of FCI_EDITOR_ROLE_BY_MODULE: which module (if any) a role owns.
// Single source of truth stays the module->role map above, so adding a role/module
// pair there is enough for both directions to stay correct.
export function getFciModuleForRole(role: UserRole): FciModuleCode | null {
  const entry = (Object.entries(FCI_EDITOR_ROLE_BY_MODULE) as [FciModuleCode, UserRole][]).find(
    ([, ownerRole]) => ownerRole === role
  );

  return entry ? entry[0] : null;
}

export function canEditFciModule(role: UserRole, moduleCode: FciModuleCode) {
  return getFciEditableRole(moduleCode) === role;
}

export function canValidateFciModule(role: UserRole, moduleCode: FciModuleCode) {
  return canEditFciModule(role, moduleCode);
}

export function canGenerateFciModule(role: UserRole, moduleCode: FciModuleCode) {
  return canEditFciModule(role, moduleCode);
}

export function canRegenerateFciModule(role: UserRole, moduleCode: FciModuleCode) {
  return canEditFciModule(role, moduleCode);
}

export function canMakeFinalDecision(role: UserRole) {
  return role === "DIRECTION_GENERALE";
}

export function getFciReadOnlyMessage(role: UserRole, moduleCode: FciModuleCode) {
  if (role === "ADMIN") {
    return "Cette fonctionnalite est reservee aux equipes metier.";
  }

  const editorRole = getFciEditableRole(moduleCode);
  if (!editorRole) {
    return "Ce module est disponible en lecture seule dans cette phase.";
  }

  if (editorRole === role) {
    return null;
  }

  return `Lecture seule : seul ${getUserRoleLabel(editorRole).toLowerCase()} peut modifier ce module.`;
}

export function getAreaAccessDeniedMessage(area: AppArea, role?: UserRole) {
  if (role === "ADMIN" && (area === "dashboard" || area === "appels_offres")) {
    return "Cette fonctionnalite est reservee aux equipes metier.";
  }

  switch (area) {
    case "administration":
      return "Acces refuse : cette section est reservee a l'administrateur.";
    case "dashboard":
      return "Acces refuse : vous ne pouvez pas consulter le tableau de bord.";
    case "appels_offres":
      return "Acces refuse : vous ne pouvez pas consulter les appels d'offres.";
    case "profile":
      return "Acces refuse : vous ne pouvez pas consulter ce profil.";
    case "settings":
      return "Acces refuse : vous ne pouvez pas consulter les parametres.";
  }
}

export function getFciEditDeniedMessage(moduleCode: FciModuleCode) {
  const editorRole = getFciEditableRole(moduleCode);
  if (!editorRole) {
    return "Acces refuse : ce module FCI n'est pas modifiable dans cette phase.";
  }

  return `Acces refuse : seul ${getUserRoleLabel(editorRole).toLowerCase()} peut modifier ce module FCI.`;
}

export function getFciGenerateDeniedMessage(moduleCode: FciModuleCode) {
  const editorRole = getFciEditableRole(moduleCode);
  if (!editorRole) {
    return "Acces refuse : ce module FCI n'est pas generable dans cette phase.";
  }

  return `Acces refuse : seul ${getUserRoleLabel(editorRole).toLowerCase()} peut lancer la generation de ce module FCI.`;
}
