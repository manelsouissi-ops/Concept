import type { DepartmentCode, DepartmentRecord, UserRecord, UserStatus } from "./types.ts";

const DEPARTMENT_LABELS: Record<DepartmentCode, string> = {
  COMMERCIAL: "Commercial",
  FINANCE: "Finance",
  OPERATIONS: "Operations",
  DIRECTION_GENERALE: "Direction generale",
  ADMINISTRATION: "Administration"
};

const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: "Actif",
  INACTIVE: "Inactif",
  INVITED: "Invite",
  LOCKED: "Verrouille"
};

export function getDepartmentLabel(code: DepartmentCode) {
  return DEPARTMENT_LABELS[code];
}

export function getUserStatusLabel(status: UserStatus) {
  return USER_STATUS_LABELS[status];
}

export function getUserStatusTone(status: UserStatus) {
  switch (status) {
    case "ACTIVE":
      return "success" as const;
    case "INVITED":
      return "info" as const;
    case "LOCKED":
      return "warning" as const;
    case "INACTIVE":
      return "neutral" as const;
  }
}

export function buildDisplayName(firstName: string, lastName: string) {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}

export function getUserInitials(input: {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
}) {
  const explicit = [input.firstName, input.lastName]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .map((value) => value[0]?.toUpperCase() ?? "")
    .join("");

  if (explicit) {
    return explicit.slice(0, 2);
  }

  return (input.displayName ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function mapDepartmentRecord(code: DepartmentCode): Omit<DepartmentRecord, "createdAt" | "updatedAt"> {
  return {
    code,
    name: getDepartmentLabel(code)
  };
}

export function buildProfileMetadata(user: UserRecord) {
  return [
    { label: "Email", value: user.email },
    { label: "Telephone", value: user.phone ?? "Non renseigne" },
    { label: "Langue", value: user.language },
    { label: "Fuseau horaire", value: user.timezone },
    { label: "Statut", value: getUserStatusLabel(user.status) },
    { label: "Derniere connexion", value: user.lastLoginAt ?? "Jamais" },
    { label: "Compte cree le", value: user.createdAt }
  ];
}
