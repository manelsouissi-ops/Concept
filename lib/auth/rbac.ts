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
  "dashboard.view",
  "appels_offres.view",
  "administration.view",
  "fci.view",
  "fci.edit",
  "fci.validate",
  "fci.generate",
  "fci.regenerate",
  "fci.final_decision"
] as const;

export type Permission = (typeof RBAC_PERMISSIONS)[number];

export type AppArea = "dashboard" | "appels_offres" | "administration";

export type CurrentUser = {
  id: string;
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

const AREA_ACCESS: Record<AppArea, readonly UserRole[]> = {
  dashboard: USER_ROLES,
  appels_offres: USER_ROLES,
  administration: ["ADMIN"]
};

const FCI_EDITOR_ROLE_BY_MODULE: Partial<Record<FciModuleCode, UserRole>> = {
  A: "COMMERCIAL",
  B: "FINANCE",
  C: "OPERATIONS",
  D: "DIRECTION_GENERALE"
};

export const rolePermissions: Record<UserRole, readonly Permission[]> = {
  ADMIN: RBAC_PERMISSIONS,
  COMMERCIAL: [
    "dashboard.view",
    "appels_offres.view",
    "fci.view",
    "fci.edit",
    "fci.validate",
    "fci.generate",
    "fci.regenerate"
  ],
  FINANCE: [
    "dashboard.view",
    "appels_offres.view",
    "fci.view",
    "fci.edit",
    "fci.validate",
    "fci.generate",
    "fci.regenerate"
  ],
  OPERATIONS: [
    "dashboard.view",
    "appels_offres.view",
    "fci.view",
    "fci.edit",
    "fci.validate",
    "fci.generate",
    "fci.regenerate"
  ],
  DIRECTION_GENERALE: [
    "dashboard.view",
    "appels_offres.view",
    "fci.view",
    "fci.edit",
    "fci.validate",
    "fci.generate",
    "fci.regenerate",
    "fci.final_decision"
  ]
};

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
  return AREA_ACCESS[area].includes(role);
}

export function canViewFciModule(role: UserRole, moduleCode: FciModuleCode) {
  if (role === "ADMIN") {
    return true;
  }

  return moduleCode === "E" ? false : canAccess(role, "appels_offres");
}

export function getFciEditableRole(moduleCode: FciModuleCode) {
  return FCI_EDITOR_ROLE_BY_MODULE[moduleCode] ?? null;
}

export function canEditFciModule(role: UserRole, moduleCode: FciModuleCode) {
  if (role === "ADMIN") {
    return true;
  }

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
  return role === "ADMIN" || role === "DIRECTION_GENERALE";
}

export function getFciReadOnlyMessage(role: UserRole, moduleCode: FciModuleCode) {
  if (role === "ADMIN") {
    return null;
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

export function getAreaAccessDeniedMessage(area: AppArea) {
  switch (area) {
    case "administration":
      return "Acces refuse : cette section est reservee a l'administrateur.";
    case "dashboard":
      return "Acces refuse : vous ne pouvez pas consulter le tableau de bord.";
    case "appels_offres":
      return "Acces refuse : vous ne pouvez pas consulter les appels d'offres.";
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
